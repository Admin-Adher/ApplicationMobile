import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Modal, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Visite, Reserve, VisiteStatus, OprStatus } from '@/constants/types';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';
import SignaturePad, { SignaturePadRef } from '@/components/SignaturePad';

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
  const priorityColors: Record<string, string> = { low: '#22C55E', medium: '#F59E0B', high: '#EF4444', critical: '#7C3AED' };
  const priorityBg: Record<string, string> = { low: '#F0FDF4', medium: '#FFFBEB', high: '#FEF2F2', critical: '#F5F3FF' };
  const statusColor: Record<string, string> = { open: '#DC2626', in_progress: '#2563EB', waiting: '#D97706', verification: '#7C3AED', closed: '#059669' };
  const statusBg: Record<string, string> = { open: '#FEF2F2', in_progress: '#EFF6FF', waiting: '#FFFBEB', verification: '#F5F3FF', closed: '#ECFDF5' };

  const totalOpen = reserves.filter(r => r.status === 'open').length;
  const totalInProgress = reserves.filter(r => r.status === 'in_progress').length;
  const totalClosed = reserves.filter(r => r.status === 'closed').length;
  const totalCritical = reserves.filter(r => r.priority === 'critical' || r.priority === 'high').length;

  const criticalReserves = reserves.filter(r => r.priority === 'critical' || r.priority === 'high');
  const normalReserves = reserves.filter(r => r.priority !== 'critical' && r.priority !== 'high');
  const sortedReserves = [...criticalReserves, ...normalReserves];

  const rows = sortedReserves.map((r, idx) =>
    `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="padding:9px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:700;color:#5E738A;white-space:nowrap">${r.id}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #EEF3FA;font-size:12px;font-weight:600;color:#1A2742">${r.title}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #EEF3FA;font-size:12px;color:#5E738A;white-space:nowrap">Bât.${r.building} — ${r.level}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #EEF3FA;font-size:12px;color:#1A2742">${r.company}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        <span style="background:${priorityBg[r.priority]||'#F9FAFB'};color:${priorityColors[r.priority]||'#6B7280'};font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px">${PRIORITY_LABELS[r.priority]||r.priority}</span>
      </td>
      <td style="padding:9px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        <span style="background:${statusBg[r.status]||'#F9FAFB'};color:${statusColor[r.status]||'#6B7280'};font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px">${RESERVE_STATUS_LABELS[r.status]||r.status}</span>
      </td>
      <td style="padding:9px 10px;border-bottom:1px solid #EEF3FA;font-size:12px;color:#5E738A;white-space:nowrap">${r.deadline}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #1A2742; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
  </head><body>
  <div style="padding:32px 36px;max-width:860px;margin:0 auto">

    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:3px solid #003082;margin-bottom:24px">
      <div>
        <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Compte-rendu de visite de chantier</div>
        <div style="font-size:22px;font-weight:800;color:#003082;letter-spacing:-0.3px">${visite.title}</div>
        <div style="font-size:13px;color:#5E738A;margin-top:4px">${projectName}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:#8FA3B5">Réf.</div>
        <div style="font-size:13px;font-weight:700;color:#1A2742">${visite.id}</div>
        <div style="font-size:11px;color:#8FA3B5;margin-top:4px">Date de visite</div>
        <div style="font-size:14px;font-weight:800;color:#003082">${visite.date}</div>
      </div>
    </div>

    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px">
      <div style="flex:1;min-width:160px;background:#F4F7FB;border-radius:10px;padding:12px 16px">
        <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">Conducteur de travaux</div>
        <div style="font-size:14px;font-weight:700;color:#1A2742">${visite.conducteur}</div>
      </div>
      ${visite.building ? `<div style="flex:1;min-width:140px;background:#F4F7FB;border-radius:10px;padding:12px 16px">
        <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">Localisation</div>
        <div style="font-size:14px;font-weight:700;color:#1A2742">Bât. ${visite.building} — ${visite.level || ''}</div>
      </div>` : ''}
      <div style="flex:1;min-width:140px;background:#F4F7FB;border-radius:10px;padding:12px 16px">
        <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">Statut de la visite</div>
        <div style="font-size:14px;font-weight:700;color:#${visite.status === 'completed' ? '059669' : visite.status === 'in_progress' ? '2563EB' : '6366F1'}">${visite.status === 'completed' ? 'Terminée' : visite.status === 'in_progress' ? 'En cours' : 'Planifiée'}</div>
      </div>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
      <div style="border:1.5px solid #DDE4EE;border-radius:10px;padding:12px 18px;text-align:center;min-width:90px">
        <div style="font-size:28px;font-weight:800;color:#1A2742">${reserves.length}</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Relevées</div>
      </div>
      <div style="border:1.5px solid #FEE2E2;border-radius:10px;padding:12px 18px;text-align:center;min-width:90px;background:#FEF2F2">
        <div style="font-size:28px;font-weight:800;color:#DC2626">${totalOpen}</div>
        <div style="font-size:11px;color:#DC2626;margin-top:2px">Ouvertes</div>
      </div>
      <div style="border:1.5px solid #BFDBFE;border-radius:10px;padding:12px 18px;text-align:center;min-width:90px;background:#EFF6FF">
        <div style="font-size:28px;font-weight:800;color:#2563EB">${totalInProgress}</div>
        <div style="font-size:11px;color:#2563EB;margin-top:2px">En cours</div>
      </div>
      <div style="border:1.5px solid #A7F3D0;border-radius:10px;padding:12px 18px;text-align:center;min-width:90px;background:#ECFDF5">
        <div style="font-size:28px;font-weight:800;color:#059669">${totalClosed}</div>
        <div style="font-size:11px;color:#059669;margin-top:2px">Clôturées</div>
      </div>
      ${totalCritical > 0 ? `<div style="border:2px solid #DC2626;border-radius:10px;padding:12px 18px;text-align:center;min-width:90px;background:#FEF2F2">
        <div style="font-size:28px;font-weight:800;color:#DC2626">${totalCritical}</div>
        <div style="font-size:11px;color:#DC2626;margin-top:2px">Priorité haute</div>
      </div>` : ''}
    </div>

    ${visite.notes ? `
    <div style="margin-bottom:24px;background:#F4F7FB;border-left:4px solid #003082;border-radius:0 10px 10px 0;padding:14px 18px">
      <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">Observations du conducteur</div>
      <div style="font-size:13px;color:#1A2742;line-height:1.6">${visite.notes}</div>
    </div>` : ''}

    <div style="font-size:12px;font-weight:700;color:#5E738A;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">
      Liste des réserves relevées (${reserves.length})
      ${totalCritical > 0 ? '<span style="font-size:11px;background:#FEF2F2;color:#DC2626;padding:2px 10px;border-radius:10px;margin-left:8px;font-weight:700">⚠ Triées par priorité</span>' : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;border:1.5px solid #DDE4EE;border-radius:10px;overflow:hidden">
      <thead>
        <tr style="background:#003082">
          <th style="padding:10px;text-align:left;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">ID</th>
          <th style="padding:10px;text-align:left;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">TITRE</th>
          <th style="padding:10px;text-align:left;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">LIEU</th>
          <th style="padding:10px;text-align:left;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">ENTREPRISE</th>
          <th style="padding:10px;text-align:center;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">PRIORITÉ</th>
          <th style="padding:10px;text-align:center;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">STATUT</th>
          <th style="padding:10px;text-align:left;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">ÉCHÉANCE</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="7" style="padding:20px;text-align:center;color:#8FA3B5;font-size:13px">Aucune réserve rattachée à cette visite</td></tr>`}</tbody>
    </table>

    <div style="margin-top:36px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div style="display:flex;gap:32px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px">
          <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Conducteur de travaux</div>
          ${visite.conducteurSignature
            ? `<img src="${visite.conducteurSignature}" style="height:70px;width:100%;object-fit:contain;border-bottom:2px solid #1A2742;margin-bottom:8px;display:block" />`
            : `<div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>`
          }
          <div style="font-size:13px;color:#1A2742">${visite.conducteur}</div>
          <div style="font-size:11px;color:#8FA3B5;margin-top:2px">Date : ${visite.signedAt ?? visite.date}</div>
        </div>
        <div style="flex:1;min-width:200px;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px">
          <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Lu et approuvé — Entreprise(s)</div>
          ${visite.entrepriseSignature
            ? `<img src="${visite.entrepriseSignature}" style="height:70px;width:100%;object-fit:contain;border-bottom:2px solid #1A2742;margin-bottom:8px;display:block" />`
            : `<div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>`
          }
          <div style="font-size:13px;color:#1A2742">${visite.entrepriseSignataire ?? '&nbsp;'}</div>
          <div style="font-size:11px;color:#8FA3B5;margin-top:2px">Date : ${visite.signedAt ?? '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</div>
        </div>
      </div>
    </div>

    <div style="margin-top:28px;padding-top:12px;border-top:1px solid #EEF3FA;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:10px;color:#8FA3B5">BuildTrack — Gestion de chantier</div>
      <div style="font-size:10px;color:#8FA3B5">Document généré le ${new Date().toLocaleDateString('fr-FR')}</div>
    </div>

  </div>
  </body></html>`;
}

export default function VisiteDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { visites, reserves, updateVisite, deleteVisite, activeChantier, oprs } = useApp();
  const { permissions } = useAuth();
  const { useSettings } = require('@/context/SettingsContext');
  const { projectName } = useSettings();

  const [signModalVisible, setSignModalVisible] = useState(false);
  const [signingTab, setSigningTab] = useState<'conducteur' | 'entreprise'>('conducteur');
  const [entrepriseSignataire, setEntrepriseSignataire] = useState('');
  const [isSigning, setIsSigning] = useState(false);
  const conducteurSigRef = useRef<SignaturePadRef>(null);
  const entrepriseSigRef = useRef<SignaturePadRef>(null);

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

  async function handleSaveSignature() {
    if (isSigning) return;
    setIsSigning(true);
    try {
      const conducteurSig = conducteurSigRef.current?.getSVGData() ?? visite!.conducteurSignature ?? null;
      const entrepriseSig = entrepriseSigRef.current?.getSVGData() ?? visite!.entrepriseSignature ?? null;
      const today = new Date().toLocaleDateString('fr-FR');
      updateVisite({
        ...visite!,
        conducteurSignature: conducteurSig ?? undefined,
        entrepriseSignature: entrepriseSig ?? undefined,
        signedAt: today,
        entrepriseSignataire: entrepriseSignataire.trim() || visite!.entrepriseSignataire,
        status: 'completed',
      });
      setSignModalVisible(false);
      Alert.alert('PV signé', 'Les signatures ont été enregistrées. Le PV peut maintenant être exporté en PDF.');
    } finally {
      setIsSigning(false);
    }
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

        {permissions.canEdit && (
          <TouchableOpacity
            style={[styles.signBtn, visite.signedAt && styles.signBtnSigned]}
            onPress={() => setSignModalVisible(true)}
          >
            <Ionicons
              name={visite.signedAt ? 'checkmark-circle' : 'pencil-outline'}
              size={16}
              color={visite.signedAt ? C.closed : C.primary}
            />
            <Text style={[styles.signBtnText, visite.signedAt && styles.signBtnTextSigned]}>
              {visite.signedAt ? `PV signé le ${visite.signedAt}` : 'Signer le PV de visite'}
            </Text>
          </TouchableOpacity>
        )}

        {permissions.canExport && (
          <TouchableOpacity style={styles.exportBtn} onPress={exportPDF}>
            <Ionicons name="document-text-outline" size={16} color={C.verification} />
            <Text style={styles.exportBtnText}>Exporter le compte-rendu PDF</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={signModalVisible} transparent animationType="slide" onRequestClose={() => setSignModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.signModal}>
            <View style={styles.signModalHeader}>
              <Text style={styles.signModalTitle}>Signature du PV de visite</Text>
              <TouchableOpacity onPress={() => setSignModalVisible(false)}>
                <Ionicons name="close" size={22} color={C.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.signTabs}>
              <TouchableOpacity
                style={[styles.signTab, signingTab === 'conducteur' && styles.signTabActive]}
                onPress={() => setSigningTab('conducteur')}
              >
                <Ionicons name="person-outline" size={13} color={signingTab === 'conducteur' ? C.primary : C.textSub} />
                <Text style={[styles.signTabText, signingTab === 'conducteur' && styles.signTabTextActive]}>
                  Conducteur
                </Text>
                {visite.conducteurSignature && <Ionicons name="checkmark-circle" size={12} color={C.closed} />}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.signTab, signingTab === 'entreprise' && styles.signTabActive]}
                onPress={() => setSigningTab('entreprise')}
              >
                <Ionicons name="business-outline" size={13} color={signingTab === 'entreprise' ? C.primary : C.textSub} />
                <Text style={[styles.signTabText, signingTab === 'entreprise' && styles.signTabTextActive]}>
                  Entreprise
                </Text>
                {visite.entrepriseSignature && <Ionicons name="checkmark-circle" size={12} color={C.closed} />}
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.signModalContent}>
              {signingTab === 'conducteur' ? (
                <View style={styles.signSection}>
                  <Text style={styles.signSectionLabel}>Conducteur de travaux</Text>
                  <Text style={styles.signSectionName}>{visite.conducteur}</Text>
                  <Text style={styles.signInstruction}>Signez dans le cadre ci-dessous :</Text>
                  <SignaturePad ref={conducteurSigRef} />
                  <TouchableOpacity style={styles.clearBtn} onPress={() => conducteurSigRef.current?.clear()}>
                    <Ionicons name="refresh-outline" size={14} color={C.textSub} />
                    <Text style={styles.clearBtnText}>Effacer</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.signSection}>
                  <Text style={styles.signSectionLabel}>Représentant de l'entreprise</Text>
                  <TextInput
                    style={styles.signNameInput}
                    placeholder="Nom et prénom du signataire..."
                    placeholderTextColor={C.textMuted}
                    value={entrepriseSignataire}
                    onChangeText={setEntrepriseSignataire}
                  />
                  <Text style={styles.signInstruction}>Signez dans le cadre ci-dessous :</Text>
                  <SignaturePad ref={entrepriseSigRef} />
                  <TouchableOpacity style={styles.clearBtn} onPress={() => entrepriseSigRef.current?.clear()}>
                    <Ionicons name="refresh-outline" size={14} color={C.textSub} />
                    <Text style={styles.clearBtnText}>Effacer</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.saveSignBtn, isSigning && { opacity: 0.6 }]}
              onPress={handleSaveSignature}
              disabled={isSigning}
            >
              {isSigning ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
              )}
              <Text style={styles.saveSignBtnText}>
                {isSigning ? 'Enregistrement…' : 'Valider les signatures'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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

  signBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary + '15', borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: C.primary + '40', marginTop: 0, marginBottom: 10,
  },
  signBtnSigned: {
    backgroundColor: C.closed + '10', borderColor: C.closed + '40',
  },
  signBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  signBtnTextSigned: { color: C.closed },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end',
  },
  signModal: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '90%', paddingBottom: 34,
  },
  signModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 18, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  signModalTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  signTabs: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border,
  },
  signTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  signTabActive: { borderBottomColor: C.primary },
  signTabText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  signTabTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  signModalContent: { padding: 18, paddingBottom: 8 },
  signSection: { gap: 10 },
  signSectionLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  signSectionName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  signInstruction: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  signNameInput: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
  },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end',
    paddingVertical: 4, paddingHorizontal: 10,
  },
  clearBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  saveSignBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, marginHorizontal: 18, marginTop: 12, borderRadius: 14,
    paddingVertical: 14,
  },
  saveSignBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
});
