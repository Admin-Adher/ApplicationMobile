import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform, Modal, KeyboardAvoidingView } from 'react-native';
import DateInput from '@/components/DateInput';
import { useState, useCallback, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import {
  exportPDF as exportPDFHelper,
  wrapHTML,
  buildLetterhead,
  buildInfoGrid,
  buildDocFooter,
  escapeHtml,
} from '@/lib/pdfBase';
import { buildPdfFilename } from '@/lib/pdfFilename';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useApp } from '@/context/AppContext';
import Header from '@/components/Header';
import { MeetingReport, MeetingReportAction } from '@/constants/types';
import BottomNavBar from '@/components/BottomNavBar';
import { genId, formatDateFR, nowTimestampFR } from '@/lib/utils';
import { formatDate } from '@/lib/reserveUtils';

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

function buildMeetingHTML(report: MeetingReport, projectName: string, t: (key: string, options?: any) => string): string {
  const exportDate = nowTimestampFR();
  const docRef = `CRR-${report.date.replace(/\//g, '')}-${report.id.slice(0, 6).toUpperCase()}`;
  const doneCount = report.actions.filter(a => a.status === 'done').length;
  const pendingCount = report.actions.length - doneCount;

  const decisionsHtml = report.decisions.length > 0
    ? report.decisions.map((d, i) =>
        `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #EEF3FA">
          <div style="min-width:22px;height:22px;background:#003082;border-radius:50%;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center">${i + 1}</div>
          <div style="font-size:12px;color:#1A2742;line-height:1.5">${escapeHtml(d)}</div>
        </div>`
      ).join('')
    : `<div style="font-size:12px;color:#6B7280;font-style:italic">${escapeHtml(t('meetingReport.pdf.noDecision'))}</div>`;

  const actionsHtml = report.actions.map(a =>
    `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${escapeHtml(a.description)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:600">${escapeHtml(a.responsible)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${escapeHtml(a.deadline)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        <span style="background:${a.status === 'done' ? '#ECFDF5' : '#FFFBEB'};color:${a.status === 'done' ? '#059669' : '#D97706'};font-size:10px;font-weight:700;padding:2px 10px;border-radius:10px">
          ${escapeHtml(a.status === 'done' ? t('meetingReport.pdf.done') : t('meetingReport.pdf.pending'))}
        </span>
      </td>
    </tr>`
  ).join('');

  const sH = (t: string) => `<div class="section-header">${t}</div>`;

  const participantsList = report.participants.split('\n').filter(p => p.trim()).map(p =>
    `<span style="display:inline-block;background:#F4F7FB;border:1px solid #DDE4EE;border-radius:20px;padding:3px 10px;font-size:11px;margin:3px 4px 3px 0">${escapeHtml(p.trim())}</span>`
  ).join('');

  const agendaItems = report.agenda.split('\n').filter(a => a.trim()).map((item, i) =>
    `<div style="display:flex;gap:10px;padding:6px 0;font-size:12px">
      <span style="color:#003082;font-weight:700;min-width:20px">${i + 1}.</span>
      <span>${escapeHtml(item.replace(/^\d+\.\s*/, ''))}</span>
    </div>`
  ).join('');

  const body = `
    ${buildLetterhead(t('meetingReport.pdf.title'), report.subject, docRef, exportDate, projectName)}
    ${buildInfoGrid([
      { label: t('meetingReport.pdf.meetingDate'), value: report.date },
      { label: t('meetingReport.pdf.location'), value: report.location || t('meetingReport.notSpecified') },
      { label: t('meetingReport.pdf.redactedBy'), value: report.redactedBy },
      { label: t('meetingReport.pdf.actionsTotal'), value: t('meetingReport.pdf.actionsDone', { done: doneCount, total: report.actions.length }) },
    ])}
    ${pendingCount > 0 ? `
      <div class="alert alert-warning">⏳ <strong>${escapeHtml(t('meetingReport.pdf.pendingActions', { count: pendingCount }))}</strong> ${escapeHtml(t('meetingReport.pdf.sinceMeeting'))}</div>` : ''}
    ${sH(t('meetingReport.agenda'))}
    <div style="background:#F4F7FB;border-radius:10px;padding:12px 16px;margin-bottom:4px">${agendaItems || `<div style="color:#6B7280;font-style:italic">${escapeHtml(t('meetingReport.pdf.agendaEmpty'))}</div>`}</div>
    ${sH(t('meetingReport.participants'))}
    <div style="padding:10px 0">${participantsList || `<span style="color:#6B7280;font-style:italic">${escapeHtml(t('meetingReport.notSpecified'))}</span>`}</div>
    ${sH(t('meetingReport.pdf.discussions'))}
    <div style="background:#F9FAFB;border-radius:10px;padding:14px 16px;border:1px solid #DDE4EE;font-size:12px;line-height:1.7;white-space:pre-wrap">${escapeHtml(report.notes) || escapeHtml(t('meetingReport.pdf.notesEmpty'))}</div>
    ${sH(t('meetingReport.decisions'))}
    ${decisionsHtml}
    ${report.actions.length > 0 ? `
      ${sH(t('meetingReport.pdf.actionPlan', { count: report.actions.length }))}
      <table>
        <thead><tr>
          <th>${escapeHtml(t('meetingReport.pdf.action'))}</th><th>${escapeHtml(t('meetingReport.pdf.responsible'))}</th><th>${escapeHtml(t('meetingReport.pdf.deadline'))}</th><th style="text-align:center">${escapeHtml(t('meetingReport.pdf.status'))}</th>
        </tr></thead>
        <tbody>${actionsHtml}</tbody>
      </table>` : ''}
    <div class="sig-row" style="margin-top:32px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('meetingReport.nextMeeting'))}</div>
        <div style="font-size:13px;font-weight:700;color:#1A2742">${escapeHtml(report.nextMeeting) || escapeHtml(t('meetingReport.toDefine'))}</div>
      </div>
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('meetingReport.pdf.writerSignature'))}</div>
        <div class="sig-line"></div>
        <div class="sig-name">${escapeHtml(report.redactedBy)}</div>
      </div>
    </div>
    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, t('meetingReport.pdf.documentTitle', { subject: report.subject }));
}

export default function MeetingReportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();
  const { reserves, companies, activeChantierId } = useApp();
  const [reports, setReports] = useState<MeetingReport[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(MEETING_KEY).then(raw => {
      if (raw) { try { setReports(JSON.parse(raw)); } catch {} }
    });
  }, []);
  const [showNew, setShowNew] = useState(false);
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

  function updateReportData(reportId: string, updater: (r: MeetingReport) => MeetingReport) {
    setReports(prev => {
      const updated = prev.map(r => r.id === reportId ? updater(r) : r);
      AsyncStorage.setItem(MEETING_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }

  function addActionToReport(reportId: string) {
    if (!actionDesc.trim() || !actionResp.trim() || !actionDeadline.trim()) {
      Alert.alert(t('meetingReport.requiredFieldsTitle'), t('meetingReport.actionRequiredText'));
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
    updateReportData(reportId, r => ({ ...r, actions: [...r.actions, action] }));
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
    Alert.alert(t('meetingReport.deleteActionTitle'), t('meetingReport.deleteActionText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () =>
        updateReportData(reportId, r => ({ ...r, actions: r.actions.filter(a => a.id !== actionId) }))
      },
    ]);
  }

  const chantierReserves = reserves.filter(r =>
    r.status !== 'closed' && (!activeChantierId || r.chantierId === activeChantierId)
  );

  const resetForm = () => {
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
    setShowNew(true);
  }

  const handleCreate = useCallback(() => {
    if (!subject.trim()) {
      Alert.alert(t('meetingReport.requiredFieldTitle'), t('meetingReport.subjectRequired'));
      return;
    }
    const report: MeetingReport = {
      id: genId(),
      subject: subject.trim(),
      date,
      location: location.trim() || t('meetingReport.notSpecified'),
      participants: participants.trim() || t('meetingReport.notSpecified'),
      agenda: agenda.trim(),
      notes: notes.trim(),
      decisions: decisions.split('\n').map(s => s.trim()).filter(Boolean),
      actions: [],
      nextMeeting: nextMeeting.trim(),
      redactedBy: user?.name ?? t('common.system'),
      createdAt: nowTimestampFR(),
    };
    setReports(prev => {
      const updated = [report, ...prev];
      AsyncStorage.setItem(MEETING_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    resetForm();
    setShowNew(false);
  }, [subject, date, location, participants, agenda, notes, decisions, nextMeeting, user, t]);

  async function handleExportPDF(report: MeetingReport) {
    if (!permissions.canExport) {
      Alert.alert(t('documentsScreen.accessDenied'), t('meetingReport.exportDenied'));
      return;
    }
    try {
      const html = buildMeetingHTML(report, projectName, t);
      await exportPDFHelper(html, buildPdfFilename('CR_Reunion', [report.subject, report.location, projectName]));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? t('meetingReport.pdfError'));
    }
  }

  if (user?.role === 'sous_traitant') {
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
        onRightPress={permissions.canCreate ? () => { if (showNew) { setShowNew(false); resetForm(); } else setShowNew(true); } : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

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
              <Text style={styles.sectionTitle}>{t('meetingReport.newReport')}</Text>
              <TouchableOpacity style={styles.tplBtn} onPress={() => setShowTemplateModal(true)}>
                <Ionicons name="flash-outline" size={13} color={C.primary} />
                <Text style={styles.tplBtnText}>{t('meetingReport.template')}</Text>
              </TouchableOpacity>
            </View>
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
            <TouchableOpacity style={styles.createBtn} onPress={handleCreate}>
              <Ionicons name="document-text" size={18} color="#fff" />
              <Text style={styles.createBtnText}>{t('meetingReport.createReport')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {reports.length === 0 && !showNew && (
          <View style={styles.emptyBox}>
            <Ionicons name="document-text-outline" size={52} color={C.border} />
            <Text style={styles.emptyTitle}>{t('meetingReport.emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t('meetingReport.emptyText')}</Text>
            {permissions.canCreate && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowNew(true)}>
                <Ionicons name="add-circle" size={18} color={C.primary} />
                <Text style={styles.emptyBtnText}>{t('meetingReport.newShort')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {reports.map(report => {
          const isExpanded = expandedReportId === report.id;
          const doneCount = report.actions.filter(a => a.status === 'done').length;
          return (
            <View key={report.id} style={styles.card}>
              <View style={styles.reportHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reportTitle}>{report.subject}</Text>
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
                        {permissions.canCreate && (
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

                  {permissions.canCreate && !showAddAction && (
                    <TouchableOpacity
                      style={styles.addActionBtn}
                      onPress={() => setShowAddAction(true)}
                    >
                      <Ionicons name="add-circle-outline" size={16} color={C.primary} />
                      <Text style={styles.addActionBtnText}>{t('meetingReport.addAction')}</Text>
                    </TouchableOpacity>
                  )}

                  {showAddAction && (
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
