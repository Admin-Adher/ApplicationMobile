export type IncidentStatus = 'open' | 'investigating' | 'resolved';

export type IncidentSeverity = 'minor' | 'moderate' | 'major' | 'critical';

export type IncidentFilter = 'all' | 'priority' | IncidentStatus;

export type IncidentSource = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  location?: string | null;
  building?: string | null;
  severity?: string | null;
  status?: string | null;
  reported_at?: string | null;
  created_at?: string | null;
  reported_by?: string | null;
  actions?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  [key: string]: unknown;
};

export type IncidentSummary = {
  id: string;
  title: string;
  description: string;
  location: string;
  building: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reportedAt: string;
  reportedBy: string;
  actions: string;
  closedAt: string;
  closedBy: string;
  source: IncidentSource;
};

export type IncidentsWorkspaceModel = {
  summaries: IncidentSummary[];
  counts: Record<IncidentFilter, number>;
  activeCount: number;
  criticalCount: number;
};

const SEVERITY_ORDER: Record<IncidentSeverity, number> = {
  critical: 0,
  major: 1,
  moderate: 2,
  minor: 3,
};

const STATUS_ORDER: Record<IncidentStatus, number> = {
  open: 0,
  investigating: 1,
  resolved: 2,
};

function safeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeSearchText(value: unknown) {
  return safeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizeIncidentStatus(value: unknown): IncidentStatus {
  const normalized = normalizeSearchText(value).replace(/[\s-]+/g, '_');
  if (['resolved', 'closed', 'done', 'completed'].includes(normalized)) return 'resolved';
  if (['investigating', 'in_progress', 'assigned', 'processing'].includes(normalized)) return 'investigating';
  return 'open';
}

export function normalizeIncidentSeverity(value: unknown): IncidentSeverity {
  const normalized = normalizeSearchText(value);
  if (['critical', 'critique'].includes(normalized)) return 'critical';
  if (['major', 'majeur', 'high', 'haute'].includes(normalized)) return 'major';
  if (['minor', 'mineur', 'low', 'faible'].includes(normalized)) return 'minor';
  return 'moderate';
}

export function summarizeIncident(incident: IncidentSource): IncidentSummary {
  const id = safeText(incident.id);
  const description = safeText(incident.description);
  const location = safeText(incident.location);
  const building = safeText(incident.building);
  const reportedAt = safeText(incident.reported_at ?? incident.created_at);
  return {
    id: id || `${reportedAt}:${safeText(incident.title) || description}`,
    title: safeText(incident.title) || description || id || 'Incident sans titre',
    description,
    location,
    building,
    severity: normalizeIncidentSeverity(incident.severity),
    status: normalizeIncidentStatus(incident.status),
    reportedAt,
    reportedBy: safeText(incident.reported_by),
    actions: safeText(incident.actions),
    closedAt: safeText(incident.closed_at),
    closedBy: safeText(incident.closed_by),
    source: incident,
  };
}

function compareIncidentPriority(left: IncidentSummary, right: IncidentSummary) {
  const leftResolved = left.status === 'resolved' ? 1 : 0;
  const rightResolved = right.status === 'resolved' ? 1 : 0;
  return leftResolved - rightResolved
    || SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
    || right.reportedAt.localeCompare(left.reportedAt)
    || left.title.localeCompare(right.title, 'fr-FR');
}

export function buildIncidentsWorkspaceModel(incidents: IncidentSource[]): IncidentsWorkspaceModel {
  const summaries = incidents.map(summarizeIncident).sort(compareIncidentPriority);
  const counts = summaries.reduce<Record<IncidentFilter, number>>((result, incident) => {
    result.all += 1;
    result[incident.status] += 1;
    if (incident.status !== 'resolved' && ['critical', 'major'].includes(incident.severity)) result.priority += 1;
    return result;
  }, { all: 0, priority: 0, open: 0, investigating: 0, resolved: 0 });

  return {
    summaries,
    counts,
    activeCount: counts.open + counts.investigating,
    criticalCount: summaries.filter(incident => incident.status !== 'resolved' && incident.severity === 'critical').length,
  };
}

export function filterIncidentSummaries(
  incidents: IncidentSummary[],
  filter: IncidentFilter,
  query: string,
) {
  const queryTokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  return incidents.filter(incident => {
    if (filter === 'priority' && (incident.status === 'resolved' || !['critical', 'major'].includes(incident.severity))) return false;
    if (!['all', 'priority'].includes(filter) && incident.status !== filter) return false;
    if (queryTokens.length === 0) return true;
    const searchableText = normalizeSearchText([
      incident.id,
      incident.title,
      incident.description,
      incident.location,
      incident.building,
      incident.reportedBy,
      incident.actions,
    ].join(' '));
    return queryTokens.every(token => searchableText.includes(token));
  });
}

export function formatIncidentDate(value: string, locale = 'fr-FR', includeTime = true) {
  const text = safeText(value);
  if (!text) return 'Date non renseignée';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00` : text);
  if (Number.isNaN(date.getTime())) return 'Date non renseignée';
  const hasTime = includeTime && /T\d{2}:\d{2}/.test(text);
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}
