import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Modal, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { UserRole, Company } from '@/constants/types';
import { isSupabaseConfigured } from '@/lib/supabase';

const ROLES: { value: UserRole; label: string; color: string; bg: string }[] = [
  { value: 'admin',       label: 'Administrateur',         color: '#EF4444', bg: '#FEF2F2' },
  { value: 'conducteur',  label: 'Conducteur de travaux',  color: '#3B82F6', bg: '#EFF6FF' },
  { value: 'chef_equipe', label: "Chef d'équipe",          color: '#F59E0B', bg: '#FFFBEB' },
  { value: 'observateur', label: 'Observateur',            color: '#6B7280', bg: '#F3F4F6' },
];

const COMPANY_COLORS = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#06B6D4','#F97316','#EC4899','#14B8A6','#84CC16',
];

function genId() {
  return Date.now().toString() + Math.random().toString(36).substring(2, 8);
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
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 0 : insets.bottom;

  const { user, users, updateUserRole, deleteUserProfile } = useAuth();
  const { companies, addCompany, updateCompanyFull, deleteCompany, updateCompanyWorkers, updateCompanyHours } = useApp();

  const [activeTab, setActiveTab] = useState<'users' | 'companies'>('users');
  const [userSearch, setUserSearch] = useState('');
  const [roleModal, setRoleModal] = useState<{ id: string; name: string; currentRole: UserRole } | null>(null);
  const [saving, setSaving] = useState(false);

  const [companyModal, setCompanyModal] = useState<{ mode: 'add' | 'edit'; company?: Company } | null>(null);
  const [nom, setNom] = useState('');
  const [nomCourt, setNomCourt] = useState('');
  const [contact, setContact] = useState('');
  const [zone, setZone] = useState('');
  const [effectif, setEffectif] = useState('');

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return users;
    const q = userSearch.toLowerCase();
    return users.filter(u =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  const roleCounts = useMemo(() => {
    const counts: Record<UserRole, number> = { admin: 0, conducteur: 0, chef_equipe: 0, observateur: 0 };
    users.forEach(u => { counts[u.role] = (counts[u.role] ?? 0) + 1; });
    return counts;
  }, [users]);

  async function handleRoleChange(newRole: UserRole) {
    if (!roleModal) return;
    if (roleModal.id === user?.id && newRole !== 'admin') {
      Alert.alert('Action impossible', 'Vous ne pouvez pas retirer votre propre rôle admin.');
      return;
    }
    setSaving(true);
    await updateUserRole(roleModal.id, newRole);
    setSaving(false);
    setRoleModal(null);
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
          onPress: async () => { await deleteUserProfile(u.id); },
        },
      ]
    );
  }

  function openAddCompany() {
    setNom(''); setNomCourt(''); setContact(''); setZone(''); setEffectif('');
    setCompanyModal({ mode: 'add' });
  }

  function openEditCompany(co: Company) {
    setNom(co.name); setNomCourt(co.shortName); setContact(co.contact);
    setZone(co.zone); setEffectif(String(co.plannedWorkers));
    setCompanyModal({ mode: 'edit', company: co });
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
    if (companyModal?.mode === 'edit' && companyModal.company) {
      updateCompanyFull({
        ...companyModal.company,
        name: nom.trim(),
        shortName: nomCourt.trim().toUpperCase(),
        plannedWorkers: planned,
        zone: zone.trim() || 'À définir',
        contact: contact.trim() || '—',
      });
    } else {
      const color = COMPANY_COLORS[companies.length % COMPANY_COLORS.length];
      addCompany({
        id: genId(),
        name: nom.trim(),
        shortName: nomCourt.trim().toUpperCase(),
        color,
        plannedWorkers: planned,
        actualWorkers: 0,
        hoursWorked: 0,
        zone: zone.trim() || 'À définir',
        contact: contact.trim() || '—',
      });
    }
    setCompanyModal(null);
  }

  function handleDeleteCompany(co: Company) {
    Alert.alert(
      'Supprimer l\'entreprise',
      `Supprimer "${co.name}" définitivement ?\n\nLes réserves associées resteront mais sans entreprise assignée.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => deleteCompany(co.id) },
      ]
    );
  }

  const avatarColors = ['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EF4444','#06B6D4','#EC4899'];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Administration</Text>
            <Text style={styles.subtitle}>Gestion des accès et des équipes</Text>
          </View>
          <View style={[styles.adminBadge]}>
            <Ionicons name="shield-checkmark" size={14} color="#EF4444" />
            <Text style={styles.adminBadgeText}>Admin</Text>
          </View>
        </View>

        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'users' && styles.tabBtnActive]}
            onPress={() => setActiveTab('users')}
          >
            <Ionicons name="people" size={14} color={activeTab === 'users' ? C.primary : C.textMuted} />
            <Text style={[styles.tabBtnText, activeTab === 'users' && styles.tabBtnTextActive]}>
              Utilisateurs
            </Text>
            <View style={[styles.tabCount, activeTab === 'users' && styles.tabCountActive]}>
              <Text style={[styles.tabCountText, activeTab === 'users' && styles.tabCountTextActive]}>
                {users.length}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'companies' && styles.tabBtnActive]}
            onPress={() => setActiveTab('companies')}
          >
            <Ionicons name="business" size={14} color={activeTab === 'companies' ? C.primary : C.textMuted} />
            <Text style={[styles.tabBtnText, activeTab === 'companies' && styles.tabBtnTextActive]}>
              Entreprises
            </Text>
            <View style={[styles.tabCount, activeTab === 'companies' && styles.tabCountActive]}>
              <Text style={[styles.tabCountText, activeTab === 'companies' && styles.tabCountTextActive]}>
                {companies.length}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {activeTab === 'users' ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.statsRow}>
            {ROLES.map(r => (
              <View key={r.value} style={[styles.statCard, { borderTopColor: r.color }]}>
                <Text style={[styles.statNum, { color: r.color }]}>{roleCounts[r.value]}</Text>
                <Text style={styles.statLabel} numberOfLines={2}>{r.label}</Text>
              </View>
            ))}
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
              <Ionicons name="people-outline" size={36} color={C.textMuted} />
              <Text style={styles.emptyText}>Aucun utilisateur trouvé</Text>
            </View>
          ) : (
            filteredUsers.map((u, i) => {
              const avatarColor = avatarColors[i % avatarColors.length];
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
                    <TouchableOpacity
                      style={styles.iconBtn}
                      onPress={() => setRoleModal({ id: u.id, name: u.name, currentRole: u.role })}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="shield-outline" size={17} color={C.primary} />
                    </TouchableOpacity>
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
              Pour créer de nouveaux comptes, utilisez le tableau de bord Supabase ou l'écran de connexion (inscription automatique au premier login).
            </Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>
              {companies.length} entreprise{companies.length !== 1 ? 's' : ''} sur chantier
            </Text>
            <TouchableOpacity style={styles.addBtn} onPress={openAddCompany}>
              <Ionicons name="add" size={17} color="#fff" />
              <Text style={styles.addBtnText}>Ajouter</Text>
            </TouchableOpacity>
          </View>

          {companies.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="business-outline" size={36} color={C.textMuted} />
              <Text style={styles.emptyText}>Aucune entreprise</Text>
              <Text style={styles.emptyHint}>Ajoutez la première avec le bouton ci-dessus</Text>
            </View>
          ) : (
            companies.map(co => (
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
                      <Text style={styles.coStatLabel}>Effectif prévu</Text>
                      <Text style={[styles.coStatVal, { color: co.color }]}>{co.plannedWorkers}</Text>
                    </View>
                    <View style={styles.coStat}>
                      <View style={[styles.coStatDot, { backgroundColor: C.inProgress }]} />
                      <Text style={styles.coStatLabel}>Présents</Text>
                      <Text style={[styles.coStatVal, { color: C.inProgress }]}>{co.actualWorkers}</Text>
                    </View>
                    <View style={styles.coStat}>
                      <View style={[styles.coStatDot, { backgroundColor: C.textMuted }]} />
                      <Text style={styles.coStatLabel}>Heures</Text>
                      <Text style={styles.coStatVal}>{co.hoursWorked}h</Text>
                    </View>
                  </View>
                  {co.contact !== '—' && (
                    <View style={styles.coContact}>
                      <Ionicons name="call-outline" size={12} color={C.textMuted} />
                      <Text style={styles.coContactText}>{co.contact}</Text>
                    </View>
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal
        visible={!!roleModal}
        transparent
        animationType="slide"
        onRequestClose={() => setRoleModal(null)}
      >
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
                    <Text style={[styles.roleOptionText, isSelected && { color: r.color, fontFamily: 'Inter_600SemiBold' }]}>
                      {r.label}
                    </Text>
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

      <Modal
        visible={!!companyModal}
        transparent
        animationType="slide"
        onRequestClose={() => setCompanyModal(null)}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setCompanyModal(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {companyModal?.mode === 'edit' ? 'Modifier l\'entreprise' : 'Ajouter une entreprise'}
            </Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Nom complet *</Text>
              <TextInput
                style={styles.fieldInput}
                value={nom}
                onChangeText={setNom}
                placeholder="Ex : Maçonnerie Dupont"
                placeholderTextColor={C.textMuted}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Sigle *</Text>
              <TextInput
                style={styles.fieldInput}
                value={nomCourt}
                onChangeText={setNomCourt}
                placeholder="Ex : MD"
                placeholderTextColor={C.textMuted}
                autoCapitalize="characters"
                maxLength={6}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Effectif prévu *</Text>
              <TextInput
                style={styles.fieldInput}
                value={effectif}
                onChangeText={setEffectif}
                placeholder="Ex : 8"
                placeholderTextColor={C.textMuted}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Zone d'intervention</Text>
              <TextInput
                style={styles.fieldInput}
                value={zone}
                onChangeText={setZone}
                placeholder="Ex : Zone Nord — Bâtiment A"
                placeholderTextColor={C.textMuted}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Contact</Text>
              <TextInput
                style={styles.fieldInput}
                value={contact}
                onChangeText={setContact}
                placeholder="Ex : 06 12 34 56 78"
                placeholderTextColor={C.textMuted}
                keyboardType="phone-pad"
              />
            </View>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveCompany}>
              <Text style={styles.saveBtnText}>
                {companyModal?.mode === 'edit' ? 'Enregistrer les modifications' : 'Ajouter l\'entreprise'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setCompanyModal(null)}>
              <Text style={styles.cancelBtnText}>Annuler</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 16,
    paddingBottom: 0,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  adminBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FEF2F2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#FECACA',
  },
  adminBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },

  tabRow: { flexDirection: 'row', gap: 6, paddingBottom: 12 },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: 10, backgroundColor: C.bg,
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

  content: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  statCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 10, padding: 10,
    borderTopWidth: 3, alignItems: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  statNum: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginTop: 2 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },

  infoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EFF6FF', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  infoBannerText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress },

  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  userCardSelf: { borderColor: C.primary + '44', backgroundColor: C.primaryBg },
  avatar: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  userInfo: { flex: 1, gap: 4 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  userName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  selfBadge: {
    backgroundColor: C.primaryBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
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

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
  },
  addBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  coCard: {
    flexDirection: 'row', backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  coAccent: { width: 4 },
  coBody: { flex: 1, padding: 14, gap: 10 },
  coTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  coName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  coZone: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  coStatsRow: { flexDirection: 'row', gap: 12 },
  coStat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  coStatDot: { width: 6, height: 6, borderRadius: 3 },
  coStatLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  coStatVal: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  coContact: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  coContactText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },

  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  emptyHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24, gap: 10,
    maxHeight: '90%',
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: C.border, borderRadius: 2,
    alignSelf: 'center', marginBottom: 6,
  },
  sheetTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center' },
  sheetSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginBottom: 4 },

  roleOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border,
  },
  roleOptionDot: { width: 10, height: 10, borderRadius: 5 },
  roleOptionText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },

  field: { gap: 4 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  fieldInput: {
    backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    borderWidth: 1, borderColor: C.border,
  },

  saveBtn: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  cancelBtn: {
    backgroundColor: C.bg, borderRadius: 12, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
});
