import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';

function KPICard({ label, value, color, icon, bg }: { label: string; value: string | number; color: string; icon: string; bg: string }) {
  return (
    <View style={[styles.kpiCard, { borderLeftColor: color, backgroundColor: C.surface }]}>
      <View style={[styles.kpiIconWrap, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={[styles.kpiValue, { color: C.text }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function StatusBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
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
  const { stats, reserves, companies, tasks } = useApp();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const criticalReserves = reserves.filter(r => r.priority === 'critical' && r.status !== 'closed');
  const delayedTasks = tasks.filter(t => t.status === 'delayed');
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerLeft}>
          <View style={styles.logoMini}>
            <Text style={styles.logoMiniLetter}>B</Text>
          </View>
          <View>
            <Text style={styles.brand}>BuildTrack</Text>
            <Text style={styles.date}>{today}</Text>
          </View>
        </View>
        <View style={styles.projectBadge}>
          <Text style={styles.projectText}>Projet Horizon</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.kpiGrid}>
          <KPICard label="Total réserves" value={stats.total} color={C.primary} icon="list" bg={C.primaryBg} />
          <KPICard label="Ouvertes" value={stats.open + stats.inProgress} color={C.open} icon="alert-circle" bg={C.openBg} />
          <KPICard label="Critiques" value={criticalReserves.length} color={C.critical} icon="warning" bg={C.criticalBg} />
          <KPICard label="Clôturées" value={stats.closed} color={C.closed} icon="checkmark-circle" bg={C.closedBg} />
          <KPICard label="Tâches retard" value={delayedTasks.length} color={C.waiting} icon="time-outline" bg={C.waiting + '18'} />
        </View>

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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Répartition des réserves</Text>
          <View style={styles.statusBars}>
            <StatusBar label="Ouvert" count={stats.open} total={stats.total} color={C.open} />
            <StatusBar label="En cours" count={stats.inProgress} total={stats.total} color={C.inProgress} />
            <StatusBar label="En attente" count={stats.waiting} total={stats.total} color={C.waiting} />
            <StatusBar label="Vérification" count={stats.verification} total={stats.total} color={C.verification} />
            <StatusBar label="Clôturé" count={stats.closed} total={stats.total} color={C.closed} />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Personnel aujourd'hui</Text>
            <Text style={styles.cardSub}>{stats.totalWorkers} / {stats.plannedWorkers} personnes</Text>
          </View>
          {companies.map(co => {
            const pct = co.plannedWorkers > 0 ? (co.actualWorkers / co.plannedWorkers) * 100 : 0;
            return (
              <View key={co.id} style={styles.coRow}>
                <View style={[styles.coDot, { backgroundColor: co.color }]} />
                <Text style={styles.coName}>{co.shortName}</Text>
                <View style={styles.coBarWrap}>
                  <View style={[styles.coBarFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: co.color }]} />
                </View>
                <Text style={[styles.coCount, { color: co.color }]}>{co.actualWorkers}/{co.plannedWorkers}</Text>
              </View>
            );
          })}
        </View>

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

        {delayedTasks.length > 0 && (
          <View style={styles.delayCard}>
            <View style={styles.alertHeader}>
              <View style={styles.delayIconWrap}>
                <Ionicons name="time-outline" size={16} color={C.waiting} />
              </View>
              <Text style={styles.delayTitle}>Tâches en retard</Text>
              <View style={styles.delayCount}>
                <Text style={styles.delayCountText}>{delayedTasks.length}</Text>
              </View>
            </View>
            {delayedTasks.map(t => (
              <TouchableOpacity
                key={t.id}
                style={styles.delayItem}
                onPress={() => router.push('/planning' as any)}
              >
                <View style={styles.delayDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertText}>{t.title}</Text>
                  <Text style={styles.alertSub}>{t.assignee} — Échéance : {t.deadline}</Text>
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
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMini: {
    width: 34,
    height: 34,
    backgroundColor: C.primary,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMiniLetter: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.accent },
  brand: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  date: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 1 },
  projectBadge: {
    backgroundColor: C.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  projectText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  content: { padding: 16, paddingBottom: 32 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  kpiCard: {
    flex: 1, minWidth: '44%', backgroundColor: C.surface,
    borderRadius: 14, padding: 14, borderLeftWidth: 4,
    borderWidth: 1, borderColor: C.border,
    elevation: 1,
    ...Platform.select({
      web: { boxShadow: '0px 1px 6px rgba(0,48,130,0.06)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6 },
    }),
  },
  kpiIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  kpiValue: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  kpiLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: C.border,
    elevation: 1,
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
  coCount: { fontSize: 12, fontFamily: 'Inter_700Bold', width: 44, textAlign: 'right' },
  alertCard: {
    backgroundColor: C.openBg,
    borderRadius: 14, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: 'rgba(220,38,38,0.2)',
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
  delayCard: {
    backgroundColor: C.waitingBg,
    borderRadius: 14, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: 'rgba(217,119,6,0.25)',
  },
  delayIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(217,119,6,0.14)', alignItems: 'center', justifyContent: 'center' },
  delayTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.waiting, flex: 1 },
  delayCount: { backgroundColor: C.waiting, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  delayCountText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  delayItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(217,119,6,0.15)' },
  delayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.waiting },
});
