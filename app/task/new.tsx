import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform,
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
import { genId, formatDateFR } from '@/lib/utils';

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

export default function NewTaskScreen() {
  const router = useRouter();
  const { reserveId } = useLocalSearchParams<{ reserveId?: string }>();
  const { addTask, reserves, updateReserveFields, companies, activeChantierId } = useApp();
  const { user, permissions } = useAuth();

  const sourceReserve = reserveId ? reserves.find(r => r.id === reserveId) : null;

  // Resolve pre-selected company from the source reserve
  const defaultCompanyId = companies.find(c => c.name === sourceReserve?.company)?.id
    ?? companies[0]?.id
    ?? '';

  const [title, setTitle]           = useState(sourceReserve ? `Lever : ${sourceReserve.title}` : '');
  const [description, setDescription] = useState(sourceReserve?.description ?? '');
  const [status, setStatus]         = useState<TaskStatus>('todo');
  const [priority, setPriority]     = useState<ReservePriority>(sourceReserve?.priority ?? 'medium');
  const [startDate, setStartDate]   = useState('');
  const [deadline, setDeadline]     = useState(
    sourceReserve?.deadline && sourceReserve.deadline !== '—' ? sourceReserve.deadline : ''
  );
  const [assignee, setAssignee]     = useState(user?.name ?? '');
  const [companyId, setCompanyId]   = useState(defaultCompanyId);
  const [progress, setProgress]     = useState(0);
  const [isSaving, setIsSaving]     = useState(false);
  const [errors, setErrors]         = useState<Record<string, string>>({});

  if (!permissions.canCreate) {
    return (
      <View style={styles.accessDenied}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={styles.accessDeniedTitle}>Accès refusé</Text>
        <Text style={styles.accessDeniedSub}>Votre rôle ne permet pas de créer des tâches.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.accessDeniedBtn}>
          <Text style={styles.accessDeniedBtnText}>Retour</Text>
        </TouchableOpacity>
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
    if (isSaving) return;
    if (!validate()) return;

    setIsSaving(true);

    const fallbackDeadline = (() => {
      const d = new Date(Date.now() + 7 * 86400000);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    })();

    const selectedCompany = companies.find(c => c.id === companyId);

    const newId = genId();
    const task: Task = {
      id: newId,
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      startDate: startDate.trim() || undefined,
      deadline: deadline.trim() || fallbackDeadline,
      assignee: assignee.trim() || (user?.name ?? 'Équipe'),
      company: selectedCompany?.name ?? companyId,
      progress,
      reserveId: sourceReserve?.id,
      chantierId: activeChantierId ?? undefined,
      comments: [],
      history: [{
        id: genId(),
        action: 'Tâche créée',
        author: user?.name ?? 'Système',
        createdAt: formatDateFR(new Date()),
      }],
      createdAt: formatDateFR(new Date()),
    };

    addTask(task);

    if (sourceReserve) {
      updateReserveFields({ ...sourceReserve, linkedTaskId: newId });
    }

    setIsSaving(false);
    router.back();
  }

  const selectedCompany = companies.find(c => c.id === companyId);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Header
        title="Nouvelle tâche"
        showBack
        rightLabel="Enregistrer"
        onRightPress={handleSave}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Source reserve banner ── */}
        {sourceReserve && (
          <View style={styles.reserveBanner}>
            <Ionicons name="link-outline" size={15} color={C.primary} />
            <Text style={styles.reserveBannerText} numberOfLines={2}>
              Liée à la réserve : <Text style={styles.reserveBannerTitle}>{sourceReserve.title}</Text>
            </Text>
          </View>
        )}

        {/* ── Section 1 : Informations générales ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informations générales</Text>

          <Text style={styles.label}>Titre *</Text>
          <TextInput
            style={[styles.input, errors.title && styles.inputError]}
            placeholder="Titre de la tâche"
            placeholderTextColor={C.textMuted}
            value={title}
            onChangeText={t => { setTitle(t); if (errors.title) setErrors(p => ({ ...p, title: '' })); }}
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
          />
        </View>

        {/* ── Section 2 : Planification ── */}
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

        {/* ── Section 3 : Affectation ── */}
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
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 14 }}
            >
              <View style={{ flexDirection: 'row', gap: 8, paddingRight: 4 }}>
                {/* None option */}
                <TouchableOpacity
                  style={[styles.companyChip, companyId === '' && styles.companyChipNoneActive]}
                  onPress={() => setCompanyId('')}
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
                      onPress={() => setCompanyId(c.id)}
                    >
                      <View style={[styles.companyDot, { backgroundColor: c.color }]} />
                      <Text style={[styles.companyChipText, active && { color: c.color, fontFamily: 'Inter_600SemiBold' }]}>
                        {c.shortName}
                      </Text>
                      {active && (
                        <Ionicons name="checkmark-circle" size={13} color={c.color} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          )}

          {/* Selected company summary */}
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
          />
        </View>

        {/* ── Section 4 : Statut & Priorité ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Statut</Text>
          <View style={styles.optionGrid}>
            {STATUS_OPTS.map(opt => {
              const active = status === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionBtn, active && { backgroundColor: opt.color + '18', borderColor: opt.color }]}
                  onPress={() => setStatus(opt.value)}
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

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Priorité</Text>
          <View style={styles.optionGrid}>
            {PRIORITY_OPTS.map(opt => {
              const active = priority === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionBtn, active && { backgroundColor: opt.color + '18', borderColor: opt.color }]}
                  onPress={() => setPriority(opt.value)}
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

        {/* ── Section 5 : Avancement ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Avancement</Text>

          {/* Progress bar */}
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progress}%` as any }]} />
          </View>
          <Text style={styles.progressPct}>{progress}%</Text>

          {/* Preset buttons */}
          <View style={styles.progressPresets}>
            {PROGRESS_PRESETS.map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.progressPresetBtn, progress === p && styles.progressPresetBtnActive]}
                onPress={() => setProgress(p)}
              >
                <Text style={[styles.progressPresetText, progress === p && styles.progressPresetTextActive]}>
                  {p}%
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom input */}
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
            />
            <Text style={styles.progressInputPct}>%</Text>
          </View>
        </View>

        {/* ── Save button ── */}
        <TouchableOpacity
          style={[styles.saveBtn, isSaving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          {isSaving
            ? <ActivityIndicator size="small" color="#fff" />
            : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.saveBtnText}>Créer la tâche</Text>
              </>
            )
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48 },

  // Access denied
  accessDenied: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 },
  accessDeniedTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, textAlign: 'center' },
  accessDeniedSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 8, textAlign: 'center' },
  accessDeniedBtn: { marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 },
  accessDeniedBtnText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  // Reserve linkage banner
  reserveBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.primaryBg, borderRadius: 10,
    borderWidth: 1, borderColor: C.primary + '40',
    paddingVertical: 10, paddingHorizontal: 12,
    marginBottom: 14,
  },
  reserveBannerText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  reserveBannerTitle: { fontFamily: 'Inter_600SemiBold', color: C.text },

  // Cards / sections
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

  // Inputs
  input: {
    backgroundColor: C.surface2, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  inputError: { borderColor: '#EF4444' },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  errorText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#EF4444', marginTop: -8, marginBottom: 10 },

  // Company chips
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
  },
  companyChipNoneActive: {
    backgroundColor: C.surface2,
    borderColor: C.textSub, borderWidth: 1.5,
  },
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

  // Status / Priority grid
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
  },
  optionLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },

  // Progress
  progressBarBg: {
    height: 8, backgroundColor: C.border, borderRadius: 4,
    overflow: 'hidden', marginBottom: 6,
  },
  progressBarFill: {
    height: 8, borderRadius: 4, backgroundColor: C.primary,
  },
  progressPct: {
    fontSize: 22, fontFamily: 'Inter_700Bold', color: C.primary,
    textAlign: 'center', marginBottom: 14,
  },
  progressPresets: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginBottom: 14,
  },
  progressPresetBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
    alignItems: 'center',
  },
  progressPresetBtnActive: {
    backgroundColor: C.primaryBg, borderColor: C.primary,
  },
  progressPresetText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  progressPresetTextActive: { color: C.primary },
  progressInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  progressInputLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  progressInput: {
    width: 60, backgroundColor: C.surface2, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text,
    borderWidth: 1, borderColor: C.border, textAlign: 'center',
  },
  progressInputPct: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },

  // Save
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, marginTop: 4,
    shadowColor: C.primary, shadowOpacity: 0.25, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10,
    elevation: 3,
  },
  saveBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
