import { describe, expect, it } from 'vitest';
import { DEFAULT_RESERVE_LIST_FILTERS, matchesReserveListFilters, reserveLotSearchText, selectedReserveRows, sortReserveList } from '../vercel-app/lib/reserve-list-model';

describe('web reserve list controls', () => {
  it('limits a manual selection to visible authorized rows and keeps their order', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(selectedReserveRows(rows, ['c', 'hidden', 'a', 'a'])).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(selectedReserveRows(rows.slice(1), ['a', 'c'])).toEqual([{ id: 'c' }]);
    expect(selectedReserveRows(rows, [])).toEqual([]);
  });
  it('makes lot names, codes and mobile lot numbers searchable without inventing missing lots', () => {
    const lots = new Map([['electric', { name: 'Électricité', code: 'ELEC', number: 12 }]]);
    const text = reserveLotSearchText({ lot_id: 'electric' }, lots);
    expect(text).toContain('Électricité');
    expect(text).toContain('ELEC');
    expect(text).toContain('lot 12');
    expect(reserveLotSearchText({ lot_id: 'removed' }, lots)).toBe('');
  });

  it('combines the four detailed filters and treats legacy rows as reserves', () => {
    const filters = { level: 'R+1', zone: 'Hall', kind: 'reserve', lot: 'electric' };
    const row = { level: 'R+1', zone: 'Hall', lot_id: 'electric' };
    expect(matchesReserveListFilters(row, filters)).toBe(true);
    for (const override of [{ level: 'RDC' }, { zone: 'Bureau' }, { kind: 'observation' }, { lot_id: 'other' }]) {
      expect(matchesReserveListFilters({ ...row, ...override }, filters)).toBe(false);
    }
    expect(matchesReserveListFilters({ ...row, kind: 'observation' }, DEFAULT_RESERVE_LIST_FILTERS)).toBe(true);
  });

  it('sorts mixed French and ISO creation dates in both directions without mutating the cache', () => {
    const rows = [{ id: 'new', created_at: '2026-11-07T10:00:00Z' }, { id: 'old', created_at: '17/09/2026 15:39' }, { id: 'unknown' }];
    expect(sortReserveList(rows, 'date_desc').map(row => row.id)).toEqual(['new', 'old', 'unknown']);
    expect(sortReserveList(rows, 'date_asc').map(row => row.id)).toEqual(['old', 'new', 'unknown']);
    expect(rows.map(row => row.id)).toEqual(['new', 'old', 'unknown']);
  });

  it('keeps missing and invalid deadlines last, with stable ordering for ties', () => {
    const rows = [{ id: 'RSV-10', deadline: '12/11/2026' }, { id: 'RSV-2', deadline: '2026-11-12T00:00:00' }, { id: 'later', deadline: '2026-11-20' }, { id: 'invalid', deadline: '31/02/2026' }, { id: 'missing' }];
    expect(sortReserveList(rows, 'deadline').map(row => row.id)).toEqual(['RSV-2', 'RSV-10', 'later', 'invalid', 'missing']);
  });

  it('orders operational priority and status ahead of unknown values', () => {
    const rows = [{ id: 'low', priority: 'low', status: 'closed' }, { id: 'unknown' }, { id: 'critical', priority: 'critical', status: 'open' }, { id: 'high', priority: 'high', status: 'verification' }];
    expect(sortReserveList(rows, 'priority').map(row => row.id)).toEqual(['critical', 'high', 'low', 'unknown']);
    expect(sortReserveList(rows, 'status').map(row => row.id)).toEqual(['critical', 'high', 'low', 'unknown']);
  });
});
