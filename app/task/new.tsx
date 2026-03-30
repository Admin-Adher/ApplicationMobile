import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import { Task, TaskStatus, ReservePriority } from '@/constants/types';
import { validateDeadline } from '@/lib/reserveUtils';

import { genId } from '@/lib/utils';

const STATUS_OPTS: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'todo', label: 'À faire', color: C.textMuted },
  { value: 'in_progress', label: 'En cours', color: C.inProgress },
  { value: 'done', label: 'Terminé', color: C.closed },
  { value: 'delayed', label: 'En retard', color: C.waiting },
];

const PRIORITY_OPTS: { value: ReservePriority; label: string; color: string }[] = [
  { value: 'low', label: 'Faible', color: C.low },
  { value: 'medium', label: 'Moyen', color: C.medium },
  { value: 'high', label: 'Élevé', color: C.high },
  { value: 'critical', label: 'Critique', color: C.critical },
];

export default function NewTaskScreen() {
  const router = useRouter();
  const { addTask, companies } = useApp();
  const { user, permissions } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<ReservePriority>('medium');
  const [deadline, setDeadline] = useState('');
  const [assignee, setAssignee] = useState(user?.name ?? '');
  const [company, setCompany] = useState(companies[0]?.id ?? '');
  const [progress, setProgress] = useState('0');

  if (!permissions.canCreate) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, textAlign: 'center' }}>
          Accès refusé
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 8, textAlign: 'center' }}>
          Votre rôle ne permet pas de créer des tâches.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function handleSave() {
    if (!title.trim()) {
      Alert.alert('Champ requis', 'Le titre est obligatoire.');
      return;
    }
    const deadlineValue = deadline.trim() || (() => {
      const d = new Date(Date.now() + 7 * 86400000);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    })();
    if (deadline.trim() && !validateDeadline(deadline.trim())) {
      Alert.alert('Date invalide', "Vérifiez que le jour, le mois et l'année sont corrects (ex : 30/04/2026).");
      return;
    }
    const task: Task = {
      id: genId(),
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      deadline: deadlineValue,
      assignee: assignee.trim() || (user?.name ?? 'Équipe'),
      company: company.trim(),
      progress: Math.min(100, Math.max(0, parseInt(progress) || 0)),
    };
    addTask(task);
    Alert.alert('Tâche créée', `"${task.title}" a été ajoutée au planning.`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <View style={styles.container}>
      <Header title="Nouvelle tâche" showBack rightLabel="Enregistrer" onRightPress={handleSave} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informations générales</Text>

          <Text style={styles.label}>Titre *</Text>
          <TextInput
            style={styles.input}
            placeholder="Titre de la tâche"
            placeholderTextColor={C.textMuted}
            value={title}
            onChangeText={setTitle}
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Description détaillée..."
            placeholderTextColor={C.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>Responsable</Text>
          <TextInput
            style={styles.input}
            placeholder="Nom du responsable"
            placeholderTextColor={C.textMuted}
            value={assignee}
            onChangeText={setAssignee}
          />

          <Text style={styles.label}>Entreprise</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {companies.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.chip, company === c.id && { backgroundColor: C.primaryBg, borderColor: C.primary }]}
                  onPress={() => setCompany(c.id)}
                >
                  <Text style={[styles.chipText, company === c.id && { color: C.primary }]}>{c.shortName}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <Text style={styles.label}>Échéance (JJ/MM/AAAA)</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: 30/04/2026"
            placeholderTextColor={C.textMuted}
            value={deadline}
            onChangeText={setDeadline}
            keyboardType="numbers-and-punctuation"
          />

          <Text style={styles.label}>Avancement (%)</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={C.textMuted}
            value={progress}
            onChangeText={setProgress}
            keyboardType="number-pad"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Statut</Text>
          <View style={styles.optionGrid}>
            {STATUS_OPTS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionBtn, status === opt.value && { backgroundColor: opt.color + '20', borderColor: opt.color }]}
                onPress={() => setStatus(opt.value)}
              >
                <View style={[styles.optionDot, { backgroundColor: opt.color }]} />
                <Text style={[styles.optionLabel, status === opt.value && { color: opt.color }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Priorité</Text>
          <View style={styles.optionGrid}>
            {PRIORITY_OPTS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionBtn, priority === opt.value && { backgroundColor: opt.color + '20', borderColor: opt.color }]}
                onPress={() => setPriority(opt.value)}
              >
                <View style={[styles.optionDot, { backgroundColor: opt.color }]} />
                <Text style={[styles.optionLabel, priority === opt.value && { color: opt.color }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
          <Ionicons name="checkmark-circle" size={20} color="#fff" />
          <Text style={styles.saveBtnText}>Créer la tâche</Text>
        </TouchableOpacity>
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
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  optionDot: { width: 8, height: 8, borderRadius: 4 },
  optionLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, marginTop: 4 },
  saveBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
