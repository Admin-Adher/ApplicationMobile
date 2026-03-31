import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput } from 'react-native';
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
  if (task.startDate) {
    const parsed = parseDeadline(task.startDate);
    if (parsed) return parsed;
  }
  const deadline = parseDeadline(task.deadline);
  if (!deadline) return new Date();
  const durationDays = task.status === 'done' ? 14 : Math.max(7, Math.round((1 - task.progress / 100) * 21 + 7));
  return new Date(deadline.getTime() - durationDays * 86400000);
}

function TaskCard({ task, onDelete, canEdit, onPress }: { task: Task; onDelete: () => void; canEdit: boolean; onPress?: () => void }) {
  const { companies } = useApp();
  const cfg = STATUS_CFG[task.status];
  const companyName = companies.find(c => c.id === task.company)?.name ?? task.company;
  const deadline = parseDeadline(task.deadline);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isOverdue = deadline && deadline < today && task.status !== 'done';
  return (
    <TouchableOpacity
      style={[styles.taskCard, { borderLeftColor: cfg.color }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.75 : 1}
    >
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
        <Ionicons name="calendar-outline" size={12} color={isOverdue ? C.open : C.textMuted} />
        <Text style={[styles.taskDeadline, isOverdue && { color: C.open, fontFamily: 'Inter_600SemiBold' }]}>
          {formatDate(task.deadline)}{isOverdue ? ' ⚠' : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function CalendarView({ tasks, onTaskPress }: { tasks: Task[]; onTaskPress: (id: string) => void }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

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
  function goToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDay(today.getDate());
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
        <TouchableOpacity onPress={goToday} style={calStyles.monthTitleBtn}>
          <Text style={calStyles.monthTitle}>{MONTHS_FULL[month]} {year}</Text>
          {!isCurrentMonth && (
            <View style={calStyles.todayPill}>
              <Text style={calStyles.todayPillText}>Auj.</Text>
            </View>
          )}
        </TouchableOpacity>
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
          if (day === null) {
            return <View key={i} style={calStyles.cell} />;
          }
          const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
          const dayTasks = tasksByDay[day] ?? [];
          const hasTasks = dayTasks.length > 0;
          const isSelected = day === selectedDay;
          const isWeekend = (i % 7) >= 5;
          return (
            <TouchableOpacity
              key={i}
              style={[
                calStyles.cell,
                isToday && calStyles.todayCell,
                isSelected && calStyles.selectedCell,
              ]}
              onPress={() => setSelectedDay(day === selectedDay ? null : day)}
            >
              <Text style={[
                calStyles.cellDay,
                isWeekend && !isToday && !isSelected && { color: C.textMuted },
                isToday && calStyles.todayText,
                isSelected && calStyles.selectedText,
              ]}>{day}</Text>
              {hasTasks && (
                <View style={calStyles.dotsRow}>
                  {dayTasks.slice(0, 3).map((t, ti) => (
                    <View key={ti} style={[calStyles.dot, { backgroundColor: STATUS_CFG[t.status].color }]} />
                  ))}
                  {dayTasks.length > 3 && (
                    <Text style={calStyles.dotMore}>+</Text>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {Object.keys(tasksByDay).length === 0 && (
        <View style={calStyles.noTasksHint}>
          <Ionicons name="calendar-outline" size={18} color={C.textMuted} />
          <Text style={calStyles.noTasksHintText}>Aucune tâche avec échéance ce mois</Text>
        </View>
      )}

      {selectedDay !== null && (
        <View style={calStyles.selectedPanel}>
          <Text style={calStyles.selectedTitle}>
            {selectedDay} {MONTHS_FULL[month]} — {selectedTasks.length} tâche{selectedTasks.length !== 1 ? 's' : ''}
          </Text>
          {selectedTasks.length === 0 ? (
            <Text style={calStyles.noTask}>Aucune échéance à cette date</Text>
          ) : (
            selectedTasks.map(t => {
              const cfg = STATUS_CFG[t.status];
              return (
                <TouchableOpacity key={t.id} style={[calStyles.taskRow, { borderLeftColor: cfg.color }]} onPress={() => onTaskPress(t.id)} activeOpacity={0.75}>
                  <View style={{ flex: 1 }}>
                    <Text style={calStyles.taskRowTitle}>{t.title}</Text>
                    <Text style={calStyles.taskRowSub}>{t.assignee} — {cfg.label}</Text>
                  </View>
                  <Text style={[calStyles.taskRowPct, { color: cfg.color }]}>{t.progress}%</Text>
                  <Ionicons name="chevron-forward" size={14} color={cfg.color} />
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

const DAY_PX = 20;
const LABEL_W = 110;
const HEADER_H = 28;
const ROW_H = 44;

function GanttView({ tasks, onTaskPress }: { tasks: Task[]; onTaskPress: (id: string) => void }) {
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
    d.setDate(d.getDate() - 3);
    return d;
  }, [tasksWithDates]);

  const maxDate = useMemo(() => {
    if (tasksWithDates.length === 0) return new Date(today.getTime() + 30 * 86400000);
    const max = Math.max(...tasksWithDates.map(t => t.end.getTime()));
    const d = new Date(max);
    d.setDate(d.getDate() + 3);
    return d;
  }, [tasksWithDates]);

  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000);
  const totalWidth = totalDays * DAY_PX;
  const ganttContentHeight = HEADER_H + tasksWithDates.length * ROW_H + 8;

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
    <View style={{ flexDirection: 'row' }}>
      {/* Fixed left label column */}
      <View style={{ width: LABEL_W }}>
        <View style={{ height: HEADER_H, borderBottomWidth: 1, borderBottomColor: C.border }} />
        {tasksWithDates.map((t) => {
          const cfg = STATUS_CFG[t.status];
          return (
            <TouchableOpacity
              key={t.id}
              style={ganttStyles.labelRow}
              onPress={() => onTaskPress(t.id)}
              activeOpacity={0.75}
            >
              <View style={[ganttStyles.labelDot, { backgroundColor: cfg.color }]} />
              <Text style={ganttStyles.labelText} numberOfLines={2}>{t.title}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Scrollable timeline */}
      <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ flex: 1 }}>
        <View style={{ width: totalWidth + 10, minHeight: ganttContentHeight, position: 'relative' }}>
          {todayOffset >= 0 && todayOffset <= totalWidth && (
            <View style={[ganttStyles.todayLine, { left: todayOffset, height: ganttContentHeight }]} />
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
            const barWidth = Math.max(DAY_PX * 2, (t.end.getTime() - t.start.getTime()) / 86400000 * DAY_PX);
            const progressWidth = barWidth * (t.progress / 100);
            return (
              <View key={t.id} style={ganttStyles.row}>
                <TouchableOpacity
                  style={[ganttStyles.bar, { left, width: barWidth, backgroundColor: cfg.color + '25', borderColor: cfg.color }]}
                  onPress={() => onTaskPress(t.id)}
                  activeOpacity={0.75}
                >
                  <View style={[ganttStyles.barFill, { width: progressWidth, backgroundColor: cfg.color + '70' }]} />
                  <Text style={[ganttStyles.barLabel, { color: cfg.color }]} numberOfLines={1}>
                    {t.progress}%
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

export default function PlanningScreen() {
  const { tasks, deleteTask } = useApp();
  const { permissions } = useAuth();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  const todo = tasks.filter(t => t.status === 'todo').length;
  const inP = tasks.filter(t => t.status === 'in_progress').length;
  const done = tasks.filter(t => t.status === 'done').length;
  const delayed = tasks.filter(t => t.status === 'delayed').length;

  const filtered = useMemo(() => {
    let list = filterStatus === 'all' ? tasks : tasks.filter(t => t.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.assignee.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [tasks, filterStatus, search]);

  function handleDelete(id: string, title: string) {
    Alert.alert('Supprimer', `Supprimer la tâche "${title}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteTask(id) },
    ]);
  }

  const STATUS_FILTERS: { key: TaskStatus | 'all'; label: string; count: number; color: string }[] = [
    { key: 'todo', label: 'À faire', count: todo, color: C.textMuted },
    { key: 'in_progress', label: 'En cours', count: inP, color: C.inProgress },
    { key: 'delayed', label: 'Retard', count: delayed, color: C.waiting },
    { key: 'done', label: 'Terminé', count: done, color: C.closed },
  ];

  return (
    <View style={styles.container}>
      <Header
        title="Planning"
        subtitle={`${tasks.length} tâche${tasks.length !== 1 ? 's' : ''} au total`}
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
              name={mode === 'list' ? 'list-outline' : mode === 'calendar' ? 'calendar-outline' : 'reorder-four-outline'}
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
          {STATUS_FILTERS.map(sf => (
            <TouchableOpacity
              key={sf.key}
              style={[
                styles.statCard,
                { borderTopColor: filterStatus === sf.key ? sf.color : sf.color + '80' },
                filterStatus === sf.key && { borderColor: sf.color + '40', backgroundColor: sf.color + '08' },
              ]}
              onPress={() => setFilterStatus(filterStatus === sf.key ? 'all' : sf.key)}
            >
              <Text style={[styles.statVal, { color: sf.color }]}>{sf.count}</Text>
              <Text style={styles.statLabel}>{sf.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={15} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher une tâche..."
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {viewMode === 'list' && (
          <>
            <View style={styles.listHeader}>
              <Text style={styles.sectionTitle}>
                {filterStatus === 'all' ? 'Toutes les tâches' : `${STATUS_CFG[filterStatus]?.label}`}
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
                onPress={() => router.push(`/task/${t.id}` as any)}
              />
            ))}
            {filtered.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="checkmark-done-outline" size={40} color={C.textMuted} />
                <Text style={styles.emptyText}>
                  {search.trim() ? 'Aucune tâche correspondante' : 'Aucune tâche dans cette catégorie'}
                </Text>
              </View>
            )}
          </>
        )}

        {viewMode === 'calendar' && (
          <View style={styles.card}>
            <CalendarView tasks={filtered} onTaskPress={(id) => router.push(`/task/${id}` as any)} />
          </View>
        )}

        {viewMode === 'gantt' && (
          <View style={styles.card}>
            <View style={styles.ganttHeader}>
              <Text style={styles.sectionTitle}>Diagramme de Gantt</Text>
              <Text style={styles.ganttHint}>Faites défiler horizontalement · Début estimé si non renseigné</Text>
            </View>
            <View style={ganttStyles.wrapper}>
              <GanttView tasks={filtered} onTaskPress={(id) => router.push(`/task/${id}` as any)} />
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const calStyles = StyleSheet.create({
  container: { gap: 4 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  navBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  monthTitleBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  monthTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  todayPill: { backgroundColor: C.primaryBg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  todayPillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.primary },
  daysHeader: { flexDirection: 'row', marginBottom: 4 },
  dayHeader: { flex: 1, textAlign: 'center', fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub, paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2, borderRadius: 8 },
  todayCell: { backgroundColor: C.primaryBg },
  selectedCell: { backgroundColor: C.primary + '25', borderWidth: 1.5, borderColor: C.primary },
  cellDay: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  todayText: { color: C.primary, fontFamily: 'Inter_700Bold' },
  selectedText: { color: C.primary, fontFamily: 'Inter_700Bold' },
  dotsRow: { flexDirection: 'row', gap: 2, marginTop: 2, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotMore: { fontSize: 8, fontFamily: 'Inter_700Bold', color: C.textMuted },
  selectedPanel: { marginTop: 10, padding: 12, backgroundColor: C.surface2, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  selectedTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 8 },
  noTask: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderLeftWidth: 3, backgroundColor: C.surface, marginBottom: 6 },
  taskRowTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  taskRowSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  taskRowPct: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  noTasksHint: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, justifyContent: 'center' },
  noTasksHintText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
});

const ganttStyles = StyleSheet.create({
  wrapper: { marginTop: 8, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  timelineHeader: { height: HEADER_H, position: 'relative', borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 2 },
  monthMarker: { position: 'absolute', top: 6 },
  monthLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textSub, backgroundColor: C.surface, paddingHorizontal: 2 },
  todayLine: { position: 'absolute', top: 0, width: 2, backgroundColor: C.open + '90', zIndex: 2 },
  row: { height: ROW_H, position: 'relative', justifyContent: 'center' },
  bar: {
    position: 'absolute', top: 7, height: 30, borderRadius: 6,
    borderWidth: 1, overflow: 'hidden', justifyContent: 'center',
    minWidth: 36,
  },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 6 },
  barLabel: { paddingHorizontal: 6, fontSize: 10, fontFamily: 'Inter_700Bold', zIndex: 1 },
  labelRow: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, borderBottomWidth: 0 },
  labelDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  labelText: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.text, flex: 1 },
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
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 10, borderTopWidth: 3, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  statVal: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2, textAlign: 'center' },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5 },
  ganttHeader: { marginBottom: 4 },
  ganttHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 3 },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, marginBottom: 12, gap: 8 },
  searchInput: { flex: 1, height: 42, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
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
