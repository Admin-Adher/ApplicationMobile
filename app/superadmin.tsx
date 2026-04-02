import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { C } from '@/constants/colors';
import { useSubscription, OrgSummary } from '@/context/SubscriptionContext';
import { useAuth } from '@/context/AuthContext';

const STATUS_CONFIG = {
  trial:     { label: 'Essai',     color: '#F59E0B', bg: '#FFFBEB' },
  active:    { label: 'Actif',     color: '#10B981', bg: '#ECFDF5' },
  suspended: { label: 'Suspendu',  color: '#EF4444', bg: '#FEF2F2' },
  expired:   { label: 'Expiré',    color: '#6B7280', bg: '#F3F4F6' },
} as const;

const PLAN_COLORS: Record<string, string> = {
  Starter:    '#6B7280',
  Pro:        '#3B82F6',
  Entreprise: '#8B5CF6',
};

const ORG_COLORS = ['#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#06B6D4','#EC4899'];

export default function SuperAdminScreen() {
  const insets = useSafeAreaInsets();
  const topPad = insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const router = useRouter();

  const { user } = useAuth();
  const { orgSummaries, allPlans, isLoading, updateOrgPlan, updateOrgStatus } = useSubscription();

  const [activeTab, setActiveTab] = useState<'orgs' | 'plans'>('orgs');
  const [planModal, setPlanModal] = useState<OrgSummary | null>(null);
  const [statusModal, setStatusModal] = useState<OrgSummary | null>(null);
  const [saving, setSaving] = useState(false);

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

  async function handleChangePlan(planId: string) {
    if (!planModal) return;
    setSaving(true);
    const result = await updateOrgPlan(planModal.org.id, planId);
    setSaving(false);
    if (result.success) {
      setPlanModal(null);
    } else {
      Alert.alert('Erreur', result.error ?? 'Impossible de modifier le plan.');
    }
  }

  async function handleChangeStatus(status: 'trial' | 'active' | 'suspended' | 'expired') {
    if (!statusModal) return;
    setSaving(true);
    const result = await updateOrgStatus(statusModal.org.id, status);
    setSaving(false);
    if (result.success) {
      setStatusModal(null);
    } else {
      Alert.alert('Erreur', result.error ?? 'Impossible de modifier le statut.');
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
        <View style={styles.superBadge}>
          <Ionicons name="shield" size={13} color="#8B5CF6" />
          <Text style={styles.superBadgeTxt}>BuildTrack</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        {(['orgs', 'plans'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Ionicons
              name={tab === 'orgs' ? 'business-outline' : 'pricetag-outline'}
              size={14}
              color={activeTab === tab ? C.primary : C.textMuted}
            />
            <Text style={[styles.tabBtnTxt, activeTab === tab && styles.tabBtnTxtActive]}>
              {tab === 'orgs' ? 'Organisations' : 'Formules'}
            </Text>
            <View style={[styles.tabCount, activeTab === tab && styles.tabCountActive]}>
              <Text style={[styles.tabCountTxt, activeTab === tab && styles.tabCountTxtActive]}>
                {tab === 'orgs' ? totalOrgs : allPlans.length}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

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
              const { org, planName, status, seatMax } = summary;
              const col = ORG_COLORS[i % ORG_COLORS.length];
              const initials = org.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
              const statusCfg = STATUS_CONFIG[status];
              const planColor = PLAN_COLORS[planName] ?? C.primary;
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
                      <TouchableOpacity
                        style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}
                        onPress={() => setStatusModal(summary)}
                      >
                        <Text style={[styles.statusBadgeTxt, { color: statusCfg.color }]}>{statusCfg.label}</Text>
                        <Ionicons name="chevron-down" size={10} color={statusCfg.color} />
                      </TouchableOpacity>
                    </View>

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
                          {seatMax === -1 ? 'Illimité' : `${seatMax} sièges`}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.orgFooter}>
                      <View style={[styles.planTag, { backgroundColor: planColor + '18' }]}>
                        <Ionicons name="pricetag" size={11} color={planColor} />
                        <Text style={[styles.planTagTxt, { color: planColor }]}>{planName}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.changePlanBtn}
                        onPress={() => setPlanModal(summary)}
                      >
                        <Ionicons name="swap-horizontal-outline" size={13} color={C.primary} />
                        <Text style={styles.changePlanTxt}>Changer</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {activeTab === 'plans' && (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {allPlans.map(plan => {
            const pc = PLAN_COLORS[plan.name] ?? C.primary;
            return (
              <View key={plan.id} style={[styles.planCard, { borderTopColor: pc }]}>
                <View style={styles.planTopRow}>
                  <View style={[styles.planBadge, { backgroundColor: pc + '18' }]}>
                    <Text style={[styles.planBadgeTxt, { color: pc }]}>{plan.name}</Text>
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
                    <Ionicons name="checkmark-circle" size={14} color={pc} />
                    <Text style={styles.featureTxt}>{f}</Text>
                  </View>
                ))}
                <View style={styles.planOrgCount}>
                  <Text style={styles.planOrgCountTxt}>
                    {orgSummaries.filter(s => s.planName === plan.name).length} organisation(s) sur ce plan
                  </Text>
                </View>
              </View>
            );
          })}

          <View style={styles.hintCard}>
            <Ionicons name="information-circle-outline" size={15} color={C.textMuted} />
            <Text style={styles.hintTxt}>
              L'intégration paiement (Stripe) sera disponible dans une prochaine mise à jour. Les formules sont attribuées manuellement depuis l'onglet Organisations.
            </Text>
          </View>
        </ScrollView>
      )}

      <Modal visible={!!planModal} transparent animationType="slide" onRequestClose={() => setPlanModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Changer la formule</Text>
              <Text style={styles.modalSub}>{planModal?.org.name}</Text>
              <TouchableOpacity onPress={() => setPlanModal(null)} style={styles.modalClose}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            {allPlans.map(plan => {
              const pc = PLAN_COLORS[plan.name] ?? C.primary;
              const isCurrent = planModal?.planName === plan.name;
              return (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.planOption, isCurrent && styles.planOptionActive, { borderColor: isCurrent ? pc : C.border }]}
                  onPress={() => !saving && handleChangePlan(plan.id)}
                  disabled={saving || isCurrent}
                >
                  <View style={[styles.planOptionBadge, { backgroundColor: pc + '18' }]}>
                    <Text style={[styles.planOptionBadgeTxt, { color: pc }]}>{plan.name}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planOptionDetail}>
                      {plan.maxUsers === -1 ? 'Illimité' : `${plan.maxUsers} utilisateurs`} · {plan.priceMonthly} €/mois
                    </Text>
                  </View>
                  {isCurrent && <Ionicons name="checkmark-circle" size={18} color={pc} />}
                  {!isCurrent && saving && <ActivityIndicator size="small" color={C.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      <Modal visible={!!statusModal} transparent animationType="slide" onRequestClose={() => setStatusModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Changer le statut</Text>
              <Text style={styles.modalSub}>{statusModal?.org.name}</Text>
              <TouchableOpacity onPress={() => setStatusModal(null)} style={styles.modalClose}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            {(Object.entries(STATUS_CONFIG) as [keyof typeof STATUS_CONFIG, typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG]][]).map(([key, cfg]) => {
              const isCurrent = statusModal?.status === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.planOption, isCurrent && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                  onPress={() => !saving && handleChangeStatus(key)}
                  disabled={saving || isCurrent}
                >
                  <View style={[styles.statusDot, { backgroundColor: cfg.color }]} />
                  <Text style={[styles.planOptionDetail, { flex: 1, color: isCurrent ? cfg.color : C.text }]}>
                    {cfg.label}
                  </Text>
                  {isCurrent && <Ionicons name="checkmark-circle" size={18} color={cfg.color} />}
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
  planTag: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  planTagTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  changePlanBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  changePlanTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

  planCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderTopWidth: 4, borderWidth: 1, borderColor: C.border, gap: 6,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  planTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  planBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  planBadgeTxt: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  planPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  planLimitRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  planLimit: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textMuted },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureTxt: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  planOrgCount: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  planOrgCountTxt: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },

  hintCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border,
  },
  hintTxt: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, flex: 1, lineHeight: 18 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, gap: 10,
    ...Platform.select({
      web: { boxShadow: '0 -4px 20px rgba(0,0,0,0.12)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 20 },
    }),
  },
  modalHeader: { marginBottom: 6 },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  modalSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  modalClose: { position: 'absolute', right: 0, top: 0, padding: 4 },

  planOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg,
  },
  planOptionActive: { backgroundColor: C.primaryBg },
  planOptionBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  planOptionBadgeTxt: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  planOptionDetail: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
});
