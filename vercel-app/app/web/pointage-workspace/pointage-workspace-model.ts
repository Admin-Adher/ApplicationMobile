import { attendanceMinutes, attendanceHoursText, attendanceCsv } from '../../../../lib/attendanceMath';

export type TimeEntrySource = {
  id?: string | null;
  date?: string | null;
  worker_name?: string | null;
  workerName?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  company_color?: string | null;
  arrival_time?: string | null;
  departure_time?: string | null;
  notes?: string | null;
  [key: string]: unknown;
};

export type TimeEntrySummary = {
  id: string;
  date: string;
  workerName: string;
  companyId: string;
  companyName: string;
  companyColor: string;
  arrivalTime: string;
  departureTime: string;
  notes: string;
  durationMinutes: number;
  status: 'present' | 'departed';
  source: TimeEntrySource;
};

export type PointageWorkspaceModel = {
  dayEntries: TimeEntrySummary[];
  presentEntries: TimeEntrySummary[];
  departedEntries: TimeEntrySummary[];
  uniqueCompanies: number;
  completedMinutes: number;
  totalEntries: number;
};

function safeText(value: unknown) {
  return String(value ?? '').trim();
}

function safeIsoDate(value: unknown) {
  const text = safeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function safeTime(value: unknown) {
  const text = safeText(value);
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? text : '';
}

export function calculateAttendanceDuration(arrivalTime: string, departureTime: string) {
  return attendanceMinutes(arrivalTime, departureTime);
}

export function summarizeTimeEntry(entry: TimeEntrySource): TimeEntrySummary {
  const departureTime = safeTime(entry.departure_time);
  const arrivalTime = safeTime(entry.arrival_time) || '08:00';
  const workerName = safeText(entry.worker_name ?? entry.workerName) || 'Compagnon non renseigné';
  const date = safeIsoDate(entry.date);
  return {
    id: safeText(entry.id) || `${date}:${workerName}:${arrivalTime}`,
    date,
    workerName,
    companyId: safeText(entry.company_id),
    companyName: safeText(entry.company_name) || 'Sans entreprise',
    companyColor: safeText(entry.company_color) || '#003082',
    arrivalTime,
    departureTime,
    notes: safeText(entry.notes),
    durationMinutes: calculateAttendanceDuration(arrivalTime, departureTime),
    status: departureTime ? 'departed' : 'present',
    source: entry,
  };
}

function byArrival(left: TimeEntrySummary, right: TimeEntrySummary) {
  return left.arrivalTime.localeCompare(right.arrivalTime) || left.workerName.localeCompare(right.workerName, 'fr-FR');
}

function byDepartureDescending(left: TimeEntrySummary, right: TimeEntrySummary) {
  return right.departureTime.localeCompare(left.departureTime) || byArrival(left, right);
}

export function buildPointageWorkspaceModel(
  entries: TimeEntrySource[],
  selectedDate: string,
): PointageWorkspaceModel {
  const summaries = entries.map(summarizeTimeEntry);
  const dayEntries = summaries.filter(entry => entry.date === selectedDate);
  const presentEntries = dayEntries.filter(entry => entry.status === 'present').sort(byArrival);
  const departedEntries = dayEntries.filter(entry => entry.status === 'departed').sort(byDepartureDescending);
  const companyKeys = new Set(dayEntries.map(entry => entry.companyId || entry.companyName).filter(Boolean));

  return {
    dayEntries: [...presentEntries, ...departedEntries],
    presentEntries,
    departedEntries,
    uniqueCompanies: companyKeys.size,
    completedMinutes: departedEntries.reduce((total, entry) => total + entry.durationMinutes, 0),
    totalEntries: summaries.length,
  };
}

export function formatAttendanceDuration(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 h';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours} h`;
  return `${hours} h ${String(remainder).padStart(2, '0')}`;
}

export function formatAttendanceDate(value: string, locale = 'fr-FR', long = false) {
  const normalized = safeIsoDate(value);
  if (!normalized) return 'Date non renseignée';
  const date = new Date(`${normalized}T12:00:00`);
  if (Number.isNaN(date.getTime())) return 'Date non renseignée';
  return new Intl.DateTimeFormat(locale, long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function shiftAttendanceDate(value: string, offset: number) {
  const normalized = safeIsoDate(value);
  if (!normalized || !Number.isFinite(offset)) return value;
  const date = new Date(`${normalized}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() + Math.trunc(offset));
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function buildWeeklyAttendanceCsv(entries: TimeEntrySource[], selectedDate: string, locale = 'fr-FR') {
  const date = new Date(selectedDate + 'T12:00:00');
  if (!safeIsoDate(selectedDate) || !Number.isFinite(date.getTime())) return null;
  const weekStart = shiftAttendanceDate(selectedDate, -((date.getDay() + 6) % 7));
  const weekEnd = shiftAttendanceDate(weekStart, 6);
  const summaries = entries.map(summarizeTimeEntry)
    .filter(entry => entry.date >= weekStart && entry.date <= weekEnd)
    .sort((left, right) => left.date.localeCompare(right.date) || byArrival(left, right));
  if (!summaries.length) return null;

  const formatDate = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const header = ['Date', 'Compagnon', 'Entreprise', 'Arrivée', 'Départ', 'Heures', 'Tâche', 'Enregistré par', 'Notes'];
  const rows = summaries.map(entry => [
    formatDate.format(new Date(entry.date + 'T12:00:00')), entry.workerName, entry.companyName,
    entry.arrivalTime, entry.departureTime, entry.departureTime ? attendanceHoursText(entry.durationMinutes / 60, locale) : '',
    entry.source.task_title, entry.source.recorded_by, entry.notes,
  ]);
  return {
    csv: attendanceCsv([header, ...rows]),
    filename: 'Pointage_' + weekStart + '_' + weekEnd + '.csv',
  };
}
