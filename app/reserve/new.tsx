import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, Platform, Image, ActivityIndicator, KeyboardAvoidingView, Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useMemo, useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { ChantierBuilding, Reserve, ReserveKind, ReservePriority, ReserveStatus, ReservePhoto } from '@/constants/types';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import BottomSheetPicker from '@/components/BottomSheetPicker';
import CompanySelector from '@/components/CompanySelector';
import DictationTextInput from '@/components/DictationTextInput';
import { notifyReserveCreated } from '@/lib/email/notifyReserveCreated';
import { uploadPhoto, persistLocalPhoto } from '@/lib/storage';
import { genId, nowTimestampFR } from '@/lib/utils';
import {
  RESERVE_PRIORITIES, RESERVE_TEMPLATES,
  genReserveId, validateDeadline,
} from '@/lib/reserveUtils';
import LocationPicker from '@/components/LocationPicker';
import PdfPlanViewer from '@/components/PdfPlanViewer';
import { getCachedPlanUri } from '@/lib/planCache';

type DraftPin = { x: number; y: number };
const DRAFT_PIN_ID = '__draft_reserve_pin__';

function parsePlanCoord(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function isImagePlanUri(uri?: string | null): boolean {
  if (!uri) return false;
  const clean = uri.split('?')[0].split('#')[0].toLowerCase();
  return /\.(jpg|jpeg|png|webp|gif|bmp)$/.test(clean) || uri.startsWith('data:image/');
}

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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { companies, addReserve, reserves, addPhoto, activeChantierId, chantiers, sitePlans, lots, linkReserveToVisite, visites, profiles } = useApp();
  const { user, permissions } = useAuth();
  const { isOnline } = useNetwork();
  const params = useLocalSearchParams<{
    building?: string; level?: string; buildingId?: string; levelId?: string;
    planX?: string; planY?: string;
    prefill_description?: string; prefill_source?: string;
    chantierId?: string; planId?: string; visiteId?: string;
    quickPhotoUri?: string;
  }>();
  const initialDraftPin = useMemo<DraftPin | null>(() => {
    const x = parsePlanCoord(params.planX);
    const y = parsePlanCoord(params.planY);
    return x !== null && y !== null ? { x, y } : null;
  }, []);
  const initialDraftPinRef = useRef<DraftPin | null>(initialDraftPin);

  const visiteId = params.visiteId;
  const sourceVisite = visiteId ? visites.find(v => v.id === visiteId) : null;
  const effectiveChantierId = params.chantierId ?? sourceVisite?.chantierId ?? activeChantierId ?? undefined;
  const chantierPlans = sitePlans.filter(p => p.chantierId === effectiveChantierId);
  const activeChantier = chantiers.find(c => c.id === effectiveChantierId);
  const initialVisitLocation = sourceVisite?.visitedLocations?.length === 1
    ? sourceVisite.visitedLocations[0]
    : null;
  const visitCompanyNames = sourceVisite?.concernedCompanyIds
    ?.map(companyId => companies.find(c => c.id === companyId)?.name)
    .filter((name): name is string => !!name) ?? [];
  const visitCompanyKey = visitCompanyNames.join('|');

  const [kind, setKind] = useState<ReserveKind>('reserve');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(params.prefill_description ?? '');
  const [building, setBuilding] = useState(params.building ?? initialVisitLocation?.buildingName ?? sourceVisite?.building ?? '');
  const [zone, setZone] = useState(sourceVisite?.zone ?? '');
  const [level, setLevel] = useState(params.level ?? sourceVisite?.level ?? '');

  const locationFromPlan = !!(params.planId && params.building && params.level);
  const buildingLocked = locationFromPlan;
  const levelLocked = locationFromPlan;

  const [selectedCompanies, setSelectedCompanies] = useState<string[]>(visitCompanyNames.length > 0 ? visitCompanyNames : companies[0] ? [companies[0].name] : []);
  const [priority, setPriority] = useState<ReservePriority>('medium');
  const [deadline, setDeadline] = useState(sourceVisite?.reserveDeadlineDate ?? '');
  const [deadlineSuggested, setDeadlineSuggested] = useState(!!sourceVisite?.reserveDeadlineDate);
  const [lotId, setLotId] = useState<string>('');
  const [selectedPlanId, setSelectedPlanId] = useState<string>(
    params.planId
      ?? initialVisitLocation?.defaultPlanId
      ?? (sourceVisite?.visitedLocations?.length ? '' : sourceVisite?.defaultPlanId ?? chantierPlans[0]?.id ?? '')
  );
  const [photos, setPhotos] = useState<ReservePhoto[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [draftPin, setDraftPin] = useState<DraftPin | null>(initialDraftPin);
  const [showTemplates, setShowTemplates] = useState(false);
  const [expandedTemplateCat, setExpandedTemplateCat] = useState<string | null>(null);
  const [showLocationDetails, setShowLocationDetails] = useState(
    !(params.building || params.level || initialVisitLocation || sourceVisite?.building || sourceVisite?.level)
  );
  const sourceDefaultsAppliedRef = useRef(false);

  const visitScopedBuildings = useMemo(() => {
    if (!sourceVisite || !activeChantier?.buildings?.length) return [];
    const scopes = sourceVisite.visitedLocations ?? [];
    if (scopes.length > 0) {
      return scopes
        .map(scope =>
          activeChantier.buildings?.find(b =>
            (scope.buildingId && b.id === scope.buildingId) ||
            b.name === scope.buildingName
          ) ?? null
        )
        .filter((b): b is ChantierBuilding => !!b);
    }
    if (sourceVisite.building) {
      const legacyBuilding = activeChantier.buildings.find(b => b.name === sourceVisite.building);
      return legacyBuilding ? [legacyBuilding] : [];
    }
    return [];
  }, [sourceVisite, activeChantier?.buildings]);

  const reserveBuildingOptions = visitScopedBuildings.length > 0
    ? visitScopedBuildings
    : activeChantier?.buildings ?? [];
  const visitHasScopedBuildings = !!sourceVisite && visitScopedBuildings.length > 0;
  const visitScopedBuildingIds = useMemo(
    () => new Set(visitScopedBuildings.map(b => b.id)),
    [visitScopedBuildings]
  );
  const visitScopedBuildingNames = useMemo(
    () => new Set(visitScopedBuildings.map(b => b.name)),
    [visitScopedBuildings]
  );

  useEffect(() => {
    if (params.building || params.level || sourceVisite?.building || sourceVisite?.level) return;
    if (visitScopedBuildings.length > 1) return;
    const firstBuilding = visitScopedBuildings[0] ?? activeChantier?.buildings?.[0];
    if (firstBuilding) {
      setBuilding(firstBuilding.name);
      setLevel(firstBuilding.levels?.[0]?.name ?? '');
    }
  }, [
    activeChantier?.id,
    activeChantier?.buildings,
    params.building,
    params.level,
    sourceVisite?.building,
    sourceVisite?.level,
    visitScopedBuildings,
  ]);

  const inheritedDeadline = sourceVisite?.reserveDeadlineDate ?? '';
  const initialPin = initialDraftPinRef.current;
  const draftPinChanged = (draftPin?.x ?? null) !== (initialPin?.x ?? null) || (draftPin?.y ?? null) !== (initialPin?.y ?? null);
  const isDirty = title.trim().length > 0
    || description.trim().length > 0
    || photos.length > 0
    || draftPinChanged
    || (!!deadline && deadline !== inheritedDeadline);

  useEffect(() => {
    if (!sourceVisite || sourceDefaultsAppliedRef.current) return;
    if (!params.building && sourceVisite.building) setBuilding(sourceVisite.building);
    if (!params.building && sourceVisite.visitedLocations?.length === 1) {
      setBuilding(sourceVisite.visitedLocations[0].buildingName);
    }
    if (!params.level && sourceVisite.level) setLevel(sourceVisite.level);
    if (sourceVisite.zone) setZone(sourceVisite.zone);
    if (sourceVisite.reserveDeadlineDate) {
      setDeadline(sourceVisite.reserveDeadlineDate);
      setDeadlineSuggested(true);
    }
    if (!params.planId) {
      const planFromSingleScope = sourceVisite.visitedLocations?.length === 1
        ? sourceVisite.visitedLocations[0].defaultPlanId
        : undefined;
      if (planFromSingleScope || sourceVisite.defaultPlanId) setSelectedPlanId(planFromSingleScope ?? sourceVisite.defaultPlanId!);
    }
    if (visitCompanyNames.length > 0) setSelectedCompanies(visitCompanyNames);
    sourceDefaultsAppliedRef.current = true;
  }, [
    sourceVisite?.id,
    sourceVisite?.building,
    sourceVisite?.level,
    sourceVisite?.visitedLocations,
    sourceVisite?.zone,
    sourceVisite?.reserveDeadlineDate,
    sourceVisite?.defaultPlanId,
    visitCompanyKey,
    params.building,
    params.level,
    params.planId,
  ]);

  useEffect(() => {
    if (params.quickPhotoUri && photos.length === 0) {
      savePhoto(params.quickPhotoUri);
    }
  }, []);

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

  const selectedLot = useMemo(() => lots.find(l => l.id === lotId) ?? null, [lots, lotId]);
  const previewId = useMemo(() => genReserveId(reserves, selectedLot), [reserves, selectedLot]);

  // Resolve IDs from selected building/level names
  const selectedBuildingObj = useMemo(
    () => reserveBuildingOptions.find(b => b.name === building) ?? null,
    [reserveBuildingOptions, building]
  );
  const selectedLevelObj = useMemo(
    () => selectedBuildingObj?.levels?.find(l => l.name === level) ?? null,
    [selectedBuildingObj, level]
  );
  const locationSummary = useMemo(
    () => [building, level, zone].filter(Boolean).join(' · '),
    [building, level, zone]
  );
  const selectedPlan = useMemo(
    () => chantierPlans.find(p => p.id === selectedPlanId) ?? null,
    [chantierPlans, selectedPlanId]
  );
  const selectedPlanSupportsInlinePin = !!selectedPlan?.uri && selectedPlan.fileType !== 'dxf';
  const selectedPlanIsImage = selectedPlan?.fileType === 'image' || isImagePlanUri(selectedPlan?.uri);
  const selectedPlanPinnedReserves = useMemo(
    () => reserves.filter(r => r.planId === selectedPlanId && r.planX != null && r.planY != null),
    [reserves, selectedPlanId]
  );
  const draftPinReserve = useMemo<Reserve | null>(() => {
    if (!draftPin || !selectedPlanId) return null;
    const today = new Date().toISOString().split('T')[0];
    return {
      id: DRAFT_PIN_ID,
      kind,
      title: title.trim() || (kind === 'observation' ? 'Nouvelle observation' : 'Nouvelle réserve'),
      description: description.trim() || 'Position provisoire',
      building,
      zone,
      level,
      companies: selectedCompanies,
      company: selectedCompanies[0] ?? '',
      priority,
      status: 'open',
      createdAt: today,
      deadline: deadline || '—',
      comments: [],
      history: [],
      planX: draftPin.x,
      planY: draftPin.y,
      chantierId: effectiveChantierId,
      planId: selectedPlanId,
      buildingId: selectedBuildingObj?.id ?? params.buildingId ?? undefined,
      levelId: selectedLevelObj?.id ?? params.levelId ?? undefined,
      lotId: lotId || undefined,
      visiteId: visiteId || undefined,
    };
  }, [
    draftPin,
    selectedPlanId,
    kind,
    title,
    description,
    building,
    zone,
    level,
    selectedCompanies,
    priority,
    deadline,
    effectiveChantierId,
    selectedBuildingObj?.id,
    params.buildingId,
    selectedLevelObj?.id,
    params.levelId,
    lotId,
    visiteId,
  ]);
  const pinViewerReserves = useMemo(
    () => draftPinReserve ? [...selectedPlanPinnedReserves, draftPinReserve] : selectedPlanPinnedReserves,
    [selectedPlanPinnedReserves, draftPinReserve]
  );
  const pinViewerNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    selectedPlanPinnedReserves.forEach((r, index) => map.set(r.id, index + 1));
    map.set(DRAFT_PIN_ID, selectedPlanPinnedReserves.length + 1);
    return map;
  }, [selectedPlanPinnedReserves]);

  // Filter plans: show plans matching the selected level, plus general plans (no levelId)
  const filteredPlans = useMemo(() => {
    const scopedPlans = visitHasScopedBuildings
      ? chantierPlans.filter(p => {
        if (!p.buildingId && !p.building) return true;
        if (p.buildingId) return visitScopedBuildingIds.has(p.buildingId);
        return !!p.building && visitScopedBuildingNames.has(p.building);
      })
      : chantierPlans;
    if (visitHasScopedBuildings && !selectedBuildingObj) return [];
    if (!selectedBuildingObj || !selectedLevelObj) return scopedPlans;
    return scopedPlans.filter(p => {
      if (!p.buildingId && !p.building && !p.levelId && !p.level) return true; // general plan
      const matchesBuilding = p.buildingId
        ? p.buildingId === selectedBuildingObj.id
        : p.building === selectedBuildingObj.name;
      if (!matchesBuilding) return false;
      if (!p.levelId && !p.level) return true;
      return p.levelId
        ? p.levelId === selectedLevelObj.id
        : p.level === selectedLevelObj.name;
    });
  }, [
    chantierPlans,
    selectedBuildingObj,
    selectedLevelObj,
    visitHasScopedBuildings,
    visitScopedBuildingIds,
    visitScopedBuildingNames,
  ]);

  // When building/level changes: if selected plan no longer in filteredPlans, pick best match or clear
  useEffect(() => {
    if (locationFromPlan) return; // plan is locked from params, don't override
    if (!selectedPlanId) return;
    const stillValid = filteredPlans.some(p => p.id === selectedPlanId);
    if (!stillValid) {
      const best = filteredPlans[0]?.id ?? '';
      setSelectedPlanId(best);
      setDraftPin(null);
    }
  }, [filteredPlans]);

  useEffect(() => {
    if (locationFromPlan || selectedPlanId || filteredPlans.length === 0 || !selectedBuildingObj) return;
    const defaultFromVisit = getVisitDefaultPlanForBuilding(selectedBuildingObj.name);
    const nextPlanId = defaultFromVisit && filteredPlans.some(p => p.id === defaultFromVisit)
      ? defaultFromVisit
      : filteredPlans[0]?.id ?? '';
    if (nextPlanId) setSelectedPlanId(nextPlanId);
  }, [filteredPlans, locationFromPlan, selectedPlanId, selectedBuildingObj]);

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

  function getSuggestedDeadlineDays(p: ReservePriority): number | null {
    if (p === 'critical') return 2;
    if (p === 'high') return 7;
    if (p === 'medium') return 30;
    return null;
  }

  function handlePriorityChange(p: ReservePriority) {
    setPriority(p);
    const days = getSuggestedDeadlineDays(p);
    if (days !== null && !deadline) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      setDeadline(`${dd}/${mm}/${yyyy}`);
      setDeadlineSuggested(true);
    } else {
      setDeadlineSuggested(false);
    }
  }

  function applyTemplate(item: { title: string; description: string }) {
    setTitle(item.title);
    setDescription(item.description);
    setShowTemplates(false);
    setExpandedTemplateCat(null);
  }

  function handleLotChange(id: string) {
    setLotId(id);
    if (id) {
      const lot = lots.find(l => l.id === id);
      if (lot?.companyId) {
        const co = companies.find(c => c.id === lot.companyId);
        if (co) setSelectedCompanies([co.name]);
      }
    }
  }

  function getVisitDefaultPlanForBuilding(nextBuildingName: string): string {
    if (!sourceVisite?.visitedLocations?.length) return '';
    const b = reserveBuildingOptions.find(item => item.name === nextBuildingName);
    const scope = sourceVisite.visitedLocations.find(loc =>
      (b?.id && loc.buildingId === b.id) ||
      loc.buildingName === nextBuildingName
    );
    return scope?.defaultPlanId ?? '';
  }

  function handleBuildingChange(nextBuilding: string) {
    setBuilding(nextBuilding);
    setDraftPin(null);
    const nextDefaultPlan = getVisitDefaultPlanForBuilding(nextBuilding);
    setSelectedPlanId(nextDefaultPlan);
  }

  function handleLevelChange(nextLevel: string) {
    setLevel(nextLevel);
    setDraftPin(null);
  }

  function handlePlanChange(planId: string) {
    if (planId !== selectedPlanId) setDraftPin(null);
    setSelectedPlanId(planId);
    if (!planId || buildingLocked) return;
    const plan = chantierPlans.find(p => p.id === planId);
    if (!plan?.buildingId) return;
    const bldg = activeChantier?.buildings?.find(b => b.id === plan.buildingId);
    if (!bldg) return;
    setBuilding(bldg.name);
    if (plan.levelId) {
      const lvl = bldg.levels?.find(l => l.id === plan.levelId);
      if (lvl) setLevel(lvl.name);
    }
  }

  async function openPinPlacement() {
    if (!selectedPlanId) {
      Alert.alert('Plan requis', 'Sélectionnez un plan avant de positionner une épingle.');
      return;
    }
    const plan = chantierPlans.find(p => p.id === selectedPlanId);
    if (!plan) {
      Alert.alert('Plan introuvable', "Le plan sélectionné n'est plus disponible.");
      return;
    }
    if (!plan.uri) {
      Alert.alert(
        'Plan non importé',
        "Ce plan n'a pas encore de fichier associé. Vous pouvez créer la réserve sans épingle, puis importer le plan plus tard."
      );
      return;
    }
    if (plan.fileType === 'dxf') {
      Alert.alert(
        'Positionnement indisponible',
        "Le positionnement direct depuis ce formulaire n'est pas encore disponible sur les plans DXF. Créez la réserve sans épingle ou positionnez-la depuis l'onglet Plans."
      );
      return;
    }
    if (!isOnline && Platform.OS !== 'web' && !plan.uri.startsWith('file://') && !plan.uri.startsWith('data:')) {
      const cached = await getCachedPlanUri(plan.uri);
      if (!cached) {
        Alert.alert(
          'Plan non disponible hors connexion',
          "Ce plan n'a pas encore été téléchargé sur cet appareil. Reconnectez-vous pour l'ouvrir, ou créez la réserve sans épingle."
        );
        return;
      }
    }
    setPinModalVisible(true);
  }

  function removeDraftPin() {
    setDraftPin(null);
  }

  function toggleCompany(name: string) {
    setSelectedCompanies(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  }

  async function handlePickPhoto() {
    if (photos.length >= 6) { Alert.alert('Limite atteinte', 'Maximum 6 photos par réserve.'); return; }
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à la galerie est nécessaire."); return; }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) await savePhoto(result.assets[0].uri);
  }

  async function handleCamera() {
    if (photos.length >= 6) { Alert.alert('Limite atteinte', 'Maximum 6 photos par réserve.'); return; }
    if (Platform.OS === 'web') { Alert.alert('Info', 'La prise de photo directe est disponible sur appareil mobile.'); return; }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à l'appareil photo est nécessaire."); return; }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) await savePhoto(result.assets[0].uri);
  }

  async function savePhoto(uri: string) {
    setPhotoUploading(true);
    try {
      const filename = `reserve_photo_${Date.now()}.jpg`;
      const author = user?.name ?? 'Conducteur de travaux';
      const today = new Date().toISOString().split('T')[0];

      // Si on sait déjà être hors-ligne, on ne tente pas l'upload (le SDK
      // Supabase peut rester suspendu plusieurs dizaines de secondes avant de
      // signaler l'erreur réseau, ce qui donne l'impression que l'app est
      // cassée). On bascule directement sur la persistance locale ; la photo
      // sera ré-uploadée automatiquement par la file de sync à la reconnexion.
      let storageUrl: string | null = null;
      if (isOnline) {
        try {
          storageUrl = await uploadPhoto(uri, filename);
        } catch (uploadErr: any) {
          // Échec réseau imprévu — on persiste la photo en local.
        }
      }

      // If upload failed, copy the temp photo to persistent storage so it won't be cleared by the OS
      let finalUri = storageUrl ?? await persistLocalPhoto(uri);

      if (!storageUrl) {
        Alert.alert(
          isOnline ? 'Synchronisation différée' : 'Mode hors ligne',
          isOnline
            ? "Le serveur n'a pas répondu à temps. La photo a été sauvegardée localement et sera renvoyée plus tard."
            : "La photo a été sauvegardée localement. Elle sera synchronisée lorsque la connexion sera rétablie.",
        );
      }

      const newPhoto: ReservePhoto = {
        id: genId(),
        uri: finalUri,
        kind: 'defect',
        takenAt: today,
        takenBy: author,
      };
      setPhotos(prev => [...prev, newPhoto]);
    } catch (e: any) {
      Alert.alert('Erreur photo', `Impossible de traiter cette photo. ${e?.message ?? ''}`);
    } finally {
      setPhotoUploading(false);
    }
  }

  function removePhoto(id: string) {
    setPhotos(prev => prev.filter(p => p.id !== id));
  }

  function togglePhotoKind(id: string) {
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, kind: p.kind === 'defect' ? 'resolution' : 'defect' } : p));
  }

  function handleSubmit() {
    if (isSubmitting) return;
    if (!title.trim()) { Alert.alert('Champ obligatoire', 'Le titre est requis.'); return; }
    if (selectedCompanies.length === 0) { Alert.alert('Champ obligatoire', "Sélectionnez au moins une entreprise responsable."); return; }
    if (visitHasScopedBuildings && (!building || !building.trim())) {
      Alert.alert('Bâtiment requis', 'Choisissez le bâtiment concerné dans le périmètre de la visite.');
      return;
    }
    if (!effectiveChantierId && (!building || !building.trim())) { Alert.alert('Champ obligatoire', 'Le bâtiment est requis.'); return; }
    if (!level || !level.trim()) { Alert.alert('Champ obligatoire', 'Le niveau est requis.'); return; }
    if (deadline && !validateDeadline(deadline)) {
      Alert.alert('Date invalide', "Vérifiez que le jour, le mois et l'année sont corrects (ex : 30/04/2026).");
      return;
    }
    if (selectedPlanId && !draftPin) {
      const canPositionNow = selectedPlanSupportsInlinePin;
      Alert.alert(
        'Créer sans épingle ?',
        "Un plan est associé, mais aucune épingle n'est positionnée. Vous pouvez créer la réserve comme cela, ou la placer maintenant sur le plan.",
        [
          { text: 'Annuler', style: 'cancel' },
          ...(canPositionNow ? [{ text: 'Positionner', onPress: openPinPlacement }] : []),
          { text: 'Créer sans épingle', onPress: createReserve },
        ] as any,
      );
      return;
    }
    createReserve();
  }

  function createReserve() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const author = user?.name ?? 'Conducteur de travaux';
      const id = genReserveId(reserves, selectedLot);
      const isoToday = new Date().toISOString().split('T')[0];
      const newReserve = {
        id,
        kind,
        title: title.trim(),
        description: description.trim() || 'Aucune description fournie.',
        building,
        zone,
        level,
        companies: selectedCompanies,
        company: selectedCompanies[0] ?? '',
        priority,
        status: 'open' as ReserveStatus,
        createdAt: isoToday,
        deadline: deadline || '—',
        comments: [],
        history: [{ id: 'h0', action: kind === 'observation' ? 'Observation créée' : 'Réserve créée', author, createdAt: nowTimestampFR() }],
        planX: draftPin?.x ?? undefined,
        planY: draftPin?.y ?? undefined,
        photoUri: photos[0]?.uri ?? undefined,
        photos: photos.length > 0 ? photos : undefined,
        chantierId: effectiveChantierId,
        planId: selectedPlanId || undefined,
        buildingId: selectedBuildingObj?.id ?? params.buildingId ?? undefined,
        levelId: selectedLevelObj?.id ?? params.levelId ?? undefined,
        lotId: lotId || undefined,
        visiteId: visiteId || undefined,
      };
      addReserve(newReserve);
      if (kind !== 'observation') {
        notifyReserveCreated({
          reserve: newReserve,
          selectedCompanyNames: selectedCompanies,
          companies,
          profiles,
          chantiers,
          createdByName: author,
        });
      }
      if (visiteId) linkReserveToVisite(id, visiteId);
      photos.forEach(p => {
        addPhoto({
          id: genId(),
          comment: `Photo ${kind === 'observation' ? 'observation' : 'réserve'} ${id} — ${title.trim()}`,
          location: `Bât. ${building} - ${level}`,
          takenAt: isoToday,
          takenBy: author,
          colorCode: kind === 'observation' ? '#0EA5E9' : '#EF4444',
          uri: p.uri,
          reserveId: id,
        });
      });
      const hasPin = !!draftPin;
      Alert.alert(
        kind === 'observation' ? 'Observation créée' : 'Réserve créée',
        hasPin
          ? `${id} ajoutée avec une épingle sur le plan.`
          : `${id} ajoutée sans épingle sur le plan.`,
        [{ text: 'OK', onPress: () => { setIsSubmitting(false); router.back(); } }],
        { cancelable: false }
      );
    } catch (err) {
      setIsSubmitting(false);
      Alert.alert('Erreur', "Une erreur est survenue lors de la création. Veuillez réessayer.");
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header title={kind === 'observation' ? 'Nouvelle observation' : 'Nouvelle réserve'} showBack onBack={handleBack} rightLabel="Créer" onRightPress={handleSubmit} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {sourceVisite ? (
          <View style={styles.visiteCard}>
            <Ionicons name="eye-outline" size={14} color="#6366F1" />
            <View style={{ flex: 1 }}>
              <Text style={styles.visiteCardLabel}>Créé depuis la visite</Text>
              <Text style={styles.visiteCardTitle}>{sourceVisite.title} — {sourceVisite.date}</Text>
              <Text style={styles.visiteCardMeta}>Lieu, plan, délai et entreprises repris depuis la visite.</Text>
            </View>
          </View>
        ) : null}

        {params.prefill_source && !sourceVisite ? (
          <View style={styles.sourceCard}>
            <Ionicons name="chatbubble-outline" size={14} color={C.inProgress} />
            <Text style={styles.sourceText}>Créé depuis : {params.prefill_source}</Text>
          </View>
        ) : null}

        {/* TYPE */}
        <View style={styles.card}>
          <Text style={styles.label}>TYPE</Text>
          <View style={styles.kindRow}>
            <TouchableOpacity style={[styles.kindChip, kind === 'reserve' && styles.kindChipReserve]} onPress={() => setKind('reserve')}>
              <Ionicons name="warning-outline" size={14} color={kind === 'reserve' ? '#EF4444' : C.textSub} />
              <Text style={[styles.kindChipText, kind === 'reserve' && { color: '#EF4444', fontFamily: 'Inter_700Bold' }]}>Réserve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.kindChip, kind === 'observation' && styles.kindChipObservation]} onPress={() => setKind('observation')}>
              <Ionicons name="eye-outline" size={14} color={kind === 'observation' ? '#0EA5E9' : C.textSub} />
              <Text style={[styles.kindChipText, kind === 'observation' && { color: '#0EA5E9', fontFamily: 'Inter_700Bold' }]}>Observation</Text>
            </TouchableOpacity>
          </View>
          {kind === 'observation' && (
            <View style={styles.kindHintBox}>
              <Ionicons name="information-circle-outline" size={13} color="#0EA5E9" />
              <Text style={styles.kindHintText}>Une observation est un constat sans impact bloquant sur la réception.</Text>
            </View>
          )}
        </View>

        {/* PHOTOS — en premier pour capturer d'abord */}
        <View style={styles.card}>
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={styles.label}>Photos ({photos.length}/6)</Text>
              {photos.length > 0 && <Text style={styles.photoKindHint}>Appuyer sur une photo pour basculer Constat ↔ Levée</Text>}
            </View>

            {photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {photos.map(p => (
                    <View key={p.id} style={styles.photoThumb}>
                      <TouchableOpacity onPress={() => togglePhotoKind(p.id)} activeOpacity={0.85}>
                        <Image source={{ uri: p.uri }} style={styles.photoThumbImg} resizeMode="cover" />
                        <View style={[styles.photoKindBadge, { backgroundColor: p.kind === 'defect' ? '#EF444488' : '#22C55E88' }]}>
                          <Text style={styles.photoKindBadgeText}>{p.kind === 'defect' ? 'Constat' : 'Levée'}</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.photoRemoveBtn} onPress={() => removePhoto(p.id)}>
                        <Ionicons name="close" size={11} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}

            {photos.length < 6 && (
              <View style={styles.photoRow}>
                <TouchableOpacity style={[styles.photoBtn, styles.photoBtnPrimary, { flex: 1 }]} onPress={handleCamera} disabled={photoUploading}>
                  <View style={styles.photoIconBubble}>
                    <Ionicons name="camera" size={18} color="#fff" />
                  </View>
                  <Text style={[styles.photoBtnText, styles.photoBtnPrimaryText]}>Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.photoBtn, styles.photoBtnSecondary, { flex: 1 }]} onPress={handlePickPhoto} disabled={photoUploading}>
                  <View style={[styles.photoIconBubble, styles.photoIconBubbleSecondary]}>
                    <Ionicons name="images-outline" size={18} color={C.primary} />
                  </View>
                  <Text style={styles.photoBtnText}>Galerie</Text>
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

        {/* TEMPLATES */}
        {kind === 'reserve' && (
          <View style={styles.card}>
            <TouchableOpacity style={styles.templateHeader} onPress={() => setShowTemplates(!showTemplates)} activeOpacity={0.7}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="bookmark-outline" size={15} color={C.primary} />
                <Text style={styles.templateHeaderText}>Templates rapides</Text>
                <View style={styles.templateBadge}>
                  <Text style={styles.templateBadgeText}>{RESERVE_TEMPLATES.reduce((s, c) => s + c.items.length, 0)}</Text>
                </View>
              </View>
              <Ionicons name={showTemplates ? 'chevron-up' : 'chevron-down'} size={16} color={C.textSub} />
            </TouchableOpacity>
            {showTemplates && (
              <View style={{ marginTop: 12 }}>
                {RESERVE_TEMPLATES.map(cat => (
                  <View key={cat.category} style={{ marginBottom: 4 }}>
                    <TouchableOpacity
                      style={styles.templateCatRow}
                      onPress={() => setExpandedTemplateCat(expandedTemplateCat === cat.category ? null : cat.category)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={cat.icon as any} size={14} color={C.textSub} />
                      <Text style={styles.templateCatText}>{cat.category}</Text>
                      <Ionicons name={expandedTemplateCat === cat.category ? 'chevron-up' : 'chevron-down'} size={13} color={C.textMuted} />
                    </TouchableOpacity>
                    {expandedTemplateCat === cat.category && cat.items.map(item => (
                      <TouchableOpacity key={item.title} style={styles.templateItem} onPress={() => applyTemplate(item)} activeOpacity={0.7}>
                        <Ionicons name="arrow-forward-outline" size={12} color={C.primary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.templateItemTitle}>{item.title}</Text>
                          <Text style={styles.templateItemDesc} numberOfLines={1}>{item.description}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>
            )}
            {!showTemplates && (
              <Text style={styles.templateHint}>Choisissez un modèle pour pré-remplir titre et description</Text>
            )}
          </View>
        )}

        {/* TITRE / DESCRIPTION */}
        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={styles.label}>Titre *</Text>
              <View style={styles.idPreviewBadge}>
                <Ionicons name="pricetag-outline" size={10} color={C.textMuted} />
                <Text style={styles.idPreviewText}>Réf : {previewId}</Text>
              </View>
            </View>
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
            <DictationTextInput
              inputStyle={[styles.input, styles.textArea]}
              placeholder="Décrivez le problème en détail..."
              placeholderTextColor={C.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAssistEnabled
              textAssistContext="description"
            />
          </View>
        </View>

        {/* CORPS D'ÉTAT (LOT) */}
        {lots.length > 0 && (
          <View style={styles.card}>
            <BottomSheetPicker
              label="Corps d'état (lot)"
              options={lots.map(lot => ({
                label: `${lot.number ? `${lot.number}. ` : ''}${lot.name}`,
                value: lot.id,
                color: lot.color,
              }))}
              value={lotId}
              onChange={handleLotChange}
              allowNone
              noneLabel="Aucun lot"
            />
            {selectedLot && (
              <View style={styles.lotAutoFillHint}>
                <Ionicons name="information-circle-outline" size={12} color={C.primary} />
                <Text style={styles.lotAutoFillText}>
                  Référence automatique : <Text style={{ fontFamily: 'Inter_700Bold' }}>{previewId}</Text>
                  {selectedLot.companyId && companies.find(c => c.id === selectedLot.companyId)
                    ? ` · Entreprise auto-remplie : ${companies.find(c => c.id === selectedLot.companyId)!.shortName}`
                    : ''}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* LOCALISATION */}
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.locationHeader}
            onPress={() => setShowLocationDetails(prev => !prev)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={showLocationDetails ? 'Masquer la localisation' : 'Modifier la localisation'}
          >
            <View style={styles.locationIconBox}>
              <Ionicons name="business-outline" size={18} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.locationLabel}>Localisation</Text>
              <Text style={styles.locationSummary} numberOfLines={2}>
                {locationSummary || (visitHasScopedBuildings ? 'Choisir le bâtiment de la visite' : 'Aucune localisation définie')}
              </Text>
            </View>
            <View style={styles.locationAction}>
              <Text style={styles.locationActionText}>{showLocationDetails ? 'Masquer' : 'Modifier'}</Text>
              <Ionicons name={showLocationDetails ? 'chevron-up' : 'chevron-down'} size={15} color={C.primary} />
            </View>
          </TouchableOpacity>
          {visitHasScopedBuildings && (
            <View style={styles.visitScopeNotice}>
              <Ionicons name="map-outline" size={14} color={C.primary} />
              <Text style={styles.visitScopeNoticeText}>
                Périmètre de la visite : {visitScopedBuildings.length} bâtiment{visitScopedBuildings.length > 1 ? 's' : ''}. Les autres bâtiments du chantier sont masqués.
              </Text>
            </View>
          )}
          {showLocationDetails && (
            <View style={styles.locationPickerWrap}>
              <LocationPicker
                buildings={reserveBuildingOptions}
                building={building}
                level={level}
                zone={zone}
                onBuildingChange={handleBuildingChange}
                onLevelChange={handleLevelChange}
                onZoneChange={setZone}
                lockedBuilding={buildingLocked}
                lockedLevel={levelLocked}
              />
            </View>
          )}
        </View>

        {/* PLAN */}
        {chantierPlans.length > 0 && (
          <View style={styles.card}>
            <BottomSheetPicker
              label="Plan associé"
              options={filteredPlans.map(p => {
                const bldg = p.buildingId ? activeChantier?.buildings?.find(b => b.id === p.buildingId) : null;
                const lvl = bldg && p.levelId ? bldg.levels?.find(l => l.id === p.levelId) : null;
                return {
                  label: p.name,
                  value: p.id,
                  secondaryLabel: bldg ? [bldg.name, lvl?.name].filter(Boolean).join(' › ') : undefined,
                };
              })}
              value={selectedPlanId}
              onChange={handlePlanChange}
              allowNone
              noneLabel="Aucun plan"
            />
            {selectedLevelObj && filteredPlans.length < chantierPlans.length && (
              <View style={styles.planFilterHint}>
                <Ionicons name="filter-outline" size={12} color={C.primary} />
                <Text style={styles.planFilterHintText}>
                  {filteredPlans.length === 0
                    ? `Aucun plan pour ${level} — affichage des plans généraux`
                    : `${filteredPlans.length} plan${filteredPlans.length > 1 ? 's' : ''} pour ${building} › ${level}`}
                </Text>
                <TouchableOpacity onPress={() => { setBuilding(''); setLevel(''); }}>
                  <Text style={styles.planFilterReset}>Tout voir</Text>
                </TouchableOpacity>
              </View>
            )}
            {selectedPlanId ? (
              <View style={[styles.pinPlacementBox, draftPin && styles.pinPlacementBoxReady]}>
                <View style={styles.pinPlacementHeader}>
                  <View style={[styles.pinPlacementIcon, draftPin && styles.pinPlacementIconReady]}>
                    <Ionicons name={draftPin ? 'location' : 'location-outline'} size={16} color={draftPin ? '#fff' : C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pinPlacementTitle}>
                      {draftPin ? 'Épingle positionnée' : 'Position sur le plan'}
                    </Text>
                    <Text style={styles.pinPlacementText}>
                      {draftPin
                        ? `Coordonnées : ${draftPin.x}% / ${draftPin.y}%. Vous pouvez la déplacer avant de créer.`
                        : 'Touchez le plan pour placer la réserve exactement au bon endroit.'}
                    </Text>
                  </View>
                </View>
                <View style={styles.pinPlacementActions}>
                  <TouchableOpacity
                    style={[styles.pinPlacementBtn, styles.pinPlacementPrimary]}
                    onPress={openPinPlacement}
                    accessibilityRole="button"
                    accessibilityLabel={draftPin ? "Modifier l'épingle sur le plan" : "Positionner l'épingle sur le plan"}
                  >
                    <Ionicons name={draftPin ? 'move-outline' : 'add-circle-outline'} size={15} color="#fff" />
                    <Text style={styles.pinPlacementPrimaryText}>{draftPin ? 'Modifier' : "Positionner l'épingle"}</Text>
                  </TouchableOpacity>
                  {draftPin ? (
                    <TouchableOpacity
                      style={[styles.pinPlacementBtn, styles.pinPlacementSecondary]}
                      onPress={removeDraftPin}
                      accessibilityRole="button"
                      accessibilityLabel="Retirer l'épingle"
                    >
                      <Ionicons name="trash-outline" size={15} color={C.open} />
                      <Text style={styles.pinPlacementSecondaryText}>Retirer</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : (
              <View style={styles.pinNudge}>
                <Ionicons name="information-circle-outline" size={15} color="#B45309" />
                <Text style={styles.pinNudgeText}>
                  Sélectionnez un plan pour pouvoir positionner une épingle. La réserve peut aussi être créée sans plan.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ENTREPRISES */}
        <View style={styles.card}>
          <Text style={styles.label}>Entreprises responsables *</Text>
          <CompanySelector
            mode="multi"
            identifier="name"
            companies={companies}
            value={selectedCompanies}
            onChange={setSelectedCompanies}
            emptyText="Aucune entreprise configurée. Ajoutez d'abord une entreprise dans l'onglet Équipes."
          />
          {selectedCompanies.length > 1 && (
            <View style={styles.multiCompanyHint}>
              <Ionicons name="information-circle-outline" size={12} color={C.primary} />
              <Text style={styles.multiCompanyHintText}>
                {selectedCompanies.length} entreprises sélectionnées — toutes seront notifiées.
              </Text>
            </View>
          )}
        </View>

        {/* SUIVI */}
        <View style={styles.card}>
          <View style={styles.followUpHeader}>
            <Text style={styles.label}>Suivi</Text>
            {deadline ? <Text style={styles.followUpMeta}>Échéance {deadline}</Text> : null}
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Priorité</Text>
            <View style={styles.chipRow}>
              {RESERVE_PRIORITIES.map(p => (
                <TouchableOpacity
                  key={p.value}
                  style={[styles.chip, priority === p.value && { backgroundColor: p.color + '20', borderColor: p.color }]}
                  onPress={() => handlePriorityChange(p.value)}
                >
                  <Text style={[styles.chipText, priority === p.value && { color: p.color }]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <DateInput label="Date limite" value={deadline} onChange={v => { setDeadline(v); setDeadlineSuggested(false); }} optional />
          </View>
          {deadlineSuggested && deadline ? (
            <View style={styles.lotAutoFillHint}>
              <Ionicons name="bulb-outline" size={12} color={C.primary} />
              <Text style={styles.lotAutoFillText}>
                Délai suggéré automatiquement selon la priorité ({getSuggestedDeadlineDays(priority)}j). Vous pouvez modifier la date.
              </Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, isSubmitting && { opacity: 0.6 }, kind === 'observation' && styles.submitBtnObservation]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          <Ionicons name="add-circle" size={20} color="#fff" />
          <Text style={styles.submitBtnText}>
            {isSubmitting ? 'Création...' : kind === 'observation' ? "Créer l'observation" : 'Créer la réserve'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={pinModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setPinModalVisible(false)}
      >
        <View style={styles.pinModal}>
          <View style={[styles.pinModalHeader, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity
              style={styles.pinModalIconBtn}
              onPress={() => setPinModalVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Fermer le positionnement"
            >
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.pinModalTitle}>Positionner l'épingle</Text>
              <Text style={styles.pinModalSubtitle} numberOfLines={1}>{selectedPlan?.name ?? 'Plan associé'}</Text>
            </View>
            <TouchableOpacity
              style={[styles.pinModalValidateBtn, !draftPin && styles.pinModalValidateBtnDisabled]}
              onPress={() => setPinModalVisible(false)}
              disabled={!draftPin}
              accessibilityRole="button"
              accessibilityLabel="Valider la position de l'épingle"
            >
              <Ionicons name="checkmark" size={17} color="#fff" />
              <Text style={styles.pinModalValidateText}>Valider</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.pinModalViewer}>
            {selectedPlanSupportsInlinePin && selectedPlan?.uri ? (
              <PdfPlanViewer
                key={selectedPlan.id}
                planUri={selectedPlan.uri}
                planId={selectedPlan.id}
                isImagePlan={selectedPlanIsImage}
                annotations={[]}
                onAnnotationsChange={() => {}}
                reserves={pinViewerReserves}
                pinNumberMap={pinViewerNumberMap}
                onReserveSelect={() => {}}
                onPlanTap={(x, y) => setDraftPin({ x: Math.round(x), y: Math.round(y) })}
                onPinMove={(reserveId, x, y) => {
                  if (reserveId === DRAFT_PIN_ID) setDraftPin({ x: Math.round(x), y: Math.round(y) });
                }}
                canAnnotate={false}
                canCreate
                canMovePins
                pinSize={42}
                companies={companies}
              />
            ) : (
              <View style={styles.pinModalEmpty}>
                <Ionicons name="map-outline" size={42} color="#93A4BD" />
                <Text style={styles.pinModalEmptyTitle}>Plan indisponible</Text>
                <Text style={styles.pinModalEmptyText}>
                  Ce plan ne peut pas être ouvert ici. Vous pouvez créer la réserve sans épingle, ou la positionner plus tard depuis l'onglet Plans.
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.pinModalBottom, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.pinModalHint}>
              <Ionicons name={draftPin ? 'location' : 'finger-print-outline'} size={18} color={draftPin ? '#10B981' : C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pinModalHintTitle}>
                  {draftPin ? 'Épingle placée' : 'Touchez le plan'}
                </Text>
                <Text style={styles.pinModalHintText}>
                  {draftPin
                    ? `Position ${draftPin.x}% / ${draftPin.y}%. Touchez ailleurs pour déplacer.`
                    : 'Touchez une zone du plan pour créer l’épingle de cette réserve.'}
                </Text>
              </View>
            </View>
            <View style={styles.pinModalActions}>
              <TouchableOpacity
                style={styles.pinModalSecondaryBtn}
                onPress={removeDraftPin}
                disabled={!draftPin}
              >
                <Text style={[styles.pinModalSecondaryText, !draftPin && { color: C.textMuted }]}>Retirer</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pinModalPrimaryBtn, !draftPin && styles.pinModalPrimaryBtnDisabled]}
                onPress={() => setPinModalVisible(false)}
                disabled={!draftPin}
              >
                <Text style={styles.pinModalPrimaryText}>Utiliser cette position</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
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
  lotDot: { width: 7, height: 7, borderRadius: 3.5 },

  photoRow: { flexDirection: 'row', gap: 10 },
  photoBtn: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1 },
  photoBtnPrimary: { backgroundColor: C.primary, borderColor: C.primary },
  photoBtnSecondary: { backgroundColor: C.surface2, borderColor: C.border },
  photoIconBubble: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  photoIconBubbleSecondary: { backgroundColor: C.primaryBg },
  photoBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  photoBtnPrimaryText: { color: '#fff' },
  photoKindHint: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },
  photoThumb: { position: 'relative', width: 80, height: 80, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  photoThumbImg: { width: '100%', height: '100%' },
  photoKindBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 3, alignItems: 'center' },
  photoKindBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  photoRemoveBtn: { position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  gpsIndicator: { position: 'absolute', top: 3, left: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: '#059669CC', alignItems: 'center', justifyContent: 'center' },
  uploadRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  uploadText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },

  templateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  templateHeaderText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  templateBadge: { backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  templateBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.primary },
  templateHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 6 },
  templateCatRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  templateCatText: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  templateItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.border + '60' },
  templateItemTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  templateItemDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },

  idPreviewBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.surface2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: C.border },
  idPreviewText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub },

  lotAutoFillHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, backgroundColor: C.primaryBg, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: C.primary + '30' },
  lotAutoFillText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.primary, lineHeight: 16 },

  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, marginBottom: 6, backgroundColor: C.surface2 },
  companyColorDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  companyRowName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  companyRowShort: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  companyCheckbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  multiCompanyHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, paddingHorizontal: 2 },
  multiCompanyHintText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.primary, flex: 1 },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.medium + '10', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.medium + '30' },
  warningText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.medium, lineHeight: 18 },
  locationHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  locationIconBox: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '24' },
  locationLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.text, textTransform: 'uppercase', letterSpacing: 0.4 },
  locationSummary: { marginTop: 2, fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub, lineHeight: 18 },
  locationAction: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, backgroundColor: C.primaryBg },
  locationActionText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.primary },
  locationPickerWrap: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border },
  visitScopeNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '25' },
  visitScopeNoticeText: { flex: 1, fontSize: 11, fontFamily: 'Inter_500Medium', color: C.primary, lineHeight: 16 },
  followUpHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  followUpMeta: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted },

  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, gap: 8 },
  submitBtnObservation: { backgroundColor: '#0EA5E9' },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  sourceCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.inProgress + '15', borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: C.inProgress + '30' },
  sourceText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: C.inProgress, lineHeight: 16 },
  visiteCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#6366F115', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#6366F130' },
  visiteCardLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#6366F1', textTransform: 'uppercase', letterSpacing: 0.4 },
  visiteCardTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#6366F1', marginTop: 2 },
  visiteCardMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 3, lineHeight: 15 },

  kindRow: { flexDirection: 'row', gap: 10 },
  kindChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2 },
  kindChipReserve: { backgroundColor: '#EF444415', borderColor: '#EF4444' },
  kindChipObservation: { backgroundColor: '#0EA5E915', borderColor: '#0EA5E9' },
  kindChipText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  kindHintBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#0EA5E910', borderRadius: 8, padding: 10, marginTop: 10, borderWidth: 1, borderColor: '#0EA5E930' },
  kindHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: '#0EA5E9', lineHeight: 17 },

  planFilterHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  planFilterHintText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.primary },
  planFilterReset: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary, textDecorationLine: 'underline' },

  pinPlacementBox: { marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: C.primary + '28', backgroundColor: C.primary + '08', padding: 12, gap: 12 },
  pinPlacementBoxReady: { borderColor: '#10B98155', backgroundColor: '#10B98110' },
  pinPlacementHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  pinPlacementIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.primary + '30' },
  pinPlacementIconReady: { backgroundColor: '#10B981', borderColor: '#10B981' },
  pinPlacementTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  pinPlacementText: { marginTop: 2, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 16 },
  pinPlacementActions: { flexDirection: 'row', gap: 8 },
  pinPlacementBtn: { minHeight: 38, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  pinPlacementPrimary: { flex: 1, backgroundColor: C.primary },
  pinPlacementPrimaryText: { color: '#fff', fontSize: 12, fontFamily: 'Inter_700Bold' },
  pinPlacementSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#EF444455' },
  pinPlacementSecondaryText: { color: C.open, fontSize: 12, fontFamily: 'Inter_700Bold' },

  pinNudge: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#F59E0B18', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#F59E0B35', marginTop: 10 },
  pinNudgeText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: '#92400E', lineHeight: 16 },
  pinModal: { flex: 1, backgroundColor: '#0F172A' },
  pinModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10, backgroundColor: '#0B1220', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  pinModalIconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)' },
  pinModalTitle: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
  pinModalSubtitle: { color: '#93A4BD', fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  pinModalValidateBtn: { minHeight: 38, borderRadius: 19, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: C.primary },
  pinModalValidateBtnDisabled: { opacity: 0.45 },
  pinModalValidateText: { color: '#fff', fontSize: 12, fontFamily: 'Inter_700Bold' },
  pinModalViewer: { flex: 1, backgroundColor: '#0F1117' },
  pinModalEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  pinModalEmptyTitle: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
  pinModalEmptyText: { color: '#93A4BD', fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19, textAlign: 'center' },
  pinModalBottom: { backgroundColor: '#fff', paddingHorizontal: 14, paddingTop: 12, borderTopLeftRadius: 18, borderTopRightRadius: 18, gap: 12 },
  pinModalHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  pinModalHintTitle: { color: C.text, fontSize: 13, fontFamily: 'Inter_700Bold' },
  pinModalHintText: { color: C.textSub, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, marginTop: 2 },
  pinModalActions: { flexDirection: 'row', gap: 10 },
  pinModalSecondaryBtn: { minHeight: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2 },
  pinModalSecondaryText: { color: C.open, fontSize: 13, fontFamily: 'Inter_700Bold' },
  pinModalPrimaryBtn: { flex: 1, minHeight: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary },
  pinModalPrimaryBtnDisabled: { opacity: 0.45 },
  pinModalPrimaryText: { color: '#fff', fontSize: 13, fontFamily: 'Inter_700Bold' },
});
