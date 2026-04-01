import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Platform,
  Modal,
  KeyboardAvoidingView,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, useMemo, useRef } from 'react';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { Opr, OprItem, OprSignatory, OprStatus } from '@/constants/types';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';
import SignaturePad, { SignaturePadRef } from '@/components/SignaturePad';
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

function buildOprPDF(opr: Opr, projectName: string): string {
  const statusIcons: Record<string, string> = { ok: '✓', reserve: '⚠', non_applicable: '—' };
  const statusColors: Record<string, string> = { ok: '#059669', reserve: '#DC2626', non_applicable: '#6B7280' };
  const statusBg: Record<string, string> = { ok: '#ECFDF5', reserve: '#FEF2F2', non_applicable: '#F9FAFB' };

  const rows = opr.items.map((item, idx) =>
    `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:12px">${item.lotName}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:12px">${item.description !== item.lotName ? item.description : '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        <span style="background:${statusBg[item.status]};color:${statusColors[item.status]};font-weight:700;font-size:12px;padding:3px 10px;border-radius:12px">${statusIcons[item.status]} ${ITEM_STATUS_CFG[item.status].label}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:12px;color:#6B7280">${item.status === 'reserve' ? (item.reserveId ?? '—') : '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:12px">${item.note ?? ''}</td>
    </tr>`
  ).join('');

  const totalOk = opr.items.filter(i => i.status === 'ok').length;
  const totalRes = opr.items.filter(i => i.status === 'reserve').length;
  const totalNA = opr.items.filter(i => i.status === 'non_applicable').length;
  const pctConformite = opr.items.length > 0 ? Math.round((totalOk / opr.items.length) * 100) : 0;
  const signedDate = opr.signedAt ?? opr.date;

  const signatureBlock = opr.status === 'signed' ? `
    <div style="margin-top:36px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
        <span style="background:#ECFDF5;color:#059669;font-weight:700;font-size:13px;padding:4px 14px;border-radius:20px">✓ PV signé électroniquement le ${signedDate}</span>
      </div>
      <div style="display:flex;gap:32px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px;background:#FAFBFF">
          <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Conducteur de travaux</div>
          ${opr.conducteurSignature
            ? `<img src="${opr.conducteurSignature}" style="width:100%;max-width:260px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
            : `<div style="height:60px;border-bottom:2px solid #1A2742;margin-bottom:6px"></div>`
          }
          <div style="font-size:13px;font-weight:700;color:#1A2742">${opr.conducteur}</div>
          <div style="font-size:11px;color:#8FA3B5;margin-top:2px">Signé le ${signedDate}</div>
        </div>
        <div style="flex:1;min-width:220px;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px;background:#FAFBFF">
          <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Maître d'ouvrage</div>
          ${opr.moSignature
            ? `<img src="${opr.moSignature}" style="width:100%;max-width:260px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
            : `<div style="height:60px;border-bottom:2px solid #1A2742;margin-bottom:6px"></div>`
          }
          <div style="font-size:13px;font-weight:700;color:#1A2742">${opr.maireOuvrage ?? '—'}</div>
          <div style="font-size:11px;color:#8FA3B5;margin-top:2px">Signé le ${signedDate}</div>
        </div>
      </div>
    </div>` : `
    <div style="margin-top:36px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div style="font-size:12px;font-weight:700;color:#5E738A;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:16px">Signatures</div>
      <div style="display:flex;gap:32px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px">
          <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Conducteur de travaux</div>
          <div style="height:80px;border-bottom:2px solid #1A2742;margin-bottom:6px"></div>
          <div style="font-size:13px;color:#1A2742">${opr.conducteur}</div>
        </div>
        <div style="flex:1;min-width:220px;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px">
          <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Maître d'ouvrage</div>
          <div style="height:80px;border-bottom:2px solid #1A2742;margin-bottom:6px"></div>
          <div style="font-size:13px;color:#1A2742">${opr.maireOuvrage ?? ''}</div>
        </div>
      </div>
    </div>`;

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
        <div style="font-size:22px;font-weight:800;color:#003082;letter-spacing:-0.3px">Procès-verbal de réception</div>
        <div style="font-size:14px;color:#5E738A;margin-top:4px">${opr.title}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:#8FA3B5">Réf. document</div>
        <div style="font-size:13px;font-weight:700;color:#1A2742">${opr.id}</div>
        <div style="font-size:11px;color:#8FA3B5;margin-top:4px">Date</div>
        <div style="font-size:13px;font-weight:700;color:#1A2742">${opr.date}</div>
      </div>
    </div>

    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:24px">
      <div style="flex:1;min-width:180px;background:#F4F7FB;border-radius:10px;padding:14px 16px">
        <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">Projet</div>
        <div style="font-size:14px;font-weight:700;color:#1A2742">${projectName}</div>
      </div>
      <div style="flex:1;min-width:140px;background:#F4F7FB;border-radius:10px;padding:14px 16px">
        <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">Localisation</div>
        <div style="font-size:14px;font-weight:700;color:#1A2742">Bât. ${opr.building} — ${opr.level}</div>
      </div>
      <div style="flex:1;min-width:140px;background:#F4F7FB;border-radius:10px;padding:14px 16px">
        <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">Conducteur</div>
        <div style="font-size:14px;font-weight:700;color:#1A2742">${opr.conducteur}</div>
      </div>
      ${opr.maireOuvrage ? `<div style="flex:1;min-width:140px;background:#F4F7FB;border-radius:10px;padding:14px 16px">
        <div style="font-size:10px;color:#8FA3B5;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px">Maître d'ouvrage</div>
        <div style="font-size:14px;font-weight:700;color:#1A2742">${opr.maireOuvrage}</div>
      </div>` : ''}
    </div>

    <div style="display:flex;gap:12px;margin-bottom:28px;flex-wrap:wrap">
      <div style="border:1.5px solid #DDE4EE;border-radius:10px;padding:12px 20px;text-align:center;min-width:100px">
        <div style="font-size:26px;font-weight:800;color:#059669">${totalOk}</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Conforme${totalOk > 1 ? 's' : ''}</div>
      </div>
      <div style="border:1.5px solid #DDE4EE;border-radius:10px;padding:12px 20px;text-align:center;min-width:100px">
        <div style="font-size:26px;font-weight:800;color:#DC2626">${totalRes}</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Réserve${totalRes > 1 ? 's' : ''}</div>
      </div>
      <div style="border:1.5px solid #DDE4EE;border-radius:10px;padding:12px 20px;text-align:center;min-width:100px">
        <div style="font-size:26px;font-weight:800;color:#6B7280">${totalNA}</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Non applicable</div>
      </div>
      <div style="border:2px solid #003082;border-radius:10px;padding:12px 20px;text-align:center;min-width:100px;background:#EEF3FA">
        <div style="font-size:26px;font-weight:800;color:#003082">${pctConformite}%</div>
        <div style="font-size:11px;color:#003082;margin-top:2px">Conformité</div>
      </div>
    </div>

    <div style="font-size:12px;font-weight:700;color:#5E738A;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Détail par lot</div>
    <table style="width:100%;border-collapse:collapse;border:1.5px solid #DDE4EE;border-radius:10px;overflow:hidden">
      <thead>
        <tr style="background:#003082">
          <th style="padding:10px 10px;text-align:left;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">LOT</th>
          <th style="padding:10px 10px;text-align:left;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">POINT DE CONTRÔLE</th>
          <th style="padding:10px 10px;text-align:center;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">STATUT</th>
          <th style="padding:10px 10px;text-align:left;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">N° RÉS.</th>
          <th style="padding:10px 10px;text-align:left;font-size:11px;color:#fff;font-weight:700;letter-spacing:0.4px">OBSERVATIONS</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${signatureBlock}

    <div style="margin-top:32px;padding-top:12px;border-top:1px solid #EEF3FA;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:10px;color:#8FA3B5">BuildTrack — Gestion de chantier</div>
      <div style="font-size:10px;color:#8FA3B5">Document généré le ${new Date().toLocaleDateString('fr-FR')}</div>
    </div>

  </div>
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
  const [signStep, setSignStep] = useState<'conducteur' | 'mo'>('conducteur');
  const [signConducteurName, setSignConducteurName] = useState('');
  const [signMoName, setSignMoName] = useState('');

  const conducteurPadRef = useRef<SignaturePadRef>(null);
  const moPadRef = useRef<SignaturePadRef>(null);

  const [inviteModal, setInviteModal] = useState<{ opr: Opr } | null>(null);
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  function addSignatory() {
    if (!inviteModal || !inviteName.trim()) return;
    const opr = inviteModal.opr;
    const newSig: OprSignatory = {
      id: genId(),
      name: inviteName.trim(),
      role: inviteRole.trim() || 'Participant',
      email: inviteEmail.trim() || undefined,
    };
    updateOpr({ ...opr, signatories: [...(opr.signatories ?? []), newSig] });
    setInviteName(''); setInviteRole(''); setInviteEmail('');
    setInviteModal(null);
  }

  function removeSignatory(opr: Opr, sigId: string) {
    Alert.alert('Retirer', 'Retirer ce signataire ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () =>
        updateOpr({ ...opr, signatories: (opr.signatories ?? []).filter(s => s.id !== sigId) })
      },
    ]);
  }

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

  async function shareOprLink(opr: Opr) {
    const base = Platform.OS === 'web' ? window.location.origin : process.env.EXPO_PUBLIC_APP_URL ?? 'https://buildtrack.app';
    const url = `${base}/opr-session/${opr.id}`;
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(url); Alert.alert('Lien copié', 'Partagez ce lien avec les signataires externes.'); } catch { Alert.alert('Lien de session', url); }
      return;
    }
    try {
      await Share.share({ message: `Accès à la session OPR "${opr.title}" :\n${url}`, url });
    } catch {}
  }

  async function exportOprPDF(opr: Opr) {
    const html = buildOprPDF(opr, projectName);
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
    setSignStep('conducteur');
    setSignModalOpr(opr);
  }

  async function confirmSign() {
    if (!signModalOpr) return;
    if (!signConducteurName.trim()) {
      Alert.alert('Nom requis', 'Veuillez saisir le nom du conducteur de travaux.');
      return;
    }
    if (!signMoName.trim()) {
      Alert.alert('Nom requis', "Veuillez saisir le nom du maître d'ouvrage.");
      return;
    }

    const conducteurSig = conducteurPadRef.current?.isEmpty() ? undefined : conducteurPadRef.current?.getSVGData() ?? undefined;
    const moSig = moPadRef.current?.isEmpty() ? undefined : moPadRef.current?.getSVGData() ?? undefined;

    if (!conducteurSig && !moSig) {
      Alert.alert('Signature requise', 'Veuillez apposer au moins une signature dessinée.');
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
      conducteurSignature: conducteurSig,
      moSignature: moSig,
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
                  <Text style={styles.oprMeta}>MO : {opr.maireOuvrage}</Text>
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
                  <TouchableOpacity style={[styles.actionBtn, { borderColor: '#8B5CF620', backgroundColor: '#F5F3FF' }]} onPress={() => shareOprLink(opr)}>
                    <Ionicons name="link-outline" size={14} color="#7C3AED" />
                    <Text style={[styles.actionBtnText, { color: '#7C3AED' }]}>Lien session</Text>
                  </TouchableOpacity>
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

                <View style={styles.signatoryPanel}>
                  <View style={styles.signatoryHeader}>
                    <Ionicons name="people-outline" size={13} color={C.textSub} />
                    <Text style={styles.signatoryTitle}>Signataires collaboratifs</Text>
                    {permissions.canEdit && opr.status !== 'signed' && (
                      <TouchableOpacity style={styles.inviteBtn} onPress={() => setInviteModal({ opr })}>
                        <Ionicons name="person-add-outline" size={12} color={C.primary} />
                        <Text style={styles.inviteBtnText}>Inviter</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {(opr.signatories ?? []).length === 0 ? (
                    <Text style={styles.signatoryEmpty}>Aucun signataire invité — appuyez sur "Inviter" pour ajouter des participants</Text>
                  ) : (
                    (opr.signatories ?? []).map(sig => (
                      <View key={sig.id} style={styles.signatoryRow}>
                        <View style={styles.signatoryAvatar}>
                          <Text style={styles.signatoryAvatarText}>{sig.name.slice(0, 1).toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.signatoryName}>{sig.name}</Text>
                          <Text style={styles.signatoryRole}>{sig.role}{sig.email ? ' · ' + sig.email : ''}</Text>
                        </View>
                        {sig.signedAt ? (
                          <View style={styles.sigSignedBadge}>
                            <Ionicons name="checkmark-circle" size={12} color={C.closed} />
                            <Text style={styles.sigSignedText}>{sig.signedAt}</Text>
                          </View>
                        ) : (
                          <View style={styles.sigPendingBadge}>
                            <Text style={styles.sigPendingText}>En attente</Text>
                          </View>
                        )}
                        {permissions.canDelete && (
                          <TouchableOpacity onPress={() => removeSignatory(opr, sig.id)} hitSlop={8}>
                            <Ionicons name="close" size={14} color={C.textMuted} />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <BottomNavBar />

      <Modal visible={inviteModal !== null} transparent animationType="slide" onRequestClose={() => setInviteModal(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.inviteOverlay}>
            <View style={styles.inviteSheet}>
              <View style={styles.modalHandle} />
              <Text style={styles.inviteTitle}>Inviter un signataire</Text>
              <Text style={styles.modalLabel}>Nom *</Text>
              <TextInput
                style={styles.input}
                placeholder="Prénom Nom"
                placeholderTextColor={C.textMuted}
                value={inviteName}
                onChangeText={setInviteName}
                autoFocus
              />
              <Text style={styles.modalLabel}>Rôle / Fonction</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: Maître d'œuvre, BET Structure…"
                placeholderTextColor={C.textMuted}
                value={inviteRole}
                onChangeText={setInviteRole}
              />
              <Text style={styles.modalLabel}>Email (optionnel)</Text>
              <TextInput
                style={styles.input}
                placeholder="prenom.nom@entreprise.fr"
                placeholderTextColor={C.textMuted}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <View style={styles.inviteActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setInviteModal(null); setInviteName(''); setInviteRole(''); setInviteEmail(''); }}>
                  <Text style={styles.cancelBtnText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.createBtn} onPress={addSignatory}>
                  <Ionicons name="person-add-outline" size={15} color="#fff" />
                  <Text style={styles.createBtnText}>Ajouter</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={signModalOpr !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSignModalOpr(null)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView
            style={styles.modalScrollWrap}
            contentContainerStyle={styles.modalSheet}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <Ionicons name="create-outline" size={20} color={C.primary} />
              <Text style={styles.modalTitle}>Signature électronique du PV</Text>
            </View>

            {signModalOpr && (
              <View style={styles.modalPvInfo}>
                <Text style={styles.modalPvTitle}>{signModalOpr.title}</Text>
                <Text style={styles.modalPvMeta}>Date : {signModalOpr.date} · Bât. {signModalOpr.building}</Text>
              </View>
            )}

            <View style={styles.signStepRow}>
              <TouchableOpacity
                style={[styles.signStepTab, signStep === 'conducteur' && styles.signStepTabActive]}
                onPress={() => setSignStep('conducteur')}
              >
                <Ionicons name="person-outline" size={14} color={signStep === 'conducteur' ? C.primary : C.textMuted} />
                <Text style={[styles.signStepTabText, signStep === 'conducteur' && { color: C.primary }]}>Conducteur</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.signStepTab, signStep === 'mo' && styles.signStepTabActive]}
                onPress={() => setSignStep('mo')}
              >
                <Ionicons name="business-outline" size={14} color={signStep === 'mo' ? C.primary : C.textMuted} />
                <Text style={[styles.signStepTabText, signStep === 'mo' && { color: C.primary }]}>Maître d'ouvrage</Text>
              </TouchableOpacity>
            </View>

            {signStep === 'conducteur' && (
              <View style={styles.signBlock}>
                <Text style={styles.modalLabel}>NOM COMPLET *</Text>
                <View style={styles.signInputWrap}>
                  <Ionicons name="person-outline" size={15} color={C.textMuted} />
                  <TextInput
                    style={styles.signInput}
                    value={signConducteurName}
                    onChangeText={setSignConducteurName}
                    placeholder="Votre nom complet..."
                    placeholderTextColor={C.textMuted}
                    autoCapitalize="words"
                  />
                </View>
                <Text style={styles.modalLabel}>SIGNATURE (dessiner ci-dessous)</Text>
                <View style={styles.padContainer}>
                  <SignaturePad ref={conducteurPadRef} />
                  <TouchableOpacity
                    style={styles.clearPadBtn}
                    onPress={() => conducteurPadRef.current?.clear()}
                  >
                    <Ionicons name="refresh-outline" size={13} color={C.textMuted} />
                    <Text style={styles.clearPadText}>Effacer</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.nextStepBtn} onPress={() => setSignStep('mo')}>
                  <Text style={styles.nextStepBtnText}>Suivant — Maître d'ouvrage</Text>
                  <Ionicons name="arrow-forward" size={15} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            {signStep === 'mo' && (
              <View style={styles.signBlock}>
                <Text style={styles.modalLabel}>NOM DU MAÎTRE D'OUVRAGE *</Text>
                <View style={styles.signInputWrap}>
                  <Ionicons name="business-outline" size={15} color={C.textMuted} />
                  <TextInput
                    style={styles.signInput}
                    value={signMoName}
                    onChangeText={setSignMoName}
                    placeholder="Nom du maître d'ouvrage..."
                    placeholderTextColor={C.textMuted}
                    autoCapitalize="words"
                  />
                </View>
                <Text style={styles.modalLabel}>SIGNATURE (dessiner ci-dessous)</Text>
                <View style={styles.padContainer}>
                  <SignaturePad ref={moPadRef} />
                  <TouchableOpacity
                    style={styles.clearPadBtn}
                    onPress={() => moPadRef.current?.clear()}
                  >
                    <Ionicons name="refresh-outline" size={13} color={C.textMuted} />
                    <Text style={styles.clearPadText}>Effacer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.signNotice}>
              <Ionicons name="shield-checkmark-outline" size={14} color={C.closed} />
              <Text style={styles.signNoticeText}>
                En signant, les deux parties confirment avoir vérifié tous les points de contrôle. Les signatures sont horodatées.
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setSignModalOpr(null)}>
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={confirmSign}>
                <Ionicons name="ribbon-outline" size={16} color="#fff" />
                <Text style={styles.modalConfirmText}>Valider les signatures</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
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
  label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
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

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', paddingHorizontal: 20 },
  emptyBtn: { marginTop: 8, backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 10 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  oprCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  oprHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  oprDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  oprTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  oprMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 2 },

  oprStats: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 10 },
  oprStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  oprStatText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  oprStatSep: { color: C.border, fontSize: 14 },

  itemsList: { gap: 1, marginBottom: 10, backgroundColor: C.bg, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, paddingHorizontal: 12,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  itemText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },

  oprActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  actionBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  signBtn: { borderColor: C.closed + '40', backgroundColor: C.closedBg },
  signedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  signedText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.closed },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalScrollWrap: { maxHeight: '92%' },
  modalSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40,
  },
  modalHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },

  modalPvInfo: { backgroundColor: C.bg, borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  modalPvTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  modalPvMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },

  signStepRow: { flexDirection: 'row', gap: 8, marginBottom: 16, backgroundColor: C.bg, borderRadius: 12, padding: 4 },
  signStepTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 9 },
  signStepTabActive: { backgroundColor: C.surface, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  signStepTabText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textMuted },

  signBlock: { gap: 8, marginBottom: 12 },
  modalLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5 },
  signInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  signInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },

  padContainer: { alignItems: 'center', gap: 6, marginBottom: 4 },
  clearPadBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearPadText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },

  nextStepBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, paddingVertical: 12, borderRadius: 10, marginTop: 4 },
  nextStepBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  signNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.closedBg, borderRadius: 10, padding: 12, marginVertical: 12 },
  signNoticeText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.closed, lineHeight: 18 },

  signatoryPanel: {
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border,
  },
  signatoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  signatoryTitle: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '30' },
  inviteBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  signatoryEmpty: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic', lineHeight: 16 },
  signatoryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  signatoryAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.primary + '20', alignItems: 'center', justifyContent: 'center' },
  signatoryAvatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary },
  signatoryName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  signatoryRole: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  sigSignedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.closedBg, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  sigSignedText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.closed },
  sigPendingBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: '#FEF3C7' },
  sigPendingText: { fontSize: 10, fontFamily: 'Inter_500Medium', color: '#92400E' },

  inviteOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  inviteSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  inviteTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 14 },
  inviteActions: { flexDirection: 'row', gap: 10, marginTop: 8 },

  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  modalCancelText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  modalConfirmBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, paddingVertical: 13, borderRadius: 12 },
  modalConfirmText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
