import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, Platform, Alert, TouchableWithoutFeedback,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { usePointage } from '@/context/PointageContext';
import { useSettings } from '@/context/SettingsContext';
import Header from '@/components/Header';
import { TimeEntry } from '@/constants/types';
import BottomNavBar from '@/components/BottomNavBar';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatDateShort(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function getDayLabel(iso: string): string {
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const d = new Date(iso + 'T12:00:00');
  return days[d.getDay()];
}

function calcHours(arrival: string, departure?: string): number | null {
  if (!departure) return null;
  const [ah, am] = arrival.split(':').map(Number);
  const [dh, dm] = departure.split(':').map(Number);
  const diff = (dh * 60 + dm) - (ah * 60 + am);
  return diff > 0 ? Math.round((diff / 60) * 10) / 10 : null;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function getWeekDates(dateISO: string): string[] {
  const d = new Date(dateISO + 'T12:00:00');
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(dd.getDate() + i);
    return dd.toISOString().slice(0, 10);
  });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(p => p[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const ARRIVAL_PRESETS = ['06:30', '07:00', '07:30', '08:00', '08:30'];
const DEPARTURE_PRESETS = ['16:00', '16:30', '17:00', '17:30', '18:00'];

function formatTimeInput(raw: string): string {
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + ':' + digits.slice(2);
}

function nowISOTimestamp(): string {
  return new Date().toISOString();
}

function sanitizeDefaultArrivalTime(t: string): string {
  if (/^\d{2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(':').map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return t;
  }
  return '07:30';
}

type ViewMode = 'list' | 'grid';

export default function PointageScreen() {
  const { companies, tasks } = useApp();
  const { user, permissions } = useAuth();
  const { entries, addEntry, updateEntry, deleteEntry } = usePointage();
  const { defaultArrivalTime } = useSettings();
  const router = useRouter();

  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<TimeEntry | null>(null);
  const [departureModal, setDepartureModal] = useState<TimeEntry | null>(null);
  const [bulkDepModal, setBulkDepModal] = useState(false);

  const [workerName, setWorkerName] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [arrivalTime, setArrivalTime] = useState(sanitizeDefaultArrivalTime(defaultArrivalTime));
  const [departureTime, setDepartureTime] = useState('');
  const [showDeparture, setShowDeparture] = useState(false);
  const [notes, setNotes] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedTaskTitle, setSelectedTaskTitle] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workerNameRef = useRef<TextInput>(null);
  const arrivalRef = useRef<TextInput>(null);
  const departureRef = useRef<TextInput>(null);
  const companyScrollRef = useRef<ScrollView>(null);

  const [depTime, setDepTime] = useState('17:00');
  const [filterCompany, setFilterCompany] = useState('');

  const workerSuggestions = useMemo(() => {
    const allNames = Array.from(new Set(entries.map(e => e.workerName)));
    if (!workerName.trim()) return [];
    const q = workerName.trim().toLowerCase();
    return allNames.filter(n => n.toLowerCase().includes(q) && n.toLowerCase() !== q).slice(0, 5);
  }, [entries, workerName]);

  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);

  const weekChartData = useMemo(() => {
    return weekDates.map(date => {
      const dayEntries = entries.filter(e => e.date === date);
      const actifs = dayEntries.filter(e => !e.departureTime).length;
      const partis = dayEntries.filter(e => !!e.departureTime).length;
      return { date, total: dayEntries.length, actifs, partis };
    });
  }, [entries, weekDates]);

  if (user !== null && user.role === 'sous_traitant') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, marginBottom: 8 }}>Accès restreint</Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginBottom: 24 }}>
          Le pointage du personnel n'est pas accessible aux sous-traitants.
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: C.primaryBg, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40' }}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary }}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const maxWeekCount = useMemo(() => Math.max(...weekChartData.map(d => d.total), 1), [weekChartData]);

  const dateEntries = useMemo(() =>
    entries
      .filter(e => e.date === selectedDate)
      .filter(e => !filterCompany || e.companyId === filterCompany)
      .sort((a, b) => timeToMinutes(a.arrivalTime) - timeToMinutes(b.arrivalTime)),
    [entries, selectedDate, filterCompany]
  );

  const allDateEntries = useMemo(() =>
    entries.filter(e => e.date === selectedDate),
    [entries, selectedDate]
  );

  const actifs = allDateEntries.filter(e => !e.departureTime).length;
  const departed = allDateEntries.filter(e => !!e.departureTime).length;
  const totalHours = allDateEntries.reduce((acc, e) => {
    const h = calcHours(e.arrivalTime, e.departureTime);
    return acc + (h ?? 0);
  }, 0);

  const byCompany = useMemo(() => {
    const map: Record<string, { name: string; color: string; count: number; hours: number; id: string }> = {};
    allDateEntries.forEach(e => {
      if (!map[e.companyId]) map[e.companyId] = { name: e.companyName, color: e.companyColor, count: 0, hours: 0, id: e.companyId };
      map[e.companyId].count++;
      const h = calcHours(e.arrivalTime, e.departureTime);
      if (h) map[e.companyId].hours += h;
    });
    return Object.values(map);
  }, [allDateEntries]);

  const activeTasks = useMemo(() =>
    tasks.filter(t => t.status === 'in_progress' || t.status === 'todo').slice(0, 20),
    [tasks]
  );

  const showToast = useCallback(() => {
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    setToastVisible(true);
    toastTimeout.current = setTimeout(() => setToastVisible(false), 2200);
  }, []);

  const hasFormChanges = useCallback(() => {
    if (!editTarget) {
      const defaultArr = sanitizeDefaultArrivalTime(defaultArrivalTime);
      return (
        workerName.trim() !== '' ||
        notes.trim() !== '' ||
        departureTime.trim() !== '' ||
        selectedTaskId !== '' ||
        arrivalTime !== defaultArr
      );
    }
    return (
      workerName !== editTarget.workerName ||
      selectedCompanyId !== editTarget.companyId ||
      arrivalTime !== editTarget.arrivalTime ||
      departureTime !== (editTarget.departureTime ?? '') ||
      notes !== (editTarget.notes ?? '') ||
      selectedTaskId !== (editTarget.taskId ?? '')
    );
  }, [editTarget, workerName, notes, departureTime, selectedTaskId, selectedCompanyId, arrivalTime, defaultArrivalTime]);

  function openAdd() {
    setEditTarget(null);
    setWorkerName('');
    setSelectedCompanyId(companies[0]?.id ?? '');
    setArrivalTime(sanitizeDefaultArrivalTime(defaultArrivalTime));
    setDepartureTime('');
    setShowDeparture(false);
    setNotes('');
    setSelectedTaskId('');
    setSelectedTaskTitle('');
    setShowSuggestions(false);
    setModalVisible(true);
    setTimeout(() => {
      companyScrollRef.current?.scrollTo({ x: 0, animated: false });
    }, 100);
  }

  function openEdit(entry: TimeEntry) {
    setEditTarget(entry);
    setWorkerName(entry.workerName);
    setSelectedCompanyId(entry.companyId);
    setArrivalTime(entry.arrivalTime);
    setDepartureTime(entry.departureTime ?? '');
    setShowDeparture(!!entry.departureTime);
    setNotes(entry.notes ?? '');
    setSelectedTaskId(entry.taskId ?? '');
    setSelectedTaskTitle(entry.taskTitle ?? '');
    setShowSuggestions(false);
    setModalVisible(true);
    setTimeout(() => {
      const idx = companies.findIndex(c => c.id === entry.companyId);
      if (idx > 0 && companyScrollRef.current) {
        companyScrollRef.current.scrollTo({ x: idx * 100, animated: false });
      }
    }, 100);
  }

  function closeModal() {
    if (hasFormChanges()) {
      Alert.alert(
        'Modifications non sauvegardées',
        'Des modifications seront perdues. Quitter quand même ?',
        [
          { text: 'Rester', style: 'cancel' },
          {
            text: 'Quitter', style: 'destructive',
            onPress: () => { setModalVisible(false); setEditTarget(null); setShowSuggestions(false); },
          },
        ]
      );
    } else {
      setModalVisible(false);
      setEditTarget(null);
      setShowSuggestions(false);
    }
  }

  function validateTime(t: string): boolean {
    if (!/^\d{2}:\d{2}$/.test(t)) return false;
    const [h, m] = t.split(':').map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }

  async function handleSave() {
    const trimmedName = workerName.trim();
    if (!trimmedName) {
      Alert.alert('Champ requis', "Le nom de l'ouvrier est obligatoire.");
      return;
    }
    if (!selectedCompanyId) {
      Alert.alert('Champ requis', 'Veuillez sélectionner une entreprise.');
      return;
    }
    if (!validateTime(arrivalTime)) {
      Alert.alert('Heure invalide', "L'heure d'arrivée doit être au format HH:MM avec des valeurs valides (ex: 07:30).");
      return;
    }
    const effDeparture = showDeparture ? departureTime.trim() : '';
    if (effDeparture && !validateTime(effDeparture)) {
      Alert.alert('Heure invalide', "L'heure de départ doit être au format HH:MM avec des valeurs valides (ex: 17:00).");
      return;
    }
    if (effDeparture && validateTime(effDeparture)) {
      if (timeToMinutes(effDeparture) <= timeToMinutes(arrivalTime)) {
        Alert.alert('Incohérence horaire', "L'heure de départ doit être strictement postérieure à l'heure d'arrivée.");
        return;
      }
    }

    const company = companies.find(c => c.id === selectedCompanyId);
    if (!company) return;

    const duplicate = entries.find(e =>
      e.date === selectedDate &&
      e.workerName.trim().toLowerCase() === trimmedName.toLowerCase() &&
      e.companyId === selectedCompanyId &&
      (!editTarget || e.id !== editTarget.id)
    );
    if (duplicate) {
      const confirmed = await new Promise<boolean>(resolve => {
        Alert.alert(
          'Doublon détecté',
          `"${trimmedName}" est déjà pointé pour ce jour chez "${company.name}". Continuer quand même ?`,
          [
            { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continuer', onPress: () => resolve(true) },
          ]
        );
      });
      if (!confirmed) return;
    }

    const base = {
      workerName: trimmedName,
      companyId: company.id,
      companyName: company.name,
      companyColor: company.color,
      arrivalTime,
      departureTime: effDeparture || undefined,
      notes: notes.trim() || undefined,
      taskId: selectedTaskId || undefined,
      taskTitle: selectedTaskTitle || undefined,
    };

    if (editTarget) {
      await updateEntry(editTarget.id, {
        ...base,
        updatedBy: user?.name ?? 'Système',
        updatedAt: nowISOTimestamp(),
      });
    } else {
      await addEntry({
        ...base,
        date: selectedDate,
        recordedBy: user?.name ?? 'Système',
      });
    }
    setModalVisible(false);
    setEditTarget(null);
    setShowSuggestions(false);
    showToast();
  }

  async function handleSetDeparture() {
    if (!departureModal) return;
    if (!validateTime(depTime)) {
      Alert.alert('Format invalide', "L'heure de départ doit être au format HH:MM (ex: 17:00).");
      return;
    }
    if (timeToMinutes(depTime) <= timeToMinutes(departureModal.arrivalTime)) {
      Alert.alert('Incohérence horaire', `L'heure de départ doit être postérieure à l'arrivée (${departureModal.arrivalTime}).`);
      return;
    }
    await updateEntry(departureModal.id, { departureTime: depTime });
    setDepartureModal(null);
  }

  async function handleBulkDeparture() {
    if (!validateTime(depTime)) {
      Alert.alert('Format invalide', "L'heure de départ doit être au format HH:MM (ex: 17:00).");
      return;
    }
    const activeEntries = allDateEntries.filter(e => !e.departureTime);
    const conflicting = activeEntries.filter(e => timeToMinutes(depTime) <= timeToMinutes(e.arrivalTime));
    if (conflicting.length > 0) {
      Alert.alert(
        'Incohérence horaire',
        `${conflicting.length} ouvrier${conflicting.length > 1 ? 's arrivent' : ' arrive'} après ${depTime}. Choisissez une heure plus tardive.`
      );
      return;
    }
    await Promise.all(activeEntries.map(e => updateEntry(e.id, { departureTime: depTime })));
    setBulkDepModal(false);
  }

  function handleDelete(entry: TimeEntry) {
    Alert.alert('Supprimer', `Supprimer le pointage de "${entry.workerName}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteEntry(entry.id) },
    ]);
  }

  function changeDate(offset: number) {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + offset);
    setSelectedDate(d.toISOString().slice(0, 10));
  }

  function selectTask(taskId: string, taskTitle: string) {
    if (selectedTaskId === taskId) {
      setSelectedTaskId('');
      setSelectedTaskTitle('');
    } else {
      setSelectedTaskId(taskId);
      setSelectedTaskTitle(taskTitle);
    }
  }

  async function handleExportCSV() {
    const weekEntries = entries.filter(e => weekDates.includes(e.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.arrivalTime.localeCompare(b.arrivalTime));
    if (weekEntries.length === 0) {
      Alert.alert('Aucune donnée', 'Aucun pointage sur cette semaine pour exporter.');
      return;
    }
    const header = 'Date,Ouvrier,Entreprise,Arrivée,Départ,Heures,Tâche,Saisi par,Notes';
    const rows = weekEntries.map(e => {
      const h = calcHours(e.arrivalTime, e.departureTime);
      const cols = [
        formatDate(e.date),
        e.workerName,
        e.companyName,
        e.arrivalTime,
        e.departureTime ?? '',
        h !== null ? String(h).replace('.', ',') : '',
        e.taskTitle ?? '',
        e.recordedBy ?? '',
        (e.notes ?? '').replace(/[\r\n,]/g, ' '),
      ];
      return cols.map(c => `"${c}"`).join(',');
    });
    const csv = [header, ...rows].join('\n');
    const weekLabel = `${formatDate(weekDates[0])}_${formatDate(weekDates[6])}`.replace(/\//g, '-');
    const filename = `Pointage_${weekLabel}.csv`;
    if (Platform.OS === 'web') {
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } else {
      try {
        const uri = (FileSystem.cacheDirectory ?? '') + filename;
        await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Exporter le pointage hebdomadaire' });
        } else {
          Alert.alert('Export', `Fichier enregistré : ${uri}`);
        }
      } catch {
        Alert.alert('Erreur', "Impossible d'exporter le CSV.");
      }
    }
  }

  const canEdit = permissions.canUpdateAttendance || permissions.canCreate;

  if (user !== null && user.role === 'sous_traitant') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color="#94A3B8" />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#1E293B', marginTop: 16, textAlign: 'center' }}>
          Accès restreint
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: '#94A3B8', marginTop: 8, textAlign: 'center' }}>
          Le pointage n'est pas accessible aux sous-traitants.
        </Text>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.navigate('/(tabs)/' as any)}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#2563EB', borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Retour au tableau de bord</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header
        title="Présence sur site"
        subtitle="Pointage & suivi des équipes"
        showBack
        rightIcon={canEdit ? 'add-outline' : undefined}
        onRightPress={canEdit ? openAdd : undefined}
      />

      {/* Date navigator */}
      <View style={styles.datePicker}>
        <TouchableOpacity onPress={() => changeDate(-1)} style={styles.dateBtn}>
          <Ionicons name="chevron-back" size={20} color={C.primary} />
        </TouchableOpacity>
        <View style={styles.dateLabelWrap}>
          <Text style={styles.dateLabel}>{formatDate(selectedDate)}</Text>
          {selectedDate === todayISO()
            ? <Text style={styles.todayTag}>Aujourd'hui</Text>
            : (
              <TouchableOpacity onPress={() => setSelectedDate(todayISO())} style={styles.todayJumpBtn}>
                <Ionicons name="today-outline" size={11} color={C.primary} />
                <Text style={styles.todayJumpText}>Retour à aujourd'hui</Text>
              </TouchableOpacity>
            )
          }
        </View>
        <TouchableOpacity
          onPress={() => changeDate(1)}
          style={styles.dateBtn}
          disabled={selectedDate >= todayISO()}
        >
          <Ionicons name="chevron-forward" size={20} color={selectedDate >= todayISO() ? C.textMuted : C.primary} />
        </TouchableOpacity>
      </View>

      {/* Week mini-chart */}
      <View style={styles.weekChart}>
        {weekChartData.map(({ date, total, actifs: a }) => {
          const isSelected = date === selectedDate;
          const barH = total > 0 ? Math.max(4, Math.round((total / maxWeekCount) * 36)) : 4;
          const isFuture = date > todayISO();
          return (
            <TouchableOpacity
              key={date}
              style={styles.weekDay}
              onPress={() => !isFuture && setSelectedDate(date)}
              disabled={isFuture}
            >
              <Text style={[styles.weekDayCount, isSelected && { color: C.primary, fontFamily: 'Inter_700Bold' }]}>
                {total > 0 ? total : ''}
              </Text>
              <View style={styles.weekBarBg}>
                <View style={[
                  styles.weekBarFill,
                  { height: barH, backgroundColor: isFuture ? C.border : isSelected ? C.primary : C.primaryBg },
                  total > 0 && !isFuture && { backgroundColor: isSelected ? C.primary : '#93B4E8' },
                ]} />
              </View>
              <Text style={[
                styles.weekDayLabel,
                isSelected && { color: C.primary, fontFamily: 'Inter_600SemiBold' },
                isFuture && { color: C.border },
              ]}>
                {getDayLabel(date)}
              </Text>
              <Text style={[
                styles.weekDayDate,
                isSelected && { color: C.primary },
                isFuture && { color: C.border },
              ]}>
                {formatDateShort(date)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* KPI row */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <View style={styles.kpiDot} />
          <Text style={[styles.kpiVal, { color: C.closed }]}>{actifs}</Text>
          <Text style={styles.kpiLabel}>Sur site</Text>
        </View>
        <View style={styles.kpiDivider} />
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiVal, { color: C.textSub }]}>{departed}</Text>
          <Text style={styles.kpiLabel}>Partis</Text>
        </View>
        <View style={styles.kpiDivider} />
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiVal, { color: C.medium }]}>
            {totalHours > 0 ? `${Math.round(totalHours * 10) / 10}h` : '—'}
          </Text>
          <Text style={styles.kpiLabel}>Total heures</Text>
        </View>
        <View style={styles.kpiDivider} />
        <TouchableOpacity style={styles.kpiExportBtn} onPress={handleExportCSV}>
          <Ionicons name="download-outline" size={16} color={C.primary} />
          <Text style={styles.kpiExportText}>CSV</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Journal shortcut */}
        {selectedDate === todayISO() && allDateEntries.length > 0 && (
          <TouchableOpacity
            style={styles.journalBanner}
            onPress={() => router.push('/journal')}
            activeOpacity={0.82}
          >
            <View style={styles.journalBannerLeft}>
              <View style={styles.journalBannerIcon}>
                <Ionicons name="journal" size={16} color="#fff" />
              </View>
              <View>
                <Text style={styles.journalBannerTitle}>Compléter le journal du jour</Text>
                <Text style={styles.journalBannerSub}>
                  {allDateEntries.length} présent{allDateEntries.length > 1 ? 's' : ''} · {totalHours > 0 ? `${Math.round(totalHours * 10) / 10}h pointées` : 'heures en cours'}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.primary} />
          </TouchableOpacity>
        )}

        {/* Bulk departure */}
        {canEdit && actifs > 0 && (
          <TouchableOpacity
            style={styles.bulkDepBtn}
            onPress={() => { setDepTime('17:00'); setBulkDepModal(true); }}
            activeOpacity={0.82}
          >
            <Ionicons name="log-out-outline" size={16} color={C.open} />
            <Text style={styles.bulkDepText}>
              Pointer le départ des {actifs} actif{actifs > 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        )}

        {/* Company filters + view toggle */}
        {allDateEntries.length > 0 && (
          <View style={styles.filterRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flex: 1 }}
              contentContainerStyle={{ gap: 8, flexDirection: 'row', paddingRight: 12 }}
            >
              <TouchableOpacity
                style={[styles.companyChip, !filterCompany && styles.companyChipActive]}
                onPress={() => setFilterCompany('')}
              >
                <Text style={[styles.companyChipText, !filterCompany && styles.companyChipTextActive]}>Tous</Text>
              </TouchableOpacity>
              {byCompany.map(co => (
                <TouchableOpacity
                  key={co.id}
                  style={[
                    styles.companyChip,
                    filterCompany === co.id && styles.companyChipActive,
                    { borderColor: co.color },
                  ]}
                  onPress={() => setFilterCompany(prev => prev === co.id ? '' : co.id)}
                >
                  <View style={[styles.companyDot, { backgroundColor: co.color }]} />
                  <Text style={styles.companyChipText}>{co.name} ({co.count})</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.viewToggle}>
              <TouchableOpacity
                style={[styles.viewBtn, viewMode === 'list' && styles.viewBtnActive]}
                onPress={() => setViewMode('list')}
              >
                <Ionicons name="list" size={16} color={viewMode === 'list' ? C.primary : C.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewBtn, viewMode === 'grid' && styles.viewBtnActive]}
                onPress={() => setViewMode('grid')}
              >
                <Ionicons name="grid" size={14} color={viewMode === 'grid' ? C.primary : C.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Empty state */}
        {dateEntries.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={52} color={C.border} />
            <Text style={styles.emptyText}>Aucun pointage pour cette journée</Text>
            {canEdit && (
              <TouchableOpacity style={styles.emptyAddBtn} onPress={openAdd}>
                <Ionicons name="add-circle" size={18} color={C.primary} />
                <Text style={styles.emptyAddText}>Ajouter une arrivée</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* LIST VIEW */}
        {viewMode === 'list' && dateEntries.length > 0 && (
          <View style={styles.list}>
            {dateEntries.map(entry => {
              const hours = calcHours(entry.arrivalTime, entry.departureTime);
              const isActive = !entry.departureTime;
              return (
                <View key={entry.id} style={styles.card}>
                  <View style={[styles.cardAccent, { backgroundColor: entry.companyColor }]} />
                  <View style={styles.cardBody}>
                    <View style={styles.cardTop}>
                      <View style={styles.cardInfo}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={[styles.avatarSmall, { backgroundColor: entry.companyColor + '25' }]}>
                            <Text style={[styles.avatarSmallText, { color: entry.companyColor }]}>
                              {getInitials(entry.workerName)}
                            </Text>
                          </View>
                          <View>
                            <Text style={styles.workerName}>{entry.workerName}</Text>
                            <Text style={styles.companyName}>{entry.companyName}</Text>
                          </View>
                        </View>
                        {entry.taskTitle && (
                          <View style={styles.taskBadge}>
                            <Ionicons name="construct-outline" size={11} color={C.inProgress} />
                            <Text style={styles.taskBadgeText} numberOfLines={1}>{entry.taskTitle}</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.cardActions}>
                        {isActive && canEdit && (
                          <TouchableOpacity
                            style={styles.depBtn}
                            onPress={() => { setDepartureModal(entry); setDepTime('17:00'); }}
                            hitSlop={8}
                          >
                            <Ionicons name="log-out-outline" size={13} color={C.open} />
                            <Text style={styles.depBtnText}>Départ</Text>
                          </TouchableOpacity>
                        )}
                        {canEdit && (
                          <TouchableOpacity onPress={() => openEdit(entry)} hitSlop={8} style={styles.iconBtn}>
                            <Ionicons name="pencil-outline" size={15} color={C.primary} />
                          </TouchableOpacity>
                        )}
                        {permissions.canDelete && (
                          <TouchableOpacity onPress={() => handleDelete(entry)} hitSlop={8} style={[styles.iconBtn, { backgroundColor: C.openBg }]}>
                            <Ionicons name="trash-outline" size={15} color={C.open} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    <View style={styles.timeRow}>
                      <View style={styles.statusDot}>
                        <View style={[styles.statusDotInner, { backgroundColor: isActive ? C.closed : C.textMuted }]} />
                        <Text style={[styles.statusLabel, { color: isActive ? C.closed : C.textMuted }]}>
                          {isActive ? 'Sur site' : 'Parti'}
                        </Text>
                      </View>
                      <View style={styles.timePill}>
                        <Ionicons name="log-in-outline" size={12} color={C.primary} />
                        <Text style={[styles.timeText, { color: C.primary }]}>{entry.arrivalTime}</Text>
                      </View>
                      <Ionicons name="arrow-forward" size={12} color={C.textMuted} />
                      <View style={[styles.timePill, entry.departureTime ? { backgroundColor: C.closedBg } : { backgroundColor: C.surface2 }]}>
                        <Ionicons name="log-out-outline" size={12} color={entry.departureTime ? C.closed : C.textMuted} />
                        <Text style={[styles.timeText, { color: entry.departureTime ? C.closed : C.textMuted }]}>
                          {entry.departureTime ?? 'En cours'}
                        </Text>
                      </View>
                      {hours !== null && (
                        <View style={styles.hoursBadge}>
                          <Text style={styles.hoursText}>{hours}h</Text>
                        </View>
                      )}
                    </View>

                    {entry.notes ? (
                      <Text style={styles.noteText} numberOfLines={1}>{entry.notes}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* GRID VIEW */}
        {viewMode === 'grid' && dateEntries.length > 0 && (
          <View style={styles.grid}>
            {dateEntries.map(entry => {
              const hours = calcHours(entry.arrivalTime, entry.departureTime);
              const isActive = !entry.departureTime;
              return (
                <TouchableOpacity
                  key={entry.id}
                  style={styles.gridCard}
                  onPress={() => canEdit && openEdit(entry)}
                  activeOpacity={0.82}
                >
                  <View style={[styles.gridAvatar, { backgroundColor: entry.companyColor + '20' }]}>
                    <Text style={[styles.gridAvatarText, { color: entry.companyColor }]}>
                      {getInitials(entry.workerName)}
                    </Text>
                    <View style={[
                      styles.gridStatusBadge,
                      { backgroundColor: isActive ? C.closed : C.textMuted },
                    ]} />
                  </View>
                  <Text style={styles.gridName} numberOfLines={1}>{entry.workerName}</Text>
                  <Text style={styles.gridCompany} numberOfLines={1}>{entry.companyName}</Text>
                  <View style={styles.gridTimeRow}>
                    <Text style={[styles.gridTime, { color: C.primary }]}>{entry.arrivalTime}</Text>
                    <Ionicons name="arrow-forward" size={10} color={C.textMuted} />
                    <Text style={[styles.gridTime, { color: isActive ? C.textMuted : C.closed }]}>
                      {entry.departureTime ?? '—'}
                    </Text>
                  </View>
                  {hours !== null && (
                    <View style={styles.gridHoursBadge}>
                      <Text style={styles.gridHoursText}>{hours}h</Text>
                    </View>
                  )}
                  {isActive && canEdit && (
                    <TouchableOpacity
                      style={styles.gridDepBtn}
                      onPress={() => { setDepartureModal(entry); setDepTime('17:00'); }}
                    >
                      <Ionicons name="log-out-outline" size={12} color={C.open} />
                      <Text style={styles.gridDepText}>Départ</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Company summary */}
        {byCompany.length > 1 && allDateEntries.length > 0 && (
          <View style={styles.companySummary}>
            <Text style={styles.companySummaryTitle}>Répartition par entreprise</Text>
            {byCompany.map(co => (
              <View key={co.id} style={styles.companySummaryRow}>
                <View style={[styles.companySummaryDot, { backgroundColor: co.color }]} />
                <Text style={styles.companySummaryName}>{co.name}</Text>
                <Text style={styles.companySummaryCount}>{co.count} pers.</Text>
                {co.hours > 0 && (
                  <Text style={styles.companySummaryHours}>{Math.round(co.hours * 10) / 10}h</Text>
                )}
                <View style={styles.companySummaryBarBg}>
                  <View style={[
                    styles.companySummaryBarFill,
                    { width: `${Math.round((co.count / allDateEntries.length) * 100)}%` as any, backgroundColor: co.color },
                  ]} />
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Entry modal */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={closeModal}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableWithoutFeedback onPress={closeModal}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <ScrollView
            style={styles.modalCard}
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{editTarget ? 'Modifier le pointage' : 'Nouveau pointage'}</Text>
                <Text style={styles.modalDateSub}>
                  {editTarget
                    ? `${formatDate(editTarget.date)} · modif. par ${editTarget.updatedBy ?? editTarget.recordedBy}`
                    : formatDate(selectedDate)}
                </Text>
              </View>
              <TouchableOpacity onPress={closeModal} hitSlop={10} accessibilityLabel="Fermer le modal" accessibilityRole="button">
                <Ionicons name="close" size={22} color={C.textSub} />
              </TouchableOpacity>
            </View>

            {/* Nom de l'ouvrier */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>Nom de l'ouvrier *</Text>
              <Text style={[styles.charCount, { marginTop: 0, marginBottom: 0, color: workerName.length > 70 ? C.open : C.textMuted }]}>
                {workerName.length}/80
              </Text>
            </View>
            <View style={{ position: 'relative', zIndex: 10 }}>
              <TextInput
                ref={workerNameRef}
                style={styles.input}
                placeholder="Prénom Nom"
                placeholderTextColor={C.textMuted}
                value={workerName}
                onChangeText={v => { setWorkerName(v); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                autoCapitalize="words"
                autoFocus
                maxLength={80}
                returnKeyType="next"
                onSubmitEditing={() => arrivalRef.current?.focus()}
                accessibilityLabel="Nom de l'ouvrier"
                accessibilityHint="Saisissez le prénom et le nom de l'ouvrier"
              />
              {showSuggestions && workerSuggestions.length > 0 && (
                <View style={styles.suggestionBox}>
                  {workerSuggestions.map(name => (
                    <TouchableOpacity
                      key={name}
                      style={styles.suggestionItem}
                      onPress={() => { setWorkerName(name); setShowSuggestions(false); }}
                    >
                      <Ionicons name="person-outline" size={13} color={C.textMuted} />
                      <Text style={styles.suggestionText}>{name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Entreprise */}
            <Text style={styles.fieldLabel}>Entreprise *</Text>
            {companies.length === 0 ? (
              <View style={styles.emptyCompany}>
                <Ionicons name="business-outline" size={18} color={C.textMuted} />
                <Text style={styles.emptyCompanyText}>Aucune entreprise configurée dans les paramètres.</Text>
              </View>
            ) : (
              <ScrollView
                ref={companyScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginBottom: 12 }}
              >
                {companies.map(co => (
                  <TouchableOpacity
                    key={co.id}
                    style={[styles.companyPill, selectedCompanyId === co.id && { backgroundColor: co.color, borderColor: co.color }]}
                    onPress={() => setSelectedCompanyId(co.id)}
                    accessibilityLabel={co.shortName || co.name}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selectedCompanyId === co.id }}
                  >
                    <Text style={[styles.companyPillText, selectedCompanyId === co.id && { color: '#fff' }]}>{co.shortName || co.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Heure d'arrivée */}
            <Text style={styles.fieldLabel}>Heure d'arrivée *</Text>
            <View style={styles.presetRow}>
              {ARRIVAL_PRESETS.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.presetChip, arrivalTime === t && styles.presetChipActive]}
                  onPress={() => setArrivalTime(t)}
                  accessibilityLabel={`Arrivée à ${t}`}
                >
                  <Text style={[styles.presetChipText, arrivalTime === t && styles.presetChipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              ref={arrivalRef}
              style={[styles.input, { marginBottom: 4, borderColor: arrivalTime.length >= 4 && !validateTime(arrivalTime) ? C.open : C.border }]}
              placeholder="HH:MM"
              placeholderTextColor={C.textMuted}
              value={arrivalTime}
              onChangeText={v => setArrivalTime(formatTimeInput(v))}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
              returnKeyType={showDeparture ? 'next' : 'done'}
              onSubmitEditing={() => { if (showDeparture) departureRef.current?.focus(); }}
              accessibilityLabel="Heure d'arrivée"
              accessibilityHint="Format HH:MM, par exemple 07:30"
            />
            {arrivalTime.length >= 4 && !validateTime(arrivalTime) && (
              <Text style={styles.fieldError}>Heure invalide — format HH:MM attendu (ex : 07:30)</Text>
            )}

            {/* Heure de départ */}
            {!showDeparture ? (
              <TouchableOpacity
                style={[styles.addDepBtn, { marginTop: arrivalTime.length >= 4 && !validateTime(arrivalTime) ? 8 : 0 }]}
                onPress={() => { setShowDeparture(true); if (!departureTime) setDepartureTime('17:00'); }}
                accessibilityLabel="Définir une heure de départ"
                accessibilityRole="button"
              >
                <Ionicons name="log-out-outline" size={15} color={C.primary} />
                <Text style={styles.addDepBtnText}>Définir une heure de départ (optionnel)</Text>
              </TouchableOpacity>
            ) : (
              <>
                {(() => {
                  const depDiff = validateTime(arrivalTime) && validateTime(departureTime) && timeToMinutes(departureTime) > timeToMinutes(arrivalTime)
                    ? timeToMinutes(departureTime) - timeToMinutes(arrivalTime)
                    : null;
                  const depDuration = depDiff !== null
                    ? depDiff >= 60 ? `${Math.floor(depDiff / 60)}h${depDiff % 60 > 0 ? String(depDiff % 60).padStart(2, '0') : ''}` : `${depDiff}min`
                    : null;
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: arrivalTime.length >= 4 && !validateTime(arrivalTime) ? 8 : 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>Heure de départ</Text>
                        {depDuration && (
                          <View style={styles.hoursBadgeInline}>
                            <Ionicons name="time-outline" size={11} color={C.primary} />
                            <Text style={styles.hoursBadgeInlineText}>{depDuration}</Text>
                          </View>
                        )}
                      </View>
                      <TouchableOpacity
                        onPress={() => { setDepartureTime(''); setShowDeparture(false); }}
                        style={styles.clearDepBtn}
                        accessibilityLabel="Effacer l'heure de départ"
                      >
                        <Ionicons name="close-circle" size={16} color={C.textMuted} />
                        <Text style={styles.clearDepBtnText}>Effacer</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })()}
                <View style={styles.presetRow}>
                  {DEPARTURE_PRESETS.map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[styles.presetChip, departureTime === t && styles.presetChipActive]}
                      onPress={() => setDepartureTime(t)}
                      accessibilityLabel={`Départ à ${t}`}
                    >
                      <Text style={[styles.presetChipText, departureTime === t && styles.presetChipTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  ref={departureRef}
                  style={[styles.input, { marginBottom: 4, borderColor: departureTime.length >= 4 && !validateTime(departureTime) ? C.open : C.border }]}
                  placeholder="HH:MM"
                  placeholderTextColor={C.textMuted}
                  value={departureTime}
                  onChangeText={v => setDepartureTime(formatTimeInput(v))}
                  keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                  returnKeyType="done"
                  accessibilityLabel="Heure de départ"
                  accessibilityHint="Format HH:MM, doit être postérieure à l'heure d'arrivée"
                />
                {departureTime.length >= 4 && !validateTime(departureTime) && (
                  <Text style={styles.fieldError}>Heure invalide — format HH:MM attendu (ex : 17:00)</Text>
                )}
                {validateTime(departureTime) && validateTime(arrivalTime) && timeToMinutes(departureTime) <= timeToMinutes(arrivalTime) && (
                  <Text style={styles.fieldError}>Le départ doit être postérieur à l'arrivée ({arrivalTime})</Text>
                )}
              </>
            )}

            {/* Tâche liée */}
            {(tasks.length > 0 || selectedTaskId) && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 4 }]}>Tâche liée (optionnel)</Text>
                {selectedTaskId && !activeTasks.find(t => t.id === selectedTaskId) && (
                  <View style={styles.linkedTaskBanner}>
                    <Ionicons name="construct-outline" size={13} color={C.inProgress} />
                    <Text style={styles.linkedTaskBannerText} numberOfLines={1} ellipsizeMode="tail">
                      {selectedTaskTitle} (tâche terminée ou archivée)
                    </Text>
                    <TouchableOpacity
                      onPress={() => { setSelectedTaskId(''); setSelectedTaskTitle(''); }}
                      accessibilityLabel="Retirer la tâche liée"
                      accessibilityRole="button"
                    >
                      <Ionicons name="close-circle-outline" size={15} color={C.textMuted} />
                    </TouchableOpacity>
                  </View>
                )}
                {activeTasks.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {activeTasks.map(t => (
                        <TouchableOpacity
                          key={t.id}
                          style={[styles.taskPill, selectedTaskId === t.id && styles.taskPillActive]}
                          onPress={() => selectTask(t.id, t.title)}
                          accessibilityLabel={t.title}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selectedTaskId === t.id }}
                          accessibilityHint={selectedTaskId === t.id ? 'Appuyer pour désélectionner' : 'Appuyer pour sélectionner cette tâche'}
                        >
                          <Text
                            style={[styles.taskPillText, selectedTaskId === t.id && styles.taskPillTextActive]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {t.title}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                )}
                {tasks.filter(t => t.status === 'in_progress' || t.status === 'todo').length > 20 && (
                  <Text style={styles.moreTasksHint}>
                    {tasks.filter(t => t.status === 'in_progress' || t.status === 'todo').length - 20} tâche(s) supplémentaire(s) non affichée(s)
                  </Text>
                )}
              </>
            )}

            {/* Notes */}
            <Text style={[styles.fieldLabel, { marginTop: 4 }]}>Notes</Text>
            <TextInput
              style={[styles.input, { minHeight: 72, maxHeight: 160, textAlignVertical: 'top' }]}
              placeholder="Observations, remarques..."
              placeholderTextColor={C.textMuted}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              maxLength={500}
              accessibilityLabel="Notes"
              accessibilityHint="Observations ou remarques libres, 500 caractères maximum"
            />
            <Text style={[styles.charCount, { color: notes.length >= 450 ? C.open : notes.length >= 400 ? C.medium : C.textMuted }]}>
              {notes.length}/500
            </Text>

            {(() => {
              const saveDisabled = !workerName.trim() || !selectedCompanyId || !validateTime(arrivalTime);
              return (
                <TouchableOpacity
                  style={[styles.saveBtn, saveDisabled && styles.saveBtnDisabled]}
                  onPress={handleSave}
                  disabled={saveDisabled}
                  accessibilityLabel={editTarget ? 'Enregistrer les modifications' : 'Enregistrer le pointage'}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: saveDisabled }}
                >
                  <Text style={styles.saveBtnText}>{editTarget ? 'Enregistrer les modifications' : 'Enregistrer le pointage'}</Text>
                </TouchableOpacity>
              );
            })()}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Quick departure modal */}
      <Modal visible={!!departureModal} transparent animationType="fade" onRequestClose={() => setDepartureModal(null)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableWithoutFeedback onPress={() => setDepartureModal(null)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.modalCard, { maxHeight: 280 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Heure de départ</Text>
              <TouchableOpacity onPress={() => setDepartureModal(null)}>
                <Ionicons name="close" size={22} color={C.textSub} />
              </TouchableOpacity>
            </View>
            {departureModal && (
              <Text style={styles.modalSub}>{departureModal.workerName} — {departureModal.companyName}</Text>
            )}
            <View style={styles.presetRow}>
              {DEPARTURE_PRESETS.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.presetChip, depTime === t && styles.presetChipActive]}
                  onPress={() => setDepTime(t)}
                >
                  <Text style={[styles.presetChipText, depTime === t && styles.presetChipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, { marginBottom: 16 }]}
              placeholder="17:00"
              placeholderTextColor={C.textMuted}
              value={depTime}
              onChangeText={v => setDepTime(formatTimeInput(v))}
              keyboardType="numbers-and-punctuation"
              autoFocus
              accessibilityLabel="Heure de départ"
              accessibilityHint="Format HH:MM, par exemple 17:00"
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleSetDeparture}>
              <Text style={styles.saveBtnText}>Enregistrer le départ</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Bulk departure modal */}
      <Modal visible={bulkDepModal} transparent animationType="fade" onRequestClose={() => setBulkDepModal(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableWithoutFeedback onPress={() => setBulkDepModal(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.modalCard, { maxHeight: 320 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Départ groupé</Text>
              <TouchableOpacity onPress={() => setBulkDepModal(false)}>
                <Ionicons name="close" size={22} color={C.textSub} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              Enregistrer le départ des {actifs} ouvrier{actifs > 1 ? 's' : ''} encore sur site.
            </Text>
            <Text style={styles.fieldLabel}>Heure de départ</Text>
            <View style={styles.presetRow}>
              {DEPARTURE_PRESETS.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.presetChip, depTime === t && styles.presetChipActive]}
                  onPress={() => setDepTime(t)}
                >
                  <Text style={[styles.presetChipText, depTime === t && styles.presetChipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, { marginBottom: 16 }]}
              placeholder="17:00"
              placeholderTextColor={C.textMuted}
              value={depTime}
              onChangeText={v => setDepTime(formatTimeInput(v))}
              keyboardType="numbers-and-punctuation"
              autoFocus
              accessibilityLabel="Heure de départ groupé"
              accessibilityHint="Format HH:MM, par exemple 17:00"
            />
            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: C.open }]} onPress={handleBulkDeparture}>
              <Ionicons name="log-out-outline" size={16} color="#fff" />
              <Text style={styles.saveBtnText}>Pointer {actifs} départ{actifs > 1 ? 's' : ''}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Save confirmation toast */}
      {toastVisible && (
        <View style={[styles.toast, { pointerEvents: 'none' } as any]}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={styles.toastText}>Pointage enregistré</Text>
        </View>
      )}

      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  datePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  dateBtn: { padding: 6 },
  dateLabelWrap: { alignItems: 'center' },
  dateLabel: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  todayTag: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.primary, marginTop: 2 },
  todayJumpBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: C.primaryBg, borderRadius: 8 },
  todayJumpText: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.primary },

  weekChart: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 0,
  },
  weekDay: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  weekDayCount: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: C.textMuted,
    minHeight: 14,
  },
  weekBarBg: {
    width: 24,
    height: 36,
    backgroundColor: C.bg,
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  weekBarFill: {
    width: '100%',
    borderRadius: 4,
    minHeight: 4,
  },
  weekDayLabel: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: C.textSub,
    marginTop: 3,
  },
  weekDayDate: {
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },

  kpiRow: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  kpiCard: { flex: 1, alignItems: 'center', position: 'relative' },
  kpiDot: {
    position: 'absolute',
    top: 0,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.closed,
  },
  kpiDivider: { width: 1, height: 32, backgroundColor: C.border },
  kpiVal: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  kpiLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  kpiExportBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  kpiExportText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.primary },

  scrollContent: { paddingBottom: 100 },

  journalBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.primaryBg,
    marginHorizontal: 12, marginTop: 12,
    borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  journalBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  journalBannerIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  journalBannerTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  journalBannerSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 1 },

  bulkDepBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.openBg,
    marginHorizontal: 12, marginTop: 10,
    borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#FCA5A5',
  },
  bulkDepText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.open },

  filterRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingLeft: 12, paddingTop: 10, paddingBottom: 6,
    gap: 8,
  },
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface,
  },
  companyChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  companyChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  companyChipTextActive: { color: C.primary },
  companyDot: { width: 7, height: 7, borderRadius: 4 },

  viewToggle: {
    flexDirection: 'row', gap: 4,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 8, padding: 3,
    backgroundColor: C.surface,
    marginRight: 12,
  },
  viewBtn: { padding: 5, borderRadius: 6 },
  viewBtnActive: { backgroundColor: C.primaryBg },

  empty: {
    alignItems: 'center', paddingVertical: 60, gap: 12,
  },
  emptyText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: C.textMuted },
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 4, paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: C.primaryBg, borderRadius: 20,
  },
  emptyAddText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },

  list: { paddingHorizontal: 12, paddingTop: 10, gap: 8 },

  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1, borderColor: C.border,
  },
  cardAccent: { width: 4 },
  cardBody: { flex: 1, padding: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardInfo: { flex: 1, gap: 4 },
  cardActions: { flexDirection: 'row', gap: 6, alignItems: 'center' },

  avatarSmall: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarSmallText: { fontSize: 12, fontFamily: 'Inter_700Bold' },

  workerName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  companyName: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },

  taskBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.inProgressBg,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, alignSelf: 'flex-start',
  },
  taskBadgeText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.inProgress, maxWidth: 180 },

  depBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.openBg, paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: 8,
  },
  depBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.open },

  iconBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },

  timeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10,
  },
  statusDot: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDotInner: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: 10, fontFamily: 'Inter_500Medium' },

  timePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primaryBg, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8,
  },
  timeText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  hoursBadge: {
    backgroundColor: C.mediumBg, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, marginLeft: 'auto' as any,
  },
  hoursText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.medium },

  noteText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 6 },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 12, paddingTop: 10, gap: 10,
  },
  gridCard: {
    width: '47%',
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1, borderColor: C.border,
    gap: 4,
  },
  gridAvatar: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
    position: 'relative',
  },
  gridAvatarText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  gridStatusBadge: {
    position: 'absolute', bottom: 2, right: 2,
    width: 12, height: 12, borderRadius: 6,
    borderWidth: 2, borderColor: C.surface,
  },
  gridName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, textAlign: 'center' },
  gridCompany: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  gridTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  gridTime: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  gridHoursBadge: {
    backgroundColor: C.mediumBg, paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 20, marginTop: 2,
  },
  gridHoursText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.medium },
  gridDepBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.openBg,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, marginTop: 6,
  },
  gridDepText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.open },

  companySummary: {
    marginHorizontal: 12, marginTop: 16,
    backgroundColor: C.surface, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: C.border,
    gap: 10,
  },
  companySummaryTitle: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 2,
  },
  companySummaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  companySummaryDot: { width: 8, height: 8, borderRadius: 4 },
  companySummaryName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text, flex: 1 },
  companySummaryCount: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  companySummaryHours: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, minWidth: 30, textAlign: 'right' },
  companySummaryBarBg: {
    width: 70, height: 6, backgroundColor: C.bg, borderRadius: 3, overflow: 'hidden',
  },
  companySummaryBarFill: { height: '100%', borderRadius: 3 },

  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  modalSub: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub,
    marginBottom: 14,
  },

  fieldLabel: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold',
    color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4,
    marginBottom: 8,
  },
  input: {
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    marginBottom: 12,
  },

  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  presetChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface2,
  },
  presetChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  presetChipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  presetChipTextActive: { color: '#fff' },

  taskPill: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface2, maxWidth: 180,
  },
  taskPillActive: { backgroundColor: C.inProgressBg, borderColor: C.inProgress },
  taskPillText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  taskPillTextActive: { color: C.inProgress },

  companyPill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface2, marginRight: 8,
  },
  companyPillText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },

  saveBtn: {
    backgroundColor: C.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  modalDateSub: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2,
  },

  suggestionBox: {
    position: 'absolute', top: '100%', left: 0, right: 0,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 10, zIndex: 100,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  suggestionItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  suggestionText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },

  emptyCompany: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.bg, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  emptyCompanyText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, flex: 1 },

  addDepBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primaryBg, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  addDepBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },

  clearDepBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: C.bg, borderRadius: 8, borderWidth: 1, borderColor: C.border,
  },
  clearDepBtnText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted },

  hoursBadgeInline: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.primaryBg, borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: C.primary + '30',
  },
  hoursBadgeInlineText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },

  linkedTaskBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.inProgressBg, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    marginBottom: 10,
    borderWidth: 1, borderColor: C.inProgress + '40',
  },
  linkedTaskBannerText: {
    flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: C.inProgress,
  },

  moreTasksHint: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted,
    marginBottom: 12, fontStyle: 'italic',
  },

  charCount: {
    fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted,
    textAlign: 'right', marginTop: -8, marginBottom: 12,
  },

  fieldError: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: C.open,
    marginTop: 2, marginBottom: 10,
  },

  toast: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.closed,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 24,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  toastText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
