export const WEB_PLAN_RESERVE_MOBILE_BATCH_SIZE = 8;

export type PlanReserveNavigatorItem = Readonly<{
  id: string;
}>;

export type PlanReserveNavigatorState = Readonly<{
  scopeKey: string;
  visibleLimit: number;
}>;

export type PlanReserveNavigatorModel<T extends PlanReserveNavigatorItem> = Readonly<{
  orderedRows: readonly T[];
  visibleRows: readonly T[];
  visibleCount: number;
  totalCount: number;
  hiddenCount: number;
  nextBatchCount: number;
  canLoadMore: boolean;
  selectedWasPromoted: boolean;
}>;

type BuildPlanReserveNavigatorOptions<T extends PlanReserveNavigatorItem> = Readonly<{
  compact: boolean;
  selectedId?: string | null;
  getNumber: (row: T) => number | null | undefined;
}>;

export function createPlanReserveNavigatorState(scopeKey: string): PlanReserveNavigatorState {
  return {
    scopeKey,
    visibleLimit: WEB_PLAN_RESERVE_MOBILE_BATCH_SIZE,
  };
}

export function syncPlanReserveNavigatorScope(
  state: PlanReserveNavigatorState,
  scopeKey: string,
): PlanReserveNavigatorState {
  return state.scopeKey === scopeKey
    ? state
    : createPlanReserveNavigatorState(scopeKey);
}

export function showNextPlanReserveBatch(
  state: PlanReserveNavigatorState,
): PlanReserveNavigatorState {
  return {
    ...state,
    visibleLimit: state.visibleLimit + WEB_PLAN_RESERVE_MOBILE_BATCH_SIZE,
  };
}

function normalizePinNumber(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
}

/**
 * The pin map owns numbering. This projection uses that same order for the
 * list, bounds the compact DOM, and promotes a selected pin without growing
 * the batch. Desktop keeps the complete ordered list and its internal scroll.
 */
export function buildPlanReserveNavigatorModel<T extends PlanReserveNavigatorItem>(
  rows: readonly T[],
  state: PlanReserveNavigatorState,
  options: BuildPlanReserveNavigatorOptions<T>,
): PlanReserveNavigatorModel<T> {
  const rankedRows = rows.map((row, sourceIndex) => ({
    row,
    sourceIndex,
    number: normalizePinNumber(options.getNumber(row)),
  }));

  rankedRows.sort((left, right) => {
    if (left.number !== null && right.number !== null && left.number !== right.number) {
      return left.number - right.number;
    }
    if (left.number !== null) return -1;
    if (right.number !== null) return 1;
    return left.sourceIndex - right.sourceIndex;
  });

  const orderedRows = rankedRows.map(entry => entry.row);
  const totalCount = orderedRows.length;
  const visibleLimit = options.compact
    ? Math.min(totalCount, Math.max(0, state.visibleLimit))
    : totalCount;
  const selectedIndex = options.selectedId
    ? orderedRows.findIndex(row => String(row.id) === String(options.selectedId))
    : -1;
  const selectedWasPromoted = options.compact && visibleLimit > 0 && selectedIndex >= visibleLimit;
  const visibleRows = selectedWasPromoted
    ? [orderedRows[selectedIndex], ...orderedRows.slice(0, visibleLimit - 1)]
    : orderedRows.slice(0, visibleLimit);
  const visibleCount = visibleRows.length;
  const hiddenCount = Math.max(0, totalCount - visibleCount);

  return {
    orderedRows,
    visibleRows,
    visibleCount,
    totalCount,
    hiddenCount,
    nextBatchCount: options.compact
      ? Math.min(WEB_PLAN_RESERVE_MOBILE_BATCH_SIZE, hiddenCount)
      : 0,
    canLoadMore: options.compact && hiddenCount > 0,
    selectedWasPromoted,
  };
}

function parseHexColor(color: string) {
  const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const value = match[1].length === 3
    ? match[1].split('').map(character => character + character).join('')
    : match[1];
  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16),
  };
}

/** Chooses the higher-contrast foreground for company-coloured markers. */
export function getPlanReserveMarkerTextColor(backgroundColor: string) {
  const rgb = parseHexColor(backgroundColor);
  if (!rgb) return '#ffffff';
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (
    0.2126 * toLinear(rgb.red)
    + 0.7152 * toLinear(rgb.green)
    + 0.0722 * toLinear(rgb.blue)
  );
  const darkLuminance = 0.008;
  const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05);
  const lightContrast = 1.05 / (luminance + 0.05);
  return darkContrast >= lightContrast ? '#0f172a' : '#ffffff';
}
