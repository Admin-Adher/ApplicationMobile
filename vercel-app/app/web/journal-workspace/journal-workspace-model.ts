export type JournalFilter = 'all' | 'recent' | 'incidents';

export type JournalEntrySource = {
  id: string;
  date: string;
  weather?: string | null;
  weatherTemp?: number | string | null;
  weatherWind?: number | string | null;
  workerCount?: number | string | null;
  workDone?: string | null;
  materials?: string | null;
  incidents?: string | null;
  observations?: string | null;
  visitors?: string | null;
  author?: string | null;
  createdAt?: string | null;
  chantierId?: string | null;
};

export type JournalEntrySummary = {
  id: string;
  date: string;
  weather: string;
  workerCount: number;
  workDone: string;
  materials: string;
  incidents: string;
  observations: string;
  visitors: string;
  author: string;
  source: JournalEntrySource;
};

export type JournalWorkspaceModel = {
  entries: JournalEntrySummary[];
  todayEntries: JournalEntrySummary[];
  todayEntry: JournalEntrySummary | null;
  totalWorkers: number;
  incidentDays: number;
  monthEntries: number;
  counts: Record<JournalFilter, number>;
};

function safeText(value: unknown) {
  return String(value ?? '').trim();
}

function safeCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
}

function isoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function dateFromIso(value: string) {
  const normalized = isoDate(value);
  if (!normalized) return null;
  const date = new Date(`${normalized}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function recentCutoff(today: string) {
  const date = dateFromIso(today);
  if (!date) return '';
  date.setDate(date.getDate() - 6);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function summarizeJournalEntry(entry: JournalEntrySource): JournalEntrySummary {
  return {
    id: safeText(entry.id),
    date: isoDate(safeText(entry.date)),
    weather: safeText(entry.weather),
    workerCount: safeCount(entry.workerCount),
    workDone: safeText(entry.workDone),
    materials: safeText(entry.materials),
    incidents: safeText(entry.incidents),
    observations: safeText(entry.observations),
    visitors: safeText(entry.visitors),
    author: safeText(entry.author),
    source: entry,
  };
}

export function isRecentJournalEntry(entry: JournalEntrySummary, today: string) {
  const cutoff = recentCutoff(today);
  return Boolean(cutoff && entry.date && entry.date >= cutoff && entry.date <= today);
}

export function buildJournalWorkspaceModel(entries: JournalEntrySource[], today: string): JournalWorkspaceModel {
  const summaries = entries
    .map(summarizeJournalEntry)
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  const todayEntries = summaries.filter(entry => entry.date === today);
  const monthPrefix = /^\d{4}-\d{2}/.test(today) ? today.slice(0, 7) : '';

  return {
    entries: summaries,
    todayEntries,
    todayEntry: todayEntries[0] ?? null,
    totalWorkers: summaries.reduce((sum, entry) => sum + entry.workerCount, 0),
    incidentDays: summaries.filter(entry => Boolean(entry.incidents)).length,
    monthEntries: monthPrefix ? summaries.filter(entry => entry.date.startsWith(monthPrefix)).length : 0,
    counts: {
      all: summaries.length,
      recent: summaries.filter(entry => isRecentJournalEntry(entry, today)).length,
      incidents: summaries.filter(entry => Boolean(entry.incidents)).length,
    },
  };
}

function searchableEntry(entry: JournalEntrySummary) {
  return [
    entry.date,
    entry.weather,
    entry.workDone,
    entry.materials,
    entry.incidents,
    entry.observations,
    entry.visitors,
    entry.author,
  ].join(' ').toLocaleLowerCase('fr-FR');
}

export function filterJournalEntries(
  entries: JournalEntrySummary[],
  filter: JournalFilter,
  query: string,
  today: string,
) {
  const needle = query.trim().toLocaleLowerCase('fr-FR');
  return entries.filter(entry => {
    if (filter === 'recent' && !isRecentJournalEntry(entry, today)) return false;
    if (filter === 'incidents' && !entry.incidents) return false;
    return !needle || searchableEntry(entry).includes(needle);
  });
}

export function countAttendanceForDate(entries: Array<Record<string, unknown>>, date: string) {
  return new Set(entries
    .filter(entry => safeText(entry.date) === date)
    .map(entry => safeText(entry.worker_name ?? entry.workerName))
    .filter(Boolean)).size;
}

export function formatJournalDate(value: string, long = false) {
  const date = dateFromIso(value);
  if (!date) return 'Date non renseignée';
  return new Intl.DateTimeFormat('fr-FR', long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function journalDateParts(value: string) {
  const date = dateFromIso(value);
  if (!date) return { weekday: 'Date', day: '—', month: 'inconnue' };
  return {
    weekday: new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(date).replace('.', ''),
    day: new Intl.DateTimeFormat('fr-FR', { day: '2-digit' }).format(date),
    month: new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' }).format(date).replace('.', ''),
  };
}
