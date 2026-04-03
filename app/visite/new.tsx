import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Visite, VisiteParticipant, VisiteStatus } from '@/constants/types';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { genId, formatDateFR } from '@/lib/utils';
import { RESERVE_BUILDINGS, RESERVE_LEVELS } from '@/lib/reserveUtils';

type Recurrence = 'none' | 'weekly' | 'bimonthly';

const RECURRENCE_OPTIONS: { value: Recurrence; label: string; desc: string }[] = [
  { value: 'none',       label: 'Aucune',            desc: 'Visite unique' },
  { value: 'weekly',     label: 'Hebdomadaire',       desc: '4 visites (4 semaines)' },
  { value: 'bimonthly',  label: 'Bi-mensuelle',       desc: '4 visites (2 semaines)' },
];

const STATUS_OPTIONS: { value: VisiteStatus; label: string; color: string }[] = [
  { value: 'planned', label: 'Planifiée', color: '#6366F1' },
  { value: 'in_progress', label: 'En cours', color: C.inProgress },
  { value: 'completed', label: 'Terminée', color: C.closed },
];

export default function NewVisiteScreen() {
  const router = useRouter();
  const { addVisite, activeChantierId, activeChantier } = useApp();
  const { user, permissions } = useAuth();

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(formatDateFR(new Date()));
  const [conducteur, setConducteur] = useState(user?.name ?? '');
  const [status, setStatus] = useState<VisiteStatus>('planned');
  const [building, setBuilding] = useState(RESERVE_BUILDINGS[0]);
  const [level, setLevel] = useState('RDC');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [participants, setParticipants] = useState<VisiteParticipant[]>([]);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newParticipantCompany, setNewParticipantCompany] = useState('');

  if (!permissions.canCreate) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Header title="Nouvelle visite" />
        <Ionicons name="lock-closed-outline" size={48} color="#9CA3AF" />
        <Text style={{ marginTop: 16, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#374151', textAlign: 'center' }}>Accès refusé</Text>
        <Text style={{ marginTop: 8, fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6B7280', textAlign: 'center' }}>
          La création de visites chantier requiert les droits Conducteur ou Chef d'équipe.
        </Text>
      </View>
    );
  }

  function addParticipant() {
    if (!newParticipantName.trim()) return;
    const p: VisiteParticipant = {
      id: genId(),
      name: newParticipantName.trim(),
      role: newParticipantCompany.trim() || undefined,
      company: newParticipantCompany.trim() || undefined,
    };
    setParticipants(prev => [...prev, p]);
    setNewParticipantName('');
    setNewParticipantCompany('');
  }

  function removeParticipant(id: string) {
    setParticipants(prev => prev.filter(p => p.id !== id));
  }

  function parseDate(dateStr: string): Date {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
    return new Date();
  }

  function addDays(d: Date, days: number): string {
    const next = new Date(d);
    next.setDate(next.getDate() + days);
    return formatDateFR(next);
  }

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
    const today = formatDateFR(new Date());
    const conducteurName = conducteur.trim() || (user?.name ?? 'Équipe BuildTrack');
    const baseDate = parseDate(date);

    const intervals: number[] = recurrence === 'weekly'
      ? [0, 7, 14, 21]
      : recurrence === 'bimonthly'
      ? [0, 14, 28, 42]
      : [0];

    intervals.forEach((offsetDays, idx) => {
      const visitDate = offsetDays === 0 ? date : addDays(baseDate, offsetDays);
      const visitTitle = recurrence !== 'none' ? `${title.trim()} — S${idx + 1}` : title.trim();
      const visite: Visite = {
        id: 'VIS-' + genId().slice(0, 8).toUpperCase(),
        chantierId: activeChantierId ?? 'chan1',
        title: visitTitle,
        date: visitDate,
        conducteur: conducteurName,
        status: idx === 0 ? status : 'planned',
        building,
        level,
        notes: notes.trim() || undefined,
        reserveIds: [],
        participants: participants.length > 0 ? participants : undefined,
        createdAt: today,
      };
      addVisite(visite);
    });

    const count = intervals.length;
    Alert.alert(
      count > 1 ? `${count} visites créées` : 'Visite créée',
      count > 1
        ? `Série "${title.trim()}" planifiée sur ${count} occurrences.`
        : `"${title.trim()}" a été créée.`,
      [{ text: 'OK', onPress: () => { setIsSubmitting(false); router.back(); } }]
    );
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

        {/* PARTICIPANTS */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>PARTICIPANTS ({participants.length})</Text>
          {participants.map(p => (
            <View key={p.id} style={styles.participantRow}>
              <View style={styles.participantAvatar}>
                <Text style={styles.participantAvatarText}>{p.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.participantName}>{p.name}</Text>
                {p.company ? <Text style={styles.participantCompany}>{p.company}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => removeParticipant(p.id)} hitSlop={8}>
                <Ionicons name="close-circle-outline" size={18} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
          <TextInput
            style={[styles.input, { marginBottom: 8, marginTop: participants.length > 0 ? 12 : 0 }]}
            placeholder="Nom du participant *"
            placeholderTextColor={C.textMuted}
            value={newParticipantName}
            onChangeText={setNewParticipantName}
          />
          <TextInput
            style={[styles.input, { marginBottom: 8 }]}
            placeholder="Entreprise / Fonction (optionnel)"
            placeholderTextColor={C.textMuted}
            value={newParticipantCompany}
            onChangeText={setNewParticipantCompany}
          />
          <TouchableOpacity style={styles.addParticipantBtn} onPress={addParticipant} disabled={!newParticipantName.trim()}>
            <Ionicons name="person-add-outline" size={14} color={newParticipantName.trim() ? C.primary : C.textMuted} />
            <Text style={[styles.addParticipantBtnText, { color: newParticipantName.trim() ? C.primary : C.textMuted }]}>Ajouter le participant</Text>
          </TouchableOpacity>
        </View>

        {/* RÉCURRENCE */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>RÉCURRENCE</Text>
          <View style={{ gap: 8 }}>
            {RECURRENCE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.recurrenceChip, recurrence === opt.value && styles.recurrenceChipActive]}
                onPress={() => setRecurrence(opt.value)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.recurrenceChipLabel, recurrence === opt.value && { color: C.primary }]}>{opt.label}</Text>
                  <Text style={styles.recurrenceChipDesc}>{opt.desc}</Text>
                </View>
                {recurrence === opt.value && <Ionicons name="checkmark-circle" size={18} color={C.primary} />}
              </TouchableOpacity>
            ))}
          </View>
          {recurrence !== 'none' && (
            <View style={styles.recurrenceHint}>
              <Ionicons name="repeat-outline" size={13} color={C.inProgress} />
              <Text style={styles.recurrenceHintText}>
                {recurrence === 'weekly' ? '4 visites' : '4 visites'} seront créées automatiquement à partir du {date}.
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, isSubmitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={isSubmitting}
          activeOpacity={0.85}
        >
          {isSubmitting
            ? <ActivityIndicator size="small" color="#fff" />
            : <>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={styles.submitBtnText}>
                  {recurrence !== 'none' ? 'Créer la série de visites' : 'Créer la visite'}
                </Text>
              </>
          }
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

  participantRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  participantAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  participantAvatarText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.primary },
  participantName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  participantCompany: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  addParticipantBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, marginTop: 4 },
  addParticipantBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  recurrenceChip: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2 },
  recurrenceChipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  recurrenceChipLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  recurrenceChipDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  recurrenceHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, backgroundColor: C.inProgress + '12', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: C.inProgress + '30' },
  recurrenceHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress, lineHeight: 16 },
});
