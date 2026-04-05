import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
  ActivityIndicator, Linking, Modal, TextInput, Alert, KeyboardAvoidingView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { C } from '@/constants/colors';
import { useSubscription } from '@/context/SubscriptionContext';
import { useAuth } from '@/context/AuthContext';
import { hashColor, ROLE_INFO } from '@/lib/adminUtils';

const ORG_COLORS = ['#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#06B6D4','#EC4899'];

const MODULES = [
  { icon: 'flag', label: 'Réserves & levées', desc: 'Gestion complète des réserves avec historique, photos et suivi.' },
  { icon: 'clipboard', label: 'OPR & procès-verbaux', desc: 'Opérations préalables à la réception, lots, signatures.' },
  { icon: 'walk', label: 'Visites de chantier', desc: 'Compte-rendus de visite, observations et diffusion.' },
  { icon: 'map', label: 'Plans annotés', desc: 'Import PDF/DXF, annotation à la réserve, versions.' },
  { icon: 'people', label: 'Pointage & présences', desc: 'Suivi du personnel, heures, entrées/sorties par chantier.' },
  { icon: 'chatbubbles', label: 'Messagerie interne', desc: 'Canaux par chantier, mentions, pièces jointes.' },
  { icon: 'warning', label: 'Incidents & sécurité', desc: 'Déclaration, suivi et clôture des incidents sur site.' },
  { icon: 'document-text', label: 'Gestion documentaire', desc: 'Stockage centralisé des documents par organisation.' },
  { icon: 'business', label: 'Gestion des entreprises', desc: 'Sous-traitants, effectifs prévus vs réels, heures.' },
  { icon: 'shield-checkmark', label: 'Docs réglementaires', desc: 'Suivi des habilitations, certifications et dates d\'expiration.' },
  { icon: 'stats-chart', label: 'Tableaux de bord', desc: 'Vue globale par chantier, KPIs et alertes.' },
  { icon: 'lock-closed', label: 'Rôles & permissions', desc: 'Super admin, admin, conducteur, chef d\'équipe, observateur.' },
];

const DELIVERABLES = [
  { icon: 'code-slash', label: 'Code source complet', desc: 'React Native / Expo — iOS, Android, Web.' },
  { icon: 'server', label: 'Schéma base de données', desc: 'PostgreSQL avec RLS par organisation, migrations SQL.' },
  { icon: 'git-branch', label: 'Architecture multi-organisations', desc: 'Chaque filiale = 1 organisation isolée, données étanches.' },
  { icon: 'key', label: 'Système d\'authentification', desc: 'Supabase Auth, invitations par email, rôles hiérarchiques.' },
  { icon: 'document', label: 'Documentation technique', desc: 'Structure du projet, variables d\'environnement, déploiement.' },
  { icon: 'headset', label: 'Accompagnement au déploiement', desc: 'Onboarding filiales, formation administrateurs.' },
];

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const router = useRouter();
  const [slugCopied, setSlugCopied] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [creating, setCreating] = useState(false);

  const { user } = useAuth();
  const { organization, subscription, isLoading, activeOrgUsers, freeOrgUsers, orgUsers, orgSummaries, createOrganization } = useSubscription();
  const isSuperAdmin = user?.role === 'super_admin';

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  if (!isLoading && !isAdmin) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={styles.lockedTitle}>Accès réservé aux administrateurs</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backPill}>
          <Text style={styles.backPillTxt}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  async function handleCopySlug() {
    if (!organization?.slug) return;
    await Clipboard.setStringAsync(organization.slug);
    setSlugCopied(true);
    setTimeout(() => setSlugCopied(false), 2000);
  }

  async function handleCreateOrg() {
    const name = newOrgName.trim();
    if (!name) {
      Alert.alert('Nom requis', 'Veuillez saisir le nom de la filiale.');
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
          : `"${name}" a été créée. Vous pouvez inviter un administrateur depuis la page de gestion.`,
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert('Erreur', result.error ?? "Impossible de créer l'organisation.");
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Retour"
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Licence Groupe</Text>
          <Text style={styles.headerSub}>BuildTrack BTP — Cession complète</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Hero ── */}
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Ionicons name="shield-checkmark" size={14} color="#60A5FA" />
            <Text style={styles.heroBadgeTxt}>LICENCE ENTREPRISE</Text>
          </View>
          <Text style={styles.heroTitle}>Une plateforme pour{'\n'}tout le Groupe</Text>
          <Text style={styles.heroSub}>
            Architecture multi-organisations — chaque filiale dispose de son espace isolé, ses chantiers, ses équipes et ses données.
          </Text>

          {/* Architecture visuelle */}
          <View style={styles.archRow}>
            <View style={styles.archNode}>
              <Ionicons name="business" size={20} color="#60A5FA" />
              <Text style={styles.archNodeLabel}>Groupe</Text>
            </View>
            <View style={styles.archLine} />
            <View style={styles.archCol}>
              <View style={styles.archNodeSm}><Text style={styles.archNodeSmTxt}>Filiale A</Text></View>
              <View style={styles.archNodeSm}><Text style={styles.archNodeSmTxt}>Filiale B</Text></View>
              <View style={styles.archNodeSm}><Text style={styles.archNodeSmTxt}>Filiale C</Text></View>
            </View>
            <View style={styles.archLine} />
            <View style={styles.archCol}>
              <View style={[styles.archNodeSm, styles.archNodeXs]}><Text style={styles.archNodeSmTxt}>Chantier</Text></View>
              <View style={[styles.archNodeSm, styles.archNodeXs]}><Text style={styles.archNodeSmTxt}>Chantier</Text></View>
              <View style={[styles.archNodeSm, styles.archNodeXs]}><Text style={styles.archNodeSmTxt}>Chantier</Text></View>
            </View>
          </View>

          <View style={styles.heroPills}>
            <View style={styles.heroPill}><Text style={styles.heroPillTxt}>Données étanches entre filiales</Text></View>
            <View style={styles.heroPill}><Text style={styles.heroPillTxt}>Rôles hiérarchiques</Text></View>
            <View style={styles.heroPill}><Text style={styles.heroPillTxt}>Hébergement EU</Text></View>
          </View>
        </View>

        {/* ── Filiales du Groupe (super_admin uniquement) ── */}
        {isSuperAdmin && (
          <>
            <View style={styles.groupHeader}>
              <Text style={styles.sectionTitle}>
                Filiales du Groupe <Text style={styles.sectionCount}>({orgSummaries.length})</Text>
              </Text>
              <TouchableOpacity style={styles.createBtn} onPress={() => setCreateModal(true)}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.createBtnTxt}>Nouvelle filiale</Text>
              </TouchableOpacity>
            </View>

            {orgSummaries.length === 0 ? (
              <View style={styles.emptyOrgs}>
                <Ionicons name="business-outline" size={36} color={C.textMuted} />
                <Text style={styles.emptyOrgsTitle}>Aucune organisation</Text>
                <Text style={styles.emptyOrgsHint}>Créez la première filiale du groupe ci-dessus.</Text>
              </View>
            ) : (
              orgSummaries.map((s, i) => {
                const col = ORG_COLORS[i % ORG_COLORS.length];
                const initials = s.org.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
                const statusColors: Record<string, { label: string; color: string; bg: string }> = {
                  active:    { label: 'Actif',     color: '#10B981', bg: '#ECFDF5' },
                  trial:     { label: 'Essai',     color: '#F59E0B', bg: '#FFFBEB' },
                  suspended: { label: 'Suspendu',  color: '#EF4444', bg: '#FEF2F2' },
                  expired:   { label: 'Expiré',    color: '#6B7280', bg: '#F3F4F6' },
                };
                const sc = statusColors[s.status] ?? statusColors.expired;
                return (
                  <View key={s.org.id} style={[styles.filialCard, { borderLeftColor: col }]}>
                    <View style={styles.filialTop}>
                      <View style={[styles.filialAvatar, { backgroundColor: col + '20' }]}>
                        <Text style={[styles.filialAvatarTxt, { color: col }]}>{initials}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.filialName}>{s.org.name}</Text>
                        <Text style={styles.filialSlug}>{s.org.slug}</Text>
                      </View>
                      <View style={[styles.filialStatusBadge, { backgroundColor: sc.bg }]}>
                        <View style={[styles.filialStatusDot, { backgroundColor: sc.color }]} />
                        <Text style={[styles.filialStatusTxt, { color: sc.color }]}>{sc.label}</Text>
                      </View>
                    </View>
                    <View style={styles.filialFooter}>
                      <View style={styles.filialMeta}>
                        <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
                        <Text style={styles.filialMetaTxt}>
                          {new Date(s.org.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </Text>
                      </View>
                      <View style={styles.filialMeta}>
                        <Ionicons name="people-outline" size={12} color={C.textMuted} />
                        <Text style={styles.filialMetaTxt}>
                          {s.seatMax === -1 ? 'Illimité' : `${s.seatMax} sièges`}
                        </Text>
                      </View>
                      <View style={[styles.filialPlanBadge, { backgroundColor: C.primary + '14' }]}>
                        <Text style={[styles.filialPlanTxt, { color: C.primary }]}>{s.planName}</Text>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}

        {/* ── Organisation active ── */}
        {organization && (
          <>
            <Text style={styles.sectionTitle}>Votre organisation</Text>
            <View style={styles.orgCard}>
              <View style={styles.orgIconRow}>
                <View style={styles.orgIcon}>
                  <Ionicons name="business" size={22} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orgName}>{organization.name}</Text>
                  <View style={styles.slugRow}>
                    <Text style={styles.orgSlug}>{organization.slug}</Text>
                    <TouchableOpacity
                      onPress={handleCopySlug}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      accessibilityLabel="Copier l'identifiant"
                    >
                      <Ionicons
                        name={slugCopied ? 'checkmark-circle' : 'copy-outline'}
                        size={15}
                        color={slugCopied ? '#10B981' : C.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={[styles.activeBadge, subscription?.status === 'active' ? styles.activeBadgeGreen : styles.activeBadgeGray]}>
                  <Text style={[styles.activeBadgeTxt, subscription?.status === 'active' ? { color: '#10B981' } : { color: C.textMuted }]}>
                    {subscription?.status === 'active' ? 'Active' : subscription?.status === 'trial' ? 'Essai' : 'Inactive'}
                  </Text>
                </View>
              </View>

              <View style={styles.orgStatsRow}>
                <View style={styles.orgStat}>
                  <Text style={styles.orgStatValue}>{activeOrgUsers.length}</Text>
                  <Text style={styles.orgStatLabel}>Membres actifs</Text>
                </View>
                <View style={styles.orgStatDivider} />
                <View style={styles.orgStat}>
                  <Text style={styles.orgStatValue}>{freeOrgUsers.length}</Text>
                  <Text style={styles.orgStatLabel}>Observateurs</Text>
                </View>
                <View style={styles.orgStatDivider} />
                <View style={styles.orgStat}>
                  <Text style={styles.orgStatValue}>∞</Text>
                  <Text style={styles.orgStatLabel}>Chantiers</Text>
                </View>
              </View>
            </View>
          </>
        )}

        {/* ── Membres ── */}
        {orgUsers.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              Membres <Text style={styles.sectionCount}>({orgUsers.length})</Text>
            </Text>
            {orgUsers.slice(0, 5).map(u => {
              const col = hashColor(u.id);
              const rc = ROLE_INFO[u.role] ?? { color: col, bg: col + '18', label: u.roleLabel };
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
                  <View style={[styles.memberRoleBadge, { backgroundColor: rc.bg }]}>
                    <Text style={[styles.memberRoleTxt, { color: rc.color }]}>{rc.label}</Text>
                  </View>
                </View>
              );
            })}
            {orgUsers.length > 5 && (
              <Text style={styles.moreMembers}>+{orgUsers.length - 5} membres supplémentaires</Text>
            )}
          </>
        )}

        {/* ── Ce qui est livré ── */}
        <Text style={styles.sectionTitle}>Ce que le groupe reçoit</Text>
        <View style={styles.deliverablesGrid}>
          {DELIVERABLES.map((d, i) => (
            <View key={i} style={styles.deliverableCard}>
              <View style={styles.deliverableIcon}>
                <Ionicons name={d.icon as any} size={20} color={C.primary} />
              </View>
              <Text style={styles.deliverableLabel}>{d.label}</Text>
              <Text style={styles.deliverableDesc}>{d.desc}</Text>
            </View>
          ))}
        </View>

        {/* ── Modules inclus ── */}
        <Text style={styles.sectionTitle}>12 modules inclus</Text>
        <View style={styles.modulesList}>
          {MODULES.map((m, i) => (
            <View key={i} style={styles.moduleRow}>
              <View style={styles.moduleIconWrap}>
                <Ionicons name={m.icon as any} size={18} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.moduleLabel}>{m.label}</Text>
                <Text style={styles.moduleDesc}>{m.desc}</Text>
              </View>
              <Ionicons name="checkmark-circle" size={18} color="#10B981" />
            </View>
          ))}
        </View>

        {/* ── Sécurité & conformité ── */}
        <Text style={styles.sectionTitle}>Sécurité & conformité</Text>
        <View style={styles.securityGrid}>
          {[
            { icon: 'shield', label: 'RLS PostgreSQL', sub: 'Isolation totale des données par organisation' },
            { icon: 'earth', label: 'Hébergement EU', sub: 'Données hébergées en Europe (RGPD)' },
            { icon: 'lock-closed', label: 'Auth sécurisée', sub: 'JWT, sessions Supabase, refresh automatique' },
            { icon: 'eye-off', label: 'Données étanches', sub: 'Aucun accès croisé entre filiales' },
          ].map((s, i) => (
            <View key={i} style={styles.securityCard}>
              <Ionicons name={s.icon as any} size={22} color="#3B82F6" />
              <Text style={styles.securityLabel}>{s.label}</Text>
              <Text style={styles.securitySub}>{s.sub}</Text>
            </View>
          ))}
        </View>

        {/* ── Contact ── */}
        <View style={styles.contactCard}>
          <View style={styles.contactHeader}>
            <Ionicons name="mail" size={20} color="#fff" />
            <Text style={styles.contactTitle}>Contact & accompagnement</Text>
          </View>
          <Text style={styles.contactBody}>
            Pour toute question sur la licence, le déploiement par filiale ou la formation des administrateurs, contactez votre responsable de compte BuildTrack.
          </Text>
          <TouchableOpacity
            style={styles.contactBtn}
            onPress={() => Linking.openURL('mailto:contact@buildtrack.fr')}
          >
            <Ionicons name="mail-outline" size={16} color={C.primary} />
            <Text style={styles.contactBtnTxt}>contact@buildtrack.fr</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* ── Modal : Nouvelle filiale ── */}
      <Modal
        visible={createModal}
        transparent
        animationType="slide"
        onRequestClose={() => !creating && setCreateModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleRow}>
                  <View style={styles.modalIconWrap}>
                    <Ionicons name="business" size={18} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>Nouvelle filiale</Text>
                    <Text style={styles.modalSub}>Créer une organisation dans le groupe</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => { if (!creating) { setCreateModal(false); setNewOrgName(''); setNewAdminEmail(''); } }}
                    style={styles.modalCloseBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={20} color={C.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Nom de la filiale *</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="ex. Bouygues Île-de-France"
                  placeholderTextColor={C.textMuted}
                  value={newOrgName}
                  onChangeText={setNewOrgName}
                  autoCapitalize="words"
                  editable={!creating}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email de l'administrateur <Text style={styles.inputOptional}>(optionnel)</Text></Text>
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
                <Text style={styles.inputHint}>
                  Une invitation de rôle Admin sera envoyée à cet email.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.createConfirmBtn, (!newOrgName.trim() || creating) && styles.createConfirmBtnDisabled]}
                onPress={handleCreateOrg}
                disabled={!newOrgName.trim() || creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="add-circle-outline" size={18} color="#fff" />
                    <Text style={styles.createConfirmBtnTxt}>Créer la filiale</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  lockedTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginTop: 16, textAlign: 'center' },
  backPill: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 },
  backPillTxt: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  header: {
    backgroundColor: '#0F2D6B',
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#fff' },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#93C5FD', marginTop: 1 },

  content: { paddingHorizontal: 16, paddingTop: 0, gap: 12 },

  hero: {
    backgroundColor: '#0F2D6B',
    marginHorizontal: -16,
    paddingHorizontal: 24,
    paddingBottom: 28,
    paddingTop: 8,
    gap: 14,
  },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  heroBadgeTxt: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#60A5FA', letterSpacing: 1 },
  heroTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#fff', lineHeight: 32 },
  heroSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#BFDBFE', lineHeight: 21 },

  archRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1E3A8A', borderRadius: 14, padding: 16, marginTop: 4,
  },
  archNode: { alignItems: 'center', gap: 4, minWidth: 52 },
  archNodeLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#93C5FD' },
  archLine: { flex: 1, height: 1, backgroundColor: '#3B5FA0' },
  archCol: { gap: 6, minWidth: 60 },
  archNodeSm: {
    backgroundColor: '#2563EB22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: '#3B82F633',
  },
  archNodeXs: { backgroundColor: '#10B98122', borderColor: '#10B98133' },
  archNodeSmTxt: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#BFDBFE' },

  heroPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heroPill: { backgroundColor: '#1E3A8A', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  heroPillTxt: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#93C5FD' },

  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text, marginTop: 8 },
  sectionCount: { fontFamily: 'Inter_400Regular', color: C.textMuted, fontSize: 14 },

  groupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8,
  },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
  },
  createBtnTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  emptyOrgs: {
    alignItems: 'center', paddingVertical: 40, gap: 8,
    backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    borderStyle: 'dashed',
  },
  emptyOrgsTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  emptyOrgsHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', maxWidth: 240 },

  filialCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 4,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.07)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
    }),
  },
  filialTop: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingBottom: 10 },
  filialAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  filialAvatarTxt: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  filialName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text },
  filialSlug: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  filialStatusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  filialStatusDot: { width: 6, height: 6, borderRadius: 3 },
  filialStatusTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  filialFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingBottom: 12, paddingTop: 4,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  filialMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  filialMetaTxt: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  filialPlanBadge: { marginLeft: 'auto' as any, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  filialPlanTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 32, gap: 16,
    ...Platform.select({
      web: { boxShadow: '0 -4px 20px rgba(0,0,0,0.12)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 20 },
    }),
  },
  modalHeader: { marginBottom: 2 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: C.primary + '14', alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  modalSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  modalCloseBtn: { padding: 4 },

  inputGroup: { gap: 6 },
  inputLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  inputOptional: { fontFamily: 'Inter_400Regular', color: C.textMuted },
  textInput: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
  },
  inputHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },

  createConfirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, marginTop: 4,
  },
  createConfirmBtnDisabled: { opacity: 0.5 },
  createConfirmBtnTxt: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  orgCard: {
    backgroundColor: C.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: C.border, gap: 16,
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.07)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
    }),
  },
  orgIconRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orgIcon: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: C.primary + '14', alignItems: 'center', justifyContent: 'center',
  },
  orgName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  slugRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  orgSlug: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  activeBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  activeBadgeGreen: { backgroundColor: '#ECFDF5' },
  activeBadgeGray: { backgroundColor: C.border },
  activeBadgeTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  orgStatsRow: { flexDirection: 'row', alignItems: 'center' },
  orgStat: { flex: 1, alignItems: 'center', gap: 2 },
  orgStatValue: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  orgStatLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
  orgStatDivider: { width: 1, height: 36, backgroundColor: C.border },

  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  memberAvatarTxt: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  memberName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  memberEmail: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  memberRoleBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  memberRoleTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  moreMembers: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', paddingVertical: 4 },

  deliverablesGrid: { gap: 10 },
  deliverableCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, gap: 6,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  deliverableIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: C.primary + '12', alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
  },
  deliverableLabel: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text },
  deliverableDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 18 },

  modulesList: {
    backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  moduleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  moduleIconWrap: {
    width: 34, height: 34, borderRadius: 8,
    backgroundColor: C.primary + '12', alignItems: 'center', justifyContent: 'center',
  },
  moduleLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  moduleDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1, lineHeight: 17 },

  securityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  securityCard: {
    backgroundColor: '#EFF6FF', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#BFDBFE', gap: 6,
    width: '47.5%', flexGrow: 1,
  },
  securityLabel: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#1E40AF' },
  securitySub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#3B82F6', lineHeight: 16 },

  contactCard: {
    backgroundColor: '#0F2D6B', borderRadius: 16, padding: 20, gap: 12,
    marginTop: 4,
  },
  contactHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  contactTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
  contactBody: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#BFDBFE', lineHeight: 20 },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  contactBtnTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
});
