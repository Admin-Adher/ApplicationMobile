import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { C } from '@/constants/colors';
import { useSubscription } from '@/context/SubscriptionContext';
import { useAuth } from '@/context/AuthContext';
import { SubscriptionStatus } from '@/constants/types';

const STATUS_CONFIG: Record<SubscriptionStatus, { label: string; color: string; bg: string }> = {
  trial:     { label: 'Essai',     color: '#F59E0B', bg: '#FFFBEB' },
  active:    { label: 'Actif',     color: '#10B981', bg: '#ECFDF5' },
  suspended: { label: 'Suspendu',  color: '#EF4444', bg: '#FEF2F2' },
  expired:   { label: 'Expiré',    color: '#6B7280', bg: '#F3F4F6' },
};

const PLANS_DEMO = [
  {
    name: 'Starter',
    color: '#6B7280',
    maxUsers: 5,
    priceMonthly: 49,
    features: ["Réserves", "5 utilisateurs", "Support email"],
  },
  {
    name: 'Pro',
    color: '#3B82F6',
    maxUsers: 20,
    priceMonthly: 149,
    features: ["Réserves + Rapports", "20 utilisateurs", "Support prioritaire", "Pointage"],
  },
  {
    name: 'Entreprise',
    color: '#8B5CF6',
    maxUsers: -1,
    priceMonthly: 399,
    features: ["Tout inclus", "Illimité", "Support dédié", "API + SSO"],
  },
];

export default function SuperAdminScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const router = useRouter();
  const { user } = useAuth();
  const { allOrganizations, isLoading } = useSubscription();
  const [activeTab, setActiveTab] = useState<'orgs' | 'plans'>('orgs');

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
        <View style={styles.superBadge}>
          <Ionicons name="shield" size={13} color="#8B5CF6" />
          <Text style={styles.superBadgeTxt}>BuildTrack</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'orgs' && styles.tabBtnActive]}
          onPress={() => setActiveTab('orgs')}
        >
          <Ionicons name="business-outline" size={14} color={activeTab === 'orgs' ? C.primary : C.textMuted} />
          <Text style={[styles.tabBtnTxt, activeTab === 'orgs' && styles.tabBtnTxtActive]}>Organisations</Text>
          <View style={[styles.tabCount, activeTab === 'orgs' && styles.tabCountActive]}>
            <Text style={[styles.tabCountTxt, activeTab === 'orgs' && styles.tabCountTxtActive]}>{allOrganizations.length}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'plans' && styles.tabBtnActive]}
          onPress={() => setActiveTab('plans')}
        >
          <Ionicons name="pricetag-outline" size={14} color={activeTab === 'plans' ? C.primary : C.textMuted} />
          <Text style={[styles.tabBtnTxt, activeTab === 'plans' && styles.tabBtnTxtActive]}>Formules</Text>
          <View style={[styles.tabCount, activeTab === 'plans' && styles.tabCountActive]}>
            <Text style={[styles.tabCountTxt, activeTab === 'plans' && styles.tabCountTxtActive]}>3</Text>
          </View>
        </TouchableOpacity>
      </View>

      {activeTab === 'orgs' ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? (
            <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 40 }} />
          ) : allOrganizations.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="business-outline" size={40} color={C.textMuted} />
              <Text style={styles.emptyTxt}>Aucune organisation</Text>
              <Text style={styles.emptyHint}>Les organisations apparaissent ici lorsque des clients s'inscrivent.</Text>
            </View>
          ) : (
            allOrganizations.map((org, i) => {
              const colors = ['#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444'];
              const col = colors[i % colors.length];
              const initials = org.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
              const statusCfg = STATUS_CONFIG['trial'];
              return (
                <View key={org.id} style={styles.orgCard}>
                  <View style={[styles.orgAccent, { backgroundColor: col }]} />
                  <View style={styles.orgBody}>
                    <View style={styles.orgTopRow}>
                      <View style={[styles.orgAvatar, { backgroundColor: col + '22' }]}>
                        <Text style={[styles.orgAvatarTxt, { color: col }]}>{initials}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.orgName}>{org.name}</Text>
                        <Text style={styles.orgSlug}>{org.slug}</Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
                        <Text style={[styles.statusBadgeTxt, { color: statusCfg.color }]}>{statusCfg.label}</Text>
                      </View>
                    </View>
                    <View style={styles.orgMeta}>
                      <View style={styles.orgMetaItem}>
                        <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
                        <Text style={styles.orgMetaTxt}>
                          {new Date(org.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </Text>
                      </View>
                      <View style={styles.orgMetaItem}>
                        <Ionicons name="pricetag-outline" size={12} color={C.textMuted} />
                        <Text style={styles.orgMetaTxt}>Pro</Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })
          )}

          <View style={styles.statsRow}>
            {[
              { label: 'Organisations', value: allOrganizations.length, icon: 'business-outline', color: C.primary },
              { label: 'En essai',       value: allOrganizations.length, icon: 'time-outline',     color: '#F59E0B' },
              { label: 'Actifs',         value: 0,                       icon: 'checkmark-circle-outline', color: '#10B981' },
            ].map((s, i) => (
              <View key={i} style={styles.statCard}>
                <Ionicons name={s.icon as any} size={20} color={s.color} />
                <Text style={[styles.statVal, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.statLbl}>{s.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {PLANS_DEMO.map(plan => (
            <View key={plan.name} style={[styles.planCard, { borderTopColor: plan.color }]}>
              <View style={styles.planTopRow}>
                <View style={[styles.planBadge, { backgroundColor: plan.color + '18' }]}>
                  <Text style={[styles.planBadgeTxt, { color: plan.color }]}>{plan.name}</Text>
                </View>
                <Text style={styles.planPrice}>{plan.priceMonthly} € / mois</Text>
              </View>
              <View style={styles.planLimitRow}>
                <Ionicons name="people-outline" size={14} color={C.textMuted} />
                <Text style={styles.planLimit}>
                  {plan.maxUsers === -1 ? 'Utilisateurs illimités' : `${plan.maxUsers} utilisateurs max`}
                </Text>
              </View>
              {plan.features.map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <Ionicons name="checkmark-circle" size={14} color={plan.color} />
                  <Text style={styles.featureTxt}>{f}</Text>
                </View>
              ))}
            </View>
          ))}

          <View style={styles.hintCard}>
            <Ionicons name="information-circle-outline" size={15} color={C.textMuted} />
            <Text style={styles.hintTxt}>
              L'intégration paiement (Stripe) sera disponible dans une prochaine mise à jour. Pour l'instant, les formules sont attribuées manuellement.
            </Text>
          </View>
        </ScrollView>
      )}
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
  superBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F3E8FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#C084FC55',
  },
  superBadgeTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#8B5CF6' },

  tabRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, borderRadius: 10, backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.border,
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
  orgBody: { flex: 1, padding: 14 },
  orgTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  orgAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  orgAvatarTxt: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  orgName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text },
  orgSlug: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  orgMeta: { flexDirection: 'row', gap: 16 },
  orgMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  orgMetaTxt: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },

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

  planCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderTopWidth: 4, borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  planTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  planBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  planBadgeTxt: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  planPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  planLimitRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  planLimit: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textMuted },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  featureTxt: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },

  hintCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  hintTxt: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, flex: 1, lineHeight: 18 },
});
