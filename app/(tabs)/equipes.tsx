import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';

export default function EquipesScreen() {
  const insets = useSafeAreaInsets();
  const { companies, tasks, stats, updateCompanyWorkers } = useApp();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  function handleUpdateWorkers(coId: string, coName: string, current: number) {
    Alert.prompt(
      'Personnel présent',
      `${coName} — Saisir le nombre réel de personnes présentes :`,
      (val) => {
        const n = parseInt(val ?? '');
        if (!isNaN(n) && n >= 0) updateCompanyWorkers(coId, n);
      },
      'plain-text',
      String(current),
      'numeric'
    );
  }

  return (
    <View style={[styles.container]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={styles.title}>Équipes</Text>
        <Text style={styles.subtitle}>{today}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{stats.totalWorkers}</Text>
              <Text style={styles.summaryLabel}>Présents</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: C.textSub }]}>{stats.plannedWorkers}</Text>
              <Text style={styles.summaryLabel}>Prévus</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: stats.plannedWorkers - stats.totalWorkers > 0 ? C.waiting : C.closed }]}>
                {stats.plannedWorkers - stats.totalWorkers}
              </Text>
              <Text style={styles.summaryLabel}>Écart</Text>
            </View>
          </View>
          <View style={styles.summaryBarBg}>
            <View style={[styles.summaryBarFill, {
              width: `${Math.min((stats.totalWorkers / stats.plannedWorkers) * 100, 100)}%` as any
            }]} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Entreprises sur chantier</Text>
        {companies.map(co => {
          const pct = co.plannedWorkers > 0 ? (co.actualWorkers / co.plannedWorkers) * 100 : 0;
          const ecart = co.plannedWorkers - co.actualWorkers;
          return (
            <View key={co.id} style={styles.coCard}>
              <View style={styles.coTop}>
                <View style={[styles.coColorBar, { backgroundColor: co.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.coName}>{co.name}</Text>
                  <Text style={styles.coZone}>{co.zone}</Text>
                </View>
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={() => handleUpdateWorkers(co.id, co.name, co.actualWorkers)}
                >
                  <Ionicons name="pencil" size={14} color={C.primary} />
                </TouchableOpacity>
              </View>

              <View style={styles.coStats}>
                <View style={styles.coStat}>
                  <Text style={[styles.coStatVal, { color: co.color }]}>{co.actualWorkers}</Text>
                  <Text style={styles.coStatLabel}>Présents</Text>
                </View>
                <View style={styles.coStat}>
                  <Text style={styles.coStatVal}>{co.plannedWorkers}</Text>
                  <Text style={styles.coStatLabel}>Prévus</Text>
                </View>
                <View style={styles.coStat}>
                  <Text style={[styles.coStatVal, { color: ecart > 0 ? C.waiting : C.closed }]}>
                    {ecart > 0 ? `-${ecart}` : '✓'}
                  </Text>
                  <Text style={styles.coStatLabel}>Écart</Text>
                </View>
                <View style={styles.coStat}>
                  <Text style={styles.coStatVal}>{co.hoursWorked}h</Text>
                  <Text style={styles.coStatLabel}>Heures</Text>
                </View>
              </View>

              <View style={styles.coBarBg}>
                <View style={[styles.coBarFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: co.color }]} />
              </View>

              <View style={styles.coContact}>
                <Ionicons name="call-outline" size={12} color={C.textMuted} />
                <Text style={styles.coContactText}>{co.contact}</Text>
              </View>
            </View>
          );
        })}

        <Text style={styles.sectionTitle}>Tâches en cours</Text>
        {tasks.filter(t => t.status === 'in_progress' || t.status === 'delayed').map(task => {
          const co = companies.find(c => c.id === task.company);
          return (
            <View key={task.id} style={styles.taskCard}>
              <View style={styles.taskTop}>
                <View style={[styles.taskDot, { backgroundColor: task.status === 'delayed' ? C.waiting : C.inProgress }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskTitle}>{task.title}</Text>
                  <Text style={styles.taskSub}>{task.assignee}</Text>
                </View>
                <Text style={[styles.taskPct, { color: task.status === 'delayed' ? C.waiting : C.inProgress }]}>
                  {task.progress}%
                </Text>
              </View>
              <View style={styles.taskBarBg}>
                <View style={[styles.taskBarFill, {
                  width: `${task.progress}%` as any,
                  backgroundColor: task.status === 'delayed' ? C.waiting : C.inProgress,
                }]} />
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  content: { padding: 16, paddingBottom: 32 },
  summaryCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: C.border },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 },
  summaryItem: { alignItems: 'center' },
  summaryValue: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.primary },
  summaryLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  divider: { width: 1, backgroundColor: C.border, marginVertical: 4 },
  summaryBarBg: { height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  summaryBarFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 10, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  coCard: { backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  coTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  coColorBar: { width: 4, height: 36, borderRadius: 2 },
  coName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  coZone: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  editBtn: { padding: 6, backgroundColor: C.primaryBg, borderRadius: 8 },
  coStats: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  coStat: { alignItems: 'center', flex: 1 },
  coStatVal: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  coStatLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  coBarBg: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden', marginBottom: 10 },
  coBarFill: { height: '100%', borderRadius: 3 },
  coContact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coContactText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  taskCard: { backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  taskTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  taskDot: { width: 8, height: 8, borderRadius: 4 },
  taskTitle: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  taskSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  taskPct: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  taskBarBg: { height: 5, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  taskBarFill: { height: '100%', borderRadius: 3 },
});
