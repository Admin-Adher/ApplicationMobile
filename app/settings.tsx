import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { C } from '@/constants/colors';
import Header from '@/components/Header';
import { useSettings } from '@/context/SettingsContext';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { AttendanceRecord } from '@/constants/types';

function groupByDate(records: AttendanceRecord[]): Record<string, AttendanceRecord[]> {
  const groups: Record<string, AttendanceRecord[]> = {};
  for (const r of records) {
    if (!groups[r.date]) groups[r.date] = [];
    groups[r.date].push(r);
  }
  return groups;
}

function formatDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return iso;
}

export default function SettingsScreen() {
  const { projectName, projectDescription, setProjectName, setProjectDescription, attendanceHistory, saveAttendanceSnapshot, clearAttendanceHistory } = useSettings();
  const { companies } = useApp();
  const { user } = useAuth();

  const [nameInput, setNameInput] = useState(projectName);
  const [descInput, setDescInput] = useState(projectDescription);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'project' | 'attendance'>('project');

  const grouped = useMemo(() => {
    const g = groupByDate(attendanceHistory);
    return Object.entries(g).sort(([a], [b]) => b.localeCompare(a));
  }, [attendanceHistory]);

  const totalDays = Object.keys(groupByDate(attendanceHistory)).length;

  async function handleSave() {
    if (!nameInput.trim()) {
      Alert.alert('Champ requis', 'Le nom du projet est obligatoire.');
      return;
    }
    setSaving(true);
    await setProjectName(nameInput.trim());
    await setProjectDescription(descInput.trim());
    setSaving(false);
    Alert.alert('Enregistré', 'Les paramètres du projet ont été mis à jour.');
  }

  async function handleSaveAttendance() {
    if (companies.length === 0) {
      Alert.alert('Aucune entreprise', 'Ajoutez d\'abord des entreprises dans l\'onglet Équipes.');
      return;
    }
    Alert.alert(
      'Sauvegarder les présences',
      `Enregistrer les présences du jour (${companies.reduce((a, c) => a + c.actualWorkers, 0)} personnes au total) dans l'historique ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Sauvegarder',
          onPress: async () => {
            await saveAttendanceSnapshot(companies, user?.name ?? 'Système');
            Alert.alert('Présences sauvegardées', 'L\'instantané a été enregistré dans l\'historique.');
          },
        },
      ]
    );
  }

  function handleClearHistory() {
    Alert.alert(
      'Effacer l\'historique',
      `Supprimer définitivement l'historique des présences (${attendanceHistory.length} enregistrements) ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Effacer', style: 'destructive', onPress: () => clearAttendanceHistory() },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Paramètres" subtitle="Projet & historique" showBack />

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'project' && styles.tabBtnActive]}
          onPress={() => setActiveTab('project')}
        >
          <Ionicons name="construct-outline" size={14} color={activeTab === 'project' ? C.primary : C.textMuted} />
          <Text style={[styles.tabText, activeTab === 'project' && styles.tabTextActive]}>Projet</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'attendance' && styles.tabBtnActive]}
          onPress={() => setActiveTab('attendance')}
        >
          <Ionicons name="people-outline" size={14} color={activeTab === 'attendance' ? C.primary : C.textMuted} />
          <Text style={[styles.tabText, activeTab === 'attendance' && styles.tabTextActive]}>
            Présences ({totalDays} jours)
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === 'project' && (
          <View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Informations du projet</Text>

              <Text style={styles.label}>Nom du projet *</Text>
              <TextInput
                style={styles.input}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="Ex : Résidence Les Pins"
                placeholderTextColor={C.textMuted}
                maxLength={60}
              />

              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={descInput}
                onChangeText={setDescInput}
                placeholder="Ex : Chantier de construction — 48 logements"
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={3}
                maxLength={200}
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={styles.saveBtnText}>{saving ? 'Enregistrement...' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Ionicons name="information-circle-outline" size={16} color={C.primary} />
                <Text style={styles.infoText}>
                  Le nom du projet s'affiche dans le tableau de bord, les rapports PDF et l'écran Plus.
                </Text>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'attendance' && (
          <View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Présences aujourd'hui</Text>
              {companies.length === 0 ? (
                <Text style={styles.emptyText}>Aucune entreprise configurée.</Text>
              ) : (
                companies.map(co => (
                  <View key={co.id} style={styles.coRow}>
                    <View style={[styles.coDot, { backgroundColor: co.color }]} />
                    <Text style={styles.coName}>{co.name}</Text>
                    <Text style={[styles.coVal, { color: co.color }]}>{co.actualWorkers} / {co.plannedWorkers}</Text>
                    <Text style={styles.coHours}>{co.hoursWorked}h</Text>
                  </View>
                ))
              )}
              <TouchableOpacity style={styles.snapshotBtn} onPress={handleSaveAttendance}>
                <Ionicons name="save-outline" size={16} color={C.primary} />
                <Text style={styles.snapshotBtnText}>Sauvegarder l'instantané du jour</Text>
              </TouchableOpacity>
            </View>

            {grouped.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Ionicons name="time-outline" size={40} color={C.border} />
                <Text style={styles.emptyTitle}>Aucun historique</Text>
                <Text style={styles.emptyText}>
                  Appuyez sur "Sauvegarder l'instantané du jour" pour commencer à suivre les présences quotidiennes.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyTitle}>Historique ({totalDays} jours)</Text>
                  <TouchableOpacity onPress={handleClearHistory}>
                    <Text style={styles.clearText}>Tout effacer</Text>
                  </TouchableOpacity>
                </View>
                {grouped.map(([date, records]) => {
                  const totalWorkers = records.reduce((a, r) => a + r.workers, 0);
                  const totalHours = records.reduce((a, r) => a + r.hoursWorked, 0);
                  return (
                    <View key={date} style={styles.dayCard}>
                      <View style={styles.dayHeader}>
                        <Text style={styles.dayDate}>{formatDate(date)}</Text>
                        <Text style={styles.dayTotal}>{totalWorkers} pers. · {totalHours}h</Text>
                      </View>
                      {records.map(r => (
                        <View key={r.id} style={styles.recRow}>
                          <View style={[styles.coDot, { backgroundColor: r.companyColor }]} />
                          <Text style={styles.recName}>{r.companyName}</Text>
                          <Text style={[styles.recVal, { color: r.companyColor }]}>{r.workers} pers.</Text>
                          <Text style={styles.recHours}>{r.hoursWorked}h</Text>
                        </View>
                      ))}
                    </View>
                  );
                })}
              </>
            )}
            <View style={{ height: 40 }} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  tabRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, borderRadius: 10, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  tabBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  tabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  tabTextActive: { color: C.primary },

  content: { padding: 16 },

  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 16 },

  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 4,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13, marginTop: 16 },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  infoCard: { backgroundColor: C.primaryBg, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.primary + '30', marginBottom: 14 },
  infoRow: { flexDirection: 'row', gap: 8 },
  infoText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.primary, lineHeight: 18 },

  coRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  coDot: { width: 8, height: 8, borderRadius: 4 },
  coName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  coVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold', minWidth: 60, textAlign: 'right' },
  coHours: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, minWidth: 36, textAlign: 'right' },

  snapshotBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primaryBg, borderRadius: 10, paddingVertical: 12, marginTop: 12,
    borderWidth: 1, borderColor: C.primary + '40',
  },
  snapshotBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },

  emptyHistory: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', maxWidth: 280, lineHeight: 18 },

  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  historyTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },
  clearText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.open },

  dayCard: { backgroundColor: C.surface, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  dayDate: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  dayTotal: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },

  recRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  recName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  recVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  recHours: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, minWidth: 36, textAlign: 'right' },
});
