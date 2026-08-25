import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, Image, Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useState, useCallback, useMemo, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { MediaImage } from '@/components/MediaImage';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import {
  ChantierBuilding,
  Visite,
  VisiteLocationScope,
  VisiteParticipant,
  VisiteStatus,
  VisiteType,
  VisiteChecklistItem,
} from '@/constants/types';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { genEntityId, genId, formatDateFR, nowTimestampFR } from '@/lib/utils';
import LocationPicker from '@/components/LocationPicker';
import CompanySelector from '@/components/CompanySelector';
import DictationTextInput from '@/components/DictationTextInput';
import PageContainer from '@/components/PageContainer';
import { showAlert } from '@/lib/appAlert';

// ─── Constants ────────────────────────────────────────────────────────────────

type Recurrence = 'none' | 'weekly' | 'bimonthly';

const VISIT_TYPES: { value: VisiteType; labelKey: string; icon: string; color: string }[] = [
  { value: 'controle',  labelKey: 'visits.type.controle',  icon: 'clipboard-outline',           color: '#6366F1' },
  { value: 'opr',       labelKey: 'visits.type.opr',       icon: 'document-text-outline',        color: '#F59E0B' },
  { value: 'securite',  labelKey: 'visits.type.securite',  icon: 'shield-outline',               color: '#EF4444' },
  { value: 'reception', labelKey: 'visits.type.reception', icon: 'ribbon-outline',               color: '#10B981' },
  { value: 'synthese',  labelKey: 'visits.type.synthese',  icon: 'people-outline',               color: '#3B82F6' },
  { value: 'autre',     labelKey: 'visits.type.autre',     icon: 'ellipsis-horizontal-outline',  color: '#6B7280' },
];

const RECURRENCE_OPTIONS: { value: Recurrence; labelKey: string; descKey: string }[] = [
  { value: 'none',      labelKey: 'visits.new.recurrenceOptions.none.label',      descKey: 'visits.new.recurrenceOptions.none.desc' },
  { value: 'weekly',    labelKey: 'visits.new.recurrenceOptions.weekly.label',    descKey: 'visits.new.recurrenceOptions.weekly.desc' },
  { value: 'bimonthly', labelKey: 'visits.new.recurrenceOptions.bimonthly.label', descKey: 'visits.new.recurrenceOptions.bimonthly.desc' },
];

const STATUS_OPTIONS: { value: VisiteStatus; labelKey: string; color: string }[] = [
  { value: 'planned',     labelKey: 'visits.status.planned', color: '#6366F1' },
  { value: 'in_progress', labelKey: 'visits.status.in_progress', color: C.inProgress },
  { value: 'completed',   labelKey: 'visits.status.completed', color: C.closed },
];

const DEADLINE_SUGGESTIONS: { label: string; days: number }[] = [
  { label: '7 j',  days: 7 },
  { label: '15 j', days: 15 },
  { label: '30 j', days: 30 },
  { label: '60 j', days: 60 },
];

const INLINE_BUILDING_LIMIT = 8;
const SELECTED_BUILDING_PREVIEW_LIMIT = 8;

const CHECKLIST_TEMPLATE_KEYS: Record<VisiteType, string[]> = {
  controle: [
    'visits.new.checklistTemplates.controle.progress',
    'visits.new.checklistTemplates.controle.materials',
    'visits.new.checklistTemplates.controle.coordination',
    'visits.new.checklistTemplates.controle.previousReserves',
    'visits.new.checklistTemplates.controle.safety',
  ],
  opr: [
    'visits.new.checklistTemplates.opr.cleaning',
    'visits.new.checklistTemplates.opr.technicalTests',
    'visits.new.checklistTemplates.opr.finishes',
    'visits.new.checklistTemplates.opr.executionPlans',
    'visits.new.checklistTemplates.opr.closeoutDocs',
    'visits.new.checklistTemplates.opr.previousReserves',
  ],
  securite: [
    'visits.new.checklistTemplates.securite.ppe',
    'visits.new.checklistTemplates.securite.marking',
    'visits.new.checklistTemplates.securite.cleanliness',
    'visits.new.checklistTemplates.securite.temporaryElectrical',
    'visits.new.checklistTemplates.securite.access',
    'visits.new.checklistTemplates.securite.register',
  ],
  reception: [
    'visits.new.checklistTemplates.reception.cleaning',
    'visits.new.checklistTemplates.reception.commissioning',
    'visits.new.checklistTemplates.reception.functionalTests',
    'visits.new.checklistTemplates.reception.executionPlans',
    'visits.new.checklistTemplates.reception.manuals',
    'visits.new.checklistTemplates.reception.allPreviousReserves',
  ],
  synthese: [
    'visits.new.checklistTemplates.synthese.attendees',
    'visits.new.checklistTemplates.synthese.progress',
    'visits.new.checklistTemplates.synthese.blockers',
    'visits.new.checklistTemplates.synthese.planning',
    'visits.new.checklistTemplates.synthese.otherQuestions',
  ],
  autre: [
    'visits.new.checklistTemplates.autre.status',
    'visits.new.checklistTemplates.autre.actions',
    'visits.new.checklistTemplates.autre.nextVisit',
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function parseDateFR(dateStr: string): Date {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  }
  return new Date();
}

function addDays(d: Date, days: number): string {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return formatDateFR(next);
}

function autoTitle(visitType: VisiteType | null, dateStr: string, t: (key: string) => string): string {
  if (!visitType) return '';
  const typeCfg = VISIT_TYPES.find(t => t.value === visitType);
  if (!typeCfg) return '';
  const week = getISOWeek(parseDateFR(dateStr));
  return `${t(typeCfg.labelKey)} — S${week}`;
}

function formatTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + ':' + digits.slice(2);
}

function parseTimeToMinutes(value: string): number | null {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function NewVisiteScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { addVisite, activeChantierId, activeChantier, companies, sitePlans } = useApp();
  const { user, permissions, users } = useAuth();
  const scrollRef = useRef<ScrollView | null>(null);
  const typeSectionYRef = useRef(0);
  const typeHighlightAnim = useRef(new Animated.Value(0)).current;

  // General
  const [visitType, setVisitType]   = useState<VisiteType | null>(null);
  const [title, setTitle]           = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [date, setDate]             = useState(formatDateFR(new Date()));
  const [startTime, setStartTime]   = useState('');
  const [endTime, setEndTime]       = useState('');
  const [conducteur, setConducteur] = useState(user?.name ?? '');
  const [status, setStatus]         = useState<VisiteStatus>('planned');

  // Cover photo
  const [coverPhotoUri, setCoverPhotoUri] = useState<string | null>(null);

  // Location
  const [building, setBuilding]     = useState('');
  const [level, setLevel]           = useState('');
  const [zone, setZone]             = useState('');
  const [defaultPlanId, setDefaultPlanId] = useState<string | null>(null);
  const [visitedLocations, setVisitedLocations] = useState<VisiteLocationScope[]>([]);
  const [buildingQuery, setBuildingQuery] = useState('');
  const [showAllBuildingChoices, setShowAllBuildingChoices] = useState(false);
  const [showPlanSuggestions, setShowPlanSuggestions] = useState(false);

  // Concerned companies
  const [concernedCompanyIds, setConcernedCompanyIds] = useState<string[]>([]);

  // Checklist
  const [checklistItems, setChecklistItems] = useState<VisiteChecklistItem[]>([]);
  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [checklistLoaded, setChecklistLoaded] = useState(false);

  // Reserve deadline
  const [reserveDeadlineDate, setReserveDeadlineDate] = useState('');

  // Participants
  const [participants, setParticipants]                   = useState<VisiteParticipant[]>([]);
  const [newParticipantName, setNewParticipantName]       = useState('');
  const [newParticipantRole, setNewParticipantRole]       = useState('');
  const [newParticipantCompanyId, setNewParticipantCompanyId] = useState<string | null>(null);
  const [newParticipantCompanyFree, setNewParticipantCompanyFree] = useState('');

  // Tags
  const [tags, setTags]         = useState<string[]>([]);
  const [newTag, setNewTag]     = useState('');

  // Notes & recurrence
  const [notes, setNotes]             = useState('');
  const [recurrence, setRecurrence]   = useState<Recurrence>('none');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasCompanies = companies.length > 0;
  const chantierPlans = sitePlans.filter(p => p.chantierId === activeChantierId);
  const chantierBuildings = activeChantier?.buildings ?? [];
  const hasBuildingHierarchy = chantierBuildings.length > 0;
  const selectedLocationBuildingIds = useMemo(
    () => new Set(visitedLocations.map(loc => loc.buildingId).filter((id): id is string => !!id)),
    [visitedLocations]
  );
  const selectedPlanIdsByBuilding = useMemo(() => {
    const map = new Map<string, string>();
    visitedLocations.forEach(loc => {
      if (loc.buildingId && loc.defaultPlanId) map.set(loc.buildingId, loc.defaultPlanId);
    });
    return map;
  }, [visitedLocations]);
  const selectedLocationSummary = useMemo(() => {
    if (visitedLocations.length === 0) return t('visits.new.noBuildingSelected');
    const levelCount = visitedLocations.reduce((sum, loc) => {
      const b = chantierBuildings.find(item => item.id === loc.buildingId);
      return sum + (b?.levels?.length ?? 0);
    }, 0);
    const planCount = chantierPlans.filter(plan =>
      visitedLocations.some(loc =>
        (plan.buildingId && plan.buildingId === loc.buildingId) ||
        (!plan.buildingId && loc.buildingName && plan.building === loc.buildingName)
      )
    ).length;
    return t('visits.new.selectedSummary', {
      buildings: t('visits.buildings', { count: visitedLocations.length }),
      levels: t('visits.new.levels', { count: levelCount }),
      plans: t('chantierSwitcher.plans', { count: planCount }),
    });
  }, [visitedLocations, chantierBuildings, chantierPlans, t]);

  const filteredPerimeterBuildings = useMemo(() => {
    const q = normalizeSearch(buildingQuery.trim());
    if (!q) return chantierBuildings;
    return chantierBuildings.filter(b =>
      normalizeSearch(b.name).includes(q) ||
      (b.levels ?? []).some(lvl => normalizeSearch(lvl.name).includes(q))
    );
  }, [chantierBuildings, buildingQuery]);

  const visiblePerimeterBuildings = useMemo(() => {
    if (buildingQuery.trim() || showAllBuildingChoices) return filteredPerimeterBuildings;
    return filteredPerimeterBuildings.slice(0, INLINE_BUILDING_LIMIT);
  }, [filteredPerimeterBuildings, buildingQuery, showAllBuildingChoices]);

  const hiddenBuildingChoiceCount = Math.max(0, filteredPerimeterBuildings.length - visiblePerimeterBuildings.length);

  const selectedLocationPreview = useMemo(
    () => visitedLocations.slice(0, SELECTED_BUILDING_PREVIEW_LIMIT),
    [visitedLocations]
  );
  const selectedLocationOverflow = Math.max(0, visitedLocations.length - selectedLocationPreview.length);

  // Team members available for quick-add
  const teamMembers = useMemo(() =>
    users.filter(u =>
      u.id !== user?.id &&
      !participants.some(p => p.name === u.name)
    ),
    [users, user, participants]
  );

  // ── Auto-suggest title ──────────────────────────────────────────────────────

  const handleVisitTypeChange = useCallback((type: VisiteType) => {
    setVisitType(type);
    if (!titleEdited) setTitle(autoTitle(type, date, t));
    // Auto-load checklist template if not yet customised
    if (!checklistLoaded || checklistItems.length === 0) {
      const templateKeys = CHECKLIST_TEMPLATE_KEYS[type] ?? [];
      setChecklistItems(templateKeys.map(labelKey => ({ id: genId(), label: t(labelKey), checked: false })));
      setChecklistLoaded(true);
    }
  }, [titleEdited, date, checklistLoaded, checklistItems.length, t]);

  const handleDateChange = useCallback((d: string) => {
    setDate(d);
    if (!titleEdited && visitType) setTitle(autoTitle(visitType, d, t));
  }, [titleEdited, visitType, t]);

  const handleTitleChange = useCallback((t: string) => {
    setTitle(t);
    setTitleEdited(true);
  }, []);

  function applySuggestedTitle() {
    if (visitType) {
      setTitle(autoTitle(visitType, date, t));
      setTitleEdited(false);
    }
  }

  function guideToVisitType() {
    scrollRef.current?.scrollTo({
      y: Math.max(typeSectionYRef.current - 12, 0),
      animated: true,
    });
    typeHighlightAnim.stopAnimation();
    typeHighlightAnim.setValue(0);
    Animated.sequence([
      Animated.delay(160),
      Animated.timing(typeHighlightAnim, {
        toValue: 1,
        duration: 260,
        useNativeDriver: false,
      }),
      Animated.delay(850),
      Animated.timing(typeHighlightAnim, {
        toValue: 0,
        duration: 420,
        useNativeDriver: false,
      }),
    ]).start();
  }

  // ── Cover photo ─────────────────────────────────────────────────────────────

  async function pickCoverPhoto() {
    const { status: ps } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (ps !== 'granted') {
      showAlert(t('visits.new.permissionDenied'), t('visits.new.galleryRequired'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setCoverPhotoUri(result.assets[0].uri);
  }

  async function takeCoverPhoto() {
    const { status: cs } = await ImagePicker.requestCameraPermissionsAsync();
    if (cs !== 'granted') {
      showAlert(t('visits.new.permissionDenied'), t('visits.new.cameraRequired'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [16, 9], quality: 0.8 });
    if (!result.canceled && result.assets[0]) setCoverPhotoUri(result.assets[0].uri);
  }

  // ── Visit perimeter ────────────────────────────────────────────────────────

  function plansForBuilding(b: ChantierBuilding) {
    return chantierPlans.filter(plan =>
      (!plan.buildingId && !plan.building) ||
      plan.buildingId === b.id ||
      (!plan.buildingId && plan.building === b.name)
    );
  }

  function toggleVisitedBuilding(b: ChantierBuilding) {
    setVisitedLocations(prev => {
      const exists = prev.some(loc => loc.buildingId === b.id);
      if (exists) return prev.filter(loc => loc.buildingId !== b.id);
      return [...prev, { buildingId: b.id, buildingName: b.name }];
    });
  }

  function selectAllBuildings() {
    setVisitedLocations(chantierBuildings.map(b => ({ buildingId: b.id, buildingName: b.name })));
  }

  function selectFilteredBuildings() {
    setVisitedLocations(prev => {
      const byId = new Map(prev.filter(loc => loc.buildingId).map(loc => [loc.buildingId!, loc]));
      filteredPerimeterBuildings.forEach(b => {
        if (!byId.has(b.id)) byId.set(b.id, { buildingId: b.id, buildingName: b.name });
      });
      return Array.from(byId.values());
    });
  }

  function updateLocationDefaultPlan(buildingId: string, planId: string | null) {
    setVisitedLocations(prev => prev.map(loc =>
      loc.buildingId === buildingId
        ? { ...loc, defaultPlanId: planId ?? undefined }
        : loc
    ));
  }

  // ── Companies ───────────────────────────────────────────────────────────────

  function toggleConcernedCompany(id: string) {
    setConcernedCompanyIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  }

  // ── Checklist ───────────────────────────────────────────────────────────────

  function toggleChecklistItem(id: string) {
    setChecklistItems(prev =>
      prev.map(item => item.id === id ? { ...item, checked: !item.checked } : item)
    );
  }

  function addChecklistItem() {
    if (!newChecklistLabel.trim()) return;
    setChecklistItems(prev => [...prev, { id: genId(), label: newChecklistLabel.trim(), checked: false }]);
    setNewChecklistLabel('');
  }

  function removeChecklistItem(id: string) {
    setChecklistItems(prev => prev.filter(item => item.id !== id));
  }

  function resetChecklistToTemplate() {
    if (!visitType) return;
    const templateKeys = CHECKLIST_TEMPLATE_KEYS[visitType] ?? [];
    setChecklistItems(templateKeys.map(labelKey => ({ id: genId(), label: t(labelKey), checked: false })));
  }

  // ── Deadline ────────────────────────────────────────────────────────────────

  function applyDeadlineSuggestion(days: number) {
    const suggested = addDays(new Date(), days);
    setReserveDeadlineDate(prev => prev === suggested ? '' : suggested);
  }

  // ── Tags ────────────────────────────────────────────────────────────────────

  function addTag() {
    const t = newTag.trim();
    if (!t || tags.includes(t)) return;
    setTags(prev => [...prev, t]);
    setNewTag('');
  }

  function removeTag(t: string) {
    setTags(prev => prev.filter(tag => tag !== t));
  }

  // ── Participants ────────────────────────────────────────────────────────────

  function resolveParticipantCompany(): string {
    if (hasCompanies && newParticipantCompanyId) {
      return companies.find(c => c.id === newParticipantCompanyId)?.name ?? '';
    }
    return newParticipantCompanyFree.trim();
  }

  function addParticipant() {
    if (!newParticipantName.trim()) return;
    setParticipants(prev => [...prev, {
      id: genId(),
      name: newParticipantName.trim(),
      company: resolveParticipantCompany(),
      role: newParticipantRole.trim() || undefined,
    }]);
    setNewParticipantName('');
    setNewParticipantRole('');
    setNewParticipantCompanyId(null);
    setNewParticipantCompanyFree('');
  }

  function quickAddTeamMember(memberId: string) {
    const member = users.find(u => u.id === memberId);
    if (!member) return;
    const co = member.companyId ? companies.find(c => c.id === member.companyId) : undefined;
    setParticipants(prev => [...prev, {
      id: genId(),
      name: member.name,
      company: co?.name ?? '',
      role: member.roleLabel,
    }]);
  }

  function removeParticipant(id: string) {
    setParticipants(prev => prev.filter(p => p.id !== id));
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  function handleSubmit() {
    if (isSubmitting) return;
    if (!activeChantierId) {
      showAlert(t('visits.new.chantierRequiredTitle'), t('visits.new.chantierRequiredText'));
      return;
    }
    if (!visitType) {
      showAlert(t('visits.new.typeRequiredTitle'), t('visits.new.typeRequiredText'));
      return;
    }
    if (!title.trim()) {
      showAlert(t('visits.new.requiredTitle'), t('visits.new.titleRequiredText'));
      return;
    }
    if (!date.trim()) {
      showAlert(t('visits.new.requiredTitle'), t('visits.new.dateRequiredText'));
      return;
    }
    if (hasBuildingHierarchy && visitedLocations.length === 0) {
      showAlert(
        t('visits.new.perimeterRequiredTitle'),
        t('visits.new.perimeterRequiredText')
      );
      return;
    }

    const startMinutes = startTime.trim() ? parseTimeToMinutes(startTime.trim()) : null;
    const endMinutes = endTime.trim() ? parseTimeToMinutes(endTime.trim()) : null;
    if (startTime.trim() && startMinutes === null) {
      showAlert(t('visits.new.invalidTimeTitle'), t('visits.new.startTimeInvalid'));
      return;
    }
    if (endTime.trim() && endMinutes === null) {
      showAlert(t('visits.new.invalidTimeTitle'), t('visits.new.endTimeInvalid'));
      return;
    }
    if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
      showAlert(t('visits.new.inconsistentTimeTitle'), t('visits.new.inconsistentTimeText'));
      return;
    }

    setIsSubmitting(true);

    const today          = nowTimestampFR();
    const conducteurName = conducteur.trim() || (user?.name ?? 'Équipe BuildTrack');
    const baseDate       = parseDateFR(date);
    const singleVisitedLocation = hasBuildingHierarchy && visitedLocations.length === 1 ? visitedLocations[0] : null;

    const intervals: number[] =
      recurrence === 'weekly'    ? [0, 7, 14, 21] :
      recurrence === 'bimonthly' ? [0, 14, 28, 42] :
      [0];

    intervals.forEach((offsetDays, idx) => {
      const visitDate  = offsetDays === 0 ? date : addDays(baseDate, offsetDays);
      const visitTitle = recurrence !== 'none'
        ? `${title.trim()} — S${idx + 1}`
        : title.trim();

      const visite: Visite = {
        id: genEntityId('VIS'),
        chantierId: activeChantierId,
        title: visitTitle,
        date: visitDate,
        startTime: startTime.trim() || undefined,
        endTime: endTime.trim() || undefined,
        conducteur: conducteurName,
        status: idx === 0 ? status : 'planned',
        visitType: visitType ?? undefined,
        concernedCompanyIds: concernedCompanyIds.length > 0 ? concernedCompanyIds : undefined,
        visitedLocations: hasBuildingHierarchy && visitedLocations.length > 0 ? visitedLocations : undefined,
        building: hasBuildingHierarchy ? singleVisitedLocation?.buildingName : building || undefined,
        level: hasBuildingHierarchy ? undefined : level || undefined,
        zone: zone || undefined,
        coverPhotoUri: coverPhotoUri ?? undefined,
        defaultPlanId: hasBuildingHierarchy ? singleVisitedLocation?.defaultPlanId : defaultPlanId ?? undefined,
        checklistItems: checklistItems.length > 0 ? checklistItems : undefined,
        tags: tags.length > 0 ? tags : undefined,
        notes: notes.trim() || undefined,
        reserveDeadlineDate: reserveDeadlineDate.trim() || undefined,
        reserveIds: [],
        participants: participants.length > 0 ? participants : undefined,
        createdAt: today,
      };
      addVisite(visite);
    });

    const count = intervals.length;
    // isSubmitting reste à true tant que la boîte est ouverte : le bouton
    // « Créer » est désactivé, aucune double soumission possible. Le style
    // 'cancel' garantit que router.back() est aussi appelé si la boîte est
    // fermée via le fond/Échap sur web.
    showAlert(
      t('visits.new.createdTitle', { count }),
      count > 1
        ? t('visits.new.createdSeries', { title: title.trim(), count })
        : t('visits.new.createdSingle', { title: title.trim() }),
      [{ text: 'OK', style: 'cancel', onPress: () => goBack() }]
    );
  }

  // ── Guard ───────────────────────────────────────────────────────────────────

  if (!permissions.canCreate) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Header title={t('visits.new.title')} showBack />
        <Ionicons name="lock-closed-outline" size={48} color="#9CA3AF" />
        <Text style={{ marginTop: 16, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#374151', textAlign: 'center' }}>{t('visits.new.accessDeniedTitle')}</Text>
        <Text style={{ marginTop: 8, fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6B7280', textAlign: 'center' }}>
          {t('visits.new.accessDeniedText')}
        </Text>
      </View>
    );
  }

  const suggestedTitle = visitType ? autoTitle(visitType, date, t) : '';
  const showSuggestBtn = visitType && title !== suggestedTitle && !!suggestedTitle;
  const checklistDone  = checklistItems.filter(i => i.checked).length;
  const typeCardBorderColor = typeHighlightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [C.border, C.primary],
  });
  const typeCardBackgroundColor = typeHighlightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [C.surface, C.primaryBg],
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header
        title={t('visits.new.title')}
        subtitle={activeChantier?.name ?? ''}
        showBack
        rightIcon="checkmark-circle-outline"
        onRightPress={handleSubmit}
      />

      <PageContainer maxWidth={800}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── 1. TYPE DE VISITE ── */}
        <Animated.View
          style={[
            styles.card,
            styles.typeGuideCard,
            { borderColor: typeCardBorderColor, backgroundColor: typeCardBackgroundColor },
          ]}
          onLayout={event => {
            typeSectionYRef.current = event.nativeEvent.layout.y;
          }}
        >
          <Text style={styles.sectionLabel}>{t('visits.new.sectionType')}</Text>
          <View style={styles.typeGrid}>
            {VISIT_TYPES.map(type => {
              const active = visitType === type.value;
              return (
                <TouchableOpacity
                  key={type.value}
                  style={[styles.typeChip, active && { borderColor: type.color, backgroundColor: type.color + '15' }]}
                  onPress={() => handleVisitTypeChange(type.value)}
                  activeOpacity={0.75}
                >
                  <Ionicons name={type.icon as any} size={16} color={active ? type.color : C.textMuted} />
                  <Text style={[styles.typeChipText, active && { color: type.color, fontFamily: 'Inter_600SemiBold' }]}>
                    {t(type.labelKey)}
                  </Text>
                  {active && <Ionicons name="checkmark-circle" size={14} color={type.color} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>

        {/* ── 2. PHOTO DE COUVERTURE ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t('visits.new.coverPhoto')}</Text>
          <Text style={styles.sublabel}>{t('visits.new.coverPhotoHint')}</Text>

          {coverPhotoUri ? (
            <View style={styles.coverPhotoWrapper}>
              <MediaImage source={{ uri: coverPhotoUri }} style={styles.coverPhoto} resizeMode="cover" />
              <TouchableOpacity
                style={styles.coverPhotoRemove}
                onPress={() => setCoverPhotoUri(null)}
              >
                <Ionicons name="close-circle" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.photoActions}>
              <TouchableOpacity style={styles.photoBtn} onPress={pickCoverPhoto}>
                <Ionicons name="images-outline" size={18} color={C.primary} />
                <Text style={styles.photoBtnText}>{t('visits.new.choosePhoto')}</Text>
              </TouchableOpacity>
              {/* Pas de vraie caméra web via expo-image-picker : on masque le
                  bouton sur navigateur au profit du choix depuis la galerie. */}
              {Platform.OS !== 'web' && (
                <TouchableOpacity style={styles.photoBtn} onPress={takeCoverPhoto}>
                  <Ionicons name="camera-outline" size={18} color={C.primary} />
                  <Text style={styles.photoBtnText}>{t('visits.new.takePhoto')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* ── 3. INFORMATIONS GÉNÉRALES ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t('visits.new.generalInfo')}</Text>

          <Text style={styles.label}>{t('visits.new.titleLabel')}</Text>
          <View style={styles.titleRow}>
            <View style={styles.titleInputWrap}>
              <DictationTextInput
                inputStyle={[styles.input, styles.titleInput]}
                placeholder={visitType ? suggestedTitle : t('visits.new.titlePlaceholder')}
                placeholderTextColor={C.textMuted}
                value={title}
                onChangeText={handleTitleChange}
                textAssistEnabled
                textAssistContext="description"
              />
            </View>
            {showSuggestBtn && (
              <TouchableOpacity style={styles.suggestBtn} onPress={applySuggestedTitle}>
                <Ionicons name="flash-outline" size={15} color={C.primary} />
              </TouchableOpacity>
            )}
          </View>
          {showSuggestBtn && (
            <TouchableOpacity onPress={applySuggestedTitle} style={styles.suggestHint}>
              <Ionicons name="flash-outline" size={11} color={C.primary} />
              <Text style={styles.suggestHintText}>{t('visits.new.useSuggestion', { title: suggestedTitle })}</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.label}>{t('visits.new.conductor')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('visits.new.conductorPlaceholder')}
            placeholderTextColor={C.textMuted}
            value={conducteur}
            onChangeText={setConducteur}
          />

          <View style={styles.dateBlock}>
            <Text style={styles.label}>{t('visits.new.date')}</Text>
            <DateInput
              value={date}
              onChange={handleDateChange}
              containerStyle={styles.visitDateInputContainer}
              inputWrapStyle={styles.visitDateInputWrap}
              inputStyle={styles.visitDateInputText}
              showValidationIcon={false}
            />
          </View>

          <View style={styles.dateTimeRow}>
            <View style={styles.timeBlock}>
              <Text style={styles.label}>{t('visits.new.start')}</Text>
              <TextInput
                style={[styles.input, styles.timeInput]}
                placeholder="08:00"
                placeholderTextColor={C.textMuted}
                value={startTime}
                onChangeText={v => setStartTime(formatTimeInput(v))}
                keyboardType="numeric"
                maxLength={5}
              />
            </View>
            <View style={styles.timeBlock}>
              <Text style={styles.label}>{t('visits.new.end')}</Text>
              <TextInput
                style={[styles.input, styles.timeInput]}
                placeholder="10:00"
                placeholderTextColor={C.textMuted}
                value={endTime}
                onChangeText={v => setEndTime(formatTimeInput(v))}
                keyboardType="numeric"
                maxLength={5}
              />
            </View>
          </View>

          <Text style={[styles.label, { marginTop: 4 }]}>{t('visits.new.initialStatus')}</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.statusChip, status === opt.value && { backgroundColor: opt.color + '20', borderColor: opt.color }]}
                onPress={() => setStatus(opt.value)}
              >
                <Text style={[styles.statusChipText, status === opt.value && { color: opt.value === 'planned' ? '#6366F1' : opt.color }]}>
                  {t(opt.labelKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── 4. PÉRIMÈTRE + PLAN ── */}
        <View style={styles.card}>
          <View style={styles.perimeterHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionLabel}>{t('visits.new.perimeterTitle')}</Text>
              <Text style={styles.sublabel}>
                {t('visits.new.perimeterText')}
              </Text>
            </View>
            {hasBuildingHierarchy && visitedLocations.length > 0 ? (
              <View style={styles.perimeterCountBadge}>
                <Text style={styles.perimeterCountText}>{visitedLocations.length}</Text>
              </View>
            ) : null}
          </View>

          {hasBuildingHierarchy ? (
            <>
              <View style={styles.perimeterSearchWrap}>
                <Ionicons name="search" size={14} color={C.textMuted} />
                <TextInput
                  style={styles.perimeterSearchInput}
                  placeholder={t('visits.new.searchBuilding')}
                  placeholderTextColor={C.textMuted}
                  value={buildingQuery}
                  onChangeText={setBuildingQuery}
                />
                {buildingQuery.length > 0 ? (
                  <TouchableOpacity onPress={() => setBuildingQuery('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={C.textMuted} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {visitedLocations.length > 0 ? (
                <View style={styles.selectedBuildingRow}>
                  {selectedLocationPreview.map(loc => (
                    <TouchableOpacity
                      key={loc.buildingId ?? loc.buildingName}
                      style={styles.selectedBuildingPill}
                      onPress={() => {
                        const b = chantierBuildings.find(item => item.id === loc.buildingId || item.name === loc.buildingName);
                        if (b) toggleVisitedBuilding(b);
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.selectedBuildingPillText} numberOfLines={1}>{loc.buildingName}</Text>
                      <Ionicons name="close" size={11} color={C.primary} />
                    </TouchableOpacity>
                  ))}
                  {selectedLocationOverflow > 0 ? (
                    <View style={styles.selectedBuildingMorePill}>
                      <Text style={styles.selectedBuildingMoreText}>+{selectedLocationOverflow}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <Text style={styles.perimeterCounterText}>
                {t('visits.new.selectedCount', { count: visitedLocations.length, selected: visitedLocations.length, total: chantierBuildings.length })}
                {buildingQuery.trim() ? ` · ${t('visits.new.resultCount', { count: filteredPerimeterBuildings.length })}` : ''}
              </Text>

              <View style={styles.perimeterActions}>
                <TouchableOpacity
                  style={styles.perimeterActionBtn}
                  onPress={buildingQuery.trim() ? selectFilteredBuildings : selectAllBuildings}
                  disabled={buildingQuery.trim() ? filteredPerimeterBuildings.length === 0 : chantierBuildings.length === 0}
                  activeOpacity={0.75}
                >
                  <Ionicons name="checkmark-done-outline" size={14} color={C.primary} />
                  <Text style={styles.perimeterActionText}>
                    {buildingQuery.trim() ? t('visits.new.selectResults') : t('visits.new.selectAll')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.perimeterActionBtn, visitedLocations.length === 0 && { opacity: 0.45 }]}
                  onPress={() => setVisitedLocations([])}
                  disabled={visitedLocations.length === 0}
                  activeOpacity={0.75}
                >
                  <Ionicons name="close-outline" size={14} color={C.textSub} />
                  <Text style={[styles.perimeterActionText, { color: C.textSub }]}>{t('visits.new.clear')}</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                style={(showAllBuildingChoices || buildingQuery.trim()) ? styles.buildingListScroll : undefined}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={showAllBuildingChoices || !!buildingQuery.trim()}
              >
                <View style={styles.buildingGrid}>
                {visiblePerimeterBuildings.length === 0 ? (
                  <View style={styles.buildingNoResult}>
                    <Ionicons name="search-outline" size={16} color={C.textMuted} />
                    <Text style={styles.buildingNoResultText}>{t('visits.new.noBuildingResult')}</Text>
                  </View>
                ) : null}
                {visiblePerimeterBuildings.map(b => {
                  const active = selectedLocationBuildingIds.has(b.id);
                  return (
                    <TouchableOpacity
                      key={b.id}
                      style={[styles.buildingSelectChip, active && styles.buildingSelectChipActive]}
                      onPress={() => toggleVisitedBuilding(b)}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.buildingSelectIcon, active && styles.buildingSelectIconActive]}>
                        <Ionicons name={active ? 'checkmark' : 'business-outline'} size={13} color={active ? '#fff' : C.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.buildingSelectName, active && styles.buildingSelectNameActive]} numberOfLines={1}>
                          {b.name}
                        </Text>
                        <Text style={styles.buildingSelectMeta}>
                          {t('visits.new.levels', { count: b.levels?.length ?? 0 })}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                </View>
              </ScrollView>

              {!buildingQuery.trim() && filteredPerimeterBuildings.length > INLINE_BUILDING_LIMIT ? (
                <TouchableOpacity
                  style={styles.buildingMoreButton}
                  onPress={() => setShowAllBuildingChoices(v => !v)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.buildingMoreButtonText}>
                    {showAllBuildingChoices
                      ? t('visits.new.reduceList')
                      : t('visits.new.showOtherBuildings', { label: t('visits.buildings', { count: hiddenBuildingChoiceCount }) })}
                  </Text>
                  <Ionicons name={showAllBuildingChoices ? 'chevron-up' : 'chevron-down'} size={14} color={C.primary} />
                </TouchableOpacity>
              ) : null}

              <View style={[styles.perimeterSummaryBox, visitedLocations.length > 0 && styles.perimeterSummaryBoxReady]}>
                <Ionicons
                  name={visitedLocations.length > 0 ? 'map-outline' : 'information-circle-outline'}
                  size={16}
                  color={visitedLocations.length > 0 ? C.primary : C.textMuted}
                />
                <Text style={styles.perimeterSummaryText}>{selectedLocationSummary}</Text>
              </View>

              {visitedLocations.length > 0 && chantierPlans.length > 0 ? (
                <View style={styles.defaultPlanByBuilding}>
                  <TouchableOpacity
                    style={styles.defaultPlanToggle}
                    onPress={() => setShowPlanSuggestions(v => !v)}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.defaultPlanToggleTitle}>{t('visits.new.planSuggestions')}</Text>
                      <Text style={styles.defaultPlanToggleSubtitle}>
                        {t('visits.new.planSuggestionSub', { buildings: t('visits.buildings', { count: visitedLocations.length }) })}
                      </Text>
                    </View>
                    <Ionicons name={showPlanSuggestions ? 'chevron-up' : 'chevron-down'} size={16} color={C.primary} />
                  </TouchableOpacity>
                  {showPlanSuggestions ? (
                    <ScrollView style={styles.defaultPlanScroll} nestedScrollEnabled showsVerticalScrollIndicator>
                  {visitedLocations.map(loc => {
                    const b = chantierBuildings.find(item => item.id === loc.buildingId);
                    if (!b || !loc.buildingId) return null;
                    const plans = plansForBuilding(b);
                    const selectedPlanId = selectedPlanIdsByBuilding.get(loc.buildingId) ?? null;
                    return (
                      <View key={loc.buildingId} style={styles.defaultPlanGroup}>
                        <View style={styles.defaultPlanTitleRow}>
                          <Ionicons name="business-outline" size={13} color={C.primary} />
                          <Text style={styles.defaultPlanTitle}>{loc.buildingName}</Text>
                          <Text style={styles.defaultPlanMeta}>{t('chantierSwitcher.plans', { count: plans.length })}</Text>
                        </View>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View style={styles.chipRow}>
                            <TouchableOpacity
                              style={[styles.chip, selectedPlanId === null && styles.chipActive]}
                              onPress={() => updateLocationDefaultPlan(loc.buildingId!, null)}
                            >
                              <Ionicons name="close-outline" size={13} color={selectedPlanId === null ? C.primary : C.textMuted} />
                              <Text style={[styles.chipText, selectedPlanId === null && styles.chipTextActive]}>{t('visits.new.noPlan')}</Text>
                            </TouchableOpacity>
                            {plans.map(plan => {
                              const selected = selectedPlanId === plan.id;
                              return (
                                <TouchableOpacity
                                  key={plan.id}
                                  style={[styles.chip, selected && styles.chipActive]}
                                  onPress={() => updateLocationDefaultPlan(loc.buildingId!, selected ? null : plan.id)}
                                >
                                  <Ionicons
                                    name={plan.fileType === 'pdf' ? 'document-outline' : 'map-outline'}
                                    size={13}
                                    color={selected ? C.primary : C.textMuted}
                                  />
                                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                                    {plan.name}{plan.revisionCode ? ` (${plan.revisionCode})` : ''}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </ScrollView>
                      </View>
                    );
                  })}
                    </ScrollView>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : (
            <>
              <LocationPicker
                buildings={activeChantier?.buildings ?? []}
                building={building}
                level={level}
                zone={zone}
                onBuildingChange={setBuilding}
                onLevelChange={setLevel}
                onZoneChange={setZone}
              />

              {chantierPlans.length > 0 && (
                <>
                  <Text style={[styles.label, { marginTop: 12 }]}>{t('visits.new.referencePlan')}</Text>
                  <Text style={styles.sublabel}>{t('visits.new.referencePlanHint')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[styles.chip, defaultPlanId === null && styles.chipActive]}
                    onPress={() => setDefaultPlanId(null)}
                  >
                    <Ionicons name="close-outline" size={13} color={defaultPlanId === null ? C.primary : C.textMuted} />
                    <Text style={[styles.chipText, defaultPlanId === null && styles.chipTextActive]}>{t('visits.new.noPlan')}</Text>
                  </TouchableOpacity>
                  {chantierPlans.map(plan => {
                    const selected = defaultPlanId === plan.id;
                    return (
                      <TouchableOpacity
                        key={plan.id}
                        style={[styles.chip, selected && styles.chipActive]}
                        onPress={() => setDefaultPlanId(selected ? null : plan.id)}
                      >
                        <Ionicons
                          name={plan.fileType === 'pdf' ? 'document-outline' : 'map-outline'}
                          size={13}
                          color={selected ? C.primary : C.textMuted}
                        />
                        <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                          {plan.name}{plan.revisionCode ? ` (${plan.revisionCode})` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                    </View>
                  </ScrollView>
                </>
              )}
            </>
          )}
        </View>

        {/* ── 5. ENTREPRISES CONCERNÉES ── */}
        {hasCompanies && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>{t('visits.new.concernedCompanies')}</Text>
            <Text style={styles.sublabel}>{t('visits.new.concernedCompaniesHint')}</Text>
            <CompanySelector
              mode="multi"
              identifier="id"
              companies={companies}
              value={concernedCompanyIds}
              onChange={(next) => {
                const toAdd = next.filter(id => !concernedCompanyIds.includes(id));
                const toRemove = concernedCompanyIds.filter(id => !next.includes(id));
                toAdd.forEach(id => toggleConcernedCompany(id));
                toRemove.forEach(id => toggleConcernedCompany(id));
              }}
            />
          </View>
        )}

        {/* ── 6. CHECKLIST DE CONTRÔLE ── */}
        <View style={styles.card}>
          <View style={styles.checklistHeader}>
            <View>
              <Text style={styles.sectionLabel}>
                {t('visits.new.checklist')}
                {checklistItems.length > 0 && (
                  <Text style={{ color: C.textMuted, fontFamily: 'Inter_400Regular' }}>
                    {'  '}{checklistDone}/{checklistItems.length}
                  </Text>
                )}
              </Text>
            </View>
            {visitType && checklistItems.length > 0 && (
              <TouchableOpacity onPress={resetChecklistToTemplate} style={styles.resetBtn}>
                <Ionicons name="refresh-outline" size={13} color={C.textMuted} />
                <Text style={styles.resetBtnText}>{t('visits.new.model')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {checklistItems.length === 0 ? (
            <View style={styles.checklistEmptyBox}>
              <View style={styles.checklistEmptyIcon}>
                <Ionicons name="clipboard-outline" size={17} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.checklistEmptyTitle}>{t('visits.new.noChecklist')}</Text>
                <Text style={styles.checklistEmptyText}>
                  {t('visits.new.checklistEmptyHint')}
                </Text>
                <TouchableOpacity
                  style={styles.checklistGuideBtn}
                  onPress={guideToVisitType}
                  activeOpacity={0.75}
                >
                  <Ionicons name="arrow-up-circle-outline" size={15} color={C.primary} />
                  <Text style={styles.checklistGuideBtnText}>
                    {visitType ? t('visits.new.changeType') : t('visits.new.chooseType')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text style={styles.checklistLoadedHint}>
              {t('visits.new.checklistLoadedHint')}
            </Text>
          )}

          {checklistItems.map(item => (
            <TouchableOpacity
              key={item.id}
              style={styles.checklistRow}
              onPress={() => toggleChecklistItem(item.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
                {item.checked && <Ionicons name="checkmark" size={12} color="#fff" />}
              </View>
              <Text style={[styles.checklistLabel, item.checked && styles.checklistLabelChecked]}>
                {item.label}
              </Text>
              <TouchableOpacity
                onPress={() => removeChecklistItem(item.id)}
                hitSlop={8}
                style={{ padding: 4 }}
              >
                <Ionicons name="close-outline" size={15} color={C.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}

          <View style={styles.checklistAddRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder={t('visits.new.addChecklistItem')}
              placeholderTextColor={C.textMuted}
              value={newChecklistLabel}
              onChangeText={setNewChecklistLabel}
              onSubmitEditing={addChecklistItem}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.checklistAddBtn, !newChecklistLabel.trim() && { opacity: 0.35 }]}
              onPress={addChecklistItem}
              disabled={!newChecklistLabel.trim()}
            >
              <Ionicons name="add" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 7. DÉLAI DE LEVÉE DES RÉSERVES ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t('visits.new.reserveDeadline')}</Text>
          <Text style={styles.sublabel}>
            {t('visits.new.reserveDeadlineHint')}
          </Text>
          <View style={styles.deadlineRow}>
            {DEADLINE_SUGGESTIONS.map(s => {
              const suggested = addDays(new Date(), s.days);
              const active    = reserveDeadlineDate === suggested;
              return (
                <TouchableOpacity
                  key={s.days}
                  style={[styles.deadlineChip, active && styles.deadlineChipActive]}
                  onPress={() => applyDeadlineSuggestion(s.days)}
                >
                  <Text style={[styles.deadlineChipText, active && styles.deadlineChipTextActive]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {reserveDeadlineDate ? (
              <TouchableOpacity onPress={() => setReserveDeadlineDate('')}>
                <Ionicons name="close-circle-outline" size={16} color={C.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={[styles.label, { marginTop: 8 }]}>
            {reserveDeadlineDate ? t('visits.new.deadline', { date: reserveDeadlineDate }) : t('visits.new.exactDate')}
          </Text>
          <DateInput value={reserveDeadlineDate} onChange={setReserveDeadlineDate} />
          {reserveDeadlineDate ? (
            <View style={styles.infoHint}>
              <Ionicons name="time-outline" size={13} color={C.inProgress} />
              <Text style={styles.infoHintText}>
                {t('visits.new.deadlineDefaultHint')}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── 8. PARTICIPANTS ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t('visits.new.participants', { count: participants.length })}</Text>

          {participants.map(p => (
            <View key={p.id} style={styles.participantRow}>
              <View style={styles.participantAvatar}>
                <Text style={styles.participantAvatarText}>{initials(p.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.participantName}>{p.name}</Text>
                <Text style={styles.participantMeta}>{[p.role, p.company].filter(Boolean).join(' · ')}</Text>
              </View>
              <TouchableOpacity onPress={() => removeParticipant(p.id)} hitSlop={8}>
                <Ionicons name="close-circle-outline" size={18} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          ))}

          {teamMembers.length > 0 && (
            <View style={[styles.teamSection, participants.length > 0 && { marginTop: 12 }]}>
              <Text style={styles.teamLabel}>{t('visits.new.quickTeamAdd')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                <View style={styles.chipRow}>
                  {teamMembers.map(member => (
                    <TouchableOpacity
                      key={member.id}
                      style={styles.teamMemberChip}
                      onPress={() => quickAddTeamMember(member.id)}
                    >
                      <View style={styles.teamMemberAvatar}>
                        <Text style={styles.teamMemberAvatarText}>{initials(member.name)}</Text>
                      </View>
                      <View>
                        <Text style={styles.teamMemberName}>{member.name}</Text>
                        <Text style={styles.teamMemberRole}>{member.roleLabel}</Text>
                      </View>
                      <Ionicons name="add" size={14} color={C.primary} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.divider} />
            </View>
          )}

          <View style={{ marginTop: 8 }}>
            <TextInput
              style={[styles.input, { marginBottom: 8 }]}
              placeholder={t('visits.new.participantName')}
              placeholderTextColor={C.textMuted}
              value={newParticipantName}
              onChangeText={setNewParticipantName}
            />
            <TextInput
              style={[styles.input, { marginBottom: 8 }]}
              placeholder={t('visits.new.participantRole')}
              placeholderTextColor={C.textMuted}
              value={newParticipantRole}
              onChangeText={setNewParticipantRole}
            />
            <Text style={styles.label}>{t('visits.new.company')}</Text>
            {hasCompanies ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[styles.chip, newParticipantCompanyId === null && newParticipantCompanyFree === '' && styles.chipActive]}
                    onPress={() => { setNewParticipantCompanyId(null); setNewParticipantCompanyFree(''); }}
                  >
                    <Text style={[styles.chipText, newParticipantCompanyId === null && newParticipantCompanyFree === '' && styles.chipTextActive]}>—</Text>
                  </TouchableOpacity>
                  {companies.map(co => {
                    const selected = newParticipantCompanyId === co.id;
                    return (
                      <TouchableOpacity
                        key={co.id}
                        style={[styles.chip, selected && { borderColor: co.color, backgroundColor: co.color + '15' }]}
                        onPress={() => { setNewParticipantCompanyId(co.id); setNewParticipantCompanyFree(''); }}
                      >
                        <View style={[styles.companyDot, { backgroundColor: co.color }]} />
                        <Text style={[styles.chipText, selected && { color: co.color, fontFamily: 'Inter_600SemiBold' }]}>
                          {co.shortName}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    style={[styles.chip, newParticipantCompanyFree !== '' && styles.chipActive]}
                    onPress={() => { setNewParticipantCompanyId(null); setNewParticipantCompanyFree(' '); }}
                  >
                    <Text style={[styles.chipText, newParticipantCompanyFree !== '' && styles.chipTextActive]}>{t('visits.new.other')}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : null}
            {(!hasCompanies || newParticipantCompanyFree !== '') && (
              <TextInput
                style={[styles.input, { marginBottom: 8 }]}
                placeholder={t('visits.new.companyName')}
                placeholderTextColor={C.textMuted}
                value={newParticipantCompanyFree.trim() === '' ? '' : newParticipantCompanyFree}
                onChangeText={setNewParticipantCompanyFree}
                autoFocus={newParticipantCompanyFree === ' '}
              />
            )}
            <TouchableOpacity
              style={[styles.addParticipantBtn, !newParticipantName.trim() && { opacity: 0.4 }]}
              onPress={addParticipant}
              disabled={!newParticipantName.trim()}
            >
              <Ionicons name="person-add-outline" size={14} color="#fff" />
              <Text style={styles.addParticipantBtnText}>{t('visits.new.addManual')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 9. TAGS ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t('visits.new.tags')}</Text>
          <Text style={styles.sublabel}>{t('visits.new.tagsHint')}</Text>

          {tags.length > 0 && (
            <View style={[styles.chipRow, { flexWrap: 'wrap', marginBottom: 10 }]}>
              {tags.map(tag => (
                <TouchableOpacity
                  key={tag}
                  style={styles.tagChip}
                  onPress={() => removeTag(tag)}
                >
                  <Text style={styles.tagChipText}>{tag}</Text>
                  <Ionicons name="close" size={11} color={C.primary} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.checklistAddRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder={t('visits.new.tagPlaceholder')}
              placeholderTextColor={C.textMuted}
              value={newTag}
              onChangeText={setNewTag}
              onSubmitEditing={addTag}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.checklistAddBtn, !newTag.trim() && { opacity: 0.35 }]}
              onPress={addTag}
              disabled={!newTag.trim()}
            >
              <Ionicons name="add" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 10. NOTES & OBJECTIFS ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t('visits.new.notesObjectives')}</Text>
          <DictationTextInput
            inputStyle={[styles.input, styles.textArea]}
            placeholder={t('visits.new.notesPlaceholder')}
            placeholderTextColor={C.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            textAssistEnabled
            textAssistContext="description"
          />
        </View>

        {/* ── 11. RÉCURRENCE ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t('visits.new.recurrence')}</Text>
          <View style={{ gap: 8 }}>
            {RECURRENCE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.recurrenceChip, recurrence === opt.value && styles.recurrenceChipActive]}
                onPress={() => setRecurrence(opt.value)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.recurrenceChipLabel, recurrence === opt.value && { color: C.primary }]}>{t(opt.labelKey)}</Text>
                  <Text style={styles.recurrenceChipDesc}>{t(opt.descKey)}</Text>
                </View>
                {recurrence === opt.value && <Ionicons name="checkmark-circle" size={18} color={C.primary} />}
              </TouchableOpacity>
            ))}
          </View>
          {recurrence !== 'none' && (
            <View style={styles.infoHint}>
              <Ionicons name="repeat-outline" size={13} color={C.inProgress} />
              <Text style={styles.infoHintText}>
                {t(recurrence === 'weekly' ? 'visits.new.weeklyCreatedHint' : 'visits.new.bimonthlyCreatedHint', { date })}
              </Text>
            </View>
          )}
        </View>

        {/* ── 12. RÉSUMÉ ── */}
        {(title.trim() || visitType || participants.length > 0 || checklistItems.length > 0) && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>{t('visits.new.summary')}</Text>
            {visitType && <Text style={styles.summaryLine}>{t('visits.new.summaryType', { value: t(VISIT_TYPES.find(type => type.value === visitType)?.labelKey ?? 'visits.new.sectionType') })}</Text>}
            {title.trim() && <Text style={styles.summaryLine}>{t('visits.new.summaryTitleLine', { value: title.trim() })}</Text>}
            {(startTime || endTime) && <Text style={styles.summaryLine}>{t('visits.new.summarySchedule', { start: startTime || '—', end: endTime || '—' })}</Text>}
            {hasBuildingHierarchy && visitedLocations.length > 0 && <Text style={styles.summaryLine}>{t('visits.new.summaryPerimeter', { value: selectedLocationSummary })}</Text>}
            {!hasBuildingHierarchy && (building || level) && <Text style={styles.summaryLine}>{t('visits.new.summaryLocation', { value: [building, level, zone].filter(Boolean).join(' — ') })}</Text>}
            {!hasBuildingHierarchy && defaultPlanId && <Text style={styles.summaryLine}>{t('visits.new.summaryPlan', { value: chantierPlans.find(p => p.id === defaultPlanId)?.name })}</Text>}
            {participants.length > 0 && <Text style={styles.summaryLine}>{t('visits.new.summaryParticipants', { count: participants.length, names: participants.map(p => p.name).join(', ') })}</Text>}
            {checklistItems.length > 0 && <Text style={styles.summaryLine}>{t('visits.new.summaryChecklist', { count: checklistItems.length })}</Text>}
            {tags.length > 0 && <Text style={styles.summaryLine}>{t('visits.new.summaryTags', { value: tags.join(', ') })}</Text>}
            {reserveDeadlineDate && <Text style={styles.summaryLine}>{t('visits.new.summaryDeadline', { date: reserveDeadlineDate })}</Text>}
            {recurrence !== 'none' && <Text style={styles.summaryLine}>{t('visits.new.summaryRecurrence', { value: t(recurrence === 'weekly' ? 'visits.new.summaryRecurrenceWeekly' : 'visits.new.summaryRecurrenceBimonthly') })}</Text>}
          </View>
        )}

        {/* ── SUBMIT ── */}
        <TouchableOpacity
          style={[styles.submitBtn, isSubmitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={isSubmitting}
          activeOpacity={0.85}
        >
          {isSubmitting
            ? <ActivityIndicator size="small" color="#fff" />
            : <>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={styles.submitBtnText}>
                  {recurrence !== 'none' ? t('visits.new.submitSeries') : t('visits.new.submit')}
                </Text>
              </>
          }
        </TouchableOpacity>

      </ScrollView>
      </PageContainer>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 96 },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12,
  },
  sublabel: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted,
    marginBottom: 10, marginTop: -6, lineHeight: 16,
  },
  label: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, marginBottom: 6 },

  // Type grid
  typeGuideCard: { borderWidth: 1.5 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  typeChipText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },

  // Cover photo
  photoActions: { flexDirection: 'row', gap: 10 },
  photoBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, minHeight: 52, paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface2,
  },
  photoBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  coverPhotoWrapper: { position: 'relative', borderRadius: 12, overflow: 'hidden' },
  coverPhoto: { width: '100%', height: 160, borderRadius: 12 },
  coverPhotoRemove: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12,
  },

  // Visit perimeter
  perimeterHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  perimeterCountBadge: {
    minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 8,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  perimeterCountText: { color: '#fff', fontSize: 12, fontFamily: 'Inter_700Bold' },
  perimeterSearchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.surface2, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  perimeterSearchInput: {
    flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular',
    color: C.text, paddingVertical: 3,
  },
  selectedBuildingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  selectedBuildingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    maxWidth: '100%', paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: 14, borderWidth: 1, borderColor: C.primary + '35',
    backgroundColor: C.primaryBg,
  },
  selectedBuildingPillText: { maxWidth: 130, fontSize: 11, fontFamily: 'Inter_700Bold', color: C.primary },
  selectedBuildingMorePill: {
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 14,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  selectedBuildingMoreText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.textSub },
  perimeterCounterText: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted,
    marginBottom: 6,
  },
  perimeterActions: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  perimeterActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, flexShrink: 1,
  },
  perimeterActionText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary, textAlign: 'center' },
  buildingListScroll: { maxHeight: 280 },
  buildingGrid: { gap: 6 },
  buildingSelectChip: {
    width: '100%', minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingHorizontal: 10, paddingVertical: 9, borderRadius: 12,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  buildingSelectChipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  buildingSelectIcon: {
    width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: C.primary + '22',
  },
  buildingSelectIconActive: { backgroundColor: C.primary, borderColor: C.primary },
  buildingSelectName: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  buildingSelectNameActive: { color: C.primary },
  buildingSelectMeta: { marginTop: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  buildingNoResult: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: 14, borderRadius: 10, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
  },
  buildingNoResultText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
  buildingMoreButton: {
    marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: 10,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '28',
  },
  buildingMoreButtonText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary },
  perimeterSummaryBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    padding: 10, borderRadius: 10, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
  },
  perimeterSummaryBoxReady: { backgroundColor: C.primaryBg, borderColor: C.primary + '28' },
  perimeterSummaryText: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  defaultPlanByBuilding: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border },
  defaultPlanToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, borderRadius: 10,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  defaultPlanToggleTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  defaultPlanToggleSubtitle: { marginTop: 2, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  defaultPlanScroll: { maxHeight: 260, marginTop: 8 },
  defaultPlanGroup: { marginTop: 10, gap: 8 },
  defaultPlanTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  defaultPlanTitle: { flex: 1, fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  defaultPlanMeta: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted },

  // Title + suggest
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  titleInputWrap: { flex: 1, minWidth: 0 },
  titleInput: { flex: 1, marginBottom: 0 },
  suggestBtn: {
    width: 38, height: 38, borderRadius: 10, borderWidth: 1,
    borderColor: C.primary + '40', backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  suggestHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12, marginTop: 6 },
  suggestHintText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.primary },

  input: {
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, marginBottom: 12,
  },
  textArea: { height: 90, paddingTop: 10 },

  // Date + time
  dateBlock: { marginBottom: 0 },
  dateTimeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  timeBlock: { flex: 1, minWidth: 0 },
  visitDateInputContainer: { marginBottom: 12 },
  visitDateInputWrap: { minHeight: 52, paddingVertical: 0 },
  visitDateInputText: { fontSize: 14 },
  timeInput: { height: 52, textAlign: 'center', letterSpacing: 1, paddingVertical: 0 },

  // Status
  statusRow: { flexDirection: 'row', gap: 10 },
  statusChip: {
    flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
    borderColor: C.border, alignItems: 'center',
  },
  statusChipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },

  // Companies
  companyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  companyDot: { width: 8, height: 8, borderRadius: 4 },
  companyChipText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  selectionCount: {
    marginTop: 10, fontSize: 11, fontFamily: 'Inter_400Regular',
    color: C.textMuted, textAlign: 'right',
  },

  // Checklist
  checklistHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 0 },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  resetBtnText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  checklistEmptyBox: {
    flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '26',
    marginBottom: 12,
  },
  checklistEmptyIcon: {
    width: 34, height: 34, borderRadius: 12, backgroundColor: '#fff',
    borderWidth: 1, borderColor: C.primary + '20',
    alignItems: 'center', justifyContent: 'center',
  },
  checklistEmptyTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 3 },
  checklistEmptyText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17 },
  checklistGuideBtn: {
    marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10,
    backgroundColor: '#fff', borderWidth: 1, borderColor: C.primary + '35',
  },
  checklistGuideBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary },
  checklistLoadedHint: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted,
    lineHeight: 16, marginTop: -4, marginBottom: 10,
  },
  checklistRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5,
    borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: C.closed, borderColor: C.closed },
  checklistLabel: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  checklistLabelChecked: { color: C.textMuted, textDecorationLine: 'line-through' },
  checklistAddRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  checklistAddBtn: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  // Deadline
  deadlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  deadlineChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  deadlineChipActive: { borderColor: C.inProgress, backgroundColor: C.inProgress + '15' },
  deadlineChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  deadlineChipTextActive: { color: C.inProgress, fontFamily: 'Inter_600SemiBold' },

  // Info hint (shared)
  infoHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8,
    backgroundColor: C.inProgress + '12', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: C.inProgress + '30',
  },
  infoHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress, lineHeight: 16 },

  // Participants
  participantRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  participantAvatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  participantAvatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary },
  participantName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  participantMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  teamSection: {},
  teamLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted },
  teamMemberChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2, marginRight: 8,
  },
  teamMemberAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.primary + '20', alignItems: 'center', justifyContent: 'center',
  },
  teamMemberAvatarText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.primary },
  teamMemberName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.text },
  teamMemberRole: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  addParticipantBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: C.primary, borderRadius: 10, paddingVertical: 10, marginTop: 4,
  },
  addParticipantBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  // Tags
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40',
  },
  tagChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },

  // Chips
  chipRow: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  chipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  chipText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  chipTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },

  // Recurrence
  recurrenceChip: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  recurrenceChipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  recurrenceChipLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  recurrenceChipDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },

  // Summary
  summaryCard: {
    backgroundColor: C.primaryBg, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.primary + '30', marginBottom: 16,
  },
  summaryTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary, marginBottom: 8 },
  summaryLine: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20, marginBottom: 2 },

  // Submit
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16,
  },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
});
