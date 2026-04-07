import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import LocationTreeEditor from '@/components/LocationTreeEditor';
import { Chantier, ChantierBuilding } from '@/constants/types';
import { genId, formatDateFR } from '@/lib/utils';

export default function NewChantierScreen() {
  const router = useRouter();
  const { addChantier, chantiers, companies } = useApp();
  const { user, permissions } = useAuth();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [buildings, setBuildings] = useState<ChantierBuilding[]>([
    { id: genId(), name: 'Bâtiment 1', levels: [{ id: genId(), name: 'RDC', zones: [] }] },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!permissions.canCreate) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F1117', padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color="#6B7280" />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#F9FAFB', marginTop: 16, textAlign: 'center' }}>
          Accès refusé
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 8, textAlign: 'center' }}>
          Votre rôle ne permet pas de créer un chantier.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#1D4ED8', borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function toggleChantierCompany(id: string) {
    setSelectedCompanyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function handleSubmit() {
    if (isSubmitting) return;
    if (!name.trim()) {
      Alert.alert('Champ obligatoire', 'Le nom du chantier est requis.');
      return;
    }
    if (buildings.length === 0) {
      Alert.alert('Structure requise', 'Ajoutez au moins un bâtiment avec un niveau pour activer la localisation.');
      return;
    }
    const emptyBuilding = buildings.find(b => !b.name.trim());
    if (emptyBuilding) {
      Alert.alert('Nom manquant', 'Chaque bâtiment doit avoir un nom.');
      return;
    }
    const buildingWithoutLevel = buildings.find(b => b.levels.length === 0);
    if (buildingWithoutLevel) {
      Alert.alert(
        'Niveau manquant',
        `Le bâtiment "${buildingWithoutLevel.name}" doit avoir au moins un niveau.\n\nAjoutez un niveau (RDC, R+1…) pour continuer.`
      );
      return;
    }

    setIsSubmitting(true);
    const chantierId = genId();
    const todayFr = formatDateFR(new Date());

    const newChantier: Chantier = {
      id: chantierId,
      name: name.trim(),
      address: address.trim() || undefined,
      description: description.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      status: 'active',
      createdAt: todayFr,
      createdBy: user?.name ?? 'Inconnu',
      companyIds: selectedCompanyIds.length > 0 ? selectedCompanyIds : undefined,
      buildings,
    };

    addChantier(newChantier, []);

    Alert.alert(
      'Chantier créé',
      `"${name.trim()}" a été créé. Vous pouvez ajouter des plans depuis l'onglet Plans.`,
      [{ text: 'OK', onPress: () => router.back() }]
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header title="Nouveau chantier" showBack rightLabel="Créer" onRightPress={handleSubmit} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Nom du chantier *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex : Résidence Les Acacias, Phase 2..."
              placeholderTextColor={C.textMuted}
              value={name}
              onChangeText={setName}
              autoFocus
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Adresse</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex : 12 rue des Marronniers, 69003 Lyon"
              placeholderTextColor={C.textMuted}
              value={address}
              onChangeText={setAddress}
            />
          </View>
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Décrivez le projet (type de construction, nombre de logements...)"
              placeholderTextColor={C.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <DateInput label="Début des travaux" value={startDate} onChange={setStartDate} optional />
            </View>
            <View style={{ flex: 1 }}>
              <DateInput label="Fin prévisionnelle" value={endDate} onChange={setEndDate} optional />
            </View>
          </View>
        </View>

        {companies.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.label}>Entreprises associées</Text>
            <Text style={styles.hint}>Sélectionnez les entreprises intervenant sur ce chantier (optionnel).</Text>
            {companies.map(co => {
              const sel = selectedCompanyIds.includes(co.id);
              return (
                <TouchableOpacity
                  key={co.id}
                  style={[styles.coRow, sel && { borderColor: co.color, backgroundColor: co.color + '15' }]}
                  onPress={() => toggleChantierCompany(co.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.coDot, { backgroundColor: co.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.coName, sel && { color: co.color, fontFamily: 'Inter_600SemiBold' }]}>{co.name}</Text>
                    {co.shortName && co.shortName !== co.name && (
                      <Text style={styles.coShort}>{co.shortName}</Text>
                    )}
                  </View>
                  <View style={[styles.coCheck, sel && { backgroundColor: co.color, borderColor: co.color }]}>
                    {sel && <Ionicons name="checkmark" size={12} color="#fff" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* STRUCTURE DU BÂTIMENT */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="business-outline" size={16} color={C.primary} />
            <Text style={styles.sectionTitle}>Structure du bâtiment *</Text>
          </View>
          <Text style={styles.hint}>
            Définissez les bâtiments et niveaux de votre chantier. Cette structure est utilisée pour la localisation dans toute l'application (plans, réserves, OPRs, visites).
            Vous pouvez la compléter à tout moment dans les paramètres du chantier.
          </Text>
          <LocationTreeEditor buildings={buildings} onChange={setBuildings} />
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, isSubmitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          <Ionicons name="checkmark-circle" size={20} color="#fff" />
          <Text style={styles.submitBtnText}>
            {isSubmitting ? 'Création...' : 'Créer le chantier'}
          </Text>
        </TouchableOpacity>

        {chantiers.length > 0 && (
          <View style={styles.existingNote}>
            <Ionicons name="information-circle-outline" size={14} color={C.textMuted} />
            <Text style={styles.existingNoteText}>
              Ce nouveau chantier deviendra le chantier actif de l'application.
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  fieldGroup: { marginBottom: 14 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  hint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 14, lineHeight: 17 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  coRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2, marginBottom: 6 },
  coDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  coName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  coShort: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  coCheck: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', gap: 12 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, gap: 8, marginTop: 4 },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  existingNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14, padding: 12, backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  existingNoteText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 17 },
});
