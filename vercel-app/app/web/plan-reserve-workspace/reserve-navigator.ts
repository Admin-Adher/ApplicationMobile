export const WEB_RESERVE_MOBILE_BATCH_SIZE = 12;

export type ReserveNavigatorView = 'list' | 'detail';

export type ReserveNavigatorState = Readonly<{
  scopeKey: string;
  view: ReserveNavigatorView;
  visibleLimit: number;
}>;

export type ReserveNavigatorItem = {
  id: string;
};

export type ReserveNavigatorModel<T extends ReserveNavigatorItem> = Readonly<{
  scopeKey: string;
  view: ReserveNavigatorView;
  visibleRows: readonly T[];
  visibleCount: number;
  totalCount: number;
  hiddenCount: number;
  nextBatchCount: number;
  canLoadMore: boolean;
  selectedWasPromoted: boolean;
}>;

export function createReserveNavigatorState(scopeKey: string): ReserveNavigatorState {
  return {
    scopeKey,
    view: 'list',
    visibleLimit: WEB_RESERVE_MOBILE_BATCH_SIZE,
  };
}

/**
 * A scope key identifies the current project/filter/search result set. A new
 * scope always starts from the first batch and from the list, while selection
 * remains caller-owned and can be reconciled independently.
 */
export function syncReserveNavigatorScope(
  state: ReserveNavigatorState,
  scopeKey: string,
): ReserveNavigatorState {
  return state.scopeKey === scopeKey
    ? state
    : createReserveNavigatorState(scopeKey);
}

export function showReserveNavigatorList(state: ReserveNavigatorState): ReserveNavigatorState {
  return state.view === 'list' ? state : { ...state, view: 'list' };
}

export function showReserveNavigatorDetail(state: ReserveNavigatorState): ReserveNavigatorState {
  return state.view === 'detail' ? state : { ...state, view: 'detail' };
}

export function showNextReserveBatch(state: ReserveNavigatorState): ReserveNavigatorState {
  return {
    ...state,
    visibleLimit: state.visibleLimit + WEB_RESERVE_MOBILE_BATCH_SIZE,
  };
}

function itemMatchesSelection(item: ReserveNavigatorItem, selectedId: string) {
  return item.id === selectedId;
}

/**
 * Derives the compact list without mutating its source or storing selection in
 * navigation state. When the selected row lies beyond the current batch, it
 * takes the first slot so the DOM remains bounded and the selection stays
 * visible.
 */
export function buildReserveNavigatorModel<T extends ReserveNavigatorItem>(
  rows: readonly T[],
  state: ReserveNavigatorState,
  selectedReserveId: string | null = null,
): ReserveNavigatorModel<T> {
  const totalCount = rows.length;
  const visibleLimit = Math.min(totalCount, Math.max(0, state.visibleLimit));
  let selectedIndex = -1;

  if (selectedReserveId !== null) {
    for (let index = 0; index < totalCount; index += 1) {
      if (itemMatchesSelection(rows[index], selectedReserveId)) {
        selectedIndex = index;
        break;
      }
    }
  }

  const selectedWasPromoted = visibleLimit > 0 && selectedIndex >= visibleLimit;
  const visibleRows = selectedWasPromoted
    ? [rows[selectedIndex], ...rows.slice(0, visibleLimit - 1)]
    : rows.slice(0, visibleLimit);
  const visibleCount = visibleRows.length;
  const hiddenCount = Math.max(0, totalCount - visibleCount);

  return {
    scopeKey: state.scopeKey,
    view: state.view,
    visibleRows,
    visibleCount,
    totalCount,
    hiddenCount,
    nextBatchCount: Math.min(WEB_RESERVE_MOBILE_BATCH_SIZE, hiddenCount),
    canLoadMore: hiddenCount > 0,
    selectedWasPromoted,
  };
}
