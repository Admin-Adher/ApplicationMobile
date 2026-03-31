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
import StatusBadge, { STATUS_CONFIG } from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { useAuth } from '@/context/AuthContext';
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

export default function ReserveDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { reserves, tasks, updateReserveStatus, updateReserveFields, deleteReserve, addComment, companies, channels, addPhoto } = useApp();
  const { user, permissions } = useAuth();
  const [comment, setComment] = useState('');
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [photoFullScreen, setPhotoFullScreen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [signatureModalVisible, setSignatureModalVisible] = useState(false);
  const [signataireName, setSignataireName] = useState('');
  const sigPadRef = useRef<SignaturePadRef>(null);
  const [annotatorPhoto, setAnnotatorPhoto] = useState<ReservePhoto | null>(null);
  const [editPhotos, setEditPhotos] = useState<ReservePhoto[]>([]);
  const [editPhotoUploading2, setEditPhotoUploading2] = useState(false);

  const reserve = reserves.find(r => r.id === id);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editBuilding, setEditBuilding] = useState<string>(RESERVE_BUILDINGS[0]);
  const [editZone, setEditZone] = useState<string>(RESERVE_ZONES[0]);
  const [editLevel, setEditLevel] = useState<string>('RDC');
  const [editCompany, setEditCompany] = useState('');
  const [editPriority, setEditPriority] = useState<ReservePriority>('medium');
  const [editDeadline, setEditDeadline] = useState('');
  const [editPhotoUri, setEditPhotoUri] = useState<string | null | undefined>(undefined);
  const [editPhotoUploading, setEditPhotoUploading] = useState(false);

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

  const company = companies.find(c => c.name === reserve.company);
  const companyChannel = company ? channels.find(ch => ch.id === `company-${company.id}`) : null;

  function openEdit() {
    setEditTitle(reserve.title);
    setEditDescription(reserve.description);
    setEditBuilding(reserve.building);
    setEditZone(reserve.zone);
    setEditLevel(reserve.level);
    setEditCompany(reserve.company);
    setEditPriority(reserve.priority);
    setEditDeadline(reserve.deadline === '—' ? '' : reserve.deadline);
    setEditPhotoUri(reserve.photoUri ?? null);
    setEditPhotos(reserve.photos ?? (reserve.photoUri ? [{ id: 'legacy', uri: reserve.photoUri, kind: 'defect', takenAt: reserve.createdAt, takenBy: '' }] : []));
    setEditModalVisible(true);
  }

  function handleSignatureSave() {
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
      enterpriseAcknowledgedAt: today,
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
    const updatedPhotos: ReservePhoto[] = (reserve.photos ?? []).map(p =>
      p.id === photoId ? { ...p, annotations } : p
    );
    updateReserveFields({ ...reserve, photos: updatedPhotos });
    setAnnotatorPhoto(null);
  }

  async function handleAddEditPhoto() {
    if (editPhotos.length >= 6) { Alert.alert('Limite atteinte', 'Maximum 6 photos par réserve.'); return; }
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à la galerie est nécessaire."); return; }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setEditPhotoUploading2(true);
      try {
        const filename = `reserve_photo_${Date.now()}.jpg`;
        const storageUrl = await uploadPhoto(result.assets[0].uri, filename);
        const finalUri = storageUrl ?? result.assets[0].uri;
        const today = new Date().toISOString().slice(0, 10);
        const newPhoto: ReservePhoto = { id: genId(), uri: finalUri, kind: 'defect', takenAt: today, takenBy: user?.name ?? '' };
        setEditPhotos(prev => [...prev, newPhoto]);
      } catch {
        const today = new Date().toISOString().slice(0, 10);
        const newPhoto: ReservePhoto = { id: genId(), uri: result.assets[0].uri, kind: 'defect', takenAt: today, takenBy: user?.name ?? '' };
        setEditPhotos(prev => [...prev, newPhoto]);
      } finally {
        setEditPhotoUploading2(false);
      }
    }
  }

  async function handleEditPickPhoto() {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission refusée', "L'accès à la galerie est nécessaire.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) await saveEditPhoto(result.assets[0].uri);
  }

  async function handleEditCamera() {
    if (Platform.OS === 'web') {
      Alert.alert('Info', 'La prise de photo directe est disponible sur mobile.');
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission refusée', "L'accès à l'appareil photo est nécessaire.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) await saveEditPhoto(result.assets[0].uri);
  }

  async function saveEditPhoto(uri: string) {
    setEditPhotoUploading(true);
    try {
      const filename = `reserve_photo_${Date.now()}.jpg`;
      const storageUrl = await uploadPhoto(uri, filename);
      setEditPhotoUri(storageUrl ?? uri);
    } catch {
      setEditPhotoUri(uri);
    } finally {
      setEditPhotoUploading(false);
    }
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
      photoUri: editPhotoUri ?? undefined,
      history: changes.length > 0 ? [...reserve.history, historyEntry] : reserve.history,
    };
    updateReserveFields(updated);
    if (editPhotoUri && editPhotoUri !== reserve.photoUri) {
      addPhoto({
        id: genId(),
        comment: `Photo réserve ${reserve.id} — ${editTitle.trim()}`,
        location: `Bât. ${editBuilding} - ${editLevel}`,
        takenAt: today,
        takenBy: author,
        colorCode: '#EF4444',
        uri: editPhotoUri,
      });
    }
    setEditModalVisible(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  }

  function handleDelete() {
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
    updateReserveStatus(reserve.id, newStatus, user?.name ?? 'Conducteur de travaux');
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  }

  function handleAddComment() {
    if (comment.trim().length === 0) return;
    addComment(reserve.id, comment.trim());
    setComment('');
    setShowCommentBox(false);
  }

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

        {reserve.photoUri ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Photo</Text>
            <TouchableOpacity onPress={() => setPhotoFullScreen(true)} activeOpacity={0.85}>
              <Image
                source={{ uri: reserve.photoUri }}
                style={styles.photo}
                resizeMode="cover"
                onError={() => {}}
              />
              <View style={styles.photoHint}>
                <Ionicons name="expand-outline" size={12} color="#fff" />
                <Text style={styles.photoHintText}>Appuyer pour agrandir</Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

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

              <Text style={mStyles.label}>PHOTO</Text>
              {editPhotoUri ? (
                <View style={mStyles.photoWrap}>
                  <Image source={{ uri: editPhotoUri }} style={mStyles.photoPreview} resizeMode="cover" onError={() => {}} />
                  <View style={mStyles.photoActions}>
                    <TouchableOpacity style={mStyles.photoActionBtn} onPress={handleEditCamera} disabled={editPhotoUploading}>
                      <Ionicons name="camera-outline" size={13} color={C.primary} />
                      <Text style={mStyles.photoActionText}>Remplacer</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={mStyles.photoActionBtn} onPress={handleEditPickPhoto} disabled={editPhotoUploading}>
                      <Ionicons name="images-outline" size={13} color={C.inProgress} />
                      <Text style={[mStyles.photoActionText, { color: C.inProgress }]}>Galerie</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[mStyles.photoActionBtn, { borderColor: C.open + '60' }]} onPress={() => setEditPhotoUri(null)} disabled={editPhotoUploading}>
                      <Ionicons name="trash-outline" size={13} color={C.open} />
                      <Text style={[mStyles.photoActionText, { color: C.open }]}>Suppr.</Text>
                    </TouchableOpacity>
                  </View>
                  {editPhotoUploading && (
                    <View style={mStyles.uploadOverlay}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  )}
                </View>
              ) : (
                <View style={mStyles.photoRow}>
                  <TouchableOpacity style={mStyles.photoBtn} onPress={handleEditCamera} disabled={editPhotoUploading}>
                    <Ionicons name="camera" size={16} color={C.primary} />
                    <Text style={mStyles.photoBtnText}>Photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[mStyles.photoBtn, { flex: 1 }]} onPress={handleEditPickPhoto} disabled={editPhotoUploading}>
                    <Ionicons name="images-outline" size={16} color={C.inProgress} />
                    <Text style={[mStyles.photoBtnText, { color: C.inProgress }]}>Galerie</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={mStyles.label}>BÂTIMENT</Text>
              <ChipSelect
                options={RESERVE_BUILDINGS}
                value={editBuilding}
                onChange={setEditBuilding}
              />

              <Text style={mStyles.label}>ZONE</Text>
              <ChipSelect
                options={RESERVE_ZONES}
                value={editZone}
                onChange={setEditZone}
              />

              <Text style={mStyles.label}>NIVEAU</Text>
              <ChipSelect
                options={RESERVE_LEVELS}
                value={editLevel}
                onChange={setEditLevel}
              />

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
              <DateInput
                value={editDeadline}
                onChange={setEditDeadline}
                optional
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Photo plein écran */}
      {reserve.photoUri ? (
        <Modal visible={photoFullScreen} transparent animationType="fade" onRequestClose={() => setPhotoFullScreen(false)}>
          <TouchableOpacity style={styles.photoModal} activeOpacity={1} onPress={() => setPhotoFullScreen(false)}>
            <TouchableOpacity style={styles.photoCloseBtn} onPress={() => setPhotoFullScreen(false)}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <Image
              source={{ uri: reserve.photoUri }}
              style={styles.photoFull}
              resizeMode="contain"
              onError={() => {}}
            />
          </TouchableOpacity>
        </Modal>
      ) : null}
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
  photo: { width: '100%', height: 200, borderRadius: 10 },
  photoHint: {
    position: 'absolute', bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  photoHintText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#fff' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
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
  photoWrap: { borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border, marginBottom: 4 },
  photoPreview: { width: '100%', height: 140 },
  photoActions: { flexDirection: 'row', gap: 6, padding: 8, backgroundColor: C.surface2 },
  photoActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  photoActionText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  photoRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.surface2, borderRadius: 10, paddingVertical: 12, borderWidth: 1.5, borderColor: C.border },
  photoBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  uploadOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
});
