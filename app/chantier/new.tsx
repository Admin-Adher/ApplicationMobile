import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { Chantier, SitePlan } from '@/constants/types';
import { genId } from '@/lib/utils';
import { uploadDocument } from '@/lib/storage';

interface PendingPlan {
  id: string;
  name: string;
  uri?: string;
  size?: string;
}

export default function NewChantierScreen() {
  const router = useRouter();
  const { addChantier, chantiers } = useApp();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [plans, setPlans] = useState<PendingPlan[]>([
    { id: genId(), name: 'Plan général' },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importingPlanId, setImportingPlanId] = useState<string | null>(null);

  function addPlanRow() {
    setPlans(prev => [...prev, { id: genId(), name: '' }]);
  }

  function removePlanRow(id: string) {
    setPlans(prev => prev.filter(p => p.id !== id));
  }

  function updatePlanName(id: string, name: string) {
    setPlans(prev => prev.map(p => p.id === id ? { ...p, name } : p));
  }

  async function importPlanFile(planId: string) {
    setImportingPlanId(planId);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['image/*', 'application/pdf'],
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const storageUrl = await uploadDocument(
          asset.uri,
          `plan_${planId}_${asset.name}`,
          asset.mimeType ?? undefined
        );
        const finalUri = storageUrl ?? asset.uri;
        const size = asset.size
          ? asset.size < 1024 * 1024
            ? `${(asset.size / 1024).toFixed(0)} Ko`
            : `${(asset.size / (1024 * 1024)).toFixed(1)} Mo`
          : undefined;
        setPlans(prev => prev.map(p => p.id === planId ? { ...p, uri: finalUri, size } : p));
      }
    } catch {
      Alert.alert('Erreur', "Impossible d'importer le fichier.");
    } finally {
      setImportingPlanId(null);
    }
  }

  function handleSubmit() {
    if (isSubmitting) return;
    if (!name.trim()) {
      Alert.alert('Champ obligatoire', 'Le nom du chantier est requis.');
      return;
    }
    const validPlans = plans.filter(p => p.name.trim());
    if (validPlans.length === 0) {
      Alert.alert('Plan requis', 'Ajoutez au moins un plan à votre chantier.');
      return;
    }

    setIsSubmitting(true);
    const chantierId = genId();
    const today = new Date().toISOString().slice(0, 10);
    const todayFr = new Date().toLocaleDateString('fr-FR');

    const newChantier: Chantier = {
      id: chantierId,
      name: name.trim(),
      address: address.trim() || undefined,
      description: description.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      status: 'active',
      createdAt: today,
      createdBy: 'Admin',
    };

    const newPlans: SitePlan[] = validPlans.map(p => ({
      id: p.id,
      chantierId,
      name: p.name.trim(),
      uri: p.uri,
      size: p.size,
      uploadedAt: todayFr,
    }));

    addChantier(newChantier, newPlans);

    Alert.alert(
      'Chantier créé',
      `"${name.trim()}" a été créé avec ${newPlans.length} plan(s).`,
      [{ text: 'OK', onPress: () => router.back() }]
    );
  }

  return (
    <View style={styles.container}>
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

        <View style={styles.plansSection}>
          <View style={styles.plansSectionHeader}>
            <Ionicons name="map-outline" size={16} color={C.primary} />
            <Text style={styles.plansSectionTitle}>Plans associés</Text>
            <TouchableOpacity style={styles.addPlanBtn} onPress={addPlanRow}>
              <Ionicons name="add" size={14} color={C.primary} />
              <Text style={styles.addPlanText}>Ajouter</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.plansSectionSubtitle}>
            Nommez vos plans et importez optionnellement les fichiers (PDF ou image).
          </Text>

          {plans.map((plan, idx) => (
            <View key={plan.id} style={styles.planRow}>
              <View style={styles.planIndexBadge}>
                <Text style={styles.planIndexText}>{idx + 1}</Text>
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <TextInput
                  style={styles.planNameInput}
                  placeholder={`Plan ${idx + 1} (ex: Bâtiment A - RDC)`}
                  placeholderTextColor={C.textMuted}
                  value={plan.name}
                  onChangeText={v => updatePlanName(plan.id, v)}
                />
                <View style={styles.planFileRow}>
                  {plan.uri ? (
                    <View style={styles.planFileChip}>
                      <Ionicons
                        name={plan.uri.toLowerCase().includes('pdf') ? 'document-text-outline' : 'image-outline'}
                        size={12}
                        color={C.closed}
                      />
                      <Text style={styles.planFileChipText} numberOfLines={1}>
                        {plan.size ? `Fichier importé · ${plan.size}` : 'Fichier importé'}
                      </Text>
                      <TouchableOpacity onPress={() => setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, uri: undefined, size: undefined } : p))}>
                        <Ionicons name="close-circle" size={14} color={C.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.importFileBtn}
                      onPress={() => importPlanFile(plan.id)}
                      disabled={importingPlanId === plan.id}
                    >
                      {importingPlanId === plan.id ? (
                        <ActivityIndicator size="small" color={C.primary} />
                      ) : (
                        <>
                          <Ionicons name="cloud-upload-outline" size={13} color={C.primary} />
                          <Text style={styles.importFileBtnText}>Importer PDF / image</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              {plans.length > 1 && (
                <TouchableOpacity onPress={() => removePlanRow(plan.id)} style={styles.removePlanBtn}>
                  <Ionicons name="trash-outline" size={16} color={C.open} />
                </TouchableOpacity>
              )}
            </View>
          ))}
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
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', gap: 12 },
  plansSection: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  plansSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  plansSectionTitle: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  plansSectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 14, lineHeight: 17 },
  addPlanBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.primaryBg, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '40' },
  addPlanText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  planRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  planIndexBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginTop: 10, flexShrink: 0 },
  planIndexText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  planNameInput: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 13,
    borderWidth: 1, borderColor: C.border,
  },
  planFileRow: { flexDirection: 'row' },
  importFileBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.primaryBg, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '40' },
  importFileBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  planFileChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: C.closed + '15', borderRadius: 8, borderWidth: 1, borderColor: C.closed + '40', flex: 1 },
  planFileChipText: { flex: 1, fontSize: 11, fontFamily: 'Inter_500Medium', color: C.closed },
  removePlanBtn: { padding: 8, marginTop: 6 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, gap: 8, marginTop: 4 },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  existingNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14, padding: 12, backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  existingNoteText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 17 },
});
