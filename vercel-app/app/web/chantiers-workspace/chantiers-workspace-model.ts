export type ChantierStatus = 'active' | 'paused' | 'completed';

export type ChantierFilter = 'all' | ChantierStatus;

export type BuildingSort = 'name' | 'levels';

export type ZoneSource = {
  id?: string | null;
  name?: string | null;
  [key: string]: unknown;
};

export type LevelSource = {
  id?: string | null;
  name?: string | null;
  zones?: ZoneSource[] | null;
  [key: string]: unknown;
};

export type BuildingSource = {
  id?: string | null;
  name?: string | null;
  levels?: LevelSource[] | null;
  [key: string]: unknown;
};

export type ChantierSource = {
  id?: string | number | null;
  name?: string | null;
  address?: string | null;
  description?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  company_ids?: Array<string | number> | null;
  companyIds?: Array<string | number> | null;
  buildings?: BuildingSource[] | string | null;
  [key: string]: unknown;
};

export type CompanySource = {
  id?: string | number | null;
  name?: string | null;
  short_name?: string | null;
  shortName?: string | null;
  color?: string | null;
  [key: string]: unknown;
};

export type LevelSummary = {
  id: string;
  name: string;
  zoneCount: number;
  source: LevelSource;
};

export type BuildingSummary = {
  id: string;
  name: string;
  levels: LevelSummary[];
  levelCount: number;
  zoneCount: number;
  searchText: string;
  source: BuildingSource;
};

export type CompanySummary = {
  id: string;
  name: string;
  color: string;
  source: CompanySource;
};

export type ChantierSummary = {
  id: string;
  name: string;
  location: string;
  description: string;
  status: ChantierStatus;
  startDate: string;
  endDate: string;
  buildings: BuildingSummary[];
  buildingCount: number;
  levelCount: number;
  zoneCount: number;
  companies: CompanySummary[];
  searchText: string;
  source: ChantierSource;
};

export type ChantiersWorkspaceModel = {
  projects: ChantierSummary[];
  selected: ChantierSummary | null;
  counts: Record<ChantierFilter, number>;
  totalBuildings: number;
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

export function normalizeChantierStatus(value: unknown): ChantierStatus {
  const normalized = normalizeSearchText(value).replace(/[\s-]+/g, '_');
  if (['completed', 'complete', 'done', 'closed', 'termine', 'terminee'].includes(normalized)) return 'completed';
  if (['paused', 'pause', 'suspended', 'suspendu', 'suspendue', 'on_hold'].includes(normalized)) return 'paused';
  return 'active';
}

export function chantierStatusLabel(status: ChantierStatus) {
  if (status === 'completed') return 'Terminé';
  if (status === 'paused') return 'Suspendu';
  return 'Actif';
}

export function extractProjectBuildings(project?: ChantierSource | null): BuildingSource[] {
  if (Array.isArray(project?.buildings)) return project.buildings;
  if (typeof project?.buildings !== 'string' || !project.buildings.trim()) return [];
  try {
    const parsed = JSON.parse(project.buildings);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function summarizeBuilding(building: BuildingSource, index = 0): BuildingSummary {
  const levels = (Array.isArray(building.levels) ? building.levels : []).map((level, levelIndex) => ({
    id: safeText(level.id) || `level-${index}-${levelIndex}`,
    name: safeText(level.name) || `Niveau ${levelIndex + 1}`,
    zoneCount: Array.isArray(level.zones) ? level.zones.length : 0,
    source: level,
  }));
  const name = safeText(building.name) || `Bâtiment ${index + 1}`;
  const zoneCount = levels.reduce((total, level) => total + level.zoneCount, 0);
  return {
    id: safeText(building.id) || `building-${index}-${normalizeSearchText(name)}`,
    name,
    levels,
    levelCount: levels.length,
    zoneCount,
    searchText: normalizeSearchText([name, ...levels.map(level => level.name)].join(' ')),
    source: building,
  };
}

function assignedCompanies(project: ChantierSource, companies: CompanySource[]): CompanySummary[] {
  const assignedIds = new Set([
    ...(Array.isArray(project.company_ids) ? project.company_ids : []),
    ...(Array.isArray(project.companyIds) ? project.companyIds : []),
  ].map(String).filter(Boolean));
  const visibleCompanies = assignedIds.size
    ? companies.filter(company => assignedIds.has(String(company.id ?? '')))
    : companies;
  return visibleCompanies.map((company, index) => ({
    id: safeText(company.id) || `company-${index}`,
    name: safeText(company.short_name ?? company.shortName ?? company.name) || 'Entreprise sans nom',
    color: safeText(company.color) || '#003082',
    source: company,
  }));
}

export function summarizeChantier(project: ChantierSource, companies: CompanySource[], index = 0): ChantierSummary {
  const buildings = extractProjectBuildings(project).map(summarizeBuilding);
  const name = safeText(project.name) || `Chantier ${index + 1}`;
  const location = safeText(project.address) || safeText(project.description) || 'Adresse non renseignée';
  const description = safeText(project.description);
  const projectCompanies = assignedCompanies(project, companies);
  return {
    id: safeText(project.id) || `project-${index}`,
    name,
    location,
    description,
    status: normalizeChantierStatus(project.status),
    startDate: safeText(project.start_date),
    endDate: safeText(project.end_date),
    buildings,
    buildingCount: buildings.length,
    levelCount: buildings.reduce((total, building) => total + building.levelCount, 0),
    zoneCount: buildings.reduce((total, building) => total + building.zoneCount, 0),
    companies: projectCompanies,
    searchText: normalizeSearchText([name, location, description].join(' ')),
    source: project,
  };
}

export function buildChantiersWorkspaceModel(
  projects: ChantierSource[],
  companies: CompanySource[],
  selectedProjectId: string,
): ChantiersWorkspaceModel {
  const summaries = projects.map((project, index) => summarizeChantier(project, companies, index));
  const selected = summaries.find(project => project.id === String(selectedProjectId)) ?? summaries[0] ?? null;
  const counts = summaries.reduce<Record<ChantierFilter, number>>((result, project) => {
    result.all += 1;
    result[project.status] += 1;
    return result;
  }, { all: 0, active: 0, paused: 0, completed: 0 });
  return {
    projects: summaries,
    selected,
    counts,
    totalBuildings: summaries.reduce((total, project) => total + project.buildingCount, 0),
  };
}

export function filterChantierSummaries(projects: ChantierSummary[], filter: ChantierFilter, query: string) {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  return projects.filter(project => {
    if (filter !== 'all' && project.status !== filter) return false;
    return tokens.length === 0 || tokens.every(token => project.searchText.includes(token));
  });
}

export function filterAndSortBuildings(buildings: BuildingSummary[], query: string, sort: BuildingSort) {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const visible = buildings.filter(building => tokens.length === 0 || tokens.every(token => building.searchText.includes(token)));
  return [...visible].sort((left, right) => {
    if (sort === 'levels') {
      return right.levelCount - left.levelCount
        || right.zoneCount - left.zoneCount
        || left.name.localeCompare(right.name, 'fr-FR');
    }
    return left.name.localeCompare(right.name, 'fr-FR', { numeric: true });
  });
}

export function formatChantierDate(value: string, locale = 'fr-FR') {
  if (!value) return '—';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
