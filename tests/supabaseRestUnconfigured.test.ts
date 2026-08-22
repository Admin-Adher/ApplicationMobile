import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fichier separe : `vi.mock` est hisse par fichier, on ne peut pas faire
 * cohabiter une configuration presente et une configuration absente.
 *
 * C'est justement l'absence d'URL qui rend `isSupabaseConfigured` faux, donc
 * le cas ou `tableUrl()` et `rpcUrl()` levaient « Supabase URL missing » avant
 * que le garde-fou de `restRequest` ne soit atteint.
 */
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  isSupabaseConfigured: false,
  SUPABASE_KEY: undefined,
  SUPABASE_URL: undefined,
}));

vi.mock('../lib/offlineCache', () => ({
  forceRefreshSession: async () => null,
  getSessionFromStorage: async () => null,
}));

const {
  supabaseRestMutation,
  supabaseRestRpc,
  supabaseRestSelect,
} = await import('../lib/supabaseRest');

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const EXPECTED_META = { status: null, reachedServer: false, retryAfter: null };

describe('unconfigured Supabase', () => {
  it('returns a complete result instead of throwing on URL construction', async () => {
    const results = await Promise.all([
      supabaseRestSelect('reserves'),
      supabaseRestMutation('reserves', 'insert', { id: 'R1' }),
      supabaseRestMutation('reserves', 'update', { a: 1 }, { column: 'id', value: 'R1' }),
      supabaseRestMutation('reserves', 'delete', undefined, { column: 'id', value: 'R1' }),
      supabaseRestRpc('record_inventory_movement', {}),
    ]);

    for (const result of results) {
      expect(result.data).toBeNull();
      expect(result.error.code).toBe('SUPABASE_NOT_CONFIGURED');
      // Aucune branche normale ne renvoie plus l'ancienne forme sans `meta`.
      expect(result.meta).toEqual(EXPECTED_META);
    }
  });

  it('never reaches the network', async () => {
    await supabaseRestSelect('reserves');
    await supabaseRestRpc('x', {});

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
