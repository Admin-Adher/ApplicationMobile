import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

const BASE_KEY = 'buildtrack_rq_cache_v1';
const LAST_USER_KEY = 'buildtrack_rq_cache_last_user_v1';

let currentUserId: string | null = null;
let lastUserHydrationAttempted = false;

function userScopedKey(userId: string | null): string {
  return userId ? `${BASE_KEY}_${userId}` : BASE_KEY;
}

const namespacedStorage = {
  getItem: async (_key: string): Promise<string | null> => {
    if (!currentUserId && !lastUserHydrationAttempted) {
      lastUserHydrationAttempted = true;
      try {
        const last = await AsyncStorage.getItem(LAST_USER_KEY);
        if (last) currentUserId = last;
      } catch {}
    }
    try {
      return await AsyncStorage.getItem(userScopedKey(currentUserId));
    } catch {
      return null;
    }
  },
  setItem: async (_key: string, value: string): Promise<void> => {
    try {
      // ── Size guard ────────────────────────────────────────────────────────
      // AsyncStorage is limited to ~6 MB on Android. The RQ cache stores every
      // query result (reserves, photos, chantiers, lots, companies, …) in a
      // single key. On large projects this can overflow and fill the device.
      // If the serialised cache exceeds 4 MB we skip writing rather than risk
      // a quota error that would corrupt or silently drop other app data.
      const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
      if (value.length > MAX_BYTES) {
        console.warn(
          '[queryPersister] cache too large (' + Math.round(value.length / 1024) + ' KB) — skipping persist to avoid storage overflow',
        );
        return;
      }
      await AsyncStorage.setItem(userScopedKey(currentUserId), value);
    } catch {}
  },
  removeItem: async (_key: string): Promise<void> => {
    try {
      await AsyncStorage.removeItem(userScopedKey(currentUserId));
    } catch {}
  },
};

export function setPersisterUserId(userId: string | null): void {
  currentUserId = userId;
  lastUserHydrationAttempted = true;
  if (userId) {
    AsyncStorage.setItem(LAST_USER_KEY, userId).catch(() => {});
  }
}

export async function clearPersistedRqCache(userId: string | null): Promise<void> {
  const k = userScopedKey(userId);
  try { await AsyncStorage.removeItem(k); } catch {}
  if (!userId) {
    try { await AsyncStorage.removeItem(LAST_USER_KEY); } catch {}
  }
}

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: namespacedStorage,
  key: BASE_KEY,
  throttleTime: 1000,
});
