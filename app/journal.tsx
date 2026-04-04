import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import DateInput from '@/components/DateInput';
import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Location from 'expo-location';
import { router } from 'expo-router';
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

const WEATHER_OPTIONS = [
  '☀️ Ensoleillé',
  '⛅ Nuageux',
  '🌤️ Partiellement nuageux',
  '🌧️ Pluie',
  '🌩️ Orage',
  '❄️ Neige',
  '🌫️ Brouillard',
  '💨 Vent fort',
  '🌨️ Averses de neige',
  '🌦️ Averses',
];

function wmoCodesToLabel(wmo: number): string {
  if (wmo === 0) return '☀️ Ensoleillé';
  if (wmo <= 2) return '🌤️ Partiellement nuageux';
  if (wmo === 3) return '⛅ Nuageux';
  if (wmo <= 49) return '🌫️ Brouillard';
  if (wmo <= 59) return '🌦️ Averses';
  if (wmo <= 69) return '🌧️ Pluie';
  if (wmo <= 79) return '❄️ Neige';
  if (wmo <= 84) return '🌦️ Averses';
  if (wmo <= 86) return '🌨️ Averses de neige';
  if (wmo <= 99) return '🌩️ Orage';
  return '⛅ Nuageux';
}

async function fetchAutoWeather(): Promise<{ label: string; temp: number | null; wind: number | null; code: number } | null> {
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
    return { label: wmoCodesToLabel(wmo), temp, wind, code: wmo };
  } catch {
    return null;
  }
}

function frToISO(frDate: string): string {
  const parts = frDate.split('/');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function buildJournalHTML(entries: JournalEntry[], projectName: string): string {
  const exportDate = formatDateFR(new Date());
  const exportTime = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
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
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-weight:700;white-space:nowrap;font-size:11px">${e.date}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:12px">${e.weather}${weatherExtra}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center;font-weight:700;font-size:13px;color:#003082">${e.workerCount}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;line-height:1.5">
          <div>${e.workDone}</div>
          ${hasMaterials ? `<div style="color:#6B7280;margin-top:4px;font-size:10px">📦 ${e.materials}</div>` : ''}
          ${hasObservations ? `<div style="color:#6B7280;margin-top:4px;font-size:10px">📝 ${e.observations}</div>` : ''}
          ${hasVisitors ? `<div style="color:#3B82F6;margin-top:4px;font-size:10px">👤 Visiteurs : ${e.visitors}</div>` : ''}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">
          ${hasIncident
            ? `<span style="color:#DC2626;font-weight:700">⚠ ${e.incidents}</span>`
            : `<span style="color:#059669">—</span>`
          }
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${e.author}</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #1A2742; font-size: 12px; padding: 28px 32px; line-height: 1.5; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { margin: 15mm 12mm; }
        tr { page-break-inside: avoid; }
      }
    </style>
  </head><body>

    <!-- Letterhead -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #003082;margin-bottom:22px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:42px;height:42px;background:#003082;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px">BT</div>
        <div>
          <div style="font-size:20px;font-weight:800;color:#003082">BuildTrack</div>
          <div style="font-size:10px;color:#6B7280">Gestion de chantier numérique</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:15px;font-weight:700;color:#1A2742">Journal de chantier officiel</div>
        <div style="font-size:11px;color:#6B7280;margin-top:3px">${dateRange}</div>
        <div style="font-size:10px;color:#6B7280;margin-top:8px">Projet : <strong style="color:#1A2742">${projectName}</strong></div>
        <div style="font-size:10px;color:#6B7280">Réf. : <strong style="color:#1A2742">${docRef}</strong> &nbsp;|&nbsp; Exporté le <strong style="color:#1A2742">${exportDate}</strong> à ${exportTime}</div>
      </div>
    </div>

    <!-- KPIs -->
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      ${[
        { val: entries.length, label: 'Entrées journal', color: '#003082' },
        { val: totalWorkers, label: 'Effectif cumulé', color: '#003082' },
        { val: avgWorkers, label: 'Moy. journalière', color: '#1A2742' },
        { val: entriesWithIncidents, label: 'Jours avec incidents', color: entriesWithIncidents > 0 ? '#DC2626' : '#059669' },
      ].map(k => `
        <div style="flex:1;min-width:90px;border:1.5px solid #DDE4EE;border-radius:10px;padding:12px 14px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:${k.color}">${k.val}</div>
          <div style="font-size:10px;color:#6B7280;margin-top:2px">${k.label}</div>
        </div>
      `).join('')}
    </div>

    <!-- Section header -->
    <div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:10px;padding-bottom:6px;border-bottom:1.5px solid #DDE4EE">
      Registre des journées (${entries.length} entrée${entries.length !== 1 ? 's' : ''})
    </div>

    <!-- Main table -->
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Date</th>
          <th style="background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Météo</th>
          <th style="background:#003082;color:#fff;padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Effectif</th>
          <th style="background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Travaux réalisés / Matériaux / Observations</th>
          <th style="background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Incidents</th>
          <th style="background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Rédacteur</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="6" style="padding:20px;text-align:center;color:#6B7280">Aucune entrée dans le journal</td></tr>'}
      </tbody>
    </table>

    <!-- Signature block -->
    <div style="display:flex;gap:24px;margin-top:32px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div style="flex:1;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px;background:#FAFBFF">
        <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:30px;font-weight:700">Conducteur de travaux</div>
        <div style="border-bottom:2px solid #1A2742;margin-bottom:6px"></div>
        <div style="font-size:11px;color:#6B7280">Signature et cachet</div>
      </div>
      <div style="flex:1;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px;background:#FAFBFF">
        <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:30px;font-weight:700">Maître d'œuvre</div>
        <div style="border-bottom:2px solid #1A2742;margin-bottom:6px"></div>
        <div style="font-size:11px;color:#6B7280">Signature et cachet</div>
      </div>
      <div style="flex:1;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px;background:#FAFBFF">
        <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;font-weight:700">Certification</div>
        <div style="font-size:11px;color:#1A2742;line-height:1.5">Je soussigné(e) certifie l'exactitude des informations contenues dans ce journal de chantier.</div>
      </div>
    </div>

    <div style="margin-top:20px;padding-top:12px;border-top:1.5px solid #DDE4EE;display:flex;justify-content:space-between;font-size:9px;color:#6B7280">
      <span>Généré par BuildTrack — ${projectName}</span>
      <span>Document officiel — Confidential — ${exportDate}</span>
    </div>
  </body></html>`;
}

export default function JournalScreen() {
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
      Alert.alert('Non disponible', 'La géolocalisation météo n\'est pas disponible sur web. Sélectionnez manuellement.');
      return;
    }
    setFetchingWeather(true);
    try {
      const result = await fetchAutoWeather();
      if (result) {
        setWeather(result.label);
        setWeatherDetail({ temp: result.temp, wind: result.wind, code: result.code });
      } else {
        Alert.alert('Météo indisponible', 'Impossible de récupérer la météo automatiquement. Vérifiez les autorisations de localisation.');
      }
    } finally {
      setFetchingWeather(false);
    }
  }, []);

  const handleWorkerCountChange = (val: string) => {
    const digits = val.replace(/[^0-9]/g, '');
    setWorkerCount(digits);
  };

  const handleCreate = useCallback(() => {
    setSubmitAttempted(true);

    if (!date || !isValidDateFR(date)) {
      Alert.alert('Date invalide', 'Veuillez saisir une date valide au format JJ/MM/AAAA.');
      return;
    }

    if (!workDone.trim()) {
      Alert.alert('Champ requis', 'Veuillez décrire les travaux réalisés.');
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
        author: user?.name ?? 'Équipe',
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
        'Entrée existante',
        `Une entrée existe déjà pour le ${date}. Voulez-vous quand même créer une nouvelle entrée pour cette date ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Créer quand même', style: 'destructive', onPress: save },
        ]
      );
      return;
    }

    save();
  }, [date, weather, workerCount, workDone, materials, incidents, observations, visitors, weatherDetail, user, entries]);

  async function handleExportPDF() {
    if (!permissions.canExport) {
      Alert.alert('Accès refusé', "Votre rôle ne permet pas d'exporter.");
      return;
    }
    const html = buildJournalHTML(entries, projectName);
    if (Platform.OS === 'web') {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow?.document;
      if (doc) {
        doc.open(); doc.write(html); doc.close();
        setTimeout(() => {
          try { iframe.contentWindow?.print(); } catch {}
          setTimeout(() => document.body.removeChild(iframe), 5000);
        }, 300);
      }
      return;
    }
    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Journal de chantier' });
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible de générer le PDF');
    }
  }

  const totalWorkers = entries.reduce((acc, e) => acc + e.workerCount, 0);
  const workDoneError = (submitAttempted || workDoneTouched) && !workDone.trim();

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header
        title="Journal de chantier"
        subtitle={`${entries.length} entrées — ${projectName}`}
        showBack
        rightLabel={permissions.canCreate ? (showNew ? 'Annuler' : 'Ajouter') : undefined}
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
                <Text style={styles.todayCTATitle}>Saisir l'entrée du jour</Text>
                <Text style={styles.todayCTASub}>{todayFR} — aucune saisie ce jour</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.primary} />
          </TouchableOpacity>
        )}

        {entries.length > 0 && (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statVal}>{entries.length}</Text>
              <Text style={styles.statLabel}>Entrées</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statVal}>{totalWorkers}</Text>
              <Text style={styles.statLabel}>Effectif cumulé</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statVal, entries.filter(e => e.incidents).length > 0 ? { color: C.open } : {}]}>
                {entries.filter(e => e.incidents).length}
              </Text>
              <Text style={styles.statLabel}>Incidents notés</Text>
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
            <Text style={styles.sectionTitle}>Nouvelle entrée journal</Text>

            <DateInput label="Date" value={date} onChange={setDate} />

            <View style={styles.weatherHeader}>
              <Text style={styles.label}>Météo</Text>
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
                  {fetchingWeather ? 'Localisation…' : 'Météo auto'}
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
                  {' '}— détectée automatiquement via GPS
                </Text>
              </View>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {WEATHER_OPTIONS.map(w => (
                  <TouchableOpacity
                    key={w}
                    style={[styles.chip, weather === w && styles.chipSelected]}
                    onPress={() => { setWeather(w); setWeatherDetail(null); }}
                  >
                    <Text style={[styles.chipText, weather === w && styles.chipTextSelected]}>{w}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={styles.label}>Effectif sur site</Text>
              {workerCountFromPointage > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.closedBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                  <Ionicons name="checkmark-circle" size={12} color={C.closed} />
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: C.closed }}>
                    Depuis le pointage ({date})
                  </Text>
                </View>
              )}
            </View>
            <TextInput
              style={styles.input}
              placeholder={
                workerCountFromPointage > 0
                  ? `${workerCountFromPointage} (depuis le pointage)`
                  : 'Nombre de personnes'
              }
              placeholderTextColor={C.textMuted}
              value={workerCount}
              onChangeText={handleWorkerCountChange}
              keyboardType="numeric"
            />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, marginTop: 4 }}>
              <Text style={styles.label}>
                Travaux réalisés <Text style={styles.required}>*</Text>
              </Text>
              {workDoneError && (
                <Text style={styles.fieldError}>Champ obligatoire</Text>
              )}
            </View>
            <TextInput
              style={[styles.input, styles.multiline, workDoneError && styles.inputError]}
              placeholder="Description détaillée des travaux effectués aujourd'hui..."
              placeholderTextColor={C.textMuted}
              value={workDone}
              onChangeText={setWorkDone}
              onBlur={() => setWorkDoneTouched(true)}
              multiline
              numberOfLines={4}
              maxLength={2000}
            />

            <Text style={styles.label}>Matériaux / Livraisons</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Livraisons reçues, matériaux consommés..." placeholderTextColor={C.textMuted} value={materials} onChangeText={setMaterials} multiline numberOfLines={2} />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, marginTop: 4 }}>
              <Text style={styles.label}>Incidents / Problèmes</Text>
              {incidents.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.escalateBtn}
                  onPress={() => {
                    Alert.alert(
                      'Créer un incident formel ?',
                      'Vous allez quitter ce formulaire pour accéder au module Incidents. Votre description sera pré-remplie mais l\'entrée journal en cours ne sera pas sauvegardée.',
                      [
                        { text: 'Rester', style: 'cancel' },
                        {
                          text: 'Continuer',
                          onPress: () => router.push({
                            pathname: '/(tabs)/incidents',
                            params: { openCreate: '1', prefillDescription: incidents.trim() },
                          } as any),
                        },
                      ]
                    );
                  }}
                >
                  <Ionicons name="warning-outline" size={12} color={C.waiting} />
                  <Text style={styles.escalateBtnText}>Créer un incident formel</Text>
                </TouchableOpacity>
              )}
            </View>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Signalement d'incidents ou difficultés rencontrées..." placeholderTextColor={C.textMuted} value={incidents} onChangeText={setIncidents} multiline numberOfLines={2} />
            {incidents.trim().length > 0 && (
              <View style={styles.incidentHint}>
                <Ionicons name="information-circle-outline" size={13} color={C.waiting} />
                <Text style={styles.incidentHintText}>
                  Pour un incident grave, utilisez le module Incidents pour un suivi formel complet.
                </Text>
              </View>
            )}

            <Text style={styles.label}>Visiteurs</Text>
            <TextInput style={styles.input} placeholder="Ex: MOA, Bureau de contrôle, Architecte..." placeholderTextColor={C.textMuted} value={visitors} onChangeText={setVisitors} />

            <Text style={styles.label}>Observations générales</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Notes complémentaires..." placeholderTextColor={C.textMuted} value={observations} onChangeText={setObservations} multiline numberOfLines={2} />

            <TouchableOpacity style={styles.createBtn} onPress={handleCreate}>
              <Ionicons name="journal" size={18} color="#fff" />
              <Text style={styles.createBtnText}>Enregistrer l'entrée</Text>
            </TouchableOpacity>
          </View>
        )}

        {entries.length === 0 && !showNew && (
          <View style={styles.emptyBox}>
            <Ionicons name="journal-outline" size={52} color={C.border} />
            <Text style={styles.emptyTitle}>Journal vide</Text>
            <Text style={styles.emptyText}>Le journal de chantier est un document officiel retraçant l'avancement quotidien des travaux.</Text>
            {permissions.canCreate && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowNew(true)}>
                <Ionicons name="add-circle" size={18} color={C.primary} />
                <Text style={styles.emptyBtnText}>Première entrée</Text>
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
                <Text style={styles.entryWorkersText}>{entry.workerCount} pers.</Text>
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
              <Text style={styles.entryVisitor}>Visiteurs : {entry.visitors}</Text>
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
