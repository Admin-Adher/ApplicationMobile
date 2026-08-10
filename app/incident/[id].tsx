import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Platform, Image, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { C } from '@/constants/colors';
import { MediaImage } from '@/components/MediaImage';
import { useAuth } from '@/context/AuthContext';
import { useIncidents } from '@/context/IncidentsContext';
import { useApp } from '@/context/AppContext';
import { IncidentSeverity, IncidentStatus } from '@/constants/types';
import Header from '@/components/Header';
import PageContainer from '@/components/PageContainer';
import DateInput from '@/components/DateInput';
import LocationPicker from '@/components/LocationPicker';
import { showAlert } from '@/lib/appAlert';
import { formatDateFR } from '@/lib/utils';

const SEVERITY_CONFIG: Record<IncidentSeverity, { color: string; bg: string; icon: string }> = {
  minor:    { color: '#6B7280', bg: '#F3F4F6', icon: 'information-circle' },
  moderate: { color: '#F59E0B', bg: '#FFFBEB', icon: 'warning' },
  major:    { color: '#EF4444', bg: '#FEF2F2', icon: 'alert-circle' },
  critical: { color: '#7F1D1D', bg: '#FEE2E2', icon: 'nuclear' },
};

const STATUS_CONFIG: Record<IncidentStatus, { color: string; bg: string }> = {
  open:          { color: C.open,       bg: C.open + '15'       },
  investigating: { color: C.inProgress, bg: C.inProgress + '15' },
  resolved:      { color: C.closed,     bg: C.closed + '15'     },
};

const SEVERITIES: IncidentSeverity[] = ['minor', 'moderate', 'major', 'critical'];
const STATUSES: IncidentStatus[] = ['open', 'investigating', 'resolved'];

export default function EditIncidentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
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

  if (user?.role === 'sous_traitant') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, marginBottom: 8 }}>
          {t('incidentForm.restrictedTitle')}
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginBottom: 24 }}>
          {t('incidentForm.restrictedViewText')}
        </Text>
        <TouchableOpacity onPress={() => goBack()} style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: C.primaryBg, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40' }}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary }}>{t('incidentForm.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!incident) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
        <Text style={{ fontSize: 15, color: C.textMuted, fontFamily: 'Inter_400Regular' }}>{t('incidentForm.notFound')}</Text>
        <TouchableOpacity onPress={() => goBack()} style={{ marginTop: 16 }}>
          <Text style={{ color: C.primary, fontFamily: 'Inter_600SemiBold' }}>{t('incidentForm.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function handlePickPhoto() {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { showAlert(t('incidentForm.permissionDenied'), t('incidentForm.galleryPermissionDenied')); return; }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  async function handleCamera() {
    if (Platform.OS === 'web') { showAlert(t('incidentForm.info'), t('incidentForm.directCameraMobileOnly')); return; }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { showAlert(t('incidentForm.permissionDenied'), t('incidentForm.cameraPermissionDenied')); return; }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  function handleDelete() {
    if (!incident) return;
    showAlert(
      t('incidentForm.deleteTitle'),
      t('incidentForm.deleteMessage', { title: incident.title }),
      [
        { text: t('incidentForm.cancel'), style: 'cancel' },
        {
          text: t('common.delete'), style: 'destructive', onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            await deleteIncident(incident.id);
            goBack();
          },
        },
      ]
    );
  }

  async function handleSave() {
    if (!incident) return;
    if (!title.trim()) { showAlert(t('incidentForm.requiredField'), t('incidentForm.titleRequired')); return; }
    if (!location.trim()) { showAlert(t('incidentForm.requiredField'), t('incidentForm.locationRequired')); return; }
    setSaving(true);
    try {
      const isNowResolved = status === 'resolved';
      const wasResolved = incident.status === 'resolved';
      const closedAt = isNowResolved ? (wasResolved ? incident.closedAt : formatDateFR(new Date())) : undefined;
      const closedBy = isNowResolved ? (wasResolved ? incident.closedBy : user?.name ?? t('incidentForm.unknownUser')) : undefined;

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
      goBack();
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Header
        title={t('incidentForm.editTitle')}
        showBack
        rightActions={
          permissions.canDelete ? (
            <TouchableOpacity onPress={handleDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="trash-outline" size={20} color={C.open} />
            </TouchableOpacity>
          ) : undefined
        }
      />
      <PageContainer maxWidth={800}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>{t('incidentForm.titleLabel')} *</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={t('incidentForm.titleEditPlaceholder')}
            placeholderTextColor={C.textMuted}
          />

          <Text style={styles.label}>{t('incidentForm.descriptionLabel')}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('incidentForm.descriptionEditPlaceholder')}
            placeholderTextColor={C.textMuted}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>{t('incidentForm.locationLabel')} *</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder={t('incidentForm.locationEditPlaceholder')}
            placeholderTextColor={C.textMuted}
          />

          <Text style={styles.label}>{t('incidentForm.locationHierarchy')}</Text>
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

          <Text style={styles.label}>{t('incidentForm.severityLabel')}</Text>
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
                  <Text style={[styles.chipText, active && { color: cfg.color }]}>{t(`incidentsScreen.severity.${s}`)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>{t('incidentForm.statusLabel')}</Text>
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
                  <Text style={[styles.chipText, active && { color: cfg.color }]}>{t(`incidentsScreen.status.${s}`)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ marginTop: 4, marginBottom: 4 }}>
            <DateInput
              label={t('incidentForm.incidentDate')}
              value={reportedAt}
              onChange={setReportedAt}
              optional
            />
          </View>

          <Text style={styles.label}>{t('incidentForm.witnessesLabel')}</Text>
          <TextInput
            style={styles.input}
            value={witnesses}
            onChangeText={setWitnesses}
            placeholder={t('incidentForm.witnessesEditPlaceholder')}
            placeholderTextColor={C.textMuted}
          />

          <Text style={styles.label}>{t('incidentForm.correctiveActions')}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={actions}
            onChangeText={setActions}
            placeholder={t('incidentForm.correctiveEditPlaceholder')}
            placeholderTextColor={C.textMuted}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>{t('incidentForm.photoEvidence')}</Text>
          {photoUri ? (
            <View style={styles.photoWrap}>
              <MediaImage source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
              <TouchableOpacity style={styles.removePhoto} onPress={() => setPhotoUri(undefined)}>
                <Ionicons name="close-circle" size={20} color={C.open} />
                <Text style={styles.removePhotoText}>{t('incidentForm.remove')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.photoRow}>
              <TouchableOpacity style={styles.photoBtn} onPress={handlePickPhoto}>
                <Ionicons name="images-outline" size={18} color={C.primary} />
                <Text style={styles.photoBtnText}>{t('incidentForm.gallery')}</Text>
              </TouchableOpacity>
              {Platform.OS !== 'web' && (
                <TouchableOpacity style={styles.photoBtn} onPress={handleCamera}>
                  <Ionicons name="camera-outline" size={18} color={C.primary} />
                  <Text style={styles.photoBtnText}>{t('incidentForm.camera')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={{ height: 24 }} />

          {saving ? (
            <ActivityIndicator size="large" color={C.primary} style={{ marginVertical: 16 }} />
          ) : (
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>{t('incidentForm.saveChanges')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.cancelBtn} onPress={() => goBack()}>
            <Text style={styles.cancelBtnText}>{t('incidentForm.cancel')}</Text>
          </TouchableOpacity>

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
      </PageContainer>
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
