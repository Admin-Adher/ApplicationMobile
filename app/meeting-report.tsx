import { buildMeetingHTML } from '@/lib/meetingReportHtml';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Platform, Modal, KeyboardAvoidingView } from 'react-native';
import DateInput from '@/components/DateInput';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import {
  exportPDF as exportPDFHelper,
} from '@/lib/pdfBase';
import { buildPdfFilename } from '@/lib/pdfFilename';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSettings } from '@/context/SettingsContext';
import { useApp } from '@/context/AppContext';
import Header from '@/components/Header';
import { MeetingReport, MeetingReportAction } from '@/constants/types';
import BottomNavBar from '@/components/BottomNavBar';
import { showAlert } from '@/lib/appAlert';
import PageContainer from '@/components/PageContainer';
import { genId, formatDateFR, nowTimestampFR } from '@/lib/utils';
import { formatDate } from '@/lib/reserveUtils';
import { getExportTranslator, localeForExportLanguage } from '@/lib/exportLanguage';
import { supabase } from '@/lib/supabase';
import { useProjectMeetingReports } from '@/hooks/useProjectMeetingReports';

const CRR_TEMPLATE_DEFS = [
  {
    id: 'hebdo',
    icon: 'calendar-outline' as const,
  },
  {
    id: 'reception',
    icon: 'ribbon-outline' as const,
  },
  {
    id: 'coordination',
    icon: 'people-outline' as const,
  },
  {
    id: 'synthese',
    icon: 'construct-outline' as const,
  },
];

const MEETING_KEY = 'buildtrack_meetings_v1';

export default function MeetingReportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, permissions } = useAuth();
  const { exportLanguage } = useLanguage();
  const { projectName } = useSettings();
  const { reserves, companies, activeChantierId, activeChantier } = useApp();
  const chantierId = activeChantierId ?? null;
  const allowed = user?.role !== 'sous_traitant' && user?.role !== 'magasinier';
  const shared = useProjectMeetingReports(
    { useState, useRef, useEffect, useCallback },
    supabase, allowed ? user?.id : undefined, user?.organizationId, chantierId, AsyncStorage,
  );
  const draftKey = user?.id ? `buildtrack_meetings_v2:${user.id}:${user.organizationId ?? ''}:${chantierId ?? ''}` : null;
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  const [drafts, setDrafts] = useState<{ key: string; reports: MeetingReport[] } | null>(null);
  const [legacyReports, setLegacyReports] = useState<MeetingReport[]>([]);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const sharedById = new Map(shared.rows.map(row => [row.report.id, row]));
  const localReports = drafts && drafts.key === draftKey ? drafts.reports : [];
  const reports = [...shared.rows.map(row => row.report), ...[...localReports, ...legacyReports].filter(report => !sharedById.has(report.id))];

  useEffect(() => {
    AsyncStorage.getItem(MEETING_KEY).then(raw => {
      const value = raw ? JSON.parse(raw) : [];
      if (Array.isArray(value)) setLegacyReports(value);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!draftKey) return;
    let current = true;
    AsyncStorage.getItem(draftKey).then(raw => {
      const value = raw ? JSON.parse(raw) : [];
      if (current && Array.isArray(value)) setDrafts({ key: draftKey, reports: value });
    }).catch(() => {});
    return () => { current = false; };
  }, [draftKey]);
  const [showNew, setShowNew] = useState(false);
  const [formScope, setFormScope] = useState(draftKey);
  const [editing, setEditing] = useState<{ report: MeetingReport; version?: number } | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState(formatDateFR(new Date()));
  const [location, setLocation] = useState('');
  const [participants, setParticipants] = useState('');
  const [agenda, setAgenda] = useState('');
  const [notes, setNotes] = useState('');
  const [decisions, setDecisions] = useState('');
  const [nextMeeting, setNextMeeting] = useState('');

  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [showAddAction, setShowAddAction] = useState(false);
  const [actionDesc, setActionDesc] = useState('');
  const [actionResp, setActionResp] = useState('');
  const [actionDeadline, setActionDeadline] = useState('');
  const [actionReserveId, setActionReserveId] = useState('');
  const [showReservePicker, setShowReservePicker] = useState(false);
  const crrTemplates = useMemo(() => CRR_TEMPLATE_DEFS.map(def => ({
    ...def,
    label: t(`meetingReport.templates.${def.id}.label`),
    subject: t(`meetingReport.templates.${def.id}.subject`),
    agenda: t(`meetingReport.templates.${def.id}.agenda`),
    agendaNote: t(`meetingReport.templates.${def.id}.agendaNote`),
  })), [t]);

  async function write(operation: () => Promise<boolean>) {
    if (writing.current || draftKeyRef.current !== draftKey) return false;
    writing.current = true;
    setBusy(true);
    try {
      if (!await operation()) throw new Error();
      return true;
    } catch {
      showAlert(t('common.error'), t('meetingReport.syncWriteFailed'));
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function storeLocal(reportId: string, update: (items: MeetingReport[]) => MeetingReport[]) {
    if (legacyReports.some(report => report.id === reportId)) {
      const next = update(legacyReports);
      await AsyncStorage.setItem(MEETING_KEY, JSON.stringify(next));
      setLegacyReports(next);
      return true;
    }
    if (!draftKey || drafts?.key !== draftKey) return false;
    const next = update(drafts.reports);
    await AsyncStorage.setItem(draftKey, JSON.stringify(next));
    setDrafts(current => current?.key === draftKey ? { key: draftKey, reports: next } : current);
    return true;
  }

  function updateReportData(reportId: string, updater: (r: MeetingReport) => MeetingReport) {
    if (!permissions.canEdit) return Promise.resolve(false);
    const row = sharedById.get(reportId);
    if (row) return write(() => shared.save(updater(row.report), 'update', row.version));
    return write(() => storeLocal(reportId, items => items.map(item => item.id === reportId ? updater(item) : item)));
  }

  async function addActionToReport(reportId: string) {
    if (!actionDesc.trim() || !actionResp.trim() || !actionDeadline.trim()) {
      showAlert(t('meetingReport.requiredFieldsTitle'), t('meetingReport.actionRequiredText'));
      return;
    }
    const action: MeetingReportAction = {
      id: genId(),
      description: actionDesc.trim(),
      responsible: actionResp.trim(),
      deadline: actionDeadline.trim(),
      status: 'pending',
      reserveId: actionReserveId.trim() || undefined,
    };
    if (!await updateReportData(reportId, r => ({ ...r, actions: [...r.actions, action] }))) return;
    setActionDesc(''); setActionResp(''); setActionDeadline(''); setActionReserveId('');
    setShowAddAction(false);
  }

  function toggleAction(reportId: string, actionId: string) {
    updateReportData(reportId, r => ({
      ...r,
      actions: r.actions.map(a =>
        a.id === actionId ? { ...a, status: a.status === 'done' ? 'pending' : 'done' } : a
      ),
    }));
  }

  function removeAction(reportId: string, actionId: string) {
    showAlert(t('meetingReport.deleteActionTitle'), t('meetingReport.deleteActionText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () =>
        void updateReportData(reportId, r => ({ ...r, actions: r.actions.filter(a => a.id !== actionId) }))
      },
    ]);
  }

  const chantierReserves = reserves.filter(r =>
    r.status !== 'closed' && (!activeChantierId || r.chantierId === activeChantierId)
  );

  const resetForm = () => {
    setEditing(null);
    setSubject(''); setDate(formatDateFR(new Date())); setLocation('');
    setParticipants(''); setAgenda(''); setNotes(''); setDecisions(''); setNextMeeting('');
  };

  function applyTemplate(tpl: typeof crrTemplates[number]) {
    const openReserves = reserves.filter(r => r.status !== 'closed' && (!activeChantierId || r.chantierId === activeChantierId));
    const companyNames = companies.map(c => c.name).join(', ');
    setSubject(tpl.subject + ' — ' + projectName);
    setAgenda(tpl.agenda);
    setNotes(tpl.agendaNote);
    if (tpl.id === 'hebdo') {
      setDecisions([
        t('meetingReport.templateDecisions.openReserves', { count: openReserves.length }),
        t('meetingReport.templateDecisions.nextWeekPlanning'),
      ].join('\n'));
    }
    if (companyNames) setParticipants(companyNames + (user?.name ? '\n' + user.name : ''));
    setShowTemplateModal(false);
    setFormScope(draftKey);
    setShowNew(true);
  }

  function openEditor(report: MeetingReport) {
    setEditing({ report, version: sharedById.get(report.id)?.version });
    setSubject(report.subject); setDate(report.date); setLocation(report.location);
    setParticipants(report.participants); setAgenda(report.agenda); setNotes(report.notes);
    setDecisions(report.decisions.join('\n')); setNextMeeting(report.nextMeeting);
    setFormScope(draftKey);
    setShowNew(true);
  }

  async function handleCreate() {
    if (editing ? !permissions.canEdit : !permissions.canCreate) return;
    if (formScope !== draftKey) {
      showAlert(t('common.error'), t('meetingReport.scopeChanged'));
      return;
    }
    if (!subject.trim()) {
      showAlert(t('meetingReport.requiredFieldTitle'), t('meetingReport.subjectRequired'));
      return;
    }
    const report: MeetingReport = {
      id: editing?.report.id ?? genId(),
      subject: subject.trim(),
      date,
      location: location.trim() || t('meetingReport.notSpecified'),
      participants: participants.trim() || t('meetingReport.notSpecified'),
      agenda: agenda.trim(),
      notes: notes.trim(),
      decisions: decisions.split('\n').map(s => s.trim()).filter(Boolean),
      actions: editing?.report.actions ?? [],
      nextMeeting: nextMeeting.trim(),
      redactedBy: editing?.report.redactedBy ?? user?.name ?? t('common.system'),
      createdAt: editing?.report.createdAt ?? nowTimestampFR(),
    };
    const saved = await write(() => editing?.version !== undefined || (!editing && shared.ready)
      ? shared.save(report, editing ? 'update' : 'create', editing?.version)
      : storeLocal(report.id, items => editing ? items.map(item => item.id === report.id ? report : item) : [report, ...items]));
    if (!saved) return;
    resetForm();
    setShowNew(false);
  }

  function shareReport(report: MeetingReport) {
    if (!activeChantier || !permissions.canCreate) return;
    showAlert(t('meetingReport.shareOnSite'), t('meetingReport.shareOnSiteConfirm', { project: activeChantier.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('meetingReport.shareOnSite'), onPress: () => void write(async () => {
        const actions = report.actions.map(action => action.reserveId && !reserves.some(reserve =>
          reserve.id === action.reserveId && reserve.chantierId === chantierId
        ) ? { ...action, reserveId: undefined } : action);
        if (!await shared.save({ ...report, actions }, 'create')) return false;
        return storeLocal(report.id, items => items.filter(item => item.id !== report.id));
      }) },
    ]);
  }

  function deleteReport(report: MeetingReport) {
    if (!permissions.canDelete) return;
    showAlert(t('common.delete'), t('meetingReport.deleteReportConfirm', { subject: report.subject }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void write(() => sharedById.has(report.id)
        ? shared.remove(report.id) : storeLocal(report.id, items => items.filter(item => item.id !== report.id))) },
    ]);
  }

  async function handleExportPDF(report: MeetingReport) {
    if (!permissions.canExport) {
      showAlert(t('documentsScreen.accessDenied'), t('meetingReport.exportDenied'));
      return;
    }
    try {
      const exportT = getExportTranslator(exportLanguage) as unknown as (key: string, options?: any) => string;
      const html = buildMeetingHTML(report, projectName, companies, exportT, localeForExportLanguage(exportLanguage));
      await exportPDFHelper(html, buildPdfFilename('CR_Reunion', [report.subject, report.location, projectName, exportLanguage.toUpperCase()]));
    } catch (e: any) {
      showAlert(t('common.error'), e?.message ?? t('meetingReport.pdfError'));
    }
  }

  if (!allowed) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color="#94A3B8" />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#1E293B', marginTop: 16, textAlign: 'center' }}>{t('common.restrictedAccess')}</Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: '#94A3B8', marginTop: 8, textAlign: 'center' }}>
          {t('meetingReport.subcontractorDenied')}
        </Text>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.navigate('/(tabs)/' as any)}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#2563EB', borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{t('pointage.backToDashboard')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header
        title={t('meetingReport.title')}
        subtitle={t('meetingReport.subtitle')}
        showBack
        rightLabel={permissions.canCreate ? (showNew ? t('common.cancel') : t('messages.new')) : undefined}
        onRightPress={permissions.canCreate ? () => { if (showNew) { setShowNew(false); resetForm(); } else { setFormScope(draftKey); setShowNew(true); } } : undefined}
      />

      <PageContainer maxWidth={1000}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {chantierId && (
          <TouchableOpacity style={styles.templateBanner} disabled={busy} onPress={() => void shared.refresh()}>
            <Ionicons name="refresh" size={18} color={C.primary} />
            <Text style={styles.templateBannerTitle}>{shared.failed && shared.rows.length ? 'Copie hors ligne · Lecture seule. Appuyez pour actualiser.' : t(shared.failed ? 'meetingReport.syncUnavailable' : 'meetingReport.refreshShared')}</Text>
          </TouchableOpacity>
        )}
        {!showNew && permissions.canCreate && (
          <TouchableOpacity style={styles.templateBanner} onPress={() => setShowTemplateModal(true)}>
            <Ionicons name="flash" size={18} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.templateBannerTitle}>{t('meetingReport.templateBannerTitle')}</Text>
              <Text style={styles.templateBannerSub}>{t('meetingReport.templateBannerSub')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}

        {showNew && (
          <View style={styles.card}>
            <View style={styles.formTopRow}>
              <Text style={styles.sectionTitle}>{t(editing ? 'meetingReport.editReport' : 'meetingReport.newReport')}</Text>
              {!editing && <TouchableOpacity style={styles.tplBtn} onPress={() => setShowTemplateModal(true)}>
                <Ionicons name="flash-outline" size={13} color={C.primary} />
                <Text style={styles.tplBtnText}>{t('meetingReport.template')}</Text>
              </TouchableOpacity>}
            </View>
            {!editing && <Text style={styles.reportMeta}>{t(shared.ready ? 'meetingReport.sharedReport' : 'meetingReport.localReport')}</Text>}
            <Text style={styles.label}>{t('meetingReport.subject')}</Text>
            <TextInput style={styles.input} placeholder={t('meetingReport.subjectPlaceholder')} placeholderTextColor={C.textMuted} value={subject} onChangeText={setSubject} />
            <Text style={styles.label}>{t('meetingReport.date')}</Text>
            <DateInput value={date} onChange={setDate} />
            <Text style={styles.label}>{t('meetingReport.location')}</Text>
            <TextInput style={styles.input} placeholder={t('meetingReport.locationPlaceholder')} placeholderTextColor={C.textMuted} value={location} onChangeText={setLocation} />
            <Text style={styles.label}>{t('meetingReport.participants')}</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder={t('meetingReport.participantsPlaceholder')} placeholderTextColor={C.textMuted} value={participants} onChangeText={setParticipants} multiline numberOfLines={3} />
            <Text style={styles.label}>{t('meetingReport.agenda')}</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder={t('meetingReport.agendaPlaceholder')} placeholderTextColor={C.textMuted} value={agenda} onChangeText={setAgenda} multiline numberOfLines={3} />
            <Text style={styles.label}>{t('meetingReport.notes')}</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder={t('meetingReport.notesPlaceholder')} placeholderTextColor={C.textMuted} value={notes} onChangeText={setNotes} multiline numberOfLines={4} />
            <Text style={styles.label}>{t('meetingReport.decisionsLabel')}</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder={t('meetingReport.decisionsPlaceholder')} placeholderTextColor={C.textMuted} value={decisions} onChangeText={setDecisions} multiline numberOfLines={3} />
            <Text style={styles.label}>{t('meetingReport.nextMeeting')}</Text>
            <TextInput style={styles.input} placeholder={t('meetingReport.nextMeetingPlaceholder')} placeholderTextColor={C.textMuted} value={nextMeeting} onChangeText={setNextMeeting} />
            <TouchableOpacity style={styles.createBtn} disabled={busy} onPress={() => void handleCreate()}>
              <Ionicons name="document-text" size={18} color="#fff" />
              <Text style={styles.createBtnText}>{t(editing ? 'common.save' : 'meetingReport.createReport')}</Text>
            </TouchableOpacity>
            {editing && <TouchableOpacity disabled={busy} onPress={() => { resetForm(); setShowNew(false); }}><Text style={styles.tplBtnText}>{t('common.cancel')}</Text></TouchableOpacity>}
          </View>
        )}

        {reports.length === 0 && !showNew && (
          <View style={styles.emptyBox}>
            <Ionicons name="document-text-outline" size={52} color={C.border} />
            <Text style={styles.emptyTitle}>{t('meetingReport.emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t('meetingReport.emptyText')}</Text>
            {permissions.canCreate && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => { setFormScope(draftKey); setShowNew(true); }}>
                <Ionicons name="add-circle" size={18} color={C.primary} />
                <Text style={styles.emptyBtnText}>{t('meetingReport.newShort')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {reports.map(report => {
          const isExpanded = expandedReportId === report.id;
          const doneCount = report.actions.filter(a => a.status === 'done').length;
          const isShared = sharedById.has(report.id);
          return (
            <View key={report.id} style={styles.card}>
              <View style={styles.reportHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reportTitle}>{report.subject}</Text>
                  <Text style={styles.reportMeta}>{t(isShared ? 'meetingReport.sharedReport' : 'meetingReport.localReport')}</Text>
                  <Text style={styles.reportMeta}>{report.date} — {report.location}</Text>
                  <Text style={styles.reportMeta}>
                    {t('meetingReport.redactedBy', { name: report.redactedBy })}
                    {report.createdAt ? t('meetingReport.createdOn', { date: formatDate(report.createdAt) }) : ''}
                  </Text>
                </View>
                {permissions.canExport && (
                  <TouchableOpacity style={styles.pdfBtn} onPress={() => handleExportPDF(report)}>
                    <Ionicons name="download-outline" size={14} color={C.primary} />
                    <Text style={styles.pdfBtnText}>PDF</Text>
                  </TouchableOpacity>
                )}
              </View>

              {permissions.canEdit && (!isShared || shared.ready) && !showNew && (
                <TouchableOpacity style={styles.addActionBtn} disabled={busy} onPress={() => openEditor(report)}><Text style={styles.addActionBtnText}>{t('meetingReport.editReport')}</Text></TouchableOpacity>
              )}
              {permissions.canCreate && !isShared && shared.ready && (
                <TouchableOpacity style={styles.addActionBtn} disabled={busy} onPress={() => shareReport(report)}><Text style={styles.addActionBtnText}>{t('meetingReport.shareOnSite')}</Text></TouchableOpacity>
              )}
              {permissions.canDelete && (
                <TouchableOpacity style={styles.addActionBtn} disabled={busy || showNew || (isShared && !shared.ready)} onPress={() => deleteReport(report)}><Text style={styles.addActionBtnText}>{t('common.delete')}</Text></TouchableOpacity>
              )}

              {report.decisions.length > 0 && (
                <View style={styles.decisionsBox}>
                  <Text style={styles.decisionsTitle}>{t('meetingReport.decisionsCount', { count: report.decisions.length })}</Text>
                  {report.decisions.map((d, i) => (
                    <View key={i} style={styles.decisionRow}>
                      <Ionicons name="checkmark-circle" size={14} color={C.closed} />
                      <Text style={styles.decisionText}>{d}</Text>
                    </View>
                  ))}
                </View>
              )}

              {report.notes ? (
                <Text style={styles.notesText} numberOfLines={3}>{report.notes}</Text>
              ) : null}

              <TouchableOpacity
                style={styles.actionsToggle}
                onPress={() => {
                  if (isExpanded) {
                    setExpandedReportId(null);
                    setShowAddAction(false);
                  } else {
                    setExpandedReportId(report.id);
                    setShowAddAction(false);
                  }
                }}
              >
                <Ionicons name="checkmark-done-outline" size={14} color={C.primary} />
                <Text style={styles.actionsToggleText}>
                  {t('meetingReport.actionsProgress', { done: doneCount, total: report.actions.length })}
                </Text>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={C.textMuted} />
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.actionsPanel}>
                  {report.actions.length === 0 && !showAddAction && (
                    <Text style={styles.actionsEmpty}>{t('meetingReport.noActionHint')}</Text>
                  )}
                  {report.actions.map(action => {
                    const linkedReserve = action.reserveId
                      ? reserves.find(r => r.id === action.reserveId)
                      : undefined;
                    return (
                      <View key={action.id} style={styles.actionRow}>
                        <TouchableOpacity
                          onPress={() => toggleAction(report.id, action.id!)}
                          disabled={busy || !permissions.canEdit || (isShared && !shared.ready)}
                          hitSlop={8}
                          style={[
                            styles.actionCheck,
                            action.status === 'done' && styles.actionCheckDone,
                          ]}
                        >
                          {action.status === 'done' && (
                            <Ionicons name="checkmark" size={12} color="#fff" />
                          )}
                        </TouchableOpacity>
                        <View style={{ flex: 1 }}>
                          <Text style={[
                            styles.actionDesc,
                            action.status === 'done' && styles.actionDescDone,
                          ]}>
                            {action.description}
                          </Text>
                          <Text style={styles.actionMeta}>
                            {t('meetingReport.actionMeta', { responsible: action.responsible, deadline: action.deadline })}
                          </Text>
                          {linkedReserve && (
                            <View style={styles.actionReserveBadge}>
                              <Ionicons name="link-outline" size={10} color={C.primary} />
                              <Text style={styles.actionReserveBadgeText}>
                                {linkedReserve.id} — {linkedReserve.title}
                              </Text>
                            </View>
                          )}
                        </View>
                        {permissions.canEdit && (!isShared || shared.ready) && (
                          <TouchableOpacity
                            onPress={() => removeAction(report.id, action.id!)}
                            hitSlop={8}
                          >
                            <Ionicons name="close" size={15} color={C.textMuted} />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}

                  {permissions.canEdit && (!isShared || shared.ready) && !showAddAction && (
                    <TouchableOpacity
                      style={styles.addActionBtn}
                      onPress={() => setShowAddAction(true)}
                    >
                      <Ionicons name="add-circle-outline" size={16} color={C.primary} />
                      <Text style={styles.addActionBtnText}>{t('meetingReport.addAction')}</Text>
                    </TouchableOpacity>
                  )}

                  {showAddAction && (!isShared || shared.ready) && (
                    <View style={styles.addActionForm}>
                      <TextInput
                        style={styles.actionInput}
                        placeholder={t('meetingReport.actionDescriptionPlaceholder')}
                        placeholderTextColor={C.textMuted}
                        value={actionDesc}
                        onChangeText={setActionDesc}
                        autoFocus
                      />
                      <View style={styles.actionFormRow}>
                        <TextInput
                          style={[styles.actionInput, { flex: 1 }]}
                          placeholder={t('meetingReport.actionResponsiblePlaceholder')}
                          placeholderTextColor={C.textMuted}
                          value={actionResp}
                          onChangeText={setActionResp}
                        />
                        <TextInput
                          style={[styles.actionInput, { flex: 1 }]}
                          placeholder={t('meetingReport.actionDeadlinePlaceholder')}
                          placeholderTextColor={C.textMuted}
                          value={actionDeadline}
                          onChangeText={setActionDeadline}
                        />
                      </View>
                      <TouchableOpacity
                        style={styles.actionReservePickerBtn}
                        onPress={() => setShowReservePicker(true)}
                      >
                        <Ionicons name="link-outline" size={13} color={C.primary} />
                        <Text style={styles.actionReservePickerText}>
                          {actionReserveId
                            ? reserves.find(r => r.id === actionReserveId)?.title ?? actionReserveId
                            : t('meetingReport.linkReserveOptional')}
                        </Text>
                        {actionReserveId && (
                          <TouchableOpacity onPress={() => setActionReserveId('')} hitSlop={8}>
                            <Ionicons name="close-circle" size={14} color={C.textMuted} />
                          </TouchableOpacity>
                        )}
                      </TouchableOpacity>
                      <View style={styles.actionFormRow}>
                        <TouchableOpacity
                          style={styles.actionCancelBtn}
                          onPress={() => {
                            setShowAddAction(false);
                            setActionDesc(''); setActionResp(''); setActionDeadline(''); setActionReserveId('');
                          }}
                        >
                          <Text style={styles.actionCancelBtnText}>{t('common.cancel')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.actionSaveBtn}
                          onPress={() => addActionToReport(report.id)}
                        >
                          <Text style={styles.actionSaveBtnText}>{t('common.save')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      </PageContainer>

      <Modal visible={showReservePicker} transparent animationType="slide" onRequestClose={() => setShowReservePicker(false)}>
        <View style={styles.tplOverlay}>
          <View style={[styles.tplSheet, { maxHeight: '70%' }]}>
            <View style={styles.tplHandle} />
            <Text style={styles.tplSheetTitle}>{t('meetingReport.linkReserveTitle')}</Text>
            <Text style={styles.tplSheetSub}>{t('meetingReport.linkReserveSub')}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {chantierReserves.length === 0 ? (
                <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center', paddingVertical: 20, fontFamily: 'Inter_400Regular' }}>
                  {t('meetingReport.noOpenReserve')}
                </Text>
              ) : (
                chantierReserves.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.tplRow, actionReserveId === r.id && { backgroundColor: C.primaryBg }]}
                    onPress={() => { setActionReserveId(r.id); setShowReservePicker(false); }}
                  >
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.open, marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tplRowLabel}>{r.title}</Text>
                      <Text style={styles.tplRowSub}>{r.id} · {r.company}</Text>
                    </View>
                    {actionReserveId === r.id && (
                      <Ionicons name="checkmark-circle" size={16} color={C.primary} />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <TouchableOpacity style={styles.tplCancelBtn} onPress={() => setShowReservePicker(false)}>
              <Text style={styles.tplCancelText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showTemplateModal} transparent animationType="slide" onRequestClose={() => setShowTemplateModal(false)}>
        <View style={styles.tplOverlay}>
          <View style={styles.tplSheet}>
            <View style={styles.tplHandle} />
            <Text style={styles.tplSheetTitle}>{t('meetingReport.chooseTemplateTitle')}</Text>
            <Text style={styles.tplSheetSub}>{t('meetingReport.chooseTemplateSub')}</Text>
            {crrTemplates.map(tpl => (
              <TouchableOpacity key={tpl.id} style={styles.tplRow} onPress={() => applyTemplate(tpl)}>
                <View style={styles.tplRowIcon}>
                  <Ionicons name={tpl.icon} size={18} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tplRowLabel}>{tpl.label}</Text>
                  <Text style={styles.tplRowSub} numberOfLines={2}>{tpl.agenda.split('\n')[0]}{tpl.agenda.split('\n').length > 1 ? '…' : ''}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.tplCancelBtn} onPress={() => setShowTemplateModal(false)}>
              <Text style={styles.tplCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <BottomNavBar />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14 },
  createBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primaryBg, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8, borderWidth: 1, borderColor: C.primary + '40' },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  reportHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  reportTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  reportMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8, backgroundColor: C.primaryBg, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '40' },
  pdfBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  decisionsBox: { backgroundColor: C.surface2, borderRadius: 10, padding: 12, marginBottom: 10 },
  decisionsTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 8 },
  decisionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  decisionText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  notesText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, fontStyle: 'italic', lineHeight: 18 },

  templateBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.primaryBg, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.primary + '30', marginBottom: 16,
  },
  templateBannerTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  templateBannerSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },

  formTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  tplBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.primary + '30',
  },
  tplBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

  tplOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  tplSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36,
    // Desktop : feuille bornée et centrée au lieu d'un bandeau pleine largeur.
    width: '100%', maxWidth: 560, alignSelf: 'center',
  },
  tplHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  tplSheetTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 4 },
  tplSheetSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 18 },
  tplRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tplRowIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  tplRowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  tplRowSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  tplCancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 12 },
  tplCancelText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: C.textSub },

  actionsToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border,
  },
  actionsToggleText: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  actionsPanel: { marginTop: 10, gap: 8 },
  actionsEmpty: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic', textAlign: 'center', paddingVertical: 8 },

  actionRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: C.surface2, borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: C.border,
  },
  actionCheck: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    borderColor: C.textMuted, alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  actionCheckDone: { borderColor: C.closed, backgroundColor: C.closed },
  actionDesc: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  actionDescDone: { textDecorationLine: 'line-through', color: C.textMuted },
  actionMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  actionReserveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4,
    backgroundColor: C.primaryBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start',
  },
  actionReserveBadgeText: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.primary },

  addActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
    paddingVertical: 10, borderRadius: 10, borderWidth: 1.5,
    borderColor: C.primary + '40', borderStyle: 'dashed',
  },
  addActionBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },

  addActionForm: {
    backgroundColor: C.surface2, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border, gap: 8,
  },
  actionInput: {
    backgroundColor: C.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9,
    fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border,
  },
  actionFormRow: { flexDirection: 'row', gap: 8 },
  actionReservePickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: C.primary + '30',
  },
  actionReservePickerText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  actionCancelBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: C.border,
  },
  actionCancelBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  actionSaveBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8,
    backgroundColor: C.primary,
  },
  actionSaveBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
