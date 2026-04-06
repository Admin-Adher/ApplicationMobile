import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, Alert, Modal,
  TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, useMemo } from 'react';
import { C } from '@/constants/colors';
import { useSubscription, OrgSummary, generateOrgSlug } from '@/context/SubscriptionContext';
import { useAuth } from '@/context/AuthContext';

const STATUS_CONFIG = {
  trial:     { label: 'Essai',     color: '#F59E0B', bg: '#FFFBEB' },
  active:    { label: 'Actif',     color: '#10B981', bg: '#ECFDF5' },
  suspended: { label: 'Suspendu',  color: '#EF4444', bg: '#FEF2F2' },
  expired:   { label: 'Expiré',    color: '#6B7280', bg: '#F3F4F6' },
} as const;

const ORG_COLORS = ['#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#06B6D4','#EC4899'];

export default function SuperAdminScreen() {
  const insets = useSafeAreaInsets();
  const topPad = insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const router = useRouter();

  const { user, users } = useAuth();
  const {
    orgSummaries, isLoading,
    updateOrgStatus, updateOrganization, createOrganization,
  } = useSubscription();

  const [activeTab, setActiveTab] = useState<'orgs' | 'dashboard'>('orgs');
  const [statusModal, setStatusModal] = useState<OrgSummary | null>(null);
  const [editModal, setEditModal] = useState<OrgSummary | null>(null);
  const [editOrgName, setEditOrgName] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [creating, setCreating] = useState(false);

  const editSlugPreview = useMemo(() => {
    const trimmed = editOrgName.trim();
    if (!trimmed || trimmed === editModal?.org.name) return null;
    return generateOrgSlug(trimmed);
  }, [editOrgName, editModal?.org.name]);

  if (user?.role !== 'super_admin') {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={styles.accessDenied}>Accès réservé au super administrateur</Text>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkTxt}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totalOrgs = orgSummaries.length;
  const activeOrgs = orgSummaries.filter(s => s.status === 'active').length;
  const trialOrgs = orgSummaries.filter(s => s.status === 'trial').length;
  const suspendedOrgs = orgSummaries.filter(s => s.status === 'suspended').length;
  const totalUsers = users.filter(u => u.role !== 'super_admin').length;
  const totalActiveUsers = users.filter(u => !['super_admin', 'observateur', 'sous_traitant'].includes(u.role)).length;

  function openEditModal(summary: OrgSummary) {
    setEditModal(summary);
    setEditOrgName(summary.org.name);
  }

  async function handleSaveEdit() {
    if (!editModal) return;
    const trimmed = editOrgName.trim();
    if (!trimmed) {
      Alert.alert('Nom requis', 'Le nom de l\'organisation ne peut pas être vide.');
      return;
    }
    if (trimmed === editModal.org.name) {
      setEditModal(null);
      return;
    }
    const newSlug = generateOrgSlug(trimmed);
    setEditSaving(true);
    const result = await updateOrganization(editModal.org.id, trimmed, newSlug);
    setEditSaving(false);
    if (result.success) {
      setEditModal(null);
    } else {
      Alert.alert('Erreur', result.error ?? 'Impossible de modifier l\'organisation.');
    }
  }

  async function handleChangeStatus(status: 'trial' | 'active' | 'suspended' | 'expired') {
    if (!statusModal) return;
    setStatusSaving(true);
    const result = await updateOrgStatus(statusModal.org.id, status);
    setStatusSaving(false);
    if (result.success) {
      setStatusModal(null);
    } else {
      Alert.alert('Erreur', result.error ?? 'Impossible de modifier le statut.');
    }
  }

  async function handleCreateOrg() {
    const name = newOrgName.trim();
    if (!name) {
      Alert.alert('Nom requis', 'Veuillez saisir le nom de l\'organisation.');
      return;
    }
    if (newAdminEmail && !newAdminEmail.includes('@')) {
      Alert.alert('Email invalide', 'Veuillez saisir une adresse email valide.');
      return;
    }
    setCreating(true);
    const result = await createOrganization(name, newAdminEmail.trim() || undefined);
    setCreating(false);
    if (result.success) {
      setCreateModal(false);
      setNewOrgName('');
      setNewAdminEmail('');
      Alert.alert(
        'Organisation créée',
        newAdminEmail.trim()
          ? `"${name}" a été créée et une invitation admin a été envoyée à ${newAdminEmail.trim()}.`
          : `"${name}" a été créée avec succès.`,
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert('Erreur', result.error ?? 'Impossible de créer l\'organisation.');
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Super Admin</Text>
          <Text style={styles.subtitle}>Tableau de bord BuildTrack</Text>
        </View>
        <TouchableOpacity style={styles.newOrgBtn} onPress={() => setCreateModal(true)}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.newOrgBtnTxt}>Nouvelle org.</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        {(['orgs', 'dashboard'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Ionicons
              name={tab === 'orgs' ? 'business-outline' : 'bar-chart-outline'}
              size={14}
              color={activeTab === tab ? C.primary : C.textMuted}
            />
            <Text style={[styles.tabBtnTxt, activeTab === tab && styles.tabBtnTxtActive]}>
              {tab === 'orgs' ? 'Organisations' : 'Tableau de bord'}
            </Text>
            {tab === 'orgs' && (
              <View style={[styles.tabCount, activeTab === tab && styles.tabCountActive]}>
                <Text style={[styles.tabCountTxt, activeTab === tab && styles.tabCountTxtActive]}>
                  {totalOrgs}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Onglet Organisations ── */}
      {activeTab === 'orgs' && (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.statsRow}>
            {[
              { label: 'Organisations', value: totalOrgs,  icon: 'business-outline',        color: C.primary },
              { label: 'En essai',       value: trialOrgs,  icon: 'time-outline',             color: '#F59E0B' },
              { label: 'Actifs',         value: activeOrgs, icon: 'checkmark-circle-outline', color: '#10B981' },
            ].map((s, i) => (
              <View key={i} style={styles.statCard}>
                <Ionicons name={s.icon as any} size={20} color={s.color} />
                <Text style={[styles.statVal, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.statLbl}>{s.label}</Text>
              </View>
            ))}
          </View>

          {isLoading ? (
            <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 40 }} />
          ) : orgSummaries.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="business-outline" size={40} color={C.textMuted} />
              <Text style={styles.emptyTxt}>Aucune organisation</Text>
              <Text style={styles.emptyHint}>Les organisations apparaissent ici lorsque des clients s'inscrivent.</Text>
            </View>
          ) : (
            orgSummaries.map((summary, i) => {
              const { org, status } = summary;
              const col = ORG_COLORS[i % ORG_COLORS.length];
              const initials = org.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
              const statusCfg = STATUS_CONFIG[status];
              return (
                <View key={org.id} style={styles.orgCard}>
                  <View style={[styles.orgAccent, { backgroundColor: col }]} />
                  <View style={styles.orgBody}>
                    {/* Ligne haute : avatar + nom + statut */}
                    <View style={styles.orgTopRow}>
                      <View style={[styles.orgAvatar, { backgroundColor: col + '22' }]}>
                        <Text style={[styles.orgAvatarTxt, { color: col }]}>{initials}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.orgName}>{org.name}</Text>
                        <Text style={styles.orgSlug}>{org.slug}</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}
                        onPress={() => setStatusModal(summary)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Text style={[styles.statusBadgeTxt, { color: statusCfg.color }]}>{statusCfg.label}</Text>
                        <Ionicons name="chevron-down" size={10} color={statusCfg.color} />
                      </TouchableOpacity>
                    </View>

                    {/* Métadonnées : date + membres */}
                    <View style={styles.orgMeta}>
                      <View style={styles.orgMetaItem}>
                        <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
                        <Text style={styles.orgMetaTxt}>
                          {new Date(org.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </Text>
                      </View>
                      <View style={styles.orgMetaItem}>
                        <Ionicons name="people-outline" size={12} color={C.textMuted} />
                        <Text style={styles.orgMetaTxt}>
                          {users.filter(u => u.organizationId === org.id).length} membre{users.filter(u => u.organizationId === org.id).length !== 1 ? 's' : ''}
                        </Text>
                      </View>
                    </View>

                    {/* Pied de carte : plan fixe + bouton Éditer */}
                    <View style={styles.orgFooter}>
                      <View style={styles.enterpriseTag}>
                        <Ionicons name="infinite-outline" size={12} color="#8B5CF6" />
                        <Text style={styles.enterpriseTagTxt}>Entreprise — Illimité</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.editOrgBtn}
                        onPress={() => openEditModal(summary)}
                      >
                        <Ionicons name="pencil-outline" size={13} color={C.primary} />
                        <Text style={styles.editOrgBtnTxt}>Éditer</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ── Onglet Tableau de bord ── */}
      {activeTab === 'dashboard' && (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.dashGrid}>
            {[
              { label: 'Filiales',    value: totalOrgs,    icon: 'business-outline',        color: C.primary },
              { label: 'Actives',     value: activeOrgs,   icon: 'checkmark-circle-outline', color: '#10B981' },
              { label: 'En essai',    value: trialOrgs,    icon: 'time-outline',             color: '#F59E0B' },
              { label: 'Suspendues',  value: suspendedOrgs, icon: 'warning-outline',          color: '#EF4444' },
            ].map((s, i) => (
              <View key={i} style={styles.dashTile}>
                <Ionicons name={s.icon as any} size={20} color={s.color} />
                <Text style={[styles.dashTileVal, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.dashTileLbl}>{s.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.dashUserCard}>
            <View style={styles.dashUserRow}>
              <View style={[styles.dashUserIcon, { backgroundColor: C.primaryBg }]}>
                <Ionicons name="people" size={22} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dashUserVal}>{totalUsers}</Text>
                <Text style={styles.dashUserLbl}>utilisateurs dans le groupe</Text>
              </View>
              <View style={styles.dashUserSub}>
                <Text style={styles.dashUserSubVal}>{totalActiveUsers}</Text>
                <Text style={styles.dashUserSubLbl}>actifs</Text>
              </View>
            </View>
          </View>

          {orgSummaries.length > 0 && (
            <>
              <Text style={styles.dashSectionTitle}>Utilisateurs par filiale</Text>
              {orgSummaries.map((summary, i) => {
                const col = ORG_COLORS[i % ORG_COLORS.length];
                const initials = summary.org.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
                const orgUserCount = users.filter(u => u.organizationId === summary.org.id).length;
                const statusCfg = STATUS_CONFIG[summary.status];
                return (
                  <View key={summary.org.id} style={styles.dashOrgRow}>
                    <View style={[styles.dashOrgAvatar, { backgroundColor: col + '22' }]}>
                      <Text style={[styles.dashOrgInitials, { color: col }]}>{initials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dashOrgName} numberOfLines={1}>{summary.org.name}</Text>
                      <View style={[styles.dashStatusBadge, { backgroundColor: statusCfg.bg }]}>
                        <Text style={[styles.dashStatusTxt, { color: statusCfg.color }]}>{statusCfg.label}</Text>
                      </View>
                    </View>
                    <View style={styles.dashOrgCount}>
                      <Text style={[styles.dashOrgCountVal, { color: col }]}>{orgUserCount}</Text>
                      <Text style={styles.dashOrgCountLbl}>membres</Text>
                    </View>
                  </View>
                );
              })}
            </>
          )}

          {orgSummaries.length === 0 && !isLoading && (
            <View style={styles.empty}>
              <Ionicons name="bar-chart-outline" size={40} color={C.textMuted} />
              <Text style={styles.emptyTxt}>Aucune donnée</Text>
              <Text style={styles.emptyHint}>Les statistiques apparaîtront dès qu'une organisation sera créée.</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Modal : Nouvelle organisation ── */}
      <Modal
        visible={createModal}
        transparent
        animationType="slide"
        onRequestClose={() => !creating && setCreateModal(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeaderRow}>
                <View style={styles.modalIconWrap}>
                  <Ionicons name="business" size={18} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Nouvelle organisation</Text>
                  <Text style={styles.modalSub}>Créer une filiale du groupe</Text>
                </View>
                <TouchableOpacity
                  onPress={() => { if (!creating) { setCreateModal(false); setNewOrgName(''); setNewAdminEmail(''); } }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={20} color={C.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Nom de l'organisation *</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="ex. Bouygues Grand-Ouest"
                  placeholderTextColor={C.textMuted}
                  value={newOrgName}
                  onChangeText={setNewOrgName}
                  autoCapitalize="words"
                  editable={!creating}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email admin <Text style={{ fontFamily: 'Inter_400Regular', color: C.textMuted }}>(optionnel)</Text></Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="admin@filiale.fr"
                  placeholderTextColor={C.textMuted}
                  value={newAdminEmail}
                  onChangeText={setNewAdminEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!creating}
                />
                <Text style={styles.inputHint}>Une invitation de rôle Admin sera envoyée à cet email.</Text>
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, (!newOrgName.trim() || creating) && styles.submitBtnDisabled]}
                onPress={handleCreateOrg}
                disabled={!newOrgName.trim() || creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="add-circle-outline" size={18} color="#fff" />
                    <Text style={styles.submitBtnTxt}>Créer l'organisation</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal : Éditer organisation ── */}
      <Modal
        visible={!!editModal}
        transparent
        animationType="slide"
        onRequestClose={() => !editSaving && setEditModal(null)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeaderRow}>
                <View style={[styles.modalIconWrap, { backgroundColor: '#F5F3FF' }]}>
                  <Ionicons name="pencil" size={18} color="#8B5CF6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Éditer l'organisation</Text>
                  <Text style={styles.modalSub} numberOfLines={1}>{editModal?.org.slug}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => { if (!editSaving) setEditModal(null); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={20} color={C.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Nom de l'organisation</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Nom de la filiale"
                  placeholderTextColor={C.textMuted}
                  value={editOrgName}
                  onChangeText={setEditOrgName}
                  autoCapitalize="words"
                  editable={!editSaving}
                />
              </View>

              <View style={styles.slugBlock}>
                <View style={styles.slugRow}>
                  <Ionicons name="link-outline" size={13} color={C.textMuted} />
                  <Text style={styles.slugTxt}>
                    {'Identifiant actuel : '}
                    <Text style={editSlugPreview ? styles.slugOld : styles.slugCurrent}>
                      {editModal?.org.slug ?? ''}
                    </Text>
                  </Text>
                </View>
                {editSlugPreview ? (
                  <View style={[styles.slugRow, { marginTop: 4 }]}>
                    <Ionicons name="arrow-forward-outline" size={13} color={C.primary} />
                    <Text style={[styles.slugTxt, { color: C.primary, fontFamily: 'Inter_600SemiBold' }]}>
                      {'Nouvel identifiant : '}{editSlugPreview}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.slugHint, { paddingLeft: 19, marginTop: 2 }]}>
                    Sera mis à jour automatiquement avec le nom
                  </Text>
                )}
              </View>

              <View style={styles.editBtnRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setEditModal(null)}
                  disabled={editSaving}
                >
                  <Text style={styles.cancelBtnTxt}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitBtn, { flex: 1 }, (!editOrgName.trim() || editSaving) && styles.submitBtnDisabled]}
                  onPress={handleSaveEdit}
                  disabled={!editOrgName.trim() || editSaving}
                >
                  {editSaving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                      <Text style={styles.submitBtnTxt}>Enregistrer</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal : Changer le statut ── */}
      <Modal visible={!!statusModal} transparent animationType="slide" onRequestClose={() => !statusSaving && setStatusModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Changer le statut</Text>
                <Text style={styles.modalSub} numberOfLines={1}>{statusModal?.org.name}</Text>
              </View>
              <TouchableOpacity onPress={() => !statusSaving && setStatusModal(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            {(Object.entries(STATUS_CONFIG) as [keyof typeof STATUS_CONFIG, typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG]][]).map(([key, cfg]) => {
              const isCurrent = statusModal?.status === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.statusOption, isCurrent && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                  onPress={() => !statusSaving && handleChangeStatus(key)}
                  disabled={statusSaving || isCurrent}
                >
                  <View style={[styles.statusDot, { backgroundColor: cfg.color }]} />
                  <Text style={[styles.statusOptionTxt, { color: isCurrent ? cfg.color : C.text }]}>
                    {cfg.label}
                  </Text>
                  {isCurrent && <Ionicons name="checkmark-circle" size={18} color={cfg.color} />}
                  {!isCurrent && statusSaving && <ActivityIndicator size="small" color={C.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  accessDenied: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.textMuted, marginTop: 16, textAlign: 'center' },
  backLink: { marginTop: 20, padding: 12 },
  backLinkTxt: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },

  header: {
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 16, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },

  tabRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, borderRadius: 10, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  tabBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  tabBtnTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  tabBtnTxtActive: { color: C.primary },
  tabCount: {
    backgroundColor: C.border, borderRadius: 10, minWidth: 20, height: 20,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  tabCountActive: { backgroundColor: C.primary + '22' },
  tabCountTxt: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.textMuted },
  tabCountTxtActive: { color: C.primary },

  content: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },

  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 14,
    alignItems: 'center', gap: 4, borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  statVal: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  statLbl: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTxt: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  emptyHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', maxWidth: 280 },

  orgCard: {
    flexDirection: 'row', backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  orgAccent: { width: 4 },
  orgBody: { flex: 1, padding: 14, gap: 8 },
  orgTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orgAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  orgAvatarTxt: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  orgName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text },
  orgSlug: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  orgMeta: { flexDirection: 'row', gap: 16 },
  orgMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  orgMetaTxt: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  orgFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  enterpriseTag: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#F5F3FF', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
  },
  enterpriseTagTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#8B5CF6' },

  editOrgBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 6 },
  editOrgBtnTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

  newOrgBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  newOrgBtnTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, gap: 14,
    ...Platform.select({
      web: { boxShadow: '0 -4px 20px rgba(0,0,0,0.12)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 20 },
    }),
  },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: C.primary + '14', alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  modalSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },

  inputGroup: { gap: 6 },
  inputLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  textInput: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
  },
  inputHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },

  slugBlock: { paddingHorizontal: 2, marginBottom: 4 },
  slugRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  slugTxt: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, flex: 1 },
  slugHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic' },
  slugCurrent: { color: C.text },
  slugOld: { color: C.textMuted, textDecorationLine: 'line-through' as const },

  editBtnRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  cancelBtn: {
    paddingVertical: 14, paddingHorizontal: 20, borderRadius: 14,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnTxt: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textMuted },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnTxt: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  statusOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusOptionTxt: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },

  dashGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dashTile: {
    width: '47%', backgroundColor: C.surface, borderRadius: 14, padding: 16,
    alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  dashTileVal: { fontSize: 28, fontFamily: 'Inter_700Bold' },
  dashTileLbl: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },

  dashUserCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  dashUserRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dashUserIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dashUserVal: { fontSize: 26, fontFamily: 'Inter_700Bold', color: C.text },
  dashUserLbl: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  dashUserSub: { alignItems: 'center' },
  dashUserSubVal: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#10B981' },
  dashUserSubLbl: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },

  dashSectionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: -4 },
  dashOrgRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  dashOrgAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dashOrgInitials: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  dashOrgName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  dashStatusBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  dashStatusTxt: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  dashOrgCount: { alignItems: 'center' },
  dashOrgCountVal: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  dashOrgCountLbl: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
