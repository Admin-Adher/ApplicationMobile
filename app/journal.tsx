import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import DateInput from '@/components/DateInput';
import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  exportPDF as exportPDFHelper,
  wrapHTML,
  buildLetterhead,
  buildKpiRow,
  buildDocFooter,
  escapeHtml,
} from '@/lib/pdfBase';
import { buildPdfFilename } from '@/lib/pdfFilename';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { usePointage } from '@/context/PointageContext';
import Header from '@/components/Header';
import { JournalEntry } from '@/constants/types';
import BottomNavBar from '@/components/BottomNavBar';
import { genId, formatDateFR, nowTimestampFR } from '@/lib/utils';
import { isValidDateFR } from '@/lib/dateUtils';

const JOURNAL_KEY = 'buildtrack_journal_v2';

const WEATHER_OPTIONS = ['sunny', 'cloudy', 'partlyCloudy', 'rain', 'storm', 'snow', 'fog', 'wind', 'snowShowers', 'showers'] as const;
const WEATHER_ICON_BY_KEY: Record<(typeof WEATHER_OPTIONS)[number], string> = {
  sunny: '☀️',
  cloudy: '⛅',
  partlyCloudy: '🌤️',
  rain: '🌧️',
  storm: '🌩️',
  snow: '❄️',
  fog: '🌫️',
  wind: '💨',
  snowShowers: '🌨️',
  showers: '🌦️',
};

function getWeatherLabel(t: (key: string, options?: any) => string, key: (typeof WEATHER_OPTIONS)[number]): string {
  return `${WEATHER_ICON_BY_KEY[key]} ${t(`journal.weather.${key}`)}`;
}

function wmoCodesToLabel(wmo: number, t: (key: string, options?: any) => string): string {
  if (wmo === 0) return getWeatherLabel(t, 'sunny');
  if (wmo <= 2) return getWeatherLabel(t, 'partlyCloudy');
  if (wmo === 3) return getWeatherLabel(t, 'cloudy');
  if (wmo <= 49) return getWeatherLabel(t, 'fog');
  if (wmo <= 59) return getWeatherLabel(t, 'showers');
  if (wmo <= 69) return getWeatherLabel(t, 'rain');
  if (wmo <= 79) return getWeatherLabel(t, 'snow');
  if (wmo <= 84) return getWeatherLabel(t, 'showers');
  if (wmo <= 86) return getWeatherLabel(t, 'snowShowers');
  if (wmo <= 99) return getWeatherLabel(t, 'storm');
  return getWeatherLabel(t, 'cloudy');
}

async function fetchAutoWeather(t: (key: string, options?: any) => string): Promise<{ label: string; temp: number | null; wind: number | null; code: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { latitude, longitude } = loc.coords;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&current=weather_code,temperature_2m,wind_speed_10m&timezone=auto&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const wmo: number = data.current?.weather_code ?? 0;
    const temp: number | null = data.current?.temperature_2m ?? null;
    const wind: number | null = data.current?.wind_speed_10m ?? null;
    return { label: wmoCodesToLabel(wmo, t), temp, wind, code: wmo };
  } catch {
    return null;
  }
}

function frToISO(frDate: string): string {
  const parts = frDate.split('/');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function buildJournalHTML(entries: JournalEntry[], projectName: string, t: (key: string, options?: any) => string): string {
  const exportDate = formatDateFR(new Date());
  const docRef = `JC-${formatDateFR(new Date()).replace(/\//g, '')}`;

  const totalWorkers = entries.reduce((s, e) => s + (e.workerCount || 0), 0);
  const avgWorkers = entries.length > 0 ? Math.round(totalWorkers / entries.length) : 0;
  const entriesWithIncidents = entries.filter(e => e.incidents && e.incidents.trim()).length;
  const dateRange = entries.length > 0
    ? `${entries[entries.length - 1].date} → ${entries[0].date}`
    : '—';

  const rows = entries.map((e, idx) => {
    const hasMaterials = e.materials && e.materials.trim();
    const hasObservations = e.observations && e.observations.trim();
    const hasVisitors = e.visitors && e.visitors.trim();
    const hasIncident = e.incidents && e.incidents.trim();
    const weatherExtra = (e.weatherTemp != null || e.weatherWind != null)
      ? ` (${e.weatherTemp != null ? `${Math.round(e.weatherTemp)}°C` : ''}${e.weatherTemp != null && e.weatherWind != null ? ' · ' : ''}${e.weatherWind != null ? `${Math.round(e.weatherWind)} km/h` : ''})`
      : '';
    return `
      <tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-weight:700;white-space:nowrap;font-size:11px">${escapeHtml(e.date)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:12px">${escapeHtml(e.weather)}${escapeHtml(weatherExtra)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center;font-weight:700;font-size:13px;color:#003082">${e.workerCount}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;line-height:1.5">
          <div>${escapeHtml(e.workDone)}</div>
          ${hasMaterials ? `<div style="color:#6B7280;margin-top:4px;font-size:10px">📦 ${escapeHtml(e.materials)}</div>` : ''}
          ${hasObservations ? `<div style="color:#6B7280;margin-top:4px;font-size:10px">📝 ${escapeHtml(e.observations)}</div>` : ''}
          ${hasVisitors ? `<div style="color:#3B82F6;margin-top:4px;font-size:10px">👤 ${escapeHtml(t('journal.pdf.visitors'))} : ${escapeHtml(e.visitors)}</div>` : ''}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">
          ${hasIncident
            ? `<span style="color:#DC2626;font-weight:700">⚠ ${escapeHtml(e.incidents)}</span>`
            : `<span style="color:#059669">—</span>`
          }
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${escapeHtml(e.author)}</td>
      </tr>
    `;
  }).join('');

  const body = `
    ${buildLetterhead(t('journal.pdf.title'), dateRange, docRef, exportDate, projectName)}
    ${buildKpiRow([
      { val: entries.length, label: t('journal.pdf.entries'), color: '#003082' },
      { val: totalWorkers, label: t('journal.pdf.totalWorkers'), color: '#003082' },
      { val: avgWorkers, label: t('journal.pdf.dailyAverage'), color: '#1A2742' },
      { val: entriesWithIncidents, label: t('journal.pdf.incidentDays'), color: entriesWithIncidents > 0 ? '#DC2626' : '#059669' },
    ])}
    <div class="section-header">${escapeHtml(t('journal.pdf.register', { count: entries.length }))}</div>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(t('journal.pdf.date'))}</th><th>${escapeHtml(t('journal.pdf.weather'))}</th><th style="text-align:center">${escapeHtml(t('journal.pdf.workers'))}</th>
          <th>${escapeHtml(t('journal.pdf.workMaterialsObservations'))}</th>
          <th>${escapeHtml(t('journal.pdf.incidents'))}</th><th>${escapeHtml(t('journal.pdf.author'))}</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="6" style="padding:20px;text-align:center;color:#6B7280">${escapeHtml(t('journal.pdf.noEntries'))}</td></tr>`}
      </tbody>
    </table>
    <div class="sig-row" style="margin-top:32px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('journal.pdf.conductor'))}</div>
        <div class="sig-line"></div>
        <div style="font-size:11px;color:#6B7280">${escapeHtml(t('journal.pdf.signatureStamp'))}</div>
      </div>
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('journal.pdf.projectManager'))}</div>
        <div class="sig-line"></div>
        <div style="font-size:11px;color:#6B7280">${escapeHtml(t('journal.pdf.signatureStamp'))}</div>
      </div>
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('journal.pdf.certification'))}</div>
        <div style="font-size:11px;color:#1A2742;line-height:1.5">${escapeHtml(t('journal.pdf.certificationText'))}</div>
      </div>
    </div>
    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, t('journal.pdf.documentTitle', { project: projectName }));
}

export default function JournalScreen() {
  const { t } = useTranslation();
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();
  const { getEntriesForDate } = usePointage();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [fetchingWeather, setFetchingWeather] = useState(false);
  const [weatherDetail, setWeatherDetail] = useState<{ temp: number | null; wind: number | null; code: number | null } | null>(null);

  const todayFR = formatDateFR(new Date());
  const hasTodayEntry = entries.some(e => e.date === todayFR);

  useEffect(() => {
    AsyncStorage.getItem(JOURNAL_KEY).then(raw => {
      if (raw) { try { setEntries(JSON.parse(raw)); } catch {} }
      else {
        AsyncStorage.getItem('buildtrack_journal_v1').then(oldRaw => {
          if (oldRaw) { try { setEntries(JSON.parse(oldRaw)); } catch {} }
        });
      }
    });
  }, []);

  const [date, setDate] = useState(formatDateFR(new Date()));
  const [weather, setWeather] = useState('');
  const [workerCount, setWorkerCount] = useState('');
  const [workDone, setWorkDone] = useState('');
  const [workDoneTouched, setWorkDoneTouched] = useState(false);
  const [materials, setMaterials] = useState('');
  const [incidents, setIncidents] = useState('');
  const [observations, setObservations] = useState('');
  const [visitors, setVisitors] = useState('');
  const [workerCountFromPointage, setWorkerCountFromPointage] = useState(0);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (!showNew) return;
    const isoDate = frToISO(date);
    if (!isoDate) return;
    const pointageEntries = getEntriesForDate(isoDate);
    const distinctWorkers = new Set(pointageEntries.map(e => e.workerName)).size;
    if (distinctWorkers > 0) {
      setWorkerCountFromPointage(distinctWorkers);
      setWorkerCount(prev => (prev.trim() === '' ? String(distinctWorkers) : prev));
    } else {
      setWorkerCountFromPointage(0);
    }
  }, [showNew, date, getEntriesForDate]);

  const resetForm = () => {
    setDate(formatDateFR(new Date()));
    setWeather('');
    setWorkerCount('');
    setWorkDone('');
    setWorkDoneTouched(false);
    setMaterials('');
    setIncidents('');
    setObservations('');
    setVisitors('');
    setWeatherDetail(null);
    setWorkerCountFromPointage(0);
    setSubmitAttempted(false);
  };

  const handleAutoWeather = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert(t('journal.unavailableTitle'), t('journal.weatherWebUnavailable'));
      return;
    }
    setFetchingWeather(true);
    try {
      const result = await fetchAutoWeather(t);
      if (result) {
        setWeather(result.label);
        setWeatherDetail({ temp: result.temp, wind: result.wind, code: result.code });
      } else {
        Alert.alert(t('journal.weatherUnavailableTitle'), t('journal.weatherUnavailableText'));
      }
    } finally {
      setFetchingWeather(false);
    }
  }, [t]);

  const handleWorkerCountChange = (val: string) => {
    const digits = val.replace(/[^0-9]/g, '');
    setWorkerCount(digits);
  };

  const handleCreate = useCallback(() => {
    setSubmitAttempted(true);

    if (!date || !isValidDateFR(date)) {
      Alert.alert(t('journal.invalidDateTitle'), t('journal.invalidDateText'));
      return;
    }

    if (!workDone.trim()) {
      Alert.alert(t('pointage.requiredField'), t('journal.workRequired'));
      return;
    }

    const save = () => {
      const parsedWorkers = parseInt(workerCount, 10);
      const finalWeather = weather.trim() || '—';
      const entry: JournalEntry = {
        id: genId(),
        date,
        weather: finalWeather,
        workerCount: isNaN(parsedWorkers) || parsedWorkers < 0 ? 0 : parsedWorkers,
        workDone: workDone.trim(),
        materials: materials.trim(),
        incidents: incidents.trim(),
        observations: observations.trim(),
        visitors: visitors.trim(),
        author: user?.name ?? t('journal.teamFallback'),
        createdAt: nowTimestampFR(),
        weatherTemp: weatherDetail?.temp ?? undefined,
        weatherWind: weatherDetail?.wind ?? undefined,
        weatherCode: weatherDetail?.code ?? undefined,
        weatherDescription: weatherDetail ? finalWeather : undefined,
      };
      setEntries(prev => {
        const updated = [entry, ...prev];
        AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
      resetForm();
      setShowNew(false);
    };

    const duplicateEntry = entries.find(e => e.date === date);
    if (duplicateEntry) {
      Alert.alert(
        t('journal.duplicateTitle'),
        t('journal.duplicateText', { date }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('journal.createAnyway'), style: 'destructive', onPress: save },
        ]
      );
      return;
    }

    save();
  }, [date, weather, workerCount, workDone, materials, incidents, observations, visitors, weatherDetail, user, entries, t]);

  async function handleExportPDF() {
    if (!permissions.canExport) {
      Alert.alert(t('documentsScreen.accessDenied'), t('journal.exportDenied'));
      return;
    }
    try {
      const html = buildJournalHTML(entries, projectName, t);
      await exportPDFHelper(html, buildPdfFilename(t('journal.pdf.filename'), [projectName]));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? t('journal.pdfError'));
    }
  }

  const totalWorkers = entries.reduce((acc, e) => acc + e.workerCount, 0);
  const workDoneError = (submitAttempted || workDoneTouched) && !workDone.trim();

  if (user?.role === 'sous_traitant') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color="#94A3B8" />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#1E293B', marginTop: 16, textAlign: 'center' }}>
          {t('common.restrictedAccess')}
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: '#94A3B8', marginTop: 8, textAlign: 'center' }}>
          {t('journal.restrictedText')}
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
        title={t('journal.title')}
        subtitle={t('journal.subtitle', { count: entries.length, project: projectName })}
        showBack
        rightLabel={permissions.canCreate ? (showNew ? t('common.cancel') : t('common.add')) : undefined}
        onRightPress={permissions.canCreate ? () => { resetForm(); setShowNew(s => !s); } : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {permissions.canCreate && !hasTodayEntry && !showNew && (
          <TouchableOpacity
            style={styles.todayCTA}
            onPress={() => setShowNew(true)}
            activeOpacity={0.82}
          >
            <View style={styles.todayCTALeft}>
              <View style={styles.todayCTAIcon}>
                <Ionicons name="journal" size={20} color="#fff" />
              </View>
              <View>
                <Text style={styles.todayCTATitle}>{t('journal.todayCtaTitle')}</Text>
                <Text style={styles.todayCTASub}>{t('journal.todayCtaSub', { date: todayFR })}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.primary} />
          </TouchableOpacity>
        )}

        {entries.length > 0 && (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statVal}>{entries.length}</Text>
              <Text style={styles.statLabel}>{t('journal.entriesStat')}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statVal}>{totalWorkers}</Text>
              <Text style={styles.statLabel}>{t('journal.totalWorkersStat')}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statVal, entries.filter(e => e.incidents).length > 0 ? { color: C.open } : {}]}>
                {entries.filter(e => e.incidents).length}
              </Text>
              <Text style={styles.statLabel}>{t('journal.incidentsStat')}</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={handleExportPDF}>
                <Ionicons name="download-outline" size={14} color={C.primary} />
                <Text style={styles.exportBtnText}>PDF</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {showNew && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('journal.newEntry')}</Text>

            <DateInput label={t('journal.date')} value={date} onChange={setDate} />

            <View style={styles.weatherHeader}>
              <Text style={styles.label}>{t('journal.weatherLabel')}</Text>
              <TouchableOpacity
                style={[styles.autoWeatherBtn, fetchingWeather && styles.autoWeatherBtnLoading]}
                onPress={handleAutoWeather}
                disabled={fetchingWeather}
              >
                {fetchingWeather ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <Ionicons name="locate-outline" size={14} color={C.primary} />
                )}
                <Text style={styles.autoWeatherText}>
                  {fetchingWeather ? t('journal.locating') : t('journal.autoWeather')}
                </Text>
              </TouchableOpacity>
            </View>

            {weatherDetail && (
              <View style={styles.weatherDetailBanner}>
                <Ionicons name="thermometer-outline" size={14} color={C.primary} />
                <Text style={styles.weatherDetailText}>
                  {weatherDetail.temp !== null ? `${Math.round(weatherDetail.temp)}°C` : ''}
                  {weatherDetail.temp !== null && weatherDetail.wind !== null ? ' · ' : ''}
                  {weatherDetail.wind !== null ? `${Math.round(weatherDetail.wind)} km/h` : ''}
                  {' '}{t('journal.detectedByGps')}
                </Text>
              </View>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {WEATHER_OPTIONS.map(w => {
                  const label = getWeatherLabel(t, w);
                  return (
                  <TouchableOpacity
                    key={w}
                    style={[styles.chip, weather === label && styles.chipSelected]}
                    onPress={() => { setWeather(label); setWeatherDetail(null); }}
                  >
                    <Text style={[styles.chipText, weather === label && styles.chipTextSelected]}>{label}</Text>
                  </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={styles.label}>{t('journal.workerCountLabel')}</Text>
              {workerCountFromPointage > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.closedBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                  <Ionicons name="checkmark-circle" size={12} color={C.closed} />
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: C.closed }}>
                    {t('journal.fromAttendance', { date })}
                  </Text>
                </View>
              )}
            </View>
            <TextInput
              style={styles.input}
              placeholder={
                workerCountFromPointage > 0
                  ? t('journal.workerCountFromAttendancePlaceholder', { count: workerCountFromPointage })
                  : t('journal.workerCountPlaceholder')
              }
              placeholderTextColor={C.textMuted}
              value={workerCount}
              onChangeText={handleWorkerCountChange}
              keyboardType="numeric"
            />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, marginTop: 4 }}>
              <Text style={styles.label}>
                {t('journal.workDoneLabel')} <Text style={styles.required}>*</Text>
              </Text>
              {workDoneError && (
                <Text style={styles.fieldError}>{t('journal.requiredInline')}</Text>
              )}
            </View>
            <TextInput
              style={[styles.input, styles.multiline, workDoneError && styles.inputError]}
              placeholder={t('journal.workDonePlaceholder')}
              placeholderTextColor={C.textMuted}
              value={workDone}
              onChangeText={setWorkDone}
              onBlur={() => setWorkDoneTouched(true)}
              multiline
              numberOfLines={4}
              maxLength={2000}
            />

            <Text style={styles.label}>{t('journal.materialsLabel')}</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder={t('journal.materialsPlaceholder')} placeholderTextColor={C.textMuted} value={materials} onChangeText={setMaterials} multiline numberOfLines={2} />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, marginTop: 4 }}>
              <Text style={styles.label}>{t('journal.incidentsLabel')}</Text>
              {incidents.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.escalateBtn}
                  onPress={() => {
                    Alert.alert(
                      t('journal.createIncidentTitle'),
                      t('journal.createIncidentText'),
                      [
                        { text: t('pointage.stay'), style: 'cancel' },
                        {
                          text: t('common.continue'),
                          onPress: () => router.navigate({
                            pathname: '/(tabs)/incidents',
                            params: { openCreate: '1', prefillDescription: incidents.trim() },
                          } as any),
                        },
                      ]
                    );
                  }}
                >
                  <Ionicons name="warning-outline" size={12} color={C.waiting} />
                  <Text style={styles.escalateBtnText}>{t('journal.createIncidentButton')}</Text>
                </TouchableOpacity>
              )}
            </View>
            <TextInput style={[styles.input, styles.multiline]} placeholder={t('journal.incidentsPlaceholder')} placeholderTextColor={C.textMuted} value={incidents} onChangeText={setIncidents} multiline numberOfLines={2} />
            {incidents.trim().length > 0 && (
              <View style={styles.incidentHint}>
                <Ionicons name="information-circle-outline" size={13} color={C.waiting} />
                <Text style={styles.incidentHintText}>
                  {t('journal.incidentHint')}
                </Text>
              </View>
            )}

            <Text style={styles.label}>{t('journal.visitorsLabel')}</Text>
            <TextInput style={styles.input} placeholder={t('journal.visitorsPlaceholder')} placeholderTextColor={C.textMuted} value={visitors} onChangeText={setVisitors} />

            <Text style={styles.label}>{t('journal.observationsLabel')}</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder={t('journal.observationsPlaceholder')} placeholderTextColor={C.textMuted} value={observations} onChangeText={setObservations} multiline numberOfLines={2} />

            <TouchableOpacity style={styles.createBtn} onPress={handleCreate}>
              <Ionicons name="journal" size={18} color="#fff" />
              <Text style={styles.createBtnText}>{t('journal.saveEntry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {entries.length === 0 && !showNew && (
          <View style={styles.emptyBox}>
            <Ionicons name="journal-outline" size={52} color={C.border} />
            <Text style={styles.emptyTitle}>{t('journal.emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t('journal.emptyText')}</Text>
            {permissions.canCreate && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowNew(true)}>
                <Ionicons name="add-circle" size={18} color={C.primary} />
                <Text style={styles.emptyBtnText}>{t('journal.firstEntry')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {entries.map(entry => (
          <View key={entry.id} style={styles.entryCard}>
            <View style={styles.entryHeader}>
              <View style={styles.entryDateBadge}>
                <Text style={styles.entryDate}>{entry.date}</Text>
              </View>
              <Text style={styles.entryWeather}>{entry.weather}</Text>
              {(entry.weatherTemp != null || entry.weatherWind != null) && (
                <Text style={styles.entryWeatherDetail}>
                  {entry.weatherTemp != null ? `${Math.round(entry.weatherTemp)}°C` : ''}
                  {entry.weatherTemp != null && entry.weatherWind != null ? ' · ' : ''}
                  {entry.weatherWind != null ? `${Math.round(entry.weatherWind)} km/h` : ''}
                </Text>
              )}
              <View style={styles.entryWorkers}>
                <Ionicons name="people" size={14} color={C.textSub} />
              <Text style={styles.entryWorkersText}>{t('pointage.peopleShort', { count: entry.workerCount })}</Text>
              </View>
              <Text style={styles.entryAuthor}>{entry.author}</Text>
            </View>
            <Text style={styles.entryWork}>{entry.workDone}</Text>
            {entry.materials ? (
              <View style={styles.materialsBanner}>
                <Ionicons name="cube-outline" size={14} color={C.primary} />
                <Text style={styles.materialsBannerText}>{entry.materials}</Text>
              </View>
            ) : null}
            {entry.incidents ? (
              <View style={styles.incidentBanner}>
                <Ionicons name="warning" size={14} color={C.waiting} />
                <Text style={styles.incidentBannerText}>{entry.incidents}</Text>
              </View>
            ) : null}
            {entry.visitors ? (
              <Text style={styles.entryVisitor}>{t('journal.visitorsPrefix', { visitors: entry.visitors })}</Text>
            ) : null}
            {entry.observations ? (
              <Text style={styles.entryObs}>{entry.observations}</Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
      <BottomNavBar />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  todayCTA: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.primaryBg, borderRadius: 14, padding: 14, marginBottom: 14,
    borderWidth: 1.5, borderColor: C.primary + '50',
  },
  todayCTALeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  todayCTAIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  todayCTATitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.primary },
  todayCTASub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary + 'AA', marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14, alignItems: 'center' },
  statCard: { flex: 1, backgroundColor: C.surface, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  statVal: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.primary },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 10, backgroundColor: C.primaryBg, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40' },
  exportBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6, marginTop: 4 },
  required: { color: C.open, fontFamily: 'Inter_700Bold' },
  fieldError: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.open },
  input: { backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  inputError: { borderColor: C.open, borderWidth: 1.5 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  weatherHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, marginTop: 4 },
  autoWeatherBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: C.primary + '50',
  },
  autoWeatherBtnLoading: { opacity: 0.7 },
  autoWeatherText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  weatherDetailBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    marginBottom: 10, borderWidth: 1, borderColor: C.primary + '30',
  },
  weatherDetailText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, flex: 1 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  chipSelected: { backgroundColor: C.primaryBg, borderColor: C.primary },
  chipText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  chipTextSelected: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  escalateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.waiting + '15', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1, borderColor: C.waiting + '40',
  },
  escalateBtnText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.waiting },
  incidentHint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: C.waiting + '10', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    marginTop: -4, marginBottom: 12, borderWidth: 1, borderColor: C.waiting + '30',
  },
  incidentHintText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.waiting, lineHeight: 16 },
  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14 },
  createBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primaryBg, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8, borderWidth: 1, borderColor: C.primary + '40' },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  entryCard: { backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border, borderLeftWidth: 4, borderLeftColor: C.primary },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  entryDateBadge: { backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  entryDate: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  entryWeather: { fontSize: 16 },
  entryWeatherDetail: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  entryWorkers: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  entryWorkersText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  entryAuthor: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginLeft: 'auto' },
  entryWork: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20 },
  materialsBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: C.primaryBg, borderRadius: 8, padding: 8, marginTop: 8, borderLeftWidth: 3, borderLeftColor: C.primary },
  materialsBannerText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  incidentBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: C.waiting + '15', borderRadius: 8, padding: 8, marginTop: 8, borderLeftWidth: 3, borderLeftColor: C.waiting },
  incidentBannerText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  entryVisitor: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 6, fontStyle: 'italic' },
  entryObs: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 6, lineHeight: 18 },
});
