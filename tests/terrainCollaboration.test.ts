import { describe, expect, it } from 'vitest';
import { buildTerrainChanges, projectTerrainChanges, projectQueuedTerrainRows } from '../lib/terrainPatch';
import { MESSAGE_REACTION_CHOICES, projectMessageReactions } from '../lib/messageReactions';
import { meetingCacheKey, readMeetingSnapshot, writeMeetingSnapshot } from '../lib/meetingReportCache';
import { useProjectMeetingReports } from '../hooks/useProjectMeetingReports';
import { progressReplayBarrier } from '../lib/plan-progress/replay-order';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const original = { id: 'visit', title: 'Original', checklist_items: [{ id: 'a', label: 'A', checked: false }, { id: 'b', label: 'B', checked: false }] };
const report: any = { id: 'meeting', subject: 'Réunion', actions: [], decisions: [], notes: 'Original' };

describe('collaborative terrain intents', () => {
  it('keeps offline reaction sets and terrain edits ordered across delayed retries', () => {
    const order = progressReplayBarrier(Date.now());
    const mobile = { rpc: { fn: 'set_message_reaction', args: { p_message_id: 'm' } } };
    order.block(mobile);
    expect(order.deadline({ kind: 'message_reaction', payload: { messageId: 'm' } })).toBeTruthy();
    expect(order.deadline({ kind: 'message_reaction', payload: { messageId: 'other' } })).toBeUndefined();
    order.block({ table: 'oprs', op: 'insert', data: { id: 'new' } });
    expect(order.deadline({ rpc: { fn: 'apply_terrain_patch', args: { p_table: 'oprs', p_id: 'new' } } })).toBeTruthy();
  });
  it('merges a stale mobile checkbox with the fresh web checkbox and metadata', () => {
    const mobile = clone(original); mobile.checklist_items[1].checked = true;
    const changes = buildTerrainChanges('visites', original, mobile);
    const web = clone(original); web.title = 'Web'; web.checklist_items[0].checked = true;
    const merged = projectTerrainChanges(web, changes);
    expect(merged.title).toBe('Web');
    expect(merged.checklist_items.map((item: any) => item.checked)).toEqual([true, true]);
    expect(original.checklist_items[1].checked).toBe(false);
  });
  it('keeps OPR changes to item status independent from a title edited elsewhere', () => {
    const before = { id: 'opr', title: 'Original', items: [{ id: 'a', status: 'reserve', label: 'A', note: 'Note' }] };
    const changes = buildTerrainChanges('oprs', before, { ...before, items: [{ ...before.items[0], status: 'ok' }] });
    expect(changes).toEqual([{ target: 'items', key: 'a', before: { status: 'reserve' }, after: { status: 'ok' } }]);
    expect(projectTerrainChanges({ ...before, title: 'Web' }, changes).title).toBe('Web');
  });
  it('projects additions, removals and sequential queued edits without resurrecting deleted items', () => {
    const added = { ...original, checklist_items: [...original.checklist_items, { id: 'c', label: 'C', checked: false }] };
    const changes = buildTerrainChanges('visites', original, added);
    const queue = [{ op: 'rpc', rpc: { fn: 'apply_terrain_patch', args: { p_table: 'visites', p_id: original.id, p_changes: changes } } }];
    expect(projectQueuedTerrainRows([original], 'visites', queue, value => value, value => value)[0].checklist_items).toHaveLength(3);
    expect(projectTerrainChanges({ checklist_items: [] }, [{ target: 'checklist_items', key: 'a', before: { checked: false }, after: { checked: true } }]).checklist_items).toEqual([]);
    expect(buildTerrainChanges('visites', original, { ...original, checklist_items: original.checklist_items.slice(1) })[0].after).toBeNull();
  });
  it('rejects ambiguous item identities and ignores server metadata', () => {
    expect(() => buildTerrainChanges('visites', original, { ...original, checklist_items: [original.checklist_items[0], original.checklist_items[0]] })).toThrow();
    expect(buildTerrainChanges('oprs', { id: 'a', opr_revision: 1 }, { id: 'a', opr_revision: 2 })).toEqual([]);
  });
  it('offers the same seven choices and projects only the current actor reaction', () => {
    expect(MESSAGE_REACTION_CHOICES).toHaveLength(7);
    const rows = [{ id: 'm', reactions: { '👍': ['Web'], '✅': ['Other', 'Me'] } }];
    const queue = [{ kind: 'message_reaction', payload: { messageId: 'm', emoji: '✅', active: false } },
      { op: 'rpc', rpc: { fn: 'set_message_reaction', args: { p_message_id: 'm', p_emoji: '❤️', p_active: true } } }];
    expect(projectMessageReactions(rows, queue, 'Me')[0].reactions).toEqual({ '👍': ['Web'], '✅': ['Other'], '❤️': ['Me'] });
    expect(rows[0].reactions['✅']).toEqual(['Other', 'Me']);
  });
});

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function meetingHarness(storage: any, server: any) {
  const slots: any[] = []; let cursor = 0; let effects: Array<() => void> = []; let cleanups: Array<() => void> = [];
  let scope = ['user', 'org', 'project'];
  const hooks: any = {
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (next: any) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial: any) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useCallback(callback: any, dependencies: any[]) { const index = cursor++; const old = slots[index]; if (!old || dependencies.some((value, i) => value !== old.dependencies[i])) slots[index] = { callback, dependencies }; return slots[index].callback; },
    useEffect(effect: any, dependencies: any[]) { const index = cursor++; const old = slots[index]; if (!old || dependencies.some((value, i) => value !== old[i])) { cleanups[index]?.(); effects.push(() => { cleanups[index] = effect(); }); slots[index] = dependencies; } },
  };
  const client: any = { from: () => {
    let mutation: any, deleting = false;
    const query: any = {
      select: () => query, eq: () => query, order: () => query, range: () => query,
      insert: (value: any) => { mutation = value; return query; }, update: (value: any) => { mutation = value; return query; }, delete: () => { deleting = true; return query; },
      single: async () => server.write ? server.write(mutation, deleting) : { data: mutation, error: null },
      then: (yes: any, no: any) => Promise.resolve().then(() => server.read()).then(yes, no),
    }; return query;
  } };
  return {
    render() { cursor = 0; const result = useProjectMeetingReports(hooks, client, scope[0], scope[1], scope[2], storage); const pending = effects; effects = []; pending.forEach(effect => effect()); return result; },
    scope(value: string[]) { scope = value; },
    close() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}

describe('shared meeting offline copy', () => {
  it('validates scope, version and payload instead of accepting another account cache', () => {
    const raw = JSON.stringify({ scope: 'a', version: 1, rows: [{ report, version: 3 }] });
    expect(readMeetingSnapshot(raw, 'a')).toHaveLength(1);
    for (const value of [raw, '{', JSON.stringify({ scope: 'b', version: 1, rows: [{ report: {}, version: 0 }] })]) expect(readMeetingSnapshot(value, 'b')).toBeNull();
  });
  it('serializes refresh and deletion writes so old content cannot reappear', async () => {
    const gate = deferred<void>(); let stored = ''; let calls = 0;
    const storage = { getItem: async () => stored, setItem: async (_key: string, raw: string) => { if (++calls === 1) await gate.promise; stored = raw; } };
    const first = writeMeetingSnapshot(storage, 'a', [{ report, version: 1 }]);
    const second = writeMeetingSnapshot(storage, 'a', []);
    gate.resolve(); await Promise.all([first, second]);
    expect(readMeetingSnapshot(stored, 'a')).toEqual([]);
  });
  it('reopens cached shared reports without network, keeps them read only, then refreshes', async () => {
    const store = new Map<string, string>(); const storage = { getItem: async (key: string) => store.get(key) ?? null, setItem: async (key: string, value: string) => { store.set(key, value); } };
    const server = { read: async () => ({ data: [{ report, version: 3 }], error: null }) };
    let hook = meetingHarness(storage, server); hook.render(); await tick();
    expect(hook.render().ready).toBe(true); hook.close();
    server.read = async () => { throw new Error('offline'); };
    hook = meetingHarness(storage, server); hook.render(); await tick();
    const cached = hook.render(); expect(cached.rows[0].version).toBe(3); expect(cached.failed).toBe(true); expect(cached.ready).toBe(false);
    expect(await cached.save({ ...report, notes: 'Offline edit' }, 'update', 3)).toBe(false);
    server.read = async () => ({ data: [{ report: { ...report, notes: 'Web update' }, version: 4 }], error: null });
    await cached.refresh(); const fresh = hook.render(); expect(fresh.ready).toBe(true); expect(fresh.rows[0].report.notes).toBe('Web update');
    hook.scope(['other', 'org', 'project']); expect(hook.render().rows).toEqual([]); hook.close();
  });
  it('does not let slow hydration replace a newer server response', async () => {
    const hydration = deferred<string | null>();
    const storage = { getItem: () => hydration.promise, setItem: async () => {} };
    const hook = meetingHarness(storage, { read: async () => ({ data: [{ report, version: 5 }], error: null }) });
    hook.render(); await tick(); expect(hook.render().rows[0].version).toBe(5);
    hydration.resolve(JSON.stringify({ version: 1, scope: 'user:org:project', rows: [{ report, version: 1 }] })); await tick();
    expect(hook.render().rows[0].version).toBe(5); hook.close();
  });
  it('retains CAS protection and persists a successful save and deletion', async () => {
    const store = new Map<string, string>(); const storage = { getItem: async (key: string) => store.get(key) ?? null, setItem: async (key: string, value: string) => { store.set(key, value); } };
    const hook = meetingHarness(storage, { read: async () => ({ data: [{ report, version: 3 }], error: null }) });
    hook.render(); await tick();
    await expect(hook.render().save(report, 'update', 2)).rejects.toThrow('changé');
    await hook.render().save({ ...report, notes: 'Updated' }, 'update', 3); await tick();
    expect(hook.render().rows[0].version).toBe(4);
    await hook.render().remove(report.id); await tick();
    expect(readMeetingSnapshot(store.get(meetingCacheKey('user:org:project'))!, 'user:org:project')).toEqual([]); hook.close();
  });
});
