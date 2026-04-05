import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
  ActivityIndicator, Linking,
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

  const { user } = useAuth();
  const { organization, subscription, isLoading, activeOrgUsers, freeOrgUsers, orgUsers } = useSubscription();

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
