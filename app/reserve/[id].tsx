import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, Image, Modal, ActivityIndicator, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo, useRef } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { Reserve, ReservePriority, ReserveStatus, ReservePhoto } from '@/constants/types';
import {
  loadPhotoAsDataUrl,
  exportPDF as exportPDFHelper,
  buildPhotoGrid,
  PDF_BASE_CSS,
  PDF_MUTED,
  PDF_BRAND_COLOR,
} from '@/lib/pdfBase';
import StatusBadge, { STATUS_CONFIG } from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { uploadPhoto } from '@/lib/storage';
import { genId } from '@/lib/utils';
import {
  RESERVE_BUILDINGS, RESERVE_ZONES, RESERVE_LEVELS, RESERVE_PRIORITIES,
  isOverdue, formatDate, validateDeadline,
} from '@/lib/reserveUtils';
import SignaturePad, { SignaturePadRef } from '@/components/SignaturePad';
import { PhotoAnnotationOverlay } from '@/components/PhotoAnnotator';

const STATUS_ORDER: ReserveStatus[] = ['open', 'in_progress', 'waiting', 'verification', 'closed'];

const PRIORITY_LABEL = Object.fromEntries(
  RESERVE_PRIORITIES.map(p => [p.value, p.label])
) as Record<ReservePriority, string>;

function ChipSelect<T extends string>({
  options, value, onChange, colorFn, labelMap,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  colorFn?: (v: T) => string;
  labelMap?: Partial<Record<T, string>>;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
      <View style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
        {options.map(opt => {
          const col = colorFn ? colorFn(opt) : C.primary;
          const active = value === opt;
          return (
            <TouchableOpacity
              key={opt}
              style={[mStyles.chip, active && { borderColor: col, backgroundColor: col + '20' }]}
              onPress={() => onChange(opt)}
            >
              <Text style={[mStyles.chipText, active && { color: col }]}>
                {labelMap?.[opt] ?? opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

const PRIORITY_COLORS: Record<string, string> = {
  low: '#22C55E', medium: '#F59E0B', high: '#F97316', critical: '#EF4444',
};

function buildReservePDF(reserve: Reserve, projectName: string, company: { color?: string } | undefined, resolvedPhotoSrcs?: string[]): string {
  const statusColors: Record<string, string> = {
    open: '#DC2626', in_progress: '#F59E0B', waiting: '#3B82F6',
    verification: '#8B5CF6', closed: '#059669',
  };
  const statusLabels: Record<string, string> = {
    open: 'Ouverte', in_progress: 'En cours', waiting: 'En attente',
    verification: 'Vérification', closed: 'Clôturée',
  };
  const priorityLabels: Record<string, string> = {
    low: 'Faible', medium: 'Moyenne', high: 'Haute', critical: 'Critique',
  };
  const priorityColors: Record<string, string> = {
    low: '#22C55E', medium: '#F59E0B', high: '#F97316', critical: '#EF4444',
  };

  const sColor = statusColors[reserve.status] ?? '#6B7280';
  const sLabel = statusLabels[reserve.status] ?? reserve.status;
  const pColor = priorityColors[reserve.priority] ?? '#6B7280';
  const pLabel = priorityLabels[reserve.priority] ?? reserve.priority;

  const rawPhotos = reserve.photos && reserve.photos.length > 0
    ? reserve.photos
    : reserve.photoUri
      ? [{ id: 'legacy', uri: reserve.photoUri, kind: 'defect' as const, takenAt: reserve.createdAt, takenBy: '' }]
      : [];

  const photoSection = rawPhotos.length > 0
    ? buildPhotoGrid(
        rawPhotos.slice(0, 6).map((p, i) => ({
          src: resolvedPhotoSrcs?.[i] ?? p.uri,
          badge: p.kind === 'defect' ? '🔴 Constat' : '🟢 Levée',
          badgeColor: p.kind === 'defect' ? '#FEF2F2' : '#ECFDF5',
          badgeTextColor: p.kind === 'defect' ? '#DC2626' : '#059669',
          caption: [
            p.takenBy ? `Par ${p.takenBy}` : '',
            p.takenAt ? `le ${p.takenAt}` : '',
            (p.annotations ?? []).length > 0 ? `${(p.annotations ?? []).length} annotation(s)` : '',
          ].filter(Boolean).join(' · '),
        }))
      )
    : '';

  const gpsSection = (reserve as any).gpsLat
    ? `<div style="margin-top:8px;padding:10px 14px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;font-size:12px;color:#166534">
        📍 <strong>Coordonnées GPS :</strong> ${parseFloat((reserve as any).gpsLat).toFixed(6)}, ${parseFloat((reserve as any).gpsLon).toFixed(6)}
      </div>`
    : '';

  const historyRows = [...reserve.history].reverse().slice(0, 8).map(h =>
    `<tr>
      <td style="padding:7px 10px;font-size:11px;border-bottom:1px solid #EEF3FA">${h.createdAt}</td>
      <td style="padding:7px 10px;font-size:11px;border-bottom:1px solid #EEF3FA;font-weight:600">${h.action}</td>
      <td style="padding:7px 10px;font-size:11px;border-bottom:1px solid #EEF3FA;color:#6B7280">${h.author}</td>
      ${h.oldValue && h.newValue ? `<td style="padding:7px 10px;font-size:10px;color:#6B7280;border-bottom:1px solid #EEF3FA">${h.oldValue} → ${h.newValue}</td>` : '<td></td>'}
    </tr>`
  ).join('');

  const commentsSection = reserve.comments.length > 0
    ? `<div style="margin-top:20px">
        <div class="section-header">Commentaires</div>
        ${reserve.comments.slice(-5).map(c =>
          `<div style="background:#F9FAFB;border-radius:8px;padding:10px;margin-bottom:8px;border-left:3px solid #1A6FD8">
            <div style="font-size:10px;color:#5E738A;margin-bottom:4px"><strong>${c.author}</strong> · ${c.createdAt}</div>
            <div style="font-size:12px;color:#1A2742">${c.content}</div>
          </div>`
        ).join('')}
      </div>`
    : '';

  const sigSection = reserve.enterpriseSignature
    ? `<div style="margin-top:24px;padding-top:20px;border-top:2px solid #EEF3FA">
        <div class="section-header">Signature de levée</div>
        <div style="border:1.5px solid #DDE4EE;border-radius:10px;padding:16px;display:inline-block;background:#FAFBFF">
          <div style="font-size:10px;color:#5E738A;margin-bottom:8px">Signataire : <strong>${reserve.enterpriseSignataire ?? 'N/A'}</strong></div>
          <img src="${reserve.enterpriseSignature}" style="width:240px;height:80px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:8px" />
          ${reserve.enterpriseAcknowledgedAt ? `<div style="font-size:10px;color:#059669">✓ Levée reconnue le ${reserve.enterpriseAcknowledgedAt}</div>` : ''}
        </div>
      </div>`
    : `<div style="margin-top:24px;padding-top:20px;border-top:2px solid #EEF3FA">
        <div class="section-header">Zone de signature</div>
        <div style="display:flex;gap:40px">
          <div style="text-align:center">
            <div style="height:70px;width:220px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>
            <div style="font-size:11px;color:#5E738A">Conducteur de travaux</div>
          </div>
          <div style="text-align:center">
            <div style="height:70px;width:220px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>
            <div style="font-size:11px;color:#5E738A">${reserve.company}</div>
          </div>
        </div>
      </div>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <title>Fiche réserve ${reserve.id}</title>
  <style>${PDF_BASE_CSS}
    .reserve-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${PDF_BRAND_COLOR}; padding-bottom: 18px; margin-bottom: 22px; }
    .reserve-id { font-size: 26px; font-weight: 900; color: ${PDF_BRAND_COLOR}; }
    .status-badge { display: inline-block; padding: 4px 14px; border-radius: 18px; font-weight: 700; font-size: 12px; }
    .priority-badge { display: inline-block; padding: 3px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .info-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 18px 0; }
    .info-item { background: #F9FAFB; border-radius: 10px; padding: 12px 16px; }
    .info-label { font-size: 10px; font-weight: 700; color: ${PDF_MUTED}; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
    .info-value { font-size: 13px; color: #1A2742; font-weight: 600; }
    .desc-box { background: #F9FAFB; border-radius: 10px; padding: 14px 18px; margin-top: 16px; border-left: 4px solid ${PDF_BRAND_COLOR}; }
  </style></head>
  <body>
  <div class="container">
    <div class="reserve-header">
      <div>
        <div style="font-size:9px;color:${PDF_MUTED};text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Fiche de réserve</div>
        <div class="reserve-id">${reserve.id}</div>
        <div style="font-size:16px;font-weight:700;color:#1A2742;margin-top:4px">${reserve.title}</div>
        <div style="font-size:12px;color:${PDF_MUTED};margin-top:2px">${projectName}</div>
        <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
          <span class="status-badge" style="background:${sColor}22;color:${sColor}">${sLabel}</span>
          <span class="priority-badge" style="background:${pColor}18;color:${pColor}">${pLabel}</span>
          ${reserve.kind === 'observation' ? '<span class="priority-badge" style="background:#0EA5E915;color:#0EA5E9">Observation</span>' : ''}
        </div>
      </div>
      <div style="text-align:right;font-size:11px;color:${PDF_MUTED}">
        <div>Créé le <strong style="color:#1A2742">${reserve.createdAt}</strong></div>
        ${reserve.closedAt ? `<div style="color:#059669;margin-top:4px;font-weight:700">✓ Clôturé le ${reserve.closedAt}</div>` : ''}
        <div style="margin-top:6px">Échéance : <strong style="color:${reserve.closedAt ? '#059669' : '#DC2626'}">${reserve.deadline}</strong></div>
      </div>
    </div>

    <div class="info-grid-2">
      <div class="info-item">
        <div class="info-label">Entreprise</div>
        <div class="info-value" style="color:${company?.color ?? PDF_BRAND_COLOR}">${reserve.company}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Localisation</div>
        <div class="info-value">Bât. ${reserve.building} · ${reserve.level} · ${reserve.zone}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Créé par</div>
        <div class="info-value">${reserve.history[0]?.author ?? 'N/A'}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Photos</div>
        <div class="info-value">${rawPhotos.length} photo${rawPhotos.length !== 1 ? 's' : ''} attachée${rawPhotos.length !== 1 ? 's' : ''}</div>
      </div>
    </div>

    ${gpsSection}

    <div class="desc-box">
      <div class="section-header" style="margin-top:0;border:none;padding:0;margin-bottom:8px">Description</div>
      <div style="font-size:13px;line-height:1.6;color:#1A2742">${reserve.description}</div>
    </div>

    ${photoSection}

    ${commentsSection}

    ${reserve.history.length > 0 ? `
      <div class="section-header">Historique (${Math.min(reserve.history.length, 8)} dernières actions)</div>
      <table>
        <thead><tr><th>Date</th><th>Action</th><th>Auteur</th><th>Détail</th></tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    ` : ''}

    ${sigSection}

    <div class="doc-footer">
      <span>Fiche réserve générée par BuildTrack — ${projectName}</span>
      <span>Document confidentiel — ${new Date().toLocaleDateString('fr-FR')}</span>
    </div>
  </div>
  </body></html>`;
}

export default function ReserveDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { reserves, tasks, updateReserveStatus, updateReserveFields, deleteReserve, addComment, companies, channels, addPhoto } = useApp();
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();
  const [comment, setComment] = useState('');
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [photoFullScreen, setPhotoFullScreen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [signatureModalVisible, setSignatureModalVisible] = useState(false);
  const [signataireName, setSignataireName] = useState('');
  const sigPadRef = useRef<SignaturePadRef>(null);
  const [annotatorPhoto, setAnnotatorPhoto] = useState<ReservePhoto | null>(null);
  const [editPhotos, setEditPhotos] = useState<ReservePhoto[]>([]);
  const [editPhotoUploading, setEditPhotoUploading] = useState(false);

  const reserve = reserves.find(r => r.id === id);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editBuilding, setEditBuilding] = useState<string>(reserve?.building ?? RESERVE_BUILDINGS[0]);
  const [editZone, setEditZone] = useState<string>(RESERVE_ZONES[0]);
  const [editLevel, setEditLevel] = useState<string>('RDC');
  const [editCompany, setEditCompany] = useState('');
  const [editPriority, setEditPriority] = useState<ReservePriority>('medium');
  const [editDeadline, setEditDeadline] = useState('');

  const overdue = useMemo(
    () => reserve ? isOverdue(reserve.deadline, reserve.status) : false,
    [reserve]
  );

  if (!reserve) {
    return (
      <View style={styles.container}>
        <Header title="Réserve introuvable" showBack />
        <View style={styles.notFound}>
          <Ionicons name="search-outline" size={48} color={C.textMuted} />
          <Text style={styles.notFoundText}>Réserve non trouvée</Text>
        </View>
      </View>
    );
  }

  const allPhotos: ReservePhoto[] = reserve.photos && reserve.photos.length > 0
    ? reserve.photos
    : reserve.photoUri
      ? [{ id: 'legacy', uri: reserve.photoUri, kind: 'defect', takenAt: reserve.createdAt, takenBy: '' }]
      : [];

  const defectCount = allPhotos.filter(p => p.kind === 'defect').length;
  const resolutionCount = allPhotos.filter(p => p.kind === 'resolution').length;

  const company = companies.find(c => c.name === reserve.company);
  const companyChannel = company ? channels.find(ch => ch.id === `company-${company.id}`) : null;

  function openEdit() {
    if (!reserve) return;
    setEditTitle(reserve.title);
    setEditDescription(reserve.description);
    setEditBuilding(reserve.building);
    setEditZone(reserve.zone);
    setEditLevel(reserve.level);
    setEditCompany(reserve.company);
    setEditPriority(reserve.priority);
    setEditDeadline(reserve.deadline === '—' ? '' : reserve.deadline);
    setEditPhotos(reserve.photos ?? (reserve.photoUri ? [{ id: 'legacy', uri: reserve.photoUri, kind: 'defect', takenAt: reserve.createdAt, takenBy: '' }] : []));
    setEditModalVisible(true);
  }

  function handleSignatureSave() {
    if (!reserve) return;
    if (sigPadRef.current?.isEmpty()) {
      Alert.alert('Signature requise', 'Veuillez apposer votre signature avant de valider.');
      return;
    }
    const dataUrl = sigPadRef.current?.getSVGData() ?? null;
    if (!dataUrl) return;
    const today = new Date().toISOString().slice(0, 10);
    const author = user?.name ?? 'Conducteur de travaux';
    const updated: Reserve = {
      ...reserve,
      enterpriseSignature: dataUrl,
      enterpriseSignataire: signataireName.trim() || author,
      enterpriseAcknowledgedAt: reserve.enterpriseAcknowledgedAt ?? today,
      history: [...reserve.history, {
        id: `h${Date.now()}`,
        action: 'Levée signée',
        author: signataireName.trim() || author,
        createdAt: today,
      }],
    };
    updateReserveFields(updated);
    setSignatureModalVisible(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  }

  function handleEnterpriseAck() {
    if (!reserve) return;
    Alert.alert(
      'Accuser réception',
      `Confirmer que vous avez bien pris connaissance de la réserve ${reserve.id} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: () => {
            const today = new Date().toISOString().slice(0, 10);
            const author = user?.name ?? 'Entreprise';
            const updated: Reserve = {
              ...reserve,
              enterpriseAcknowledgedAt: reserve.enterpriseAcknowledgedAt ?? today,
              history: [...reserve.history, {
                id: `h${Date.now()}`,
                action: 'Réception accusée',
                author,
                createdAt: today,
              }],
            };
            updateReserveFields(updated);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2500);
          },
        },
      ]
    );
  }

  function handleAnnotationSave(photoId: string, annotations: any[]) {
    if (!reserve) return;
    const updatedPhotos: ReservePhoto[] = allPhotos.map(p =>
      p.id === photoId ? { ...p, annotations } : p
    );
    updateReserveFields({ ...reserve, photos: updatedPhotos });
    setAnnotatorPhoto(null);
  }

  async function handleAddEditPhoto(fromCamera = false) {
    if (editPhotos.length >= 6) { Alert.alert('Limite atteinte', 'Maximum 6 photos par réserve.'); return; }
    if (fromCamera) {
      if (Platform.OS === 'web') { Alert.alert('Info', 'La prise de photo directe est disponible sur mobile.'); return; }
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à l'appareil photo est nécessaire."); return; }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
      if (!result.canceled && result.assets[0]) await saveEditPhoto(result.assets[0].uri);
    } else {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à la galerie est nécessaire."); return; }
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
      if (!result.canceled && result.assets[0]) await saveEditPhoto(result.assets[0].uri);
    }
  }

  async function saveEditPhoto(uri: string) {
    setEditPhotoUploading(true);
    try {
      const filename = `reserve_photo_${Date.now()}.jpg`;
      const storageUrl = await uploadPhoto(uri, filename);
      const finalUri = storageUrl ?? uri;
      const today = new Date().toISOString().slice(0, 10);
      const newPhoto: ReservePhoto = { id: genId(), uri: finalUri, kind: 'defect', takenAt: today, takenBy: user?.name ?? '' };
      setEditPhotos(prev => [...prev, newPhoto]);
    } catch {
      const today = new Date().toISOString().slice(0, 10);
      const newPhoto: ReservePhoto = { id: genId(), uri, kind: 'defect', takenAt: today, takenBy: user?.name ?? '' };
      setEditPhotos(prev => [...prev, newPhoto]);
    } finally {
      setEditPhotoUploading(false);
    }
  }

  function toggleEditPhotoKind(photoId: string) {
    setEditPhotos(prev => prev.map(p => p.id === photoId ? { ...p, kind: p.kind === 'defect' ? 'resolution' : 'defect' } : p));
  }

  function removeEditPhoto(photoId: string) {
    setEditPhotos(prev => prev.filter(p => p.id !== photoId));
  }

  function buildChangeSummary(r: Reserve): { label: string; oldVal: string; newVal: string }[] {
    const changes: { label: string; oldVal: string; newVal: string }[] = [];
    if (editTitle.trim() !== r.title) changes.push({ label: 'Titre', oldVal: r.title, newVal: editTitle.trim() });
    if (editBuilding !== r.building) changes.push({ label: 'Bâtiment', oldVal: r.building, newVal: editBuilding });
    if (editZone !== r.zone) changes.push({ label: 'Zone', oldVal: r.zone, newVal: editZone });
    if (editLevel !== r.level) changes.push({ label: 'Niveau', oldVal: r.level, newVal: editLevel });
    if (editCompany !== r.company) changes.push({ label: 'Entreprise', oldVal: r.company, newVal: editCompany });
    if (editPriority !== r.priority) changes.push({ label: 'Priorité', oldVal: PRIORITY_LABEL[r.priority], newVal: PRIORITY_LABEL[editPriority] });
    const newDl = editDeadline || '—';
    if (newDl !== r.deadline) changes.push({ label: 'Échéance', oldVal: r.deadline, newVal: newDl });
    return changes;
  }

  function handleSaveEdit() {
    if (!reserve) return;
    if (!editTitle.trim()) {
      Alert.alert('Champ obligatoire', 'Le titre est requis.');
      return;
    }
    if (editDeadline && !validateDeadline(editDeadline)) {
      Alert.alert('Date invalide', "Vérifiez que le jour, le mois et l'année sont corrects (ex : 30/04/2026).");
      return;
    }
    const author = user?.name ?? 'Conducteur de travaux';
    const today = new Date().toISOString().slice(0, 10);
    const changes = buildChangeSummary(reserve);
    const historyEntry = {
      id: `h${Date.now()}`,
      action: 'Réserve modifiée',
      author,
      createdAt: today,
      oldValue: changes.length > 0 ? changes.map(c => c.oldVal).join(', ') : undefined,
      newValue: changes.length > 0 ? changes.map(c => c.newVal).join(', ') : undefined,
    };
    const updated: Reserve = {
      ...reserve,
      title: editTitle.trim(),
      description: editDescription.trim() || reserve.description,
      building: editBuilding,
      zone: editZone,
      level: editLevel,
      company: editCompany,
      priority: editPriority,
      deadline: editDeadline || '—',
      photoUri: editPhotos[0]?.uri ?? undefined,
      photos: editPhotos.length > 0 ? editPhotos : undefined,
      history: changes.length > 0 ? [...reserve.history, historyEntry] : reserve.history,
    };
    updateReserveFields(updated);
    editPhotos.forEach(p => {
      addPhoto({
        id: genId(),
        comment: `Photo réserve ${reserve.id} — ${editTitle.trim()}`,
        location: `Bât. ${editBuilding} - ${editLevel}`,
        takenAt: today,
        takenBy: author,
        colorCode: '#EF4444',
        uri: p.uri,
      });
    });
    setEditModalVisible(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  }

  async function handleExportPDF() {
    if (!reserve) return;
    if (!permissions.canExport) return;
    try {
      const rawPhotos = reserve.photos && reserve.photos.length > 0
        ? reserve.photos
        : reserve.photoUri
          ? [{ id: 'legacy', uri: reserve.photoUri, kind: 'defect' as const, takenAt: reserve.createdAt, takenBy: '' }]
          : [];
      const resolvedSrcs = await Promise.all(rawPhotos.slice(0, 6).map(p => loadPhotoAsDataUrl(p.uri)));
      const html = buildReservePDF(reserve, projectName, company, resolvedSrcs);
      await exportPDFHelper(html, `Fiche ${reserve.id}`);
    } catch {
      Alert.alert('Erreur', "Impossible de générer le PDF.");
    }
  }

  function handleDelete() {
    if (!reserve) return;
    Alert.alert(
      'Supprimer la réserve',
      `Supprimer définitivement ${reserve.id} — "${reserve.title}" ?\n\nCette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            deleteReserve(reserve.id);
            router.back();
          },
        },
      ]
    );
  }

  function handleContactCompany() {
    if (!reserve) return;
    if (!companyChannel) {
      Alert.alert('Canal indisponible', `Le canal de "${reserve.company}" n'existe pas encore. Ajoutez d'abord l'entreprise dans l'onglet Équipes.`);
      return;
    }
    router.push({
      pathname: '/channel/[id]',
      params: {
        id: companyChannel.id,
        name: companyChannel.name,
        color: companyChannel.color,
        icon: companyChannel.icon,
        isDM: '0',
        isGroup: '0',
        members: '',
      },
    } as any);
  }

  function handleStatusChange(newStatus: ReserveStatus) {
    if (!reserve) return;
    updateReserveStatus(reserve.id, newStatus, user?.name ?? 'Conducteur de travaux');
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  }

  function handleAddComment() {
    if (!reserve) return;
    if (comment.trim().length === 0) return;
    addComment(reserve.id, comment.trim());
    setComment('');
    setShowCommentBox(false);
  }

  const ackDone = !!reserve.enterpriseAcknowledgedAt;
  const signDone = !!reserve.enterpriseSignature;

  return (
    <View style={styles.container}>
      <Header
        title={reserve.id}
        subtitle={reserve.title}
        showBack
        rightLabel={permissions.canEdit ? 'Modifier' : undefined}
        onRightPress={permissions.canEdit ? openEdit : undefined}
      />

      {saveSuccess && (
        <View style={styles.toastBanner}>
          <Ionicons name="checkmark-circle" size={16} color={C.closed} />
          <Text style={styles.toastText}>Modifications enregistrées</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {overdue && (
          <View style={styles.overdueBanner}>
            <Ionicons name="warning" size={16} color={C.open} />
            <Text style={styles.overdueBannerText}>
              Délai dépassé — Échéance : {formatDate(reserve.deadline)}
            </Text>
          </View>
        )}

        <View style={styles.badgeRow}>
          <StatusBadge status={reserve.status} />
          <PriorityBadge priority={reserve.priority} />
        </View>

        {/* PHOTO GALLERY — multi-photo with defect/resolution badges */}
        {allPhotos.length > 0 && (
          <View style={styles.card}>
            <View style={styles.photoGalleryHeader}>
              <Text style={styles.sectionTitle}>Photos ({allPhotos.length})</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {defectCount > 0 && (
                  <View style={styles.photoBadgeDefect}>
                    <View style={[styles.photoBadgeDot, { backgroundColor: '#EF4444' }]} />
                    <Text style={[styles.photoBadgeText, { color: '#EF4444' }]}>{defectCount} constat{defectCount > 1 ? 's' : ''}</Text>
                  </View>
                )}
                {resolutionCount > 0 && (
                  <View style={styles.photoBadgeResolution}>
                    <View style={[styles.photoBadgeDot, { backgroundColor: '#22C55E' }]} />
                    <Text style={[styles.photoBadgeText, { color: '#22C55E' }]}>{resolutionCount} levée{resolutionCount > 1 ? 's' : ''}</Text>
                  </View>
                )}
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {allPhotos.map((photo, idx) => (
                  <View key={photo.id} style={styles.photoThumb}>
                    <TouchableOpacity
                      onPress={() => { setSelectedPhotoIndex(idx); setPhotoFullScreen(true); }}
                      activeOpacity={0.85}
                    >
                      <Image source={{ uri: photo.uri }} style={styles.photoThumbImg} resizeMode="cover" onError={() => {}} />
                      <View style={[styles.photoKindBadge, { backgroundColor: photo.kind === 'defect' ? '#EF444488' : '#22C55E88' }]}>
                        <Text style={styles.photoKindBadgeText}>{photo.kind === 'defect' ? 'Constat' : 'Levée'}</Text>
                      </View>
                    </TouchableOpacity>
                    {permissions.canEdit && photo.id !== 'legacy' && (
                      <TouchableOpacity style={styles.annotateBtn} onPress={() => setAnnotatorPhoto(photo)}>
                        <Ionicons name="pencil" size={11} color="#fff" />
                      </TouchableOpacity>
                    )}
                    {photo.annotations && photo.annotations.length > 0 && (
                      <View style={styles.annotatedIndicator}>
                        <Ionicons name="brush-outline" size={9} color="#fff" />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </ScrollView>
            <Text style={styles.photoHintSmall}>Appuyer pour agrandir · Crayon pour annoter</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informations</Text>
          <InfoRow icon="business-outline" label="Bâtiment" value={`Bâtiment ${reserve.building}`} />
          <InfoRow icon="location-outline" label="Zone" value={reserve.zone} />
          <InfoRow icon="layers-outline" label="Niveau" value={reserve.level} />
          <InfoRow icon="people-outline" label="Entreprise" value={reserve.company} />
          <InfoRow icon="calendar-outline" label="Créé le" value={formatDate(reserve.createdAt)} />
          <InfoRow
            icon="timer-outline"
            label="Échéance"
            value={reserve.deadline === '—' ? 'Aucune échéance' : formatDate(reserve.deadline)}
            valueColor={overdue ? C.open : undefined}
            last={!reserve.closedAt}
          />
          {reserve.closedAt && (
            <InfoRow
              icon="checkmark-circle-outline"
              label="Date de levée"
              value={formatDate(reserve.closedAt)}
              valueColor={C.closed}
            />
          )}
          {reserve.closedBy && (
            <InfoRow
              icon="person-outline"
              label="Clôturé par"
              value={reserve.closedBy}
              last
            />
          )}
          <TouchableOpacity
            style={[styles.contactBtn, { borderColor: company?.color ?? C.primary, backgroundColor: (company?.color ?? C.primary) + '12' }]}
            onPress={handleContactCompany}
            activeOpacity={0.75}
          >
            <Ionicons name="chatbubbles" size={16} color={company?.color ?? C.primary} />
            <Text style={[styles.contactBtnText, { color: company?.color ?? C.primary }]}>
              Contacter {reserve.company}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={company?.color ?? C.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>{reserve.description}</Text>
        </View>

        {permissions.canEdit && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Modifier le statut</Text>
            <View style={styles.statusGrid}>
              {STATUS_ORDER.map(s => {
                const cfg = STATUS_CONFIG[s];
                const isActive = reserve.status === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.statusBtn, { borderColor: cfg.color, backgroundColor: isActive ? cfg.bg : 'transparent' }]}
                    onPress={() => !isActive && handleStatusChange(s)}
                    disabled={isActive}
                  >
                    <View style={[styles.statusDot, { backgroundColor: cfg.color }]} />
                    <Text style={[styles.statusBtnText, { color: cfg.color }]}>{cfg.label}</Text>
                    {isActive && <Ionicons name="checkmark" size={12} color={cfg.color} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ENTERPRISE WORKFLOW — Accusé de réception + Signature de levée */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Workflow entreprise</Text>

          {/* Étape 1 : Accusé de réception */}
          <View style={styles.workflowStep}>
            <View style={[styles.workflowStepNum, ackDone && styles.workflowStepNumDone]}>
              {ackDone
                ? <Ionicons name="checkmark" size={13} color="#fff" />
                : <Text style={styles.workflowStepNumText}>1</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.workflowStepTitle}>Accusé de réception</Text>
              {ackDone ? (
                <Text style={styles.workflowStepDone}>Accusé le {formatDate(reserve.enterpriseAcknowledgedAt!)}</Text>
              ) : (
                <>
                  <Text style={styles.workflowStepDesc}>L'entreprise confirme avoir pris connaissance de cette réserve.</Text>
                  {permissions.canEdit && (
                    <TouchableOpacity style={styles.workflowBtn} onPress={handleEnterpriseAck} activeOpacity={0.8}>
                      <Ionicons name="mail-open-outline" size={14} color={C.primary} />
                      <Text style={styles.workflowBtnText}>Accuser réception</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>

          <View style={styles.workflowDivider} />

          {/* Étape 2 : Déclaration de levée (signature) */}
          <View style={[styles.workflowStep, { marginBottom: 0 }]}>
            <View style={[styles.workflowStepNum, signDone && styles.workflowStepNumDone, !ackDone && styles.workflowStepNumLocked]}>
              {signDone
                ? <Ionicons name="checkmark" size={13} color="#fff" />
                : <Text style={styles.workflowStepNumText}>2</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.workflowStepTitle, !ackDone && { color: C.textMuted }]}>Signature de levée</Text>
              {signDone ? (
                <View>
                  <Text style={styles.workflowStepDone}>
                    Signé par {reserve.enterpriseSignataire}
                  </Text>
                  <Image
                    source={{ uri: reserve.enterpriseSignature! }}
                    style={styles.signaturePreview}
                    resizeMode="contain"
                  />
                </View>
              ) : ackDone ? (
                <>
                  <Text style={styles.workflowStepDesc}>L'entreprise certifie avoir levé la réserve. Signature numérique requise.</Text>
                  {permissions.canEdit && (
                    <TouchableOpacity style={styles.workflowBtn} onPress={() => setSignatureModalVisible(true)} activeOpacity={0.8}>
                      <Ionicons name="pencil-outline" size={14} color={C.primary} />
                      <Text style={styles.workflowBtnText}>Signer la levée</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <Text style={styles.workflowStepDesc}>Disponible après accusé de réception.</Text>
              )}
            </View>
          </View>
        </View>

        {(() => {
          const linkedTask = reserve.linkedTaskId ? tasks.find(t => t.id === reserve.linkedTaskId) : null;
          const TASK_STATUS_COLORS: Record<string, string> = {
            todo: C.textMuted, in_progress: C.inProgress, done: C.closed, delayed: C.waiting,
          };
          const TASK_STATUS_LABELS: Record<string, string> = {
            todo: 'À faire', in_progress: 'En cours', done: 'Terminé', delayed: 'En retard',
          };
          return (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Tâche corrective</Text>
              {linkedTask ? (
                <TouchableOpacity
                  style={styles.taskLink}
                  onPress={() => router.push(`/task/${linkedTask.id}` as any)}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <View style={[styles.taskStatusDot, { backgroundColor: TASK_STATUS_COLORS[linkedTask.status] }]} />
                      <Text style={[styles.taskStatusText, { color: TASK_STATUS_COLORS[linkedTask.status] }]}>
                        {TASK_STATUS_LABELS[linkedTask.status]}
                      </Text>
                      <Text style={styles.taskProgressText}>{linkedTask.progress}%</Text>
                    </View>
                    <Text style={styles.taskTitle}>{linkedTask.title}</Text>
                    <Text style={styles.taskMeta}>Responsable : {linkedTask.assignee} · Éch. : {linkedTask.deadline}</Text>
                    <View style={styles.taskProgressBar}>
                      <View style={[styles.taskProgressFill, { width: `${linkedTask.progress}%` as any, backgroundColor: TASK_STATUS_COLORS[linkedTask.status] }]} />
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.textMuted} style={{ marginLeft: 8 }} />
                </TouchableOpacity>
              ) : permissions.canCreate ? (
                <TouchableOpacity
                  style={styles.createTaskBtn}
                  onPress={() => router.push({ pathname: '/task/new', params: { reserveId: reserve.id } } as any)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add-circle-outline" size={18} color={C.primary} />
                  <Text style={styles.createTaskBtnText}>Créer une tâche corrective</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.emptyText}>Aucune tâche corrective associée à cette réserve.</Text>
              )}
            </View>
          );
        })()}

        <View style={styles.card}>
          <View style={styles.commentHeader}>
            <Text style={styles.sectionTitle}>
              Commentaires ({reserve.comments.length})
            </Text>
            {permissions.canCreate && (
              <TouchableOpacity
                onPress={() => setShowCommentBox(!showCommentBox)}
                style={styles.addCommentBtn}
              >
                <Ionicons name={showCommentBox ? 'close' : 'add'} size={18} color={C.primary} />
              </TouchableOpacity>
            )}
          </View>

          {showCommentBox && (
            <View style={styles.commentBox}>
              <TextInput
                style={styles.commentInput}
                placeholder="Ajouter un commentaire..."
                placeholderTextColor={C.textMuted}
                value={comment}
                onChangeText={setComment}
                multiline
                maxLength={500}
                autoFocus
              />
              <TouchableOpacity style={styles.sendBtn} onPress={handleAddComment}>
                <Ionicons name="send" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {reserve.comments.length === 0 && !showCommentBox && (
            <Text style={styles.emptyText}>Aucun commentaire — appuyez sur + pour en ajouter</Text>
          )}

          {[...reserve.comments].reverse().map(c => (
            <View key={c.id} style={styles.commentCard}>
              <View style={styles.commentTop}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>{c.author.charAt(0)}</Text>
                </View>
                <View>
                  <Text style={styles.commentAuthor}>{c.author}</Text>
                  <Text style={styles.commentDate}>{formatDate(c.createdAt)}</Text>
                </View>
              </View>
              <Text style={styles.commentContent}>{c.content}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Historique ({reserve.history.length})</Text>
          {[...reserve.history].reverse().map(h => (
            <View key={h.id} style={styles.historyItem}>
              <View style={styles.historyDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.historyAction}>{h.action}</Text>
                {h.oldValue && h.newValue && (
                  <Text style={styles.historyValues}>{h.oldValue} → {h.newValue}</Text>
                )}
                <Text style={styles.historyMeta}>{h.author} — {formatDate(h.createdAt)}</Text>
              </View>
            </View>
          ))}
        </View>

        {permissions.canExport && (
          <TouchableOpacity style={styles.exportPdfBtn} onPress={handleExportPDF}>
            <Ionicons name="document-text-outline" size={16} color={C.primary} />
            <Text style={styles.exportPdfBtnText}>Exporter fiche PDF</Text>
          </TouchableOpacity>
        )}

        {permissions.canDelete && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={16} color={C.open} />
            <Text style={styles.deleteBtnText}>Supprimer cette réserve</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Modal d'édition */}
      <Modal visible={editModalVisible} transparent animationType="slide" onRequestClose={() => setEditModalVisible(false)}>
        <View style={mStyles.overlay}>
          <View style={mStyles.sheet}>
            <View style={mStyles.sheetHeader}>
              <TouchableOpacity onPress={() => setEditModalVisible(false)} style={mStyles.closeBtn}>
                <Ionicons name="close" size={20} color={C.textSub} />
              </TouchableOpacity>
              <Text style={mStyles.sheetTitle}>Modifier la réserve</Text>
              <TouchableOpacity onPress={handleSaveEdit} style={mStyles.saveBtn}>
                <Text style={mStyles.saveBtnText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={mStyles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={mStyles.label}>TITRE *</Text>
              <TextInput style={mStyles.input} value={editTitle} onChangeText={setEditTitle} placeholder="Titre..." placeholderTextColor={C.textMuted} />

              <Text style={mStyles.label}>DESCRIPTION</Text>
              <TextInput
                style={[mStyles.input, mStyles.textArea]}
                value={editDescription}
                onChangeText={setEditDescription}
                placeholder="Description..."
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={4}
              />

              <Text style={mStyles.label}>PHOTOS ({editPhotos.length}/6)</Text>
              {editPhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {editPhotos.map(p => (
                      <View key={p.id} style={mStyles.photoThumb}>
                        <TouchableOpacity onPress={() => toggleEditPhotoKind(p.id)} activeOpacity={0.85}>
                          <Image source={{ uri: p.uri }} style={mStyles.photoThumbImg} resizeMode="cover" onError={() => {}} />
                          <View style={[mStyles.photoKindBadge, { backgroundColor: p.kind === 'defect' ? '#EF444488' : '#22C55E88' }]}>
                            <Text style={mStyles.photoKindText}>{p.kind === 'defect' ? 'Constat' : 'Levée'}</Text>
                          </View>
                        </TouchableOpacity>
                        <TouchableOpacity style={mStyles.photoRemoveBtn} onPress={() => removeEditPhoto(p.id)}>
                          <Ionicons name="close" size={10} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              )}
              {editPhotos.length < 6 && (
                <View style={mStyles.photoRow}>
                  <TouchableOpacity style={mStyles.photoBtn} onPress={() => handleAddEditPhoto(true)} disabled={editPhotoUploading}>
                    <Ionicons name="camera" size={16} color={C.primary} />
                    <Text style={mStyles.photoBtnText}>Photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[mStyles.photoBtn, { flex: 1 }]} onPress={() => handleAddEditPhoto(false)} disabled={editPhotoUploading}>
                    <Ionicons name="images-outline" size={16} color={C.inProgress} />
                    <Text style={[mStyles.photoBtnText, { color: C.inProgress }]}>Galerie</Text>
                  </TouchableOpacity>
                </View>
              )}
              {editPhotoUploading && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <ActivityIndicator size="small" color={C.primary} />
                  <Text style={{ fontSize: 12, color: C.textMuted, fontFamily: 'Inter_400Regular' }}>Upload en cours...</Text>
                </View>
              )}

              <Text style={mStyles.label}>BÂTIMENT</Text>
              <ChipSelect options={RESERVE_BUILDINGS} value={editBuilding} onChange={setEditBuilding} />

              <Text style={mStyles.label}>ZONE</Text>
              <ChipSelect options={RESERVE_ZONES} value={editZone} onChange={setEditZone} />

              <Text style={mStyles.label}>NIVEAU</Text>
              <ChipSelect options={RESERVE_LEVELS} value={editLevel} onChange={setEditLevel} />

              <Text style={mStyles.label}>ENTREPRISE</Text>
              {companies.length === 0 ? (
                <Text style={mStyles.hint}>Aucune entreprise configurée.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
                    {companies.map(co => (
                      <TouchableOpacity
                        key={co.id}
                        style={[mStyles.chip, editCompany === co.name && { borderColor: co.color, backgroundColor: co.color + '20' }]}
                        onPress={() => setEditCompany(co.name)}
                      >
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: co.color }} />
                        <Text style={[mStyles.chipText, editCompany === co.name && { color: co.color }]}>{co.shortName}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              )}

              <Text style={mStyles.label}>PRIORITÉ</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {RESERVE_PRIORITIES.map(p => (
                  <TouchableOpacity
                    key={p.value}
                    style={[mStyles.chip, editPriority === p.value && { borderColor: p.color, backgroundColor: p.color + '20' }]}
                    onPress={() => setEditPriority(p.value)}
                  >
                    <Text style={[mStyles.chipText, editPriority === p.value && { color: p.color }]}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={mStyles.label}>DATE LIMITE</Text>
              <DateInput value={editDeadline} onChange={setEditDeadline} optional />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Photo plein écran — galerie multi-photos */}
      <Modal visible={photoFullScreen} transparent animationType="fade" onRequestClose={() => setPhotoFullScreen(false)}>
        <View style={styles.photoModal}>
          <TouchableOpacity style={styles.photoCloseBtn} onPress={() => setPhotoFullScreen(false)}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          {allPhotos.length > 0 && (
            <>
              <Image
                source={{ uri: allPhotos[selectedPhotoIndex]?.uri }}
                style={styles.photoFull}
                resizeMode="contain"
                onError={() => {}}
              />
              <View style={styles.photoNavRow}>
                <TouchableOpacity
                  onPress={() => setSelectedPhotoIndex(i => Math.max(0, i - 1))}
                  disabled={selectedPhotoIndex === 0}
                  style={[styles.photoNavBtn, selectedPhotoIndex === 0 && { opacity: 0.3 }]}
                >
                  <Ionicons name="chevron-back" size={22} color="#fff" />
                </TouchableOpacity>
                <View style={[styles.photoKindBadge, { backgroundColor: allPhotos[selectedPhotoIndex]?.kind === 'defect' ? '#EF444488' : '#22C55E88', paddingHorizontal: 14, paddingVertical: 5 }]}>
                  <Text style={styles.photoKindBadgeText}>
                    {allPhotos[selectedPhotoIndex]?.kind === 'defect' ? 'Constat' : 'Levée'} · {selectedPhotoIndex + 1}/{allPhotos.length}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedPhotoIndex(i => Math.min(allPhotos.length - 1, i + 1))}
                  disabled={selectedPhotoIndex === allPhotos.length - 1}
                  style={[styles.photoNavBtn, selectedPhotoIndex === allPhotos.length - 1 && { opacity: 0.3 }]}
                >
                  <Ionicons name="chevron-forward" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>

      {/* Modal signature de levée */}
      <Modal visible={signatureModalVisible} transparent animationType="slide" onRequestClose={() => setSignatureModalVisible(false)}>
        <View style={mStyles.overlay}>
          <View style={mStyles.sheet}>
            <View style={mStyles.sheetHeader}>
              <TouchableOpacity onPress={() => setSignatureModalVisible(false)} style={mStyles.closeBtn}>
                <Ionicons name="close" size={20} color={C.textSub} />
              </TouchableOpacity>
              <Text style={mStyles.sheetTitle}>Signature de levée</Text>
              <TouchableOpacity onPress={handleSignatureSave} style={mStyles.saveBtn}>
                <Text style={mStyles.saveBtnText}>Valider</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={mStyles.content} showsVerticalScrollIndicator={false}>
              <View style={styles.sigInfoBox}>
                <Ionicons name="information-circle-outline" size={16} color={C.primary} />
                <Text style={styles.sigInfoText}>
                  En signant, l'entreprise certifie avoir levé la réserve <Text style={{ fontFamily: 'Inter_700Bold' }}>{reserve.id}</Text>.
                </Text>
              </View>
              <Text style={mStyles.label}>NOM DU SIGNATAIRE</Text>
              <TextInput
                style={mStyles.input}
                placeholder={user?.name ?? 'Nom du représentant...'}
                placeholderTextColor={C.textMuted}
                value={signataireName}
                onChangeText={setSignataireName}
              />
              <Text style={[mStyles.label, { marginTop: 16 }]}>SIGNATURE *</Text>
              <View style={styles.sigPadWrap}>
                <SignaturePad ref={sigPadRef} />
              </View>
              <TouchableOpacity
                onPress={() => sigPadRef.current?.clear()}
                style={styles.clearSigBtn}
              >
                <Ionicons name="refresh-outline" size={14} color={C.textSub} />
                <Text style={styles.clearSigText}>Effacer la signature</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Annotateur photo */}
      {annotatorPhoto && (
        <PhotoAnnotationOverlay
          photoUri={annotatorPhoto.uri}
          annotations={annotatorPhoto.annotations ?? []}
          editable
          visible
          onSave={(annotations) => handleAnnotationSave(annotatorPhoto!.id, annotations)}
          onClose={() => setAnnotatorPhoto(null)}
        />
      )}
    </View>
  );
}

function InfoRow({ icon, label, value, last, valueColor }: {
  icon: string; label: string; value: string; last?: boolean; valueColor?: string;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Ionicons name={icon as any} size={15} color={C.textMuted} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFoundText: { fontSize: 16, color: C.textSub, fontFamily: 'Inter_400Regular' },
  content: { padding: 16, paddingBottom: 40 },
  toastBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.closed + '15', paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.closed + '30',
  },
  toastText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.closed },
  overdueBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.open + '12', borderRadius: 10, padding: 12,
    marginBottom: 14, borderWidth: 1, borderColor: C.open + '30',
  },
  overdueBannerText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.open, flex: 1 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  infoValue: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  description: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 22 },
  photoGalleryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  photoBadgeDefect: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EF444415', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  photoBadgeResolution: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#22C55E15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  photoBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  photoBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  photoThumb: { width: 110, height: 90, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  photoThumbImg: { width: 110, height: 90 },
  photoKindBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 3, alignItems: 'center' },
  photoKindBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  annotateBtn: {
    position: 'absolute', top: 5, right: 5,
    backgroundColor: 'rgba(0,0,0,0.55)', width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  annotatedIndicator: {
    position: 'absolute', top: 5, left: 5,
    backgroundColor: C.primary + 'CC', width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  photoHintSmall: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 8 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  workflowStep: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 4 },
  workflowStepNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.border, alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  workflowStepNumDone: { backgroundColor: C.closed },
  workflowStepNumLocked: { backgroundColor: C.border, opacity: 0.5 },
  workflowStepNumText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.textSub },
  workflowStepTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  workflowStepDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 8 },
  workflowStepDone: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.closed },
  workflowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primaryBg, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: C.primary + '40', alignSelf: 'flex-start',
  },
  workflowBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  workflowDivider: { height: 1, backgroundColor: C.border, marginVertical: 14, marginLeft: 40 },
  signaturePreview: { height: 54, width: 180, marginTop: 6, borderRadius: 6, backgroundColor: C.surface2 },
  sigInfoBox: {
    flexDirection: 'row', gap: 10, backgroundColor: C.primaryBg, borderRadius: 10,
    padding: 12, marginBottom: 16, borderWidth: 1, borderColor: C.primary + '30',
  },
  sigInfoText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20 },
  sigPadWrap: { borderRadius: 10, overflow: 'hidden', borderWidth: 1.5, borderColor: C.border, marginBottom: 10 },
  clearSigBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 6 },
  clearSigText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addCommentBtn: { padding: 4 },
  commentBox: { flexDirection: 'row', gap: 8, marginBottom: 12, alignItems: 'flex-end' },
  commentInput: {
    flex: 1, backgroundColor: C.surface2, borderRadius: 10, padding: 10,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    maxHeight: 100, borderWidth: 1, borderColor: C.border,
  },
  sendBtn: { backgroundColor: C.primary, width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  commentCard: { backgroundColor: C.surface2, borderRadius: 10, padding: 12, marginTop: 8 },
  commentTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  avatarCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary },
  commentAuthor: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  commentDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  commentContent: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 20 },
  historyItem: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary, marginTop: 4 },
  historyAction: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  historyValues: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  historyMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 3 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5 },
  contactBtnText: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  exportPdfBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: C.primary + '50', backgroundColor: C.primary + '08', marginBottom: 10 },
  exportPdfBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: C.open + '50', backgroundColor: C.open + '08' },
  deleteBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.open },
  taskLink: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface2, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  taskStatusDot: { width: 8, height: 8, borderRadius: 4 },
  taskStatusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  taskProgressText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  taskTitle: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text, marginBottom: 4 },
  taskMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 8 },
  taskProgressBar: { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  taskProgressFill: { height: 4, borderRadius: 2 },
  createTaskBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primaryBg, borderRadius: 10, paddingVertical: 13, borderWidth: 1, borderColor: C.primary + '40' },
  createTaskBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  photoModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  photoCloseBtn: { position: 'absolute', top: 52, right: 20, zIndex: 10, padding: 8, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20 },
  photoFull: { width: '100%', height: '70%' },
  photoNavRow: { flexDirection: 'row', alignItems: 'center', gap: 16, position: 'absolute', bottom: 60 },
  photoNavBtn: { padding: 10, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20 },
});

const mStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  sheetTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  closeBtn: { padding: 4 },
  saveBtn: { backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  saveBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  content: { padding: 16, paddingBottom: 32 },
  label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 14 },
  hint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4 },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2, flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  photoRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.surface2, borderRadius: 10, paddingVertical: 12, borderWidth: 1.5, borderColor: C.border },
  photoBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  photoThumb: { width: 88, height: 72, borderRadius: 8, overflow: 'hidden', position: 'relative' },
  photoThumbImg: { width: 88, height: 72 },
  photoKindBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 2, alignItems: 'center' },
  photoKindText: { fontSize: 9, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  photoRemoveBtn: {
    position: 'absolute', top: 3, right: 3,
    backgroundColor: 'rgba(0,0,0,0.55)', width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
});
