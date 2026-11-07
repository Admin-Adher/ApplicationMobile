export type TeamsSort = 'name' | 'presence' | 'reserves';
type Row = Record<string, any>;
const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const number = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export function companyOpenReserves(company: Row, reserves: Row[]) {
  const names = [company.name, company.short_name, company.shortName].filter(Boolean).map(normalize);
  return reserves.filter(reserve => reserve.status !== 'closed' && !reserve.deleted_at && !reserve.deletedAt
    && (Array.isArray(reserve.companies) && reserve.companies.length ? reserve.companies : [reserve.company])
      .some((name: unknown) => names.includes(normalize(name)))).length;
}

export function companyActiveTasks(company: Row, tasks: Row[]) {
  const keys = [company.id, company.name, company.short_name, company.shortName].filter(Boolean).map(normalize);
  return tasks.filter(task => !['done', 'completed', 'closed'].includes(task.status)
    && !task.deleted_at && keys.includes(normalize(task.company))).length;
}

export function filterTeams(companies: Row[], reserves: Row[], query: string, order: TeamsSort) {
  const needle = normalize(query);
  const rows = companies.filter(company => !needle || [company.name, company.short_name, company.shortName, company.zone,
    ...(Array.isArray(company.lots) ? company.lots : [company.lots])].some(value => normalize(value).includes(needle)));
  const openCounts = new Map(rows.map(company => [company.id, companyOpenReserves(company, reserves)]));
  const presence = (company: Row) => number(company.planned_workers) > 0 ? number(company.actual_workers) / number(company.planned_workers) : 0;
  return rows.sort((a, b) => {
    const difference = order === 'presence' ? presence(b) - presence(a)
      : order === 'reserves' ? (openCounts.get(b.id) ?? 0) - (openCounts.get(a.id) ?? 0) : 0;
    return difference || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'fr', { numeric: true, sensitivity: 'base' })
      || String(a.id).localeCompare(String(b.id));
  });
}
