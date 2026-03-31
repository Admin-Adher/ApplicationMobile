import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform } from 'react-native';
import { useState, useCallback } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import Header from '@/components/Header';
import { MeetingReport } from '@/constants/types';

function genId() { return Math.random().toString(36).slice(2, 10); }

function buildMeetingHTML(report: MeetingReport, projectName: string): string {
  const decisionsHtml = report.decisions.map((d, i) => `<li>${d}</li>`).join('');
  const actionsHtml = report.actions.map(a =>
    `<tr><td>${a.description}</td><td>${a.responsible}</td><td>${a.deadline}</td><td>${a.status === 'done' ? '✅ Fait' : '⏳ En attente'}</td></tr>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 30px; color: #111; }
    h1 { color: #1A6FD8; font-size: 22px; }
    h2 { color: #333; font-size: 16px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 24px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
    th { background: #1A6FD8; color: white; padding: 8px; text-align: left; }
    td { padding: 6px 8px; border-bottom: 1px solid #eee; }
    ul { padding-left: 20px; }
    li { margin-bottom: 6px; font-size: 14px; }
    .participants { background: #f9fafb; border-radius: 8px; padding: 12px; font-size: 13px; }
  </style></head><body>
  <h1>${projectName} — Compte-rendu de réunion</h1>
  <p class="meta">Date : ${report.date} | Lieu : ${report.location} | Rédigé par : ${report.redactedBy}</p>
  <h2>Objet</h2>
  <p>${report.subject}</p>
  <h2>Participants</h2>
  <div class="participants">${report.participants}</div>
  <h2>Ordre du jour</h2>
  <p>${report.agenda}</p>
  <h2>Points discutés</h2>
  <p>${report.notes}</p>
  <h2>Décisions prises</h2>
  <ul>${decisionsHtml || '<li>Aucune décision formalisée</li>'}</ul>
  <h2>Actions et responsabilités</h2>
  <table><thead><tr><th>Action</th><th>Responsable</th><th>Échéance</th><th>Statut</th></tr></thead>
  <tbody>${actionsHtml || '<tr><td colspan="4">Aucune action définie</td></tr>'}</tbody></table>
  <h2>Prochaine réunion</h2>
  <p>${report.nextMeeting || 'À définir'}</p>
  </body></html>`;
}

export default function MeetingReportScreen() {
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();
  const [reports, setReports] = useState<MeetingReport[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState(new Date().toLocaleDateString('fr-FR'));
  const [location, setLocation] = useState('');
  const [participants, setParticipants] = useState('');
  const [agenda, setAgenda] = useState('');
  const [notes, setNotes] = useState('');
  const [decisions, setDecisions] = useState('');
  const [nextMeeting, setNextMeeting] = useState('');

  const resetForm = () => {
    setSubject(''); setDate(new Date().toLocaleDateString('fr-FR')); setLocation('');
    setParticipants(''); setAgenda(''); setNotes(''); setDecisions(''); setNextMeeting('');
  };

  const handleCreate = useCallback(() => {
    if (!subject.trim()) {
      Alert.alert('Champ requis', "L'objet de la réunion est obligatoire.");
      return;
    }
    const report: MeetingReport = {
      id: genId(),
      subject: subject.trim(),
      date,
      location: location.trim() || 'Non précisé',
      participants: participants.trim() || 'Non précisé',
      agenda: agenda.trim(),
      notes: notes.trim(),
      decisions: decisions.split('\n').map(s => s.trim()).filter(Boolean),
      actions: [],
      nextMeeting: nextMeeting.trim(),
      redactedBy: user?.name ?? 'Équipe',
      createdAt: new Date().toLocaleDateString('fr-FR'),
    };
    setReports(prev => [report, ...prev]);
    resetForm();
    setShowNew(false);
  }, [subject, date, location, participants, agenda, notes, decisions, nextMeeting, user]);

  async function handleExportPDF(report: MeetingReport) {
    if (!permissions.canExport) {
      Alert.alert('Accès refusé', "Votre rôle ne permet pas d'exporter.");
      return;
    }
    const html = buildMeetingHTML(report, projectName);
    if (Platform.OS === 'web') {
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
      return;
    }
    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Partager le CR' });
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible de générer le PDF');
    }
  }

  return (
    <View style={styles.container}>
      <Header
        title="CR de réunion"
        subtitle="Comptes-rendus chantier"
        showBack
        rightLabel={permissions.canCreate ? (showNew ? 'Annuler' : 'Nouveau') : undefined}
        onRightPress={permissions.canCreate ? () => setShowNew(s => !s) : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {showNew && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Nouveau compte-rendu</Text>
            <Text style={styles.label}>Objet *</Text>
            <TextInput style={styles.input} placeholder="Ex: Réunion de chantier hebdomadaire" placeholderTextColor={C.textMuted} value={subject} onChangeText={setSubject} />
            <Text style={styles.label}>Date</Text>
            <TextInput style={styles.input} placeholder="JJ/MM/AAAA" placeholderTextColor={C.textMuted} value={date} onChangeText={setDate} />
            <Text style={styles.label}>Lieu</Text>
            <TextInput style={styles.input} placeholder="Ex: Salle de réunion, Bâtiment A" placeholderTextColor={C.textMuted} value={location} onChangeText={setLocation} />
            <Text style={styles.label}>Participants</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Noms et entreprises des participants..." placeholderTextColor={C.textMuted} value={participants} onChangeText={setParticipants} multiline numberOfLines={3} />
            <Text style={styles.label}>Ordre du jour</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Points à traiter..." placeholderTextColor={C.textMuted} value={agenda} onChangeText={setAgenda} multiline numberOfLines={3} />
            <Text style={styles.label}>Notes / Points discutés</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Résumé des échanges, problèmes soulevés..." placeholderTextColor={C.textMuted} value={notes} onChangeText={setNotes} multiline numberOfLines={4} />
            <Text style={styles.label}>Décisions prises (une par ligne)</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Décision 1&#10;Décision 2..." placeholderTextColor={C.textMuted} value={decisions} onChangeText={setDecisions} multiline numberOfLines={3} />
            <Text style={styles.label}>Prochaine réunion</Text>
            <TextInput style={styles.input} placeholder="Ex: Lundi 06/04/2026 à 9h" placeholderTextColor={C.textMuted} value={nextMeeting} onChangeText={setNextMeeting} />
            <TouchableOpacity style={styles.createBtn} onPress={handleCreate}>
              <Ionicons name="document-text" size={18} color="#fff" />
              <Text style={styles.createBtnText}>Créer le compte-rendu</Text>
            </TouchableOpacity>
          </View>
        )}

        {reports.length === 0 && !showNew && (
          <View style={styles.emptyBox}>
            <Ionicons name="document-text-outline" size={52} color={C.border} />
            <Text style={styles.emptyTitle}>Aucun compte-rendu</Text>
            <Text style={styles.emptyText}>Créez votre premier compte-rendu de réunion chantier.</Text>
            {permissions.canCreate && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowNew(true)}>
                <Ionicons name="add-circle" size={18} color={C.primary} />
                <Text style={styles.emptyBtnText}>Nouveau CR</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {reports.map(report => (
          <View key={report.id} style={styles.card}>
            <View style={styles.reportHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle}>{report.subject}</Text>
                <Text style={styles.reportMeta}>{report.date} — {report.location}</Text>
                <Text style={styles.reportMeta}>Rédigé par {report.redactedBy}</Text>
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
                <Text style={styles.decisionsTitle}>Décisions ({report.decisions.length})</Text>
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
          </View>
        ))}
      </ScrollView>
    </View>
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
});
