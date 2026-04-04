import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, Platform, Image, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useIncidents } from '@/context/IncidentsContext';
import { useApp } from '@/context/AppContext';
import { IncidentSeverity, IncidentStatus } from '@/constants/types';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import LocationPicker from '@/components/LocationPicker';
import { genId, formatDateFR } from '@/lib/utils';

const SEVERITY_CONFIG: Record<IncidentSeverity, { label: string; color: string; bg: string; icon: string }> = {
  minor:    { label: 'Mineur',   color: '#6B7280', bg: '#F3F4F6', icon: 'information-circle' },
  moderate: { label: 'Modéré',  color: '#F59E0B', bg: '#FFFBEB', icon: 'warning' },
  major:    { label: 'Majeur',   color: '#EF4444', bg: '#FEF2F2', icon: 'alert-circle' },
  critical: { label: 'Critique', color: '#7F1D1D', bg: '#FEE2E2', icon: 'nuclear' },
};

const STATUS_CONFIG: Record<IncidentStatus, { label: string; color: string; bg: string }> = {
  open:          { label: 'Ouvert',   color: C.open,       bg: C.open + '15'       },
  investigating: { label: 'En cours', color: C.inProgress, bg: C.inProgress + '15' },
  resolved:      { label: 'Résolu',   color: C.closed,     bg: C.closed + '15'     },
};

const SEVERITIES: IncidentSeverity[] = ['minor', 'moderate', 'major', 'critical'];
const STATUSES: IncidentStatus[] = ['open', 'investigating', 'resolved'];

export default function NewIncidentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, permissions } = useAuth();
  const { addIncident } = useIncidents();
  const { activeChantierId, chantiers } = useApp();
  const params = useLocalSearchParams<{ description?: string }>();

  const activeChantier = chantiers.find(c => c.id === activeChantierId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(params.description ?? '');
  const [location, setLocation] = useState('');
  const [building, setBuilding] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('moderate');
  const [status, setStatus] = useState<IncidentStatus>('open');
  const [reportedAt, setReportedAt] = useState(formatDateFR(new Date()));
  const [witnesses, setWitnesses] = useState('');
  const [actions, setActions] = useState('');
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const isDirty = title.trim().length > 0 || description.trim().length > 0 || location.trim().length > 0;

  function handleBack() {
    if (!isDirty) { router.back(); return; }
    Alert.alert(
      'Abandonner le formulaire ?',
      'Vos saisies seront perdues si vous quittez maintenant.',
      [
        { text: 'Continuer la saisie', style: 'cancel' },
        { text: 'Abandonner', style: 'destructive', onPress: () => router.back() },
      ]
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
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
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
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  async function handleSave() {
    if (!title.trim()) { Alert.alert('Champ requis', 'Le titre est obligatoire.'); return; }
    if (!location.trim()) { Alert.alert('Champ requis', 'Le lieu est obligatoire.'); return; }
    setSaving(true);
    try {
      await addIncident({
        id: 'inc-' + genId(),
        title: title.trim(),
        description,
        severity,
        location: location.trim(),
        building,
        reportedAt,
        reportedBy: user?.name ?? 'Inconnu',
        status,
        witnesses,
        actions,
        photoUri,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } finally {
      setSaving(false);
    }
  }

  if (!permissions.canCreate) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, textAlign: 'center' }}>Accès refusé</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 }}>
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Header title="Signaler un incident" showBack onBack={handleBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>Titre *</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Ex : Chute de matériaux"
            placeholderTextColor={C.textMuted}
            autoFocus
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Décrivez les circonstances..."
            placeholderTextColor={C.textMuted}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>Lieu *</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="Ex : Échafaudage Est, Niveau R+2"
            placeholderTextColor={C.textMuted}
          />

          <Text style={styles.label}>Bâtiment</Text>
          <LocationPicker
            buildings={activeChantier?.buildings ?? []}
            building={building}
            onBuildingChange={setBuilding}
            showLevel={false}
            showZone={false}
          />

          <Text style={styles.label}>Gravité</Text>
          <View style={styles.chipRow}>
            {SEVERITIES.map(s => {
              const cfg = SEVERITY_CONFIG[s];
              const active = severity === s;
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, active && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                  onPress={() => setSeverity(s)}
                >
                  <Ionicons name={cfg.icon as any} size={13} color={active ? cfg.color : C.textMuted} />
                  <Text style={[styles.chipText, active && { color: cfg.color }]}>{cfg.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Statut</Text>
          <View style={styles.chipRow}>
            {STATUSES.map(s => {
              const cfg = STATUS_CONFIG[s];
              const active = status === s;
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, active && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                  onPress={() => setStatus(s)}
                >
                  <Text style={[styles.chipText, active && { color: cfg.color }]}>{cfg.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ marginTop: 4, marginBottom: 4 }}>
            <DateInput
              label="Date de l'incident"
              value={reportedAt}
              onChange={setReportedAt}
              optional
            />
          </View>

          <Text style={styles.label}>Témoins</Text>
          <TextInput
            style={styles.input}
            value={witnesses}
            onChangeText={setWitnesses}
            placeholder="Noms des témoins (optionnel)"
            placeholderTextColor={C.textMuted}
          />

          <Text style={styles.label}>Actions correctives</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={actions}
            onChangeText={setActions}
            placeholder="Mesures prises ou planifiées..."
            placeholderTextColor={C.textMuted}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>Photo de preuve</Text>
          {photoUri ? (
            <View style={styles.photoWrap}>
              <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
              <TouchableOpacity style={styles.removePhoto} onPress={() => setPhotoUri(undefined)}>
                <Ionicons name="close-circle" size={20} color={C.open} />
                <Text style={styles.removePhotoText}>Retirer</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.photoRow}>
              <TouchableOpacity style={styles.photoBtn} onPress={handlePickPhoto}>
                <Ionicons name="images-outline" size={18} color={C.primary} />
                <Text style={styles.photoBtnText}>Galerie</Text>
              </TouchableOpacity>
              {Platform.OS !== 'web' && (
                <TouchableOpacity style={styles.photoBtn} onPress={handleCamera}>
                  <Ionicons name="camera-outline" size={18} color={C.primary} />
                  <Text style={styles.photoBtnText}>Caméra</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={{ height: 24 }} />

          {saving ? (
            <ActivityIndicator size="large" color={C.primary} style={{ marginVertical: 16 }} />
          ) : (
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>Signaler l'incident</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.cancelBtn} onPress={handleBack}>
            <Text style={styles.cancelBtnText}>Annuler</Text>
          </TouchableOpacity>

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, paddingTop: 8 },

  label: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, marginTop: 16,
  },
  input: {
    backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },

  photoWrap: { marginTop: 4 },
  photo: { width: '100%', height: 180, borderRadius: 10, marginBottom: 8 },
  removePhoto: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  removePhotoText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.open },

  photoRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  photoBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, backgroundColor: C.primaryBg, borderRadius: 10,
    borderWidth: 1, borderColor: C.primary + '40',
  },
  photoBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },

  saveBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  cancelBtn: { alignItems: 'center', paddingVertical: 14 },
  cancelBtnText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
