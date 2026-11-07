import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { showAlert } from '@/lib/appAlert';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { exportPDF as exportPDFHelper, loadPhotoAsDataUrlForPdf } from '@/lib/pdfBase';
import { buildDailyHTML, buildWeeklyHTML, buildIncidentHTML, buildCompanyReserveHTML, incidentSeverityLabel, type TFunc } from '@/lib/fieldReportHtml';
import { buildCsvReport } from '@/lib/reserveCsv';
import { activeReportReserves } from '@/lib/reportReserveScope';
import { reserveStatusLabel } from '@/lib/reportLabels';
import { getISOWeek } from '@/lib/utils';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSettings } from '@/context/SettingsContext';
import { useIncidents } from '@/context/IncidentsContext';
import Header from '@/components/Header';
import PageContainer from '@/components/PageContainer';
import ExportLanguageSelector from '@/components/ExportLanguageSelector';
import BottomNavBar from '@/components/BottomNavBar';
import {
  enrichReservesForPdf as enrichReserveListForPdf,
} from '@/lib/pdfReserveHelpers';
import { buildPdfFilename } from '@/lib/pdfFilename';
import {
  RESERVE_PRIORITY_LABELS,
  RESERVE_STATUS_COLORS,
  RESERVE_STATUS_LABELS,
} from '@/lib/reserveLabels';
import { reserveMatchesCompany } from '@/lib/reserveVisibility';
import { getExportTranslator, localeForExportLanguage } from '@/lib/exportLanguage';

export default function RapportsScreen() {
  const { t } = useTranslation();
  const { reserves: allReserves, companies, tasks, stats, chantiers, activeChantierId, photos } = useApp();
  const reserves = activeReportReserves(allReserves);
  const { user, permissions } = useAuth();
  const { exportLanguage, setExportLanguage } = useLanguage();
  const { projectName } = useSettings();
  const { incidents } = useIncidents();
  const userName = user?.name ?? t('reportsScreen.buildTrackTeam');
  const router = useRouter();
  const exportT = getExportTranslator(exportLanguage) as unknown as TFunc;
  const exportLocale = localeForExportLanguage(exportLanguage);

  if (user?.role === 'sous_traitant') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color="#94A3B8" />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#1E293B', marginTop: 16, textAlign: 'center' }}>
          {t('common.restrictedAccess')}
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: '#94A3B8', marginTop: 8, textAlign: 'center' }}>
          {t('reportsScreen.subcontractorDenied')}
        </Text>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.navigate('/(tabs)/' as any)}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#2563EB', borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{t('reportsScreen.backDashboard')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const weekNum = getISOWeek(new Date());
  const pdfReserves = enrichReserveListForPdf(reserves, photos);

  async function exportPDF(type: 'daily' | 'weekly') {
    if (!permissions.canExport) {
      showAlert(t('documentsScreen.accessDenied'), t('reportsScreen.exportDenied'));
      return;
    }
    try {
      const html = type === 'daily'
        ? buildDailyHTML(pdfReserves, companies, tasks, incidents, stats, userName, projectName, exportT, exportLocale)
        : buildWeeklyHTML(pdfReserves, companies, tasks, incidents, stats, userName, weekNum, projectName, exportT, exportLocale);
      await exportPDFHelper(
        html,
        type === 'daily'
          ? buildPdfFilename('Rapport_Journalier', [projectName, exportLanguage.toUpperCase()])
          : buildPdfFilename('Rapport_Hebdomadaire', [`Semaine_${weekNum}`, projectName, exportLanguage.toUpperCase()]),
      );
    } catch (e: any) {
      showAlert(t('common.error'), t('reportsScreen.pdfError', { error: e?.message ?? e }));
    }
  }

  async function exportCSV() {
    if (!permissions.canExport) {
      showAlert(t('documentsScreen.accessDenied'), t('reportsScreen.exportDenied'));
      return;
    }
    try {
      const csv = `\uFEFF${buildCsvReport(reserves, exportT, exportLocale)}`;

      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `buildtrack_reserves_${exportLanguage}_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }

      const filename = `buildtrack_reserves_${exportLanguage}_${Date.now()}.csv`;
      const fileUri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: t('reportsScreen.shareCsv'), UTI: 'public.comma-separated-values-text' });
      } else {
        showAlert(t('reportsScreen.csvGenerated'), t('reportsScreen.csvGeneratedText', { count: reserves.length, fileUri }));
      }
    } catch (e: any) {
      showAlert(t('common.error'), t('reportsScreen.exportError', { error: e?.message ?? e }));
    }
  }

  return (
    <View style={styles.container}>
      <Header title={t('reportsScreen.title')} subtitle={t('reportsScreen.subtitle')} showBack />

      <PageContainer maxWidth={1000}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {permissions.canExport ? (
          <View style={styles.exportLanguageCard}>
            <ExportLanguageSelector compact value={exportLanguage} onChange={setExportLanguage} />
          </View>
        ) : null}
        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="document-text" size={20} color={C.inProgress} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>{t('reportsScreen.dailyReport')}</Text>
              <Text style={styles.reportDate}>{today}</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={() => exportPDF('daily')}>
                <Ionicons name="download-outline" size={14} color={C.primary} />
                <Text style={styles.exportBtnText}>PDF</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.personnelPresent')}</Text>
            {companies.map(co => (
              <View key={co.id} style={styles.coRow}>
                <View style={[styles.coDot, { backgroundColor: co.color }]} />
                <Text style={styles.coName}>{co.name}</Text>
                <Text style={[styles.coVal, { color: co.color }]}>{t('reportsScreen.peopleCount', { count: co.actualWorkers })}</Text>
              </View>
            ))}
            <View style={[styles.coRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>TOTAL</Text>
              <Text style={[styles.coVal, { color: C.primary }]}>{t('reportsScreen.plannedWorkers', { actual: stats.totalWorkers, planned: stats.plannedWorkers })}</Text>
            </View>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.reserves')}</Text>
            <View style={styles.statRow}>
              <StatItem label={t('reportsScreen.openFem')} val={stats.open} color={C.open} />
              <StatItem label={t('reportsScreen.inProgress')} val={stats.inProgress} color={C.inProgress} />
              <StatItem label={t('reportsScreen.closedFem')} val={stats.closed} color={C.closed} />
            </View>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.currentTasks')}</Text>
            {tasks.filter(t => t.status === 'in_progress').map(t => (
              <View key={t.id} style={styles.taskItem}>
                <View style={styles.taskDot} />
                <Text style={styles.taskText}>{t.title}</Text>
                <Text style={[styles.taskPct, { color: C.inProgress }]}>{t.progress}%</Text>
              </View>
            ))}
            {tasks.filter(t => t.status === 'in_progress').length === 0 && (
              <Text style={styles.emptyText}>{t('reportsScreen.noCurrentTask')}</Text>
            )}
          </View>
        </View>

        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="calendar" size={20} color={C.closed} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>{t('reportsScreen.weeklyReport')}</Text>
              <Text style={styles.reportDate}>{t('reportsScreen.weekNumber', { week: weekNum })}</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={() => exportPDF('weekly')}>
                <Ionicons name="download-outline" size={14} color={C.primary} />
                <Text style={styles.exportBtnText}>PDF</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.reserveSummary')}</Text>
            <View style={styles.statRow}>
              <StatItem label="Total" val={stats.total} color={C.textSub} />
              <StatItem label={t('reportsScreen.openFem')} val={stats.open + stats.inProgress} color={C.open} />
              <StatItem label={t('reportsScreen.closedFem')} val={stats.closed} color={C.closed} />
            </View>
            <View style={styles.progressWrap}>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${stats.progress}%` as any }]} />
              </View>
              <Text style={[styles.progressPct, { color: C.primary }]}>{stats.progress}%</Text>
            </View>
            <Text style={styles.progressLabel}>{t('reportsScreen.globalProgress')}</Text>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.openCriticalReserves')}</Text>
            {reserves.filter(r => r.priority === 'critical' && r.status !== 'closed').map(r => (
              <View key={r.id} style={styles.critItem}>
                <Ionicons name="warning" size={14} color={C.critical} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.critTitle}>{r.id} — {r.title}</Text>
                  <Text style={styles.critSub}>{t('reportsScreen.reserveCriticalMeta', { building: r.building, deadline: r.deadline })}</Text>
                </View>
              </View>
            ))}
            {reserves.filter(r => r.priority === 'critical' && r.status !== 'closed').length === 0 && (
              <Text style={styles.emptyText}>{t('reportsScreen.noCriticalReserve')}</Text>
            )}
          </View>

          <View style={[styles.reportSection, { marginBottom: 0, borderBottomWidth: 0 }]}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.securityIncidents')}</Text>
            {incidents.filter(i => i.status !== 'resolved').map(i => {
              const sevColor: Record<string, string> = { minor: C.textSub, moderate: C.waiting, major: C.open, critical: C.critical };
              return (
                <View key={i.id} style={[styles.critItem, { borderLeftWidth: 3, borderLeftColor: sevColor[i.severity] ?? C.open, paddingLeft: 8, marginBottom: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.critTitle, { color: sevColor[i.severity] ?? C.open }]}>{incidentSeverityLabel(t, i.severity)} — {i.title}</Text>
                    <Text style={styles.critSub}>{t('reportsScreen.incidentMeta', { building: i.building, location: i.location, date: i.reportedAt })}</Text>
                  </View>
                  {permissions.canExport && (
                    <TouchableOpacity
                      onPress={async () => {
                        try {
                          const html = buildIncidentHTML(i, projectName, exportT, exportLocale);
                          await exportPDFHelper(html, buildPdfFilename('Incident', [i.id, i.title, projectName, exportLanguage.toUpperCase()]));
                        } catch (e: any) {
                          showAlert(t('common.error'), e?.message ?? t('reportsScreen.pdfGenerateError'));
                        }
                      }}
                      style={[styles.exportBtn, { marginLeft: 8 }]}
                    >
                      <Ionicons name="download-outline" size={12} color={C.primary} />
                      <Text style={styles.exportBtnText}>PDF</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            {incidents.filter(i => i.status !== 'resolved').length === 0 && (
              <Text style={[styles.emptyText, { color: C.closed }]}>{t('reportsScreen.noOpenIncidentSafe')}</Text>
            )}
          </View>
        </View>

        {/* BON DE RÉSERVE PAR ENTREPRISE */}
        {permissions.canExport && companies.length > 0 && (
          <View style={styles.reportCard}>
            <View style={styles.reportHeader}>
              <Ionicons name="briefcase-outline" size={20} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle}>{t('reportsScreen.reserveSlipsByCompany')}</Text>
                <Text style={styles.reportDate}>{t('reportsScreen.individualPdfBySubcontractor')}</Text>
              </View>
            </View>
            {companies.map(company => {
              const companyReserves = pdfReserves.filter(r => reserveMatchesCompany(r, company));
              const openCount = companyReserves.filter(r => r.status !== 'closed').length;
              const closedCount = companyReserves.filter(r => r.status === 'closed').length;
              const activeChantier = chantiers.find(c => c.id === activeChantierId);
              const projectName = activeChantier?.name ?? t('reportsScreen.buildTrackProject');
              return (
                <View key={company.id} style={styles.companyRow}>
                  <View style={[styles.companyDot, { backgroundColor: company.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.companyName}>{company.name}</Text>
                    <Text style={styles.companyMeta}>
                      {t('reportsScreen.companyReserveCount', { count: companyReserves.length })}
                      {openCount > 0 ? ` · ${t('reportsScreen.toCloseCount', { count: openCount })}` : ''}
                      {closedCount > 0 ? ` · ${t('reportsScreen.closedCount', { count: closedCount })}` : ''}
                    </Text>
                  </View>
                  {companyReserves.length > 0 ? (
                    <TouchableOpacity
                      style={styles.exportBtn}
                      onPress={async () => {
                        try {
                          const html = await buildCompanyReserveHTML(company, companyReserves, projectName, exportT, exportLocale, loadPhotoAsDataUrlForPdf);
                          await exportPDFHelper(html, buildPdfFilename('Bon_Reserves', [company.name, projectName, exportLanguage.toUpperCase()]));
                        } catch (e: any) {
                          showAlert(t('common.error'), e?.message ?? t('reportsScreen.pdfGenerateError'));
                        }
                      }}
                    >
                      <Ionicons name="document-text-outline" size={13} color={C.primary} />
                      <Text style={styles.exportBtnText}>PDF</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted }}>{t('reportsScreen.none')}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="warning" size={20} color={C.waiting} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>{t('reportsScreen.reservesReport')}</Text>
              <Text style={styles.reportDate}>{t('reportsScreen.totalReservesCount', { count: stats.total })}</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={exportCSV}>
                <Ionicons name="download-outline" size={14} color={C.closed} />
                <Text style={[styles.exportBtnText, { color: C.closed }]}>CSV</Text>
              </TouchableOpacity>
            )}
          </View>

          {(['open', 'in_progress', 'waiting', 'verification', 'closed'] as const).map(s => {
            const colors = RESERVE_STATUS_COLORS as Record<string, string>;
            const count = reserves.filter(r => r.status === s).length;
            return (
              <View key={s} style={styles.statusBreakRow}>
                <View style={[styles.statusDot, { backgroundColor: colors[s] }]} />
                <Text style={styles.statusLabel}>{reserveStatusLabel(t, s)}</Text>
                <View style={styles.statusBarBg}>
                  <View style={[styles.statusBarFill, {
                    width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%` as any,
                    backgroundColor: colors[s],
                  }]} />
                </View>
                <Text style={[styles.statusCount, { color: colors[s] }]}>{count}</Text>
              </View>
            );
          })}

          {permissions.canExport && (
            <TouchableOpacity style={styles.fullExportBtn} onPress={exportCSV}>
              <Ionicons name="document-outline" size={16} color="#fff" />
              <Text style={styles.fullExportBtnText}>{t('reportsScreen.exportAllReservesCsv')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
      </PageContainer>
      <BottomNavBar />
    </View>
  );
}

function StatItem({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statVal, { color }]}>{val}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  exportLanguageCard: { backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  reportCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  reportTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  reportDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8, backgroundColor: C.primaryBg, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '40' },
  exportBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  reportSection: { marginBottom: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  sectionTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  companyDot: { width: 10, height: 10, borderRadius: 5 },
  companyName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  companyMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  coRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  coDot: { width: 8, height: 8, borderRadius: 4 },
  coName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  coVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  totalRow: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, marginTop: 4 },
  totalLabel: { flex: 1, fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  statRow: { flexDirection: 'row', gap: 8 },
  statItem: { flex: 1, alignItems: 'center', backgroundColor: C.surface2, borderRadius: 10, padding: 10 },
  statVal: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  taskItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  taskDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.inProgress },
  taskText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  taskPct: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  progressBg: { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  progressPct: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4 },
  critItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  critTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  critSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  statusBreakRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, width: 82 },
  statusBarBg: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  statusBarFill: { height: '100%', borderRadius: 3 },
  statusCount: { fontSize: 13, fontFamily: 'Inter_600SemiBold', width: 20, textAlign: 'right' },
  fullExportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, marginTop: 10 },
  fullExportBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
