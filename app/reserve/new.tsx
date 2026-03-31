import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, Platform, Image, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { ReservePriority, ReserveStatus } from '@/constants/types';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { uploadPhoto } from '@/lib/storage';
import { genId } from '@/lib/utils';
import {
  RESERVE_BUILDINGS, RESERVE_ZONES, RESERVE_LEVELS, RESERVE_PRIORITIES, genReserveId, validateDeadline,
} from '@/lib/reserveUtils';

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
  const { companies, addReserve, reserves, addPhoto, activeChantierId, sitePlans } = useApp();
  const { user, permissions } = useAuth();
  const params = useLocalSearchParams<{
    building?: string; planX?: string; planY?: string;
    prefill_description?: string; prefill_source?: string;
    chantierId?: string; planId?: string;
  }>();

  const effectiveChantierId = params.chantierId ?? activeChantierId ?? undefined;
  const chantierPlans = sitePlans.filter(p => p.chantierId === effectiveChantierId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(params.prefill_description ?? '');
  const [building, setBuilding] = useState(params.building ?? RESERVE_BUILDINGS[0]);
  const [zone, setZone] = useState(RESERVE_ZONES[0]);
  const [level, setLevel] = useState('RDC');
  const [company, setCompany] = useState(companies[0]?.name ?? '');
  const [priority, setPriority] = useState<ReservePriority>('medium');
  const [deadline, setDeadline] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState<string>(params.planId ?? chantierPlans[0]?.id ?? '');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const presetX = params.planX ? parseInt(params.planX) : null;
  const presetY = params.planY ? parseInt(params.planY) : null;

  if (!permissions.canCreate) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, textAlign: 'center' }}>
          Accès refusé
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 8, textAlign: 'center' }}>
          Votre rôle ne permet pas de créer des réserves.
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

  async function handlePickPhoto() {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission refusée', "L'accès à la galerie est nécessaire.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await savePhoto(result.assets[0].uri);
    }
  }

  async function handleCamera() {
    if (Platform.OS === 'web') {
      Alert.alert('Info', 'La prise de photo directe est disponible sur appareil mobile.');
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission refusée', "L'accès à l'appareil photo est nécessaire.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      await savePhoto(result.assets[0].uri);
    }
  }

  async function savePhoto(uri: string) {
    setPhotoUploading(true);
    try {
      const filename = `reserve_photo_${Date.now()}.jpg`;
      const storageUrl = await uploadPhoto(uri, filename);
      setPhotoUri(storageUrl ?? uri);
    } catch {
      setPhotoUri(uri);
    } finally {
      setPhotoUploading(false);
    }
  }

  function handleSubmit() {
    if (isSubmitting) return;
    if (!title.trim()) {
      Alert.alert('Champ obligatoire', 'Le titre est requis.');
      return;
    }
    if (!company) {
      Alert.alert('Champ obligatoire', "Sélectionnez l'entreprise responsable.");
      return;
    }
    if (deadline && !validateDeadline(deadline)) {
      Alert.alert('Date invalide', "Vérifiez que le jour, le mois et l'année sont corrects (ex : 30/04/2026).");
      return;
    }
    setIsSubmitting(true);
    const author = user?.name ?? 'Conducteur de travaux';
    const id = genReserveId(reserves);
    const today = new Date().toISOString().slice(0, 10);
    addReserve({
      id,
      title: title.trim(),
      description: description.trim() || 'Aucune description fournie.',
      building,
      zone,
      level,
      company,
      priority,
      status: 'open' as ReserveStatus,
      createdAt: today,
      deadline: deadline || '—',
      comments: [],
      history: [{ id: 'h0', action: 'Réserve créée', author, createdAt: today }],
      planX: presetX ?? undefined,
      planY: presetY ?? undefined,
      photoUri: photoUri ?? undefined,
      chantierId: effectiveChantierId,
      planId: selectedPlanId || undefined,
    });
    if (photoUri) {
      addPhoto({
        id: genId(),
        comment: `Photo réserve ${id} — ${title.trim()}`,
        location: `Bât. ${building} - ${level}`,
        takenAt: today,
        takenBy: author,
        colorCode: '#EF4444',
        uri: photoUri,
      });
    }
    Alert.alert('Réserve créée', `${id} ajoutée avec succès.`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <View style={styles.container}>
      <Header title="Nouvelle réserve" showBack rightLabel="Créer" onRightPress={handleSubmit} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {params.prefill_source ? (
          <View style={styles.sourceCard}>
            <Ionicons name="chatbubble-outline" size={14} color={C.inProgress} />
            <Text style={styles.sourceText}>Créé depuis : {params.prefill_source}</Text>
          </View>
        ) : null}

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
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Décrivez le problème en détail..."
              placeholderTextColor={C.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
            />
          </View>
        </View>

        <View style={styles.card}>
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <Text style={styles.label}>Photo jointe</Text>
            {photoUri ? (
              <View style={styles.photoPreviewWrap}>
                <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
                <View style={styles.photoActions}>
                  <TouchableOpacity style={styles.photoActionBtn} onPress={handleCamera} disabled={photoUploading}>
                    <Ionicons name="camera-outline" size={14} color={C.primary} />
                    <Text style={styles.photoActionText}>Caméra</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.photoActionBtn, { borderColor: C.inProgress + '80' }]} onPress={handlePickPhoto} disabled={photoUploading}>
                    <Ionicons name="images-outline" size={14} color={C.inProgress} />
                    <Text style={[styles.photoActionText, { color: C.inProgress }]}>Galerie</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.photoActionBtn, { borderColor: C.open }]} onPress={() => setPhotoUri(null)} disabled={photoUploading}>
                    <Ionicons name="trash-outline" size={14} color={C.open} />
                    <Text style={[styles.photoActionText, { color: C.open }]}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
                {photoUri.startsWith('http') && (
                  <View style={styles.cloudBadge}>
                    <Ionicons name="cloud-done-outline" size={10} color={C.closed} />
                    <Text style={styles.cloudBadgeText}>Sauvegardé</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.photoRow}>
                <TouchableOpacity style={[styles.photoBtn, { flex: 1 }]} onPress={handleCamera} disabled={photoUploading}>
                  <Ionicons name="camera" size={18} color={C.primary} />
                  <Text style={styles.photoBtnText}>Prendre une photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.photoBtn, { flex: 1 }]} onPress={handlePickPhoto} disabled={photoUploading}>
                  <Ionicons name="images-outline" size={18} color={C.inProgress} />
                  <Text style={[styles.photoBtnText, { color: C.inProgress }]}>Galerie</Text>
                </TouchableOpacity>
              </View>
            )}
            {photoUploading && (
              <View style={styles.uploadRow}>
                <ActivityIndicator size="small" color={C.primary} />
                <Text style={styles.uploadText}>Upload en cours...</Text>
              </View>
            )}
          </View>
        </View>

        {chantierPlans.length > 0 && (
          <View style={styles.card}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Plan associé</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[styles.chip, !selectedPlanId && styles.chipActive]}
                    onPress={() => setSelectedPlanId('')}
                  >
                    <Text style={[styles.chipText, !selectedPlanId && styles.chipTextActive]}>Aucun</Text>
                  </TouchableOpacity>
                  {chantierPlans.map(plan => (
                    <TouchableOpacity
                      key={plan.id}
                      style={[styles.chip, selectedPlanId === plan.id && styles.chipActive]}
                      onPress={() => setSelectedPlanId(plan.id)}
                    >
                      <Ionicons name="map-outline" size={12} color={selectedPlanId === plan.id ? C.primary : C.textSub} />
                      <Text style={[styles.chipText, selectedPlanId === plan.id && styles.chipTextActive]} numberOfLines={1}>{plan.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          </View>
        )}

        <View style={styles.card}>
          {(!effectiveChantierId && chantierPlans.length === 0) && (
            <SelectRow label="Bâtiment" options={RESERVE_BUILDINGS} value={building} onChange={setBuilding} />
          )}
          <SelectRow label="Zone" options={RESERVE_ZONES} value={zone} onChange={setZone} />
          <SelectRow label="Niveau" options={RESERVE_LEVELS} value={level} onChange={setLevel} />
        </View>

        <View style={styles.card}>
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <Text style={styles.label}>Entreprise responsable *</Text>
            {companies.length === 0 ? (
              <View style={styles.warningRow}>
                <Ionicons name="alert-circle-outline" size={14} color={C.medium} />
                <Text style={styles.warningText}>
                  Aucune entreprise configurée. Ajoutez d'abord une entreprise dans l'onglet Équipes.
                </Text>
              </View>
            ) : (
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
            )}
          </View>
        </View>

        <View style={styles.card}>
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <Text style={styles.label}>Priorité</Text>
            <View style={styles.chipRow}>
              {RESERVE_PRIORITIES.map(p => (
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
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <DateInput
              label="Date limite"
              value={deadline}
              onChange={setDeadline}
              optional
            />
          </View>
        </View>

        <TouchableOpacity style={[styles.submitBtn, isSubmitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={isSubmitting}>
          <Ionicons name="add-circle" size={20} color="#fff" />
          <Text style={styles.submitBtnText}>{isSubmitting ? 'Création...' : 'Créer la réserve'}</Text>
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
  hint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 6 },
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
  photoRow: { flexDirection: 'row', gap: 10 },
  photoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface2, borderRadius: 10, paddingVertical: 14, borderWidth: 1.5, borderColor: C.border },
  photoBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  photoPreviewWrap: { borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  photoPreview: { width: '100%', height: 160 },
  photoActions: { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: C.surface2 },
  photoActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  photoActionText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  cloudBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  cloudBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  uploadRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  uploadText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.medium + '10', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.medium + '30' },
  warningText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.medium, lineHeight: 18 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, gap: 8 },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  sourceCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.inProgress + '15', borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: C.inProgress + '30' },
  sourceText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: C.inProgress, lineHeight: 16 },
});
