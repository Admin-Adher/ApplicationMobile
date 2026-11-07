import { describe, expect, it } from 'vitest';
import { createRefreshMergeGuard } from '../vercel-app/lib/refresh-merge-guard';

describe('commits while a company refresh is in flight', () => {
  it('keeps a newer saved attendance when an earlier read finally arrives', async () => {
    const guard = createRefreshMergeGuard<{ id: string; actual: number; contact: string }>();
    const checkpoint = guard.checkpoint();
    let release!: (rows: { id: string; actual: number; contact: string }[]) => void;
    const refresh = new Promise<{ id: string; actual: number; contact: string }[]>(resolve => { release = resolve; });
    guard.remember({ id: 'electric', actual: 3, contact: 'Old contact' }, ['actual']);
    release([{ id: 'electric', actual: 2, contact: 'Fresh contact' }]);
    expect(guard.merge(await refresh, checkpoint)).toEqual([{ id: 'electric', actual: 3, contact: 'Fresh contact' }]);
    const nextRefresh = guard.checkpoint();
    expect(guard.merge([{ id: 'electric', actual: 4, contact: 'Fresh contact' }], nextRefresh)[0].actual).toBe(4);
  });

  it('preserves independent writes to different fields and never inserts an inaccessible row', () => {
    const guard = createRefreshMergeGuard<{ id: string; actual: number; planned: number }>();
    const checkpoint = guard.checkpoint();
    guard.remember({ id: 'one', actual: 3, planned: 10 }, ['actual']);
    guard.remember({ id: 'one', actual: 3, planned: 12 }, ['planned']);
    expect(guard.merge([{ id: 'one', actual: 2, planned: 10 }], checkpoint)).toEqual([{ id: 'one', actual: 3, planned: 12 }]);
    expect(guard.merge([], checkpoint)).toEqual([]);
  });

  it('drops retained writes on an owner change without mutating the read snapshot', () => {
    const guard = createRefreshMergeGuard<{ id: string; actual: number }>();
    const rows = [{ id: 'one', actual: 2 }];
    const checkpoint = guard.checkpoint();
    guard.remember({ id: 'one', actual: 3 }, ['actual']);
    expect(guard.merge(rows, checkpoint)[0].actual).toBe(3);
    expect(rows[0].actual).toBe(2);
    guard.clear();
    expect(guard.merge(rows, checkpoint)[0].actual).toBe(2);
  });
});
