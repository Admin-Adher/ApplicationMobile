import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Modal, ActivityIndicator, Image, Platform, RefreshControl, KeyboardAvoidingView,
  Animated, PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useIncidents } from '@/context/IncidentsContext';
import { useApp } from '@/context/AppContext';
import { Incident, IncidentSeverity, IncidentStatus } from '@/constants/types';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import SkeletonCard from '@/components/SkeletonCard';
import LocationPicker from '@/components/LocationPicker';
import { genId, formatDateFR } from '@/lib/utils';

const SEVERITY_CONFIG: Record<IncidentSeverity, { label: string; color: string; bg: string; icon: string }> = {
  minor:    { label: 'Mineur',   color: '#6B7280', bg: '#F3F4F6', icon: 'information-circle' },
  moderate: { label: 'Modéré',  color: '#F59E0B', bg: '#FFFBEB', icon: 'warning' },
  major:    { label: 'Majeur',   color: '#EF4444', bg: '#FEF2F2', icon: 'alert-circle' },
  critical: { label: 'Critique', color: '#7F1D1D', bg: '#FEE2E2', icon: 'nuclear' },
};

const STATUS_CONFIG: Record<IncidentStatus, { label: string; color: string; bg: string }> = {
  open:          { label: 'Ouvert',        color: C.open,       bg: C.open + '15'       },
  investigating: { label: 'En cours',      color: C.inProgress, bg: C.inProgress + '15' },
  resolved:      { label: 'Résolu',        color: C.closed,     bg: C.closed + '15'     },
};

const SEVERITIES: IncidentSeverity[] = ['minor', 'moderate', 'major', 'critical'];
const STATUSES: IncidentStatus[] = ['open', 'investigating', 'resolved'];

function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Ionicons name={cfg.icon as any} size={11} color={cfg.color} />
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: IncidentStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const EMPTY_FORM: Omit<Incident, 'id' | 'reportedBy'> = {
  title: '',
  description: '',
  severity: 'moderate',
  location: '',
  building: '',
  reportedAt: formatDateFR(new Date()),
  status: 'open',
  witnesses: '',
  actions: '',
  photoUri: undefined,
};

type FilterSeverity = IncidentSeverity | 'all';
type FilterStatus = IncidentStatus | 'all';

export default function IncidentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, permissions } = useAuth();
  const { incidents, isLoading, addIncident, updateIncident, deleteIncident } = useIncidents();
  const { reload, activeChantierId, chantiers } = useApp();
  const activeChantier = chantiers.find(c => c.id === activeChantierId);

  const [search, setSearch] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<FilterSeverity>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.resolve(reload()); } finally { setRefreshing(false); }
  }, [reload]);

  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<Incident | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);

  const [form, setForm] = useState(EMPTY_FORM);

  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const scrollOffsetRef = useRef(0);

  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        const isSwipingDown = g.dy > 8 && g.dy > Math.abs(g.dx);
        const isAtTop = scrollOffsetRef.current <= 0;
        return isSwipingDown && isAtTop;
      },
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) sheetTranslateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 100 || g.vy > 0.5) {
          Animated.timing(sheetTranslateY, { toValue: 700, duration: 220, useNativeDriver: true }).start(() => {
            setModalMode(null);
            sheetTranslateY.setValue(0);
          });
        } else {
          Animated.spring(sheetTranslateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(sheetTranslateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      },
    })
  ).current;

  useEffect(() => {
    if (modalMode) sheetTranslateY.setValue(0);
  }, [modalMode]);

  const params = useLocalSearchParams<{ openCreate?: string; prefillDescription?: string }>();

  function openAdd(prefillDescription?: string) {
    setForm({ ...EMPTY_FORM, reportedAt: formatDateFR(new Date()), description: prefillDescription ?? '' });
    setPhotoUri(undefined);
    setEditTarget(null);
    setModalMode('add');
  }

  useEffect(() => {
    if (params.openCreate === '1') {
      openAdd(params.prefillDescription ?? '');
    }
  }, []);

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

  const filtered = useMemo(() => {
    return incidents.filter(i => {
      if (filterSeverity !== 'all' && i.severity !== filterSeverity) return false;
      if (filterStatus !== 'all' && i.status !== filterStatus) return false;
      if (search && !i.title.toLowerCase().includes(search.toLowerCase()) &&
          !i.location.toLowerCase().includes(search.toLowerCase()) &&
          !i.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }).sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  }, [incidents, filterSeverity, filterStatus, search]);

  const openCount = incidents.filter(i => i.status !== 'resolved').length;

  function openEdit(i: Incident) {
    setForm({
      title: i.title,
      description: i.description,
      severity: i.severity,
      location: i.location,
      building: i.building,
      reportedAt: i.reportedAt,
      status: i.status,
      witnesses: i.witnesses,
      actions: i.actions,
      photoUri: i.photoUri,
    });
    setPhotoUri(i.photoUri);
    setEditTarget(i);
    setModalMode('edit');
  }

  async function handleSave() {
    if (!form.title.trim()) {
      Alert.alert('Champ requis', 'Le titre est obligatoire.');
      return;
    }
    if (!form.location.trim()) {
      Alert.alert('Champ requis', 'Le lieu est obligatoire.');
      return;
    }
    setSaving(true);
    const isNowResolved = form.status === 'resolved';
    const wasResolved = editTarget?.status === 'resolved';
    const closedAt = isNowResolved ? (wasResolved ? editTarget?.closedAt : formatDateFR(new Date())) : undefined;
    const closedBy = isNowResolved ? (wasResolved ? editTarget?.closedBy : user?.name ?? 'Inconnu') : undefined;

    if (modalMode === 'edit' && editTarget) {
      await updateIncident({ ...editTarget, ...form, photoUri, closedAt, closedBy });
    } else {
      await addIncident({
        id: 'inc-' + genId(),
        ...form,
        reportedBy: user?.name ?? 'Inconnu',
        photoUri,
        closedAt,
        closedBy,
      });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSaving(false);
    setModalMode(null);
  }

  function handleDelete(i: Incident) {
    Alert.alert(
      'Supprimer l\'incident',
      `Supprimer "${i.title}" définitivement ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive', onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            deleteIncident(i.id);
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <Header
        title="Sécurité & Incidents"
        subtitle={`${openCount} non résolu${openCount !== 1 ? 's' : ''}`}
        showBack
      />

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={15} color={C.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher un incident..."
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={15} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filtersWrap}>
        <View style={styles.filterRowLabeled}>
          <Text style={styles.filterRowLabel}>Statut</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={styles.filterChips}>
              <TouchableOpacity
                style={[styles.fChip, filterStatus === 'all' && styles.fChipActive]}
                onPress={() => setFilterStatus('all')}
              >
                <Text style={[styles.fChipText, filterStatus === 'all' && styles.fChipTextActive]}>Tous</Text>
              </TouchableOpacity>
              {STATUSES.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.fChip, filterStatus === s && { borderColor: STATUS_CONFIG[s].color, backgroundColor: STATUS_CONFIG[s].bg }]}
                  onPress={() => setFilterStatus(prev => prev === s ? 'all' : s)}
                >
                  <Text style={[styles.fChipText, filterStatus === s && { color: STATUS_CONFIG[s].color }]}>
                    {STATUS_CONFIG[s].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
        <View style={styles.filterRowLabeled}>
          <Text style={styles.filterRowLabel}>Gravité</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={styles.filterChips}>
              <TouchableOpacity
                style={[styles.fChip, filterSeverity === 'all' && styles.fChipActive]}
                onPress={() => setFilterSeverity('all')}
              >
                <Text style={[styles.fChipText, filterSeverity === 'all' && styles.fChipTextActive]}>Tous</Text>
              </TouchableOpacity>
              {SEVERITIES.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.fChip, filterSeverity === s && { borderColor: SEVERITY_CONFIG[s].color, backgroundColor: SEVERITY_CONFIG[s].bg }]}
                  onPress={() => setFilterSeverity(prev => prev === s ? 'all' : s)}
                >
                  <Ionicons name={SEVERITY_CONFIG[s].icon as any} size={12} color={SEVERITY_CONFIG[s].color} />
                  <Text style={[styles.fChipText, filterSeverity === s && { color: SEVERITY_CONFIG[s].color }]}>
                    {SEVERITY_CONFIG[s].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        {isLoading ? (
          [0, 1, 2, 3].map(i => <SkeletonCard key={i} />)
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={48} color={C.closed} />
            <Text style={styles.emptyTitle}>Aucun incident</Text>
            <Text style={styles.emptyText}>
              {incidents.length === 0
                ? 'Aucun incident signalé sur ce chantier.'
                : 'Aucun incident ne correspond aux filtres sélectionnés.'}
            </Text>
          </View>
        ) : (
          filtered.map(incident => {
            const scfg = SEVERITY_CONFIG[incident.severity];
            return (
              <TouchableOpacity
                key={incident.id}
                style={[styles.incCard, { borderLeftColor: scfg.color }]}
                onPress={() => openEdit(incident)}
                activeOpacity={0.8}
              >
                <View style={styles.incHeader}>
                  <View style={styles.incBadges}>
                    <SeverityBadge severity={incident.severity} />
                    <StatusBadge status={incident.status} />
                  </View>
                  {permissions.canDelete && (
                    <TouchableOpacity
                      onPress={() => handleDelete(incident)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={16} color={C.open} />
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.incTitle}>{incident.title}</Text>
                <Text style={styles.incDesc} numberOfLines={2}>{incident.description}</Text>
                <View style={styles.incMeta}>
                  <View style={styles.incMetaItem}>
                    <Ionicons name="location-outline" size={12} color={C.textMuted} />
                    <Text style={styles.incMetaText}>Bât. {incident.building} — {incident.location}</Text>
                  </View>
                  <View style={styles.incMetaItem}>
                    <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
                    <Text style={styles.incMetaText}>{incident.reportedAt}</Text>
                  </View>
                  <View style={styles.incMetaItem}>
                    <Ionicons name="person-outline" size={12} color={C.textMuted} />
                    <Text style={styles.incMetaText}>{incident.reportedBy}</Text>
                  </View>
                </View>
                {incident.actions ? (
                  <View style={styles.actionsRow}>
                    <Ionicons name="checkmark-circle-outline" size={12} color={C.inProgress} />
                    <Text style={styles.actionsText} numberOfLines={1}>{incident.actions}</Text>
                  </View>
                ) : null}
                {incident.photoUri ? (
                  <Image source={{ uri: incident.photoUri }} style={styles.cardPhoto} resizeMode="cover" />
                ) : null}
                {incident.status === 'resolved' && incident.closedAt ? (
                  <View style={styles.closedBanner}>
                    <Ionicons name="checkmark-circle" size={12} color={C.closed} />
                    <Text style={styles.closedText}>Résolu le {incident.closedAt}{incident.closedBy ? ` par ${incident.closedBy}` : ''}</Text>
                  </View>
                ) : null}
                {(incident.severity === 'major' || incident.severity === 'critical') && permissions.canCreate ? (
                  <TouchableOpacity
                    style={styles.createReserveBtn}
                    onPress={e => {
                      e.stopPropagation?.();
                      router.push({
                        pathname: '/reserve/new',
                        params: {
                          prefill_description: `Issu d'un incident : ${incident.title}. ${incident.description}`,
                          prefill_source: `Incident ${incident.severity === 'critical' ? 'critique' : 'majeur'} — ${incident.reportedAt}`,
                          building: incident.building,
                        },
                      } as any);
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="alert-circle-outline" size={13} color={C.open} />
                    <Text style={styles.createReserveBtnText}>Créer une réserve</Text>
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal
        visible={!!modalMode}
        transparent
        animationType="slide"
        onRequestClose={() => setModalMode(null)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.overlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setModalMode(null)} />
          <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20), transform: [{ translateY: sheetTranslateY }] }]} {...sheetPanResponder.panHandlers}>
            <View style={styles.sheetHandleHitArea}>
              <View style={styles.sheetHandle} />
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              bounces={true}
              scrollEventThrottle={16}
              onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
            >
              <Text style={styles.sheetTitle}>
                {modalMode === 'edit' ? 'Modifier l\'incident' : 'Signaler un incident'}
              </Text>

              <Text style={styles.fieldLabel}>Titre *</Text>
              <TextInput
                style={styles.fieldInput}
                value={form.title}
                onChangeText={v => setForm(f => ({ ...f, title: v }))}
                placeholder="Ex : Chute de matériaux"
                placeholderTextColor={C.textMuted}
              />

              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                style={[styles.fieldInput, styles.textArea]}
                value={form.description}
                onChangeText={v => setForm(f => ({ ...f, description: v }))}
                placeholder="Décrivez les circonstances..."
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={3}
              />

              <Text style={styles.fieldLabel}>Lieu *</Text>
              <TextInput
                style={styles.fieldInput}
                value={form.location}
                onChangeText={v => setForm(f => ({ ...f, location: v }))}
                placeholder="Ex : Échafaudage Est, Niveau R+2"
                placeholderTextColor={C.textMuted}
              />

              <Text style={styles.fieldLabel}>Bâtiment</Text>
              <LocationPicker
                buildings={activeChantier?.buildings ?? []}
                building={form.building ?? ''}
                onBuildingChange={b => setForm(f => ({ ...f, building: b }))}
                showLevel={false}
                showZone={false}
              />

              <Text style={styles.fieldLabel}>Gravité</Text>
              <View style={styles.chipRow}>
                {SEVERITIES.map(s => {
                  const cfg = SEVERITY_CONFIG[s];
                  const active = form.severity === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[styles.chip, active && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                      onPress={() => setForm(f => ({ ...f, severity: s }))}
                    >
                      <Ionicons name={cfg.icon as any} size={12} color={active ? cfg.color : C.textMuted} />
                      <Text style={[styles.chipText, active && { color: cfg.color }]}>{cfg.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Statut</Text>
              <View style={styles.chipRow}>
                {STATUSES.map(s => {
                  const cfg = STATUS_CONFIG[s];
                  const active = form.status === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[styles.chip, active && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                      onPress={() => setForm(f => ({ ...f, status: s }))}
                    >
                      <Text style={[styles.chipText, active && { color: cfg.color }]}>{cfg.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ marginTop: 4, marginBottom: 4 }}>
                <DateInput
                  label="Date de l'incident"
                  value={form.reportedAt}
                  onChange={v => setForm(f => ({ ...f, reportedAt: v }))}
                  optional
                />
              </View>

              <Text style={styles.fieldLabel}>Témoins</Text>
              <TextInput
                style={styles.fieldInput}
                value={form.witnesses}
                onChangeText={v => setForm(f => ({ ...f, witnesses: v }))}
                placeholder="Noms des témoins (optionnel)"
                placeholderTextColor={C.textMuted}
              />

              <Text style={styles.fieldLabel}>Actions correctives</Text>
              <TextInput
                style={[styles.fieldInput, styles.textArea]}
                value={form.actions}
                onChangeText={v => setForm(f => ({ ...f, actions: v }))}
                placeholder="Mesures prises ou planifiées..."
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={3}
              />

              <Text style={styles.fieldLabel}>Photo de preuve</Text>
              {photoUri ? (
                <View style={styles.photoPreviewWrap}>
                  <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
                  <TouchableOpacity style={styles.removePhotoBtn} onPress={() => setPhotoUri(undefined)}>
                    <Ionicons name="close-circle" size={20} color={C.open} />
                    <Text style={styles.removePhotoText}>Retirer</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.photoPickerRow}>
                  <TouchableOpacity style={styles.photoPickerBtn} onPress={handlePickPhoto}>
                    <Ionicons name="images-outline" size={18} color={C.primary} />
                    <Text style={styles.photoPickerText}>Galerie</Text>
                  </TouchableOpacity>
                  {Platform.OS !== 'web' && (
                    <TouchableOpacity style={styles.photoPickerBtn} onPress={handleCamera}>
                      <Ionicons name="camera-outline" size={18} color={C.primary} />
                      <Text style={styles.photoPickerText}>Caméra</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {saving ? (
                <ActivityIndicator size="large" color={C.primary} style={{ marginVertical: 16 }} />
              ) : (
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                  <Text style={styles.saveBtnText}>
                    {modalMode === 'edit' ? 'Enregistrer' : 'Signaler l\'incident'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalMode(null)}>
                <Text style={styles.cancelBtnText}>Annuler</Text>
              </TouchableOpacity>
              <View style={{ height: 20 }} />
            </ScrollView>
          </Animated.View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {permissions.canCreate && (
        <TouchableOpacity style={[styles.fab, { bottom: Platform.OS === 'web' ? 100 : insets.bottom + 24 }]} onPress={openAdd}>
          <Ionicons name="warning-outline" size={22} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    backgroundColor: C.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },

  filtersWrap: { borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 6 },
  filterRowLabeled: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  filterRowLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, minWidth: 56, textTransform: 'uppercase', letterSpacing: 0.3 },
  filterChips: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  fChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  fChipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  fChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  fChipTextActive: { color: C.primary },

  list: { paddingHorizontal: 16, paddingTop: 4 },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', maxWidth: 280 },

  incCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 4,
  },
  incHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  incBadges: { flexDirection: 'row', gap: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  incTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  incDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18, marginBottom: 8 },
  incMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  incMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  incMetaText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: C.inProgress + '12', borderRadius: 8, padding: 8 },
  actionsText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '90%', width: '100%', maxWidth: 640,
  },
  sheetHandleHitArea: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 10, marginBottom: 4 },
  sheetHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2 },
  sheetTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 16 },

  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, marginTop: 12 },
  fieldInput: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  chipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  chipTextActive: { color: C.primary },

  saveBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  cancelBtn: { alignItems: 'center', paddingVertical: 14 },
  cancelBtnText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },

  cardPhoto: { width: '100%', height: 140, borderRadius: 8, marginTop: 8 },
  closedBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: C.closed + '12', borderRadius: 8, padding: 8 },
  closedText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.closed },

  photoPreviewWrap: { marginTop: 4, marginBottom: 8 },
  photoPreview: { width: '100%', height: 160, borderRadius: 10, marginBottom: 6 },
  removePhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  createReserveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: C.open + '12', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: C.open + '30' },
  createReserveBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.open },
  removePhotoText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.open },
  photoPickerRow: { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 8 },
  photoPickerBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, backgroundColor: C.primaryBg, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40' },
  photoPickerText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },

  fab: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 100 : 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.open,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0px 4px 16px rgba(239,68,68,0.35)' } as any,
      default: { shadowColor: '#EF4444', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 8 },
    }),
  },
});
