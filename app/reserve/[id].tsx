import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, Platform, Image, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { Reserve, ReservePriority, ReserveStatus } from '@/constants/types';
import StatusBadge, { STATUS_CONFIG } from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';

const STATUS_ORDER: ReserveStatus[] = ['open', 'in_progress', 'waiting', 'verification', 'closed'];
const BUILDINGS = ['A', 'B', 'C'];
const ZONES = ['Zone Nord', 'Zone Sud', 'Zone Est', 'Zone Ouest', 'Zone Centre'];
const LEVELS = ['Sous-sol', 'RDC', 'R+1', 'R+2', 'R+3'];
const PRIORITIES: { value: ReservePriority; label: string; color: string }[] = [
  { value: 'low', label: 'Basse', color: C.low },
  { value: 'medium', label: 'Moyenne', color: C.medium },
  { value: 'high', label: 'Haute', color: C.high },
  { value: 'critical', label: 'Critique', color: C.critical },
];

function isOverdue(deadline: string, status: ReserveStatus): boolean {
  if (status === 'closed' || deadline === '—' || !deadline) return false;
  const parts = deadline.split('/');
  if (parts.length === 3) {
    const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    return d < new Date() && !isNaN(d.getTime());
  }
  const d = new Date(deadline);
  return d < new Date() && !isNaN(d.getTime());
}

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
  const { reserves, updateReserveStatus, updateReserveFields, deleteReserve, addComment, companies, channels } = useApp();
  const { user } = useAuth();
  const [comment, setComment] = useState('');
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [photoFullScreen, setPhotoFullScreen] = useState(false);

  const reserve = reserves.find(r => r.id === id);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editBuilding, setEditBuilding] = useState('A');
  const [editZone, setEditZone] = useState('Zone Nord');
  const [editLevel, setEditLevel] = useState('RDC');
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
    setEditModalVisible(true);
  }

  function handleSaveEdit() {
    if (!editTitle.trim()) {
      Alert.alert('Champ obligatoire', 'Le titre est requis.');
      return;
    }
    if (editDeadline && !/^\d{2}\/\d{2}\/\d{4}$/.test(editDeadline)) {
      Alert.alert('Format invalide', 'La date limite doit être au format JJ/MM/AAAA.');
      return;
    }
    const author = user?.name ?? 'Conducteur de travaux';
    const today = new Date().toISOString().slice(0, 10);
    const historyEntry = {
      id: `h${Date.now()}`,
      action: 'Réserve modifiée',
      author,
      createdAt: today,
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
      history: [...reserve.history, historyEntry],
    };
    updateReserveFields(updated);
    setEditModalVisible(false);
  }

  function handleDelete() {
    Alert.alert(
      'Supprimer la réserve',
      `Supprimer définitivement ${reserve.id} — "${reserve.title}" ?`,
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
    Alert.alert(
      'Modifier le statut',
      `Passer à "${STATUS_CONFIG[newStatus].label}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: () => updateReserveStatus(reserve.id, newStatus, user?.name ?? 'Conducteur de travaux') },
      ]
    );
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
        rightLabel="Modifier"
        onRightPress={openEdit}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Bandeau délai dépassé */}
        {overdue && (
          <View style={styles.overdueBanner}>
            <Ionicons name="warning" size={16} color={C.open} />
            <Text style={styles.overdueBannerText}>
              Délai dépassé — Échéance : {reserve.deadline}
            </Text>
          </View>
        )}

        <View style={styles.badgeRow}>
          <StatusBadge status={reserve.status} />
          <PriorityBadge priority={reserve.priority} />
        </View>

        {/* Photo */}
        {reserve.photoUri ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Photo</Text>
            <TouchableOpacity onPress={() => setPhotoFullScreen(true)} activeOpacity={0.85}>
              <Image source={{ uri: reserve.photoUri }} style={styles.photo} resizeMode="cover" />
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
          <InfoRow icon="calendar-outline" label="Créé le" value={reserve.createdAt} />
          <InfoRow
            icon="timer-outline"
            label="Échéance"
            value={reserve.deadline}
            valueColor={overdue ? C.open : undefined}
            last
          />
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

        <View style={styles.card}>
          <View style={styles.commentHeader}>
            <Text style={styles.sectionTitle}>
              Commentaires ({reserve.comments.length})
            </Text>
            <TouchableOpacity
              onPress={() => setShowCommentBox(!showCommentBox)}
              style={styles.addCommentBtn}
            >
              <Ionicons name={showCommentBox ? 'close' : 'add'} size={18} color={C.primary} />
            </TouchableOpacity>
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
                  <Text style={styles.commentDate}>{c.createdAt}</Text>
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
                <Text style={styles.historyMeta}>{h.author} — {h.createdAt}</Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={16} color={C.open} />
          <Text style={styles.deleteBtnText}>Supprimer cette réserve</Text>
        </TouchableOpacity>
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

            <ScrollView contentContainerStyle={mStyles.content} keyboardShouldPersistTaps="handled">
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

              <Text style={mStyles.label}>BÂTIMENT</Text>
              <ChipSelect options={BUILDINGS} value={editBuilding} onChange={setEditBuilding} />

              <Text style={mStyles.label}>ZONE</Text>
              <ChipSelect options={ZONES} value={editZone} onChange={setEditZone} />

              <Text style={mStyles.label}>NIVEAU</Text>
              <ChipSelect options={LEVELS} value={editLevel} onChange={setEditLevel} />

              <Text style={mStyles.label}>ENTREPRISE</Text>
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

              <Text style={mStyles.label}>PRIORITÉ</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {PRIORITIES.map(p => (
                  <TouchableOpacity
                    key={p.value}
                    style={[mStyles.chip, editPriority === p.value && { borderColor: p.color, backgroundColor: p.color + '20' }]}
                    onPress={() => setEditPriority(p.value)}
                  >
                    <Text style={[mStyles.chipText, editPriority === p.value && { color: p.color }]}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={mStyles.label}>DATE LIMITE (JJ/MM/AAAA)</Text>
              <TextInput
                style={mStyles.input}
                value={editDeadline}
                onChangeText={setEditDeadline}
                placeholder="Ex : 30/04/2025"
                placeholderTextColor={C.textMuted}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
              <Text style={mStyles.hint}>Laisser vide pour supprimer l'échéance</Text>
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
            <Image source={{ uri: reserve.photoUri }} style={styles.photoFull} resizeMode="contain" />
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
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: C.open + '40', backgroundColor: C.open + '08' },
  deleteBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.open },
  photo: { width: '100%', height: 200, borderRadius: 10 },
  photoHint: { position: 'absolute', bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  photoHintText: { fontSize: 10, fontFamily: 'Inter_500Medium', color: '#fff' },
  photoModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  photoFull: { width: '100%', height: '80%' },
  photoCloseBtn: { position: 'absolute', top: 50, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
});

const mStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  closeBtn: { padding: 4 },
  sheetTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  saveBtn: { backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  saveBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  content: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 12 },
  hint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4, marginBottom: 8 },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
});
