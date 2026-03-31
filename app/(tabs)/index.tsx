import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { openChantierSwitcher } from '@/components/ChantierSwitcherSheet';
import { useState, useCallback } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useIncidents } from '@/context/IncidentsContext';
import { useNotifications } from '@/context/NotificationsContext';
import { parseDeadline, isOverdue } from '@/lib/reserveUtils';
import { Task } from '@/constants/types';

function isTaskLate(t: Task): boolean {
  if (t.status === 'done') return false;
  if (t.status === 'delayed') return true;
  const d = parseDeadline(t.deadline);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function KPICard({
  label, value, color, icon, bg, onPress,
}: {
  label: string; value: string | number; color: string; icon: string; bg: string; onPress?: () => void;
}) {
  const card = (
    <View style={[styles.kpiCard, { borderLeftColor: color }]}>
      <View style={styles.kpiCardTop}>
        <View style={[styles.kpiIconWrap, { backgroundColor: bg }]}>
          <Ionicons name={icon as any} size={18} color={color} />
        </View>
        {onPress && <Ionicons name="chevron-forward" size={13} color={C.textMuted} />}
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.kpiTouchable}>
        {card}
      </TouchableOpacity>
    );
  }
  return <View style={styles.kpiTouchable}>{card}</View>;
}

function ReserveStatusBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={styles.statusLabel}>{label}</Text>
      <View style={styles.statusBarWrap}>
        <View style={[styles.statusBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[styles.statusCount, { color }]}>{count}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { stats, reserves, companies, tasks, reload, chantiers, activeChantier } = useApp();
  const { user } = useAuth();
  const { projectName } = useSettings();
  const { incidents } = useIncidents();
  const { unreadCount } = useNotifications();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [refreshing, setRefreshing] = useState(false);

  const PRIORITY_LABELS: Record<string, string> = {
    low: 'Basse', medium: 'Moyenne', high: 'Haute', critical: 'Critique',
  };

  const criticalReserves = reserves.filter(r => r.priority === 'critical' && r.status !== 'closed');
  const overdueNonCritical = reserves.filter(
    r => r.status !== 'closed' && r.priority !== 'critical' && isOverdue(r.deadline, r.status)
  );
  const lateTasks = tasks.filter(isTaskLate);
  const openIncidents = incidents.filter(i => i.status !== 'resolved');

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const firstName = user?.name?.split(' ')[0] ?? null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerLeft}>
          <View style={styles.logoMini}>
            <Text style={styles.logoMiniLetter}>B</Text>
          </View>
          <View>
            <Text style={styles.brand}>{firstName ? `Bonjour, ${firstName}` : 'BuildTrack'}</Text>
            <Text style={styles.date}>{today}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => router.push('/notifications' as any)}
          >
            <Ionicons name="notifications-outline" size={20} color={C.text} />
            {unreadCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>
                  {unreadCount > 9 ? '9+' : String(unreadCount)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          {activeChantier ? (
            <TouchableOpacity
              style={styles.chantierPill}
              onPress={openChantierSwitcher}
            >
              <View style={styles.chantierPillDot} />
              <Text style={styles.chantierPillText} numberOfLines={1}>{activeChantier.name}</Text>
              <Ionicons name="chevron-down" size={11} color={C.primary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.chantierPillEmpty}
              onPress={() => router.push('/chantier/new' as any)}
            >
              <Ionicons name="add" size={13} color={C.textMuted} />
              <Text style={styles.chantierPillEmptyText}>Chantier</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
      >
        {/* KPI 2×2 grid */}
        <View style={styles.kpiGrid}>
          <KPICard
            label="Total réserves"
            value={stats.total}
            color={C.primary}
            icon="list"
            bg={C.primaryBg}
            onPress={() => router.push('/(tabs)/reserves' as any)}
          />
          <KPICard
            label="Actives"
            value={stats.open + stats.inProgress}
            color={C.open}
            icon="alert-circle"
            bg={C.openBg}
            onPress={() => router.push('/(tabs)/reserves' as any)}
          />
          <KPICard
            label="Critiques"
            value={criticalReserves.length}
            color={C.critical}
            icon="warning"
            bg={C.criticalBg}
            onPress={() => router.push('/(tabs)/reserves' as any)}
          />
          <KPICard
            label="Clôturées"
            value={stats.closed}
            color={C.closed}
            icon="checkmark-circle"
            bg={C.closedBg}
            onPress={() => router.push('/(tabs)/reserves' as any)}
          />
        </View>

        {/* 5th KPI — wide card for late tasks */}
        <TouchableOpacity
          style={[styles.kpiWide, { borderLeftColor: lateTasks.length > 0 ? C.waiting : C.closed }]}
          onPress={() => router.push('/planning' as any)}
          activeOpacity={0.75}
        >
          <View style={[styles.kpiIconWrap, { backgroundColor: lateTasks.length > 0 ? C.waiting + '20' : C.closedBg }]}>
            <Ionicons
              name="time-outline"
              size={18}
              color={lateTasks.length > 0 ? C.waiting : C.closed}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.kpiValue, { fontSize: 24, color: lateTasks.length > 0 ? C.waiting : C.closed }]}>
              {lateTasks.length}
            </Text>
            <Text style={styles.kpiLabel}>
              {lateTasks.length === 0 ? 'Aucune tâche en retard' : `Tâche${lateTasks.length > 1 ? 's' : ''} en retard`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
        </TouchableOpacity>

        {/* 6th KPI — wide card for open incidents */}
        <TouchableOpacity
          style={[styles.kpiWide, { borderLeftColor: openIncidents.length > 0 ? '#EF4444' : C.closed }]}
          onPress={() => router.push('/incidents' as any)}
          activeOpacity={0.75}
        >
          <View style={[styles.kpiIconWrap, { backgroundColor: openIncidents.length > 0 ? '#EF444420' : C.closedBg }]}>
            <Ionicons
              name="shield-outline"
              size={18}
              color={openIncidents.length > 0 ? '#EF4444' : C.closed}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.kpiValue, { fontSize: 24, color: openIncidents.length > 0 ? '#EF4444' : C.closed }]}>
              {openIncidents.length}
            </Text>
            <Text style={styles.kpiLabel}>
              {openIncidents.length === 0 ? 'Aucun incident ouvert' : `Incident${openIncidents.length > 1 ? 's' : ''} non résolu${openIncidents.length > 1 ? 's' : ''}`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
        </TouchableOpacity>

        {/* Onboarding — Aucun chantier créé */}
        {chantiers.length === 0 && (
          <View style={[styles.onboardCard, { borderColor: C.primary + '40', borderWidth: 1.5 }]}>
            <View style={styles.onboardIconWrap}>
              <Ionicons name="business-outline" size={32} color={C.primary} />
            </View>
            <Text style={styles.onboardTitle}>Créez votre premier chantier</Text>
            <Text style={styles.onboardText}>
              BuildTrack organise vos réserves par chantier. Commencez par créer un chantier et importer vos plans de masse.
            </Text>
            <View style={styles.onboardActions}>
              <TouchableOpacity
                style={styles.onboardBtn}
                onPress={() => router.push('/chantier/new' as any)}
              >
                <Ionicons name="add-circle-outline" size={16} color="#fff" />
                <Text style={styles.onboardBtnText}>Nouveau chantier</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* État vide — chantier initialisé, aucune réserve */}
        {chantiers.length > 0 && stats.total === 0 && companies.length === 0 && (
          <View style={styles.onboardCard}>
            <View style={styles.onboardIconWrap}>
              <Ionicons name="construct" size={32} color={C.primary} />
            </View>
            <Text style={styles.onboardTitle}>Bienvenue sur BuildTrack</Text>
            <Text style={styles.onboardText}>
              Votre chantier numérique est prêt. Commencez par créer votre première réserve ou configurer les entreprises intervenantes.
            </Text>
            <View style={styles.onboardActions}>
              <TouchableOpacity
                style={styles.onboardBtn}
                onPress={() => router.push('/reserve/new' as any)}
              >
                <Ionicons name="add-circle-outline" size={16} color="#fff" />
                <Text style={styles.onboardBtnText}>Créer une réserve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.onboardBtnSecondary}
                onPress={() => router.push('/(tabs)/equipes' as any)}
              >
                <Ionicons name="people-outline" size={16} color={C.primary} />
                <Text style={styles.onboardBtnSecondaryText}>Configurer les équipes</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Avancement global */}
        {stats.total > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Avancement global</Text>
              <View style={styles.pctBadge}>
                <Text style={styles.pct}>{stats.progress}%</Text>
              </View>
            </View>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${stats.progress}%` as any }]} />
            </View>
            <Text style={styles.progressHint}>{stats.closed} / {stats.total} réserves clôturées</Text>
          </View>
        )}

        {/* Répartition des statuts */}
        {stats.total > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Répartition des réserves</Text>
            <View style={styles.statusBars}>
              <ReserveStatusBar label="Ouvert" count={stats.open} total={stats.total} color={C.open} />
              <ReserveStatusBar label="En cours" count={stats.inProgress} total={stats.total} color={C.inProgress} />
              <ReserveStatusBar label="En attente" count={stats.waiting} total={stats.total} color={C.waiting} />
              <ReserveStatusBar label="Vérification" count={stats.verification} total={stats.total} color={C.verification} />
              <ReserveStatusBar label="Clôturé" count={stats.closed} total={stats.total} color={C.closed} />
            </View>
          </View>
        )}

        {/* Personnel */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Personnel aujourd'hui</Text>
            <Text style={styles.cardSub}>{stats.totalWorkers} / {stats.plannedWorkers} personnes</Text>
          </View>
          {companies.map(co => {
            const pct = co.plannedWorkers > 0 ? (co.actualWorkers / co.plannedWorkers) * 100 : 0;
            const isOver = co.actualWorkers > co.plannedWorkers;
            const isUnder = co.plannedWorkers > 0 && co.actualWorkers < co.plannedWorkers * 0.7;
            const barColor = isOver ? C.waiting : isUnder ? C.open : co.color;
            return (
              <View key={co.id} style={styles.coRow}>
                <View style={[styles.coDot, { backgroundColor: co.color }]} />
                <Text style={styles.coName}>{co.shortName}</Text>
                <View style={styles.coBarWrap}>
                  <View style={[styles.coBarFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: barColor }]} />
                </View>
                <Text style={[styles.coCount, { color: isOver ? C.waiting : isUnder ? C.open : co.color }]}>
                  {co.actualWorkers}/{co.plannedWorkers}{isOver ? ' ↑' : isUnder ? ' ↓' : ''}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Alertes critiques */}
        {criticalReserves.length > 0 && (
          <View style={styles.alertCard}>
            <View style={styles.alertHeader}>
              <View style={styles.alertIconWrap}>
                <Ionicons name="warning" size={16} color={C.critical} />
              </View>
              <Text style={styles.alertTitle}>Alertes critiques</Text>
              <View style={styles.alertCount}>
                <Text style={styles.alertCountText}>{criticalReserves.length}</Text>
              </View>
            </View>
            {criticalReserves.map(r => (
              <TouchableOpacity
                key={r.id}
                style={styles.alertItem}
                onPress={() => router.push(`/reserve/${r.id}` as any)}
              >
                <View style={styles.alertDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertText}>{r.title}</Text>
                  <Text style={styles.alertSub}>Bât. {r.building} — Échéance : {r.deadline}</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={C.critical} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Réserves en retard (non critiques) */}
        {overdueNonCritical.length > 0 && (
          <View style={styles.overdueCard}>
            <View style={styles.alertHeader}>
              <View style={styles.overdueIconWrap}>
                <Ionicons name="calendar-outline" size={16} color={C.high} />
              </View>
              <Text style={styles.overdueTitle}>Réserves en retard</Text>
              <View style={styles.overdueCount}>
                <Text style={styles.overdueCountText}>{overdueNonCritical.length}</Text>
              </View>
            </View>
            {overdueNonCritical.map(r => (
              <TouchableOpacity
                key={r.id}
                style={styles.overdueItem}
                onPress={() => router.push(`/reserve/${r.id}` as any)}
              >
                <View style={[styles.alertDot, { backgroundColor: C.high }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertText}>{r.title}</Text>
                  <Text style={styles.alertSub}>Bât. {r.building} — {PRIORITY_LABELS[r.priority] ?? r.priority} — Échéance : {r.deadline}</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={C.high} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Tâches en retard */}
        {lateTasks.length > 0 && (
          <View style={styles.delayCard}>
            <View style={styles.alertHeader}>
              <View style={styles.delayIconWrap}>
                <Ionicons name="time-outline" size={16} color={C.waiting} />
              </View>
              <Text style={styles.delayTitle}>Tâches en retard</Text>
              <View style={styles.delayCount}>
                <Text style={styles.delayCountText}>{lateTasks.length}</Text>
              </View>
            </View>
            {lateTasks.map(t => (
              <TouchableOpacity
                key={t.id}
                style={styles.delayItem}
                onPress={() => router.push('/planning' as any)}
              >
                <View style={styles.delayDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertText}>{t.title}</Text>
                  <Text style={styles.alertSub}>
                    {t.status === 'delayed' ? 'Marquée en retard' : 'Deadline dépassée'} — {t.deadline}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={C.waiting} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bellBtn: {
    width: 36, height: 36,
    borderRadius: 10,
    backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute',
    top: -3, right: -3,
    minWidth: 16, height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bellBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  logoMini: {
    width: 34, height: 34,
    backgroundColor: C.primary,
    borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  logoMiniLetter: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.accent },
  brand: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  date: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 1 },
  roleBadge: {
    backgroundColor: C.surface2,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
  },
  roleText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  projectBadge: { backgroundColor: C.primary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16 },
  projectText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  chantierPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: C.primary + '40', maxWidth: 160,
  },
  chantierPillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.primary },
  chantierPillText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary, flex: 1 },
  chantierPillEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.surface2, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
  },
  chantierPillEmptyText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textMuted },

  content: { padding: 14, paddingBottom: 36 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  kpiTouchable: { flex: 1, minWidth: '44%' },
  kpiCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  kpiCard: {
    backgroundColor: C.surface,
    borderRadius: 14, padding: 14, borderLeftWidth: 4,
    borderWidth: 1, borderColor: C.border, elevation: 1,
    ...Platform.select({
      web: { boxShadow: '0px 1px 6px rgba(0,48,130,0.06)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6 },
    }),
  },
  kpiIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 2 },
  kpiLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },

  kpiWide: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderLeftWidth: 4, borderWidth: 1, borderColor: C.border,
    marginBottom: 10, elevation: 1,
    ...Platform.select({
      web: { boxShadow: '0px 1px 6px rgba(0,48,130,0.06)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6 },
    }),
  },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: C.border, elevation: 1,
    ...Platform.select({
      web: { boxShadow: '0px 1px 6px rgba(0,48,130,0.05)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6 },
    }),
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text },
  cardSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  pctBadge: { backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  pct: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.primary },
  progressBg: { height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  progressHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },

  statusBars: { gap: 12, marginTop: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, width: 82 },
  statusBarWrap: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  statusBarFill: { height: '100%', borderRadius: 3 },
  statusCount: { fontSize: 12, fontFamily: 'Inter_700Bold', width: 22, textAlign: 'right' },

  coRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  coDot: { width: 8, height: 8, borderRadius: 4 },
  coName: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, width: 64 },
  coBarWrap: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  coBarFill: { height: '100%', borderRadius: 3 },
  coCount: { fontSize: 12, fontFamily: 'Inter_700Bold', width: 52, textAlign: 'right' },

  alertCard: {
    backgroundColor: C.openBg, borderRadius: 14, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: 'rgba(220,38,38,0.2)',
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  alertIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(220,38,38,0.12)', alignItems: 'center', justifyContent: 'center' },
  alertTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.critical, flex: 1 },
  alertCount: { backgroundColor: C.critical, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  alertCountText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  alertItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(220,38,38,0.12)' },
  alertDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.critical },
  alertText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  alertSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },

  overdueCard: {
    backgroundColor: C.highBg, borderRadius: 14, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: 'rgba(234,88,12,0.2)',
  },
  overdueIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(234,88,12,0.12)', alignItems: 'center', justifyContent: 'center' },
  overdueTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.high, flex: 1 },
  overdueCount: { backgroundColor: C.high, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  overdueCountText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  overdueItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(234,88,12,0.12)' },

  delayCard: {
    backgroundColor: C.waitingBg, borderRadius: 14, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: 'rgba(217,119,6,0.25)',
  },
  delayIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(217,119,6,0.14)', alignItems: 'center', justifyContent: 'center' },
  delayTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.waiting, flex: 1 },
  delayCount: { backgroundColor: C.waiting, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  delayCountText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  delayItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(217,119,6,0.15)' },
  delayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.waiting },

  onboardCard: {
    backgroundColor: C.surface, borderRadius: 16, padding: 20,
    marginBottom: 10, borderWidth: 1, borderColor: C.border,
    alignItems: 'center',
    ...Platform.select({
      web: { boxShadow: '0px 2px 12px rgba(0,48,130,0.08)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12 },
    }),
  },
  onboardIconWrap: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  onboardTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 8, textAlign: 'center' },
  onboardText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  onboardActions: { flexDirection: 'row', gap: 10, width: '100%' },
  onboardBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12,
  },
  onboardBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  onboardBtnSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.primaryBg, borderRadius: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: C.primary + '40',
  },
  onboardBtnSecondaryText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
});
