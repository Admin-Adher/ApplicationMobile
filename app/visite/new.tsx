import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useCallback, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Visite, VisiteParticipant, VisiteStatus, VisiteType } from '@/constants/types';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { genId, formatDateFR } from '@/lib/utils';
import LocationPicker from '@/components/LocationPicker';

// ─── Constants ────────────────────────────────────────────────────────────────

type Recurrence = 'none' | 'weekly' | 'bimonthly';

const VISIT_TYPES: { value: VisiteType; label: string; icon: string; color: string }[] = [
  { value: 'controle',  label: 'Contrôle',  icon: 'clipboard-outline',           color: '#6366F1' },
  { value: 'opr',       label: 'OPR',        icon: 'document-text-outline',       color: '#F59E0B' },
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

// Quick deadline suggestions relative to today
const DEADLINE_SUGGESTIONS: { label: string; days: number }[] = [
  { label: '7 j',   days: 7 },
  { label: '15 j',  days: 15 },
  { label: '30 j',  days: 30 },
  { label: '60 j',  days: 60 },
];

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

/** Format a time string to HH:MM as user types */
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
  const { addVisite, activeChantierId, activeChantier, companies } = useApp();
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

  // Location
  const [building, setBuilding] = useState('');
  const [level, setLevel]       = useState('');
  const [zone, setZone]         = useState('');

  // Concerned companies
  const [concernedCompanyIds, setConcernedCompanyIds] = useState<string[]>([]);

  // Reserve deadline
  const [reserveDeadlineDate, setReserveDeadlineDate] = useState('');

  // Notes & recurrence
  const [notes, setNotes]           = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Participants
  const [participants, setParticipants]                   = useState<VisiteParticipant[]>([]);
  const [newParticipantName, setNewParticipantName]       = useState('');
  const [newParticipantRole, setNewParticipantRole]       = useState('');
  const [newParticipantCompanyId, setNewParticipantCompanyId] = useState<string | null>(null);
  const [newParticipantCompanyFree, setNewParticipantCompanyFree] = useState('');

  const hasCompanies = companies.length > 0;

  // Team members available for quick-add (exclude already added)
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
  }, [titleEdited, date]);

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

  // ── Companies ───────────────────────────────────────────────────────────────

  function toggleConcernedCompany(id: string) {
    setConcernedCompanyIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  }

  // ── Deadline quick-select ───────────────────────────────────────────────────

  function applyDeadlineSuggestion(days: number) {
    setReserveDeadlineDate(addDays(new Date(), days));
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
    const p: VisiteParticipant = {
      id: genId(),
      name: newParticipantName.trim(),
      company: resolveParticipantCompany(),
      role: newParticipantRole.trim() || undefined,
    };
    setParticipants(prev => [...prev, p]);
    setNewParticipantName('');
    setNewParticipantRole('');
    setNewParticipantCompanyId(null);
    setNewParticipantCompanyFree('');
  }

  /** Quick-add a team member from the org */
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

    const today         = formatDateFR(new Date());
    const conducteurName = conducteur.trim() || (user?.name ?? 'Équipe BuildTrack');
    const baseDate      = parseDateFR(date);

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

  const suggestedTitle  = visitType ? autoTitle(visitType, date) : '';
  const showSuggestBtn  = visitType && title !== suggestedTitle && !!suggestedTitle;

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

        {/* ── TYPE DE VISITE ── */}
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

        {/* ── INFORMATIONS GÉNÉRALES ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>INFORMATIONS GÉNÉRALES</Text>

          {/* Titre */}
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

          {/* Conducteur */}
          <Text style={styles.label}>Conducteur de travaux</Text>
          <TextInput
            style={styles.input}
            placeholder="Nom du responsable"
            placeholderTextColor={C.textMuted}
            value={conducteur}
            onChangeText={setConducteur}
          />

          {/* Date + Heures sur la même ligne */}
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

          {/* Statut */}
          <Text style={[styles.label, { marginTop: 4 }]}>Statut initial</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.statusChip, status === opt.value && { backgroundColor: opt.color + '20', borderColor: opt.color }]}
                onPress={() => setStatus(opt.value)}
              >
                <Text style={[styles.statusChipText, status === opt.value && { color: opt.color }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── LOCALISATION ── */}
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
        </View>

        {/* ── ENTREPRISES CONCERNÉES ── */}
        {hasCompanies && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>ENTREPRISES CONCERNÉES</Text>
            <Text style={styles.sublabel}>Entreprises inspectées lors de cette visite</Text>
            <View style={styles.companyGrid}>
              {companies.map(co => {
                const selected = concernedCompanyIds.includes(co.id);
                return (
                  <TouchableOpacity
                    key={co.id}
                    style={[styles.companyChip, selected && { borderColor: co.color, backgroundColor: co.color + '18' }]}
                    onPress={() => toggleConcernedCompany(co.id)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.companyDot, { backgroundColor: co.color }]} />
                    <Text style={[styles.companyChipText, selected && { color: co.color, fontFamily: 'Inter_600SemiBold' }]}>
                      {co.shortName}
                    </Text>
                    {selected && <Ionicons name="checkmark" size={13} color={co.color} />}
                  </TouchableOpacity>
                );
              })}
            </View>
            {concernedCompanyIds.length > 0 && (
              <Text style={styles.selectionCount}>
                {concernedCompanyIds.length} entreprise{concernedCompanyIds.length > 1 ? 's' : ''} sélectionnée{concernedCompanyIds.length > 1 ? 's' : ''}
              </Text>
            )}
          </View>
        )}

        {/* ── DEADLINE DE LEVÉE DES RÉSERVES ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>DÉLAI DE LEVÉE DES RÉSERVES</Text>
          <Text style={styles.sublabel}>
            Date limite cible pour que les entreprises lèvent les réserves relevées lors de cette visite
          </Text>

          {/* Quick suggestions */}
          <View style={styles.deadlineRow}>
            {DEADLINE_SUGGESTIONS.map(s => {
              const suggested = addDays(new Date(), s.days);
              const active = reserveDeadlineDate === suggested;
              return (
                <TouchableOpacity
                  key={s.days}
                  style={[styles.deadlineChip, active && styles.deadlineChipActive]}
                  onPress={() => setReserveDeadlineDate(active ? '' : suggested)}
                >
                  <Text style={[styles.deadlineChipText, active && styles.deadlineChipTextActive]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {reserveDeadlineDate ? (
              <TouchableOpacity
                style={styles.deadlineClearBtn}
                onPress={() => setReserveDeadlineDate('')}
              >
                <Ionicons name="close-circle-outline" size={16} color={C.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Or pick exact date */}
          <Text style={[styles.label, { marginTop: 8 }]}>
            {reserveDeadlineDate ? `Échéance : ${reserveDeadlineDate}` : 'Ou saisir une date précise'}
          </Text>
          <DateInput value={reserveDeadlineDate} onChange={setReserveDeadlineDate} />

          {reserveDeadlineDate ? (
            <View style={styles.deadlineHint}>
              <Ionicons name="time-outline" size={13} color={C.inProgress} />
              <Text style={styles.deadlineHintText}>
                Les réserves créées depuis cette visite auront cette deadline par défaut.
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── PARTICIPANTS ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>PARTICIPANTS ({participants.length})</Text>

          {/* Added participants list */}
          {participants.map(p => (
            <View key={p.id} style={styles.participantRow}>
              <View style={styles.participantAvatar}>
                <Text style={styles.participantAvatarText}>{initials(p.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.participantName}>{p.name}</Text>
                <Text style={styles.participantMeta}>
                  {[p.role, p.company].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => removeParticipant(p.id)} hitSlop={8}>
                <Ionicons name="close-circle-outline" size={18} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          ))}

          {/* Quick-add from team */}
          {teamMembers.length > 0 && (
            <View style={[styles.teamSection, participants.length > 0 && { marginTop: 12 }]}>
              <Text style={styles.teamLabel}>
                <Ionicons name="people-outline" size={12} color={C.textMuted} />
                {'  '}Ajout rapide depuis l'équipe
              </Text>
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

          {/* Manual add form */}
          <View style={{ marginTop: participants.length > 0 || teamMembers.length > 0 ? 8 : 0 }}>
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
                    <Text style={[styles.chipText, newParticipantCompanyId === null && newParticipantCompanyFree === '' && styles.chipTextActive]}>
                      —
                    </Text>
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
                    <Text style={[styles.chipText, newParticipantCompanyFree !== '' && styles.chipTextActive]}>
                      Autre…
                    </Text>
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

        {/* ── NOTES ── */}
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

        {/* ── RÉCURRENCE ── */}
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
            <View style={styles.recurrenceHint}>
              <Ionicons name="repeat-outline" size={13} color={C.inProgress} />
              <Text style={styles.recurrenceHintText}>
                {recurrence === 'weekly' ? '4 visites hebdomadaires' : '4 visites (toutes les 2 semaines)'} seront créées à partir du {date}.
              </Text>
            </View>
          )}
        </View>

        {/* ── RÉSUMÉ AVANT VALIDATION ── */}
        {(title.trim() || visitType || participants.length > 0) && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>
              <Ionicons name="checkmark-circle-outline" size={14} color={C.primary} />
              {'  '}Résumé
            </Text>
            {visitType && <Text style={styles.summaryLine}>Type : {VISIT_TYPES.find(t => t.value === visitType)?.label}</Text>}
            {title.trim() && <Text style={styles.summaryLine}>Titre : {title.trim()}</Text>}
            {(startTime || endTime) && (
              <Text style={styles.summaryLine}>
                Horaire : {startTime || '—'} → {endTime || '—'}
              </Text>
            )}
            {(building || level) && (
              <Text style={styles.summaryLine}>
                Lieu : {[building, level, zone].filter(Boolean).join(' — ')}
              </Text>
            )}
            {participants.length > 0 && (
              <Text style={styles.summaryLine}>
                {participants.length} participant{participants.length > 1 ? 's' : ''} : {participants.map(p => p.name).join(', ')}
              </Text>
            )}
            {reserveDeadlineDate && (
              <Text style={styles.summaryLine}>Délai levée : {reserveDeadlineDate}</Text>
            )}
            {recurrence !== 'none' && (
              <Text style={styles.summaryLine}>
                Récurrence : {recurrence === 'weekly' ? '4 semaines' : '4 × toutes les 2 semaines'}
              </Text>
            )}
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
    marginBottom: 12, marginTop: -6, lineHeight: 16,
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

  // Date + time row
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

  // Deadline
  deadlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  deadlineChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  deadlineChipActive: { borderColor: C.inProgress, backgroundColor: C.inProgress + '15' },
  deadlineChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  deadlineChipTextActive: { color: C.inProgress, fontFamily: 'Inter_600SemiBold' },
  deadlineClearBtn: { padding: 4 },
  deadlineHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4,
    backgroundColor: C.inProgress + '12', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: C.inProgress + '30',
  },
  deadlineHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress, lineHeight: 16 },

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

  // Team quick-add
  teamSection: {},
  teamLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted },
  teamMemberChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
    marginRight: 8,
  },
  teamMemberAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.primary + '20', alignItems: 'center', justifyContent: 'center',
  },
  teamMemberAvatarText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.primary },
  teamMemberName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.text },
  teamMemberRole: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 12 },

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

  addParticipantBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: C.primary, borderRadius: 10, paddingVertical: 10, marginTop: 4,
  },
  addParticipantBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  // Recurrence
  recurrenceChip: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  recurrenceChipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  recurrenceChipLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  recurrenceChipDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  recurrenceHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    backgroundColor: C.inProgress + '12', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: C.inProgress + '30',
  },
  recurrenceHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress, lineHeight: 16 },

  // Summary card
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
