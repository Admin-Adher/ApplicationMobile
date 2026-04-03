import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Modal, Platform, ActivityIndicator, Linking, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { UserRole, Company } from '@/constants/types';
import { isSupabaseConfigured } from '@/lib/supabase';
import { genId } from '@/lib/utils';

const ROLES: { value: UserRole; label: string; color: string; bg: string; description: string }[] = [
  { value: 'admin',         label: 'Administrateur',        color: '#EF4444', bg: '#FEF2F2', description: 'Gestion complète — utilisateurs, entreprises, abonnement' },
  { value: 'conducteur',   label: 'Conducteur de travaux',  color: '#3B82F6', bg: '#EFF6FF', description: 'Pilotage chantier — réserves, plans, OPR, rapports' },
  { value: 'chef_equipe',  label: "Chef d'équipe",          color: '#F59E0B', bg: '#FFFBEB', description: 'Terrain — réserves, pointage, incidents (pas de suppression)' },
  { value: 'observateur',  label: 'Observateur',            color: '#6B7280', bg: '#F3F4F6', description: 'Lecture seule — consultation et export des données (gratuit)' },
  { value: 'sous_traitant', label: 'Sous-traitant',         color: '#10B981', bg: '#ECFDF5', description: 'Portail entreprise — voir et traiter ses propres réserves (gratuit)' },
];

const FREE_ROLES: UserRole[] = ['observateur', 'sous_traitant'];

const PLAN_COLORS: Record<string, string> = {
  Solo: '#6B7280',
  'Équipe': '#3B82F6',
  Groupe: '#8B5CF6',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  trial:     { label: "Période d'essai", color: '#F59E0B', bg: '#FFFBEB', icon: 'time-outline' },
  active:    { label: 'Actif',           color: '#10B981', bg: '#ECFDF5', icon: 'checkmark-circle-outline' },
  suspended: { label: 'Suspendu',        color: '#EF4444', bg: '#FEF2F2', icon: 'warning-outline' },
  expired:   { label: 'Expiré',          color: '#6B7280', bg: '#F3F4F6', icon: 'close-circle-outline' },
};

const COMPANY_COLORS = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#06B6D4','#F97316','#EC4899','#14B8A6','#84CC16',
];

const AVATAR_COLORS = ['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EF4444','#06B6D4','#EC4899'];

function hashColor(id: string, palette: string[]): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0x7fffffff;
  return palette[h % palette.length];
}

function RoleBadge({ role }: { role: UserRole }) {
  const r = ROLES.find(x => x.value === role) ?? ROLES[3];
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
  const topPad = insets.top;
  const bottomPad = Platform.OS === 'web' ? 0 : insets.bottom;
  const router = useRouter();

  const { user, updateUserRole, deleteUserProfile } = useAuth();
  const { companies, addCompany, updateCompanyFull, deleteCompany, updateCompanyWorkers, updateCompanyHours } = useApp();
  const {
    plan, subscription, seatUsed, seatMax, canInvite,
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
  const [roleModal, setRoleModal] = useState<{ id: string; name: string; currentRole: UserRole } | null>(null);
  const [saving, setSaving] = useState(false);

  const [companySearch, setCompanySearch] = useState('');
  const [companyModal, setCompanyModal] = useState<{ mode: 'add' | 'edit'; company?: Company } | null>(null);
  const [nom, setNom] = useState('');
  const [nomCourt, setNomCourt] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [zone, setZone] = useState('');
  const [effectif, setEffectif] = useState('');
  const [heures, setHeures] = useState('');
  const [selectedColor, setSelectedColor] = useState(COMPANY_COLORS[0]);

  const isCompanyFormDirty = !!(nom.trim() || nomCourt.trim() || phone.trim() || email.trim() || zone.trim() || effectif.trim());

  const isEditDirty = companyModal?.mode === 'edit' && !!companyModal.company && (
    nom.trim() !== companyModal.company.name ||
    nomCourt.trim().toUpperCase() !== companyModal.company.shortName ||
    effectif !== String(companyModal.company.plannedWorkers) ||
    heures !== String(companyModal.company.hoursWorked ?? 0) ||
    zone.trim() !== (companyModal.company.zone ?? '') ||
    (phone.trim() || '') !== (companyModal.company.phone ?? '') ||
    (email.trim() || '') !== (companyModal.company.email ?? '') ||
    selectedColor !== companyModal.company.color
  );

  const filteredUsers = useMemo(() => {
    let list = [...orgUsers];
    if (userSearch.trim()) {
      const q = userSearch.toLowerCase();
      list = list.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }, [orgUsers, userSearch]);

  const filteredCompanies = useMemo(() => {
    if (!companySearch.trim()) return companies;
    const q = companySearch.toLowerCase();
    return companies.filter(co =>
      co.name.toLowerCase().includes(q) ||
      co.shortName.toLowerCase().includes(q) ||
      (co.zone ?? '').toLowerCase().includes(q)
    );
  }, [companies, companySearch]);

  const roleCounts = useMemo(() => {
    const counts: Record<UserRole, number> = { super_admin: 0, admin: 0, conducteur: 0, chef_equipe: 0, observateur: 0, sous_traitant: 0 };
    orgUsers.forEach(u => { counts[u.role] = (counts[u.role] ?? 0) + 1; });
    return counts;
  }, [orgUsers]);

  const trialDaysLeft = useMemo(() => {
    if (!subscription?.trialEndsAt) return null;
    return Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }, [subscription]);

  const statusCfg = subscription ? (STATUS_CONFIG[subscription.status] ?? STATUS_CONFIG.trial) : null;

  if (user && !isAdmin) {
    router.replace('/(tabs)/' as any);
    return null;
  }

  async function handleSendInvite() {
    const emailTrimmed = inviteEmail.trim();
    if (!emailTrimmed) return;
    if (!emailTrimmed.includes('@') || !emailTrimmed.includes('.')) {
      setInviteEmailError('Adresse email invalide.');
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
      }).catch(() => {
        Alert.alert('Token', inviteToken);
      });
    } else {
      Alert.alert('Token d\'invitation', inviteToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2500);
    }
  }

  function handleCancelInvitation(id: string, email: string) {
    Alert.alert(
      'Annuler l\'invitation',
      `Annuler l'invitation envoyée à ${email} ?`,
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Annuler l\'invitation',
          style: 'destructive',
          onPress: async () => {
            await cancelInvitation(id);
            showToast('Invitation annulée');
          },
        },
      ]
    );
  }

  async function handleRoleChange(newRole: UserRole) {
    if (!roleModal) return;
    if (newRole === roleModal.currentRole) {
      setRoleModal(null);
      return;
    }
    if (roleModal.id === user?.id && newRole !== 'admin') {
      Alert.alert('Action impossible', 'Vous ne pouvez pas retirer votre propre rôle admin.');
      return;
    }
    setSaving(true);
    await updateUserRole(roleModal.id, newRole);
    setSaving(false);
    setRoleModal(null);
    showToast('Rôle mis à jour');
  }

  function handleDeleteUser(u: { id: string; name: string }) {
    if (u.id === user?.id) {
      Alert.alert('Action impossible', 'Vous ne pouvez pas supprimer votre propre compte.');
      return;
    }
    Alert.alert(
      'Supprimer le profil',
      `Supprimer le profil de "${u.name}" ?\n\nLe compte d'authentification restera actif mais l'utilisateur n'apparaîtra plus dans l'app.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: async () => {
            await deleteUserProfile(u.id);
            showToast(`Profil de ${u.name} supprimé`);
          },
        },
      ]
    );
  }

  function openAddCompany() {
    setNom(''); setNomCourt(''); setPhone(''); setEmail(''); setZone(''); setEffectif(''); setHeures('0');
    setSelectedColor(COMPANY_COLORS[companies.length % COMPANY_COLORS.length]);
    setCompanyModal({ mode: 'add' });
  }

  function openEditCompany(co: Company) {
    setNom(co.name); setNomCourt(co.shortName); setPhone(co.phone ?? '');
    setEmail(co.email ?? ''); setZone(co.zone); setEffectif(String(co.plannedWorkers));
    setHeures(String(co.hoursWorked ?? 0));
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
    const hrs = parseFloat(heures) || 0;
    const duplicate = companies.find(c =>
      c.name.toLowerCase() === nom.trim().toLowerCase() &&
      (companyModal?.mode === 'add' || c.id !== companyModal?.company?.id)
    );
    if (duplicate) {
      Alert.alert('Doublon', `Une entreprise nommée "${nom.trim()}" existe déjà.`);
      return;
    }
    if (companyModal?.mode === 'edit' && companyModal.company) {
      updateCompanyFull({
        ...companyModal.company,
        name: nom.trim(),
        shortName: nomCourt.trim().toUpperCase(),
        plannedWorkers: planned,
        hoursWorked: hrs,
        zone: zone.trim() || 'À définir',
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
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
        zone: zone.trim() || 'À définir',
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      showToast('Entreprise ajoutée');
    }
    setCompanyModal(null);
  }

  function handleDeleteCompany(co: Company) {
    Alert.alert(
      'Supprimer l\'entreprise',
      `Supprimer "${co.name}" définitivement ?\n\nLes réserves associées resteront mais sans entreprise assignée.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: () => {
            deleteCompany(co.id);
            showToast(`"${co.name}" supprimée`);
          },
        },
      ]
    );
  }

  function handleWorkerCount(co: Company, delta: number) {
    const next = Math.max(0, co.actualWorkers + delta);
    updateCompanyWorkers(co.id, next);
  }

  function handleHoursChange(co: Company, delta: number) {
    const next = Math.max(0, (co.hoursWorked ?? 0) + delta);
    updateCompanyHours(co.id, next);
  }

  const seatRatio = seatMax === -1 ? 0 : seatUsed / seatMax;
  const seatBarColor = seatRatio >= 0.9 ? '#EF4444' : seatRatio >= 0.7 ? '#F59E0B' : '#10B981';

  const isSeatFull = !canInvite;
  const isSelectedRoleFree = FREE_ROLES.includes(inviteRole);
  const sendDisabled = isSeatFull && !isSelectedRoleFree;

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
          <View style={styles.adminBadge}>
            <Ionicons name="shield-checkmark" size={14} color="#EF4444" />
            <Text style={styles.adminBadgeText}>Admin</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScrollRow} contentContainerStyle={styles.tabRowContent}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'users' && styles.tabBtnActive]}
            onPress={() => setActiveTab('users')}
          >
            <Ionicons name="people" size={14} color={activeTab === 'users' ? C.primary : C.textMuted} />
            <Text style={[styles.tabBtnText, activeTab === 'users' && styles.tabBtnTextActive]}>Utilisateurs</Text>
            <View style={[styles.tabCount, activeTab === 'users' && styles.tabCountActive]}>
              <Text style={[styles.tabCountText, activeTab === 'users' && styles.tabCountTextActive]}>{orgUsers.length}</Text>
            </View>
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
          >
            <Ionicons name="card" size={14} color={activeTab === 'abonnement' ? C.primary : C.textMuted} />
            <Text style={[styles.tabBtnText, activeTab === 'abonnement' && styles.tabBtnTextActive]}>Abonnement</Text>
            {pendingInvitations.length > 0 && (
              <View style={[styles.tabCount, styles.tabCountBadge]}>
                <Text style={[styles.tabCountText, { color: '#fff' }]}>{pendingInvitations.length}</Text>
              </View>
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
          <View style={styles.statsGrid}>
            {ROLES.map(r => (
              <View key={r.value} style={[styles.statCard, { borderTopColor: r.color }]}>
                <Text style={[styles.statNum, { color: r.color }]}>{roleCounts[r.value]}</Text>
                <Text style={styles.statLabel} numberOfLines={2}>{r.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>
              {userSearch.trim()
                ? `${filteredUsers.length} / ${orgUsers.length} utilisateur${orgUsers.length !== 1 ? 's' : ''}`
                : `${orgUsers.length} utilisateur${orgUsers.length !== 1 ? 's' : ''}`}
            </Text>
            <TouchableOpacity style={styles.addBtn} onPress={() => setInviteModal(true)}>
              <Ionicons name="person-add-outline" size={17} color="#fff" />
              <Text style={styles.addBtnText}>Inviter</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={15} color={C.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Nom ou email..."
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
                {orgUsers.length === 0 ? 'Aucun utilisateur dans l\'organisation' : 'Aucun résultat pour cette recherche'}
              </Text>
              {orgUsers.length === 0 && (
                <Text style={styles.emptyHint}>Utilisez le bouton "Inviter" pour ajouter des membres</Text>
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
                    <RoleBadge role={u.role} />
                  </View>
                  <View style={styles.userActions}>
                    {!isCurrentUser && (
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => setRoleModal({ id: u.id, name: u.name, currentRole: u.role })}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="create-outline" size={17} color={C.primary} />
                      </TouchableOpacity>
                    )}
                    {!isCurrentUser && (
                      <TouchableOpacity
                        style={[styles.iconBtn, styles.iconBtnDanger]}
                        onPress={() => handleDeleteUser(u)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="trash-outline" size={17} color={C.open} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}

          <View style={styles.hintCard}>
            <Ionicons name="key-outline" size={16} color={C.textMuted} />
            <Text style={styles.hintText}>
              Pour inviter un nouveau membre, utilisez le bouton "Inviter" ci-dessus. Un code d'accès sera généré à partager manuellement avec la personne.
            </Text>
          </View>
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
              placeholder="Nom, sigle ou zone..."
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
              <Text style={styles.emptyHint}>Ajoutez la première avec le bouton ci-dessus</Text>
            </View>
          ) : filteredCompanies.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={36} color={C.textMuted} />
              <Text style={styles.emptyText}>Aucun résultat</Text>
            </View>
          ) : (
            filteredCompanies.map(co => (
              <View key={co.id} style={styles.coCard}>
                <View style={[styles.coAccent, { backgroundColor: co.color }]} />
                <View style={styles.coBody}>
                  <View style={styles.coTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.coName}>{co.name}</Text>
                      <Text style={styles.coZone}>{co.zone}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.iconBtn}
                      onPress={() => openEditCompany(co)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="pencil-outline" size={16} color={C.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.iconBtn, styles.iconBtnDanger]}
                      onPress={() => handleDeleteCompany(co)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={16} color={C.open} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.coStatsRow}>
                    <View style={styles.coStat}>
                      <View style={[styles.coStatDot, { backgroundColor: co.color }]} />
                      <Text style={styles.coStatLabel}>Prévu</Text>
                      <Text style={[styles.coStatVal, { color: co.color }]}>{co.plannedWorkers}</Text>
                    </View>
                    <View style={[styles.coStat, { flex: 1 }]}>
                      <View style={[styles.coStatDot, { backgroundColor: C.inProgress }]} />
                      <Text style={styles.coStatLabel}>Présents</Text>
                      <TouchableOpacity
                        onPress={() => handleWorkerCount(co, -1)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.workerBtn}
                      >
                        <Ionicons name="remove" size={13} color={C.textSub} />
                      </TouchableOpacity>
                      <Text style={[styles.coStatVal, { color: C.inProgress }]}>{co.actualWorkers}</Text>
                      <TouchableOpacity
                        onPress={() => handleWorkerCount(co, 1)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.workerBtn}
                      >
                        <Ionicons name="add" size={13} color={C.textSub} />
                      </TouchableOpacity>
                    </View>
                    <View style={[styles.coStat, { flex: 1 }]}>
                      <View style={[styles.coStatDot, { backgroundColor: C.textMuted }]} />
                      <Text style={styles.coStatLabel}>Heures</Text>
                      <TouchableOpacity
                        onPress={() => handleHoursChange(co, -8)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.workerBtn}
                      >
                        <Ionicons name="remove" size={13} color={C.textSub} />
                      </TouchableOpacity>
                      <Text style={styles.coStatVal}>{co.hoursWorked ?? 0}h</Text>
                      <TouchableOpacity
                        onPress={() => handleHoursChange(co, 8)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.workerBtn}
                      >
                        <Ionicons name="add" size={13} color={C.textSub} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {co.phone && (
                    <TouchableOpacity style={styles.coContact} onPress={() => Linking.openURL(`tel:${co.phone}`)}>
                      <Ionicons name="call-outline" size={12} color={C.primary} />
                      <Text style={[styles.coContactText, { color: C.primary }]}>{co.phone}</Text>
                    </TouchableOpacity>
                  )}
                  {co.email && (
                    <TouchableOpacity style={styles.coContact} onPress={() => Linking.openURL(`mailto:${co.email}`)}>
                      <Ionicons name="mail-outline" size={12} color={C.primary} />
                      <Text style={[styles.coContactText, { color: C.primary }]}>{co.email}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
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
              <Ionicons name={statusCfg.icon} size={18} color={statusCfg.color} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusLabel, { color: statusCfg.color }]}>{statusCfg.label}</Text>
                {subscription.status === 'trial' && trialDaysLeft !== null && (
                  <Text style={[styles.statusSub, { color: statusCfg.color }]}>
                    {trialDaysLeft > 0
                      ? `${trialDaysLeft} jour${trialDaysLeft > 1 ? 's' : ''} restant${trialDaysLeft > 1 ? 's' : ''}`
                      : 'Essai terminé'}
                  </Text>
                )}
              </View>
            </View>
          )}

          {plan && (
            <View style={[styles.planCard, { borderTopColor: PLAN_COLORS[plan.name] ?? C.primary }]}>
              <View style={styles.planTopRow}>
                <View style={[styles.planBadge, { backgroundColor: (PLAN_COLORS[plan.name] ?? C.primary) + '18' }]}>
                  <Text style={[styles.planBadgeTxt, { color: PLAN_COLORS[plan.name] ?? C.primary }]}>{plan.name}</Text>
                </View>
                <Text style={styles.planPrice}>
                  {plan.priceMonthly === 0 ? 'Gratuit' : `${plan.priceMonthly} € / mois`}
                </Text>
              </View>
              {plan.features.map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <Ionicons name="checkmark-circle" size={14} color={PLAN_COLORS[plan.name] ?? C.primary} />
                  <Text style={styles.featureTxt}>{f}</Text>
                </View>
              ))}
              <TouchableOpacity style={styles.detailLink} onPress={() => router.push('/subscription')}>
                <Text style={styles.detailLinkTxt}>Voir les détails de l'abonnement</Text>
                <Ionicons name="chevron-forward" size={14} color={C.primary} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.seatCard}>
            <View style={styles.seatTopRow}>
              <View style={styles.seatLeft}>
                <Ionicons name="people" size={16} color={C.primary} />
                <Text style={styles.seatTitle}>Sièges utilisés</Text>
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
              <Text style={styles.seatWarning}>
                {seatRatio >= 1 ? 'Limite atteinte — passez à un plan supérieur pour inviter des utilisateurs actifs.' : 'Vous approchez la limite de sièges.'}
              </Text>
            )}
          </View>

          {activeOrgUsers.length > 0 && (
            <>
              <View style={styles.sectionSep} />
              <Text style={styles.subSectionTitle}>Utilisateurs actifs ({activeOrgUsers.length})</Text>
              {activeOrgUsers.map((u, i) => {
                const col = hashColor(u.id, AVATAR_COLORS);
                const initials = u.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
                return (
                  <View key={u.id} style={styles.memberRow}>
                    <View style={[styles.memberAvatar, { backgroundColor: col + '22' }]}>
                      <Text style={[styles.memberAvatarTxt, { color: col }]}>{initials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{u.name}</Text>
                      <Text style={styles.memberEmail}>{u.email}</Text>
                    </View>
                    <RoleBadge role={u.role} />
                  </View>
                );
              })}
            </>
          )}

          {freeOrgUsers.length > 0 && (
            <>
              <View style={styles.sectionSep} />
              <Text style={styles.subSectionTitle}>
                Gratuits — hors quota ({freeOrgUsers.length})
              </Text>
              {freeOrgUsers.map(u => {
                const col = '#10B981';
                const initials = u.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
                return (
                  <View key={u.id} style={[styles.memberRow, { borderColor: '#10B98122' }]}>
                    <View style={[styles.memberAvatar, { backgroundColor: '#10B98118' }]}>
                      <Text style={[styles.memberAvatarTxt, { color: col }]}>{initials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{u.name}</Text>
                      <Text style={styles.memberEmail}>{u.email}</Text>
                    </View>
                    <RoleBadge role={u.role} />
                  </View>
                );
              })}
            </>
          )}

          <View style={styles.sectionSep} />
          <Text style={styles.subSectionTitle}>Invitations en attente ({pendingInvitations.length})</Text>
          {pendingInvitations.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="mail-outline" size={36} color={C.textMuted} />
              <Text style={styles.emptyText}>Aucune invitation en attente</Text>
              <Text style={styles.emptyHint}>Invitez des collaborateurs depuis l'onglet Utilisateurs</Text>
            </View>
          ) : (
            pendingInvitations.map(inv => {
              const roleInfo = ROLES.find(r => r.value === inv.role) ?? ROLES[3];
              const expiresIn = Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              return (
                <View key={inv.id} style={styles.inviteCard}>
                  <View style={styles.inviteIconWrap}>
                    <Ionicons name="mail-outline" size={20} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inviteEmail}>{inv.email}</Text>
                    <View style={[styles.inviteRoleBadge, { backgroundColor: roleInfo.bg }]}>
                      <Text style={[styles.inviteRoleTxt, { color: roleInfo.color }]}>{roleInfo.label}</Text>
                    </View>
                    <Text style={styles.inviteExpiry}>
                      {expiresIn > 0 ? `Expire dans ${expiresIn} jour${expiresIn > 1 ? 's' : ''}` : 'Expirée'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.iconBtn, styles.iconBtnDanger]}
                    onPress={() => handleCancelInvitation(inv.id, inv.email)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={16} color={C.open} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ─── MODAL CHANGEMENT DE RÔLE ─── */}
      <Modal visible={!!roleModal} transparent animationType="slide" onRequestClose={() => setRoleModal(null)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setRoleModal(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Changer le rôle</Text>
            <Text style={styles.sheetSubtitle}>{roleModal?.name}</Text>
            {saving ? (
              <ActivityIndicator size="large" color={C.primary} style={{ marginVertical: 24 }} />
            ) : (
              ROLES.map(r => {
                const isSelected = roleModal?.currentRole === r.value;
                return (
                  <TouchableOpacity
                    key={r.value}
                    style={[styles.roleOption, isSelected && { backgroundColor: r.bg, borderColor: r.color }]}
                    onPress={() => handleRoleChange(r.value)}
                  >
                    <View style={[styles.roleOptionDot, { backgroundColor: r.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.roleOptionText, isSelected && { color: r.color, fontFamily: 'Inter_600SemiBold' }]}>
                        {r.label}
                      </Text>
                      <Text style={styles.roleOptionDesc}>{r.description}</Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={18} color={r.color} />}
                  </TouchableOpacity>
                );
              })
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setRoleModal(null)}>
              <Text style={styles.cancelBtnText}>Annuler</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ─── MODAL ENTREPRISE ─── */}
      <Modal visible={!!companyModal} transparent animationType="slide" onRequestClose={tryCloseCompanyModal}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={tryCloseCompanyModal}>
            <TouchableOpacity activeOpacity={1} style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>
                {companyModal?.mode === 'edit' ? 'Modifier l\'entreprise' : 'Ajouter une entreprise'}
              </Text>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10 }}>
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
                  <Text style={styles.fieldLabel}>Zone d'intervention</Text>
                  <TextInput style={styles.fieldInput} value={zone} onChangeText={setZone}
                    placeholder="Ex : Zone Nord — Bâtiment A" placeholderTextColor={C.textMuted} />
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
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── MODAL INVITATION ─── */}
      <Modal visible={inviteModal} transparent animationType="slide" onRequestClose={handleCloseInviteModal}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleCloseInviteModal}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10 }}>
            <View style={styles.sheetHandle} />
            {inviteToken ? (
              <>
                <View style={styles.inviteSuccessIcon}>
                  <Ionicons name="checkmark-circle" size={48} color="#10B981" />
                </View>
                <Text style={styles.sheetTitle}>Invitation créée !</Text>
                <Text style={styles.inviteSuccessMsg}>
                  Partagez ce code pour rejoindre votre organisation avec {inviteEmail}.
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
                  Ce code est valable 7 jours. L'utilisateur doit créer un compte avec l'adresse {inviteEmail} et saisir ce code — l'accès est lié à l'email, pas au code.
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
        </KeyboardAvoidingView>
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
  tabCountBadge: { backgroundColor: '#EF4444' },

  content: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  statCard: {
    flexBasis: '30%', flexGrow: 1,
    backgroundColor: C.surface, borderRadius: 10, padding: 10,
    borderTopWidth: 3, alignItems: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  statNum: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginTop: 2 },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  subSectionTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4, marginBottom: 2 },
  sectionSep: { height: 1, backgroundColor: C.border, marginVertical: 12 },

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
  userActions: { flexDirection: 'row', gap: 6 },
  iconBtn: {
    width: 34, height: 34, borderRadius: 8, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnDanger: { backgroundColor: '#FEF2F2' },

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
  coTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  coName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  coZone: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  coStatsRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  coStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  coStatDot: { width: 6, height: 6, borderRadius: 3 },
  coStatLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  coStatVal: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  workerBtn: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  coContact: { flexDirection: 'row', alignItems: 'center', gap: 5 },
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
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, padding: 14, borderWidth: 1,
  },
  statusLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  statusSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },

  planCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderTopWidth: 4, borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  planTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  planBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  planBadgeTxt: { fontSize: 14, fontFamily: 'Inter_700Bold' },
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
  seatCount: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  seatMax: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  barBg: { height: 7, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 7, borderRadius: 4 },
  seatWarning: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#EF4444', marginTop: 8 },
  freeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#10B98112', borderRadius: 8, padding: 10, marginTop: 10,
  },
  freeBannerTxt: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#10B981', flex: 1 },

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
  fieldInput: {
    backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    borderWidth: 1, borderColor: C.border,
  },
  fieldError: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#EF4444', marginTop: 2 },

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
});
