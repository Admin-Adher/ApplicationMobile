import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { Task, TaskStatus } from '@/constants/types';
import Header from '@/components/Header';

const STATUS_CFG: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: 'À faire', color: C.textMuted },
  in_progress: { label: 'En cours', color: C.inProgress },
  done: { label: 'Terminé', color: C.closed },
  delayed: { label: 'Retard', color: C.waiting },
};

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function TaskCard({ task }: { task: Task }) {
  const cfg = STATUS_CFG[task.status];
  return (
    <View style={[styles.taskCard, { borderLeftColor: cfg.color }]}>
      <View style={styles.taskTop}>
        <View style={[styles.statusBadge, { backgroundColor: cfg.color + '20' }]}>
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <Text style={[styles.taskPct, { color: cfg.color }]}>{task.progress}%</Text>
      </View>
      <Text style={styles.taskTitle}>{task.title}</Text>
      <Text style={styles.taskDesc} numberOfLines={1}>{task.description}</Text>
      <View style={styles.taskProgress}>
        <View style={styles.taskBarBg}>
          <View style={[styles.taskBarFill, { width: `${task.progress}%` as any, backgroundColor: cfg.color }]} />
        </View>
      </View>
      <View style={styles.taskBottom}>
        <Ionicons name="people-outline" size={12} color={C.textMuted} />
        <Text style={styles.taskAssignee}>{task.assignee}</Text>
        <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
        <Text style={styles.taskDeadline}>{task.deadline}</Text>
      </View>
    </View>
  );
}

export default function PlanningScreen() {
  const { tasks } = useApp();
  const [activeDay, setActiveDay] = useState(0);

  const todo = tasks.filter(t => t.status === 'todo').length;
  const inP = tasks.filter(t => t.status === 'in_progress').length;
  const done = tasks.filter(t => t.status === 'done').length;
  const delayed = tasks.filter(t => t.status === 'delayed').length;

  return (
    <View style={styles.container}>
      <Header title="Planning" subtitle={`${tasks.length} tâches au total`} showBack />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderTopColor: C.textMuted }]}>
            <Text style={styles.statVal}>{todo}</Text>
            <Text style={styles.statLabel}>À faire</Text>
          </View>
          <View style={[styles.statCard, { borderTopColor: C.inProgress }]}>
            <Text style={[styles.statVal, { color: C.inProgress }]}>{inP}</Text>
            <Text style={styles.statLabel}>En cours</Text>
          </View>
          <View style={[styles.statCard, { borderTopColor: C.waiting }]}>
            <Text style={[styles.statVal, { color: C.waiting }]}>{delayed}</Text>
            <Text style={styles.statLabel}>Retard</Text>
          </View>
          <View style={[styles.statCard, { borderTopColor: C.closed }]}>
            <Text style={[styles.statVal, { color: C.closed }]}>{done}</Text>
            <Text style={styles.statLabel}>Terminé</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Semaine en cours</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.daysRow}>
              {DAYS.map((d, i) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.dayBtn, activeDay === i && styles.dayBtnActive]}
                  onPress={() => setActiveDay(i)}
                >
                  <Text style={[styles.dayLabel, activeDay === i && styles.dayLabelActive]}>{d}</Text>
                  {i < 5 && (
                    <View style={[styles.dayDot, activeDay === i && styles.dayDotActive]} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        <Text style={styles.sectionTitle}>Toutes les tâches</Text>
        {tasks.map(t => <TaskCard key={t.id} task={t} />)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 12, borderTopWidth: 3, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  statVal: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  daysRow: { flexDirection: 'row', gap: 8 },
  dayBtn: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: C.surface2 },
  dayBtnActive: { backgroundColor: C.primaryBg },
  dayLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  dayLabelActive: { color: C.primary, fontFamily: 'Inter_700Bold' },
  dayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.border, marginTop: 4 },
  dayDotActive: { backgroundColor: C.primary },
  taskCard: { backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border, borderLeftWidth: 4 },
  taskTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  taskPct: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  taskTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  taskDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 10 },
  taskProgress: { marginBottom: 10 },
  taskBarBg: { height: 5, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  taskBarFill: { height: '100%', borderRadius: 3 },
  taskBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskAssignee: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, flex: 1 },
  taskDeadline: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
