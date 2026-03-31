import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useApp } from '@/context/AppContext';
import Header from '@/components/Header';
import { JournalEntry } from '@/constants/types';
import BottomNavBar from '@/components/BottomNavBar';

const JOURNAL_KEY = 'buildtrack_journal_v1';
function genId() { return Math.random().toString(36).slice(2, 10); }

const WEATHER_OPTIONS = ['☀️ Ensoleillé', '⛅ Nuageux', '🌧️ Pluie', '🌩️ Orage', '❄️ Neige', '💨 Vent fort'];

function buildJournalHTML(entries: JournalEntry[], projectName: string): string {
  const rows = entries.map(e => `
    <tr>
      <td><strong>${e.date}</strong></td>
      <td>${e.weather}</td>
      <td>${e.workerCount} pers.</td>
      <td>${e.workDone}</td>
      <td>${e.incidents || '—'}</td>
      <td>${e.author}</td>
    </tr>
  `).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 30px; color: #111; }
    h1 { color: #1A6FD8; font-size: 22px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
    th { background: #1A6FD8; color: white; padding: 8px; text-align: left; }
    td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  </style></head><body>
  <h1>${projectName} — Journal de chantier officiel</h1>
  <p class="meta">Exporté le ${new Date().toLocaleDateString('fr-FR')} — ${entries.length} entrées</p>
  <table><thead><tr><th>Date</th><th>Météo</th><th>Effectif</th><th>Travaux réalisés</th><th>Incidents</th><th>Rédacteur</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6">Aucune entrée</td></tr>'}</tbody></table>
  </body></html>`;
}

export default function JournalScreen() {
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();
  const { companies } = useApp();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(JOURNAL_KEY).then(raw => {
      if (raw) { try { setEntries(JSON.parse(raw)); } catch {} }
    });
  }, []);
  const [date, setDate] = useState(new Date().toLocaleDateString('fr-FR'));
  const [weather, setWeather] = useState('☀️ Ensoleillé');
  const [workerCount, setWorkerCount] = useState('');
  const [workDone, setWorkDone] = useState('');
  const [materials, setMaterials] = useState('');
  const [incidents, setIncidents] = useState('');
  const [observations, setObservations] = useState('');
  const [visiteur, setVisiteur] = useState('');

  const resetForm = () => {
    setDate(new Date().toLocaleDateString('fr-FR')); setWeather('☀️ Ensoleillé');
    setWorkerCount(''); setWorkDone(''); setMaterials(''); setIncidents(''); setObservations(''); setVisiteur('');
  };

  const handleCreate = useCallback(() => {
    if (!workDone.trim()) {
      Alert.alert('Champ requis', 'Veuillez décrire les travaux réalisés.');
      return;
    }
    const entry: JournalEntry = {
      id: genId(),
      date,
      weather,
      workerCount: parseInt(workerCount) || 0,
      workDone: workDone.trim(),
      materials: materials.trim(),
      incidents: incidents.trim(),
      observations: observations.trim(),
      visitors: visiteur.trim(),
      author: user?.name ?? 'Équipe',
      createdAt: new Date().toISOString(),
    };
    setEntries(prev => {
      const updated = [entry, ...prev];
      AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    resetForm();
    setShowNew(false);
  }, [date, weather, workerCount, workDone, materials, incidents, observations, visiteur, user]);

  async function handleExportPDF() {
    if (!permissions.canExport) {
      Alert.alert('Accès refusé', "Votre rôle ne permet pas d'exporter.");
      return;
    }
    const html = buildJournalHTML(entries, projectName);
    if (Platform.OS === 'web') {
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
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

  return (
    <View style={styles.container}>
      <Header
        title="Journal de chantier"
        subtitle={`${entries.length} entrées — ${projectName}`}
        showBack
        rightLabel={permissions.canCreate ? (showNew ? 'Annuler' : 'Ajouter') : undefined}
        onRightPress={permissions.canCreate ? () => setShowNew(s => !s) : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

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
              <Text style={styles.statVal}>{entries.filter(e => e.incidents).length}</Text>
              <Text style={[styles.statVal, { color: C.open }]}>{entries.filter(e => e.incidents).length}</Text>
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
            <Text style={styles.label}>Date</Text>
            <TextInput style={styles.input} placeholder="JJ/MM/AAAA" placeholderTextColor={C.textMuted} value={date} onChangeText={setDate} />
            <Text style={styles.label}>Météo</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {WEATHER_OPTIONS.map(w => (
                  <TouchableOpacity
                    key={w}
                    style={[styles.chip, weather === w && styles.chipSelected]}
                    onPress={() => setWeather(w)}
                  >
                    <Text style={[styles.chipText, weather === w && styles.chipTextSelected]}>{w}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <Text style={styles.label}>Effectif sur site</Text>
            <TextInput style={styles.input} placeholder="Nombre de personnes" placeholderTextColor={C.textMuted} value={workerCount} onChangeText={setWorkerCount} keyboardType="numeric" />
            <Text style={styles.label}>Travaux réalisés *</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Description détaillée des travaux effectués aujourd'hui..." placeholderTextColor={C.textMuted} value={workDone} onChangeText={setWorkDone} multiline numberOfLines={4} />
            <Text style={styles.label}>Matériaux / Livraisons</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Livraisons reçues, matériaux consommés..." placeholderTextColor={C.textMuted} value={materials} onChangeText={setMaterials} multiline numberOfLines={2} />
            <Text style={styles.label}>Incidents / Problèmes</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Signalement d'incidents ou difficultés rencontrées..." placeholderTextColor={C.textMuted} value={incidents} onChangeText={setIncidents} multiline numberOfLines={2} />
            <Text style={styles.label}>Visiteurs</Text>
            <TextInput style={styles.input} placeholder="Ex: MOA, Bureau de contrôle, Architecte..." placeholderTextColor={C.textMuted} value={visiteur} onChangeText={setVisiteur} />
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
              <View style={styles.entryWorkers}>
                <Ionicons name="people" size={14} color={C.textSub} />
                <Text style={styles.entryWorkersText}>{entry.workerCount} pers.</Text>
              </View>
              <Text style={styles.entryAuthor}>{entry.author}</Text>
            </View>
            <Text style={styles.entryWork}>{entry.workDone}</Text>
            {entry.incidents ? (
              <View style={styles.incidentBanner}>
                <Ionicons name="warning" size={14} color={C.waiting} />
                <Text style={styles.incidentBannerText}>{entry.incidents}</Text>
              </View>
            ) : null}
            {entry.visitors ? (
              <Text style={styles.entryVisitor}>Visiteurs : {entry.visitors}</Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14, alignItems: 'center' },
  statCard: { flex: 1, backgroundColor: C.surface, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  statVal: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.primary },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 10, backgroundColor: C.primaryBg, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40' },
  exportBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  chipSelected: { backgroundColor: C.primaryBg, borderColor: C.primary },
  chipText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  chipTextSelected: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
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
  entryWorkers: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  entryWorkersText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  entryAuthor: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginLeft: 'auto' },
  entryWork: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20 },
  incidentBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: C.waiting + '15', borderRadius: 8, padding: 8, marginTop: 8, borderLeftWidth: 3, borderLeftColor: C.waiting },
  incidentBannerText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  entryVisitor: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 6, fontStyle: 'italic' },
});
