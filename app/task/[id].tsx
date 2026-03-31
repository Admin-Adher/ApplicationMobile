import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { Task, TaskStatus, ReservePriority } from '@/constants/types';
import { validateDeadline } from '@/lib/reserveUtils';

const STATUS_OPTS: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'todo', label: 'À faire', color: C.textMuted },
  { value: 'in_progress', label: 'En cours', color: C.inProgress },
  { value: 'done', label: 'Terminé', color: C.closed },
  { value: 'delayed', label: 'En retard', color: C.waiting },
];

const PRIORITY_OPTS: { value: ReservePriority; label: string; color: string }[] = [
  { value: 'low', label: 'Faible', color: C.low },
  { value: 'medium', label: 'Moyen', color: C.medium },
  { value: 'high', label: 'Élevé', color: C.high },
  { value: 'critical', label: 'Critique', color: C.critical },
];

export default function EditTaskScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tasks, reserves, updateTask, deleteTask, companies, addTaskComment } = useApp();
  const { user, permissions } = useAuth();

  const task = tasks.find(t => t.id === id);
  const linkedReserve = task?.reserveId ? reserves.find(r => r.id === task.reserveId) : null;

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
  const [priority, setPriority] = useState<ReservePriority>(task?.priority ?? 'medium');
  const [startDate, setStartDate] = useState(task?.startDate ? task.startDate.includes('/') ? task.startDate : (() => { const p = task.startDate!.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; })() : '');
  const [deadline, setDeadline] = useState(task?.deadline ?? '');
  const [assignee, setAssignee] = useState(task?.assignee ?? '');
  const [company, setCompany] = useState(task?.company ?? companies[0]?.id ?? '');
  const [progress, setProgress] = useState(String(task?.progress ?? 0));
  const [newComment, setNewComment] = useState('');

  if (!task) {
    return (
      <View style={styles.container}>
        <Header title="Tâche introuvable" showBack />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textMuted} />
          <Text style={styles.notFoundText}>Cette tâche n'existe plus.</Text>
        </View>
      </View>
    );
  }

  function handleSave() {
    if (!title.trim()) {
      Alert.alert('Champ requis', 'Le titre est obligatoire.');
      return;
    }
    if (startDate.trim() && !validateDeadline(startDate.trim())) {
      Alert.alert('Date de début invalide', "Vérifiez le format (ex : 01/04/2026).");
      return;
    }
    if (deadline.trim() && !validateDeadline(deadline.trim())) {
      Alert.alert('Date invalide', "Vérifiez que le jour, le mois et l'année sont corrects (ex : 30/04/2026).");
      return;
    }
    const updated: Task = {
      ...task!,
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      startDate: startDate.trim() || undefined,
      deadline: deadline.trim() || task!.deadline,
      assignee: assignee.trim() || task!.assignee,
      company: company.trim(),
      progress: Math.min(100, Math.max(0, parseInt(progress) || 0)),
    };
    updateTask(updated);
    Alert.alert('Tâche mise à jour', `"${updated.title}" a été enregistrée.`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  function handleDelete() {
    Alert.alert(
      'Supprimer la tâche',
      `Voulez-vous vraiment supprimer "${task!.title}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: () => {
            deleteTask(task!.id);
            router.back();
          },
        },
      ]
    );
  }

  function handleAddComment() {
    if (!newComment.trim()) return;
    addTaskComment(task!.id, newComment.trim(), user?.name ?? 'Utilisateur');
    setNewComment('');
  }

  return (
    <View style={styles.container}>
      <Header
        title={permissions.canEdit ? 'Modifier la tâche' : 'Détails de la tâche'}
        showBack
        rightLabel={permissions.canEdit ? 'Enregistrer' : undefined}
        onRightPress={permissions.canEdit ? handleSave : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {linkedReserve && (
          <TouchableOpacity
            style={styles.reserveLink}
            onPress={() => router.push(`/reserve/${linkedReserve.id}` as any)}
            activeOpacity={0.75}
          >
            <View style={styles.reserveLinkLeft}>
              <Ionicons name="warning" size={16} color={C.open} />
              <View>
                <Text style={styles.reserveLinkLabel}>Réserve liée</Text>
                <Text style={styles.reserveLinkId}>{linkedReserve.id} — {linkedReserve.title}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informations générales</Text>

          <Text style={styles.label}>Titre *</Text>
          <TextInput
            style={styles.input}
            placeholder="Titre de la tâche"
            placeholderTextColor={C.textMuted}
            value={title}
            onChangeText={setTitle}
            editable={permissions.canEdit}
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Description détaillée..."
            placeholderTextColor={C.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            editable={permissions.canEdit}
          />

          <Text style={styles.label}>Responsable</Text>
          <TextInput
            style={styles.input}
            placeholder="Nom du responsable"
            placeholderTextColor={C.textMuted}
            value={assignee}
            onChangeText={setAssignee}
            editable={permissions.canEdit}
          />

          <Text style={styles.label}>Entreprise</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {companies.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.chip, company === c.id && { backgroundColor: C.primaryBg, borderColor: C.primary }]}
                  onPress={() => permissions.canEdit && setCompany(c.id)}
                >
                  <Text style={[styles.chipText, company === c.id && { color: C.primary }]}>{c.shortName}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <DateInput
            label="Date de début"
            value={startDate}
            onChange={permissions.canEdit ? setStartDate : () => {}}
            optional
          />

          <DateInput
            label="Échéance"
            value={deadline}
            onChange={permissions.canEdit ? setDeadline : () => {}}
          />

          <Text style={styles.label}>Avancement (%)</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={C.textMuted}
            value={progress}
            onChangeText={setProgress}
            keyboardType="number-pad"
            editable={permissions.canEdit}
          />
        </View>

        {permissions.canEdit && (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Statut</Text>
              <View style={styles.optionGrid}>
                {STATUS_OPTS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.optionBtn, status === opt.value && { backgroundColor: opt.color + '20', borderColor: opt.color }]}
                    onPress={() => setStatus(opt.value)}
                  >
                    <View style={[styles.optionDot, { backgroundColor: opt.color }]} />
                    <Text style={[styles.optionLabel, status === opt.value && { color: opt.color }]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Priorité</Text>
              <View style={styles.optionGrid}>
                {PRIORITY_OPTS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.optionBtn, priority === opt.value && { backgroundColor: opt.color + '20', borderColor: opt.color }]}
                    onPress={() => setPriority(opt.value)}
                  >
                    <View style={[styles.optionDot, { backgroundColor: opt.color }]} />
                    <Text style={[styles.optionLabel, priority === opt.value && { color: opt.color }]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.saveBtnText}>Enregistrer les modifications</Text>
            </TouchableOpacity>

            {permissions.canDelete && (
              <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.85}>
                <Ionicons name="trash-outline" size={18} color={C.open} />
                <Text style={styles.deleteBtnText}>Supprimer cette tâche</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Commentaires ({task.comments?.length ?? 0})</Text>
          {(task.comments ?? []).length === 0 && (
            <Text style={styles.emptyComments}>Aucun commentaire — soyez le premier à commenter.</Text>
          )}
          {(task.comments ?? []).map(c => (
            <View key={c.id} style={styles.commentItem}>
              <View style={styles.commentHeader}>
                <View style={styles.commentAvatar}>
                  <Text style={styles.commentAvatarText}>{c.author.charAt(0)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.commentAuthor}>{c.author}</Text>
                  <Text style={styles.commentDate}>{c.createdAt}</Text>
                </View>
              </View>
              <Text style={styles.commentText}>{c.text}</Text>
            </View>
          ))}
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              placeholder="Ajouter un commentaire..."
              placeholderTextColor={C.textMuted}
              value={newComment}
              onChangeText={setNewComment}
              multiline
            />
            <TouchableOpacity
              style={[styles.commentSendBtn, !newComment.trim() && { opacity: 0.4 }]}
              onPress={handleAddComment}
              disabled={!newComment.trim()}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {(task.history ?? []).length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Historique des modifications</Text>
            {[...(task.history ?? [])].reverse().map((h, idx) => (
              <View key={idx} style={styles.historyItem}>
                <View style={styles.historyDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyText}>{h.action}</Text>
                  <Text style={styles.historyMeta}>{h.author} — {h.date}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFoundText: { fontSize: 16, fontFamily: 'Inter_400Regular', color: C.textMuted },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  optionDot: { width: 8, height: 8, borderRadius: 4 },
  optionLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, marginTop: 4 },
  saveBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14, marginTop: 10, borderWidth: 1.5, borderColor: C.open },
  deleteBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.open },
  reserveLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.open + '10', borderRadius: 12, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: C.open + '30',
  },
  reserveLinkLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  reserveLinkLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.open, textTransform: 'uppercase', letterSpacing: 0.4 },
  reserveLinkId: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text, marginTop: 2 },
  emptyComments: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic', marginBottom: 12 },
  commentItem: { backgroundColor: C.surface2, borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  commentAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  commentAvatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary },
  commentAuthor: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  commentDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  commentText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20 },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 },
  commentInput: { flex: 1, backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border, maxHeight: 100 },
  commentSendBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  historyItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.textMuted, marginTop: 5 },
  historyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 18 },
  historyMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
});
