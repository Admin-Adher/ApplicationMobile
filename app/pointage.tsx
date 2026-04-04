import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, Platform, Alert, TouchableWithoutFeedback,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useState, useMemo } from 'react';
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
  const [arrivalTime, setArrivalTime] = useState(defaultArrivalTime);
  const [departureTime, setDepartureTime] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedTaskTitle, setSelectedTaskTitle] = useState('');

  const [depTime, setDepTime] = useState('17:00');
  const [filterCompany, setFilterCompany] = useState('');

  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);

  const weekChartData = useMemo(() => {
    return weekDates.map(date => {
      const dayEntries = entries.filter(e => e.date === date);
      const actifs = dayEntries.filter(e => !e.departureTime).length;
      const partis = dayEntries.filter(e => !!e.departureTime).length;
      return { date, total: dayEntries.length, actifs, partis };
    });
  }, [entries, weekDates]);

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
    tasks.filter(t => t.status === 'in_progress' || t.status === 'todo').slice(0, 10),
    [tasks]
  );

  function openAdd() {
    setEditTarget(null);
    setWorkerName('');
    setSelectedCompanyId(companies[0]?.id ?? '');
    setArrivalTime(defaultArrivalTime);
    setDepartureTime('');
    setNotes('');
    setSelectedTaskId('');
    setSelectedTaskTitle('');
    setModalVisible(true);
  }

  function openEdit(entry: TimeEntry) {
    setEditTarget(entry);
    setWorkerName(entry.workerName);
    setSelectedCompanyId(entry.companyId);
    setArrivalTime(entry.arrivalTime);
    setDepartureTime(entry.departureTime ?? '');
    setNotes(entry.notes ?? '');
    setSelectedTaskId(entry.taskId ?? '');
    setSelectedTaskTitle(entry.taskTitle ?? '');
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditTarget(null);
  }

  function validateTime(t: string): boolean {
    return /^\d{2}:\d{2}$/.test(t);
  }

  async function handleSave() {
    if (!workerName.trim()) {
      Alert.alert('Champ requis', "Le nom de l'ouvrier est obligatoire.");
      return;
    }
    if (!selectedCompanyId) {
      Alert.alert('Champ requis', 'Veuillez sélectionner une entreprise.');
      return;
    }
    if (!validateTime(arrivalTime)) {
      Alert.alert('Format invalide', "L'heure d'arrivée doit être au format HH:MM (ex: 07:30).");
      return;
    }
    if (departureTime && !validateTime(departureTime)) {
      Alert.alert('Format invalide', "L'heure de départ doit être au format HH:MM (ex: 17:00).");
      return;
    }

    const company = companies.find(c => c.id === selectedCompanyId);
    if (!company) return;

    const base = {
      workerName: workerName.trim(),
      companyId: company.id,
      companyName: company.name,
      companyColor: company.color,
      arrivalTime,
      departureTime: departureTime.trim() || undefined,
      notes: notes.trim() || undefined,
      taskId: selectedTaskId || undefined,
      taskTitle: selectedTaskTitle || undefined,
    };

    if (editTarget) {
      await updateEntry(editTarget.id, base);
    } else {
      await addEntry({
        ...base,
        date: selectedDate,
        recordedBy: user?.name ?? 'Système',
      });
    }
    closeModal();
  }

  async function handleSetDeparture() {
    if (!departureModal) return;
    if (!validateTime(depTime)) {
      Alert.alert('Format invalide', "L'heure de départ doit être au format HH:MM (ex: 17:00).");
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
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editTarget ? 'Modifier le pointage' : 'Nouveau pointage'}</Text>
              <TouchableOpacity onPress={closeModal}>
                <Ionicons name="close" size={22} color={C.textSub} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Nom de l'ouvrier *</Text>
            <TextInput
              style={styles.input}
              placeholder="Prénom Nom"
              placeholderTextColor={C.textMuted}
              value={workerName}
              onChangeText={setWorkerName}
              autoFocus
            />

            <Text style={styles.fieldLabel}>Entreprise *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {companies.map(co => (
                <TouchableOpacity
                  key={co.id}
                  style={[styles.companyPill, selectedCompanyId === co.id && { backgroundColor: co.color, borderColor: co.color }]}
                  onPress={() => setSelectedCompanyId(co.id)}
                >
                  <Text style={[styles.companyPillText, selectedCompanyId === co.id && { color: '#fff' }]}>{co.shortName}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.fieldLabel}>Heure d'arrivée *</Text>
            <View style={styles.presetRow}>
              {ARRIVAL_PRESETS.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.presetChip, arrivalTime === t && styles.presetChipActive]}
                  onPress={() => setArrivalTime(t)}
                >
                  <Text style={[styles.presetChipText, arrivalTime === t && styles.presetChipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, { marginBottom: 12 }]}
              placeholder="HH:MM"
              placeholderTextColor={C.textMuted}
              value={arrivalTime}
              onChangeText={setArrivalTime}
              keyboardType="numbers-and-punctuation"
            />

            <Text style={styles.fieldLabel}>Heure de départ</Text>
            <View style={styles.presetRow}>
              {DEPARTURE_PRESETS.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.presetChip, departureTime === t && styles.presetChipActive]}
                  onPress={() => setDepartureTime(t)}
                >
                  <Text style={[styles.presetChipText, departureTime === t && styles.presetChipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, { marginBottom: 12 }]}
              placeholder="HH:MM (optionnel)"
              placeholderTextColor={C.textMuted}
              value={departureTime}
              onChangeText={setDepartureTime}
              keyboardType="numbers-and-punctuation"
            />

            {activeTasks.length > 0 && (
              <>
                <Text style={styles.fieldLabel}>Tâche liée (optionnel)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {activeTasks.map(t => (
                      <TouchableOpacity
                        key={t.id}
                        style={[
                          styles.taskPill,
                          selectedTaskId === t.id && styles.taskPillActive,
                        ]}
                        onPress={() => selectTask(t.id, t.title)}
                      >
                        <Text
                          style={[styles.taskPillText, selectedTaskId === t.id && styles.taskPillTextActive]}
                          numberOfLines={1}
                        >
                          {t.title}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}

            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              style={[styles.input, { minHeight: 56 }]}
              placeholder="Observations, remarques..."
              placeholderTextColor={C.textMuted}
              value={notes}
              onChangeText={setNotes}
              multiline
            />

            <TouchableOpacity
              style={[styles.saveBtn, (!workerName.trim() || !selectedCompanyId) && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!workerName.trim() || !selectedCompanyId}
            >
              <Text style={styles.saveBtnText}>{editTarget ? 'Enregistrer les modifications' : 'Enregistrer le pointage'}</Text>
            </TouchableOpacity>
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
              onChangeText={setDepTime}
              keyboardType="numbers-and-punctuation"
              autoFocus
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
              onChangeText={setDepTime}
              keyboardType="numbers-and-punctuation"
              autoFocus
            />
            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: C.open }]} onPress={handleBulkDeparture}>
              <Ionicons name="log-out-outline" size={16} color="#fff" />
              <Text style={styles.saveBtnText}>Pointer {actifs} départ{actifs > 1 ? 's' : ''}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
});
