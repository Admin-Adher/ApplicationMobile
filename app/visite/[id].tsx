import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Visite, Reserve, VisiteStatus, OprStatus } from '@/constants/types';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';

const STATUS_CFG: Record<VisiteStatus, { label: string; color: string }> = {
  planned: { label: 'Planifiée', color: '#6366F1' },
  in_progress: { label: 'En cours', color: C.inProgress },
  completed: { label: 'Terminée', color: C.closed },
};

const RESERVE_STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente',
  verification: 'Vérification', closed: 'Clôturé',
};
const RESERVE_STATUS_COLORS: Record<string, string> = {
  open: C.open, in_progress: C.inProgress, waiting: C.waiting,
  verification: C.verification, closed: C.closed,
};
const PRIORITY_LABELS: Record<string, string> = { low: 'Faible', medium: 'Moyen', high: 'Haute', critical: 'Critique' };
const PRIORITY_COLORS: Record<string, string> = { low: '#22C55E', medium: '#F59E0B', high: '#EF4444', critical: '#7C3AED' };

function buildVisitePDF(visite: Visite, reserves: Reserve[], projectName: string): string {
  const statusLabels = RESERVE_STATUS_LABELS;
  const priorityLabels = PRIORITY_LABELS;
  const priorityColors: Record<string, string> = { low: '#22C55E', medium: '#F59E0B', high: '#EF4444', critical: '#7C3AED' };
  const statusColor: Record<string, string> = { open: '#EF4444', in_progress: '#F59E0B', waiting: '#6366F1', verification: '#3B82F6', closed: '#10B981' };
  const rows = reserves.map(r =>
    `<tr>
      <td><strong>${r.id}</strong></td>
      <td>${r.title}</td>
      <td>Bât. ${r.building} — ${r.level}</td>
      <td>${r.company}</td>
      <td style="color:${priorityColors[r.priority]||'#000'};font-weight:bold">${priorityLabels[r.priority]||r.priority}</td>
      <td style="color:${statusColor[r.status]||'#000'}">${statusLabels[r.status]||r.status}</td>
      <td>${r.deadline}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 30px; color: #111; }
    h1 { color: #1A6FD8; font-size: 20px; }
    h2 { color: #333; font-size: 15px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 24px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
    th { background: #1A6FD8; color: white; padding: 7px; text-align: left; }
    td { padding: 5px 7px; border-bottom: 1px solid #eee; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 11px; font-weight: bold; }
    .kpi { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
    .kpi-card { border: 1px solid #ccc; border-radius: 8px; padding: 10px 16px; text-align: center; }
    .kpi-val { font-size: 22px; font-weight: bold; color: #1A6FD8; }
    .kpi-label { font-size: 11px; color: #666; }
    .notes-box { background: #f9fafb; border-left: 3px solid #1A6FD8; padding: 10px 14px; margin-top: 10px; font-size: 12px; }
  </style></head><body>
  <h1>Compte-rendu de visite — ${visite.title}</h1>
  <p class="meta">
    Projet : ${projectName} &nbsp;|&nbsp;
    Date : ${visite.date} &nbsp;|&nbsp;
    Conducteur : ${visite.conducteur} &nbsp;|&nbsp;
    Localisation : Bât. ${visite.building || '—'} / ${visite.level || '—'}
  </p>
  <div class="kpi">
    <div class="kpi-card"><div class="kpi-val">${reserves.length}</div><div class="kpi-label">Réserves relevées</div></div>
    <div class="kpi-card"><div class="kpi-val" style="color:#EF4444">${reserves.filter(r => r.status === 'open').length}</div><div class="kpi-label">Ouvertes</div></div>
    <div class="kpi-card"><div class="kpi-val" style="color:#F59E0B">${reserves.filter(r => r.status === 'in_progress').length}</div><div class="kpi-label">En cours</div></div>
    <div class="kpi-card"><div class="kpi-val" style="color:#10B981">${reserves.filter(r => r.status === 'closed').length}</div><div class="kpi-label">Clôturées</div></div>
  </div>
  ${visite.notes ? `<div class="notes-box"><strong>Notes :</strong> ${visite.notes}</div>` : ''}
  <h2>Réserves de cette visite (${reserves.length})</h2>
  <table>
    <thead><tr><th>ID</th><th>Titre</th><th>Lieu</th><th>Entreprise</th><th>Priorité</th><th>Statut</th><th>Échéance</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">Aucune réserve rattachée</td></tr>'}</tbody>
  </table>
  </body></html>`;
}

export default function VisiteDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { visites, reserves, updateVisite, deleteVisite, activeChantier, oprs } = useApp();
  const { permissions } = useAuth();
  const { useSettings } = require('@/context/SettingsContext');
  const { projectName } = useSettings();

  const visite = visites.find(v => v.id === id);
  const visiteReserves = useMemo(
    () => reserves.filter(r => visite?.reserveIds.includes(r.id)),
    [reserves, visite]
  );

  const tunnelData = useMemo(() => {
    if (!visite) return null;
    const total = visiteReserves.length;
    const closed = visiteReserves.filter(r => r.status === 'closed').length;
    const pctLevees = total > 0 ? Math.round((closed / total) * 100) : 0;
    const chantierId = visite.chantierId ?? activeChantier?.id;
    const chantierOprs = oprs.filter(o => !chantierId || o.chantierId === chantierId);
    const signedOpr = chantierOprs.find(o => o.status === 'signed');
    const anyOpr = chantierOprs.length > 0;
    return { total, closed, pctLevees, anyOpr, signedOpr };
  }, [visite, visiteReserves, oprs, activeChantier]);

  if (!visite) {
    return (
      <View style={styles.container}>
        <Header title="Visite" showBack />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={40} color={C.textMuted} />
          <Text style={styles.notFoundText}>Visite introuvable</Text>
        </View>
      </View>
    );
  }

  const cfg = STATUS_CFG[visite.status];

  function cycleStatus() {
    const order: VisiteStatus[] = ['planned', 'in_progress', 'completed'];
    const idx = order.indexOf(visite!.status);
    const next = order[(idx + 1) % order.length];
    updateVisite({ ...visite!, status: next });
  }

  function handleDelete() {
    Alert.alert('Supprimer', `Supprimer la visite "${visite!.title}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: () => {
          deleteVisite(visite!.id);
          router.back();
        },
      },
    ]);
  }

  async function exportPDF() {
    const html = buildVisitePDF(visite!, visiteReserves, projectName);
    if (Platform.OS === 'web') {
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
      return;
    }
    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Partager le CR de visite' });
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible de générer le PDF');
    }
  }

  return (
    <View style={styles.container}>
      <Header
        title={visite.title}
        subtitle={visite.date}
        showBack
        rightIcon={permissions.canExport ? 'download-outline' : undefined}
        onRightPress={permissions.canExport ? exportPDF : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <TouchableOpacity
              style={[styles.statusPill, { backgroundColor: cfg.color + '20', borderColor: cfg.color }]}
              onPress={permissions.canEdit ? cycleStatus : undefined}
            >
              <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
              {permissions.canEdit && <Ionicons name="chevron-forward" size={12} color={cfg.color} />}
            </TouchableOpacity>
            {permissions.canDelete && (
              <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
                <Ionicons name="trash-outline" size={16} color={C.open} />
                <Text style={styles.deleteBtnText}>Supprimer</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.infoGrid}>
            <View style={styles.infoItem}>
              <Ionicons name="person-outline" size={14} color={C.textMuted} />
              <View>
                <Text style={styles.infoLabel}>Conducteur</Text>
                <Text style={styles.infoVal}>{visite.conducteur}</Text>
              </View>
            </View>
            <View style={styles.infoItem}>
              <Ionicons name="calendar-outline" size={14} color={C.textMuted} />
              <View>
                <Text style={styles.infoLabel}>Date</Text>
                <Text style={styles.infoVal}>{visite.date}</Text>
              </View>
            </View>
            {visite.building && (
              <View style={styles.infoItem}>
                <Ionicons name="business-outline" size={14} color={C.textMuted} />
                <View>
                  <Text style={styles.infoLabel}>Localisation</Text>
                  <Text style={styles.infoVal}>Bât. {visite.building} — {visite.level}</Text>
                </View>
              </View>
            )}
          </View>

          {visite.notes ? (
            <View style={styles.notesBox}>
              <Text style={styles.notesLabel}>Notes</Text>
              <Text style={styles.notesText}>{visite.notes}</Text>
            </View>
          ) : null}
        </View>

        {tunnelData && (
          <View style={styles.tunnelCard}>
            <Text style={styles.tunnelTitle}>Progression du tunnel de réception</Text>
            <View style={styles.tunnelSteps}>
              {[
                { label: 'Visite', done: true, icon: 'eye-outline' as const, color: '#6366F1' },
                { label: 'Réserves', done: tunnelData.total > 0, icon: 'warning-outline' as const, color: C.open, sub: tunnelData.total > 0 ? `${tunnelData.total} relevée${tunnelData.total > 1 ? 's' : ''}` : 'Aucune' },
                { label: 'Levée', done: tunnelData.closed > 0, icon: 'checkmark-circle-outline' as const, color: C.closed, sub: tunnelData.total > 0 ? `${tunnelData.pctLevees}%` : '—' },
                { label: 'OPR', done: tunnelData.anyOpr, icon: 'document-text-outline' as const, color: C.inProgress, sub: tunnelData.anyOpr ? 'Créé' : 'En attente' },
                { label: 'PV signé', done: !!tunnelData.signedOpr, icon: 'ribbon-outline' as const, color: C.closed, sub: tunnelData.signedOpr ? `Le ${tunnelData.signedOpr.signedAt}` : 'Non signé' },
              ].map((step, i, arr) => (
                <View key={step.label} style={styles.tunnelStepWrap}>
                  <View style={[styles.tunnelStep, step.done && { backgroundColor: step.color + '15', borderColor: step.color + '50' }]}>
                    <Ionicons name={step.icon} size={16} color={step.done ? step.color : C.textMuted} />
                    <View>
                      <Text style={[styles.tunnelStepLabel, step.done && { color: step.color }]}>{step.label}</Text>
                      {step.sub && <Text style={[styles.tunnelStepSub, step.done && { color: step.color + 'CC' }]}>{step.sub}</Text>}
                    </View>
                    {step.done && <Ionicons name="checkmark" size={12} color={step.color} style={{ marginLeft: 'auto' }} />}
                  </View>
                  {i < arr.length - 1 && (
                    <View style={[styles.tunnelArrow, step.done && arr[i + 1].done && { backgroundColor: arr[i + 1].color }]} />
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Réserves de cette visite ({visiteReserves.length})</Text>
          {permissions.canCreate && (
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => router.push(`/reserve/new?visiteId=${visite.id}` as any)}
            >
              <Ionicons name="add" size={15} color={C.primary} />
              <Text style={styles.addBtnText}>Ajouter</Text>
            </TouchableOpacity>
          )}
        </View>

        {visiteReserves.length === 0 ? (
          <View style={styles.emptyReserves}>
            <Ionicons name="warning-outline" size={32} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucune réserve rattachée à cette visite</Text>
            <Text style={styles.emptySubText}>Les réserves créées avec cette visite apparaîtront ici</Text>
          </View>
        ) : (
          visiteReserves.map(r => {
            const sColor = RESERVE_STATUS_COLORS[r.status] ?? C.textMuted;
            const pColor = PRIORITY_COLORS[r.priority] ?? C.textMuted;
            return (
              <TouchableOpacity
                key={r.id}
                style={[styles.reserveCard, { borderLeftColor: sColor }]}
                onPress={() => router.push(`/reserve/${r.id}` as any)}
                activeOpacity={0.75}
              >
                <View style={styles.reserveHeader}>
                  <Text style={styles.reserveId}>{r.id}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: sColor + '20' }]}>
                    <Text style={[styles.statusBadgeText, { color: sColor }]}>{RESERVE_STATUS_LABELS[r.status] ?? r.status}</Text>
                  </View>
                </View>
                <Text style={styles.reserveTitle}>{r.title}</Text>
                <View style={styles.reserveMeta}>
                  <View style={[styles.priorityDot, { backgroundColor: pColor }]} />
                  <Text style={styles.reserveMetaText}>{PRIORITY_LABELS[r.priority] ?? r.priority}</Text>
                  <Text style={styles.reserveMetaDot}>·</Text>
                  <Text style={styles.reserveMetaText}>{r.company}</Text>
                  <Text style={styles.reserveMetaDot}>·</Text>
                  <Text style={styles.reserveMetaText}>Bât. {r.building}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        {permissions.canExport && (
          <TouchableOpacity style={styles.exportBtn} onPress={exportPDF}>
            <Ionicons name="document-text-outline" size={16} color={C.verification} />
            <Text style={styles.exportBtnText}>Exporter le compte-rendu PDF</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 100 },

  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  notFoundText: { fontSize: 16, fontFamily: 'Inter_500Medium', color: C.textSub },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  statusText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  deleteBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.open },

  infoGrid: { gap: 10 },
  infoItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  infoVal: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },

  notesBox: { marginTop: 12, backgroundColor: C.bg, borderRadius: 10, padding: 12, borderLeftWidth: 3, borderLeftColor: C.primary },
  notesLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  notesText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },

  emptyReserves: { alignItems: 'center', padding: 32, gap: 8, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, marginBottom: 16 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  emptySubText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center' },

  reserveCard: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 4, marginBottom: 10,
  },
  reserveHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  reserveId: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  reserveTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 6 },
  reserveMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  priorityDot: { width: 7, height: 7, borderRadius: 4 },
  reserveMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  reserveMetaDot: { fontSize: 12, color: C.textMuted },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.verification + '15', borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: C.verification + '30', marginTop: 8,
  },
  exportBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.verification },

  tunnelCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  tunnelTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 },
  tunnelSteps: { gap: 0 },
  tunnelStepWrap: { flexDirection: 'column' },
  tunnelStep: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface2, borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: C.border,
  },
  tunnelStepLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  tunnelStepSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  tunnelArrow: {
    width: 2, height: 10, backgroundColor: C.border,
    alignSelf: 'center', marginVertical: 2,
  },
});
