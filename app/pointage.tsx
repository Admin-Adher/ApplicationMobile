import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, Platform, Alert, TouchableWithoutFeedback,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useState, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { usePointage } from '@/context/PointageContext';
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

export default function PointageScreen() {
  const { companies } = useApp();
  const { user, permissions } = useAuth();
  const { entries, addEntry, updateEntry, deleteEntry } = usePointage();

  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<TimeEntry | null>(null);
  const [departureModal, setDepartureModal] = useState<TimeEntry | null>(null);

  const [workerName, setWorkerName] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [arrivalTime, setArrivalTime] = useState('07:30');
  const [departureTime, setDepartureTime] = useState('');
  const [notes, setNotes] = useState('');
  const [depTime, setDepTime] = useState('17:00');

  const [filterCompany, setFilterCompany] = useState('');

  const dateEntries = useMemo(() =>
    entries
      .filter(e => e.date === selectedDate)
      .filter(e => !filterCompany || e.companyId === filterCompany)
      .sort((a, b) => timeToMinutes(a.arrivalTime) - timeToMinutes(b.arrivalTime)),
    [entries, selectedDate, filterCompany]
  );

  const totalWorkers = dateEntries.length;
  const departed = dateEntries.filter(e => e.departureTime).length;
  const totalHours = dateEntries.reduce((acc, e) => {
    const h = calcHours(e.arrivalTime, e.departureTime);
    return acc + (h ?? 0);
  }, 0);

  const byCompany = useMemo(() => {
    const map: Record<string, { name: string; color: string; count: number; hours: number }> = {};
    dateEntries.forEach(e => {
      if (!map[e.companyId]) map[e.companyId] = { name: e.companyName, color: e.companyColor, count: 0, hours: 0 };
      map[e.companyId].count++;
      const h = calcHours(e.arrivalTime, e.departureTime);
      if (h) map[e.companyId].hours += h;
    });
    return Object.values(map);
  }, [dateEntries]);

  function openAdd() {
    setEditTarget(null);
    setWorkerName('');
    setSelectedCompanyId(companies[0]?.id ?? '');
    setArrivalTime('07:30');
    setDepartureTime('');
    setNotes('');
    setModalVisible(true);
  }

  function openEdit(entry: TimeEntry) {
    setEditTarget(entry);
    setWorkerName(entry.workerName);
    setSelectedCompanyId(entry.companyId);
    setArrivalTime(entry.arrivalTime);
    setDepartureTime(entry.departureTime ?? '');
    setNotes(entry.notes ?? '');
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
      Alert.alert('Champ requis', 'Le nom de l\'ouvrier est obligatoire.');
      return;
    }
    if (!selectedCompanyId) {
      Alert.alert('Champ requis', 'Veuillez sélectionner une entreprise.');
      return;
    }
    if (!validateTime(arrivalTime)) {
      Alert.alert('Format invalide', 'L\'heure d\'arrivée doit être au format HH:MM (ex: 07:30).');
      return;
    }
    if (departureTime && !validateTime(departureTime)) {
      Alert.alert('Format invalide', 'L\'heure de départ doit être au format HH:MM (ex: 17:00).');
      return;
    }

    const company = companies.find(c => c.id === selectedCompanyId);
    if (!company) return;

    if (editTarget) {
      await updateEntry(editTarget.id, {
        workerName: workerName.trim(),
        companyId: company.id,
        companyName: company.name,
        companyColor: company.color,
        arrivalTime,
        departureTime: departureTime.trim() || undefined,
        notes: notes.trim() || undefined,
      });
    } else {
      await addEntry({
        date: selectedDate,
        workerName: workerName.trim(),
        companyId: company.id,
        companyName: company.name,
        companyColor: company.color,
        arrivalTime,
        departureTime: departureTime.trim() || undefined,
        notes: notes.trim() || undefined,
        recordedBy: user?.name ?? 'Système',
      });
    }
    closeModal();
  }

  async function handleSetDeparture() {
    if (!departureModal) return;
    if (!validateTime(depTime)) {
      Alert.alert('Format invalide', 'L\'heure de départ doit être au format HH:MM (ex: 17:00).');
      return;
    }
    await updateEntry(departureModal.id, { departureTime: depTime });
    setDepartureModal(null);
  }

  function handleDelete(entry: TimeEntry) {
    Alert.alert('Supprimer', `Supprimer le pointage de "${entry.workerName}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteEntry(entry.id) },
    ]);
  }

  function changeDate(offset: number) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + offset);
    setSelectedDate(d.toISOString().slice(0, 10));
  }

  const canEdit = permissions.canUpdateAttendance || permissions.canCreate;

  return (
    <View style={styles.container}>
      <Header
        title="Pointage horaire"
        subtitle="Heures d'arrivée et de départ"
        showBack
        rightIcon={canEdit ? 'add-outline' : undefined}
        onRightPress={canEdit ? openAdd : undefined}
      />

      <View style={styles.datePicker}>
        <TouchableOpacity onPress={() => changeDate(-1)} style={styles.dateBtn}>
          <Ionicons name="chevron-back" size={20} color={C.primary} />
        </TouchableOpacity>
        <View style={styles.dateLabelWrap}>
          <Text style={styles.dateLabel}>{formatDate(selectedDate)}</Text>
          {selectedDate === todayISO() && <Text style={styles.todayTag}>Aujourd'hui</Text>}
        </View>
        <TouchableOpacity onPress={() => changeDate(1)} style={styles.dateBtn} disabled={selectedDate >= todayISO()}>
          <Ionicons name="chevron-forward" size={20} color={selectedDate >= todayISO() ? C.textMuted : C.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiVal, { color: C.primary }]}>{totalWorkers}</Text>
          <Text style={styles.kpiLabel}>Présents</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiVal, { color: C.closed }]}>{departed}</Text>
          <Text style={styles.kpiLabel}>Partis</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiVal, { color: C.medium }]}>{totalHours > 0 ? `${Math.round(totalHours * 10) / 10}h` : '—'}</Text>
          <Text style={styles.kpiLabel}>Total heures</Text>
        </View>
      </View>

      {byCompany.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.companyScroll} contentContainerStyle={styles.companyScrollContent}>
          <TouchableOpacity
            style={[styles.companyChip, !filterCompany && styles.companyChipActive]}
            onPress={() => setFilterCompany('')}
          >
            <Text style={[styles.companyChipText, !filterCompany && styles.companyChipTextActive]}>Tous</Text>
          </TouchableOpacity>
          {byCompany.map(co => (
            <TouchableOpacity
              key={co.name}
              style={[styles.companyChip, filterCompany === companies.find(c => c.name === co.name)?.id && styles.companyChipActive, { borderColor: co.color }]}
              onPress={() => {
                const id = companies.find(c => c.name === co.name)?.id ?? '';
                setFilterCompany(prev => prev === id ? '' : id);
              }}
            >
              <View style={[styles.companyDot, { backgroundColor: co.color }]} />
              <Text style={[styles.companyChipText]}>{co.name} ({co.count})</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {dateEntries.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={48} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucun pointage pour cette journée</Text>
            {canEdit && <Text style={styles.emptyHint}>Appuyez sur + pour ajouter une arrivée</Text>}
          </View>
        ) : (
          dateEntries.map(entry => {
            const hours = calcHours(entry.arrivalTime, entry.departureTime);
            return (
              <View key={entry.id} style={styles.card}>
                <View style={[styles.cardAccent, { backgroundColor: entry.companyColor }]} />
                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.workerName}>{entry.workerName}</Text>
                      <Text style={styles.companyName}>{entry.companyName}</Text>
                    </View>
                    <View style={styles.cardActions}>
                      {!entry.departureTime && canEdit && (
                        <TouchableOpacity
                          style={styles.depBtn}
                          onPress={() => { setDepartureModal(entry); setDepTime('17:00'); }}
                          hitSlop={8}
                        >
                          <Ionicons name="log-out-outline" size={14} color={C.closed} />
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
                    <View style={styles.timePill}>
                      <Ionicons name="log-in-outline" size={13} color={C.primary} />
                      <Text style={[styles.timeText, { color: C.primary }]}>{entry.arrivalTime}</Text>
                    </View>
                    <Ionicons name="arrow-forward" size={13} color={C.textMuted} />
                    <View style={[styles.timePill, entry.departureTime ? { backgroundColor: C.closedBg } : { backgroundColor: C.surface2 }]}>
                      <Ionicons name="log-out-outline" size={13} color={entry.departureTime ? C.closed : C.textMuted} />
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
                    <Text style={styles.noteText} numberOfLines={2}>{entry.notes}</Text>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={closeModal}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableWithoutFeedback onPress={closeModal}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={styles.modalCard}>
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

            <View style={styles.timeRow2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Heure d'arrivée *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="07:30"
                  placeholderTextColor={C.textMuted}
                  value={arrivalTime}
                  onChangeText={setArrivalTime}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Heure de départ</Text>
                <TextInput
                  style={styles.input}
                  placeholder="17:00 (optionnel)"
                  placeholderTextColor={C.textMuted}
                  value={departureTime}
                  onChangeText={setDepartureTime}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              style={[styles.input, { minHeight: 60 }]}
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
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!departureModal} transparent animationType="fade" onRequestClose={() => setDepartureModal(null)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableWithoutFeedback onPress={() => setDepartureModal(null)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.modalCard, { maxHeight: 260 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Heure de départ</Text>
              <TouchableOpacity onPress={() => setDepartureModal(null)}>
                <Ionicons name="close" size={22} color={C.textSub} />
              </TouchableOpacity>
            </View>
            {departureModal && (
              <Text style={styles.modalSub}>{departureModal.workerName} — {departureModal.companyName}</Text>
            )}
            <Text style={styles.fieldLabel}>Heure de départ *</Text>
            <TextInput
              style={styles.input}
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

  kpiRow: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 12,
  },
  kpiCard: { flex: 1, alignItems: 'center' },
  kpiVal: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  kpiLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },

  companyScroll: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, maxHeight: 52 },
  companyScrollContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  companyChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  companyChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  companyChipTextActive: { color: C.primary },
  companyDot: { width: 8, height: 8, borderRadius: 4 },

  list: { padding: 16, paddingBottom: 40 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },
  emptyHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },

  card: {
    flexDirection: 'row', backgroundColor: C.surface, borderRadius: 12,
    marginBottom: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  cardAccent: { width: 4 },
  cardBody: { flex: 1, padding: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  workerName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  companyName: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 1 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  depBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    backgroundColor: C.closedBg, borderWidth: 1, borderColor: C.closed + '50',
  },
  depBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.closed },
  iconBtn: {
    padding: 6, borderRadius: 8, backgroundColor: C.primaryBg,
    borderWidth: 1, borderColor: C.primary + '30',
  },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    backgroundColor: C.primaryBg,
  },
  timeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  hoursBadge: {
    marginLeft: 'auto' as any,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8,
    backgroundColor: C.accentBg,
  },
  hoursText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.medium },
  noteText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 6, fontStyle: 'italic' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 32, maxHeight: '90%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  modalSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 12 },

  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 11, fontSize: 14, fontFamily: 'Inter_400Regular',
    color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 14,
  },
  timeRow2: { flexDirection: 'row' },

  companyPill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: C.border, marginRight: 8, backgroundColor: C.surface2,
  },
  companyPillText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub },

  saveBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  saveBtnDisabled: { backgroundColor: C.textMuted },
  saveBtnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
