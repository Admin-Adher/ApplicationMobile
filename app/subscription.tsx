import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { C } from '@/constants/colors';
import { useSubscription } from '@/context/SubscriptionContext';
import { useAuth } from '@/context/AuthContext';
import { SubscriptionStatus } from '@/constants/types';
import { PLAN_COLORS, ROLE_INFO, hashColor, formatDate } from '@/lib/adminUtils';

const STATUS_CONFIG: Record<SubscriptionStatus, { label: string; color: string; bg: string; icon: any }> = {
  trial:     { label: 'Période d\'essai', color: '#F59E0B', bg: '#FFFBEB', icon: 'time-outline' },
  active:    { label: 'Actif',            color: '#10B981', bg: '#ECFDF5', icon: 'checkmark-circle-outline' },
  suspended: { label: 'Suspendu',         color: '#EF4444', bg: '#FEF2F2', icon: 'warning-outline' },
  expired:   { label: 'Expiré',           color: '#6B7280', bg: '#F3F4F6', icon: 'close-circle-outline' },
};

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return d > 0 ? d : 0;
}

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const router = useRouter();
  const [slugCopied, setSlugCopied] = useState(false);

  const { user } = useAuth();
  const {
    organization, plan, subscription, seatUsed, seatMax,
    isLoading, orgUsers, activeOrgUsers, freeOrgUsers,
  } = useSubscription();

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

  if (!subscription) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="alert-circle-outline" size={48} color={C.textMuted} />
        <Text style={styles.lockedTitle}>Aucun abonnement trouvé</Text>
        <Text style={styles.emptyHint}>Contactez le support pour configurer votre organisation.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backPill}>
          <Text style={styles.backPillTxt}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const statusCfg = STATUS_CONFIG[subscription.status];
  const planColor = plan ? (PLAN_COLORS[plan.name] ?? C.primary) : C.primary;
  const trialDays = daysUntil(subscription.trialEndsAt);
  const seatRatio = seatMax === -1 ? 0 : seatUsed / seatMax;
  const seatBarColor = seatRatio >= 0.9 ? '#EF4444' : seatRatio >= 0.7 ? '#F59E0B' : '#10B981';
  const isSuspendedOrExpired = subscription.status === 'suspended' || subscription.status === 'expired';

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
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Abonnement</Text>
          <Text style={styles.subtitle}>{organization?.name ?? 'Mon organisation'}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Statut + dates */}
        <View style={[styles.statusBanner, { backgroundColor: statusCfg.bg, borderColor: statusCfg.color + '44' }]}>
          <Ionicons name={statusCfg.icon} size={20} color={statusCfg.color} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusLabel, { color: statusCfg.color }]}>{statusCfg.label}</Text>
            {subscription.status === 'trial' && trialDays !== null && (
              <Text style={[styles.statusSub, { color: statusCfg.color }]}>
                {trialDays > 0
                  ? `${trialDays} jour${trialDays > 1 ? 's' : ''} restant${trialDays > 1 ? 's' : ''} — se termine le ${formatDate(subscription.trialEndsAt)}`
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
            {subscription.status === 'suspended' && (
              <Text style={[styles.statusSub, { color: statusCfg.color }]}>
                Accès restreint — régularisez votre situation
              </Text>
            )}
            {subscription.status === 'expired' && (
              <Text style={[styles.statusSub, { color: statusCfg.color }]}>
                Abonnement expiré{subscription.expiresAt ? ` le ${formatDate(subscription.expiresAt)}` : ''}
              </Text>
            )}
          </View>
        </View>

        {/* CTA suspended / expired */}
        {isSuspendedOrExpired && (
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

        {/* Infos organisation */}
        {organization && (
          <View style={styles.orgCard}>
            <Text style={styles.orgCardTitle}>Organisation</Text>
            <View style={styles.orgRow}>
              <Text style={styles.orgLabel}>Nom</Text>
              <Text style={styles.orgValue}>{organization.name}</Text>
            </View>
            <View style={styles.orgRow}>
              <Text style={styles.orgLabel}>Identifiant interne</Text>
              <View style={styles.slugRow}>
                <Text style={styles.orgValue}>{organization.slug}</Text>
                <TouchableOpacity
                  onPress={handleCopySlug}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityLabel="Copier l'identifiant"
                >
                  <Ionicons
                    name={slugCopied ? 'checkmark-circle' : 'copy-outline'}
                    size={16}
                    color={slugCopied ? '#10B981' : C.textMuted}
                  />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.orgRow}>
              <Text style={styles.orgLabel}>Créée le</Text>
              <Text style={styles.orgValue}>{formatDate(organization.createdAt)}</Text>
            </View>
            {subscription.startedAt && (
              <View style={styles.orgRow}>
                <Text style={styles.orgLabel}>Abonnement depuis</Text>
                <Text style={styles.orgValue}>{formatDate(subscription.startedAt)}</Text>
              </View>
            )}
          </View>
        )}

        {/* Plan */}
        {plan && (
          <View style={[styles.planCard, { borderTopColor: planColor }]}>
            <View style={styles.planTopRow}>
              <View style={[styles.planBadge, { backgroundColor: planColor + '18' }]}>
                <Text style={[styles.planBadgeTxt, { color: planColor }]}>{plan.name}</Text>
              </View>
              <Text style={styles.planPrice}>
                {plan.priceMonthly === 0 ? 'Gratuit' : `${plan.priceMonthly} € / mois`}
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Fonctionnalités incluses</Text>
            {plan.features.map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={15} color={planColor} />
                <Text style={styles.featureTxt}>{f}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Sièges */}
        <View style={styles.seatCard}>
          <View style={styles.seatTopRow}>
            <View style={styles.seatLeft}>
              <Ionicons name="people" size={18} color={C.primary} />
              <View>
                <Text style={styles.seatTitle}>Utilisateurs actifs</Text>
                <Text style={styles.seatSubtitle}>Admin · Conducteur · Chef d'équipe</Text>
              </View>
            </View>
            <Text style={styles.seatCount}>
              {seatUsed}
              <Text style={styles.seatMaxTxt}>
                {seatMax === -1 ? ' / ∞' : ` / ${seatMax}`}
              </Text>
            </Text>
          </View>
          {seatMax !== -1 && (
            <View style={styles.barBg}>
              <View style={[styles.barFill, { width: `${Math.min(seatRatio * 100, 100)}%` as any, backgroundColor: seatBarColor }]} />
            </View>
          )}
          {seatMax !== -1 && seatRatio >= 0.9 && (
            <Text style={styles.seatWarning}>
              {seatRatio >= 1 ? 'Limite atteinte — contactez le support pour passer à un plan supérieur.' : 'Vous approchez la limite de sièges.'}
            </Text>
          )}
          {freeOrgUsers.length > 0 && (
            <View style={styles.freeBanner}>
              <Ionicons name="gift-outline" size={14} color="#10B981" />
              <Text style={styles.freeBannerTxt}>
                {freeOrgUsers.length} sous-traitant{freeOrgUsers.length > 1 ? 's' : ''} / observateur{freeOrgUsers.length > 1 ? 's' : ''} — <Text style={{ fontFamily: 'Inter_600SemiBold' }}>hors quota</Text>
              </Text>
            </View>
          )}
        </View>

        {/* Membres actifs */}
        {activeOrgUsers.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              Membres actifs <Text style={styles.sectionCount}>({activeOrgUsers.length})</Text>
            </Text>
            {activeOrgUsers.map(u => {
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
          </>
        )}

        {/* Membres gratuits */}
        {freeOrgUsers.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              Hors quota <Text style={styles.sectionCount}>({freeOrgUsers.length})</Text>
            </Text>
            {freeOrgUsers.map(u => {
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
          </>
        )}

        {orgUsers.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={36} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucun membre dans l'organisation</Text>
          </View>
        )}

        <View style={styles.hintCard}>
          <Ionicons name="information-circle-outline" size={15} color={C.textMuted} />
          <Text style={styles.hintText}>
            Pour changer de formule, ajouter des sièges ou gérer la facturation, contactez le support BuildTrack à{' '}
            <Text
              style={{ textDecorationLine: 'underline' }}
              onPress={() => Linking.openURL('mailto:support@buildtrack.fr')}
              accessibilityRole="link"
            >
              support@buildtrack.fr
            </Text>.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  lockedTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginTop: 16, textAlign: 'center' },
  emptyHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 6, textAlign: 'center', paddingHorizontal: 32 },
  backPill: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 },
  backPillTxt: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  header: {
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },

  content: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },

  statusBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: 12, padding: 14, borderWidth: 1,
  },
  statusLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  statusSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  actionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  actionCardTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#1D4ED8', marginBottom: 3 },
  actionCardSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#3B82F6', lineHeight: 18 },

  orgCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, gap: 8,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  orgCardTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  orgRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orgLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  orgValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  slugRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  planCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderTopWidth: 4, borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  planTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  planBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  planBadgeTxt: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  planPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },

  sectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  featureTxt: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, flex: 1 },

  seatCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  seatTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  seatLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seatTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  seatSubtitle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  seatCount: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  seatMaxTxt: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted },
  barBg: { height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  seatWarning: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#EF4444', marginTop: 6 },
  freeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#10B98112', borderRadius: 8, padding: 10, marginTop: 10,
  },
  freeBannerTxt: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#10B981', flex: 1 },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text, marginTop: 4 },
  sectionCount: { fontFamily: 'Inter_400Regular', color: C.textMuted },

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

  empty: { alignItems: 'center', paddingVertical: 30, gap: 8 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.textSub },

  hintCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  hintText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, flex: 1, lineHeight: 18 },
});
