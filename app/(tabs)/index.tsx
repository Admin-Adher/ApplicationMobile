import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';

function KPICard({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: string }) {
  return (
    <View style={[styles.kpiCard, { borderTopColor: color }]}>
      <Ionicons name={icon as any} size={20} color={color} />
      <Text style={[styles.kpiValue, { color }]}>{value}</Text>
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
  const { stats, reserves, companies } = useApp();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const criticalReserves = reserves.filter(r => r.priority === 'critical' && r.status !== 'closed');
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <View style={[styles.container]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View>
          <Text style={styles.brand}>BuildTrack</Text>
          <Text style={styles.date}>{today}</Text>
        </View>
        <View style={styles.projectBadge}>
          <Text style={styles.projectText}>Projet Horizon</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.kpiGrid}>
          <KPICard label="Total réserves" value={stats.total} color={C.textSub} icon="list" />
          <KPICard label="Ouvertes" value={stats.open + stats.inProgress} color={C.open} icon="alert-circle" />
          <KPICard label="Critiques" value={criticalReserves.length} color={C.critical} icon="warning" />
          <KPICard label="Clôturées" value={stats.closed} color={C.closed} icon="checkmark-circle" />
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Avancement global</Text>
            <Text style={[styles.pct, { color: C.primary }]}>{stats.progress}%</Text>
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
              <Ionicons name="warning" size={16} color={C.critical} />
              <Text style={styles.alertTitle}>Alertes critiques</Text>
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
                <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
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
  },
  brand: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  date: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  projectBadge: { backgroundColor: C.primaryBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  projectText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  content: { padding: 16, paddingBottom: 32 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  kpiCard: {
    flex: 1, minWidth: '44%', backgroundColor: C.surface,
    borderRadius: 14, padding: 14, borderTopWidth: 3,
    borderWidth: 1, borderColor: C.border, alignItems: 'flex-start',
  },
  kpiValue: { fontSize: 28, fontFamily: 'Inter_700Bold', marginTop: 8 },
  kpiLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: C.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  cardSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  pct: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  progressBg: { height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  progressHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  statusBars: { gap: 10, marginTop: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, width: 80 },
  statusBarWrap: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  statusBarFill: { height: '100%', borderRadius: 3 },
  statusCount: { fontSize: 12, fontFamily: 'Inter_600SemiBold', width: 20, textAlign: 'right' },
  coRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  coDot: { width: 8, height: 8, borderRadius: 4 },
  coName: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, width: 60 },
  coBarWrap: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  coBarFill: { height: '100%', borderRadius: 3 },
  coCount: { fontSize: 12, fontFamily: 'Inter_600SemiBold', width: 42, textAlign: 'right' },
  alertCard: {
    backgroundColor: C.criticalBg, borderRadius: 14, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  alertTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.critical },
  alertItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(239,68,68,0.15)' },
  alertDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.critical },
  alertText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  alertSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
});
