import { describe, expect, it } from 'vitest';
import {
  WEB_RESERVE_MOBILE_BATCH_SIZE,
  buildReserveNavigatorModel,
  createReserveNavigatorState,
  showNextReserveBatch,
  showReserveNavigatorDetail,
  showReserveNavigatorList,
  syncReserveNavigatorScope,
} from '../vercel-app/app/web/plan-reserve-workspace/reserve-navigator';

const makeReserves = (count: number) => Array.from(
  { length: count },
  (_, index) => ({ id: `r-${index + 1}`, title: `Reserve ${index + 1}` }),
);

describe('compact reserve navigator model', () => {
  it.each([
    [0, 0, 0],
    [12, 12, 0],
    [13, 12, 1],
  ])('bounds an initial dataset of %i rows to %i visible and %i hidden', (total, visible, hidden) => {
    const model = buildReserveNavigatorModel(
      makeReserves(total),
      createReserveNavigatorState('project-a'),
    );

    expect(model.visibleCount).toBe(visible);
    expect(model.hiddenCount).toBe(hidden);
    expect(new Set(model.visibleRows.map(row => row.id)).size).toBe(visible);
  });

  it('shows honest 12 + 12 batches and the exact remaining count', () => {
    const rows = makeReserves(30);
    const initialState = createReserveNavigatorState('project-a');
    const initial = buildReserveNavigatorModel(rows, initialState);

    expect(WEB_RESERVE_MOBILE_BATCH_SIZE).toBe(12);
    expect(initial.visibleRows).toHaveLength(12);
    expect(initial).toMatchObject({
      visibleCount: 12,
      totalCount: 30,
      hiddenCount: 18,
      nextBatchCount: 12,
      canLoadMore: true,
    });

    const second = buildReserveNavigatorModel(rows, showNextReserveBatch(initialState));
    expect(second.visibleRows).toHaveLength(24);
    expect(second).toMatchObject({
      visibleCount: 24,
      totalCount: 30,
      hiddenCount: 6,
      nextBatchCount: 6,
      canLoadMore: true,
    });

    const complete = buildReserveNavigatorModel(
      rows,
      showNextReserveBatch(showNextReserveBatch(initialState)),
    );
    expect(complete.visibleRows).toHaveLength(30);
    expect(complete).toMatchObject({
      visibleCount: 30,
      totalCount: 30,
      hiddenCount: 0,
      nextBatchCount: 0,
      canLoadMore: false,
    });
  });

  it('resets the batch and detail pane when the project scope changes', () => {
    const initial = createReserveNavigatorState('project-a');
    const expandedDetail = showReserveNavigatorDetail(showNextReserveBatch(initial));

    expect(syncReserveNavigatorScope(expandedDetail, 'project-a')).toBe(expandedDetail);
    expect(syncReserveNavigatorScope(expandedDetail, 'project-b')).toEqual({
      scopeKey: 'project-b',
      view: 'list',
      visibleLimit: 12,
    });
  });

  it('promotes a selected reserve outside the batch without growing the DOM batch', () => {
    const rows = makeReserves(30);
    const state = createReserveNavigatorState('project-a');
    const model = buildReserveNavigatorModel(rows, state, 'r-25');
    const visibleIds = model.visibleRows.map(reserve => reserve.id);

    expect(visibleIds).toEqual([
      'r-25',
      'r-1',
      'r-2',
      'r-3',
      'r-4',
      'r-5',
      'r-6',
      'r-7',
      'r-8',
      'r-9',
      'r-10',
      'r-11',
    ]);
    expect(new Set(visibleIds).size).toBe(12);
    expect(model).toMatchObject({
      visibleCount: 12,
      hiddenCount: 18,
      selectedWasPromoted: true,
    });
  });

  it('keeps natural order when the selection already belongs to the batch', () => {
    const rows = makeReserves(30);
    const model = buildReserveNavigatorModel(
      rows,
      createReserveNavigatorState('project-a'),
      'r-5',
    );

    expect(model.visibleRows.map(reserve => reserve.id)).toEqual(
      rows.slice(0, 12).map(reserve => reserve.id),
    );
    expect(model.selectedWasPromoted).toBe(false);
  });

  it('promotes the first row outside the initial batch and ignores an absent selection', () => {
    const rows = makeReserves(20);
    const state = createReserveNavigatorState('project-a');

    const boundary = buildReserveNavigatorModel(rows, state, 'r-13');
    expect(boundary.visibleRows[0].id).toBe('r-13');
    expect(boundary.visibleRows).toHaveLength(12);

    const absent = buildReserveNavigatorModel(rows, state, 'missing');
    expect(absent.visibleRows).toEqual(rows.slice(0, 12));
    expect(absent.selectedWasPromoted).toBe(false);
  });

  it('keeps list/detail navigation independent from caller-owned selection', () => {
    const rows = makeReserves(20);
    const listState = createReserveNavigatorState('project-a');
    const selectedList = buildReserveNavigatorModel(rows, listState, 'r-20');

    expect(listState).not.toHaveProperty('selectedReserveId');
    expect(selectedList.view).toBe('list');
    expect(selectedList.visibleRows[0].id).toBe('r-20');

    const detailState = showReserveNavigatorDetail(listState);
    expect(detailState).not.toHaveProperty('selectedReserveId');
    expect(buildReserveNavigatorModel(rows, detailState, 'r-20').view).toBe('detail');

    const returnedListState = showReserveNavigatorList(detailState);
    expect(returnedListState).not.toHaveProperty('selectedReserveId');
    expect(buildReserveNavigatorModel(rows, returnedListState, 'r-20').view).toBe('list');
  });
});
