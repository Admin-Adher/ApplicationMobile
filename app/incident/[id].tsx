import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, Platform, Image, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
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
import { formatDateFR } from '@/lib/utils';

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

export default function EditIncidentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, permissions } = useAuth();
  const { incidents, updateIncident, deleteIncident } = useIncidents();
  const { activeChantierId, chantiers } = useApp();

  const incident = incidents.find(i => i.id === id);
  const activeChantier = chantiers.find(c => c.id === activeChantierId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [building, setBuilding] = useState('');
  const [level, setLevel] = useState('');
  const [zone, setZone] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('moderate');
  const [status, setStatus] = useState<IncidentStatus>('open');
  const [reportedAt, setReportedAt] = useState(formatDateFR(new Date()));
  const [witnesses, setWitnesses] = useState('');
  const [actions, setActions] = useState('');
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (incident) {
      setTitle(incident.title);
      setDescription(incident.description);
      setLocation(incident.location);
      setBuilding(incident.building);
      setLevel(incident.level ?? '');
      setZone(incident.zone ?? '');
      setSeverity(incident.severity);
      setStatus(incident.status);
      setReportedAt(incident.reportedAt);
      setWitnesses(incident.witnesses);
      setActions(incident.actions);
      setPhotoUri(incident.photoUri);
    }
  }, [incident?.id]);

  if (!incident) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
        <Text style={{ fontSize: 15, color: C.textMuted, fontFamily: 'Inter_400Regular' }}>Incident introuvable</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: C.primary, fontFamily: 'Inter_600SemiBold' }}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function handlePickPhoto() {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à la galerie est nécessaire."); return; }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  async function handleCamera() {
    if (Platform.OS === 'web') { Alert.alert('Info', 'La prise de photo directe est disponible sur appareil mobile.'); return; }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à l'appareil photo est nécessaire."); return; }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  function handleDelete() {
    Alert.alert(
      'Supprimer l\'incident',
      `Supprimer "${incident.title}" définitivement ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive', onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            await deleteIncident(incident.id);
            router.back();
          },
        },
      ]
    );
  }

  async function handleSave() {
    if (!title.trim()) { Alert.alert('Champ requis', 'Le titre est obligatoire.'); return; }
    if (!location.trim()) { Alert.alert('Champ requis', 'Le lieu est obligatoire.'); return; }
    setSaving(true);
    try {
      const isNowResolved = status === 'resolved';
      const wasResolved = incident.status === 'resolved';
      const closedAt = isNowResolved ? (wasResolved ? incident.closedAt : formatDateFR(new Date())) : undefined;
      const closedBy = isNowResolved ? (wasResolved ? incident.closedBy : user?.name ?? 'Inconnu') : undefined;

      await updateIncident({
        ...incident,
        title: title.trim(),
        description,
        severity,
        location: location.trim(),
        building,
        level,
        zone,
        reportedAt,
        status,
        witnesses,
        actions,
        photoUri,
        closedAt,
        closedBy,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Header
        title="Modifier l'incident"
        showBack
        rightActions={
          permissions.canDelete ? (
            <TouchableOpacity onPress={handleDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="trash-outline" size={20} color={C.open} />
            </TouchableOpacity>
          ) : undefined
        }
      />
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

          <Text style={styles.label}>Bâtiment · Niveau · Zone</Text>
          <LocationPicker
            buildings={activeChantier?.buildings ?? []}
            building={building}
            onBuildingChange={setBuilding}
            level={level}
            onLevelChange={setLevel}
            zone={zone}
            onZoneChange={setZone}
            showLevel
            showZone
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
              <Text style={styles.saveBtnText}>Enregistrer les modifications</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
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
