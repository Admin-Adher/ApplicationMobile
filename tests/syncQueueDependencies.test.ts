import { describe, expect, it } from 'vitest';
import {
  queueHydrationScopeKey,
  queueReplayPriority,
  queuedInsertMatchesPersistedRow,
} from '../lib/syncQueueDependencies';

describe('queue hydration scope', () => {
  const storageKey = 'buildtrack_offline_queue_v3_user-1';

  it('reloads the same user queue when the authenticated organization arrives', () => {
    expect(queueHydrationScopeKey(storageKey, null)).not.toBe(
      queueHydrationScopeKey(storageKey, 'org-1'),
    );
  });

  it('keeps stable scopes stable and separates organization switches', () => {
    expect(queueHydrationScopeKey(storageKey, ' org-1 ')).toBe(
      queueHydrationScopeKey(storageKey, 'org-1'),
    );
    expect(queueHydrationScopeKey(storageKey, 'org-1')).not.toBe(
      queueHydrationScopeKey(storageKey, 'org-2'),
    );
  });

  it('does not reload a normal queue when profile organization arrives', () => {
    expect(queueHydrationScopeKey(storageKey, null, false)).toBe(
      queueHydrationScopeKey(storageKey, 'org-1', false),
    );
    expect(queueHydrationScopeKey(storageKey, 'org-1', false)).toContain('not-required');
  });
});

describe('sync queue dependency order', () => {
  it('persists a visit before its reserve and links the two last', () => {
    const visit = { table: 'visites', op: 'insert' };
    const reserve = { table: 'reserves', op: 'rpc', rpc: { fn: 'create_reserve_with_photos' } };
    const link = { table: 'visite_reserve_links', op: 'rpc', rpc: { fn: 'link_reserves_to_visite' } };

    expect(queueReplayPriority(visit)).toBeLessThan(queueReplayPriority(reserve));
    expect(queueReplayPriority(reserve)).toBeLessThan(queueReplayPriority(link));
  });
});

describe('duplicate insert verification', () => {
  const queued = {
    id: 'VIS-123',
    organization_id: 'org-a',
    title: 'Visite chantier',
    date: '2026-08-23',
    reserve_ids: [] as string[],
    created_at: '2026-08-23T16:00:00.000Z',
  };

  it('accepts only the same persisted business row', () => {
    expect(queuedInsertMatchesPersistedRow(queued, {
      ...queued,
      created_at: '2026-08-23T18:00:00.000+02:00',
      server_default: true,
    })).toBe(true);
  });

  it('rejects an invisible or missing duplicate row', () => {
    expect(queuedInsertMatchesPersistedRow(queued, null)).toBe(false);
  });

  it('rejects a cross-tenant collision even when the primary key matches', () => {
    expect(queuedInsertMatchesPersistedRow(queued, {
      ...queued,
      organization_id: 'org-b',
    })).toBe(false);
  });

  it('rejects a same-tenant collision with another visit', () => {
    expect(queuedInsertMatchesPersistedRow(queued, {
      ...queued,
      title: 'Autre visite',
    })).toBe(false);
  });
});
