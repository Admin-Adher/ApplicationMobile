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
import { C } from '@/constants/colors';
import {
  exportPDF as exportPDFHelper,
  loadPhotoAsDataUrl,
  buildLetterhead,
  buildInfoGrid,
  buildKpiRow,
  buildDocFooter,
  wrapHTML,
} from '@/lib/pdfBase';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { Opr, OprItem, OprSignatory, OprStatus, Reserve } from '@/constants/types';
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
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:700">${item.lotName}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${item.description !== item.lotName ? item.description : '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        <span style="background:${statusBg[item.status]};color:${statusColors[item.status]};font-weight:700;font-size:11px;padding:3px 10px;border-radius:12px">${statusIcons[item.status]} ${ITEM_STATUS_CFG[item.status].label}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${item.status === 'reserve' ? (item.reserveId ?? '—') : '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${item.note ?? ''}</td>
    </tr>`
  ).join('');

  const totalOk = opr.items.filter(i => i.status === 'ok').length;
  const totalRes = opr.items.filter(i => i.status === 'reserve').length;
  const totalNA = opr.items.filter(i => i.status === 'non_applicable').length;
  const pctConformite = opr.items.length > 0 ? Math.round((totalOk / opr.items.length) * 100) : 0;
  const signedDate = opr.signedAt ?? opr.date;
  const today = new Date().toLocaleDateString('fr-FR');

  const sigBlockHtml = opr.status === 'signed'
    ? `<div class="section-header">Signatures électroniques</div>
       <div class="alert alert-success">✓ PV signé électroniquement le ${signedDate}</div>
       <div class="sig-row">
         <div class="sig-block">
           <div class="sig-label">Conducteur de travaux</div>
           ${opr.conducteurSignature
             ? `<img src="${opr.conducteurSignature}" style="width:100%;max-width:260px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
             : '<div class="sig-line"></div>'
           }
           <div class="sig-name">${opr.conducteur}</div>
           <div class="sig-date">Signé le ${signedDate}</div>
         </div>
         <div class="sig-block">
           <div class="sig-label">Maître d'ouvrage</div>
           ${opr.moSignature
             ? `<img src="${opr.moSignature}" style="width:100%;max-width:260px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
             : '<div class="sig-line"></div>'
           }
           <div class="sig-name">${opr.maireOuvrage ?? '—'}</div>
           <div class="sig-date">Signé le ${signedDate}</div>
         </div>
       </div>`
    : `<div class="section-header">Signatures</div>
       <div class="sig-row">
         <div class="sig-block">
           <div class="sig-label">Conducteur de travaux</div>
           <div class="sig-line"></div>
           <div class="sig-name">${opr.conducteur}</div>
           <div class="sig-date">Date : _______________</div>
         </div>
         <div class="sig-block">
           <div class="sig-label">Maître d'ouvrage</div>
           <div class="sig-line"></div>
           <div class="sig-name">${opr.maireOuvrage ?? ''}</div>
           <div class="sig-date">Date : _______________</div>
         </div>
       </div>`;

  const infoItems = [
    { label: 'Localisation', value: `Bât. ${opr.building} — ${opr.level}` },
    { label: 'Conducteur de travaux', value: opr.conducteur },
    ...(opr.maireOuvrage ? [{ label: "Maître d'ouvrage", value: opr.maireOuvrage }] : []),
    { label: 'Date de réception', value: opr.date },
  ];

  const body = `
    ${buildLetterhead('Procès-verbal de réception', opr.title, opr.id, today, projectName)}
    ${buildInfoGrid(infoItems)}
    ${buildKpiRow([
      { val: totalOk, label: 'Conforme' + (totalOk > 1 ? 's' : ''), color: '#059669' },
      { val: totalRes, label: 'Réserve' + (totalRes > 1 ? 's' : ''), color: '#DC2626' },
      { val: totalNA, label: 'Non applicable', color: '#6B7280' },
      { val: `${pctConformite}%`, label: 'Conformité', color: '#003082' },
    ])}
    <div class="section-header">Détail par lot</div>
    <table>
      <thead>
        <tr>
          <th>LOT</th>
          <th>POINT DE CONTRÔLE</th>
          <th style="text-align:center">STATUT</th>
          <th>N° RÉS.</th>
          <th>OBSERVATIONS</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5" style="padding:14px;text-align:center;color:#059669">Aucun point de contrôle</td></tr>'}</tbody>
    </table>
    ${sigBlockHtml}
    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, `PV de réception — ${opr.title}`);
}

async function buildPvLeveePDF(opr: Opr, reserves: Reserve[], projectName: string): Promise<string> {
  const dateShort = new Date().toLocaleDateString('fr-FR');
  const docRef = `PVL-${opr.id}-${dateShort.replace(/\//g, '')}`;

  const reserveItems = opr.items.filter(i => i.status === 'reserve');
  const totalReserves = reserveItems.length;

  const linked = reserveItems.map(item => {
    const reserve = item.reserveId ? reserves.find(r => r.id === item.reserveId) : undefined;
    return { item, reserve };
  });
  const leveed = linked.filter(({ reserve }) => reserve?.status === 'closed');
  const pending = linked.filter(({ reserve }) => !reserve || reserve.status !== 'closed');

  const photoData: Record<string, { defect?: string; resolution?: string }> = {};
  await Promise.all(
    leveed.map(async ({ reserve }) => {
      if (!reserve?.photos?.length) return;
      const defectPhoto = reserve.photos.find(p => p.kind === 'defect');
      const resolutionPhoto = reserve.photos.find(p => p.kind === 'resolution');
      const [dSrc, rSrc] = await Promise.all([
        defectPhoto ? loadPhotoAsDataUrl(defectPhoto.uri) : Promise.resolve(''),
        resolutionPhoto ? loadPhotoAsDataUrl(resolutionPhoto.uri) : Promise.resolve(''),
      ]);
      photoData[reserve.id] = { defect: dSrc || undefined, resolution: rSrc || undefined };
    })
  );

  const rows = reserveItems.map((item, idx) => {
    const reserve = item.reserveId ? reserves.find(r => r.id === item.reserveId) : undefined;
    const isLevee = reserve?.status === 'closed';
    return `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-weight:700;font-size:11px">${item.lotName}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#003082;font-weight:700">${item.reserveId ?? '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${item.description !== item.lotName ? item.description : (reserve?.title ?? '—')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        ${isLevee
          ? '<span style="background:#ECFDF5;color:#059669;font-weight:700;padding:3px 10px;border-radius:12px;font-size:10px">✓ Levée</span>'
          : '<span style="background:#FEF2F2;color:#DC2626;font-weight:700;padding:3px 10px;border-radius:12px;font-size:10px">⚠ En attente</span>'}
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#059669">${reserve?.closedAt ?? '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${reserve?.closedBy ?? '—'}</td>
    </tr>`;
  }).join('');

  const leveedWithPhotos = leveed.filter(({ reserve }) => reserve && photoData[reserve.id] && (photoData[reserve.id].defect || photoData[reserve.id].resolution));
  const photoSection = leveedWithPhotos.length > 0 ? `
    <div class="section-header">Photographies — Avant / Après levée</div>
    ${leveedWithPhotos.map(({ item, reserve }) => {
      if (!reserve) return '';
      const photos = photoData[reserve.id];
      return `<div style="margin-bottom:20px;page-break-inside:avoid">
        <div style="font-size:11px;font-weight:700;color:#1A2742;margin-bottom:8px;background:#F4F7FB;padding:6px 10px;border-radius:6px">${item.lotName} — ${reserve.title}</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          ${photos.defect ? `<div style="text-align:center"><img src="${photos.defect}" style="width:200px;height:140px;object-fit:cover;border-radius:8px;border:2px solid #FCA5A5" /><div style="font-size:10px;color:#DC2626;font-weight:700;margin-top:4px">🔴 Constat initial</div></div>` : ''}
          ${photos.resolution ? `<div style="text-align:center"><img src="${photos.resolution}" style="width:200px;height:140px;object-fit:cover;border-radius:8px;border:2px solid #6EE7B7" /><div style="font-size:10px;color:#059669;font-weight:700;margin-top:4px">🟢 Levée constatée</div></div>` : ''}
        </div>
      </div>`;
    }).join('')}
  ` : '';

  const conducteurSigHtml = opr.conducteurSignature
    ? `<img src="${opr.conducteurSignature}" style="width:100%;max-width:240px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
    : '<div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>';
  const moSigHtml = opr.moSignature
    ? `<img src="${opr.moSignature}" style="width:100%;max-width:240px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:6px" />`
    : '<div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>';

  const signatureBlock = `
    <div style="margin-top:36px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div class="section-header">Certification de levée des réserves</div>
      <div class="alert alert-info" style="margin-bottom:20px">
        Les soussignés certifient avoir procédé à la vérification des réserves émises lors du procès-verbal de réception référencé <strong>${opr.id}</strong> et attestent que les réserves indiquées comme « Levée » ont été régulièrement exécutées et conformes aux prescriptions contractuelles.
      </div>
      <div class="sig-row">
        <div class="sig-block">
          <div class="sig-label">Conducteur de travaux</div>
          ${conducteurSigHtml}
          <div class="sig-name">${opr.conducteur}</div>
          <div class="sig-date">Date : ${dateShort}</div>
        </div>
        <div class="sig-block">
          <div class="sig-label">Maître d'ouvrage</div>
          ${moSigHtml}
          <div class="sig-name">${opr.maireOuvrage ?? '—'}</div>
          <div class="sig-date">Date : ${dateShort}</div>
        </div>
      </div>
    </div>`;

  const infoItems = [
    { label: 'Référence OPR', value: opr.id },
    { label: 'Date réception', value: opr.date },
    { label: 'Localisation', value: `Bât. ${opr.building} — ${opr.level}` },
    { label: 'Conducteur', value: opr.conducteur },
    ...(opr.maireOuvrage ? [{ label: "Maître d'ouvrage", value: opr.maireOuvrage }] : []),
  ];

  const body = `
    ${buildLetterhead('Procès-Verbal de Levée de Réserves', opr.title, docRef, dateShort, projectName)}
    ${buildInfoGrid(infoItems)}
    ${buildKpiRow([
      { val: totalReserves, label: 'Réserves au PV', color: '#003082' },
      { val: leveed.length, label: 'Levées', color: '#059669' },
      { val: pending.length, label: 'En attente', color: pending.length > 0 ? '#DC2626' : '#059669' },
      { val: totalReserves > 0 ? Math.round((leveed.length / totalReserves) * 100) + '%' : '—', label: 'Taux de levée', color: '#003082' },
    ])}
    ${pending.length === 0
      ? '<div class="alert alert-success">✅ Toutes les réserves ont été levées — La réception est définitive.</div>'
      : `<div class="alert alert-warning">⚠️ <strong>${pending.length} réserve${pending.length > 1 ? 's' : ''} en attente</strong> — La réception définitive ne peut être prononcée qu'après levée de l'ensemble des réserves.</div>`
    }
    <div class="section-header">Tableau récapitulatif des réserves par lot</div>
    <table>
      <thead>
        <tr>
          <th>LOT</th>
          <th>RÉSERVE</th>
          <th>DESCRIPTION</th>
          <th style="text-align:center">STATUT</th>
          <th>DATE LEVÉE</th>
          <th>LEVÉE PAR</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#059669;padding:14px">Aucune réserve — Réception sans réserve</td></tr>'}</tbody>
    </table>
    ${photoSection}
    ${signatureBlock}
    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, `PV de Levée — ${opr.id}`);
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
    try {
      const html = buildOprPDF(opr, projectName);
      await exportPDFHelper(html, `PV ${opr.id}`);
    } catch (e: any) {
      Alert.alert('Erreur PDF', e?.message ?? '');
    }
  }

  async function exportLeveePDF(opr: Opr) {
    try {
      const html = await buildPvLeveePDF(opr, reserves, projectName);
      await exportPDFHelper(html, `PV Levée ${opr.id}`);
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
                      <Text style={[styles.actionBtnText, { color: C.primary }]}>PV Réception</Text>
                    </TouchableOpacity>
                  )}
                  {permissions.canExport && opr.items.some(i => i.status === 'reserve') && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: C.closed + '40', backgroundColor: C.closedBg }]}
                      onPress={() => exportLeveePDF(opr)}
                    >
                      <Ionicons name="checkmark-done-outline" size={14} color={C.closed} />
                      <Text style={[styles.actionBtnText, { color: C.closed }]}>PV Levée</Text>
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
