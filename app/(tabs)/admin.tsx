import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Modal, Platform, ActivityIndicator, Linking, KeyboardAvoidingView,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { UserRole, Company } from '@/constants/types';
import { isSupabaseConfigured } from '@/lib/supabase';
import { genId } from '@/lib/utils';
import { ROLES, ROLE_INFO, PLAN_COLORS, FREE_ROLES, AVATAR_COLORS, hashColor, formatDate } from '@/lib/adminUtils';

const WINDOW_H = Dimensions.get('window').height;
const MODAL_SCROLL_MAX_H = WINDOW_H * 0.62;
const EDIT_SCROLL_MAX_H = WINDOW_H * 0.46;

function SafeKAV({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {children}
      </KeyboardAvoidingView>
    );
  }
  return <View style={{ flex: 1 }}>{children}</View>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any; hint?: string }> = {
  trial:     { label: "Période d'essai",  color: '#F59E0B', bg: '#FFFBEB', icon: 'time-outline' },
  active:    { label: 'Actif',            color: '#10B981', bg: '#ECFDF5', icon: 'checkmark-circle-outline' },
  suspended: {
    label: 'Suspendu',
    color: '#EF4444', bg: '#FEF2F2', icon: 'warning-outline',
    hint: 'Votre abonnement est suspendu. Contactez le support BuildTrack pour réactiver votre compte.',
  },
  expired:   {
    label: 'Expiré',
    color: '#6B7280', bg: '#F3F4F6', icon: 'close-circle-outline',
    hint: 'Votre période d\'essai ou abonnement a expiré. Renouvelez votre plan pour continuer.',
  },
};

const COMPANY_COLORS = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#06B6D4','#F97316','#EC4899','#14B8A6','#84CC16',
];

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

function RoleBadge({ role }: { role: string }) {
  const r = ROLES.find(x => x.value === role) ?? ROLE_INFO[role];
  if (!r) return null;
  return (
    <View style={[styles.roleBadge, { backgroundColor: r.bg }]}>
      <Text style={[styles.roleBadgeText, { color: r.color }]}>{r.label}</Text>
    </View>
  );
}

function InitialAvatar({ name, color }: { name: string; color: string }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={[styles.avatar, { backgroundColor: color + '22' }]}>
      <Text style={[styles.avatarText, { color }]}>{initials}</Text>
    </View>
  );
}

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const router = useRouter();

  const { user, updateUserRole, updateUserCompany, deleteUserProfile } = useAuth();
  const { companies, lots, addCompany, updateCompanyFull, deleteCompany, updateCompanyWorkers, updateCompanyHours } = useApp();
  const {
    plan, subscription, seatUsed, seatMax, canInvite, isLoading,
    pendingInvitations, inviteUser, cancelInvitation, orgUsers,
    activeOrgUsers, freeOrgUsers,
  } = useSubscription();

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [activeTab, setActiveTab] = useState<'users' | 'companies' | 'abonnement'>('users');

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const [inviteModal, setInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteEmailError, setInviteEmailError] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('observateur');
  const [inviteCompanyId, setInviteCompanyId] = useState<string>('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [roleModal, setRoleModal] = useState<{ id: string; name: string; email: string; currentRole: UserRole; currentCompanyId?: string } | null>(null);
  const [editCompanyId, setEditCompanyId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const [companySearch, setCompanySearch] = useState('');
  const [companyModal, setCompanyModal] = useState<{ mode: 'add' | 'edit'; company?: Company } | null>(null);
  const [nom, setNom] = useState('');
  const [nomCourt, setNomCourt] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [selectedLots, setSelectedLots] = useState<string[]>([]);
  const [effectif, setEffectif] = useState('');
  const [heures, setHeures] = useState('');
  const [siret, setSiret] = useState('');
  const [insurance, setInsurance] = useState('');
  const [selectedColor, setSelectedColor] = useState(COMPANY_COLORS[0]);

  const workerDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const hoursDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const debouncedWorkerUpdate = useCallback((id: string, value: number) => {
    if (workerDebounce.current[id]) clearTimeout(workerDebounce.current[id]);
    workerDebounce.current[id] = setTimeout(() => updateCompanyWorkers(id, value), 600);
  }, [updateCompanyWorkers]);

  const debouncedHoursUpdate = useCallback((id: string, value: number) => {
    if (hoursDebounce.current[id]) clearTimeout(hoursDebounce.current[id]);
    hoursDebounce.current[id] = setTimeout(() => updateCompanyHours(id, value), 600);
  }, [updateCompanyHours]);

  const [workerLocalMap, setWorkerLocalMap] = useState<Record<string, number>>({});
  const [hoursLocalMap, setHoursLocalMap] = useState<Record<string, number>>({});
  const [hoursEditId, setHoursEditId] = useState<string | null>(null);
  const [hoursInputVal, setHoursInputVal] = useState('');

  useEffect(() => {
    const w: Record<string, number> = {};
    const h: Record<string, number> = {};
    companies.forEach(c => { w[c.id] = c.actualWorkers; h[c.id] = c.hoursWorked ?? 0; });
    setWorkerLocalMap(w);
    setHoursLocalMap(h);
  }, [companies]);

  const isCompanyFormDirty = !!(nom.trim() || nomCourt.trim() || phone.trim() || email.trim() || selectedLots.length > 0 || effectif.trim() || siret.trim() || insurance.trim());

  const isEditDirty = companyModal?.mode === 'edit' && !!companyModal.company && (
    nom.trim() !== companyModal.company.name ||
    nomCourt.trim().toUpperCase() !== companyModal.company.shortName ||
    effectif !== String(companyModal.company.plannedWorkers) ||
    heures !== String(companyModal.company.hoursWorked ?? 0) ||
    JSON.stringify([...selectedLots].sort()) !== JSON.stringify([...(companyModal.company.lots ?? [])].sort()) ||
    (phone.trim() || '') !== (companyModal.company.phone ?? '') ||
    (email.trim() || '') !== (companyModal.company.email ?? '') ||
    siret.trim() !== (companyModal.company.siret ?? '') ||
    insurance.trim() !== (companyModal.company.insurance ?? '') ||
    selectedColor !== companyModal.company.color
  );

  const filteredUsers = useMemo(() => {
    let list = [...orgUsers];
    if (roleFilter !== 'all') list = list.filter(u => u.role === roleFilter);
    if (userSearch.trim()) {
      const q = userSearch.toLowerCase();
      list = list.filter(u => {
        const companyName = (companies.find(c => c.id === u.companyId)?.name ?? '').toLowerCase();
        return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || companyName.includes(q);
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }, [orgUsers, userSearch, roleFilter, companies]);

  const filteredCompanies = useMemo(() => {
    let list = [...companies].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    if (!companySearch.trim()) return list;
    const q = companySearch.toLowerCase();
    return list.filter(co => {
      const coLotNames = (co.lots ?? [])
        .map(lid => lots.find(l => l.id === lid)?.name ?? '')
        .join(' ').toLowerCase();
      return (
        co.name.toLowerCase().includes(q) ||
        co.shortName.toLowerCase().includes(q) ||
        (co.email ?? '').toLowerCase().includes(q) ||
        (co.phone ?? '').includes(q) ||
        (co.siret ?? '').replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
        coLotNames.includes(q)
      );
    });
  }, [companies, companySearch, lots]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    ROLES.forEach(r => { counts[r.value] = 0; });
    orgUsers.forEach(u => {
      if (counts[u.role] !== undefined) counts[u.role]++;
    });
    return counts;
  }, [orgUsers]);

  const trialDaysLeft = useMemo(() => {
    if (!subscription?.trialEndsAt) return null;
    return Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }, [subscription]);

  const statusCfg = subscription ? (STATUS_CONFIG[subscription.status] ?? STATUS_CONFIG.trial) : null;

  const superAdminCount = useMemo(() => orgUsers.filter(u => u.role === 'super_admin').length, [orgUsers]);
  const rolesTotal = useMemo(() => Object.values(roleCounts).reduce((s, n) => s + n, 0) + superAdminCount, [roleCounts, superAdminCount]);

  const seatRatio = seatMax === -1 ? 0 : seatUsed / seatMax;
  const seatBarColor = seatRatio >= 0.9 ? '#EF4444' : seatRatio >= 0.7 ? '#F59E0B' : '#10B981';
  const isSeatFull = !canInvite;
  const isSelectedRoleFree = FREE_ROLES.includes(inviteRole);
  const sendDisabled = isSeatFull && !isSelectedRoleFree;

  const companyUserCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    orgUsers.forEach(u => {
      if (u.companyId) counts[u.companyId] = (counts[u.companyId] ?? 0) + 1;
    });
    return counts;
  }, [orgUsers]);

  const getInviterName = useCallback((invitedBy: string) => {
    const found = orgUsers.find(u => u.id === invitedBy);
    return found ? found.name : 'Admin';
  }, [orgUsers]);

  useEffect(() => {
    if (user && !isAdmin) {
      router.navigate('/(tabs)/' as any);
    }
  }, [user, isAdmin]);

  if (user && !isAdmin) {
    return null;
  }

  async function handleSendInvite() {
    const emailTrimmed = inviteEmail.trim();
    if (!emailTrimmed) return;
    if (!isValidEmail(emailTrimmed)) {
      setInviteEmailError('Adresse email invalide (ex : prenom.nom@exemple.fr).');
      return;
    }
    setInviteEmailError('');
    setInviteSending(true);
    const result = await inviteUser(
      emailTrimmed,
      inviteRole,
      inviteRole === 'sous_traitant' && inviteCompanyId ? inviteCompanyId : undefined
    );
    setInviteSending(false);
    if (result.success) {
      setInviteToken(result.token ?? null);
    } else {
      Alert.alert('Invitation impossible', result.error ?? 'Erreur inconnue.');
    }
  }

  function handleCloseInviteModal() {
    setInviteModal(false);
    setInviteEmail('');
    setInviteEmailError('');
    setInviteRole('observateur');
    setInviteCompanyId('');
    setInviteToken(null);
    setTokenCopied(false);
  }

  function handleCopyToken() {
    if (!inviteToken) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(inviteToken).then(() => {
        setTokenCopied(true);
        setTimeout(() => setTokenCopied(false), 2500);
      }).catch(() => Alert.alert('Token', inviteToken));
    } else {
      Alert.alert('Token d\'invitation', inviteToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2500);
    }
  }

  function handleCancelInvitation(id: string, emailAddr: string) {
    Alert.alert(
      'Annuler l\'invitation',
      `Annuler l'invitation envoyée à ${emailAddr} ?`,
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Annuler l\'invitation', style: 'destructive',
          onPress: async () => {
            await cancelInvitation(id);
            showToast('Invitation annulée');
          },
        },
      ]
    );
  }

  const [editRole, setEditRole] = useState<UserRole>('observateur');

  function openEditUserModal(u: { id: string; name: string; email: string; role: UserRole; companyId?: string }) {
    setEditRole(u.role);
    setEditCompanyId(u.companyId ?? '');
    setRoleModal({ id: u.id, name: u.name, email: u.email, currentRole: u.role, currentCompanyId: u.companyId });
  }

  function closeEditUserModal() {
    setRoleModal(null);
  }

  async function handleSaveUserEdit() {
    if (!roleModal) return;
    const newRole = editRole;
    const newCompanyId = editCompanyId || null;
    const roleChanged = newRole !== roleModal.currentRole;
    const companyChanged = (newCompanyId ?? undefined) !== roleModal.currentCompanyId;

    if (!roleChanged && !companyChanged) { setRoleModal(null); return; }

    if (roleChanged && roleModal.id === user?.id && newRole !== 'admin') {
      Alert.alert('Action impossible', 'Vous ne pouvez pas retirer votre propre rôle admin.');
      return;
    }
    if (roleChanged) {
      const isPaidRole = !FREE_ROLES.includes(newRole);
      const wasFreeRole = FREE_ROLES.includes(roleModal.currentRole);
      if (isPaidRole && wasFreeRole && !canInvite) {
        Alert.alert(
          'Sièges insuffisants',
          `Limite de ${seatMax} siège${seatMax > 1 ? 's' : ''} atteinte. Ce changement de rôle requiert un siège disponible.`,
          [{ text: 'OK', style: 'cancel' }]
        );
        return;
      }
      if (roleModal.currentRole === 'admin' && newRole !== 'admin') {
        const remainingAdmins = orgUsers.filter(u => u.role === 'admin' && u.id !== roleModal.id).length;
        if (remainingAdmins === 0) {
          Alert.alert(
            'Dernier administrateur',
            `${roleModal.name} est le seul administrateur. En changeant son rôle, plus personne ne pourra gérer les accès.\n\nConfirmez-vous ?`,
            [
              { text: 'Annuler', style: 'cancel' },
              {
                text: 'Changer quand même', style: 'destructive',
                onPress: () => doSaveUserEdit(newRole, newCompanyId, roleChanged, companyChanged),
              },
            ]
          );
          return;
        }
      }
    }
    await doSaveUserEdit(newRole, newCompanyId, roleChanged, companyChanged);
  }

  async function doSaveUserEdit(
    newRole: UserRole,
    newCompanyId: string | null,
    roleChanged: boolean,
    companyChanged: boolean,
  ) {
    if (!roleModal) return;
    setSaving(true);
    try {
      if (roleChanged) await updateUserRole(roleModal.id, newRole);
      if (companyChanged) await updateUserCompany(roleModal.id, newCompanyId);
      setRoleModal(null);
      const parts = [];
      if (roleChanged) parts.push('rôle');
      if (companyChanged) parts.push('entreprise');
      showToast(`${parts.join(' & ')} mis à jour`);
    } catch {
      showToast('Erreur — modifications non enregistrées');
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteUser(u: { id: string; name: string; role: string }) {
    if (u.id === user?.id) {
      Alert.alert('Action impossible', 'Vous ne pouvez pas supprimer votre propre compte.');
      return;
    }
    const isPaidSeat = !FREE_ROLES.includes(u.role as UserRole);
    const seatNote = isPaidSeat ? '\n\nCela libèrera 1 siège dans votre quota.' : '';
    Alert.alert(
      'Retirer l\'utilisateur',
      `Retirer "${u.name}" de l'organisation ?${seatNote}\n\nIl ne pourra plus accéder à BuildTrack.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer', style: 'destructive',
          onPress: async () => {
            await deleteUserProfile(u.id);
            showToast(`${u.name} retiré(e) de l'organisation`);
          },
        },
      ]
    );
  }

  function openAddCompany() {
    setNom(''); setNomCourt(''); setPhone(''); setEmail(''); setSelectedLots([]); setEffectif('');
    setHeures('0'); setSiret(''); setInsurance('');
    setSelectedColor(COMPANY_COLORS[companies.length % COMPANY_COLORS.length]);
    setCompanyModal({ mode: 'add' });
  }

  function openEditCompany(co: Company) {
    setNom(co.name); setNomCourt(co.shortName); setPhone(co.phone ?? '');
    setEmail(co.email ?? ''); setSelectedLots(co.lots ?? []);
    setEffectif(String(co.plannedWorkers));
    setHeures(String(co.hoursWorked ?? 0));
    setSiret(co.siret ?? '');
    setInsurance(co.insurance ?? '');
    setSelectedColor(co.color);
    setCompanyModal({ mode: 'edit', company: co });
  }

  function tryCloseCompanyModal() {
    const isDirty = (companyModal?.mode === 'add' && isCompanyFormDirty) || isEditDirty;
    if (isDirty) {
      Alert.alert(
        'Abandonner les modifications ?',
        companyModal?.mode === 'edit' ? 'Les modifications non enregistrées seront perdues.' : 'Les données saisies seront perdues.',
        [
          { text: 'Continuer l\'édition', style: 'cancel' },
          { text: 'Abandonner', style: 'destructive', onPress: () => setCompanyModal(null) },
        ]
      );
    } else {
      setCompanyModal(null);
    }
  }

  function handleSaveCompany() {
    if (!nom.trim() || !nomCourt.trim() || !effectif.trim()) {
      Alert.alert('Champs requis', 'Le nom, le sigle et l\'effectif prévu sont obligatoires.');
      return;
    }
    const planned = parseInt(effectif, 10);
    if (isNaN(planned) || planned < 0) {
      Alert.alert('Valeur invalide', 'L\'effectif doit être un entier positif.');
      return;
    }
    const heuresToFloat = parseFloat(String(heures).replace(',', '.'));
    if (heures.trim() && (isNaN(heuresToFloat) || heuresToFloat < 0)) {
      Alert.alert('Valeur invalide', 'Les heures travaillées doivent être un nombre positif.');
      return;
    }
    const hrs = isNaN(heuresToFloat) ? 0 : Math.max(0, heuresToFloat);
    const duplicate = companies.find(c =>
      c.name.toLowerCase() === nom.trim().toLowerCase() &&
      (companyModal?.mode === 'add' || c.id !== companyModal?.company?.id)
    );
    if (duplicate) {
      Alert.alert('Doublon', `Une entreprise nommée "${nom.trim()}" existe déjà.`);
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      Alert.alert('Email invalide', 'Vérifiez l\'adresse email de contact.');
      return;
    }
    if (siret.trim() && !/^\d{14}$/.test(siret.trim().replace(/\s/g, ''))) {
      Alert.alert('SIRET invalide', 'Le numéro SIRET doit contenir exactement 14 chiffres.');
      return;
    }
    if (companyModal?.mode === 'edit' && companyModal.company) {
      updateCompanyFull({
        ...companyModal.company,
        name: nom.trim(),
        shortName: nomCourt.trim().toUpperCase(),
        plannedWorkers: planned,
        hoursWorked: hrs,
        zone: '',
        lots: selectedLots,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        siret: siret.trim() || undefined,
        insurance: insurance.trim() || undefined,
        color: selectedColor,
      });
      showToast('Entreprise mise à jour');
    } else {
      addCompany({
        id: genId(),
        name: nom.trim(),
        shortName: nomCourt.trim().toUpperCase(),
        color: selectedColor,
        plannedWorkers: planned,
        actualWorkers: 0,
        hoursWorked: hrs,
        zone: '',
        lots: selectedLots,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        siret: siret.trim() || undefined,
        insurance: insurance.trim() || undefined,
      });
      showToast('Entreprise ajoutée');
    }
    setCompanyModal(null);
  }

  function handleDeleteCompany(co: Company) {
    const linkedCount = companyUserCounts[co.id] ?? 0;
    const linkedNote = linkedCount > 0
      ? `\n\n⚠️ ${linkedCount} sous-traitant${linkedCount > 1 ? 's' : ''} lié${linkedCount > 1 ? 's' : ''} perdr${linkedCount > 1 ? 'ont' : 'a'} l'accès à cette entreprise.`
      : '';
    Alert.alert(
      'Supprimer l\'entreprise',
      `Supprimer "${co.name}" définitivement ?\n\nLes réserves associées resteront sans entreprise assignée.${linkedNote}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: () => { deleteCompany(co.id); showToast(`"${co.name}" supprimée`); },
        },
      ]
    );
  }

  function handleWorkerCount(co: Company, delta: number) {
    const prev = workerLocalMap[co.id] ?? co.actualWorkers;
    const next = Math.max(0, prev + delta);
    setWorkerLocalMap(m => ({ ...m, [co.id]: next }));
    debouncedWorkerUpdate(co.id, next);
  }

  function handleHoursChange(co: Company, delta: number) {
    const prev = hoursLocalMap[co.id] ?? (co.hoursWorked ?? 0);
    const next = Math.max(0, prev + delta);
    setHoursLocalMap(m => ({ ...m, [co.id]: next }));
    debouncedHoursUpdate(co.id, next);
  }

  function startHoursEdit(co: Company) {
    const current = hoursLocalMap[co.id] ?? (co.hoursWorked ?? 0);
    setHoursEditId(co.id);
    setHoursInputVal(String(current));
  }

  function commitHoursEdit(co: Company) {
    const parsed = parseFloat(hoursInputVal.replace(',', '.'));
    const next = isNaN(parsed) ? (hoursLocalMap[co.id] ?? 0) : Math.max(0, parsed);
    setHoursLocalMap(m => ({ ...m, [co.id]: next }));
    debouncedHoursUpdate(co.id, next);
    setHoursEditId(null);
    setHoursInputVal('');
  }

  return (
    <View style={styles.container}>
      {toast && (
        <View style={[styles.toast, { top: topPad + 12, pointerEvents: 'none' }]}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Administration</Text>
            <Text style={styles.subtitle}>Gestion des accès et des équipes</Text>
          </View>
          {(() => {
            const roleInfo = ROLE_INFO[user?.role ?? 'admin'];
            const badgeColor = roleInfo?.color ?? '#EF4444';
            const badgeBg = roleInfo?.bg ?? '#FEF2F2';
            const badgeLabel = roleInfo?.label ?? 'Admin';
            return (
              <View style={[styles.adminBadge, { backgroundColor: badgeBg, borderColor: badgeColor + '44' }]}>
                <Ionicons name="shield-checkmark" size={14} color={badgeColor} />
                <Text style={[styles.adminBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
              </View>
            );
          })()}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScrollRow} contentContainerStyle={styles.tabRowContent}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'users' && styles.tabBtnActive]}
            onPress={() => setActiveTab('users')}
          >
            <Ionicons name="people" size={14} color={activeTab === 'users' ? C.primary : C.textMuted} />
            <Text style={[styles.tabBtnText, activeTab === 'users' && styles.tabBtnTextActive]}>Utilisateurs</Text>
            <View style={[styles.tabCount, activeTab === 'users' && styles.tabCountActive]}>
              <Text style={[styles.tabCountText, activeTab === 'users' && styles.tabCountTextActive]}>{rolesTotal}</Text>
            </View>
            {pendingInvitations.length > 0 && (
              <View style={styles.tabBadgeDot}>
                <Text style={styles.tabBadgeDotText}>{pendingInvitations.length}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'companies' && styles.tabBtnActive]}
            onPress={() => setActiveTab('companies')}
          >
            <Ionicons name="business" size={14} color={activeTab === 'companies' ? C.primary : C.textMuted} />
            <Text style={[styles.tabBtnText, activeTab === 'companies' && styles.tabBtnTextActive]}>Entreprises</Text>
            <View style={[styles.tabCount, activeTab === 'companies' && styles.tabCountActive]}>
              <Text style={[styles.tabCountText, activeTab === 'companies' && styles.tabCountTextActive]}>{companies.length}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'abonnement' && styles.tabBtnActive]}
            onPress={() => setActiveTab('abonnement')}
            accessibilityRole="tab"
            accessibilityLabel="Onglet Abonnement"
          >
            <Ionicons name="card" size={14} color={activeTab === 'abonnement' ? C.primary : C.textMuted} />
            <Text style={[styles.tabBtnText, activeTab === 'abonnement' && styles.tabBtnTextActive]}>Abonnement</Text>
            {(subscription?.status === 'suspended' || subscription?.status === 'expired') && (
              <View style={styles.tabAlertDot} />
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* ─── ONGLET UTILISATEURS ─── */}
      {activeTab === 'users' && (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {isLoading && (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <ActivityIndicator size="large" color={C.primary} />
              <Text style={{ marginTop: 10, fontSize: 13, color: C.textMuted, fontFamily: 'Inter_400Regular' }}>
                Chargement des membres…
              </Text>
            </View>
          )}
          <View style={styles.statsGrid}>
            {ROLES.map(r => (
              <TouchableOpacity
                key={r.value}
                style={[styles.statCard, { borderTopColor: r.color }, roleFilter === r.value && { borderColor: r.color, backgroundColor: r.bg }]}
                onPress={() => setRoleFilter(roleFilter === r.value ? 'all' : r.value)}
                accessibilityRole="button"
                accessibilityLabel={`Filtrer par ${r.label} — ${roleCounts[r.value] ?? 0}`}
              >
                <Text style={[styles.statNum, { color: r.color }]}>{roleCounts[r.value] ?? 0}</Text>
                <Text style={styles.statLabel} numberOfLines={2}>{r.label}</Text>
              </TouchableOpacity>
            ))}
            {superAdminCount > 0 && (
              <TouchableOpacity
                style={[styles.statCard, { borderTopColor: '#7C3AED' }, roleFilter === 'super_admin' && { borderColor: '#7C3AED', backgroundColor: '#F5F3FF' }]}
                onPress={() => setRoleFilter(roleFilter === 'super_admin' ? 'all' : 'super_admin')}
                accessibilityRole="button"
                accessibilityLabel={`Filtrer par Super Admin — ${superAdminCount}`}
              >
                <Text style={[styles.statNum, { color: '#7C3AED' }]}>{superAdminCount}</Text>
                <Text style={styles.statLabel} numberOfLines={2}>Super Admin</Text>
              </TouchableOpacity>
            )}
          </View>

          {roleFilter !== 'all' && (
            <TouchableOpacity style={styles.filterActiveBanner} onPress={() => setRoleFilter('all')}>
              <Ionicons name="funnel" size={13} color={C.primary} />
              <Text style={styles.filterActiveTxt}>
                Filtre : {(ROLES.find(r => r.value === roleFilter) ?? ROLE_INFO[roleFilter])?.label ?? roleFilter}
              </Text>
              <Ionicons name="close-circle" size={15} color={C.primary} />
            </TouchableOpacity>
          )}

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>
              {userSearch.trim() || roleFilter !== 'all'
                ? `${filteredUsers.length} / ${rolesTotal} utilisateur${rolesTotal !== 1 ? 's' : ''}`
                : `${rolesTotal} utilisateur${rolesTotal !== 1 ? 's' : ''}`}
            </Text>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => setInviteModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Inviter un nouveau membre"
            >
              <Ionicons name="person-add-outline" size={17} color="#fff" />
              <Text style={styles.addBtnText}>Inviter</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={15} color={C.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Nom, email ou entreprise..."
              placeholderTextColor={C.textMuted}
              value={userSearch}
              onChangeText={setUserSearch}
            />
            {userSearch.length > 0 && (
              <TouchableOpacity onPress={() => setUserSearch('')}>
                <Ionicons name="close-circle" size={15} color={C.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {!isSupabaseConfigured && (
            <View style={styles.infoBanner}>
              <Ionicons name="information-circle-outline" size={15} color={C.inProgress} />
              <Text style={styles.infoBannerText}>Mode hors-ligne — modifications non persistantes</Text>
            </View>
          )}

          {filteredUsers.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name={orgUsers.length === 0 ? 'people-outline' : 'search-outline'} size={36} color={C.textMuted} />
              <Text style={styles.emptyText}>
                {orgUsers.length === 0 ? 'Aucun utilisateur dans l\'organisation' : 'Aucun résultat'}
              </Text>
              {orgUsers.length === 0 && (
                <Text style={styles.emptyHint}>Utilisez le bouton "Inviter" pour ajouter des membres</Text>
              )}
              {orgUsers.length > 0 && roleFilter !== 'all' && userSearch.trim() && (
                <Text style={styles.emptyHint}>
                  Filtre rôle + recherche "{userSearch}" actifs — aucune correspondance
                </Text>
              )}
            </View>
          ) : (
            filteredUsers.map(u => {
              const avatarColor = hashColor(u.id, AVATAR_COLORS);
              const isCurrentUser = u.id === user?.id;
              return (
                <View key={u.id} style={[styles.userCard, isCurrentUser && styles.userCardSelf]}>
                  <InitialAvatar name={u.name} color={avatarColor} />
                  <View style={styles.userInfo}>
                    <View style={styles.userNameRow}>
                      <Text style={styles.userName}>{u.name}</Text>
                      {isCurrentUser && (
                        <View style={styles.selfBadge}>
                          <Text style={styles.selfBadgeText}>Vous</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.userEmail}>{u.email}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 3 }}>
                      <RoleBadge role={u.role} />
                      {u.companyId && (() => {
                        const co = companies.find(c => c.id === u.companyId);
                        if (!co) return null;
                        return (
                          <View style={[styles.companyBadge, { backgroundColor: co.color + '18', borderColor: co.color + '55' }]}>
                            <View style={[styles.companyBadgeDot, { backgroundColor: co.color }]} />
                            <Text style={[styles.companyBadgeText, { color: co.color }]} numberOfLines={1}>{co.shortName}</Text>
                          </View>
                        );
                      })()}
                    </View>
                  </View>
                  <View style={styles.userActions}>
                    {!isCurrentUser && (
                      <TouchableOpacity
                        style={styles.iconBtnLabelled}
                        onPress={() => openEditUserModal({ id: u.id, name: u.name, email: u.email, role: u.role, companyId: u.companyId })}
                        accessibilityRole="button"
                        accessibilityLabel={`Modifier ${u.name}`}
                      >
                        <Ionicons name="create-outline" size={15} color={C.primary} />
                        <Text style={styles.iconBtnLabelText}>Éditer</Text>
                      </TouchableOpacity>
                    )}
                    {!isCurrentUser && <View style={styles.coActionSep} />}
                    {!isCurrentUser && (
                      <TouchableOpacity
                        style={[styles.iconBtnLabelled, styles.iconBtnLabelledDanger]}
                        onPress={() => handleDeleteUser(u)}
                        accessibilityRole="button"
                        accessibilityLabel={`Retirer ${u.name} de l'organisation`}
                      >
                        <Ionicons name="trash-outline" size={15} color={C.open} />
                        <Text style={[styles.iconBtnLabelText, { color: C.open }]}>Retirer</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}

          {pendingInvitations.length > 0 && (
            <>
              <View style={styles.sectionSep} />
              <Text style={styles.subSectionTitle}>Invitations en attente ({pendingInvitations.length})</Text>
              {pendingInvitations.map(inv => {
                const roleInfo = ROLES.find(r => r.value === inv.role) ?? ROLES[3];
                const expiresIn = Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                const inviterName = getInviterName(inv.invitedBy);
                const isExpired = expiresIn <= 0;
                return (
                  <View key={inv.id} style={[styles.inviteCard, isExpired && styles.inviteCardExpired]}>
                    <View style={[styles.inviteIconWrap, isExpired && { backgroundColor: '#FEF2F2' }]}>
                      <Ionicons name="mail-outline" size={20} color={isExpired ? '#EF4444' : C.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inviteEmail}>{inv.email}</Text>
                      <View style={[styles.inviteRoleBadge, { backgroundColor: roleInfo.bg }]}>
                        <Text style={[styles.inviteRoleTxt, { color: roleInfo.color }]}>{roleInfo.label}</Text>
                      </View>
                      <Text style={[styles.inviteExpiry, isExpired && { color: '#EF4444' }]}>
                        {isExpired
                          ? 'Invitation expirée'
                          : `Invité par ${inviterName} · expire dans ${expiresIn}j`}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.iconBtnLabelled, styles.iconBtnLabelledDanger]}
                      onPress={() => handleCancelInvitation(inv.id, inv.email)}
                      accessibilityLabel={isExpired ? 'Supprimer cette invitation expirée' : 'Annuler cette invitation'}
                    >
                      <Ionicons name="close" size={14} color={C.open} />
                      <Text style={[styles.iconBtnLabelText, { color: C.open }]}>{isExpired ? 'Supprimer' : 'Annuler'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </>
          )}

          {orgUsers.length === 0 && (
            <View style={styles.hintCard}>
              <Ionicons name="key-outline" size={16} color={C.textMuted} />
              <Text style={styles.hintText}>
                Pour inviter un nouveau membre, utilisez le bouton "Inviter" ci-dessus. Un code d'accès sera généré à partager avec la personne.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ─── ONGLET ENTREPRISES ─── */}
      {activeTab === 'companies' && (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>
              {companySearch.trim()
                ? `${filteredCompanies.length} / ${companies.length} entreprise${companies.length !== 1 ? 's' : ''}`
                : `${companies.length} entreprise${companies.length !== 1 ? 's' : ''} sur chantier`}
            </Text>
            <TouchableOpacity style={styles.addBtn} onPress={openAddCompany}>
              <Ionicons name="add" size={17} color="#fff" />
              <Text style={styles.addBtnText}>Ajouter</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={15} color={C.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Nom, sigle, SIRET, lot ou contact..."
              placeholderTextColor={C.textMuted}
              value={companySearch}
              onChangeText={setCompanySearch}
            />
            {companySearch.length > 0 && (
              <TouchableOpacity onPress={() => setCompanySearch('')}>
                <Ionicons name="close-circle" size={15} color={C.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {companies.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="business-outline" size={36} color={C.textMuted} />
              <Text style={styles.emptyText}>Aucune entreprise</Text>
              <Text style={styles.emptyHint}>Ajoutez les entreprises intervenant sur ce chantier</Text>
            </View>
          ) : filteredCompanies.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={36} color={C.textMuted} />
              <Text style={styles.emptyText}>Aucun résultat</Text>
              <Text style={styles.emptyHint}>Aucune entreprise ne correspond à "{companySearch}"</Text>
              <TouchableOpacity style={styles.clearFilterBtn} onPress={() => setCompanySearch('')}>
                <Ionicons name="close-circle-outline" size={15} color={C.primary} />
                <Text style={styles.clearFilterTxt}>Effacer le filtre</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filteredCompanies.map(co => {
              const workers = workerLocalMap[co.id] ?? co.actualWorkers;
              const hours = hoursLocalMap[co.id] ?? (co.hoursWorked ?? 0);
              const linkedCount = companyUserCounts[co.id] ?? 0;
              const coLots = (co.lots ?? []).map(lid => lots.find(l => l.id === lid)).filter(Boolean) as typeof lots;
              return (
                <View key={co.id} style={styles.coCard}>
                  <View style={[styles.coAccent, { backgroundColor: co.color }]} />
                  <View style={styles.coBody}>
                    <View style={styles.coTopRow}>
                      <View style={styles.coNameRow}>
                        <Text style={styles.coName} numberOfLines={2}>{co.name}</Text>
                        <View style={[styles.coSigle, { backgroundColor: co.color + '18' }]}>
                          <Text style={[styles.coSigleTxt, { color: co.color }]}>{co.shortName}</Text>
                        </View>
                      </View>
                      {coLots.length > 0 && (
                        <View style={styles.coLotsRow}>
                          {coLots.map(l => (
                            <View key={l.id} style={[styles.coLotChip, { backgroundColor: l.color + '18', borderColor: l.color + '44' }]}>
                              <View style={[styles.coLotDot, { backgroundColor: l.color }]} />
                              <Text style={[styles.coLotChipTxt, { color: l.color }]} numberOfLines={1}>{l.name}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {linkedCount > 0 && (
                        <View style={styles.coLinkedUsers}>
                          <Ionicons name="people-outline" size={11} color={C.textMuted} />
                          <Text style={styles.coLinkedUsersTxt}>{linkedCount} membre{linkedCount > 1 ? 's' : ''} lié{linkedCount > 1 ? 's' : ''}</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.coStatsGrid}>
                      <View style={styles.coStatsRow}>
                        <View style={[styles.coStat, { flex: 1 }]}>
                          <View style={[styles.coStatDot, { backgroundColor: co.color }]} />
                          <Text style={styles.coStatLabel} numberOfLines={1}>Prévu</Text>
                          <Text style={[styles.coStatVal, { color: co.color }]} numberOfLines={1}>{co.plannedWorkers}</Text>
                        </View>
                        <View style={[styles.coStat, { flex: 2 }]}>
                          <View style={[styles.coStatDot, { backgroundColor: workers > co.plannedWorkers ? '#EF4444' : C.inProgress }]} />
                          <Text style={styles.coStatLabel} numberOfLines={1}>Présents</Text>
                          <TouchableOpacity
                            onPress={() => handleWorkerCount(co, -1)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={styles.workerBtn}
                          >
                            <Ionicons name="remove" size={13} color={C.textSub} />
                          </TouchableOpacity>
                          <Text style={[styles.coStatVal, { color: workers > co.plannedWorkers ? '#EF4444' : C.inProgress }]} numberOfLines={1}>
                            {workers}{workers > co.plannedWorkers ? ' ↑' : ''}
                          </Text>
                          <TouchableOpacity
                            onPress={() => handleWorkerCount(co, 1)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={styles.workerBtn}
                          >
                            <Ionicons name="add" size={13} color={C.textSub} />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <View style={styles.coStatsRow}>
                        <View style={[styles.coStat, { flex: 1 }]}>
                          <View style={[styles.coStatDot, { backgroundColor: C.textMuted }]} />
                          <Text style={styles.coStatLabel} numberOfLines={1}>Heures travaillées</Text>
                          {hoursEditId === co.id ? (
                            <>
                              <TextInput
                                style={styles.hoursInput}
                                value={hoursInputVal}
                                onChangeText={setHoursInputVal}
                                keyboardType="numeric"
                                autoFocus
                                selectTextOnFocus
                                onSubmitEditing={() => commitHoursEdit(co)}
                              />
                              <TouchableOpacity
                                onPress={() => commitHoursEdit(co)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                style={[styles.workerBtn, { backgroundColor: C.primary + '22' }]}
                                accessibilityLabel="Valider les heures"
                              >
                                <Ionicons name="checkmark" size={13} color={C.primary} />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => { setHoursEditId(null); setHoursInputVal(''); }}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                style={[styles.workerBtn, { backgroundColor: '#FEF2F2' }]}
                                accessibilityLabel="Annuler la saisie des heures"
                              >
                                <Ionicons name="close" size={13} color="#EF4444" />
                              </TouchableOpacity>
                            </>
                          ) : (
                            <>
                              <TouchableOpacity
                                onPress={() => handleHoursChange(co, -8)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                style={styles.workerBtn}
                              >
                                <Ionicons name="remove" size={13} color={C.textSub} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => startHoursEdit(co)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                <Text style={[styles.coStatVal, { textDecorationLine: 'underline', textDecorationStyle: 'dotted' }]} numberOfLines={1}>{hours}h</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => handleHoursChange(co, 8)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                style={styles.workerBtn}
                              >
                                <Ionicons name="add" size={13} color={C.textSub} />
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                      </View>
                    </View>

                    {(co.siret || co.insurance) && (
                      <View style={styles.coLegalRow}>
                        {co.siret && (
                          <View style={styles.coLegalItem}>
                            <Ionicons name="document-text-outline" size={11} color={C.textMuted} />
                            <Text style={styles.coLegalText}>SIRET {co.siret}</Text>
                          </View>
                        )}
                        {co.insurance && (
                          <View style={styles.coLegalItem}>
                            <Ionicons name="shield-outline" size={11} color={C.textMuted} />
                            <Text style={styles.coLegalText}>{co.insurance}</Text>
                          </View>
                        )}
                      </View>
                    )}
                    {(co.phone || co.email) && (
                      <View style={styles.coContactRow}>
                        {co.phone && (
                          <TouchableOpacity style={styles.coContactItem} onPress={() => Linking.openURL(`tel:${co.phone}`)}>
                            <Ionicons name="call-outline" size={12} color={C.primary} />
                            <Text style={[styles.coContactText, { color: C.primary }]}>{co.phone}</Text>
                          </TouchableOpacity>
                        )}
                        {co.email && (
                          <TouchableOpacity style={styles.coContactItem} onPress={() => Linking.openURL(`mailto:${co.email}`)}>
                            <Ionicons name="mail-outline" size={12} color={C.primary} />
                            <Text style={[styles.coContactText, { color: C.primary }]}>{co.email}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                    <View style={styles.coActionBtns}>
                      <TouchableOpacity
                        style={styles.iconBtnLabelled}
                        onPress={() => openEditCompany(co)}
                        accessibilityRole="button"
                        accessibilityLabel={`Modifier ${co.name}`}
                      >
                        <Ionicons name="pencil-outline" size={15} color={C.primary} />
                        <Text style={styles.iconBtnLabelText}>Éditer</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.iconBtnLabelled, styles.iconBtnLabelledDanger]}
                        onPress={() => handleDeleteCompany(co)}
                        accessibilityRole="button"
                        accessibilityLabel={`Supprimer ${co.name}`}
                      >
                        <Ionicons name="trash-outline" size={15} color={C.open} />
                        <Text style={[styles.iconBtnLabelText, { color: C.open }]}>Supprimer</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ─── ONGLET ABONNEMENT ─── */}
      {activeTab === 'abonnement' && (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {statusCfg && subscription && (
            <View style={[styles.statusBanner, { backgroundColor: statusCfg.bg, borderColor: statusCfg.color + '44' }]}>
              <Ionicons name={statusCfg.icon} size={20} color={statusCfg.color} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusLabel, { color: statusCfg.color }]}>{statusCfg.label}</Text>
                {subscription.status === 'trial' && trialDaysLeft !== null && (
                  <Text style={[styles.statusSub, { color: statusCfg.color }]}>
                    {trialDaysLeft > 0
                      ? `${trialDaysLeft} jour${trialDaysLeft > 1 ? 's' : ''} restant${trialDaysLeft > 1 ? 's' : ''} — se termine le ${formatDate(subscription.trialEndsAt)}`
                      : 'Essai terminé'}
                  </Text>
                )}
                {subscription.status === 'active' && subscription.expiresAt && (
                  <Text style={[styles.statusSub, { color: statusCfg.color }]}>
                    Valide jusqu'au {formatDate(subscription.expiresAt)}
                  </Text>
                )}
                {subscription.status === 'active' && !subscription.expiresAt && (
                  <Text style={[styles.statusSub, { color: statusCfg.color }]}>
                    Renouvellement automatique
                  </Text>
                )}
                {statusCfg.hint && (
                  <Text style={[styles.statusHint, { color: statusCfg.color }]}>{statusCfg.hint}</Text>
                )}
              </View>
            </View>
          )}

          {plan && (
            <View style={[styles.planCard, { borderTopColor: PLAN_COLORS[plan.name] ?? C.primary }]}>
              <View style={styles.planTopRow}>
                <View style={{ flex: 1 }}>
                  <View style={[styles.planBadge, { backgroundColor: (PLAN_COLORS[plan.name] ?? C.primary) + '18', alignSelf: 'flex-start' }]}>
                    <Text style={[styles.planBadgeTxt, { color: PLAN_COLORS[plan.name] ?? C.primary }]}>{plan.name}</Text>
                  </View>
                  {subscription?.startedAt && (
                    <Text style={styles.planStartDate}>Actif depuis le {formatDate(subscription.startedAt)}</Text>
                  )}
                </View>
                <Text style={styles.planPrice}>
                  {plan.priceMonthly === 0 ? 'Gratuit' : `${plan.priceMonthly} €/mois`}
                </Text>
              </View>
              {plan.features.map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <Ionicons name="checkmark-circle" size={14} color={PLAN_COLORS[plan.name] ?? C.primary} />
                  <Text style={styles.featureTxt}>{f}</Text>
                </View>
              ))}
              {activeOrgUsers.length > 0 && (
                <View style={styles.memberPreview}>
                  {activeOrgUsers.slice(0, 3).map(u => {
                    const col = hashColor(u.id, AVATAR_COLORS);
                    const rc = ROLE_INFO[u.role];
                    const initials = u.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
                    return (
                      <View key={u.id} style={styles.memberPreviewRow}>
                        <View style={[styles.memberPreviewAvatar, { backgroundColor: col + '22' }]}>
                          <Text style={[styles.memberPreviewInitials, { color: col }]}>{initials}</Text>
                        </View>
                        <Text style={styles.memberPreviewName} numberOfLines={1}>{u.name}</Text>
                        {rc && (
                          <View style={[styles.memberPreviewBadge, { backgroundColor: rc.bg }]}>
                            <Text style={[styles.memberPreviewBadgeTxt, { color: rc.color }]}>{rc.label}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {activeOrgUsers.length > 3 && (
                    <Text style={styles.memberPreviewMore}>+{activeOrgUsers.length - 3} autres membres actifs</Text>
                  )}
                </View>
              )}
              <TouchableOpacity style={styles.detailLink} onPress={() => router.push('/subscription')}>
                <Text style={styles.detailLinkTxt}>Voir l'historique et les membres</Text>
                <Ionicons name="chevron-forward" size={14} color={C.primary} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.seatCard}>
            <View style={styles.seatTopRow}>
              <View style={styles.seatLeft}>
                <Ionicons name="people" size={16} color={C.primary} />
                <View>
                  <Text style={styles.seatTitle}>Sièges utilisés</Text>
                  <Text style={styles.seatSubLabel}>Admin · Conducteur · Chef d'équipe</Text>
                </View>
              </View>
              <Text style={styles.seatCount}>
                {seatUsed}
                <Text style={styles.seatMax}>{seatMax === -1 ? ' / ∞' : ` / ${seatMax}`}</Text>
              </Text>
            </View>
            {seatMax !== -1 && (
              <View style={styles.barBg}>
                <View style={[styles.barFill, { width: `${Math.min(seatRatio * 100, 100)}%` as any, backgroundColor: seatBarColor }]} />
              </View>
            )}
            {freeOrgUsers.length > 0 && (
              <View style={styles.freeBanner}>
                <Ionicons name="gift-outline" size={13} color="#10B981" />
                <Text style={styles.freeBannerTxt}>
                  {freeOrgUsers.length} sous-traitant{freeOrgUsers.length > 1 ? 's' : ''} / observateur{freeOrgUsers.length > 1 ? 's' : ''} — <Text style={{ fontFamily: 'Inter_600SemiBold' }}>gratuit{freeOrgUsers.length > 1 ? 's' : ''}</Text>, hors quota
                </Text>
              </View>
            )}
            {seatMax !== -1 && seatRatio >= 0.9 && (
              <View style={styles.upgradeHint}>
                <Ionicons name="arrow-up-circle-outline" size={14} color="#3B82F6" />
                <Text style={styles.upgradeHintTxt}>
                  {seatRatio >= 1
                    ? 'Limite atteinte. Pour ajouter des utilisateurs actifs, passez à un plan supérieur en contactant le support BuildTrack.'
                    : 'Vous approchez la limite. Anticipez en contactant le support BuildTrack.'}
                </Text>
              </View>
            )}
          </View>

          {(subscription?.status === 'suspended' || subscription?.status === 'expired') && (
            <View style={styles.actionCard}>
              <Ionicons name="mail-outline" size={20} color="#3B82F6" />
              <View style={{ flex: 1 }}>
                <Text style={styles.actionCardTitle}>Réactiver votre abonnement</Text>
                <Text style={styles.actionCardSub}>
                  Contactez{' '}
                  <Text
                    style={{ textDecorationLine: 'underline' }}
                    onPress={() => Linking.openURL('mailto:support@buildtrack.fr')}
                    accessibilityRole="link"
                    accessibilityLabel="Envoyer un email à support@buildtrack.fr"
                  >
                    support@buildtrack.fr
                  </Text>
                  {' '}ou votre responsable de compte pour réactiver l'accès.
                </Text>
              </View>
            </View>
          )}

          <View style={styles.hintCard}>
            <Ionicons name="information-circle-outline" size={15} color={C.textMuted} />
            <Text style={styles.hintText}>
              Pour changer de formule ou gérer votre abonnement, contactez le support BuildTrack. Les invitations en attente sont visibles dans l'onglet Utilisateurs.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* ─── MODAL ÉDITION UTILISATEUR ─── */}
      {roleModal && (() => {
        const avatarColor = hashColor(roleModal.id, AVATAR_COLORS);
        const initials = roleModal.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
        const hasChanges = editRole !== roleModal.currentRole || (editCompanyId || undefined) !== roleModal.currentCompanyId;
        const currentRoleInfo = ROLES.find(r => r.value === editRole);
        return (
          <Modal visible transparent animationType="slide" onRequestClose={closeEditUserModal}>
            <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={closeEditUserModal}>
              <TouchableOpacity activeOpacity={1} style={styles.sheet}>

                {/* ── Handle ── */}
                <View style={styles.sheetHandle} />

                {/* ── Header fixe ── */}
                <View style={styles.editUserHeader}>
                  <View style={[styles.editUserAvatar, { backgroundColor: avatarColor }]}>
                    <Text style={styles.editUserAvatarTxt}>{initials}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.editUserName} numberOfLines={1}>{roleModal.name}</Text>
                      {hasChanges && (
                        <View style={styles.editChangedPill}>
                          <View style={styles.editChangedDot} />
                          <Text style={styles.editChangedTxt}>Modifié</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.editUserEmail} numberOfLines={1}>{roleModal.email}</Text>
                    {currentRoleInfo && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}>
                        <View style={[styles.editRoleDot, { backgroundColor: currentRoleInfo.color }]} />
                        <Text style={[styles.editRoleLabel, { color: currentRoleInfo.color }]}>{currentRoleInfo.label}</Text>
                        {editCompanyId && (() => {
                          const co = companies.find(c => c.id === editCompanyId);
                          return co ? (
                            <View style={[styles.editCoChip, { backgroundColor: co.color + '20', borderColor: co.color + '55' }]}>
                              <Text style={[styles.editCoChipTxt, { color: co.color }]}>{co.shortName}</Text>
                            </View>
                          ) : null;
                        })()}
                      </View>
                    )}
                  </View>
                </View>

                {/* ── Contenu scrollable ── */}
                {saving ? (
                  <ActivityIndicator size="large" color={C.primary} style={{ marginVertical: 32 }} />
                ) : (
                  <ScrollView
                    style={{ maxHeight: EDIT_SCROLL_MAX_H }}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
                  >
                    {/* Rôle */}
                    <View style={styles.editSection}>
                      <Text style={styles.editSectionLabel}>Rôle</Text>
                    </View>
                    {ROLES.map(r => {
                      const isSelected = editRole === r.value;
                      const isFree = FREE_ROLES.includes(r.value);
                      return (
                        <TouchableOpacity
                          key={r.value}
                          style={[styles.editOption, isSelected && { backgroundColor: r.bg, borderColor: r.color }]}
                          onPress={() => setEditRole(r.value)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: isSelected }}
                        >
                          <View style={[styles.editOptionDot, { backgroundColor: r.color }]} />
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                              <Text style={[styles.editOptionName, isSelected && { color: r.color, fontFamily: 'Inter_600SemiBold' }]}>
                                {r.label}
                              </Text>
                              {isFree && <View style={styles.freeTag}><Text style={styles.freeTagTxt}>gratuit</Text></View>}
                            </View>
                            <Text style={styles.editOptionDesc}>{r.description}</Text>
                          </View>
                          {isSelected
                            ? <Ionicons name="checkmark-circle" size={18} color={r.color} />
                            : <View style={styles.editOptionCircle} />}
                        </TouchableOpacity>
                      );
                    })}

                    {/* Entreprise */}
                    {companies.length > 0 && (
                      <>
                        <View style={[styles.editSection, { marginTop: 4 }]}>
                          <Text style={styles.editSectionLabel}>Entreprise rattachée</Text>
                          <Text style={styles.editSectionHint}>optionnel</Text>
                        </View>
                        <View style={styles.editCoGrid}>
                          {/* Chip "Aucune" */}
                          <TouchableOpacity
                            style={[styles.editCoItem, !editCompanyId && { backgroundColor: C.primaryBg, borderColor: C.primary }]}
                            onPress={() => setEditCompanyId('')}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: !editCompanyId }}
                          >
                            <Ionicons
                              name={!editCompanyId ? 'close-circle' : 'close-circle-outline'}
                              size={14}
                              color={!editCompanyId ? C.primary : C.textMuted}
                            />
                            <Text style={[styles.editCoItemTxt, !editCompanyId && { color: C.primary, fontFamily: 'Inter_600SemiBold' }]}>
                              Aucune
                            </Text>
                          </TouchableOpacity>
                          {/* Chips entreprises */}
                          {companies.map(co => {
                            const isSelected = editCompanyId === co.id;
                            return (
                              <TouchableOpacity
                                key={co.id}
                                style={[styles.editCoItem, isSelected && { backgroundColor: co.color + '1A', borderColor: co.color }]}
                                onPress={() => setEditCompanyId(isSelected ? '' : co.id)}
                                accessibilityRole="radio"
                                accessibilityLabel={co.name}
                                accessibilityState={{ selected: isSelected }}
                              >
                                <View style={[styles.editCoDot, { backgroundColor: co.color }]} />
                                <Text style={[styles.editCoItemTxt, isSelected && { color: co.color, fontFamily: 'Inter_600SemiBold' }]} numberOfLines={1}>
                                  {co.shortName}
                                </Text>
                                {isSelected && <Ionicons name="checkmark" size={12} color={co.color} />}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        {editCompanyId && (() => {
                          const co = companies.find(c => c.id === editCompanyId);
                          return co ? (
                            <Text style={styles.editCoFullName}>{co.name} · {co.plannedWorkers} personnes prévues</Text>
                          ) : null;
                        })()}
                      </>
                    )}
                  </ScrollView>
                )}

                {/* ── Footer fixe : Annuler | Enregistrer ── */}
                {!saving && (
                  <View style={styles.editFooter}>
                    <TouchableOpacity style={styles.editFooterCancel} onPress={closeEditUserModal}>
                      <Text style={styles.editFooterCancelTxt}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editFooterSave, !hasChanges && { opacity: 0.4 }]}
                      onPress={handleSaveUserEdit}
                      disabled={!hasChanges}
                    >
                      <Text style={styles.editFooterSaveTxt}>Enregistrer</Text>
                    </TouchableOpacity>
                  </View>
                )}

              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        );
      })()}

      {/* ─── MODAL ENTREPRISE ─── */}
      <Modal visible={!!companyModal} transparent animationType="slide" onRequestClose={tryCloseCompanyModal}>
        <SafeKAV>
          <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={tryCloseCompanyModal}>
            <TouchableOpacity activeOpacity={1} style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>
                {companyModal?.mode === 'edit' ? 'Modifier l\'entreprise' : 'Ajouter une entreprise'}
              </Text>
              <ScrollView
                style={{ maxHeight: MODAL_SCROLL_MAX_H }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                contentContainerStyle={{ gap: 10, paddingBottom: 16 }}
              >
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Nom complet *</Text>
                  <TextInput style={styles.fieldInput} value={nom} onChangeText={setNom}
                    placeholder="Ex : Maçonnerie Dupont" placeholderTextColor={C.textMuted} />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Sigle *</Text>
                  <TextInput style={styles.fieldInput} value={nomCourt} onChangeText={setNomCourt}
                    placeholder="Ex : MD" placeholderTextColor={C.textMuted}
                    autoCapitalize="characters" maxLength={6} />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Effectif prévu *</Text>
                  <TextInput style={styles.fieldInput} value={effectif} onChangeText={setEffectif}
                    placeholder="Ex : 8" placeholderTextColor={C.textMuted} keyboardType="numeric" />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Heures travaillées</Text>
                  <TextInput style={styles.fieldInput} value={heures} onChangeText={setHeures}
                    placeholder="Ex : 240" placeholderTextColor={C.textMuted} keyboardType="numeric" />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Lots de travaux</Text>
                  <Text style={styles.fieldHint}>Sélectionnez les lots dont cette entreprise est responsable</Text>
                  <View style={styles.lotSelectorGrid}>
                    {lots.map(l => {
                      const isOn = selectedLots.includes(l.id);
                      return (
                        <TouchableOpacity
                          key={l.id}
                          style={[styles.lotSelectorChip, isOn && { backgroundColor: l.color + '18', borderColor: l.color }]}
                          onPress={() => setSelectedLots(prev => isOn ? prev.filter(x => x !== l.id) : [...prev, l.id])}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isOn }}
                          accessibilityLabel={l.name}
                        >
                          <View style={[styles.lotSelectorDot, { backgroundColor: isOn ? l.color : C.border }]} />
                          <Text style={[styles.lotSelectorTxt, isOn && { color: l.color, fontFamily: 'Inter_600SemiBold' }]} numberOfLines={1}>
                            {l.name}
                          </Text>
                          {isOn && <Ionicons name="checkmark" size={12} color={l.color} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {selectedLots.length === 0 && (
                    <Text style={styles.lotSelectorEmpty}>Aucun lot sélectionné — les réserves ne seront pas auto-assignées</Text>
                  )}
                </View>
                <View style={styles.fieldSeparator}>
                  <Text style={styles.fieldSeparatorTxt}>Informations légales</Text>
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>N° SIRET</Text>
                  <TextInput style={styles.fieldInput} value={siret} onChangeText={setSiret}
                    placeholder="Ex : 12345678900012 (14 chiffres)" placeholderTextColor={C.textMuted}
                    keyboardType="numbers-and-punctuation" />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Assurance décennale</Text>
                  <TextInput style={styles.fieldInput} value={insurance} onChangeText={setInsurance}
                    placeholder="Ex : AXA — Police n° 1234567" placeholderTextColor={C.textMuted} />
                </View>
                <View style={styles.fieldSeparator}>
                  <Text style={styles.fieldSeparatorTxt}>Contact</Text>
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Téléphone</Text>
                  <TextInput style={styles.fieldInput} value={phone} onChangeText={setPhone}
                    placeholder="Ex : 06 12 34 56 78" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Email</Text>
                  <TextInput style={styles.fieldInput} value={email} onChangeText={setEmail}
                    placeholder="Ex : contact@entreprise.fr" placeholderTextColor={C.textMuted}
                    keyboardType="email-address" autoCapitalize="none" />
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Couleur</Text>
                  <View style={styles.colorRow}>
                    {COMPANY_COLORS.map(c => (
                      <TouchableOpacity
                        key={c}
                        style={[styles.colorDot, { backgroundColor: c }, selectedColor === c && styles.colorDotSelected]}
                        onPress={() => setSelectedColor(c)}
                      >
                        {selectedColor === c && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSaveCompany}>
                  <Text style={styles.saveBtnText}>
                    {companyModal?.mode === 'edit' ? 'Enregistrer les modifications' : 'Ajouter l\'entreprise'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={tryCloseCompanyModal}>
                  <Text style={styles.cancelBtnText}>Annuler</Text>
                </TouchableOpacity>
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </SafeKAV>
      </Modal>

      {/* ─── MODAL INVITATION ─── */}
      <Modal visible={inviteModal} transparent animationType="slide" onRequestClose={handleCloseInviteModal}>
        <SafeKAV>
          <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleCloseInviteModal}>
            <TouchableOpacity activeOpacity={1} style={styles.sheet}>
              <ScrollView style={{ maxHeight: MODAL_SCROLL_MAX_H }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" nestedScrollEnabled contentContainerStyle={{ gap: 10 }}>
                <View style={styles.sheetHandle} />
                {inviteToken ? (
                  <>
                    <View style={styles.inviteSuccessIcon}>
                      <Ionicons name="checkmark-circle" size={48} color="#10B981" />
                    </View>
                    <Text style={styles.sheetTitle}>Invitation créée !</Text>
                    <Text style={styles.inviteSuccessMsg}>
                      Partagez ce code avec {inviteEmail} pour rejoindre votre organisation.
                    </Text>
                    <View style={styles.tokenBox}>
                      <Text style={styles.tokenTxt} selectable>{inviteToken}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.copyBtn, tokenCopied && styles.copyBtnDone]}
                      onPress={handleCopyToken}
                    >
                      <Ionicons
                        name={tokenCopied ? 'checkmark-circle' : 'copy-outline'}
                        size={16}
                        color={tokenCopied ? '#10B981' : C.primary}
                      />
                      <Text style={[styles.copyBtnTxt, tokenCopied && styles.copyBtnTxtDone]}>
                        {tokenCopied ? 'Copié !' : 'Copier le code'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.inviteHint}>
                      Ce code est valable 7 jours. L'accès est lié à l'adresse {inviteEmail} — l'utilisateur doit créer son compte avec cette adresse.
                    </Text>
                    <TouchableOpacity style={styles.saveBtn} onPress={handleCloseInviteModal}>
                      <Text style={styles.saveBtnText}>Fermer</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.sheetTitle}>Inviter un collaborateur</Text>
                    <Text style={styles.sheetSubtitle}>
                      {seatMax === -1 ? 'Sièges : illimité' : `Sièges : ${seatUsed} / ${seatMax} utilisés`}
                    </Text>

                    {isSeatFull && (
                      <View style={styles.seatFullBanner}>
                        <Ionicons name="information-circle-outline" size={15} color="#3B82F6" />
                        <Text style={styles.seatFullBannerTxt}>
                          Limite de {seatMax} sièges atteinte. Vous pouvez encore inviter des <Text style={{ fontFamily: 'Inter_600SemiBold' }}>Observateurs</Text> et <Text style={{ fontFamily: 'Inter_600SemiBold' }}>Sous-traitants</Text> (gratuits, hors quota).
                        </Text>
                      </View>
                    )}

                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Rôle</Text>
                      {ROLES.map(r => {
                        const isFree = FREE_ROLES.includes(r.value);
                        const isBlocked = isSeatFull && !isFree;
                        return (
                          <TouchableOpacity
                            key={r.value}
                            style={[
                              styles.roleOption,
                              inviteRole === r.value && { backgroundColor: r.bg, borderColor: r.color },
                              isBlocked && { opacity: 0.4 },
                            ]}
                            onPress={() => {
                              if (isBlocked) return;
                              setInviteRole(r.value);
                              setInviteCompanyId('');
                            }}
                          >
                            <View style={[styles.roleOptionDot, { backgroundColor: r.color }]} />
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={[styles.roleOptionText, inviteRole === r.value && { color: r.color, fontFamily: 'Inter_600SemiBold' }]}>
                                  {r.label}
                                </Text>
                                {isFree && (
                                  <View style={styles.freeTag}>
                                    <Text style={styles.freeTagTxt}>gratuit</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={styles.roleOptionDesc}>{r.description}</Text>
                            </View>
                            {inviteRole === r.value && <Ionicons name="checkmark-circle" size={18} color={r.color} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {inviteRole === 'sous_traitant' && companies.length > 0 && (
                      <View style={styles.field}>
                        <Text style={styles.fieldLabel}>Entreprise rattachée <Text style={{ color: C.textMuted, fontFamily: 'Inter_400Regular' }}>(optionnel)</Text></Text>
                        {companies.map(co => (
                          <TouchableOpacity
                            key={co.id}
                            style={[
                              styles.roleOption,
                              inviteCompanyId === co.id && { backgroundColor: co.color + '18', borderColor: co.color },
                            ]}
                            onPress={() => setInviteCompanyId(inviteCompanyId === co.id ? '' : co.id)}
                          >
                            <View style={[styles.roleOptionDot, { backgroundColor: co.color }]} />
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.roleOptionText, inviteCompanyId === co.id && { color: co.color, fontFamily: 'Inter_600SemiBold' }]}>
                                {co.name}
                              </Text>
                              <Text style={styles.roleOptionDesc}>{co.shortName} · {co.plannedWorkers} pers. prévues</Text>
                            </View>
                            {inviteCompanyId === co.id && <Ionicons name="checkmark-circle" size={18} color={co.color} />}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Adresse email *</Text>
                      <TextInput
                        style={[styles.fieldInput, inviteEmailError ? { borderColor: '#EF4444' } : {}]}
                        value={inviteEmail}
                        onChangeText={v => { setInviteEmail(v); if (inviteEmailError) setInviteEmailError(''); }}
                        placeholder="prenom.nom@exemple.fr"
                        placeholderTextColor={C.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {inviteEmailError ? <Text style={styles.fieldError}>{inviteEmailError}</Text> : null}
                    </View>

                    {inviteSending ? (
                      <ActivityIndicator size="large" color={C.primary} style={{ marginVertical: 20 }} />
                    ) : (
                      <TouchableOpacity
                        style={[styles.saveBtn, (!inviteEmail.trim() || sendDisabled) && { opacity: 0.4 }]}
                        onPress={handleSendInvite}
                        disabled={!inviteEmail.trim() || sendDisabled}
                      >
                        <Text style={styles.saveBtnText}>Envoyer l'invitation</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.cancelBtn} onPress={handleCloseInviteModal}>
                      <Text style={styles.cancelBtnText}>Annuler</Text>
                    </TouchableOpacity>
                  </>
                )}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </SafeKAV>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  toast: {
    position: 'absolute', alignSelf: 'center', zIndex: 999,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1F2937', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    ...Platform.select({
      web: { boxShadow: '0 4px 12px rgba(0,0,0,0.2)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
    }),
  },
  toastText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  header: {
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 16, paddingBottom: 0,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 },
  backBtn: { padding: 2 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  adminBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FEF2F2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#FECACA',
  },
  adminBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },

  tabScrollRow: { paddingBottom: 12 },
  tabRowContent: { flexDirection: 'row', gap: 6 },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.border,
  },
  tabBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  tabBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  tabBtnTextActive: { color: C.primary },
  tabCount: {
    backgroundColor: C.border, borderRadius: 10, minWidth: 20, height: 20,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  tabCountActive: { backgroundColor: C.primary + '22' },
  tabCountText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.textMuted },
  tabCountTextActive: { color: C.primary },
  tabBadgeDot: {
    backgroundColor: '#EF4444', borderRadius: 10, minWidth: 18, height: 18,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  tabBadgeDotText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  tabAlertDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },

  content: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  statCard: {
    flexBasis: '30%', flexGrow: 1,
    backgroundColor: C.surface, borderRadius: 10, padding: 10,
    borderTopWidth: 3, alignItems: 'center',
    borderWidth: 1, borderColor: C.border,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  statNum: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginTop: 2 },

  filterActiveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primaryBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: C.primary + '44',
  },
  filterActiveTxt: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  subSectionTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4, marginBottom: 2 },
  sectionSep: { height: 1, backgroundColor: C.border, marginVertical: 8 },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
  },
  addBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },

  infoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EFF6FF', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#BFDBFE',
  },
  infoBannerText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress },

  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  userCardSelf: { borderColor: C.primary + '44', backgroundColor: C.primaryBg },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  userInfo: { flex: 1, gap: 4 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  userName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  selfBadge: { backgroundColor: C.primaryBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  selfBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.primary },
  userEmail: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  roleBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  roleBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  companyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1,
  },
  companyBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  companyBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', maxWidth: 100 },

  editUserHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 12,
  },
  editUserAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  editUserAvatarTxt: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff' },
  editUserName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text, flexShrink: 1 },
  editUserEmail: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  editRoleDot: { width: 7, height: 7, borderRadius: 4 },
  editRoleLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  editCoChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1,
  },
  editCoChipTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  editChangedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFF3CD', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
  },
  editChangedDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#F59E0B' },
  editChangedTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#92400E' },

  editSection: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  editSectionLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  editSectionHint: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },

  editOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.surface,
  },
  editOptionDot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  editOptionName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  editOptionDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  editOptionCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: C.border },

  editCoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  editCoItem: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7, backgroundColor: C.surface,
  },
  editCoDot: { width: 7, height: 7, borderRadius: 4 },
  editCoItemTxt: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text, maxWidth: 90 },
  editCoFullName: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: -2 },

  editFooter: { flexDirection: 'row', gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border, marginTop: 10 },
  editFooterCancel: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: 11, backgroundColor: C.surface2,
  },
  editFooterCancelTxt: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  editFooterSave: {
    flex: 2, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: 11, backgroundColor: C.primary,
  },
  editFooterSaveTxt: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  userActions: { flexDirection: 'column', gap: 5 },

  iconBtnLabelled: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '33',
  },
  iconBtnLabelledDanger: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  iconBtnLabelText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },

  hintCard: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border, marginTop: 6,
  },
  hintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 18 },

  coCard: {
    flexDirection: 'row', backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  coAccent: { width: 4 },
  coBody: { flex: 1, padding: 14, gap: 10 },
  coTopRow: { flexDirection: 'column', gap: 4 },
  coNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  coName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  coSigle: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  coSigleTxt: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  coLotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 },
  coLotChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: 'transparent',
  },
  coLotDot: { width: 5, height: 5, borderRadius: 3 },
  coLotChipTxt: { fontSize: 10, fontFamily: 'Inter_600SemiBold', maxWidth: 90 },
  coLinkedUsers: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  coLinkedUsersTxt: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  coStatsGrid: { flexDirection: 'column', gap: 6 },
  coStatsRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  coStat: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  coStatDot: { width: 6, height: 6, borderRadius: 3 },
  coStatLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, flexShrink: 1 },
  coStatVal: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  workerBtn: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  coActionBtns: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', alignItems: 'center', paddingTop: 4, borderTopWidth: 1, borderTopColor: C.border },
  coActionSep: { height: 1, width: '100%', backgroundColor: C.border },

  coLegalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  coLegalItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  coLegalText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },

  coContactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  coContactItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  coContactText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },

  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  colorDot: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
  },
  colorDotSelected: {
    borderWidth: 2, borderColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 0 0 2px rgba(0,0,0,0.3)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 2, elevation: 3 },
    }),
  },

  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  emptyHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },

  statusBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: 12, padding: 14, borderWidth: 1,
  },
  statusLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  statusSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  statusHint: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 6, lineHeight: 17, opacity: 0.85 },

  planCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderTopWidth: 4, borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  planTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  planBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  planBadgeTxt: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  planStartDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4 },
  planPrice: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  featureTxt: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, flex: 1 },
  detailLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border,
  },
  detailLinkTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },

  seatCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  seatTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  seatLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seatTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  seatSubLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  seatCount: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  seatMax: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  barBg: { height: 7, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 7, borderRadius: 4 },
  freeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#10B98112', borderRadius: 8, padding: 10, marginTop: 10,
  },
  freeBannerTxt: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#10B981', flex: 1 },
  upgradeHint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#EFF6FF', borderRadius: 8, padding: 10, marginTop: 10,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  upgradeHintTxt: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: '#1D4ED8', lineHeight: 17 },

  actionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  actionCardTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#1D4ED8', marginBottom: 2 },
  actionCardSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#1D4ED8', lineHeight: 17, flex: 1 },

  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  memberAvatarTxt: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  memberName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  memberEmail: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },

  inviteCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  inviteCardExpired: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  inviteIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  inviteEmail: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  inviteRoleBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 4 },
  inviteRoleTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  inviteExpiry: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24, gap: 10, maxHeight: '90%',
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: C.border, borderRadius: 2,
    alignSelf: 'center', marginBottom: 6,
  },
  sheetTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center' },
  sheetSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginBottom: 4 },

  roleOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 6,
  },
  roleOptionDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  roleOptionText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  roleOptionDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2, lineHeight: 15 },

  freeTag: { backgroundColor: '#ECFDF5', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  freeTagTxt: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#10B981' },

  field: { gap: 4 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  fieldHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: -2 },
  lotSelectorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6 },
  lotSelectorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  lotSelectorDot: { width: 8, height: 8, borderRadius: 4 },
  lotSelectorTxt: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.text, maxWidth: 110 },
  lotSelectorEmpty: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic', marginTop: 4 },
  fieldInput: {
    backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    borderWidth: 1, borderColor: C.border,
  },
  fieldError: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#EF4444', marginTop: 2 },
  fieldSeparator: {
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 2,
  },
  fieldSeparatorTxt: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  seatFullBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#BFDBFE',
  },
  seatFullBannerTxt: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: '#1D4ED8', lineHeight: 17 },

  saveBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  cancelBtn: {
    backgroundColor: C.bg, borderRadius: 12, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },

  inviteSuccessIcon: { alignItems: 'center', marginBottom: 8 },
  inviteSuccessMsg: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted,
    textAlign: 'center', lineHeight: 18, marginBottom: 12,
  },
  tokenBox: {
    backgroundColor: C.bg, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 10,
  },
  tokenTxt: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text, textAlign: 'center', letterSpacing: 1 },
  inviteHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginBottom: 12, lineHeight: 17 },

  copyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: C.primary, backgroundColor: C.primaryBg,
  },
  copyBtnDone: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  copyBtnTxt: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  copyBtnTxtDone: { color: '#10B981' },

  clearFilterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 4, paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: C.primaryBg, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '44',
  },
  clearFilterTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },

  hoursInput: {
    fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text,
    borderBottomWidth: 1, borderBottomColor: C.primary,
    minWidth: 36, textAlign: 'center', paddingVertical: 0, paddingHorizontal: 2,
  },

  memberPreview: {
    borderTopWidth: 1, borderTopColor: C.border, marginTop: 10, paddingTop: 10, gap: 8,
  },
  memberPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberPreviewAvatar: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  memberPreviewInitials: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  memberPreviewName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.text, flex: 1 },
  memberPreviewBadge: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  memberPreviewBadgeTxt: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  memberPreviewMore: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginTop: 2 },
});
