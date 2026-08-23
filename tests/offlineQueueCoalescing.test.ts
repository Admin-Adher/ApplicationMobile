import { describe, expect, it } from 'vitest';
import {
  coalesceQueuedOperations,
  migrateAndCoalesceSitePlanSnapshots,
  type CoalescibleQueuedOperation,
  type MigratableQueuedOperation,
} from '../lib/offlineQueueCoalescing';

// Les fonctions sont generiques : `id` n'appartient pas au contrat de la
// bibliotheque, mais une vraie operation en file en porte un, et les assertions
// s'en servent pour identifier les entrees. On l'ajoute donc localement plutot
// que d'elargir l'interface publique pour les besoins des tests.
type TestCoalescible = CoalescibleQueuedOperation & { id: string };
type TestMigratable = MigratableQueuedOperation & { id: string };

describe('offline queue coalescing', () => {
  it('keeps only the latest keyed plan snapshot without reordering unrelated operations', () => {
    const operations = [
      { id: 'insert', op: 'insert' },
      { id: 'plan-v1', op: 'update', coalesceKey: 'user-a:plan-1' },
      { id: 'delete', op: 'delete' },
      { id: 'plan-v2', op: 'update', coalesceKey: 'user-a:plan-1' },
      { id: 'other-plan', op: 'update', coalesceKey: 'user-a:plan-2' },
    ];

    expect(coalesceQueuedOperations(operations).map(operation => operation.id)).toEqual([
      'insert',
      'delete',
      'plan-v2',
      'other-plan',
    ]);
  });

  it('never coalesces user-scoped snapshots across accounts', () => {
    const operations = [
      { id: 'a', coalesceKey: 'user-a:plan-1' },
      { id: 'b', coalesceKey: 'user-b:plan-1' },
    ];
    expect(coalesceQueuedOperations(operations)).toEqual(operations);
  });

  it('preserves every unkeyed RPC, insert and delete', () => {
    const operations: TestCoalescible[] = [
      { id: 'rpc-1' },
      { id: 'insert-1' },
      { id: 'delete-1' },
      { id: 'rpc-2' },
    ];
    expect(coalesceQueuedOperations(operations)).toEqual(operations);
  });

  it('replaces a stale guarded retry with the newest guarded snapshot', () => {
    const key = 'site-plan-snapshot:user-a:plan-1';
    const operations = [
      { id: 'failed-a', op: 'rpc', coalesceKey: key, rpc: { fn: 'replace_site_plan_file_safely' }, data: { annotations: 'A' } },
      { id: 'latest-b', op: 'rpc', coalesceKey: key, rpc: { fn: 'replace_site_plan_file_safely' }, data: { annotations: 'B' } },
    ];
    expect(coalesceQueuedOperations(operations)).toEqual([operations[1]]);
  });

  it('migrates legacy site-plan updates to the authenticated snapshot key', () => {
    const operations = [
      { id: 'old-a', table: 'site_plans', op: 'update', filter: { column: 'id', value: 'plan-1' }, data: { annotations: 'A' } },
      { id: 'task', table: 'tasks', op: 'update', filter: { column: 'id', value: 'task-1' }, data: { title: 'keep' } },
      { id: 'latest-b', table: 'site_plans', op: 'update', filter: { column: 'id', value: 'plan-1' }, data: { annotations: 'B' } },
    ];

    expect(migrateAndCoalesceSitePlanSnapshots(operations, 'user-a')).toEqual([
      operations[1],
      { ...operations[2], coalesceKey: 'site-plan-snapshot:user-a:plan-1' },
    ]);
  });

  it('keeps guarded file replacement sticky while upgrading the newest legacy payload', () => {
    const operations: TestMigratable[] = [
      {
        id: 'file-a',
        table: 'site_plans',
        op: 'rpc',
        rpc: {
          fn: 'replace_site_plan_file_safely',
          args: { p_plan_id: 'plan-1', p_patch: { uri: 'old.pdf', annotations: 'A' } },
        },
        data: { uri: 'old.pdf', annotations: 'A' },
      },
      {
        id: 'latest-b',
        table: 'site_plans',
        op: 'update',
        filter: { column: 'id', value: 'plan-1' },
        data: { uri: 'new.pdf', annotations: 'B' },
      },
    ];

    const [latest] = migrateAndCoalesceSitePlanSnapshots(operations, 'user-a');
    expect(latest).toMatchObject({
      id: 'latest-b',
      op: 'rpc',
      coalesceKey: 'site-plan-snapshot:user-a:plan-1',
      data: { uri: 'new.pdf', annotations: 'B' },
      rpc: {
        fn: 'replace_site_plan_file_safely',
        args: {
          p_plan_id: 'plan-1',
          p_patch: { uri: 'new.pdf', annotations: 'B' },
          p_reason: 'mobile_upgrade_site_plan_snapshot',
        },
      },
    });
  });

  it('migrates the older guarded-update marker without sending it to the RPC patch', () => {
    const operations: TestMigratable[] = [
      {
        id: 'legacy-file',
        table: 'site_plans',
        op: 'update',
        filter: { column: 'id', value: 'plan-1' },
        data: { uri: 'old.pdf', annotations: 'A', __replace_file_safely: true },
      },
      {
        id: 'latest',
        table: 'site_plans',
        op: 'update',
        filter: { column: 'id', value: 'plan-1' },
        data: { uri: 'new.pdf', annotations: 'B' },
      },
    ];

    const [latest] = migrateAndCoalesceSitePlanSnapshots(operations, 'user-a');
    expect(latest.op).toBe('rpc');
    expect(latest.rpc?.args?.p_patch).toEqual({ uri: 'new.pdf', annotations: 'B' });
    expect(latest.rpc?.args?.p_patch).not.toHaveProperty('__replace_file_safely');
  });

  it('re-scopes anonymous plan snapshots but never another authenticated owner', () => {
    const anonymous = {
      id: 'anon',
      table: 'site_plans',
      op: 'update',
      filter: { column: 'id', value: 'plan-1' },
      data: { annotations: 'A' },
      coalesceKey: 'site-plan-snapshot:anonymous:plan-1',
    };
    const otherOwner = {
      ...anonymous,
      id: 'other',
      coalesceKey: 'site-plan-snapshot:user-b:plan-1',
    };

    expect(migrateAndCoalesceSitePlanSnapshots([anonymous], 'user-a')[0].coalesceKey)
      .toBe('site-plan-snapshot:user-a:plan-1');
    expect(migrateAndCoalesceSitePlanSnapshots([otherOwner], 'user-a'))
      .toEqual([otherOwner]);
  });
});

describe('a protected entry never takes part in coalescing', () => {
  type Entry = CoalescibleQueuedOperation & { id: string };
  const entry = (id: string, over: Partial<Entry> = {}): Entry => (
    { id, coalesceKey: 'K', ...over } as Entry
  );

  it.each([
    ['une purge en attente de reconciliation', { purgeState: 'pending_reconciliation' }],
    ['un refus non acquitte', { terminal: true }],
    ['une quarantaine', { quarantined: true }],
  ])('keeps %s alongside a newer entry sharing its key', (_label, guard) => {
    // Emportee par le coalescing, une purge marquee disparaitrait AVANT que son
    // effet local soit repare : le stock optimiste resterait faux, et plus
    // aucune operation ne viendrait le corriger.
    const kept = coalesceQueuedOperations([
      entry('protegee', guard as Partial<Entry>),
      entry('plus-recente'),
    ]);

    expect(kept.map(operation => operation.id)).toEqual(['protegee', 'plus-recente']);
  });

  it('never lets a protected entry replace an ordinary one either', () => {
    // Elle ne participe PAS : ni remplacee, ni remplacante.
    const kept = coalesceQueuedOperations([
      entry('ordinaire-1'),
      entry('protegee', { terminal: true }),
      entry('ordinaire-2'),
    ]);

    expect(kept.map(operation => operation.id)).toEqual(['protegee', 'ordinaire-2']);
  });

  it('still coalesces ordinary entries', () => {
    // Verrou sur la premisse : tout conserver ferait passer les tests ci-dessus
    // sans rien prouver.
    const kept = coalesceQueuedOperations([entry('ancienne'), entry('recente')]);

    expect(kept.map(operation => operation.id)).toEqual(['recente']);
  });
});
