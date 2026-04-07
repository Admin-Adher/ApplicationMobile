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

const SEVERITY_CONFIG: Record<IncidentSeverity, { label: string; color: string; bg: string; icon: string; hint: string }> = {
  minor:    { label: 'Mineur',   color: '#6B7280', bg: '#F3F4F6', icon: 'information-circle', hint: 'Aucun impact sur la sécurité' },
  moderate: { label: 'Modéré',  color: '#F59E0B', bg: '#FFFBEB', icon: 'warning',             hint: 'Incident à surveiller' },
  major:    { label: 'Majeur',   color: '#EF4444', bg: '#FEF2F2', icon: 'alert-circle',       hint: 'Impact significatif sur le chantier' },
  critical: { label: 'Critique', color: '#7F1D1D', bg: '#FEE2E2', icon: 'nuclear',            hint: 'Danger immédiat — intervention urgente' },
};

const STATUS_CONFIG: Record<IncidentStatus, { label: string; color: string; bg: string; icon: string }> = {
  open:          { label: 'Ouvert',   color: C.open,       bg: C.open + '15',       icon: 'radio-button-on' },
  investigating: { label: 'En cours', color: C.inProgress, bg: C.inProgress + '15', icon: 'sync' },
  resolved:      { label: 'Résolu',   color: C.closed,     bg: C.closed + '15',     icon: 'checkmark-circle' },
};

const SEVERITIES: IncidentSeverity[] = ['minor', 'moderate', 'major', 'critical'];
const STATUSES: IncidentStatus[] = ['open', 'investigating', 'resolved'];

const STEPS = [
  { number: 1, title: 'Signalement', subtitle: 'Photo · Titre · Description · Gravité' },
  { number: 2, title: 'Localisation', subtitle: 'Lieu · Bâtiment · Date · Témoins' },
  { number: 3, title: 'Traitement', subtitle: 'Statut · Actions · Confirmation' },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <View style={si.wrap}>
      {STEPS.map((step, idx) => {
        const done = current > step.number;
        const active = current === step.number;
        return (
          <View key={step.number} style={si.stepWrap}>
            <View style={[si.circle, active && si.circleActive, done && si.circleDone]}>
              {done
                ? <Ionicons name="checkmark" size={13} color="#fff" />
                : <Text style={[si.circleText, active && si.circleTextActive]}>{step.number}</Text>
              }
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={[si.stepTitle, active && si.stepTitleActive, done && si.stepTitleDone]}
                numberOfLines={1}
              >
                {step.title}
              </Text>
              {active && (
                <Text style={si.stepSub} numberOfLines={2}>{step.subtitle}</Text>
              )}
            </View>
            {idx < STEPS.length - 1 && (
              <View style={[si.connector, done && si.connectorDone]} />
            )}
          </View>
        );
      })}
    </View>
  );
}

export default function NewIncidentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, permissions } = useAuth();
  const { addIncident } = useIncidents();
  const { activeChantierId, chantiers } = useApp();
  const params = useLocalSearchParams<{ description?: string }>();

  const activeChantier = chantiers.find(c => c.id === activeChantierId);

  const [step, setStep] = useState(1);

  // Étape 1
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(params.description ?? '');
  const [severity, setSeverity] = useState<IncidentSeverity>('moderate');
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);

  // Étape 2
  const [location, setLocation] = useState('');
  const [building, setBuilding] = useState('');
  const [level, setLevel] = useState('');
  const [zone, setZone] = useState('');
  const [reportedAt, setReportedAt] = useState(formatDateFR(new Date()));
  const [witnesses, setWitnesses] = useState('');

  // Étape 3
  const [status, setStatus] = useState<IncidentStatus>('open');
  const [actions, setActions] = useState('');
  const [saving, setSaving] = useState(false);

  const isDirty = title.trim().length > 0 || description.trim().length > 0 || location.trim().length > 0;

  if (user?.role === 'sous_traitant') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, marginBottom: 8 }}>
          Accès restreint
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginBottom: 24 }}>
          Les sous-traitants ne peuvent pas créer d'incidents de sécurité.
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: C.primaryBg, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40' }}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary }}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function handleBack() {
    if (step > 1) {
      setStep(s => s - 1);
      return;
    }
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

  function handleNext() {
    if (step === 1) {
      if (!title.trim()) { Alert.alert('Champ requis', 'Le titre est obligatoire.'); return; }
    }
    if (step === 2) {
      if (!location.trim()) { Alert.alert('Champ requis', 'Le lieu est obligatoire.'); return; }
    }
    setStep(s => s + 1);
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await addIncident({
        id: 'inc-' + genId(),
        title: title.trim(),
        description,
        severity,
        location: location.trim(),
        building,
        level,
        zone,
        reportedAt,
        reportedBy: user?.name ?? 'Inconnu',
        status,
        witnesses,
        actions,
        photoUri,
        chantierId: activeChantierId ?? undefined,
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

  const sevCfg = SEVERITY_CONFIG[severity];

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Header title="Signaler un incident" showBack onBack={handleBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Indicateur d'étapes */}
          <StepIndicator current={step} />

          {/* ────────────────── ÉTAPE 1 : Signalement ────────────────── */}
          {step === 1 && (
            <>
              {/* Photo de preuve */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons name="camera-outline" size={16} color={C.primary} />
                  <Text style={styles.cardTitle}>Photo de preuve</Text>
                  <Text style={styles.cardOptional}>Optionnel</Text>
                </View>
                {photoUri ? (
                  <View>
                    <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
                    <TouchableOpacity style={styles.removePhoto} onPress={() => setPhotoUri(undefined)}>
                      <Ionicons name="close-circle" size={16} color={C.open} />
                      <Text style={styles.removePhotoText}>Retirer la photo</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.photoRow}>
                    <TouchableOpacity style={[styles.photoBtn, { flex: 1 }]} onPress={handleCamera}>
                      <Ionicons name="camera" size={18} color={C.primary} />
                      <Text style={styles.photoBtnText}>Caméra</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.photoBtn, { flex: 1 }]} onPress={handlePickPhoto}>
                      <Ionicons name="images-outline" size={18} color={C.inProgress} />
                      <Text style={[styles.photoBtnText, { color: C.inProgress }]}>Galerie</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Titre + Description */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons name="create-outline" size={16} color={C.primary} />
                  <Text style={styles.cardTitle}>Informations</Text>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Titre <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    value={title}
                    onChangeText={setTitle}
                    placeholder="Ex : Chute de matériaux, fuite d'eau..."
                    placeholderTextColor={C.textMuted}
                    autoFocus
                  />
                </View>

                <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
                  <Text style={styles.label}>Description</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Décrivez les circonstances de l'incident..."
                    placeholderTextColor={C.textMuted}
                    multiline
                    numberOfLines={4}
                  />
                </View>
              </View>

              {/* Gravité */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons name="warning-outline" size={16} color={C.primary} />
                  <Text style={styles.cardTitle}>Gravité</Text>
                </View>

                <View style={styles.severityGrid}>
                  <View style={styles.severityRow}>
                    {(['minor', 'moderate'] as IncidentSeverity[]).map(s => {
                      const cfg = SEVERITY_CONFIG[s];
                      const active = severity === s;
                      return (
                        <TouchableOpacity
                          key={s}
                          style={[styles.severityChip, active && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                          onPress={() => setSeverity(s)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name={cfg.icon as any} size={18} color={active ? cfg.color : C.textMuted} />
                          <Text style={[styles.severityLabel, active && { color: cfg.color, fontFamily: 'Inter_700Bold' }]}>
                            {cfg.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <View style={styles.severityRow}>
                    {(['major', 'critical'] as IncidentSeverity[]).map(s => {
                      const cfg = SEVERITY_CONFIG[s];
                      const active = severity === s;
                      return (
                        <TouchableOpacity
                          key={s}
                          style={[styles.severityChip, active && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                          onPress={() => setSeverity(s)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name={cfg.icon as any} size={18} color={active ? cfg.color : C.textMuted} />
                          <Text style={[styles.severityLabel, active && { color: cfg.color, fontFamily: 'Inter_700Bold' }]}>
                            {cfg.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={[styles.severityHint, { backgroundColor: sevCfg.bg, borderColor: sevCfg.color + '40' }]}>
                  <Ionicons name={sevCfg.icon as any} size={14} color={sevCfg.color} />
                  <Text style={[styles.severityHintText, { color: sevCfg.color }]}>{sevCfg.hint}</Text>
                </View>
              </View>
            </>
          )}

          {/* ────────────────── ÉTAPE 2 : Localisation ────────────────── */}
          {step === 2 && (
            <>
              {/* Lieu + Bâtiment */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons name="location-outline" size={16} color={C.primary} />
                  <Text style={styles.cardTitle}>Lieu de l'incident</Text>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Description du lieu <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    value={location}
                    onChangeText={setLocation}
                    placeholder="Ex : Échafaudage Est, Niveau R+2, Zone béton..."
                    placeholderTextColor={C.textMuted}
                    autoFocus
                  />
                </View>

                {(activeChantier?.buildings?.length ?? 0) > 0 && (
                  <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
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
                  </View>
                )}
              </View>

              {/* Date + Témoins */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons name="calendar-outline" size={16} color={C.primary} />
                  <Text style={styles.cardTitle}>Date et témoins</Text>
                </View>

                <View style={styles.fieldGroup}>
                  <DateInput
                    label="Date de l'incident"
                    value={reportedAt}
                    onChange={setReportedAt}
                    optional
                  />
                </View>

                <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
                  <Text style={styles.label}>Témoins</Text>
                  <TextInput
                    style={styles.input}
                    value={witnesses}
                    onChangeText={setWitnesses}
                    placeholder="Noms des témoins présents (optionnel)"
                    placeholderTextColor={C.textMuted}
                  />
                  <Text style={styles.fieldHint}>Séparez plusieurs noms par une virgule</Text>
                </View>
              </View>

              {/* Récap étape 1 */}
              <View style={styles.recapCard}>
                <View style={styles.cardHeader}>
                  <Ionicons name="checkmark-circle-outline" size={14} color={C.closed} />
                  <Text style={[styles.cardTitle, { fontSize: 12, color: C.closed }]}>Signalement</Text>
                </View>
                <Text style={styles.recapTitle}>{title}</Text>
                <View style={styles.recapRow}>
                  <View style={[styles.recapBadge, { backgroundColor: SEVERITY_CONFIG[severity].bg, borderColor: SEVERITY_CONFIG[severity].color + '40' }]}>
                    <Ionicons name={SEVERITY_CONFIG[severity].icon as any} size={11} color={SEVERITY_CONFIG[severity].color} />
                    <Text style={[styles.recapBadgeText, { color: SEVERITY_CONFIG[severity].color }]}>
                      {SEVERITY_CONFIG[severity].label}
                    </Text>
                  </View>
                  {photoUri && (
                    <View style={[styles.recapBadge, { backgroundColor: C.primaryBg, borderColor: C.primary + '30' }]}>
                      <Ionicons name="image-outline" size={11} color={C.primary} />
                      <Text style={[styles.recapBadgeText, { color: C.primary }]}>Photo</Text>
                    </View>
                  )}
                </View>
              </View>
            </>
          )}

          {/* ────────────────── ÉTAPE 3 : Traitement ────────────────── */}
          {step === 3 && (
            <>
              {/* Statut */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons name="flag-outline" size={16} color={C.primary} />
                  <Text style={styles.cardTitle}>Statut initial</Text>
                </View>

                <View style={styles.statusGrid}>
                  {STATUSES.map(s => {
                    const cfg = STATUS_CONFIG[s];
                    const active = status === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        style={[styles.statusChip, active && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                        onPress={() => setStatus(s)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name={cfg.icon as any} size={16} color={active ? cfg.color : C.textMuted} />
                        <Text style={[styles.statusLabel, active && { color: cfg.color, fontFamily: 'Inter_700Bold' }]}>
                          {cfg.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Actions correctives */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons name="build-outline" size={16} color={C.primary} />
                  <Text style={styles.cardTitle}>Actions correctives</Text>
                  <Text style={styles.cardOptional}>Optionnel</Text>
                </View>

                <TextInput
                  style={[styles.input, styles.textArea, { minHeight: 100 }]}
                  value={actions}
                  onChangeText={setActions}
                  placeholder="Mesures prises ou planifiées pour résoudre l'incident..."
                  placeholderTextColor={C.textMuted}
                  multiline
                  numberOfLines={5}
                />
              </View>

              {/* Récapitulatif complet */}
              <View style={styles.recapCard}>
                <View style={styles.cardHeader}>
                  <Ionicons name="document-text-outline" size={14} color={C.primary} />
                  <Text style={[styles.cardTitle, { fontSize: 12, color: C.primary }]}>Récapitulatif</Text>
                </View>

                <Text style={styles.recapTitle}>{title}</Text>
                {description.trim() ? (
                  <Text style={styles.recapDesc} numberOfLines={2}>{description}</Text>
                ) : null}

                <View style={styles.recapRow}>
                  <View style={[styles.recapBadge, { backgroundColor: SEVERITY_CONFIG[severity].bg, borderColor: SEVERITY_CONFIG[severity].color + '40' }]}>
                    <Ionicons name={SEVERITY_CONFIG[severity].icon as any} size={11} color={SEVERITY_CONFIG[severity].color} />
                    <Text style={[styles.recapBadgeText, { color: SEVERITY_CONFIG[severity].color }]}>{SEVERITY_CONFIG[severity].label}</Text>
                  </View>
                  <View style={[styles.recapBadge, { backgroundColor: STATUS_CONFIG[status].bg, borderColor: STATUS_CONFIG[status].color + '40' }]}>
                    <Ionicons name={STATUS_CONFIG[status].icon as any} size={11} color={STATUS_CONFIG[status].color} />
                    <Text style={[styles.recapBadgeText, { color: STATUS_CONFIG[status].color }]}>{STATUS_CONFIG[status].label}</Text>
                  </View>
                </View>

                <View style={styles.recapMeta}>
                  <View style={styles.recapMetaRow}>
                    <Ionicons name="location-outline" size={12} color={C.textMuted} />
                    <Text style={styles.recapMetaText}>
                      {[location, building, level, zone].filter(Boolean).join(' · ') || '—'}
                    </Text>
                  </View>
                  <View style={styles.recapMetaRow}>
                    <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
                    <Text style={styles.recapMetaText}>{reportedAt}</Text>
                  </View>
                  {witnesses.trim() ? (
                    <View style={styles.recapMetaRow}>
                      <Ionicons name="people-outline" size={12} color={C.textMuted} />
                      <Text style={styles.recapMetaText}>{witnesses}</Text>
                    </View>
                  ) : null}
                  {photoUri ? (
                    <View style={styles.recapMetaRow}>
                      <Ionicons name="image-outline" size={12} color={C.textMuted} />
                      <Text style={styles.recapMetaText}>Photo jointe</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </>
          )}

          {/* ────────────────── Navigation ────────────────── */}
          <View style={styles.navRow}>
            {step > 1 && (
              <TouchableOpacity style={styles.backBtn} onPress={() => setStep(s => s - 1)}>
                <Ionicons name="chevron-back" size={16} color={C.textSub} />
                <Text style={styles.backBtnText}>Précédent</Text>
              </TouchableOpacity>
            )}

            <View style={{ flex: 1 }} />

            {step < 3 ? (
              <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
                <Text style={styles.nextBtnText}>Suivant</Text>
                <Ionicons name="chevron-forward" size={16} color="#fff" />
              </TouchableOpacity>
            ) : saving ? (
              <ActivityIndicator size="small" color={C.primary} style={{ paddingHorizontal: 32 }} />
            ) : (
              <TouchableOpacity style={styles.submitBtn} onPress={handleSave}>
                <Ionicons name="warning-outline" size={16} color="#fff" />
                <Text style={styles.submitBtnText}>Signaler l'incident</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const si = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginHorizontal: 8, marginTop: 12, marginBottom: 8,
  },
  stepWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    position: 'relative', minWidth: 0,
  },
  circle: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 2, borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  circleActive: { borderColor: C.primary, backgroundColor: C.primary },
  circleDone:   { borderColor: C.closed,  backgroundColor: C.closed },
  circleText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.textMuted },
  circleTextActive: { color: '#fff' },
  stepTitle: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold',
    color: C.textMuted, marginTop: 4,
  },
  stepTitleActive: { color: C.primary },
  stepTitleDone:   { color: C.closed },
  stepSub: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  connector: {
    position: 'absolute', top: 13,
    right: -4, width: 8, height: 2,
    backgroundColor: C.border,
  },
  connectorDone: { backgroundColor: C.closed },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 16, paddingTop: 4 },

  card: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  cardTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text, flex: 1 },
  cardOptional: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },

  fieldGroup: { marginBottom: 14 },
  label: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6,
  },
  required: { color: C.open },
  input: {
    backgroundColor: C.inputBg, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  fieldHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4 },

  photoPreview: { width: '100%', height: 180, borderRadius: 10, marginBottom: 10 },
  removePhoto: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  removePhotoText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.open },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
    backgroundColor: C.primaryBg, borderRadius: 10,
    borderWidth: 1, borderColor: C.primary + '40',
  },
  photoBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },

  severityGrid: { gap: 8, marginBottom: 12 },
  severityRow: { flexDirection: 'row', gap: 8 },
  severityChip: {
    flex: 1,
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    backgroundColor: C.surface,
  },
  severityLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  severityHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 10, borderRadius: 8, borderWidth: 1,
  },
  severityHintText: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },

  statusGrid: { flexDirection: 'row', gap: 8 },
  statusChip: {
    flex: 1, flexDirection: 'column', alignItems: 'center', gap: 4,
    paddingVertical: 14, paddingHorizontal: 6,
    borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    backgroundColor: C.surface,
  },
  statusLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },

  recapCard: {
    backgroundColor: C.primaryBg, borderRadius: 14,
    borderWidth: 1, borderColor: C.primary + '20',
    padding: 14, marginBottom: 12,
  },
  recapTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 8 },
  recapDesc:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 8 },
  recapRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  recapBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1,
  },
  recapBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  recapMeta: { gap: 4 },
  recapMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recapMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },

  navRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 4, marginBottom: 8, gap: 10,
  },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface,
  },
  backBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 14, paddingHorizontal: 24,
    borderRadius: 12, backgroundColor: C.primary,
  },
  nextBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 20,
    borderRadius: 12, backgroundColor: C.open,
  },
  submitBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
});
