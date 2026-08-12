export type WorkspaceRecord = Record<string, unknown>;

export type ReserveWorkspaceSummary = {
  visible: number;
  active: number;
  overdue: number;
  verification: number;
  pinned: number;
};

export type PlanLibraryGroup = {
  key: string;
  name: string;
  plans: WorkspaceRecord[];
  planIds: Set<string>;
  levels: string[];
  reserveCount: number;
};

export type PlanFamily = {
  key: string;
  label: string;
  groups: PlanLibraryGroup[];
};

export type PlanLibraryModel = {
  groups: PlanLibraryGroup[];
  families: PlanFamily[];
  familyOf: Map<string, string>;
  useGrouping: boolean;
  planCount: number;
  buildingCount: number;
  reserveCount: number;
  pinnedCount: number;
};

function stringField(record: WorkspaceRecord | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

export function normalizeWorkspaceText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function planBuildingName(plan: WorkspaceRecord) {
  return stringField(plan, 'building_name', 'building', 'batiment') || 'Sans bâtiment';
}

function planBuildingKey(plan: WorkspaceRecord) {
  const id = stringField(plan, 'building_id', 'buildingId');
  if (id) return `id:${id}`;
  const name = planBuildingName(plan);
  return name === 'Sans bâtiment' ? '__none__' : `name:${normalizeWorkspaceText(name)}`;
}

function planLevelName(plan: WorkspaceRecord) {
  return stringField(plan, 'level_name', 'level', 'niveau');
}

function reservePlanId(reserve: WorkspaceRecord) {
  return stringField(reserve, 'plan_id', 'planId');
}

function reserveBuildingKey(reserve: WorkspaceRecord) {
  const id = stringField(reserve, 'building_id', 'buildingId');
  if (id) return `id:${id}`;
  const name = stringField(reserve, 'building_name', 'building', 'batiment');
  return name ? `name:${normalizeWorkspaceText(name)}` : '__none__';
}

function isArchived(record: WorkspaceRecord) {
  return Boolean(record.archived_at ?? record.archivedAt);
}

function isDeleted(record: WorkspaceRecord) {
  return Boolean(record.deleted_at ?? record.deletedAt);
}

function parseDate(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(value: Date) {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isOverdue(reserve: WorkspaceRecord, now: Date) {
  const status = normalizeWorkspaceText(reserve.status);
  if (!reserve.deadline || status === 'closed' || status === 'verification') return false;
  const deadline = parseDate(reserve.deadline);
  return Boolean(deadline && startOfDay(deadline) < startOfDay(now));
}

function hasPin(reserve: WorkspaceRecord) {
  const planId = reservePlanId(reserve);
  const x = Number(reserve.plan_x ?? reserve.planX);
  const y = Number(reserve.plan_y ?? reserve.planY);
  return Boolean(planId) && Number.isFinite(x) && Number.isFinite(y);
}

export function buildReserveWorkspaceSummary(
  allReserves: WorkspaceRecord[],
  visibleReserves: WorkspaceRecord[],
  now = new Date(),
): ReserveWorkspaceSummary {
  const active = allReserves.filter(reserve => (
    !isArchived(reserve)
    && !isDeleted(reserve)
    && normalizeWorkspaceText(reserve.status) !== 'closed'
  ));
  return {
    visible: visibleReserves.length,
    active: active.length,
    overdue: active.filter(reserve => isOverdue(reserve, now)).length,
    verification: active.filter(reserve => normalizeWorkspaceText(reserve.status) === 'verification').length,
    pinned: active.filter(hasPin).length,
  };
}

function parseBuildingFamily(name: string) {
  const trimmed = name.trim();
  const match = trimmed.match(/^([^\d]*?[^\d\s])[\s\-_.#]*(\d+.*)$/);
  if (!match) return null;
  const label = match[1].trim().replace(/[\s\-_.#]+$/, '');
  if (!label) return null;
  return { key: normalizeWorkspaceText(label).replace(/\s+/g, ' '), label };
}

export function buildPlanLibraryModel(
  plans: WorkspaceRecord[],
  reserves: WorkspaceRecord[],
  locale = 'fr',
): PlanLibraryModel {
  const groupsByKey = new Map<string, {
    key: string;
    name: string;
    plans: WorkspaceRecord[];
    planIds: Set<string>;
    levels: Set<string>;
    reserveCount: number;
  }>();

  for (const plan of plans) {
    const key = planBuildingKey(plan);
    const group = groupsByKey.get(key) ?? {
      key,
      name: planBuildingName(plan),
      plans: [],
      planIds: new Set<string>(),
      levels: new Set<string>(),
      reserveCount: 0,
    };
    group.plans.push(plan);
    group.planIds.add(stringField(plan, 'id'));
    const level = planLevelName(plan);
    if (level) group.levels.add(level);
    groupsByKey.set(key, group);
  }

  const groupKeyByPlanId = new Map<string, string>();
  for (const group of groupsByKey.values()) {
    for (const planId of group.planIds) {
      if (planId) groupKeyByPlanId.set(planId, group.key);
    }
  }

  const reserveIdsByBuilding = new Map<string, Set<string>>();
  for (const reserve of reserves) {
    if (isArchived(reserve)) continue;
    const keys = new Set<string>();
    const planId = reservePlanId(reserve);
    if (planId) {
      const planGroupKey = groupKeyByPlanId.get(planId);
      if (planGroupKey) keys.add(planGroupKey);
    }
    keys.add(reserveBuildingKey(reserve));
    for (const key of keys) {
      if (!groupsByKey.has(key)) continue;
      const ids = reserveIdsByBuilding.get(key) ?? new Set<string>();
      ids.add(stringField(reserve, 'id'));
      reserveIdsByBuilding.set(key, ids);
    }
  }

  const groups: PlanLibraryGroup[] = [...groupsByKey.values()]
    .map(group => ({
      ...group,
      reserveCount: reserveIdsByBuilding.get(group.key)?.size ?? 0,
      levels: [...group.levels].sort((a, b) => a.localeCompare(b, locale, { numeric: true, sensitivity: 'base' })),
      plans: group.plans.sort((a, b) => stringField(a, 'name').localeCompare(stringField(b, 'name'), locale, { numeric: true, sensitivity: 'base' })),
    }))
    .sort((a, b) => {
      if (a.key === '__none__') return 1;
      if (b.key === '__none__') return -1;
      return a.name.localeCompare(b.name, locale, { numeric: true, sensitivity: 'base' });
    });

  const buckets = new Map<string, PlanFamily>();
  const others: PlanLibraryGroup[] = [];
  for (const group of groups) {
    const family = group.key === '__none__' ? null : parseBuildingFamily(group.name);
    if (!family) {
      others.push(group);
      continue;
    }
    const bucket = buckets.get(family.key) ?? { key: family.key, label: family.label, groups: [] };
    bucket.groups.push(group);
    buckets.set(family.key, bucket);
  }

  const realFamilies = [...buckets.values()]
    .filter(family => family.groups.length >= 2)
    .sort((a, b) => a.label.localeCompare(b.label, locale, { numeric: true, sensitivity: 'base' }));
  const groupedKeys = new Set(realFamilies.flatMap(family => family.groups.map(group => group.key)));
  const ungrouped = [
    ...others,
    ...[...buckets.values()].flatMap(family => family.groups.filter(group => !groupedKeys.has(group.key))),
  ].sort((a, b) => a.name.localeCompare(b.name, locale, { numeric: true, sensitivity: 'base' }));
  const useGrouping = realFamilies.length >= 2 && groups.length >= 8;
  const families = useGrouping
    ? [...realFamilies, ...(ungrouped.length ? [{ key: '__others__', label: 'Autres', groups: ungrouped }] : [])]
    : [];

  return {
    groups,
    families,
    familyOf: new Map(realFamilies.flatMap(family => family.groups.map(group => [group.key, family.key] as const))),
    useGrouping,
    planCount: plans.length,
    buildingCount: groups.length,
    reserveCount: groups.reduce((sum, group) => sum + group.reserveCount, 0),
    pinnedCount: reserves.filter(reserve => !isArchived(reserve) && hasPin(reserve)).length,
  };
}

export function filterPlanLibraryGroups(
  model: PlanLibraryModel,
  query: string,
  familyKey: string,
) {
  const familyGroups = !query.trim() && model.useGrouping && familyKey !== 'all'
    ? model.groups.filter(group => (model.familyOf.get(group.key) ?? '__others__') === familyKey)
    : model.groups;
  const normalizedQuery = normalizeWorkspaceText(query);
  if (!normalizedQuery) return familyGroups.map(group => ({ ...group, displayPlans: group.plans }));

  return familyGroups
    .map(group => {
      const groupMatches = normalizeWorkspaceText(group.name).includes(normalizedQuery);
      const displayPlans = groupMatches
        ? group.plans
        : group.plans.filter(plan => normalizeWorkspaceText([
            plan.name,
            planBuildingName(plan),
            planLevelName(plan),
            plan.revision_code,
            plan.file_type,
          ].filter(Boolean).join(' ')).includes(normalizedQuery));
      return { ...group, displayPlans };
    })
    .filter(group => group.displayPlans.length > 0);
}
