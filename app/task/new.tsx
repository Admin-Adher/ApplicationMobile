import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import CompanySelector from '@/components/CompanySelector';
import DictationTextInput from '@/components/DictationTextInput';
import { Task, TaskStatus, ReservePriority } from '@/constants/types';
import { validateDeadline } from '@/lib/reserveUtils';
import { genId, formatDateFR, nowTimestampFR } from '@/lib/utils';

const STATUS_OPTS: { value: TaskStatus; labelKey: string; color: string; icon: string }[] = [
  { value: 'todo',        labelKey: 'taskLabels.status.todo',        color: C.textMuted,  icon: 'ellipse-outline' },
  { value: 'in_progress', labelKey: 'taskLabels.status.in_progress', color: C.inProgress, icon: 'play-circle-outline' },
  { value: 'done',        labelKey: 'taskLabels.status.done',        color: C.closed,     icon: 'checkmark-circle-outline' },
  { value: 'delayed',     labelKey: 'taskLabels.status.delayed',     color: C.waiting,    icon: 'alert-circle-outline' },
];

const PRIORITY_OPTS: { value: ReservePriority; labelKey: string; color: string; icon: string }[] = [
  { value: 'low',      labelKey: 'taskLabels.priority.low',      color: '#22C55E', icon: 'arrow-down-outline' },
  { value: 'medium',   labelKey: 'taskLabels.priority.medium',   color: '#F59E0B', icon: 'remove-outline' },
  { value: 'high',     labelKey: 'taskLabels.priority.high',     color: '#EF4444', icon: 'arrow-up-outline' },
  { value: 'critical', labelKey: 'taskLabels.priority.critical', color: '#7C3AED', icon: 'flame-outline' },
];

const PROGRESS_PRESETS = [0, 25, 50, 75, 100];

export default function NewTaskScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { reserveId } = useLocalSearchParams<{ reserveId?: string }>();
  const { addTask, reserves, updateReserveFields, companies, activeChantierId } = useApp();
  const { user, permissions } = useAuth();

  const sourceReserve = reserveId ? reserves.find(r => r.id === reserveId) : null;

  // Resolve pre-selected company from the source reserve
  const defaultCompanyId = companies.find(c => c.name === sourceReserve?.company)?.id
    ?? companies[0]?.id
    ?? '';

  const [title, setTitle]           = useState(sourceReserve ? t('taskForm.liftTitle', { title: sourceReserve.title }) : '');
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
        <Text style={styles.accessDeniedTitle}>{t('taskForm.accessDeniedTitle')}</Text>
        <Text style={styles.accessDeniedSub}>{t('taskForm.accessDeniedText')}</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.accessDeniedBtn}>
          <Text style={styles.accessDeniedBtnText}>{t('visits.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = t('taskForm.titleRequired');
    if (startDate.trim() && !validateDeadline(startDate.trim()))
      e.startDate = t('taskForm.invalidStartDate');
    if (deadline.trim() && !validateDeadline(deadline.trim()))
      e.deadline = t('taskForm.invalidDeadline');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSave() {
    if (isSaving) return;
    if (!validate()) return;
    if (!activeChantierId) {
      setErrors(e => ({ ...e, _chantier: t('taskForm.noActiveProject') }));
      return;
    }

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
      assignee: assignee.trim() || (user?.name ?? t('taskForm.teamFallback')),
      company: selectedCompany?.name ?? companyId,
      progress,
      reserveId: sourceReserve?.id,
      chantierId: activeChantierId ?? undefined,
      comments: [],
      history: [{
        id: genId(),
        action: t('taskForm.taskCreatedHistory'),
        author: user?.name ?? t('taskForm.systemFallback'),
        createdAt: nowTimestampFR(),
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
        title={t('taskForm.newTitle')}
        showBack
        rightLabel={t('common.save')}
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
              {t('taskForm.linkedToReserve')} <Text style={styles.reserveBannerTitle}>{sourceReserve.title}</Text>
            </Text>
          </View>
        )}

        {/* ── Section 1 : Informations générales ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('taskForm.generalInfo')}</Text>

          <Text style={styles.label}>{t('taskForm.titleLabel')}</Text>
          <DictationTextInput
            inputStyle={[styles.input, errors.title && styles.inputError]}
            placeholder={t('taskForm.titlePlaceholder')}
            placeholderTextColor={C.textMuted}
            value={title}
            onChangeText={t => { setTitle(t); if (errors.title) setErrors(p => ({ ...p, title: '' })); }}
            textAssistEnabled
            textAssistContext="description"
          />
          {errors.title ? <Text style={styles.errorText}>{errors.title}</Text> : null}

          <Text style={styles.label}>{t('taskForm.description')}</Text>
          <DictationTextInput
            inputStyle={[styles.input, styles.multiline]}
            placeholder={t('taskForm.descriptionPlaceholder')}
            placeholderTextColor={C.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            textAssistEnabled
            textAssistContext="description"
          />
        </View>

        {/* ── Section 2 : Planification ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('taskForm.planning')}</Text>

          <DateInput
            label={t('taskForm.startDate')}
            value={startDate}
            onChange={v => { setStartDate(v); if (errors.startDate) setErrors(p => ({ ...p, startDate: '' })); }}
            optional
          />
          {errors.startDate ? <Text style={styles.errorText}>{errors.startDate}</Text> : null}

          <DateInput
            label={t('taskForm.deadline')}
            value={deadline}
            onChange={v => { setDeadline(v); if (errors.deadline) setErrors(p => ({ ...p, deadline: '' })); }}
          />
          {errors.deadline ? <Text style={styles.errorText}>{errors.deadline}</Text> : null}
        </View>

        {/* ── Section 3 : Affectation ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('taskForm.assignment')}</Text>

          {/* Entreprise */}
          <Text style={styles.label}>{t('taskForm.company')}</Text>
          <CompanySelector
            mode="single"
            identifier="id"
            companies={companies}
            value={companyId === '' ? null : companyId}
            onChange={(v) => setCompanyId(v ?? '')}
            allowNone
            noneLabel={t('companySelector.none')}
            emptyText={t('companySelector.empty')}
          />

          {/* Responsable */}
          <Text style={[styles.label, { marginTop: 14 }]}>{t('taskForm.assignee')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('taskForm.assigneePlaceholder')}
            placeholderTextColor={C.textMuted}
            value={assignee}
            onChangeText={setAssignee}
          />
        </View>

        {/* ── Section 4 : Statut & Priorité ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('taskForm.status')}</Text>
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
                    {t(opt.labelKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('taskForm.priority')}</Text>
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
                    {t(opt.labelKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Section 5 : Avancement ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('taskForm.progress')}</Text>

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
            <Text style={styles.progressInputLabel}>{t('taskForm.exactValue')}</Text>
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

        {/* ── Chantier error ── */}
        {errors._chantier ? (
          <View style={styles.chantierError}>
            <Ionicons name="warning-outline" size={15} color="#EF4444" />
            <Text style={styles.chantierErrorText}>{errors._chantier}</Text>
          </View>
        ) : null}

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
                <Text style={styles.saveBtnText}>{t('taskForm.createTask')}</Text>
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

  // Chantier error
  chantierError: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF2F2', borderRadius: 10,
    borderWidth: 1, borderColor: '#EF444440',
    paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12,
  },
  chantierErrorText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: '#EF4444' },

  // Save
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, marginTop: 4,
    shadowColor: C.primary, shadowOpacity: 0.25, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10,
    elevation: 3,
  },
  saveBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
