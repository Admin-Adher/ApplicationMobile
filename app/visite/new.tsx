import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useCallback, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Visite, VisiteParticipant, VisiteStatus, VisiteType, VisiteChecklistItem } from '@/constants/types';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { genId, formatDateFR } from '@/lib/utils';
import LocationPicker from '@/components/LocationPicker';
import CompanySelector from '@/components/CompanySelector';

// ─── Constants ────────────────────────────────────────────────────────────────

type Recurrence = 'none' | 'weekly' | 'bimonthly';

const VISIT_TYPES: { value: VisiteType; label: string; icon: string; color: string }[] = [
  { value: 'controle',  label: 'Contrôle',  icon: 'clipboard-outline',           color: '#6366F1' },
  { value: 'opr',       label: 'Pré-réception', icon: 'document-text-outline',    color: '#F59E0B' },
  { value: 'securite',  label: 'Sécurité',   icon: 'shield-outline',              color: '#EF4444' },
  { value: 'reception', label: 'Réception',  icon: 'ribbon-outline',              color: '#10B981' },
  { value: 'synthese',  label: 'Synthèse',   icon: 'people-outline',              color: '#3B82F6' },
  { value: 'autre',     label: 'Autre',       icon: 'ellipsis-horizontal-outline', color: '#6B7280' },
];

const RECURRENCE_OPTIONS: { value: Recurrence; label: string; desc: string }[] = [
  { value: 'none',      label: 'Aucune',       desc: 'Visite unique' },
  { value: 'weekly',    label: 'Hebdomadaire',  desc: '4 visites (4 semaines)' },
  { value: 'bimonthly', label: 'Bi-mensuelle',  desc: '4 visites toutes les 2 semaines' },
];

const STATUS_OPTIONS: { value: VisiteStatus; label: string; color: string }[] = [
  { value: 'planned',     label: 'Planifiée', color: '#6366F1' },
  { value: 'in_progress', label: 'En cours',  color: C.inProgress },
  { value: 'completed',   label: 'Terminée',  color: C.closed },
];

const DEADLINE_SUGGESTIONS: { label: string; days: number }[] = [
  { label: '7 j',  days: 7 },
  { label: '15 j', days: 15 },
  { label: '30 j', days: 30 },
  { label: '60 j', days: 60 },
];

const CHECKLIST_TEMPLATES: Record<VisiteType, string[]> = {
  controle: [
    "Avancement des travaux conforme au planning",
    "Approvisionnements matériaux suffisants",
    "Coordination inter-entreprises",
    "Réserves précédentes en cours de levée",
    "Sécurité et signalisation du chantier",
  ],
  opr: [
    "Nettoyage général des locaux",
    "Essais des équipements techniques",
    "Vérification des finitions",
    "Conformité aux plans d'exécution",
    "Documents de fin de chantier (DOE) complets",
    "Levée des réserves de pré-réception précédentes",
  ],
  securite: [
    "Port des EPI (casque, gilet, chaussures)",
    "Balisage des zones dangereuses",
    "Propreté et rangement du chantier",
    "Installations électriques provisoires conformes",
    "Accès et circulation sécurisés sur site",
    "Registre de sécurité à jour",
  ],
  reception: [
    "Nettoyage complet des locaux",
    "Mise en service des équipements",
    "Tests et essais fonctionnels réalisés",
    "Conformité aux plans d'exécution",
    "Remise des notices et manuels (DOE)",
    "Levée de toutes les réserves de pré-réception",
  ],
  synthese: [
    "Tour de table des entreprises présentes",
    "Avancement global du chantier",
    "Points bloquants et actions correctives",
    "Planification à venir",
    "Questions diverses",
  ],
  autre: [
    "Point de situation général",
    "Actions à mener",
    "Date de la prochaine visite",
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

function autoTitle(visitType: VisiteType | null, dateStr: string): string {
  if (!visitType) return '';
  const typeCfg = VISIT_TYPES.find(t => t.value === visitType);
  if (!typeCfg) return '';
  const week = getISOWeek(parseDateFR(dateStr));
  return `${typeCfg.label} — S${week}`;
}

function formatTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + ':' + digits.slice(2);
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function NewVisiteScreen() {
  const router = useRouter();
  const { addVisite, activeChantierId, activeChantier, companies, sitePlans } = useApp();
  const { user, permissions, users } = useAuth();

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

  // Team members available for quick-add
  const teamMembers = useMemo(() =>
    users.filter(u =>
      u.id !== user?.id &&
      !participants.some(p => p.name === u.name)
    ),
    [users, user, participants]
  );

  // ── Auto-suggest title ──────────────────────────────────────────────────────

  const handleVisitTypeChange = useCallback((t: VisiteType) => {
    setVisitType(t);
    if (!titleEdited) setTitle(autoTitle(t, date));
    // Auto-load checklist template if not yet customised
    if (!checklistLoaded || checklistItems.length === 0) {
      const template = CHECKLIST_TEMPLATES[t] ?? [];
      setChecklistItems(template.map(label => ({ id: genId(), label, checked: false })));
      setChecklistLoaded(true);
    }
  }, [titleEdited, date, checklistLoaded, checklistItems.length]);

  const handleDateChange = useCallback((d: string) => {
    setDate(d);
    if (!titleEdited && visitType) setTitle(autoTitle(visitType, d));
  }, [titleEdited, visitType]);

  const handleTitleChange = useCallback((t: string) => {
    setTitle(t);
    setTitleEdited(true);
  }, []);

  function applySuggestedTitle() {
    if (visitType) {
      setTitle(autoTitle(visitType, date));
      setTitleEdited(false);
    }
  }

  // ── Cover photo ─────────────────────────────────────────────────────────────

  async function pickCoverPhoto() {
    const { status: ps } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (ps !== 'granted') {
      Alert.alert('Permission refusée', "L'accès à la galerie est requis.");
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
      Alert.alert('Permission refusée', "L'accès à la caméra est requis.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [16, 9], quality: 0.8 });
    if (!result.canceled && result.assets[0]) setCoverPhotoUri(result.assets[0].uri);
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
    const template = CHECKLIST_TEMPLATES[visitType] ?? [];
    setChecklistItems(template.map(label => ({ id: genId(), label, checked: false })));
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
    if (!title.trim()) {
      Alert.alert('Champ requis', 'Veuillez saisir un titre pour la visite.');
      return;
    }
    if (!date.trim()) {
      Alert.alert('Champ requis', 'Veuillez saisir une date.');
      return;
    }
    setIsSubmitting(true);

    const today          = formatDateFR(new Date());
    const conducteurName = conducteur.trim() || (user?.name ?? 'Équipe BuildTrack');
    const baseDate       = parseDateFR(date);

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
        id: 'VIS-' + genId().slice(0, 8).toUpperCase(),
        chantierId: activeChantierId ?? 'chan1',
        title: visitTitle,
        date: visitDate,
        startTime: startTime.trim() || undefined,
        endTime: endTime.trim() || undefined,
        conducteur: conducteurName,
        status: idx === 0 ? status : 'planned',
        visitType: visitType ?? undefined,
        concernedCompanyIds: concernedCompanyIds.length > 0 ? concernedCompanyIds : undefined,
        building: building || undefined,
        level: level || undefined,
        zone: zone || undefined,
        coverPhotoUri: coverPhotoUri ?? undefined,
        defaultPlanId: defaultPlanId ?? undefined,
        checklistItems: checklistItems.length > 0 ? checklistItems.map(i => ({ ...i, checked: false })) : undefined,
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
    Alert.alert(
      count > 1 ? `${count} visites créées` : 'Visite créée',
      count > 1
        ? `Série "${title.trim()}" planifiée sur ${count} occurrences.`
        : `"${title.trim()}" a été créée.`,
      [{ text: 'OK', onPress: () => { setIsSubmitting(false); router.back(); } }]
    );
  }

  // ── Guard ───────────────────────────────────────────────────────────────────

  if (!permissions.canCreate) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Header title="Nouvelle visite" showBack />
        <Ionicons name="lock-closed-outline" size={48} color="#9CA3AF" />
        <Text style={{ marginTop: 16, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#374151', textAlign: 'center' }}>Accès refusé</Text>
        <Text style={{ marginTop: 8, fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6B7280', textAlign: 'center' }}>
          La création de visites chantier requiert les droits Conducteur ou Chef d'équipe.
        </Text>
      </View>
    );
  }

  const suggestedTitle = visitType ? autoTitle(visitType, date) : '';
  const showSuggestBtn = visitType && title !== suggestedTitle && !!suggestedTitle;
  const checklistDone  = checklistItems.filter(i => i.checked).length;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header title="Nouvelle visite" subtitle={activeChantier?.name ?? ''} showBack />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── 1. TYPE DE VISITE ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>TYPE DE VISITE</Text>
          <View style={styles.typeGrid}>
            {VISIT_TYPES.map(t => {
              const active = visitType === t.value;
              return (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.typeChip, active && { borderColor: t.color, backgroundColor: t.color + '15' }]}
                  onPress={() => handleVisitTypeChange(t.value)}
                  activeOpacity={0.75}
                >
                  <Ionicons name={t.icon as any} size={16} color={active ? t.color : C.textMuted} />
                  <Text style={[styles.typeChipText, active && { color: t.color, fontFamily: 'Inter_600SemiBold' }]}>
                    {t.label}
                  </Text>
                  {active && <Ionicons name="checkmark-circle" size={14} color={t.color} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── 2. PHOTO DE COUVERTURE ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>PHOTO DE COUVERTURE</Text>
          <Text style={styles.sublabel}>Optionnel — photo représentative du chantier ou de la zone visitée</Text>

          {coverPhotoUri ? (
            <View style={styles.coverPhotoWrapper}>
              <Image source={{ uri: coverPhotoUri }} style={styles.coverPhoto} resizeMode="cover" />
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
                <Text style={styles.photoBtnText}>Choisir une photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoBtn} onPress={takeCoverPhoto}>
                <Ionicons name="camera-outline" size={18} color={C.primary} />
                <Text style={styles.photoBtnText}>Prendre une photo</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── 3. INFORMATIONS GÉNÉRALES ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>INFORMATIONS GÉNÉRALES</Text>

          <Text style={styles.label}>Titre de la visite *</Text>
          <View style={styles.titleRow}>
            <TextInput
              style={[styles.input, styles.titleInput]}
              placeholder={visitType ? suggestedTitle : 'Ex: Contrôle — S14'}
              placeholderTextColor={C.textMuted}
              value={title}
              onChangeText={handleTitleChange}
            />
            {showSuggestBtn && (
              <TouchableOpacity style={styles.suggestBtn} onPress={applySuggestedTitle}>
                <Ionicons name="flash-outline" size={15} color={C.primary} />
              </TouchableOpacity>
            )}
          </View>
          {showSuggestBtn && (
            <TouchableOpacity onPress={applySuggestedTitle} style={styles.suggestHint}>
              <Ionicons name="flash-outline" size={11} color={C.primary} />
              <Text style={styles.suggestHintText}>Utiliser « {suggestedTitle} »</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.label}>Conducteur de travaux</Text>
          <TextInput
            style={styles.input}
            placeholder="Nom du responsable"
            placeholderTextColor={C.textMuted}
            value={conducteur}
            onChangeText={setConducteur}
          />

          <View style={styles.dateTimeRow}>
            <View style={{ flex: 2 }}>
              <Text style={styles.label}>Date</Text>
              <DateInput value={date} onChange={handleDateChange} />
            </View>
            <View style={styles.timeBlock}>
              <Text style={styles.label}>Début</Text>
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
              <Text style={styles.label}>Fin</Text>
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

          <Text style={[styles.label, { marginTop: 4 }]}>Statut initial</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.statusChip, status === opt.value && { backgroundColor: opt.color + '20', borderColor: opt.color }]}
                onPress={() => setStatus(opt.value)}
              >
                <Text style={[styles.statusChipText, status === opt.value && { color: opt.value === 'planned' ? '#6366F1' : opt.color }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── 4. LOCALISATION + PLAN ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>LOCALISATION</Text>
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
              <Text style={[styles.label, { marginTop: 12 }]}>Plan de référence</Text>
              <Text style={styles.sublabel}>Plan affiché par défaut lors de la création des réserves depuis cette visite</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[styles.chip, defaultPlanId === null && styles.chipActive]}
                    onPress={() => setDefaultPlanId(null)}
                  >
                    <Ionicons name="close-outline" size={13} color={defaultPlanId === null ? C.primary : C.textMuted} />
                    <Text style={[styles.chipText, defaultPlanId === null && styles.chipTextActive]}>Aucun</Text>
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
        </View>

        {/* ── 5. ENTREPRISES CONCERNÉES ── */}
        {hasCompanies && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>ENTREPRISES CONCERNÉES</Text>
            <Text style={styles.sublabel}>Entreprises inspectées lors de cette visite</Text>
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
                CHECKLIST DE CONTRÔLE
                {checklistItems.length > 0 && (
                  <Text style={{ color: C.textMuted, fontFamily: 'Inter_400Regular' }}>
                    {'  '}{checklistDone}/{checklistItems.length}
                  </Text>
                )}
              </Text>
              {!visitType && checklistItems.length === 0 && (
                <Text style={styles.sublabel}>Sélectionnez un type de visite pour charger un modèle</Text>
              )}
            </View>
            {visitType && checklistItems.length > 0 && (
              <TouchableOpacity onPress={resetChecklistToTemplate} style={styles.resetBtn}>
                <Ionicons name="refresh-outline" size={13} color={C.textMuted} />
                <Text style={styles.resetBtnText}>Modèle</Text>
              </TouchableOpacity>
            )}
          </View>

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
              placeholder="Ajouter un point de contrôle…"
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
          <Text style={styles.sectionLabel}>DÉLAI DE LEVÉE DES RÉSERVES</Text>
          <Text style={styles.sublabel}>
            Date limite cible pour que les entreprises lèvent les réserves relevées lors de cette visite
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
            {reserveDeadlineDate ? `Échéance : ${reserveDeadlineDate}` : 'Ou saisir une date précise'}
          </Text>
          <DateInput value={reserveDeadlineDate} onChange={setReserveDeadlineDate} />
          {reserveDeadlineDate ? (
            <View style={styles.infoHint}>
              <Ionicons name="time-outline" size={13} color={C.inProgress} />
              <Text style={styles.infoHintText}>
                Les réserves créées depuis cette visite auront cette deadline par défaut.
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── 8. PARTICIPANTS ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>PARTICIPANTS ({participants.length})</Text>

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
              <Text style={styles.teamLabel}>Ajout rapide depuis l'équipe</Text>
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
              placeholder="Nom du participant *"
              placeholderTextColor={C.textMuted}
              value={newParticipantName}
              onChangeText={setNewParticipantName}
            />
            <TextInput
              style={[styles.input, { marginBottom: 8 }]}
              placeholder="Fonction / Rôle (ex: Responsable QSE)"
              placeholderTextColor={C.textMuted}
              value={newParticipantRole}
              onChangeText={setNewParticipantRole}
            />
            <Text style={styles.label}>Entreprise</Text>
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
                    <Text style={[styles.chipText, newParticipantCompanyFree !== '' && styles.chipTextActive]}>Autre…</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : null}
            {(!hasCompanies || newParticipantCompanyFree !== '') && (
              <TextInput
                style={[styles.input, { marginBottom: 8 }]}
                placeholder="Nom de l'entreprise"
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
              <Text style={styles.addParticipantBtnText}>Ajouter manuellement</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 9. TAGS ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>MOTS-CLÉS / TAGS</Text>
          <Text style={styles.sublabel}>Facilitez la recherche et le filtrage de vos visites</Text>

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
              placeholder="Ex: toiture, façade, étanche…"
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
          <Text style={styles.sectionLabel}>NOTES & OBJECTIFS</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Objectif de la visite, points particuliers à contrôler, consignes de sécurité..."
            placeholderTextColor={C.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* ── 11. RÉCURRENCE ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>RÉCURRENCE</Text>
          <View style={{ gap: 8 }}>
            {RECURRENCE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.recurrenceChip, recurrence === opt.value && styles.recurrenceChipActive]}
                onPress={() => setRecurrence(opt.value)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.recurrenceChipLabel, recurrence === opt.value && { color: C.primary }]}>{opt.label}</Text>
                  <Text style={styles.recurrenceChipDesc}>{opt.desc}</Text>
                </View>
                {recurrence === opt.value && <Ionicons name="checkmark-circle" size={18} color={C.primary} />}
              </TouchableOpacity>
            ))}
          </View>
          {recurrence !== 'none' && (
            <View style={styles.infoHint}>
              <Ionicons name="repeat-outline" size={13} color={C.inProgress} />
              <Text style={styles.infoHintText}>
                {recurrence === 'weekly' ? '4 visites hebdomadaires' : '4 visites (toutes les 2 semaines)'} seront créées à partir du {date}.
              </Text>
            </View>
          )}
        </View>

        {/* ── 12. RÉSUMÉ ── */}
        {(title.trim() || visitType || participants.length > 0 || checklistItems.length > 0) && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Résumé</Text>
            {visitType && <Text style={styles.summaryLine}>Type : {VISIT_TYPES.find(t => t.value === visitType)?.label}</Text>}
            {title.trim() && <Text style={styles.summaryLine}>Titre : {title.trim()}</Text>}
            {(startTime || endTime) && <Text style={styles.summaryLine}>Horaire : {startTime || '—'} → {endTime || '—'}</Text>}
            {(building || level) && <Text style={styles.summaryLine}>Lieu : {[building, level, zone].filter(Boolean).join(' — ')}</Text>}
            {defaultPlanId && <Text style={styles.summaryLine}>Plan : {chantierPlans.find(p => p.id === defaultPlanId)?.name}</Text>}
            {participants.length > 0 && <Text style={styles.summaryLine}>{participants.length} participant{participants.length > 1 ? 's' : ''} : {participants.map(p => p.name).join(', ')}</Text>}
            {checklistItems.length > 0 && <Text style={styles.summaryLine}>Checklist : {checklistItems.length} point{checklistItems.length > 1 ? 's' : ''} de contrôle</Text>}
            {tags.length > 0 && <Text style={styles.summaryLine}>Tags : {tags.join(', ')}</Text>}
            {reserveDeadlineDate && <Text style={styles.summaryLine}>Délai levée : {reserveDeadlineDate}</Text>}
            {recurrence !== 'none' && <Text style={styles.summaryLine}>Récurrence : {recurrence === 'weekly' ? '4 semaines' : '4 × toutes les 2 semaines'}</Text>}
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
                  {recurrence !== 'none' ? 'Créer la série de visites' : 'Créer la visite'}
                </Text>
              </>
          }
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 60 },

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
    gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5,
    borderColor: C.primary + '50', borderStyle: 'dashed', backgroundColor: C.primaryBg,
  },
  photoBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },
  coverPhotoWrapper: { position: 'relative', borderRadius: 12, overflow: 'hidden' },
  coverPhoto: { width: '100%', height: 160, borderRadius: 12 },
  coverPhotoRemove: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12,
  },

  // Title + suggest
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  dateTimeRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  timeBlock: { flex: 1 },
  timeInput: { textAlign: 'center', letterSpacing: 1 },

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
