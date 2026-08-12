export type DashboardRecord = Record<string, unknown>;

export type DashboardDestination =
  | 'reserves'
  | 'planning'
  | 'terrain'
  | 'plans'
  | 'visites'
  | 'messages';

export type DashboardSource = {
  projects: DashboardRecord[];
  plans: DashboardRecord[];
  companies: DashboardRecord[];
  messageCount: number;
  current: {
    reserves: DashboardRecord[];
    tasks: DashboardRecord[];
    incidents: DashboardRecord[];
    plansCount: number;
    visitsCount: number;
    documentsCount: number;
  };
};

export type DashboardPriorityItem = {
  id: string;
  kind: 'critical-reserve' | 'overdue-reserve' | 'late-task';
  title: string;
  building: string;
  company: string;
  deadline: Date | null;
  target: 'reserves' | 'planning';
};

export type DashboardWeek = {
  key: string;
  start: Date;
  created: number;
  closed: number;
};

export type DashboardBuilding = {
  key: string;
  name: string;
  selectable: boolean;
  total: number;
  pinned: number;
  overdue: number;
  open: number;
  closed: number;
};

export type DashboardCompany = {
  id: string;
  name: string;
  shortName: string;
  color: string;
  total: number;
  closed: number;
  overdue: number;
  rate: number;
  actualWorkers: number;
  plannedWorkers: number;
};

export type DashboardProject = {
  id: string;
  name: string;
  total: number;
  closed: number;
  overdue: number;
  progress: number;
};

export type DashboardModel = {
  projectName: string | null;
  totalCount: number;
  closedCount: number;
  remainingCount: number;
  overdueCount: number;
  criticalCount: number;
  lateTaskCount: number;
  openIncidentCount: number;
  pinnedCount: number;
  progress: number;
  statuses: {
    open: number;
    inProgress: number;
    waiting: number;
    verification: number;
    closed: number;
  };
  priorities: DashboardPriorityItem[];
  weeks: DashboardWeek[];
  buildings: DashboardBuilding[];
  companies: DashboardCompany[];
  portfolio: DashboardProject[];
  workforce: {
    actual: number;
    planned: number;
  };
  quick: {
    plans: number;
    visits: number;
    messages: number;
    documents: number;
  };
};

type DashboardModelOptions = {
  selectedProjectId: string;
  now?: Date;
};

function stringField(record: DashboardRecord | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

function numberField(record: DashboardRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function normalized(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function sameName(a: unknown, b: unknown) {
  return normalized(a) === normalized(b);
}

function parseDate(value: unknown) {
  if (!value) return null;
  const raw = String(value);
  const frenchMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  if (frenchMatch) {
    const parsed = new Date(
      Number(frenchMatch[3]),
      Number(frenchMatch[2]) - 1,
      Number(frenchMatch[1]),
      Number(frenchMatch[4] ?? 0),
      Number(frenchMatch[5] ?? 0),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function weekStart(value: Date) {
  const result = startOfDay(value);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function localDateKey(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function isArchived(reserve: DashboardRecord) {
  return Boolean(reserve.archived_at ?? reserve.archivedAt);
}

function isClosed(reserve: DashboardRecord) {
  return normalized(reserve.status) === 'closed';
}

function isOverdue(reserve: DashboardRecord, now: Date) {
  const status = normalized(reserve.status);
  if (!reserve.deadline || status === 'closed' || status === 'verification') return false;
  const deadline = parseDate(reserve.deadline);
  return Boolean(deadline && startOfDay(deadline) < startOfDay(now));
}

function isTaskLate(task: DashboardRecord, now: Date) {
  const status = normalized(task.status);
  if (['done', 'completed', 'closed'].includes(status)) return false;
  if (status === 'delayed') return true;
  const deadline = parseDate(task.deadline);
  return Boolean(deadline && startOfDay(deadline) < startOfDay(now));
}

function isIncidentOpen(incident: DashboardRecord) {
  return !['resolved', 'closed', 'done'].includes(normalized(incident.status));
}

function projectId(record: DashboardRecord) {
  return stringField(record, 'chantier_id', 'chantierId');
}

function reserveCompanies(reserve: DashboardRecord) {
  const values = [
    ...(Array.isArray(reserve.companies) ? reserve.companies : []),
    reserve.company,
    reserve.company_name,
    reserve.companyName,
  ]
    .map(value => String(value ?? '').trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function reservePlanId(reserve: DashboardRecord) {
  return stringField(reserve, 'plan_id', 'planId');
}

function hasPlanPin(reserve: DashboardRecord) {
  const rawX = reserve.plan_x ?? reserve.planX;
  const rawY = reserve.plan_y ?? reserve.planY;
  if (rawX === null || rawX === undefined || rawX === '' || rawY === null || rawY === undefined || rawY === '') return false;
  const x = Number(rawX);
  const y = Number(rawY);
  return Boolean(reservePlanId(reserve)) && Number.isFinite(x) && Number.isFinite(y);
}

function projectBuildings(project: DashboardRecord | null | undefined) {
  const value = project?.buildings;
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object') as DashboardRecord[];
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') as DashboardRecord[] : [];
  } catch {
    return [];
  }
}

function buildingNameById(project: DashboardRecord | null | undefined, buildingId: string) {
  if (!buildingId) return '';
  const building = projectBuildings(project).find(item => stringField(item, 'id') === buildingId);
  return stringField(building, 'name');
}

function buildingInfo(
  reserve: DashboardRecord,
  plansById: Map<string, DashboardRecord>,
  project: DashboardRecord | null,
) {
  const directId = stringField(reserve, 'building_id', 'buildingId');
  const directName = stringField(reserve, 'building_name', 'building', 'batiment');
  if (directId || directName) {
    const name = directName || buildingNameById(project, directId);
    return {
      key: directId ? `id:${directId}` : name ? `name:${normalized(name)}` : '__none__',
      name,
      selectable: Boolean(name),
    };
  }

  const plan = plansById.get(reservePlanId(reserve));
  if (plan) {
    const id = stringField(plan, 'building_id', 'buildingId');
    const name = buildingNameById(project, id) || stringField(plan, 'building_name', 'building', 'batiment');
    return {
      key: id ? `id:${id}` : name ? `name:${normalized(name)}` : '__none__',
      name,
      selectable: Boolean(name),
    };
  }

  return { key: '__none__', name: '', selectable: false };
}

function buildBuildings(
  reserves: DashboardRecord[],
  plansById: Map<string, DashboardRecord>,
  project: DashboardRecord | null,
  now: Date,
) {
  const groups = new Map<string, DashboardBuilding>();
  for (const reserve of reserves) {
    const info = buildingInfo(reserve, plansById, project);
    const current = groups.get(info.key) ?? {
      ...info,
      total: 0,
      pinned: 0,
      overdue: 0,
      open: 0,
      closed: 0,
    };
    current.total += 1;
    current.pinned += hasPlanPin(reserve) ? 1 : 0;
    current.overdue += isOverdue(reserve, now) ? 1 : 0;
    current.closed += isClosed(reserve) ? 1 : 0;
    current.open += isClosed(reserve) ? 0 : 1;
    groups.set(info.key, current);
  }
  return Array.from(groups.values()).sort((a, b) =>
    b.overdue - a.overdue || b.total - a.total || a.name.localeCompare(b.name),
  );
}

function buildWeeks(reserves: DashboardRecord[], now: Date) {
  const weeks = new Map<string, DashboardWeek>();
  for (let offset = 7; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - (offset * 7));
    const start = weekStart(date);
    weeks.set(localDateKey(start), { key: localDateKey(start), start, created: 0, closed: 0 });
  }

  for (const reserve of reserves) {
    const created = parseDate(reserve.created_at ?? reserve.createdAt ?? reserve.created);
    const closed = parseDate(reserve.closed_at ?? reserve.closedAt);
    if (created) {
      const bucket = weeks.get(localDateKey(weekStart(created)));
      if (bucket) bucket.created += 1;
    }
    if (closed) {
      const bucket = weeks.get(localDateKey(weekStart(closed)));
      if (bucket) bucket.closed += 1;
    }
  }
  return Array.from(weeks.values());
}

function buildCompanies(
  companies: DashboardRecord[],
  reserves: DashboardRecord[],
  now: Date,
) {
  return companies
    .map<DashboardCompany>(company => {
      const name = stringField(company, 'name');
      const companyReserves = reserves.filter(reserve =>
        reserveCompanies(reserve).some(value => sameName(value, name)),
      );
      const total = companyReserves.length;
      const closed = companyReserves.filter(isClosed).length;
      return {
        id: stringField(company, 'id') || name,
        name,
        shortName: stringField(company, 'short_name', 'shortName') || name,
        color: stringField(company, 'color') || '#003082',
        total,
        closed,
        overdue: companyReserves.filter(reserve => isOverdue(reserve, now)).length,
        rate: total ? Math.round((closed / total) * 100) : 0,
        actualWorkers: numberField(company, 'actual_workers', 'actualWorkers'),
        plannedWorkers: numberField(company, 'planned_workers', 'plannedWorkers'),
      };
    })
    .filter(company => company.total > 0 || company.actualWorkers > 0 || company.plannedWorkers > 0)
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total || a.name.localeCompare(b.name));
}

function buildPriorities(
  criticalReserves: DashboardRecord[],
  overdueReserves: DashboardRecord[],
  lateTasks: DashboardRecord[],
) {
  const reserveItem = (
    reserve: DashboardRecord,
    kind: DashboardPriorityItem['kind'],
  ): DashboardPriorityItem => ({
    id: `${kind}:${stringField(reserve, 'id') || stringField(reserve, 'title')}`,
    kind,
    title: stringField(reserve, 'title', 'description'),
    building: stringField(reserve, 'building_name', 'building', 'batiment'),
    company: reserveCompanies(reserve).join(', '),
    deadline: parseDate(reserve.deadline),
    target: 'reserves',
  });

  const taskItem = (task: DashboardRecord): DashboardPriorityItem => ({
    id: `late-task:${stringField(task, 'id') || stringField(task, 'title')}`,
    kind: 'late-task',
    title: stringField(task, 'title', 'description'),
    building: stringField(task, 'building_name', 'building', 'batiment'),
    company: stringField(task, 'company', 'company_name', 'companyName'),
    deadline: parseDate(task.deadline),
    target: 'planning',
  });

  return [
    ...criticalReserves.map(item => reserveItem(item, 'critical-reserve')),
    ...overdueReserves.map(item => reserveItem(item, 'overdue-reserve')),
    ...lateTasks.map(taskItem),
  ].sort((a, b) => {
    const rank = { 'critical-reserve': 0, 'overdue-reserve': 1, 'late-task': 2 } as const;
    const urgency = rank[a.kind] - rank[b.kind];
    if (urgency !== 0) return urgency;
    return (a.deadline?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.deadline?.getTime() ?? Number.MAX_SAFE_INTEGER);
  });
}

export function buildDashboardModel(
  source: DashboardSource,
  { selectedProjectId, now = new Date() }: DashboardModelOptions,
): DashboardModel {
  const activeReserves = source.current.reserves.filter(reserve => !isArchived(reserve));
  const currentProject = source.projects.find(project => stringField(project, 'id') === selectedProjectId) ?? null;
  const plansById = new Map(source.plans.map(plan => [stringField(plan, 'id'), plan]));
  const statuses = { open: 0, inProgress: 0, waiting: 0, verification: 0, closed: 0 };

  for (const reserve of activeReserves) {
    const status = normalized(reserve.status);
    if (status === 'closed') statuses.closed += 1;
    else if (status === 'in_progress') statuses.inProgress += 1;
    else if (status === 'waiting') statuses.waiting += 1;
    else if (status === 'verification') statuses.verification += 1;
    else statuses.open += 1;
  }

  const criticalReserves = activeReserves.filter(reserve =>
    normalized(reserve.priority) === 'critical' && !isClosed(reserve),
  );
  const overdueReserves = activeReserves.filter(reserve =>
    normalized(reserve.priority) !== 'critical' && isOverdue(reserve, now),
  );
  const lateTasks = source.current.tasks.filter(task => isTaskLate(task, now));
  const openIncidents = source.current.incidents.filter(isIncidentOpen);
  const totalCount = activeReserves.length;
  const closedCount = statuses.closed;
  const companies = buildCompanies(source.companies, activeReserves, now);
  const workforce = companies.reduce(
    (total, company) => ({
      actual: total.actual + company.actualWorkers,
      planned: total.planned + company.plannedWorkers,
    }),
    { actual: 0, planned: 0 },
  );

  const portfolio = selectedProjectId === 'all'
    ? source.projects.map<DashboardProject>(project => {
      const id = stringField(project, 'id');
      const reserves = activeReserves.filter(reserve => projectId(reserve) === id);
      const closed = reserves.filter(isClosed).length;
      return {
        id,
        name: stringField(project, 'name') || id,
        total: reserves.length,
        closed,
        overdue: reserves.filter(reserve => isOverdue(reserve, now)).length,
        progress: reserves.length ? Math.round((closed / reserves.length) * 100) : 0,
      };
    }).sort((a, b) => b.overdue - a.overdue || b.total - a.total)
    : [];

  return {
    projectName: currentProject ? stringField(currentProject, 'name') : null,
    totalCount,
    closedCount,
    remainingCount: Math.max(totalCount - closedCount, 0),
    overdueCount: criticalReserves.filter(reserve => isOverdue(reserve, now)).length + overdueReserves.length,
    criticalCount: criticalReserves.length,
    lateTaskCount: lateTasks.length,
    openIncidentCount: openIncidents.length,
    pinnedCount: activeReserves.filter(hasPlanPin).length,
    progress: totalCount ? Math.round((closedCount / totalCount) * 100) : 0,
    statuses,
    priorities: buildPriorities(criticalReserves, overdueReserves, lateTasks),
    weeks: buildWeeks(activeReserves, now),
    buildings: buildBuildings(activeReserves, plansById, currentProject, now),
    companies,
    portfolio,
    workforce,
    quick: {
      plans: source.current.plansCount,
      visits: source.current.visitsCount,
      messages: source.messageCount,
      documents: source.current.documentsCount,
    },
  };
}
