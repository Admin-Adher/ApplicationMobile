import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Platform, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, useMemo } from 'react';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { Opr, OprItem, OprStatus } from '@/constants/types';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';
import { genId } from '@/lib/utils';
import { RESERVE_BUILDINGS, RESERVE_LEVELS } from '@/lib/reserveUtils';

const ITEM_STATUS_CFG = {
  ok: { label: 'Conforme', color: C.closed, icon: 'checkmark-circle' },
  reserve: { label: 'Réserve', color: C.open, icon: 'warning' },
  non_applicable: { label: 'N/A', color: C.textMuted, icon: 'remove-circle-outline' },
};

const DEFAULT_OPR_ITEMS = [
  'Gros œuvre / Structure',
  'Couverture / Étanchéité',
  'Menuiseries extérieures',
  'Menuiseries intérieures',
  'Plâtrerie / Doublage',
  'Carrelage / Revêtements sol',
  'Peinture / Finitions',
  'Plomberie sanitaire',
  'Chauffage / VMC',
  'Électricité courants forts',
  'Courants faibles',
  'Espaces extérieurs',
];

function buildOprPDF(opr: Opr, projectName: string, lots: any[]): string {
  const lotMap: Record<string, string> = {};
  lots.forEach(l => { lotMap[l.id] = l.name; });

  const statusIcons: Record<string, string> = { ok: '✓', reserve: '⚠', non_applicable: '—' };
  const statusColors: Record<string, string> = { ok: '#10B981', reserve: '#EF4444', non_applicable: '#6B7280' };
  const rows = opr.items.map(item =>
    `<tr>
      <td>${item.lotName}</td>
      <td>${item.description}</td>
      <td style="color:${statusColors[item.status]};font-weight:bold;text-align:center">${statusIcons[item.status]}</td>
      <td>${item.status === 'reserve' ? (item.reserveId ?? '—') : '—'}</td>
      <td>${item.note ?? ''}</td>
    </tr>`
  ).join('');

  const totalOk = opr.items.filter(i => i.status === 'ok').length;
  const totalRes = opr.items.filter(i => i.status === 'reserve').length;
  const totalNA = opr.items.filter(i => i.status === 'non_applicable').length;

  const signedDate = opr.signedAt ?? opr.date;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 30px; color: #111; }
    h1 { color: #1A6FD8; font-size: 20px; }
    h2 { color: #333; font-size: 15px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 24px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
    th { background: #1A6FD8; color: white; padding: 7px; text-align: left; }
    td { padding: 5px 7px; border-bottom: 1px solid #eee; }
    .kpi { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
    .kpi-card { border: 1px solid #ccc; border-radius: 8px; padding: 10px 16px; text-align: center; }
    .kpi-val { font-size: 22px; font-weight: bold; color: #1A6FD8; }
    .kpi-label { font-size: 11px; color: #666; }
    .sign-section { margin-top: 40px; display: flex; gap: 40px; }
    .sign-box { flex: 1; border-top: 2px solid #333; padding-top: 8px; }
    .sign-label { font-size: 12px; color: #666; }
    .sign-name { font-size: 13px; font-weight: bold; margin-top: 4px; }
    .sign-date { font-size: 11px; color: #888; margin-top: 2px; font-style: italic; }
    .status-signed { background: #D1FAE5; border: 1px solid #10B981; border-radius: 8px; padding: 8px 14px; display: inline-block; color: #065F46; font-weight: bold; font-size: 13px; }
    .sign-typed { background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 6px; padding: 4px 10px; display: inline-block; color: #1E40AF; font-weight: bold; font-size: 14px; font-style: italic; letter-spacing: 0.5px; }
  </style></head><body>
  <h1>Procès-verbal de réception — ${opr.title}</h1>
  <p class="meta">
    Projet : ${projectName} &nbsp;|&nbsp;
    Date : ${opr.date} &nbsp;|&nbsp;
    Localisation : Bât. ${opr.building} — ${opr.level}<br>
    Conducteur : ${opr.conducteur}
    ${opr.maireOuvrage ? ` &nbsp;|&nbsp; Maître d'ouvrage : ${opr.maireOuvrage}` : ''}
  </p>
  <div class="kpi">
    <div class="kpi-card"><div class="kpi-val" style="color:#10B981">${totalOk}</div><div class="kpi-label">Conforme</div></div>
    <div class="kpi-card"><div class="kpi-val" style="color:#EF4444">${totalRes}</div><div class="kpi-label">Réserve(s)</div></div>
    <div class="kpi-card"><div class="kpi-val" style="color:#6B7280">${totalNA}</div><div class="kpi-label">Non applicable</div></div>
  </div>
  <h2>Détail par lot</h2>
  <table>
    <thead><tr><th>Lot</th><th>Point de contrôle</th><th>Statut</th><th>N° Réserve</th><th>Observations</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${opr.status === 'signed' ? `
  <h2>Signatures électroniques</h2>
  <div class="sign-section">
    <div class="sign-box">
      <div class="sign-typed">${opr.conducteur}</div>
      <div class="sign-name" style="margin-top:8px">${opr.conducteur}</div>
      <div class="sign-label">Conducteur de travaux</div>
      <div class="sign-date">Signé électroniquement le ${signedDate}</div>
    </div>
    <div class="sign-box">
      <div class="sign-typed">${opr.maireOuvrage ?? '—'}</div>
      <div class="sign-name" style="margin-top:8px">${opr.maireOuvrage ?? '—'}</div>
      <div class="sign-label">Maître d'ouvrage</div>
      <div class="sign-date">Signé électroniquement le ${signedDate}</div>
    </div>
  </div>
  <p style="margin-top:16px"><span class="status-signed">✓ PV signé électroniquement le ${signedDate}</span></p>
  ` : `
  <h2>Signatures</h2>
  <div class="sign-section">
    <div class="sign-box">
      <div class="sign-name">&nbsp;</div>
      <div class="sign-label">Conducteur de travaux : ${opr.conducteur}</div>
    </div>
    <div class="sign-box">
      <div class="sign-name">&nbsp;</div>
      <div class="sign-label">Maître d'ouvrage${opr.maireOuvrage ? ' : ' + opr.maireOuvrage : ''}</div>
    </div>
  </div>
  `}
  </body></html>`;
}

export default function OprScreen() {
  const router = useRouter();
  const { oprs, addOpr, updateOpr, deleteOpr, lots, reserves, activeChantierId, activeChantier } = useApp();
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();

  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }));
  const [building, setBuilding] = useState(RESERVE_BUILDINGS[0]);
  const [level, setLevel] = useState('RDC');
  const [maireOuvrage, setMaireOuvrage] = useState('');

  const [signModalOpr, setSignModalOpr] = useState<Opr | null>(null);
  const [signConducteurName, setSignConducteurName] = useState('');
  const [signMoName, setSignMoName] = useState('');

  const chantierOprs = useMemo(
    () => oprs.filter(o => !activeChantierId || o.chantierId === activeChantierId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [oprs, activeChantierId]
  );

  function createOpr() {
    if (!title.trim()) { Alert.alert('Champ requis', 'Titre obligatoire.'); return; }
    const items: OprItem[] = DEFAULT_OPR_ITEMS.map(desc => ({
      id: genId(),
      lotName: desc,
      description: desc,
      status: 'ok' as const,
    }));
    const opr: Opr = {
      id: 'OPR-' + genId().slice(0, 8).toUpperCase(),
      chantierId: activeChantierId ?? 'chan1',
      title: title.trim(),
      date,
      building,
      level,
      conducteur: user?.name ?? 'Conducteur',
      status: 'draft',
      items,
      maireOuvrage: maireOuvrage.trim() || undefined,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    addOpr(opr);
    setTitle('');
    setMaireOuvrage('');
    setShowNew(false);
  }

  async function exportOprPDF(opr: Opr) {
    const html = buildOprPDF(opr, projectName, lots);
    if (Platform.OS === 'web') {
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
      return;
    }
    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Partager le PV' });
    } catch (e: any) {
      Alert.alert('Erreur PDF', e?.message ?? '');
    }
  }

  function openSignModal(opr: Opr) {
    setSignConducteurName(opr.conducteur ?? user?.name ?? '');
    setSignMoName(opr.maireOuvrage ?? '');
    setSignModalOpr(opr);
  }

  function confirmSign() {
    if (!signModalOpr) return;
    if (!signConducteurName.trim()) {
      Alert.alert('Signature requise', 'Veuillez saisir le nom du conducteur de travaux.');
      return;
    }
    if (!signMoName.trim()) {
      Alert.alert('Signature requise', "Veuillez saisir le nom du maître d'ouvrage.");
      return;
    }
    const now = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    updateOpr({
      ...signModalOpr,
      status: 'signed',
      conducteur: signConducteurName.trim(),
      maireOuvrage: signMoName.trim(),
      signedBy: signConducteurName.trim(),
      signedAt: now,
    });
    setSignModalOpr(null);
  }

  function cycleItemStatus(opr: Opr, itemId: string) {
    const order: Array<'ok' | 'reserve' | 'non_applicable'> = ['ok', 'reserve', 'non_applicable'];
    const updated = opr.items.map(item => {
      if (item.id !== itemId) return item;
      const idx = order.indexOf(item.status);
      return { ...item, status: order[(idx + 1) % order.length] };
    });
    updateOpr({ ...opr, items: updated });
  }

  const STATUS_ORDER: Record<OprStatus, number> = { draft: 0, in_progress: 1, signed: 2 };
  const STATUS_CFG: Record<OprStatus, { label: string; color: string }> = {
    draft: { label: 'Brouillon', color: C.textMuted },
    in_progress: { label: 'En cours', color: C.inProgress },
    signed: { label: 'Signé', color: C.closed },
  };

  return (
    <View style={styles.container}>
      <Header
        title="OPR / Réception"
        subtitle={`${chantierOprs.length} procès-verbal${chantierOprs.length !== 1 ? 'x' : ''}`}
        showBack
        rightIcon={permissions.canCreate ? 'add-circle-outline' : undefined}
        onRightPress={permissions.canCreate ? () => setShowNew(v => !v) : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {showNew && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Nouveau procès-verbal de réception</Text>

            <Text style={styles.label}>Titre *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: OPR Bâtiment A — Réception R+1"
              placeholderTextColor={C.textMuted}
              value={title}
              onChangeText={setTitle}
            />

            <Text style={styles.label}>Maître d'ouvrage</Text>
            <TextInput
              style={styles.input}
              placeholder="Nom du maître d'ouvrage"
              placeholderTextColor={C.textMuted}
              value={maireOuvrage}
              onChangeText={setMaireOuvrage}
            />

            <Text style={styles.label}>Bâtiment</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {RESERVE_BUILDINGS.map(b => (
                  <TouchableOpacity
                    key={b}
                    style={[styles.chip, building === b && styles.chipActive]}
                    onPress={() => setBuilding(b)}
                  >
                    <Text style={[styles.chipText, building === b && styles.chipTextActive]}>Bât. {b}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={[styles.label, { marginTop: 10 }]}>Niveau</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {RESERVE_LEVELS.map(l => (
                  <TouchableOpacity
                    key={l}
                    style={[styles.chip, level === l && styles.chipActive]}
                    onPress={() => setLevel(l)}
                  >
                    <Text style={[styles.chipText, level === l && styles.chipTextActive]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowNew(false)}>
                <Text style={styles.cancelBtnText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.createBtn} onPress={createOpr}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.createBtnText}>Créer le PV</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {chantierOprs.length === 0 && !showNew ? (
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={40} color={C.textMuted} />
            <Text style={styles.emptyTitle}>Aucun procès-verbal</Text>
            <Text style={styles.emptyText}>Créez un OPR pour formaliser la réception de chantier</Text>
            {permissions.canCreate && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowNew(true)}>
                <Text style={styles.emptyBtnText}>Créer un PV</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          chantierOprs.map(opr => {
            const cfg = STATUS_CFG[opr.status];
            const countOk = opr.items.filter(i => i.status === 'ok').length;
            const countRes = opr.items.filter(i => i.status === 'reserve').length;
            return (
              <View key={opr.id} style={styles.oprCard}>
                <View style={styles.oprHeader}>
                  <View style={[styles.statusBadge, { backgroundColor: cfg.color + '20' }]}>
                    <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                  <Text style={styles.oprDate}>{opr.date}</Text>
                </View>

                <Text style={styles.oprTitle}>{opr.title}</Text>
                <Text style={styles.oprMeta}>Bât. {opr.building} — {opr.level} · {opr.conducteur}</Text>
                {opr.maireOuvrage ? (
                  <Text style={styles.oprMeta}>Maître d'ouvrage : {opr.maireOuvrage}</Text>
                ) : null}

                <View style={styles.oprStats}>
                  <View style={styles.oprStat}>
                    <Ionicons name="checkmark-circle" size={13} color={C.closed} />
                    <Text style={[styles.oprStatText, { color: C.closed }]}>{countOk} conforme{countOk !== 1 ? 's' : ''}</Text>
                  </View>
                  <View style={styles.oprStat}>
                    <Ionicons name="warning" size={13} color={C.open} />
                    <Text style={[styles.oprStatText, { color: C.open }]}>{countRes} réserve{countRes !== 1 ? 's' : ''}</Text>
                  </View>
                  <Text style={styles.oprStatSep}>·</Text>
                  <Text style={styles.oprStatText}>{opr.items.length} points</Text>
                </View>

                <View style={styles.itemsList}>
                  {opr.items.map(item => {
                    const icfg = ITEM_STATUS_CFG[item.status];
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.itemRow}
                        onPress={permissions.canEdit && opr.status !== 'signed' ? () => cycleItemStatus(opr, item.id) : undefined}
                        activeOpacity={opr.status !== 'signed' ? 0.7 : 1}
                      >
                        <Ionicons name={icfg.icon as any} size={16} color={icfg.color} />
                        <Text style={styles.itemText}>{item.lotName}</Text>
                        {opr.status !== 'signed' && (
                          <Ionicons name="chevron-forward" size={12} color={C.textMuted} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.oprActions}>
                  {permissions.canExport && (
                    <TouchableOpacity style={styles.actionBtn} onPress={() => exportOprPDF(opr)}>
                      <Ionicons name="download-outline" size={14} color={C.primary} />
                      <Text style={[styles.actionBtnText, { color: C.primary }]}>PDF</Text>
                    </TouchableOpacity>
                  )}
                  {permissions.canEdit && opr.status !== 'signed' && (
                    <TouchableOpacity style={[styles.actionBtn, styles.signBtn]} onPress={() => openSignModal(opr)}>
                      <Ionicons name="create-outline" size={14} color={C.closed} />
                      <Text style={[styles.actionBtnText, { color: C.closed }]}>Signer le PV</Text>
                    </TouchableOpacity>
                  )}
                  {opr.status === 'signed' && (
                    <View style={styles.signedBadge}>
                      <Ionicons name="checkmark-circle" size={14} color={C.closed} />
                      <Text style={styles.signedText}>PV signé le {opr.signedAt}</Text>
                    </View>
                  )}
                  {permissions.canDelete && (
                    <TouchableOpacity
                      onPress={() => Alert.alert('Supprimer', `Supprimer "${opr.title}" ?`, [
                        { text: 'Annuler', style: 'cancel' },
                        { text: 'Supprimer', style: 'destructive', onPress: () => deleteOpr(opr.id) },
                      ])}
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={15} color={C.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <BottomNavBar />

      <Modal
        visible={signModalOpr !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSignModalOpr(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <Ionicons name="create-outline" size={20} color={C.closed} />
              <Text style={styles.modalTitle}>Signature électronique du PV</Text>
            </View>

            {signModalOpr && (
              <View style={styles.modalPvInfo}>
                <Text style={styles.modalPvTitle}>{signModalOpr.title}</Text>
                <Text style={styles.modalPvMeta}>Date : {signModalOpr.date} · Bât. {signModalOpr.building}</Text>
              </View>
            )}

            <Text style={styles.modalLabel}>CONDUCTEUR DE TRAVAUX *</Text>
            <View style={styles.signInputWrap}>
              <Ionicons name="person-outline" size={15} color={C.textMuted} />
              <TextInput
                style={styles.signInput}
                value={signConducteurName}
                onChangeText={setSignConducteurName}
                placeholder="Saisir votre nom complet..."
                placeholderTextColor={C.textMuted}
                autoCapitalize="words"
              />
            </View>

            <Text style={styles.modalLabel}>MAÎTRE D'OUVRAGE *</Text>
            <View style={styles.signInputWrap}>
              <Ionicons name="person-circle-outline" size={15} color={C.textMuted} />
              <TextInput
                style={styles.signInput}
                value={signMoName}
                onChangeText={setSignMoName}
                placeholder="Nom du maître d'ouvrage..."
                placeholderTextColor={C.textMuted}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.signNotice}>
              <Ionicons name="shield-checkmark-outline" size={14} color={C.closed} />
              <Text style={styles.signNoticeText}>
                En signant, vous confirmez avoir vériqué tous les points de contrôle. Cette signature est horodatée et lie les deux parties.
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setSignModalOpr(null)}>
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={confirmSign}>
                <Ionicons name="checkmark-circle" size={16} color="#fff" />
                <Text style={styles.modalConfirmText}>Signer le PV</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 100 },

  formCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  formTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 12 },
  label: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, marginBottom: 6 },
  input: {
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, marginBottom: 10,
  },
  chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 4, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: C.border },
  chipActive: { borderColor: C.primary, backgroundColor: C.primary + '15' },
  chipText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  chipTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  createBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.primary, paddingVertical: 11, borderRadius: 10 },
  createBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center' },
  emptyBtn: { backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  oprCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  oprHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  oprDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  oprTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  oprMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 2 },

  oprStats: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, marginTop: 8 },
  oprStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  oprStatText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  oprStatSep: { color: C.textMuted, marginHorizontal: 2 },

  itemsList: { gap: 4, marginBottom: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  itemText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },

  oprActions: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  actionBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  signBtn: { borderColor: C.closed + '40', backgroundColor: C.closed + '10' },
  signedBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  signedText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.closed },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 36, paddingTop: 14,
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 18 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  modalPvInfo: { backgroundColor: C.closed + '10', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: C.closed + '30' },
  modalPvTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  modalPvMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  modalLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  signInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1.5, borderColor: C.border, marginBottom: 14,
  },
  signInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: C.text },
  signNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.closed + '10', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.closed + '30', marginBottom: 20,
  },
  signNoticeText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18 },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  modalCancelText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: C.textSub },
  modalConfirmBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: C.closed, paddingVertical: 13, borderRadius: 12 },
  modalConfirmText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
});
