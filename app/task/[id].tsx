import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
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

const STATUS_OPTS: { value: TaskStatus; label: string; color: string; icon: string }[] = [
  { value: 'todo',        label: 'À faire',   color: C.textMuted,  icon: 'ellipse-outline' },
  { value: 'in_progress', label: 'En cours',  color: C.inProgress, icon: 'play-circle-outline' },
  { value: 'done',        label: 'Terminé',   color: C.closed,     icon: 'checkmark-circle-outline' },
  { value: 'delayed',     label: 'En retard', color: C.waiting,    icon: 'alert-circle-outline' },
];

const PRIORITY_OPTS: { value: ReservePriority; label: string; color: string; icon: string }[] = [
  { value: 'low',      label: 'Faible',   color: '#22C55E', icon: 'arrow-down-outline' },
  { value: 'medium',   label: 'Moyen',    color: '#F59E0B', icon: 'remove-outline' },
  { value: 'high',     label: 'Élevé',    color: '#EF4444', icon: 'arrow-up-outline' },
  { value: 'critical', label: 'Critique', color: '#7C3AED', icon: 'flame-outline' },
];

const PROGRESS_PRESETS = [0, 25, 50, 75, 100];

export default function EditTaskScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tasks, reserves, updateTask, deleteTask, companies, addTaskComment } = useApp();
  const { user, permissions } = useAuth();

  const task = tasks.find(t => t.id === id);
  const linkedReserve = task?.reserveId ? reserves.find(r => r.id === task.reserveId) : null;

  // Resolve company ID from whatever is stored (could be ID or name for legacy tasks)
  const resolvedCompanyId = (() => {
    const stored = task?.company ?? '';
    if (!stored) return companies[0]?.id ?? '';
    const byId = companies.find(c => c.id === stored);
    if (byId) return byId.id;
    const byName = companies.find(c => c.name === stored);
    if (byName) return byName.id;
    return '';
  })();

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
  const [priority, setPriority] = useState<ReservePriority>(task?.priority ?? 'medium');
  const [startDate, setStartDate] = useState(() => {
    const raw = task?.startDate;
    if (!raw) return '';
    if (raw.includes('/')) return raw;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  });
  const [deadline, setDeadline] = useState(task?.deadline ?? '');
  const [assignee, setAssignee] = useState(task?.assignee ?? '');
  const [companyId, setCompanyId] = useState(resolvedCompanyId);
  const [progress, setProgress] = useState(task?.progress ?? 0);
  const [newComment, setNewComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (user?.role === 'sous_traitant') {
    return (
      <View style={styles.container}>
        <Header title="Accès restreint" showBack />
        <View style={styles.notFound}>
          <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
          <Text style={styles.notFoundText}>Les sous-traitants n'ont pas accès au planning des tâches.</Text>
        </View>
      </View>
    );
  }

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

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = 'Le titre est obligatoire.';
    if (startDate.trim() && !validateDeadline(startDate.trim()))
      e.startDate = 'Format invalide (ex : 01/04/2026).';
    if (deadline.trim() && !validateDeadline(deadline.trim()))
      e.deadline = 'Format invalide (ex : 30/04/2026).';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSave() {
    if (!validate()) return;
    const selectedCompany = companies.find(c => c.id === companyId);
    const updated: Task = {
      ...task!,
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      startDate: startDate.trim() || undefined,
      deadline: deadline.trim() || task!.deadline,
      assignee: assignee.trim() || task!.assignee,
      company: selectedCompany?.name ?? companyId,
      progress,
    };
    updateTask(updated);
    router.back();
  }

  function handleDelete() {
    Alert.alert(
      'Supprimer la tâche',
      `Voulez-vous vraiment supprimer "${task!.title}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: () => { deleteTask(task!.id); router.back(); },
        },
      ]
    );
  }

  function handleAddComment() {
    if (!newComment.trim()) return;
    addTaskComment(task!.id, newComment.trim(), user?.name ?? 'Utilisateur');
    setNewComment('');
  }

  const selectedCompany = companies.find(c => c.id === companyId);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Header
        title={permissions.canEdit ? 'Modifier la tâche' : 'Détails de la tâche'}
        showBack
        rightLabel={permissions.canEdit ? 'Enregistrer' : undefined}
        onRightPress={permissions.canEdit ? handleSave : undefined}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Linked reserve banner ── */}
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
                <Text style={styles.reserveLinkId}>{linkedReserve.title}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}

        {/* ── Informations générales ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informations générales</Text>

          <Text style={styles.label}>Titre *</Text>
          <TextInput
            style={[styles.input, errors.title && styles.inputError]}
            placeholder="Titre de la tâche"
            placeholderTextColor={C.textMuted}
            value={title}
            onChangeText={t => { setTitle(t); if (errors.title) setErrors(p => ({ ...p, title: '' })); }}
            editable={permissions.canEdit}
          />
          {errors.title ? <Text style={styles.errorText}>{errors.title}</Text> : null}

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
        </View>

        {/* ── Planification ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Planification</Text>

          <DateInput
            label="Date de début"
            value={startDate}
            onChange={v => { setStartDate(v); if (errors.startDate) setErrors(p => ({ ...p, startDate: '' })); }}
            optional
          />
          {errors.startDate ? <Text style={styles.errorText}>{errors.startDate}</Text> : null}

          <DateInput
            label="Échéance"
            value={deadline}
            onChange={v => { setDeadline(v); if (errors.deadline) setErrors(p => ({ ...p, deadline: '' })); }}
          />
          {errors.deadline ? <Text style={styles.errorText}>{errors.deadline}</Text> : null}
        </View>

        {/* ── Affectation ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Affectation</Text>

          {/* Entreprise */}
          <Text style={styles.label}>Entreprise</Text>
          {companies.length === 0 ? (
            <View style={styles.emptyCompanies}>
              <Ionicons name="business-outline" size={14} color={C.textMuted} />
              <Text style={styles.emptyCompaniesText}>Aucune entreprise enregistrée</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8, paddingRight: 4 }}>
                {/* None */}
                <TouchableOpacity
                  style={[styles.companyChip, companyId === '' && styles.companyChipNoneActive]}
                  onPress={() => permissions.canEdit && setCompanyId('')}
                >
                  <Text style={[styles.companyChipText, companyId === '' && { color: C.textSub, fontFamily: 'Inter_600SemiBold' }]}>
                    Aucune
                  </Text>
                </TouchableOpacity>

                {companies.map(c => {
                  const active = companyId === c.id;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[
                        styles.companyChip,
                        active && { backgroundColor: c.color + '18', borderColor: c.color, borderWidth: 1.5 },
                      ]}
                      onPress={() => permissions.canEdit && setCompanyId(c.id)}
                    >
                      <View style={[styles.companyDot, { backgroundColor: c.color }]} />
                      <Text style={[styles.companyChipText, active && { color: c.color, fontFamily: 'Inter_600SemiBold' }]}>
                        {c.shortName}
                      </Text>
                      {active && <Ionicons name="checkmark-circle" size={13} color={c.color} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          )}

          {selectedCompany && (
            <View style={[styles.companyPreview, { borderLeftColor: selectedCompany.color }]}>
              <View style={[styles.companyPreviewDot, { backgroundColor: selectedCompany.color }]} />
              <Text style={styles.companyPreviewName}>{selectedCompany.name}</Text>
            </View>
          )}

          {/* Responsable */}
          <Text style={[styles.label, { marginTop: 14 }]}>Responsable</Text>
          <TextInput
            style={styles.input}
            placeholder="Nom du responsable"
            placeholderTextColor={C.textMuted}
            value={assignee}
            onChangeText={setAssignee}
            editable={permissions.canEdit}
          />
        </View>

        {/* ── Statut ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Statut</Text>
          <View style={styles.optionGrid}>
            {STATUS_OPTS.map(opt => {
              const active = status === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionBtn, active && { backgroundColor: opt.color + '18', borderColor: opt.color }]}
                  onPress={() => permissions.canEdit && setStatus(opt.value)}
                >
                  <Ionicons name={opt.icon as any} size={15} color={active ? opt.color : C.textMuted} />
                  <Text style={[styles.optionLabel, active && { color: opt.color, fontFamily: 'Inter_600SemiBold' }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Priorité ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Priorité</Text>
          <View style={styles.optionGrid}>
            {PRIORITY_OPTS.map(opt => {
              const active = priority === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionBtn, active && { backgroundColor: opt.color + '18', borderColor: opt.color }]}
                  onPress={() => permissions.canEdit && setPriority(opt.value)}
                >
                  <Ionicons name={opt.icon as any} size={15} color={active ? opt.color : C.textMuted} />
                  <Text style={[styles.optionLabel, active && { color: opt.color, fontFamily: 'Inter_600SemiBold' }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Avancement ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Avancement</Text>

          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progress}%` as any }]} />
          </View>
          <Text style={styles.progressPct}>{progress}%</Text>

          <View style={styles.progressPresets}>
            {PROGRESS_PRESETS.map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.progressPresetBtn, progress === p && styles.progressPresetBtnActive]}
                onPress={() => permissions.canEdit && setProgress(p)}
              >
                <Text style={[styles.progressPresetText, progress === p && styles.progressPresetTextActive]}>
                  {p}%
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.progressInputRow}>
            <Text style={styles.progressInputLabel}>Valeur précise :</Text>
            <TextInput
              style={styles.progressInput}
              value={String(progress)}
              onChangeText={v => {
                const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
                setProgress(isNaN(n) ? 0 : Math.min(100, Math.max(0, n)));
              }}
              keyboardType="number-pad"
              maxLength={3}
              editable={permissions.canEdit}
            />
            <Text style={styles.progressInputPct}>%</Text>
          </View>
        </View>

        {/* ── Actions ── */}
        {permissions.canEdit && (
          <>
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

        {/* ── Commentaires ── */}
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
              <Text style={styles.commentText}>{c.content}</Text>
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

        {/* ── Historique ── */}
        {(task.history ?? []).length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Historique des modifications</Text>
            {[...(task.history ?? [])].reverse().map((h, idx) => (
              <View key={idx} style={styles.historyItem}>
                <View style={styles.historyDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyText}>{h.action}</Text>
                  <Text style={styles.historyMeta}>{h.author} — {h.createdAt}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48 },

  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFoundText: { fontSize: 16, fontFamily: 'Inter_400Regular', color: C.textMuted },

  card: {
    backgroundColor: C.surface, borderRadius: 14,
    padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: C.border,
  },
  sectionTitle: {
    fontSize: 12, fontFamily: 'Inter_700Bold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 14,
  },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6, marginTop: 2 },

  input: {
    backgroundColor: C.surface2, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  inputError: { borderColor: '#EF4444' },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  errorText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#EF4444', marginTop: -8, marginBottom: 10 },

  // Reserve link
  reserveLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.open + '10', borderRadius: 12,
    padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: C.open + '30',
  },
  reserveLinkLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  reserveLinkLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.open, textTransform: 'uppercase', letterSpacing: 0.4 },
  reserveLinkId: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text, marginTop: 2 },

  // Company
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
  },
  companyChipNoneActive: { borderColor: C.textSub, borderWidth: 1.5 },
  companyChipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  companyDot: { width: 9, height: 9, borderRadius: 5 },
  companyPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 10, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 4, marginBottom: 2,
  },
  companyPreviewDot: { width: 10, height: 10, borderRadius: 5 },
  companyPreviewName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text, flex: 1 },
  emptyCompanies: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: C.surface2, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, marginBottom: 14,
  },
  emptyCompaniesText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },

  // Status / Priority
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
  },
  optionLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },

  // Progress
  progressBarBg: { height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressBarFill: { height: 8, borderRadius: 4, backgroundColor: C.primary },
  progressPct: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.primary, textAlign: 'center', marginBottom: 14 },
  progressPresets: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginBottom: 14 },
  progressPresetBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, alignItems: 'center',
  },
  progressPresetBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  progressPresetText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  progressPresetTextActive: { color: C.primary },
  progressInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressInputLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  progressInput: {
    width: 60, backgroundColor: C.surface2, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text,
    borderWidth: 1, borderColor: C.border, textAlign: 'center',
  },
  progressInputPct: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },

  // Actions
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, marginTop: 4,
    shadowColor: C.primary, shadowOpacity: 0.25, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10,
    elevation: 3,
  },
  saveBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 14, marginTop: 10,
    borderWidth: 1.5, borderColor: C.open,
  },
  deleteBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.open },

  // Comments
  emptyComments: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic', marginBottom: 12 },
  commentItem: { backgroundColor: C.surface2, borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  commentAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  commentAvatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary },
  commentAuthor: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  commentDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  commentText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20 },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 },
  commentInput: {
    flex: 1, backgroundColor: C.surface2, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    borderWidth: 1, borderColor: C.border, maxHeight: 100,
  },
  commentSendBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },

  // History
  historyItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.textMuted, marginTop: 5 },
  historyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 18 },
  historyMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
});
