import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Task, TaskStatus } from '@/constants/types';
import Header from '@/components/Header';
import { parseDeadline, formatDate } from '@/lib/reserveUtils';

const STATUS_CFG: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: 'À faire', color: C.textMuted },
  in_progress: { label: 'En cours', color: C.inProgress },
  done: { label: 'Terminé', color: C.closed },
  delayed: { label: 'Retard', color: C.waiting },
};

type ViewMode = 'list' | 'calendar' | 'gantt';

const MONTHS_FR = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
const MONTHS_FULL = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const DAYS_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function getTaskStartDate(task: Task): Date {
  const deadline = parseDeadline(task.deadline);
  if (!deadline) return new Date();
  const durationDays = task.status === 'done' ? 14 : Math.max(7, Math.round((1 - task.progress / 100) * 21 + 7));
  return new Date(deadline.getTime() - durationDays * 86400000);
}

function TaskCard({ task, onDelete, canEdit }: { task: Task; onDelete: () => void; canEdit: boolean }) {
  const { companies } = useApp();
  const cfg = STATUS_CFG[task.status];
  const companyName = companies.find(c => c.id === task.company)?.name ?? task.company;
  return (
    <View style={[styles.taskCard, { borderLeftColor: cfg.color }]}>
      <View style={styles.taskTop}>
        <View style={[styles.statusBadge, { backgroundColor: cfg.color + '20' }]}>
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.taskPct, { color: cfg.color }]}>{task.progress}%</Text>
          {canEdit && (
            <TouchableOpacity onPress={onDelete} hitSlop={8}>
              <Ionicons name="trash-outline" size={15} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>
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
        <Ionicons name="business-outline" size={12} color={C.textMuted} />
        <Text style={styles.taskCompany} numberOfLines={1}>{companyName}</Text>
        <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
        <Text style={styles.taskDeadline}>{formatDate(task.deadline)}</Text>
      </View>
    </View>
  );
}

function CalendarView({ tasks }: { tasks: Task[] }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7;
  const totalDays = lastDay.getDate();

  const tasksByDay = useMemo(() => {
    const map: Record<number, Task[]> = {};
    tasks.forEach(t => {
      const d = parseDeadline(t.deadline);
      if (d && d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(t);
      }
    });
    return map;
  }, [tasks, year, month]);

  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  }

  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedTasks = selectedDay ? (tasksByDay[selectedDay] ?? []) : [];

  return (
    <View style={calStyles.container}>
      <View style={calStyles.navRow}>
        <TouchableOpacity onPress={prevMonth} style={calStyles.navBtn}>
          <Ionicons name="chevron-back" size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={calStyles.monthTitle}>{MONTHS_FULL[month]} {year}</Text>
        <TouchableOpacity onPress={nextMonth} style={calStyles.navBtn}>
          <Ionicons name="chevron-forward" size={18} color={C.text} />
        </TouchableOpacity>
      </View>

      <View style={calStyles.daysHeader}>
        {DAYS_SHORT.map((d, i) => (
          <Text key={i} style={[calStyles.dayHeader, i >= 5 && { color: C.textMuted }]}>{d}</Text>
        ))}
      </View>

      <View style={calStyles.grid}>
        {cells.map((day, i) => {
          const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
          const hasTasks = day !== null && !!tasksByDay[day];
          const isSelected = day === selectedDay;
          const dayTasks = day !== null ? (tasksByDay[day] ?? []) : [];
          return (
            <TouchableOpacity
              key={i}
              style={[
                calStyles.cell,
                isToday && calStyles.todayCell,
                isSelected && calStyles.selectedCell,
              ]}
              onPress={() => day !== null && setSelectedDay(day === selectedDay ? null : day)}
              disabled={day === null}
            >
              {day !== null && (
                <>
                  <Text style={[
                    calStyles.cellDay,
                    isToday && calStyles.todayText,
                    isSelected && calStyles.selectedText,
                  ]}>{day}</Text>
                  {hasTasks && (
                    <View style={calStyles.dotsRow}>
                      {dayTasks.slice(0, 3).map((t, ti) => (
                        <View key={ti} style={[calStyles.dot, { backgroundColor: STATUS_CFG[t.status].color }]} />
                      ))}
                    </View>
                  )}
                </>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {selectedDay !== null && (
        <View style={calStyles.selectedPanel}>
          <Text style={calStyles.selectedTitle}>
            {selectedDay} {MONTHS_FULL[month]} — {selectedTasks.length} tâche{selectedTasks.length > 1 ? 's' : ''}
          </Text>
          {selectedTasks.length === 0 ? (
            <Text style={calStyles.noTask}>Aucune tâche à cette date</Text>
          ) : (
            selectedTasks.map(t => {
              const cfg = STATUS_CFG[t.status];
              return (
                <View key={t.id} style={[calStyles.taskRow, { borderLeftColor: cfg.color }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={calStyles.taskRowTitle}>{t.title}</Text>
                    <Text style={calStyles.taskRowSub}>{t.assignee} — {cfg.label}</Text>
                  </View>
                  <Text style={[calStyles.taskRowPct, { color: cfg.color }]}>{t.progress}%</Text>
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

const DAY_PX = 18;

function GanttView({ tasks }: { tasks: Task[] }) {
  const today = new Date();

  const tasksWithDates = useMemo(() => {
    return tasks.map(t => {
      const end = parseDeadline(t.deadline) ?? new Date(today.getTime() + 7 * 86400000);
      const start = getTaskStartDate(t);
      return { ...t, start, end };
    }).sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [tasks]);

  const minDate = useMemo(() => {
    if (tasksWithDates.length === 0) return today;
    const min = Math.min(...tasksWithDates.map(t => t.start.getTime()));
    const d = new Date(min);
    d.setDate(d.getDate() - 2);
    return d;
  }, [tasksWithDates]);

  const maxDate = useMemo(() => {
    if (tasksWithDates.length === 0) return new Date(today.getTime() + 30 * 86400000);
    const max = Math.max(...tasksWithDates.map(t => t.end.getTime()));
    const d = new Date(max);
    d.setDate(d.getDate() + 2);
    return d;
  }, [tasksWithDates]);

  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000);
  const totalWidth = totalDays * DAY_PX;
  const HEADER_H = 28;
  const ROW_H = 44;
  const ganttInnerHeight = HEADER_H + tasksWithDates.length * ROW_H;

  function dayOffset(date: Date): number {
    return Math.floor((date.getTime() - minDate.getTime()) / 86400000) * DAY_PX;
  }

  const todayOffset = dayOffset(today);

  const monthMarkers: { label: string; x: number }[] = [];
  const cur = new Date(minDate);
  cur.setDate(1);
  while (cur <= maxDate) {
    const x = dayOffset(cur);
    if (x >= 0 && x <= totalWidth) {
      monthMarkers.push({ label: `${MONTHS_FR[cur.getMonth()]} ${cur.getFullYear()}`, x });
    }
    cur.setMonth(cur.getMonth() + 1);
  }

  if (tasksWithDates.length === 0) {
    return (
      <View style={ganttStyles.empty}>
        <Ionicons name="bar-chart-outline" size={40} color={C.textMuted} />
        <Text style={ganttStyles.emptyText}>Aucune tâche à afficher</Text>
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={true} style={ganttStyles.hScroll}>
      <View style={{ width: totalWidth + 10, position: 'relative' }}>
        {/* Today line spans the full gantt height */}
        {todayOffset >= 0 && todayOffset <= totalWidth && (
          <View style={[ganttStyles.todayLine, { left: todayOffset, height: ganttInnerHeight }]} />
        )}
        <View style={[ganttStyles.timelineHeader, { width: totalWidth + 10 }]}>
          {monthMarkers.map((m, i) => (
            <View key={i} style={[ganttStyles.monthMarker, { left: m.x }]}>
              <Text style={ganttStyles.monthLabel}>{m.label}</Text>
            </View>
          ))}
        </View>

        {tasksWithDates.map((t) => {
          const cfg = STATUS_CFG[t.status];
          const left = dayOffset(t.start);
          const width = Math.max(DAY_PX * 2, (t.end.getTime() - t.start.getTime()) / 86400000 * DAY_PX);
          const progressWidth = width * (t.progress / 100);
          return (
            <View key={t.id} style={ganttStyles.row}>
              <View style={[ganttStyles.bar, { left, width, backgroundColor: cfg.color + '30', borderColor: cfg.color }]}>
                <View style={[ganttStyles.barFill, { width: progressWidth, backgroundColor: cfg.color + '80' }]} />
                <Text style={[ganttStyles.barLabel, { color: cfg.color }]} numberOfLines={1}>
                  {t.title}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function GanttLegend({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;
  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const aDate = parseDeadline(a.deadline);
      const bDate = parseDeadline(b.deadline);
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return aDate.getTime() - bDate.getTime();
    });
  }, [tasks]);

  return (
    <View style={ganttStyles.legend}>
      {sorted.map(t => {
        const cfg = STATUS_CFG[t.status];
        return (
          <View key={t.id} style={ganttStyles.legendRow}>
            <View style={[ganttStyles.legendDot, { backgroundColor: cfg.color }]} />
            <Text style={ganttStyles.legendTitle} numberOfLines={1}>{t.title}</Text>
            <Text style={ganttStyles.legendDeadline}>{formatDate(t.deadline)}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function PlanningScreen() {
  const { tasks, deleteTask } = useApp();
  const { permissions } = useAuth();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all');

  const todo = tasks.filter(t => t.status === 'todo').length;
  const inP = tasks.filter(t => t.status === 'in_progress').length;
  const done = tasks.filter(t => t.status === 'done').length;
  const delayed = tasks.filter(t => t.status === 'delayed').length;

  const filtered = filterStatus === 'all' ? tasks : tasks.filter(t => t.status === filterStatus);

  function handleDelete(id: string, title: string) {
    Alert.alert('Supprimer', `Supprimer la tâche "${title}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteTask(id) },
    ]);
  }

  return (
    <View style={styles.container}>
      <Header
        title="Planning"
        subtitle={`${tasks.length} tâches au total`}
        showBack
        rightIcon={permissions.canCreate ? 'add-circle-outline' : undefined}
        onRightPress={permissions.canCreate ? () => router.push('/task/new' as any) : undefined}
      />

      <View style={styles.viewToggle}>
        {(['list', 'calendar', 'gantt'] as ViewMode[]).map(mode => (
          <TouchableOpacity
            key={mode}
            style={[styles.toggleBtn, viewMode === mode && styles.toggleBtnActive]}
            onPress={() => setViewMode(mode)}
          >
            <Ionicons
              name={mode === 'list' ? 'list-outline' : mode === 'calendar' ? 'calendar-outline' : 'bar-chart-outline'}
              size={15}
              color={viewMode === mode ? C.primary : C.textSub}
            />
            <Text style={[styles.toggleLabel, viewMode === mode && styles.toggleLabelActive]}>
              {mode === 'list' ? 'Liste' : mode === 'calendar' ? 'Calendrier' : 'Gantt'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <TouchableOpacity style={[styles.statCard, { borderTopColor: C.textMuted }, filterStatus === 'todo' && styles.statCardActive]} onPress={() => setFilterStatus(filterStatus === 'todo' ? 'all' : 'todo')}>
            <Text style={styles.statVal}>{todo}</Text>
            <Text style={styles.statLabel}>À faire</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.statCard, { borderTopColor: C.inProgress }, filterStatus === 'in_progress' && styles.statCardActive]} onPress={() => setFilterStatus(filterStatus === 'in_progress' ? 'all' : 'in_progress')}>
            <Text style={[styles.statVal, { color: C.inProgress }]}>{inP}</Text>
            <Text style={styles.statLabel}>En cours</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.statCard, { borderTopColor: C.waiting }, filterStatus === 'delayed' && styles.statCardActive]} onPress={() => setFilterStatus(filterStatus === 'delayed' ? 'all' : 'delayed')}>
            <Text style={[styles.statVal, { color: C.waiting }]}>{delayed}</Text>
            <Text style={styles.statLabel}>Retard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.statCard, { borderTopColor: C.closed }, filterStatus === 'done' && styles.statCardActive]} onPress={() => setFilterStatus(filterStatus === 'done' ? 'all' : 'done')}>
            <Text style={[styles.statVal, { color: C.closed }]}>{done}</Text>
            <Text style={styles.statLabel}>Terminé</Text>
          </TouchableOpacity>
        </View>

        {viewMode === 'list' && (
          <>
            <View style={styles.listHeader}>
              <Text style={styles.sectionTitle}>
                {filterStatus === 'all' ? 'Toutes les tâches' : `Tâches — ${STATUS_CFG[filterStatus]?.label}`}
                {' '}({filtered.length})
              </Text>
              {permissions.canCreate && (
                <TouchableOpacity style={styles.addBtn} onPress={() => router.push('/task/new' as any)}>
                  <Ionicons name="add" size={16} color={C.primary} />
                  <Text style={styles.addBtnText}>Nouvelle tâche</Text>
                </TouchableOpacity>
              )}
            </View>
            {filtered.map(t => (
              <TaskCard
                key={t.id}
                task={t}
                canEdit={permissions.canEdit}
                onDelete={() => handleDelete(t.id, t.title)}
              />
            ))}
            {filtered.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="checkmark-done-outline" size={40} color={C.textMuted} />
                <Text style={styles.emptyText}>Aucune tâche dans cette catégorie</Text>
              </View>
            )}
          </>
        )}

        {viewMode === 'calendar' && (
          <View style={styles.card}>
            <CalendarView tasks={filtered} />
          </View>
        )}

        {viewMode === 'gantt' && (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Diagramme de Gantt</Text>
              <Text style={styles.ganttHint}>Les barres vont du début estimé à la date limite — faites défiler horizontalement</Text>
              <View style={ganttStyles.wrapper}>
                <GanttView tasks={filtered} />
              </View>
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Légende des tâches</Text>
              <GanttLegend tasks={filtered} />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const calStyles = StyleSheet.create({
  container: { gap: 8 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  daysHeader: { flexDirection: 'row', marginBottom: 4 },
  dayHeader: { flex: 1, textAlign: 'center', fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub, paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, borderRadius: 8 },
  todayCell: { backgroundColor: C.primaryBg },
  selectedCell: { backgroundColor: C.primary + '30', borderWidth: 1, borderColor: C.primary },
  cellDay: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  todayText: { color: C.primary, fontFamily: 'Inter_700Bold' },
  selectedText: { color: C.primary, fontFamily: 'Inter_700Bold' },
  dotsRow: { flexDirection: 'row', gap: 2, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  selectedPanel: { marginTop: 12, padding: 12, backgroundColor: C.surface2, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  selectedTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 8 },
  noTask: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderLeftWidth: 3, backgroundColor: C.surface, marginBottom: 6 },
  taskRowTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  taskRowSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  taskRowPct: { fontSize: 13, fontFamily: 'Inter_700Bold' },
});

const ganttStyles = StyleSheet.create({
  wrapper: { marginTop: 12, borderRadius: 8, overflow: 'hidden' },
  hScroll: { minHeight: 60 },
  timelineHeader: { height: 28, position: 'relative', borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 4 },
  monthMarker: { position: 'absolute', top: 4 },
  monthLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textSub, backgroundColor: C.surface, paddingHorizontal: 2 },
  todayLine: { position: 'absolute', top: 0, width: 1.5, backgroundColor: C.critical + '80', zIndex: 1 },
  row: { height: 38, position: 'relative', marginBottom: 6 },
  bar: {
    position: 'absolute', top: 4, height: 30, borderRadius: 6,
    borderWidth: 1, overflow: 'hidden', justifyContent: 'center',
    minWidth: 36,
  },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 6 },
  barLabel: { paddingHorizontal: 6, fontSize: 10, fontFamily: 'Inter_600SemiBold', zIndex: 1 },
  legend: { gap: 6, marginTop: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendTitle: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.text },
  legendDeadline: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  viewToggle: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  toggleBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  toggleLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  toggleLabelActive: { color: C.primary },
  content: { padding: 16, paddingBottom: 40 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 12, borderTopWidth: 3, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  statCardActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  statVal: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5 },
  ganttHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary },
  addBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  taskCard: { backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border, borderLeftWidth: 4 },
  taskTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  taskPct: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  taskTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  taskDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 10 },
  taskProgress: { marginBottom: 10 },
  taskBarBg: { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  taskBarFill: { height: 4, borderRadius: 2 },
  taskBottom: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  taskAssignee: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginRight: 4 },
  taskCompany: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginRight: 4, flex: 1 },
  taskDeadline: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
