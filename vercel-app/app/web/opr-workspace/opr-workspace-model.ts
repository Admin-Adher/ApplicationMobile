export type OprStatus = 'draft' | 'in_progress' | 'signed';
export type OprFilter = 'all' | OprStatus;
export type OprItemStatus = 'ok' | 'reserve' | 'non_applicable';

export type OprSource = Record<string, any>;
export type ReserveSource = Record<string, any>;

export type OprItemView = {
  id: string;
  lotName: string;
  description: string;
  status: OprItemStatus;
  reserveId: string | null;
  note: string;
  entreprise: string;
  deadline: string;
};

export type OprSummary = {
  source: OprSource;
  id: string;
  title: string;
  date: string;
  building: string;
  level: string;
  zone: string;
  conducteur: string;
  status: OprStatus;
  items: OprItemView[];
  okCount: number;
  reserveCount: number;
  notApplicableCount: number;
  conformity: number;
  location: string;
};

export type OprWorkspaceModel = {
  summaries: OprSummary[];
  counts: Record<OprStatus, number> & { all: number; active: number };
  linkedOpenReserveCount: number;
  continuation: OprSummary | null;
};

const STATUS_ORDER: Record<OprStatus, number> = {
  in_progress: 0,
  draft: 1,
  signed: 2,
};

const firstText = (...values: unknown[]) => {
  const match = values.find(value => typeof value === 'string' && value.trim());
  return typeof match === 'string' ? match.trim() : '';
};

export function normalizeOprStatus(value: unknown): OprStatus {
  return value === 'signed' || value === 'in_progress' ? value : 'draft';
}

export function normalizeOprItemStatus(value: unknown): OprItemStatus {
  return value === 'reserve' || value === 'non_applicable' ? value : 'ok';
}

export function normalizeOprItem(item: OprSource, index: number): OprItemView {
  return {
    id: firstText(item.id) || `opr-item-${index + 1}`,
    lotName: firstText(item.lotName, item.lot_name) || `Lot ${index + 1}`,
    description: firstText(item.description),
    status: normalizeOprItemStatus(item.status),
    reserveId: firstText(item.reserveId, item.reserve_id) || null,
    note: firstText(item.note),
    entreprise: firstText(item.entreprise, item.company),
    deadline: firstText(item.deadline, item.deadline_date),
  };
}

export function summarizeOpr(opr: OprSource, index = 0): OprSummary {
  const rawItems = Array.isArray(opr.items) ? opr.items : [];
  const items = rawItems.map((item, itemIndex) => normalizeOprItem(item ?? {}, itemIndex));
  const okCount = items.filter(item => item.status === 'ok').length;
  const reserveCount = items.filter(item => item.status === 'reserve').length;
  const notApplicableCount = items.filter(item => item.status === 'non_applicable').length;
  const building = firstText(opr.building, opr.building_name);
  const level = firstText(opr.level, opr.level_name);
  const zone = firstText(opr.zone);
  const id = firstText(opr.id) || `opr-${index + 1}`;

  return {
    source: opr,
    id,
    title: firstText(opr.title) || id,
    date: firstText(opr.date, opr.created_at),
    building,
    level,
    zone,
    conducteur: firstText(opr.conducteur, opr.conducteur_name),
    status: normalizeOprStatus(opr.status),
    items,
    okCount,
    reserveCount,
    notApplicableCount,
    conformity: items.length ? Math.round((okCount / items.length) * 100) : 0,
    location: [building, level, zone].filter(Boolean).join(' · '),
  };
}

export function filterOprSummaries(summaries: OprSummary[], filter: OprFilter) {
  return filter === 'all' ? summaries : summaries.filter(opr => opr.status === filter);
}

export function formatOprDate(value: string, long = false) {
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!isoDate) return value || 'Date à préciser';
  const date = new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])));
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: long ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function buildOprWorkspaceModel(
  oprs: OprSource[],
  reserves: ReserveSource[],
  isReserveArchived: (reserve: ReserveSource) => boolean = () => false,
): OprWorkspaceModel {
  const summaries = oprs
    .map((opr, index) => summarizeOpr(opr, index))
    .sort((left, right) => (
      String(right.date).localeCompare(String(left.date))
      || STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
      || left.title.localeCompare(right.title, 'fr')
    ));
  const linkedIds = new Set(summaries.flatMap(opr => opr.items.map(item => item.reserveId).filter(Boolean)));
  const linkedOpenReserveCount = reserves.filter(reserve => {
    const id = firstText(reserve.id);
    const linkedToOpr = linkedIds.has(id) || reserve.type === 'observation' || reserve.source === 'opr';
    return linkedToOpr && reserve.status !== 'closed' && !isReserveArchived(reserve);
  }).length;
  const draft = summaries.filter(opr => opr.status === 'draft').length;
  const inProgress = summaries.filter(opr => opr.status === 'in_progress').length;
  const signed = summaries.filter(opr => opr.status === 'signed').length;
  const continuation = summaries.find(opr => opr.status === 'in_progress')
    ?? summaries.find(opr => opr.status === 'draft')
    ?? null;

  return {
    summaries,
    counts: {
      all: summaries.length,
      active: draft + inProgress,
      draft,
      in_progress: inProgress,
      signed,
    },
    linkedOpenReserveCount,
    continuation,
  };
}
