import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Visite, VisiteStatus } from '@/constants/types';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { genId, formatDateFR } from '@/lib/utils';
import { RESERVE_BUILDINGS, RESERVE_LEVELS } from '@/lib/reserveUtils';

const STATUS_OPTIONS: { value: VisiteStatus; label: string; color: string }[] = [
  { value: 'planned', label: 'Planifiée', color: '#6366F1' },
  { value: 'in_progress', label: 'En cours', color: C.inProgress },
  { value: 'completed', label: 'Terminée', color: C.closed },
];

export default function NewVisiteScreen() {
  const router = useRouter();
  const { addVisite, activeChantierId, activeChantier } = useApp();
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(formatDateFR(new Date()));
  const [conducteur, setConducteur] = useState(user?.name ?? '');
  const [status, setStatus] = useState<VisiteStatus>('planned');
  const [building, setBuilding] = useState(RESERVE_BUILDINGS[0]);
  const [level, setLevel] = useState('RDC');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSubmit() {
    if (!title.trim()) {
      Alert.alert('Champ requis', 'Veuillez saisir un titre pour la visite.');
      return;
    }
    if (!date.trim()) {
      Alert.alert('Champ requis', 'Veuillez saisir une date.');
      return;
    }
    setIsSubmitting(true);
    const visite: Visite = {
      id: 'VIS-' + genId().slice(0, 8).toUpperCase(),
      chantierId: activeChantierId ?? 'chan1',
      title: title.trim(),
      date,
      conducteur: conducteur.trim() || (user?.name ?? 'Équipe BuildTrack'),
      status,
      building,
      level,
      notes: notes.trim() || undefined,
      reserveIds: [],
      createdAt: formatDateFR(new Date()),
    };
    addVisite(visite);
    Alert.alert('Visite créée', `"${visite.title}" a été créée.`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
    setIsSubmitting(false);
  }

  return (
    <View style={styles.container}>
      <Header title="Nouvelle visite" subtitle={activeChantier?.name ?? ''} showBack />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>INFORMATIONS GÉNÉRALES</Text>

          <Text style={styles.label}>Titre de la visite *</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: Visite de contrôle — Semaine 14"
            placeholderTextColor={C.textMuted}
            value={title}
            onChangeText={setTitle}
          />

          <Text style={styles.label}>Conducteur</Text>
          <TextInput
            style={styles.input}
            placeholder="Nom du responsable"
            placeholderTextColor={C.textMuted}
            value={conducteur}
            onChangeText={setConducteur}
          />

          <Text style={styles.label}>Date</Text>
          <DateInput value={date} onChange={setDate} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>LOCALISATION</Text>

          <Text style={styles.label}>Bâtiment</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {RESERVE_BUILDINGS.map(b => (
                <TouchableOpacity
                  key={b}
                  style={[styles.chip, building === b && styles.chipActive]}
                  onPress={() => setBuilding(b)}
                >
                  <Text style={[styles.chipText, building === b && styles.chipTextActive]}>Bât. {b}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <Text style={[styles.label, { marginTop: 14 }]}>Niveau</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {RESERVE_LEVELS.map(l => (
                <TouchableOpacity
                  key={l}
                  style={[styles.chip, level === l && styles.chipActive]}
                  onPress={() => setLevel(l)}
                >
                  <Text style={[styles.chipText, level === l && styles.chipTextActive]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>STATUT</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.statusChip, status === opt.value && { backgroundColor: opt.color + '20', borderColor: opt.color }]}
                onPress={() => setStatus(opt.value)}
              >
                <Text style={[styles.statusChipText, status === opt.value && { color: opt.color }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>NOTES</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Objectif de la visite, points à contrôler..."
            placeholderTextColor={C.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, isSubmitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          <Ionicons name="checkmark-circle" size={18} color="#fff" />
          <Text style={styles.submitBtnText}>Créer la visite</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 60 },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12,
  },
  label: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, marginBottom: 6 },
  input: {
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, marginBottom: 12,
  },
  textArea: { height: 90, paddingTop: 10 },

  chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  chipActive: { borderColor: C.primary, backgroundColor: C.primary + '15' },
  chipText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  chipTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },

  statusRow: { flexDirection: 'row', gap: 10 },
  statusChip: {
    flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
    borderColor: C.border, alignItems: 'center',
  },
  statusChipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16,
  },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
});
