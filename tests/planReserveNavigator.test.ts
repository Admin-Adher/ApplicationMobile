import { describe, expect, it } from 'vitest';
import {
  WEB_PLAN_RESERVE_MOBILE_BATCH_SIZE,
  buildPlanReserveNavigatorModel,
  createPlanReserveNavigatorState,
  getPlanReserveMarkerTextColor,
  showNextPlanReserveBatch,
  syncPlanReserveNavigatorScope,
} from '../vercel-app/app/web/plan-reserve-workspace/plan-reserve-navigator';

const makeRows = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `reserve-${index + 1}`,
  number: index + 1,
}));

describe('plan reserve navigator', () => {
  it('renders an honest 8 + 8 compact progression', () => {
    const rows = makeRows(17);
    const initialState = createPlanReserveNavigatorState('plan-a');
    const initial = buildPlanReserveNavigatorModel(rows, initialState, {
      compact: true,
      getNumber: row => row.number,
    });

    expect(WEB_PLAN_RESERVE_MOBILE_BATCH_SIZE).toBe(8);
    expect(initial).toMatchObject({
      visibleCount: 8,
      totalCount: 17,
      hiddenCount: 9,
      nextBatchCount: 8,
      canLoadMore: true,
    });

    const second = buildPlanReserveNavigatorModel(rows, showNextPlanReserveBatch(initialState), {
      compact: true,
      getNumber: row => row.number,
    });
    expect(second).toMatchObject({
      visibleCount: 16,
      hiddenCount: 1,
      nextBatchCount: 1,
      canLoadMore: true,
    });

    const complete = buildPlanReserveNavigatorModel(
      rows,
      showNextPlanReserveBatch(showNextPlanReserveBatch(initialState)),
      { compact: true, getNumber: row => row.number },
    );
    expect(complete).toMatchObject({
      visibleCount: 17,
      hiddenCount: 0,
      nextBatchCount: 0,
      canLoadMore: false,
    });
  });

  it('sorts rows by the same ascending numbers shown on the plan', () => {
    const rows = [
      { id: 'r-13', number: 13 },
      { id: 'r-17', number: 17 },
      { id: 'r-8', number: 8 },
      { id: 'r-1', number: 1 },
    ];
    const model = buildPlanReserveNavigatorModel(rows, createPlanReserveNavigatorState('plan-a'), {
      compact: false,
      getNumber: row => row.number,
    });

    expect(model.orderedRows.map(row => row.number)).toEqual([1, 8, 13, 17]);
    expect(model.visibleRows).toEqual(model.orderedRows);
    expect(model.canLoadMore).toBe(false);
  });

  it('keeps unnumbered legacy rows stable after numbered rows', () => {
    const rows = [
      { id: 'legacy-a', number: null },
      { id: 'r-2', number: 2 },
      { id: 'legacy-b', number: null },
      { id: 'r-1', number: 1 },
    ];
    const model = buildPlanReserveNavigatorModel(rows, createPlanReserveNavigatorState('plan-a'), {
      compact: false,
      getNumber: row => row.number,
    });

    expect(model.orderedRows.map(row => row.id)).toEqual(['r-1', 'r-2', 'legacy-a', 'legacy-b']);
  });

  it('promotes a selected pin outside the compact batch without growing the DOM', () => {
    const rows = makeRows(17);
    const model = buildPlanReserveNavigatorModel(rows, createPlanReserveNavigatorState('plan-a'), {
      compact: true,
      selectedId: 'reserve-13',
      getNumber: row => row.number,
    });

    expect(model.visibleRows).toHaveLength(8);
    expect(model.visibleRows[0].id).toBe('reserve-13');
    expect(new Set(model.visibleRows.map(row => row.id)).size).toBe(8);
    expect(model.selectedWasPromoted).toBe(true);
  });

  it('resets the compact batch when the selected plan changes', () => {
    const expanded = showNextPlanReserveBatch(createPlanReserveNavigatorState('plan-a'));

    expect(syncPlanReserveNavigatorScope(expanded, 'plan-a')).toBe(expanded);
    expect(syncPlanReserveNavigatorScope(expanded, 'plan-b')).toEqual({
      scopeKey: 'plan-b',
      visibleLimit: 8,
    });
  });

  it('uses a dark foreground on light company colours', () => {
    expect(getPlanReserveMarkerTextColor('#5bc0de')).toBe('#0f172a');
    expect(getPlanReserveMarkerTextColor('#f4a51c')).toBe('#0f172a');
    expect(getPlanReserveMarkerTextColor('#003082')).toBe('#ffffff');
    expect(getPlanReserveMarkerTextColor('var(--unknown)')).toBe('#ffffff');
  });
});
