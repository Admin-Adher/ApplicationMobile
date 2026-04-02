import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Task, TaskStatus } from '@/constants/types';
import Header from '@/components/Header';
import { parseDeadline, formatDate } from '@/lib/reserveUtils';
import BottomNavBar from '@/components/BottomNavBar';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_CFG: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: 'À faire', color: C.textMuted },
  in_progress: { label: 'En cours', color: C.inProgress },
  done: { label: 'Terminé', color: C.closed },
  delayed: { label: 'Retard', color: C.waiting },
};

const PRIORITY_CFG: Record<string, { label: string; color: string }> = {
  low: { label: 'Faible', color: '#22C55E' },
  medium: { label: 'Moyen', color: '#F59E0B' },
  high: { label: 'Haute', color: '#EF4444' },
  critical: { label: 'Critique', color: '#7C3AED' },
};

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const MONTHS_FR = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
const MONTHS_FULL = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const DAYS_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

type ViewMode = 'list' | 'calendar' | 'gantt';
type GroupMode = 'company' | 'status' | 'priority';
type Granularity = 'week' | 'month';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sod(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayLabel(d: Date, today: Date): string {
  if (isSameDay(d, today)) return `Aujourd'hui · ${DAYS_FULL[d.getDay()]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`;
  if (isSameDay(d, addDays(today, 1))) return `Demain · ${DAYS_FULL[d.getDay()]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`;
  return `${DAYS_FULL[d.getDay()]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`;
}
function getTaskStartDate(task: Task): Date {
  if (task.startDate) { const p = parseDeadline(task.startDate); if (p) return p; }
  const dl = parseDeadline(task.deadline);
  if (!dl) return new Date();
  const dur = task.status === 'done' ? 14 : Math.max(7, Math.round((1 - task.progress / 100) * 21 + 7));
  return new Date(dl.getTime() - dur * 86400000);
}

// ─── TaskCard ────────────────────────────────────────────────────────────────

function TaskCard({ task, onDelete, canEdit, onPress }: {
  task: Task; onDelete: () => void; canEdit: boolean; onPress?: () => void;
}) {
  const { companies } = useApp();
  const cfg = STATUS_CFG[task.status];
  const co = companies.find(c => c.id === task.company || c.name === task.company);
  const companyName = co?.name ?? task.company ?? '—';
  const deadline = parseDeadline(task.deadline);
  const today = sod(new Date());
  const isOverdue = deadline && sod(deadline) < today && task.status !== 'done';
  const daysLeft = deadline ? Math.ceil((sod(deadline).getTime() - today.getTime()) / 86400000) : null;

  return (
    <TouchableOpacity style={[styles.taskCard, { borderLeftColor: cfg.color }]} onPress={onPress} activeOpacity={0.75}>

      {/* Ligne 1 : badges + deadline en haut à droite */}
      <View style={styles.taskTop}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          <View style={[styles.statusBadge, { backgroundColor: cfg.color + '20' }]}>
            <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
          {task.priority && PRIORITY_CFG[task.priority] && (
            <View style={[styles.statusBadge, { backgroundColor: PRIORITY_CFG[task.priority].color + '15', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: PRIORITY_CFG[task.priority].color }} />
              <Text style={[styles.statusText, { color: PRIORITY_CFG[task.priority].color }]}>{PRIORITY_CFG[task.priority].label}</Text>
            </View>
          )}
        </View>

        {/* Deadline — visible immédiatement, en haut à droite */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {task.deadline ? (
            <View style={[
              styles.deadlinePill,
              isOverdue
                ? styles.deadlinePillOverdue
                : daysLeft !== null && daysLeft <= 3
                  ? styles.deadlinePillSoon
                  : styles.deadlinePillNormal,
            ]}>
              <Ionicons
                name="calendar-outline"
                size={11}
                color={isOverdue ? C.open : daysLeft !== null && daysLeft <= 3 ? C.waiting : C.textSub}
              />
              <Text style={[
                styles.deadlinePillText,
                isOverdue
                  ? { color: C.open, fontFamily: 'Inter_700Bold' }
                  : daysLeft !== null && daysLeft <= 3
                    ? { color: C.waiting, fontFamily: 'Inter_600SemiBold' }
                    : { color: C.textSub },
              ]}>
                {isOverdue
                  ? `Retard ${formatDate(task.deadline)}`
                  : daysLeft === 0
                    ? "Aujourd'hui"
                    : daysLeft === 1
                      ? 'Demain'
                      : formatDate(task.deadline)}
              </Text>
            </View>
          ) : null}
          {canEdit && (
            <TouchableOpacity onPress={onDelete} hitSlop={8}>
              <Ionicons name="trash-outline" size={15} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Ligne 2 : titre */}
      <Text style={styles.taskTitle}>{task.title}</Text>

      {/* Ligne 3 : entreprise + responsable */}
      <View style={styles.taskMeta}>
        {co && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: co.color }} />}
        <Text style={styles.taskMetaText} numberOfLines={1}>
          {companyName}
          {task.assignee ? ` · ${task.assignee}` : ''}
        </Text>
      </View>

      {/* Ligne 4 : barre de progression + % */}
      <View style={styles.taskProgressRow}>
        <View style={[styles.taskBarBg, { flex: 1 }]}>
          <View style={[styles.taskBarFill, { width: `${task.progress}%` as any, backgroundColor: cfg.color }]} />
        </View>
        <Text style={[styles.taskPct, { color: cfg.color }]}>{task.progress}%</Text>
      </View>

    </TouchableOpacity>
  );
}

// ─── AgendaView — Calendrier tab ─────────────────────────────────────────────

function AgendaView({ tasks, onTaskPress }: { tasks: Task[]; onTaskPress: (id: string) => void }) {
  const { companies } = useApp();
  const today = useMemo(() => sod(new Date()), []);
  const todayKey = toDateKey(today);

  type Section = {
    key: string; label: string; icon?: string;
    isOverdue?: boolean; isToday?: boolean; tasks: Task[];
  };

  const sections = useMemo((): Section[] => {
    const overdueTasks: Task[] = [];
    const byDay: Record<string, Task[]> = {};
    const laterTasks: Task[] = [];
    const noDateTasks: Task[] = [];

    for (const t of tasks) {
      const dl = parseDeadline(t.deadline);
      if (!dl) { noDateTasks.push(t); continue; }
      const d = sod(dl);
      if (d < today && t.status !== 'done') {
        overdueTasks.push(t);
      } else {
        const key = toDateKey(d);
        if (!byDay[key]) byDay[key] = [];
        byDay[key].push(t);
      }
    }

    const result: Section[] = [];

    if (overdueTasks.length > 0) {
      overdueTasks.sort((a, b) =>
        (parseDeadline(a.deadline)?.getTime() ?? 0) - (parseDeadline(b.deadline)?.getTime() ?? 0)
      );
      result.push({
        key: 'overdue',
        label: `En retard — ${overdueTasks.length} tâche${overdueTasks.length > 1 ? 's' : ''}`,
        icon: 'alert-circle',
        isOverdue: true,
        tasks: overdueTasks,
      });
    }

    const todayTasks = (byDay[todayKey] ?? []).sort(
      (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
    );
    result.push({ key: todayKey, label: dayLabel(today, today), isToday: true, tasks: todayTasks });

    const futureKeys = Object.keys(byDay).filter(k => k > todayKey).sort();
    for (const key of futureKeys) {
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);
      if (diffDays > 60) {
        laterTasks.push(...byDay[key]);
      } else {
        result.push({
          key,
          label: dayLabel(date, today),
          tasks: byDay[key].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)),
        });
      }
    }

    if (laterTasks.length > 0) {
      laterTasks.sort((a, b) =>
        (parseDeadline(a.deadline)?.getTime() ?? 0) - (parseDeadline(b.deadline)?.getTime() ?? 0)
      );
      result.push({ key: 'later', label: 'Plus tard', icon: 'time-outline', tasks: laterTasks });
    }
    if (noDateTasks.length > 0) {
      result.push({ key: 'nodate', label: 'Sans échéance', icon: 'help-circle-outline', tasks: noDateTasks });
    }

    return result;
  }, [tasks, today, todayKey]);

  if (tasks.length === 0) {
    return (
      <View style={aStyles.empty}>
        <Ionicons name="today-outline" size={40} color={C.textMuted} />
        <Text style={aStyles.emptyText}>Aucune tâche à afficher</Text>
        <Text style={aStyles.emptyHint}>Créez des tâches depuis l'onglet Liste</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 20 }}>
      {sections.map(section => (
        <View key={section.key}>
          <View style={[
            aStyles.sectionHeader,
            section.isOverdue && aStyles.sectionHeaderOverdue,
            section.isToday && aStyles.sectionHeaderToday,
          ]}>
            {section.isToday && !section.icon && (
              <View style={aStyles.todayDot} />
            )}
            {section.icon && (
              <Ionicons
                name={section.icon as any}
                size={13}
                color={section.isOverdue ? C.open : section.isToday ? C.primary : C.textSub}
              />
            )}
            <Text style={[
              aStyles.sectionHeaderText,
              section.isOverdue && { color: C.open },
              section.isToday && { color: C.primary, fontFamily: 'Inter_700Bold' },
            ]}>
              {section.label}
            </Text>
          </View>

          {section.tasks.length === 0 && section.isToday && (
            <View style={aStyles.emptyToday}>
              <Ionicons name="checkmark-circle-outline" size={15} color={C.textMuted} />
              <Text style={aStyles.emptyTodayText}>Aucune échéance aujourd'hui — bonne journée !</Text>
            </View>
          )}

          {section.tasks.length > 0 && (
            <View style={{ gap: 8, marginTop: 8 }}>
              {section.tasks.map(t => {
                const cfg = STATUS_CFG[t.status];
                const co = companies.find(c => c.id === t.company || c.name === t.company);
                const dl = parseDeadline(t.deadline);
                const isLate = dl && sod(dl) < today && t.status !== 'done';
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[aStyles.taskRow, { borderLeftColor: cfg.color }]}
                    onPress={() => onTaskPress(t.id)}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
                        <View style={[aStyles.statusPill, { backgroundColor: cfg.color + '20' }]}>
                          <Text style={[aStyles.statusPillText, { color: cfg.color }]}>{cfg.label}</Text>
                        </View>
                        {t.priority && PRIORITY_CFG[t.priority] && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: PRIORITY_CFG[t.priority].color }} />
                            <Text style={{ fontSize: 10, fontFamily: 'Inter_500Medium', color: PRIORITY_CFG[t.priority].color }}>
                              {PRIORITY_CFG[t.priority].label}
                            </Text>
                          </View>
                        )}
                        {isLate && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <Ionicons name="warning" size={10} color={C.open} />
                            <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.open }}>
                              {formatDate(t.deadline)}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={aStyles.taskTitle}>{t.title}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                        <Ionicons name="people-outline" size={11} color={C.textMuted} />
                        <Text style={aStyles.taskMeta}>{t.assignee}</Text>
                        {co && (
                          <>
                            <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: C.textMuted }} />
                            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: co.color }} />
                            <Text style={[aStyles.taskMeta, { color: co.color }]}>{co.shortName}</Text>
                          </>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <View style={aStyles.progressBg}>
                          <View style={[aStyles.progressFill, { width: `${t.progress}%` as any, backgroundColor: cfg.color }]} />
                        </View>
                        <Text style={[aStyles.progressText, { color: cfg.color }]}>{t.progress}%</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={C.textMuted} style={{ marginLeft: 10 }} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

// ─── GanttView — Gantt tab ───────────────────────────────────────────────────

const G_LABEL = 130;
const G_CO_H = 30;
const G_TASK_H = 40;
const G_HEADER_H = 32;
const G_MILESTONE_H = 22;
const DAY_W: Record<Granularity, number> = { week: 26, month: 9 };

function GanttView({ tasks, onTaskPress }: { tasks: Task[]; onTaskPress: (id: string) => void }) {
  const { companies, chantiers } = useApp();
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const today = useMemo(() => sod(new Date()), []);
  const DPX = DAY_W[granularity];

  const grouped = useMemo(() => {
    const coMap = new Map<string, { co: typeof companies[0] | null; items: { task: Task; start: Date; end: Date }[] }>();
    for (const t of tasks) {
      const co = companies.find(c => c.id === t.company || c.name === t.company);
      const key = co?.id ?? t.company ?? '__none';
      if (!coMap.has(key)) coMap.set(key, { co: co ?? null, items: [] });
      const end = sod(parseDeadline(t.deadline) ?? addDays(today, 7));
      const start = sod(getTaskStartDate(t));
      coMap.get(key)!.items.push({ task: t, start, end });
    }
    return [...coMap.entries()]
      .map(([key, { co, items }]) => ({
        key, co,
        items: items.sort((a, b) => a.start.getTime() - b.start.getTime()),
      }))
      .sort((a, b) => (a.co?.name ?? a.key).localeCompare(b.co?.name ?? b.key));
  }, [tasks, companies, today]);

  const { minDate, maxDate } = useMemo(() => {
    const dates: number[] = [today.getTime()];
    for (const { items } of grouped) {
      for (const { start, end } of items) dates.push(start.getTime(), end.getTime());
    }
    for (const ch of chantiers) {
      if (ch.startDate) { const d = parseDeadline(ch.startDate); if (d) dates.push(d.getTime()); }
      if (ch.endDate) { const d = parseDeadline(ch.endDate); if (d) dates.push(d.getTime()); }
    }
    const minD = sod(new Date(Math.min(...dates)));
    minD.setDate(minD.getDate() - 4);
    const maxD = sod(new Date(Math.max(...dates)));
    maxD.setDate(maxD.getDate() + 6);
    return { minDate: minD, maxDate: maxD };
  }, [grouped, chantiers, today]);

  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000);
  const totalW = totalDays * DPX;

  function dx(d: Date): number {
    return Math.floor((sod(d).getTime() - minDate.getTime()) / 86400000) * DPX;
  }

  const todayX = dx(today);

  const markers = useMemo(() => {
    const result: { label: string; x: number }[] = [];
    if (granularity === 'week') {
      const cur = new Date(minDate);
      while (cur.getDay() !== 1) cur.setDate(cur.getDate() + 1);
      while (cur <= maxDate) {
        result.push({ label: `${cur.getDate()} ${MONTHS_FR[cur.getMonth()]}`, x: dx(cur) });
        cur.setDate(cur.getDate() + 7);
      }
    } else {
      const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
      while (cur <= maxDate) {
        result.push({ label: `${MONTHS_FR[cur.getMonth()]} ${cur.getFullYear()}`, x: dx(cur) });
        cur.setMonth(cur.getMonth() + 1);
      }
    }
    return result;
  }, [granularity, minDate, maxDate, DPX]);

  const milestonesWithX = useMemo(() => {
    const list: { label: string; x: number; color: string; icon: string }[] = [];
    for (const ch of chantiers) {
      if (ch.startDate) {
        const d = parseDeadline(ch.startDate);
        if (d) list.push({ label: ch.name, x: dx(d), color: C.closed, icon: '▶' });
      }
      if (ch.endDate) {
        const d = parseDeadline(ch.endDate);
        if (d) list.push({ label: ch.name, x: dx(d), color: '#DC2626', icon: '◆' });
      }
    }
    return list;
  }, [chantiers, DPX, minDate]);

  const hasMilestones = milestonesWithX.length > 0;
  const headerH = G_HEADER_H + (hasMilestones ? G_MILESTONE_H : 0);

  const timelineContentH = headerH + grouped.reduce((h, g) => {
    return h + G_CO_H + (collapsed.has(g.key) ? 0 : g.items.length * G_TASK_H);
  }, 0);

  function toggleCollapse(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (grouped.length === 0) {
    return (
      <View style={gStyles.empty}>
        <Ionicons name="bar-chart-outline" size={40} color={C.textMuted} />
        <Text style={gStyles.emptyText}>Aucune tâche à afficher</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={gStyles.granRow}>
        <Text style={gStyles.granLabel}>Échelle :</Text>
        {(['week', 'month'] as Granularity[]).map(g => (
          <TouchableOpacity
            key={g}
            style={[gStyles.granBtn, granularity === g && gStyles.granBtnActive]}
            onPress={() => setGranularity(g)}
          >
            <Text style={[gStyles.granBtnText, granularity === g && gStyles.granBtnTextActive]}>
              {g === 'week' ? 'Semaine' : 'Mois'}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <Text style={gStyles.scrollHint}>← Défiler →</Text>
      </View>

      <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: C.border, borderRadius: 10, overflow: 'hidden' }}>
        {/* Fixed left label column */}
        <View style={{ width: G_LABEL, borderRightWidth: 1, borderRightColor: C.border, backgroundColor: C.surface }}>
          <View style={[gStyles.leftHeader, { height: headerH }]}>
            <Text style={gStyles.leftHeaderText}>ENTREPRISES / TÂCHES</Text>
          </View>
          {grouped.map(({ key, co, items }) => {
            const color = co?.color ?? C.primary;
            const name = co?.shortName ?? co?.name ?? 'Sans entreprise';
            const isCollapsed = collapsed.has(key);
            return (
              <View key={key}>
                <TouchableOpacity
                  style={[gStyles.coLabelRow, { backgroundColor: color + '18', borderLeftColor: color }]}
                  onPress={() => toggleCollapse(key)}
                  activeOpacity={0.7}
                >
                  <View style={[gStyles.coDot, { backgroundColor: color }]} />
                  <Text style={[gStyles.coName, { color, flex: 1 }]} numberOfLines={1}>{name}</Text>
                  <Ionicons name={isCollapsed ? 'chevron-down' : 'chevron-up'} size={11} color={color} />
                </TouchableOpacity>
                {!isCollapsed && items.map(({ task: t }) => (
                  <TouchableOpacity
                    key={t.id}
                    style={gStyles.taskLabelRow}
                    onPress={() => onTaskPress(t.id)}
                    activeOpacity={0.75}
                  >
                    <View style={[gStyles.taskDot, { backgroundColor: STATUS_CFG[t.status].color }]} />
                    <Text style={gStyles.taskLabelText} numberOfLines={2}>{t.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
        </View>

        {/* Scrollable timeline */}
        <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ flex: 1 }} bounces={false}>
          <View style={{ width: totalW + 20, minHeight: timelineContentH, position: 'relative', backgroundColor: C.surface }}>
            {/* Today vertical line */}
            {todayX >= 0 && todayX <= totalW && (
              <View style={[gStyles.todayLine, { left: todayX, height: timelineContentH }]} />
            )}
            {/* Week separators */}
            {granularity === 'week' && markers.map((m, i) => (
              <View key={i} style={[gStyles.weekSep, { left: m.x, height: timelineContentH }]} />
            ))}

            {/* Time axis */}
            <View style={[gStyles.timeHeader, { height: G_HEADER_H }]}>
              {markers.map((m, i) => (
                <View key={i} style={[gStyles.marker, { left: m.x }]}>
                  <Text style={gStyles.markerText}>{m.label}</Text>
                </View>
              ))}
            </View>

            {/* Milestones row */}
            {hasMilestones && (
              <View style={{ height: G_MILESTONE_H, borderBottomWidth: 1, borderBottomColor: C.border, position: 'relative' }}>
                {milestonesWithX.map((m, i) => (
                  <View key={i} style={[gStyles.milestonePin, { left: Math.max(0, m.x) }]}>
                    <Text style={[gStyles.milestoneIcon, { color: m.color }]}>{m.icon}</Text>
                    <Text style={[gStyles.milestoneText, { color: m.color }]} numberOfLines={1}>{m.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Groups */}
            {grouped.map(({ key, co, items }) => {
              const color = co?.color ?? C.primary;
              const isCollapsed = collapsed.has(key);
              return (
                <View key={key}>
                  <View style={[gStyles.coTimelineRow, { backgroundColor: color + '15', borderBottomColor: color + '40' }]} />
                  {!isCollapsed && items.map(({ task: t, start, end }) => {
                    const cfg = STATUS_CFG[t.status];
                    const left = Math.max(0, dx(start));
                    const rawW = Math.max(DPX * 1.5, (end.getTime() - start.getTime()) / 86400000 * DPX);
                    const progressW = rawW * (t.progress / 100);
                    return (
                      <View key={t.id} style={gStyles.taskTimeRow}>
                        <TouchableOpacity
                          style={[gStyles.bar, { left, width: rawW, backgroundColor: cfg.color + '22', borderColor: cfg.color }]}
                          onPress={() => onTaskPress(t.id)}
                          activeOpacity={0.75}
                        >
                          <View style={[gStyles.barFill, { width: progressW, backgroundColor: cfg.color + '55' }]} />
                          <Text style={[gStyles.barLabel, { color: cfg.color }]} numberOfLines={1}>{t.progress}%</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

// ─── GroupedList — Liste tab ──────────────────────────────────────────────────

function GroupedList({ tasks, groupBy, canEdit, onDelete, onPress }: {
  tasks: Task[];
  groupBy: GroupMode;
  canEdit: boolean;
  onDelete: (id: string, title: string) => void;
  onPress: (id: string) => void;
}) {
  const { companies } = useApp();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  type Group = { key: string; label: string; color: string; tasks: Task[] };

  const groups: Group[] = useMemo(() => {
    if (groupBy === 'company') {
      const coMap = new Map<string, Task[]>();
      for (const t of tasks) {
        const co = companies.find(c => c.id === t.company || c.name === t.company);
        const key = co?.id ?? t.company ?? '__none';
        if (!coMap.has(key)) coMap.set(key, []);
        coMap.get(key)!.push(t);
      }
      return [...coMap.entries()].map(([key, ts]) => {
        const co = companies.find(c => c.id === key);
        return {
          key,
          label: co?.name ?? ts[0]?.company ?? 'Sans entreprise',
          color: co?.color ?? C.textMuted,
          tasks: ts.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)),
        };
      }).sort((a, b) => a.label.localeCompare(b.label));
    }

    if (groupBy === 'priority') {
      const ORDER = ['critical', 'high', 'medium', 'low'] as const;
      return ORDER.map(p => ({
        key: p,
        label: PRIORITY_CFG[p]?.label ?? p,
        color: PRIORITY_CFG[p]?.color ?? C.textMuted,
        tasks: tasks.filter(t => t.priority === p),
      })).filter(g => g.tasks.length > 0);
    }

    const ORDER: TaskStatus[] = ['delayed', 'in_progress', 'todo', 'done'];
    return ORDER.map(s => ({
      key: s,
      label: STATUS_CFG[s].label,
      color: STATUS_CFG[s].color,
      tasks: tasks.filter(t => t.status === s),
    })).filter(g => g.tasks.length > 0);
  }, [tasks, groupBy, companies]);

  function toggleCollapse(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (groups.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="checkmark-done-outline" size={40} color={C.textMuted} />
        <Text style={styles.emptyText}>Aucune tâche dans cette catégorie</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      {groups.map(g => {
        const isCollapsed = collapsed.has(g.key);
        return (
          <View key={g.key}>
            <TouchableOpacity
              style={[lStyles.groupHeader, { borderLeftColor: g.color, backgroundColor: g.color + '10' }]}
              onPress={() => toggleCollapse(g.key)}
              activeOpacity={0.75}
            >
              <View style={[lStyles.groupDot, { backgroundColor: g.color }]} />
              <Text style={[lStyles.groupLabel, { color: g.color, flex: 1 }]}>{g.label}</Text>
              <View style={[lStyles.groupCount, { backgroundColor: g.color + '20' }]}>
                <Text style={[lStyles.groupCountText, { color: g.color }]}>{g.tasks.length}</Text>
              </View>
              <Ionicons name={isCollapsed ? 'chevron-down' : 'chevron-up'} size={14} color={g.color} />
            </TouchableOpacity>
            {!isCollapsed && (
              <View style={{ gap: 8, marginTop: 8 }}>
                {g.tasks.map(t => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    canEdit={canEdit}
                    onDelete={() => onDelete(t.id, t.title)}
                    onPress={() => onPress(t.id)}
                  />
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlanningScreen() {
  const { tasks, deleteTask, companies } = useApp();
  const { permissions } = useAuth();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [groupMode, setGroupMode] = useState<GroupMode>('company');
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all');
  const [filterCompany, setFilterCompany] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const delayed = tasks.filter(t => t.status === 'delayed').length;
  const inP = tasks.filter(t => t.status === 'in_progress').length;

  const activeCompanies = useMemo(() =>
    companies.filter(co =>
      tasks.some(t =>
        (t.company === co.id || t.company === co.name) &&
        (t.status === 'in_progress' || t.status === 'delayed')
      )
    ).length,
    [companies, tasks]
  );

  const avgProgress = useMemo(() => {
    const active = tasks.filter(t => t.status !== 'done');
    if (active.length === 0) return tasks.length > 0 ? 100 : 0;
    return Math.round(active.reduce((s, t) => s + t.progress, 0) / active.length);
  }, [tasks]);

  const filtered = useMemo(() => {
    let list = filterStatus === 'all' ? tasks : tasks.filter(t => t.status === filterStatus);
    if (filterCompany !== 'all') {
      list = list.filter(t => {
        const co = companies.find(c => c.id === t.company || c.name === t.company);
        return (co?.id ?? t.company) === filterCompany;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.assignee.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [tasks, filterStatus, filterCompany, search, companies]);

  function handleDelete(id: string, title: string) {
    Alert.alert('Supprimer', `Supprimer la tâche "${title}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteTask(id) },
    ]);
  }

  const VIEW_TABS = [
    { key: 'list' as const, label: 'Liste', icon: 'list-outline' },
    { key: 'calendar' as const, label: 'Agenda', icon: 'today-outline' },
    { key: 'gantt' as const, label: 'Gantt', icon: 'reorder-four-outline' },
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

      {/* View mode tabs + search toggle */}
      <View style={styles.viewToggle}>
        {VIEW_TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.toggleBtn, viewMode === tab.key && styles.toggleBtnActive]}
            onPress={() => setViewMode(tab.key)}
          >
            <Ionicons name={tab.icon as any} size={15} color={viewMode === tab.key ? C.primary : C.textSub} />
            <Text style={[styles.toggleLabel, viewMode === tab.key && styles.toggleLabelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.searchToggleBtn, (showSearch || search.length > 0) && styles.searchToggleBtnActive]}
          onPress={() => { setShowSearch(v => !v); if (showSearch) setSearch(''); }}
          hitSlop={6}
        >
          <Ionicons
            name={showSearch || search.length > 0 ? 'close' : 'search-outline'}
            size={17}
            color={(showSearch || search.length > 0) ? C.primary : C.textSub}
          />
        </TouchableOpacity>
      </View>

      {/* Search bar — dépliable */}
      {(showSearch || search.length > 0) && (
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={15} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher une tâche..."
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoFocus
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* KPIs terrain — orientés entreprise */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderTopColor: C.primary }]}>
            <Text style={[styles.statVal, { color: C.primary }]}>{activeCompanies}</Text>
            <Text style={styles.statLabel}>Entreprises{'\n'}actives</Text>
          </View>

          <TouchableOpacity
            style={[styles.statCard, { borderTopColor: C.waiting }, filterStatus === 'delayed' && { borderColor: C.waiting + '40', backgroundColor: C.waiting + '08' }]}
            onPress={() => setFilterStatus(filterStatus === 'delayed' ? 'all' : 'delayed')}
          >
            <Text style={[styles.statVal, { color: delayed > 0 ? C.waiting : C.textMuted }]}>{delayed}</Text>
            <Text style={styles.statLabel}>En{'\n'}retard</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.statCard, { borderTopColor: C.inProgress }, filterStatus === 'in_progress' && { borderColor: C.inProgress + '40', backgroundColor: C.inProgress + '08' }]}
            onPress={() => setFilterStatus(filterStatus === 'in_progress' ? 'all' : 'in_progress')}
          >
            <Text style={[styles.statVal, { color: C.inProgress }]}>{inP}</Text>
            <Text style={styles.statLabel}>En{'\n'}cours</Text>
          </TouchableOpacity>

          <View style={[styles.statCard, { borderTopColor: C.closed }]}>
            <Text style={[styles.statVal, { color: avgProgress >= 80 ? C.closed : avgProgress >= 40 ? C.inProgress : C.textMuted }]}>
              {avgProgress}%
            </Text>
            <Text style={styles.statLabel}>Avance{'\n'}moy.</Text>
          </View>
        </View>

        {/* Company filter chips */}
        {companies.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={styles.companyFilterRow}>
              <TouchableOpacity
                style={[styles.companyChip, filterCompany === 'all' && styles.companyChipActive]}
                onPress={() => setFilterCompany('all')}
              >
                <Text style={[styles.companyChipText, filterCompany === 'all' && styles.companyChipTextActive]}>Toutes</Text>
              </TouchableOpacity>
              {companies.map(co => (
                <TouchableOpacity
                  key={co.id}
                  style={[styles.companyChip, filterCompany === co.id && { borderColor: co.color, backgroundColor: co.color + '15' }]}
                  onPress={() => setFilterCompany(filterCompany === co.id ? 'all' : co.id)}
                >
                  <View style={[styles.companyDot, { backgroundColor: co.color }]} />
                  <Text style={[styles.companyChipText, filterCompany === co.id && { color: co.color }]}>{co.shortName}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}

        {/* ── LISTE ── */}
        {viewMode === 'list' && (
          <>
            <View style={lStyles.modeBar}>
              {([
                { key: 'company' as const, label: 'Entreprise', icon: 'business-outline' },
                { key: 'priority' as const, label: 'Priorité', icon: 'flag-outline' },
              ]).map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[lStyles.modeBtn, groupMode === opt.key && lStyles.modeBtnActive]}
                  onPress={() => setGroupMode(opt.key)}
                >
                  <Ionicons name={opt.icon as any} size={12} color={groupMode === opt.key ? C.primary : C.textSub} />
                  <Text style={[lStyles.modeBtnText, groupMode === opt.key && lStyles.modeBtnTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <GroupedList
              tasks={filtered}
              groupBy={groupMode}
              canEdit={permissions.canEdit}
              onDelete={handleDelete}
              onPress={(id) => router.push(`/task/${id}` as any)}
            />
          </>
        )}

        {/* ── AGENDA ── */}
        {viewMode === 'calendar' && (
          <View style={styles.card}>
            <AgendaView tasks={filtered} onTaskPress={(id) => router.push(`/task/${id}` as any)} />
          </View>
        )}

        {/* ── GANTT ── */}
        {viewMode === 'gantt' && (
          <View style={styles.card}>
            <GanttView tasks={filtered} onTaskPress={(id) => router.push(`/task/${id}` as any)} />
          </View>
        )}
      </ScrollView>
      <BottomNavBar />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const aStyles = StyleSheet.create({
  empty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textMuted },
  emptyHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  emptyToday: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 14,
    backgroundColor: C.surface2, borderRadius: 10, marginTop: 8,
    borderWidth: 1, borderColor: C.border,
  },
  emptyTodayText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, flex: 1 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 9, paddingHorizontal: 14,
    borderRadius: 10, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
  },
  sectionHeaderOverdue: { backgroundColor: '#FEF2F2', borderColor: C.open + '50' },
  sectionHeaderToday: { backgroundColor: C.primaryBg, borderColor: C.primary + '50' },
  sectionHeaderText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, flex: 1 },
  todayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  taskRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: C.border, borderLeftWidth: 4,
  },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusPillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  taskTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  taskMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  progressBg: { flex: 1, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  progressText: { fontSize: 11, fontFamily: 'Inter_700Bold', minWidth: 30, textAlign: 'right' },
});

const lStyles = StyleSheet.create({
  modeBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 14, flexWrap: 'wrap',
  },
  modeBarLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginRight: 2 },
  modeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  modeBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  modeBtnText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
  modeBtnTextActive: { color: C.primary },
  groupHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1, borderColor: C.border, borderLeftWidth: 4,
  },
  groupDot: { width: 9, height: 9, borderRadius: 5 },
  groupLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  groupCount: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  groupCountText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
});

const gStyles = StyleSheet.create({
  empty: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted },
  granRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  granLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  granBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  granBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  granBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  granBtnTextActive: { color: C.primary },
  scrollHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  todayLine: { position: 'absolute', top: 0, width: 2, backgroundColor: C.open + '80', zIndex: 10 },
  weekSep: { position: 'absolute', top: 0, width: 1, backgroundColor: C.border, zIndex: 1 },
  timeHeader: { position: 'relative', borderBottomWidth: 1, borderBottomColor: C.border },
  marker: { position: 'absolute', top: 8 },
  markerText: {
    fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    backgroundColor: C.surface, paddingHorizontal: 2,
  },
  milestonePin: { position: 'absolute', top: 3, flexDirection: 'row', alignItems: 'center', gap: 2 },
  milestoneIcon: { fontSize: 9, fontFamily: 'Inter_700Bold' },
  milestoneText: { fontSize: 9, fontFamily: 'Inter_500Medium', maxWidth: 80 },
  leftHeader: {
    borderBottomWidth: 1, borderBottomColor: C.border,
    justifyContent: 'flex-end', paddingHorizontal: 8, paddingBottom: 6,
  },
  leftHeaderText: { fontSize: 9, fontFamily: 'Inter_600SemiBold', color: C.textMuted, letterSpacing: 0.5 },
  coLabelRow: {
    height: G_CO_H, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, borderLeftWidth: 3,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  coDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  coName: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  coTimelineRow: {
    height: G_CO_H, borderBottomWidth: 1, position: 'relative',
  },
  taskLabelRow: {
    height: G_TASK_H, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingLeft: 16,
    borderBottomWidth: 1, borderBottomColor: C.border + '60',
  },
  taskDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  taskLabelText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.text, flex: 1 },
  taskTimeRow: {
    height: G_TASK_H, position: 'relative',
    borderBottomWidth: 1, borderBottomColor: C.border + '60',
  },
  bar: {
    position: 'absolute', top: 8, height: 26, borderRadius: 6,
    borderWidth: 1, overflow: 'hidden', justifyContent: 'center', minWidth: 32,
  },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 6 },
  barLabel: { paddingHorizontal: 6, fontSize: 10, fontFamily: 'Inter_700Bold', zIndex: 1 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  viewToggle: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface,
  },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 8, borderRadius: 10, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
  },
  toggleBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  toggleLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  toggleLabelActive: { color: C.primary },
  searchToggleBtn: {
    width: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border, paddingVertical: 8,
  },
  searchToggleBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  content: { padding: 16, paddingBottom: 40 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 10,
    borderTopWidth: 3, borderWidth: 1, borderColor: C.border, alignItems: 'center',
  },
  statVal: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2, textAlign: 'center' },
  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    marginBottom: 16, borderWidth: 1, borderColor: C.border,
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, marginBottom: 12, gap: 8,
  },
  searchInput: { flex: 1, height: 42, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary,
    marginLeft: 4,
  },
  addBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  taskCard: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 4,
  },
  taskTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  taskPct: { fontSize: 12, fontFamily: 'Inter_700Bold', minWidth: 32, textAlign: 'right' },
  taskTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 6 },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  taskMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  taskProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskBarBg: { height: 5, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  taskBarFill: { height: 5, borderRadius: 3 },
  deadlinePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1,
  },
  deadlinePillNormal: { backgroundColor: C.surface2, borderColor: C.border },
  deadlinePillSoon: { backgroundColor: C.waiting + '15', borderColor: C.waiting + '60' },
  deadlinePillOverdue: { backgroundColor: C.open + '12', borderColor: C.open + '50' },
  deadlinePillText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted },
  companyFilterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 2, alignItems: 'center' },
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  companyChipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  companyChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  companyChipTextActive: { color: C.primary },
  companyDot: { width: 7, height: 7, borderRadius: 4 },
});
