import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock('../lib/supabase', () => ({
  supabase: null,
  isSupabaseConfigured: false,
  SUPABASE_URL: '',
  SUPABASE_KEY: '',
}));

vi.mock('../lib/sessionExpiry', () => ({
  notifySessionExpired: vi.fn(),
  notifySessionRecovered: vi.fn(),
}));

import {
  commitCachePairWithJournalStrict,
  readCacheStrict,
  writeCacheStrict,
} from '../lib/offlineCache';

describe('strict offline cache helpers', () => {
  beforeEach(() => {
    vi.mocked(AsyncStorage.getItem).mockReset();
    vi.mocked(AsyncStorage.setItem).mockReset();
    vi.mocked(AsyncStorage.removeItem).mockReset();
  });

  it('reads and writes the same user-scoped durable snapshot', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce('[{"id":"p-1"}]');

    await expect(readCacheStrict<{ id: string }>('products_site-1', 'user-1')).resolves.toEqual([
      { id: 'p-1' },
    ]);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('products_site-1_user-1');

    await writeCacheStrict('products_site-1', [{ id: 'p-1' }], 'user-1');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'products_site-1_user-1',
      '[{"id":"p-1"}]',
    );
  });

  it('propagates read, parse, and write failures to keep acknowledgement fail-closed', async () => {
    const readFailure = new Error('storage unavailable');
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(readFailure);
    await expect(readCacheStrict('products_site-1', 'user-1')).rejects.toBe(readFailure);

    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce('{invalid');
    await expect(readCacheStrict('products_site-1', 'user-1')).rejects.toBeInstanceOf(SyntaxError);

    const writeFailure = new Error('storage full');
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(writeFailure);
    await expect(writeCacheStrict('products_site-1', [], 'user-1')).rejects.toBe(writeFailure);
  });

  it('replays the original journal target after one of two cache writes fails', async () => {
    const storage = new Map<string, string>();
    vi.mocked(AsyncStorage.getItem).mockImplementation(async key => storage.get(key) ?? null);
    vi.mocked(AsyncStorage.removeItem).mockImplementation(async key => {
      storage.delete(key);
    });

    let failMovementsOnce = true;
    vi.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      if (key === 'movements_site-1_user-1' && failMovementsOnce) {
        failMovementsOnce = false;
        throw new Error('partial write');
      }
      storage.set(key, value);
    });

    const commit = (firstData: Array<{ stock: number }>) => commitCachePairWithJournalStrict({
      journalKey: 'terminal_operation-1',
      firstKey: 'products_site-1',
      firstData,
      secondKey: 'movements_site-1',
      secondData: [] as Array<{ id: string }>,
      userId: 'user-1',
    });

    await expect(commit([{ stock: 10 }])).rejects.toThrow('partial write');
    expect(storage.get('products_site-1_user-1')).toBe('[{"stock":10}]');
    expect(storage.has('terminal_operation-1_user-1')).toBe(true);

    // A recomputed relative rollback could now suggest 13. The retained
    // journal must replay the first target (10) instead.
    await expect(commit([{ stock: 13 }])).resolves.toMatchObject({
      firstData: [{ stock: 10 }],
      secondData: [],
      resumed: true,
    });
    expect(storage.get('products_site-1_user-1')).toBe('[{"stock":10}]');
    expect(storage.get('movements_site-1_user-1')).toBe('[]');
    expect(storage.has('terminal_operation-1_user-1')).toBe(false);
  });
});
