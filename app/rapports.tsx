import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import Header from '@/components/Header';

const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const weekNum = Math.ceil(new Date().getDate() / 7);

export default function RapportsScreen() {
  const { reserves, companies, tasks, stats } = useApp();

  const openReserves = reserves.filter(r => r.status === 'open' || r.status === 'in_progress');
  const closedToday = reserves.filter(r => r.status === 'closed');

  function handleExport(type: string) {
    Alert.alert('Export ' + type, 'La génération et l\'export de rapports sont disponibles dans la version complète avec backend.');
  }

  return (
    <View style={styles.container}>
      <Header title="Rapports" subtitle="Journalier & hebdomadaire" showBack />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="document-text" size={20} color={C.inProgress} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>Rapport journalier</Text>
              <Text style={styles.reportDate}>{today}</Text>
            </View>
            <TouchableOpacity style={styles.exportBtn} onPress={() => handleExport('PDF')}>
              <Ionicons name="share-outline" size={16} color={C.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Personnel présent</Text>
            {companies.map(co => (
              <View key={co.id} style={styles.coRow}>
                <View style={[styles.coDot, { backgroundColor: co.color }]} />
                <Text style={styles.coName}>{co.name}</Text>
                <Text style={[styles.coVal, { color: co.color }]}>{co.actualWorkers} pers.</Text>
              </View>
            ))}
            <View style={[styles.coRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>TOTAL</Text>
              <Text style={[styles.coVal, { color: C.primary }]}>{stats.totalWorkers} / {stats.plannedWorkers} prévus</Text>
            </View>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Réserves du jour</Text>
            <View style={styles.statRow}>
              <StatItem label="Nouvelles" val={2} color={C.open} />
              <StatItem label="Modifiées" val={3} color={C.inProgress} />
              <StatItem label="Clôturées" val={1} color={C.closed} />
            </View>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Tâches avancées</Text>
            {tasks.filter(t => t.status === 'in_progress').map(t => (
              <View key={t.id} style={styles.taskItem}>
                <View style={styles.taskDot} />
                <Text style={styles.taskText}>{t.title}</Text>
                <Text style={[styles.taskPct, { color: C.inProgress }]}>{t.progress}%</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="calendar" size={20} color={C.closed} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>Rapport hebdomadaire</Text>
              <Text style={styles.reportDate}>Semaine {weekNum} — Mars 2025</Text>
            </View>
            <TouchableOpacity style={styles.exportBtn} onPress={() => handleExport('Excel')}>
              <Ionicons name="share-outline" size={16} color={C.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Synthèse réserves</Text>
            <View style={styles.statRow}>
              <StatItem label="Total" val={stats.total} color={C.textSub} />
              <StatItem label="Ouvertes" val={stats.open + stats.inProgress} color={C.open} />
              <StatItem label="Clôturées" val={stats.closed} color={C.closed} />
            </View>
            <View style={styles.progressWrap}>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${stats.progress}%` as any }]} />
              </View>
              <Text style={[styles.progressPct, { color: C.primary }]}>{stats.progress}%</Text>
            </View>
            <Text style={styles.progressLabel}>Avancement global du projet</Text>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Réserves critiques ouvertes</Text>
            {reserves.filter(r => r.priority === 'critical' && r.status !== 'closed').map(r => (
              <View key={r.id} style={styles.critItem}>
                <Ionicons name="warning" size={14} color={C.critical} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.critTitle}>{r.id} — {r.title}</Text>
                  <Text style={styles.critSub}>Bât. {r.building} — Éch. : {r.deadline}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="warning" size={20} color={C.waiting} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>Rapport réserves</Text>
              <Text style={styles.reportDate}>{stats.total} réserves au total</Text>
            </View>
            <TouchableOpacity style={styles.exportBtn} onPress={() => handleExport('PDF')}>
              <Ionicons name="share-outline" size={16} color={C.primary} />
            </TouchableOpacity>
          </View>

          {(['open', 'in_progress', 'waiting', 'verification', 'closed'] as const).map(s => {
            const labels: Record<string, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé' };
            const colors: Record<string, string> = { open: C.open, in_progress: C.inProgress, waiting: C.waiting, verification: C.verification, closed: C.closed };
            const count = reserves.filter(r => r.status === s).length;
            return (
              <View key={s} style={styles.statusBreakRow}>
                <View style={[styles.statusDot, { backgroundColor: colors[s] }]} />
                <Text style={styles.statusLabel}>{labels[s]}</Text>
                <View style={styles.statusBarBg}>
                  <View style={[styles.statusBarFill, {
                    width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%` as any,
                    backgroundColor: colors[s],
                  }]} />
                </View>
                <Text style={[styles.statusCount, { color: colors[s] }]}>{count}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function StatItem({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statVal, { color }]}>{val}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  reportCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  reportTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  reportDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  exportBtn: { padding: 8, backgroundColor: C.primaryBg, borderRadius: 8 },
  reportSection: { marginBottom: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  sectionTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  coRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  coDot: { width: 8, height: 8, borderRadius: 4 },
  coName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  coVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  totalRow: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, marginTop: 4 },
  totalLabel: { flex: 1, fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  statRow: { flexDirection: 'row', gap: 8 },
  statItem: { flex: 1, alignItems: 'center', backgroundColor: C.surface2, borderRadius: 10, padding: 10 },
  statVal: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  taskItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  taskDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.inProgress },
  taskText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  taskPct: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  progressBg: { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  progressPct: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4 },
  critItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  critTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  critSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  statusBreakRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, width: 82 },
  statusBarBg: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  statusBarFill: { height: '100%', borderRadius: 3 },
  statusCount: { fontSize: 13, fontFamily: 'Inter_600SemiBold', width: 20, textAlign: 'right' },
});
