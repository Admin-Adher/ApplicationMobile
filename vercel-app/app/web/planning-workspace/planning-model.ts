export const PLANNING_SCHEDULE_BATCH_SIZE = 18;

export type PlanningTaskMode = 'week' | 'company' | 'late';
export type PlanningScheduleFilter = 'all' | 'late' | 'reserve' | 'visit';
export type PlanningScheduleKind = 'reserve' | 'visit';

export type PlanningScheduleEntry = {
  id: string;
  kind: PlanningScheduleKind;
  title: string;
  date: Date | null;
  dateKey: string;
  sortTime: number;
  status: string;
  meta: string;
  searchText: string;
  isLate: boolean;
  isToday: boolean;
  source: any;
};

export type PlanningScheduleGroup = {
  key: string;
  label: string;
  relativeLabel: string;
  entries: PlanningScheduleEntry[];
};

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function parsePlanningDate(value?: string | null) {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localDateKey(value: Date | null) {
  if (!value) return 'undated';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeSearchText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function daysBetween(date: Date, now: Date) {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((startOfLocalDay(date).getTime() - startOfLocalDay(now).getTime()) / dayMs);
}

function planningEntry({
  id,
  kind,
  title,
  dateValue,
  status,
  meta,
  source,
  now,
}: {
  id: string;
  kind: PlanningScheduleKind;
  title: string;
  dateValue?: string | null;
  status?: string | null;
  meta: string;
  source: any;
  now: Date;
}): PlanningScheduleEntry {
  const date = parsePlanningDate(dateValue);
  const dayDifference = date ? daysBetween(date, now) : Number.POSITIVE_INFINITY;
  const searchText = normalizeSearchText([title, status, meta, id].filter(Boolean).join(' '));
  return {
    id,
    kind,
    title,
    date,
    dateKey: localDateKey(date),
    sortTime: date?.getTime() ?? Number.MAX_SAFE_INTEGER,
    status: status ?? '',
    meta,
    searchText,
    isLate: dayDifference < 0,
    isToday: dayDifference === 0,
    source,
  };
}

export function buildPlanningSchedule(visites: any[], reserves: any[], now = new Date()) {
  const today = startOfLocalDay(now);
  const visits = visites
    .filter(visit => {
      const date = parsePlanningDate(visit.date);
      return date ? startOfLocalDay(date) >= today : visit.status !== 'completed';
    })
    .map(visit => planningEntry({
      id: `visit-${visit.id}`,
      kind: 'visit',
      title: visit.title || 'Visite chantier',
      dateValue: visit.date,
      status: visit.status,
      meta: [visit.building, visit.level].filter(Boolean).join(' · ') || 'Périmètre chantier',
      source: visit,
      now,
    }));

  const deadlines = reserves
    .filter(reserve => reserve.deadline && reserve.status !== 'closed')
    .map(reserve => planningEntry({
      id: `reserve-${reserve.id}`,
      kind: 'reserve',
      title: reserve.title || reserve.id || 'Réserve',
      dateValue: reserve.deadline,
      status: reserve.status,
      meta: [reserve.id, reserve.company, reserve.building, reserve.level].filter(Boolean).join(' · '),
      source: reserve,
      now,
    }));

  return [...visits, ...deadlines].sort((a, b) => a.sortTime - b.sortTime || a.title.localeCompare(b.title, 'fr'));
}

export function filterPlanningSchedule(
  entries: PlanningScheduleEntry[],
  filter: PlanningScheduleFilter,
  query: string,
) {
  const normalizedQuery = normalizeSearchText(query);
  return entries.filter(entry => {
    if (filter === 'late' && !entry.isLate) return false;
    if (filter === 'reserve' && entry.kind !== 'reserve') return false;
    if (filter === 'visit' && entry.kind !== 'visit') return false;
    return !normalizedQuery || entry.searchText.includes(normalizedQuery);
  });
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function formatPlanningDayLabel(date: Date | null, locale: string, now = new Date()) {
  if (!date) return { label: 'Sans date', relativeLabel: 'À planifier' };
  const difference = daysBetween(date, now);
  const label = capitalize(new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date));
  if (difference === 0) return { label, relativeLabel: 'Aujourd’hui' };
  if (difference === 1) return { label, relativeLabel: 'Demain' };
  if (difference < 0) return { label, relativeLabel: 'En retard' };
  return { label, relativeLabel: 'À venir' };
}

export function groupPlanningSchedule(entries: PlanningScheduleEntry[], locale = 'fr-FR', now = new Date()) {
  const groups = new Map<string, PlanningScheduleGroup>();
  entries.forEach(entry => {
    const existing = groups.get(entry.dateKey);
    if (existing) {
      existing.entries.push(entry);
      return;
    }
    const heading = formatPlanningDayLabel(entry.date, locale, now);
    groups.set(entry.dateKey, {
      key: entry.dateKey,
      label: heading.label,
      relativeLabel: heading.relativeLabel,
      entries: [entry],
    });
  });
  return [...groups.values()];
}

export function getPlanningWeekRange(now = new Date(), locale = 'fr-FR') {
  const start = startOfLocalDay(now);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const formatter = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  return {
    start,
    end,
    endExclusive: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1),
    label: `${formatter.format(start)} — ${formatter.format(end)}`,
  };
}

export function isPlanningTaskLate(task: any, now = new Date()) {
  const status = String(task?.status ?? '');
  if (['done', 'completed', 'closed'].includes(status)) return false;
  if (status === 'delayed') return true;
  if (!task.deadline) return false;
  const deadline = parsePlanningDate(task.deadline);
  return Boolean(deadline && startOfLocalDay(deadline) < startOfLocalDay(now));
}

export function filterPlanningTasks(tasks: any[], mode: PlanningTaskMode, now = new Date()) {
  const week = getPlanningWeekRange(now);
  return [...tasks]
    .sort((a, b) => (parsePlanningDate(a.deadline)?.getTime() ?? 0) - (parsePlanningDate(b.deadline)?.getTime() ?? 0))
    .filter(task => {
      if (mode === 'late') return isPlanningTaskLate(task, now);
      if (mode === 'week') {
        const deadline = parsePlanningDate(task.deadline);
        return deadline ? deadline >= week.start && deadline < week.endExclusive : task.status !== 'done';
      }
      return true;
    });
}

export function groupPlanningTasks(tasks: any[], companies: any[], mode: PlanningTaskMode) {
  if (mode !== 'company') return [['Tâches', tasks]] as Array<[string, any[]]>;
  const grouped = tasks.reduce((acc: Record<string, any[]>, task: any) => {
    const key = companies.find(company => company.id === task.company || company.name === task.company)?.name
      ?? task.company
      ?? 'Sans entreprise';
    acc[key] = [...(acc[key] ?? []), task];
    return acc;
  }, {});
  return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b, 'fr'));
}
