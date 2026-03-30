import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { ReservePriority, ReserveStatus } from '@/constants/types';
import Header from '@/components/Header';

const BUILDINGS = ['A', 'B', 'C'];
const ZONES = ['Zone Nord', 'Zone Sud', 'Zone Est', 'Zone Ouest', 'Zone Centre'];
const LEVELS = ['Sous-sol', 'RDC', 'R+1', 'R+2', 'R+3'];
const PRIORITIES: { value: ReservePriority; label: string; color: string }[] = [
  { value: 'low', label: 'Basse', color: C.low },
  { value: 'medium', label: 'Moyenne', color: C.medium },
  { value: 'high', label: 'Haute', color: C.high },
  { value: 'critical', label: 'Critique', color: C.critical },
];

function SelectRow<T extends string>({
  label, options, value, onChange, colorFn,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (v: T) => void;
  colorFn?: (v: T) => string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chipRow}>
          {options.map(opt => (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, value === opt && styles.chipActive, colorFn ? { borderColor: colorFn(opt) } : {}]}
              onPress={() => onChange(opt)}
            >
              <Text style={[styles.chipText, value === opt && styles.chipTextActive, colorFn ? { color: colorFn(opt) } : {}]}>
                {opt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export default function NewReserveScreen() {
  const router = useRouter();
  const { companies, addReserve } = useApp();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ building?: string; planX?: string; planY?: string }>();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [building, setBuilding] = useState(params.building ?? 'A');
  const [zone, setZone] = useState('Zone Nord');
  const [level, setLevel] = useState('RDC');
  const [company, setCompany] = useState(companies[0]?.name ?? '');
  const [priority, setPriority] = useState<ReservePriority>('medium');
  const [deadline, setDeadline] = useState('');

  const presetX = params.planX ? parseInt(params.planX) : null;
  const presetY = params.planY ? parseInt(params.planY) : null;

  function handleSubmit() {
    if (!title.trim()) {
      Alert.alert('Champ obligatoire', 'Le titre est requis.');
      return;
    }
    const author = user?.name ?? 'Conducteur de travaux';
    const id = 'RSV-' + String(Date.now()).slice(-3).padStart(3, '0');
    addReserve({
      id,
      title: title.trim(),
      description: description.trim() || 'Aucune description.',
      building,
      zone,
      level,
      company,
      priority,
      status: 'open' as ReserveStatus,
      createdAt: new Date().toISOString().slice(0, 10),
      deadline: deadline || '—',
      comments: [],
      history: [
        { id: 'h0', action: 'Réserve créée', author, createdAt: new Date().toISOString().slice(0, 10) },
      ],
      planX: presetX ?? Math.round(Math.random() * 80 + 10),
      planY: presetY ?? Math.round(Math.random() * 80 + 10),
    });
    Alert.alert('Réserve créée', `${id} ajoutée avec succès.`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <View style={styles.container}>
      <Header title="Nouvelle réserve" showBack rightLabel="Créer" onRightPress={handleSubmit} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Titre *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex : Fissure mur porteur..."
              placeholderTextColor={C.textMuted}
              value={title}
              onChangeText={setTitle}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Décrivez le problème..."
              placeholderTextColor={C.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
            />
          </View>
        </View>

        <View style={styles.card}>
          <SelectRow label="Bâtiment" options={BUILDINGS} value={building} onChange={setBuilding} />
          <SelectRow label="Zone" options={ZONES} value={zone} onChange={setZone} />
          <SelectRow label="Niveau" options={LEVELS} value={level} onChange={setLevel} />
        </View>

        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Entreprise responsable</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {companies.map(co => (
                  <TouchableOpacity
                    key={co.id}
                    style={[styles.chip, company === co.name && { ...styles.chipActive, borderColor: co.color }]}
                    onPress={() => setCompany(co.name)}
                  >
                    <View style={[styles.coDot, { backgroundColor: co.color }]} />
                    <Text style={[styles.chipText, company === co.name && { color: co.color }]}>{co.shortName}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Priorité</Text>
            <View style={styles.chipRow}>
              {PRIORITIES.map(p => (
                <TouchableOpacity
                  key={p.value}
                  style={[styles.chip, priority === p.value && { backgroundColor: p.color + '20', borderColor: p.color }]}
                  onPress={() => setPriority(p.value)}
                >
                  <Text style={[styles.chipText, priority === p.value && { color: p.color }]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Date limite (JJ/MM/AAAA)</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex : 30/04/2025"
              placeholderTextColor={C.textMuted}
              value={deadline}
              onChangeText={setDeadline}
            />
          </View>
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
          <Ionicons name="add-circle" size={20} color="#fff" />
          <Text style={styles.submitBtnText}>Créer la réserve</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  fieldGroup: { marginBottom: 14 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  chipTextActive: { color: C.primary },
  coDot: { width: 8, height: 8, borderRadius: 4 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, gap: 8 },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
