import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

const CACHE_DIR = `${FileSystem.documentDirectory ?? ''}plans_cache/`;
const MANIFEST_PATH = `${CACHE_DIR}.manifest.json`;
const MAX_CACHE_SIZE = 500 * 1024 * 1024;

type ManifestEntry = {
  url: string;
  size: number;
  lastAccess: number;
  filename: string;
};

type Manifest = {
  version: 1;
  entries: Record<string, ManifestEntry>;
};

function hashUrl(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function extOf(url: string): string {
  try {
    const clean = url.split('?')[0].split('#')[0];
    const m = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (m) return m[1].toLowerCase();
  } catch {}
  return 'bin';
}

async function ensureCacheDir(): Promise<void> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return;
  try {
    const info = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
  } catch (e) {
    console.warn('[planCache] ensureCacheDir failed:', e);
  }
}

async function loadManifest(): Promise<Manifest> {
  if (Platform.OS === 'web') return { version: 1, entries: {} };
  try {
    const info = await FileSystem.getInfoAsync(MANIFEST_PATH);
    if (!info.exists) return { version: 1, entries: {} };
    const txt = await FileSystem.readAsStringAsync(MANIFEST_PATH);
    const m = JSON.parse(txt);
    if (m && m.version === 1 && m.entries && typeof m.entries === 'object') {
      return m;
    }
  } catch (e) {
    console.warn('[planCache] loadManifest failed:', e);
  }
  return { version: 1, entries: {} };
}

async function saveManifest(m: Manifest): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await FileSystem.writeAsStringAsync(MANIFEST_PATH, JSON.stringify(m));
  } catch (e) {
    console.warn('[planCache] saveManifest failed:', e);
  }
}

async function evictIfNeeded(m: Manifest): Promise<Manifest> {
  let total = Object.values(m.entries).reduce((sum, e) => sum + e.size, 0);
  if (total <= MAX_CACHE_SIZE) return m;

  const sorted = Object.entries(m.entries).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  for (const [key, entry] of sorted) {
    if (total <= MAX_CACHE_SIZE) break;
    try {
      const path = `${CACHE_DIR}${entry.filename}`;
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch (e) {
      console.warn('[planCache] evict delete failed:', e);
    }
    total -= entry.size;
    delete m.entries[key];
  }
  return m;
}

/**
 * Returns the local file:// URI of a cached plan, or null if not cached.
 * Updates lastAccess timestamp on a hit. Safe to call when offline.
 */
export async function getCachedPlanUri(remoteUrl: string): Promise<string | null> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return null;
  if (!remoteUrl) return null;
  try {
    const key = hashUrl(remoteUrl);
    const m = await loadManifest();
    const entry = m.entries[key];
    if (!entry) return null;
    const path = `${CACHE_DIR}${entry.filename}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
      delete m.entries[key];
      await saveManifest(m);
      return null;
    }
    entry.lastAccess = Date.now();
    m.entries[key] = entry;
    await saveManifest(m);
    return path;
  } catch (e) {
    console.warn('[planCache] getCachedPlanUri failed:', e);
    return null;
  }
}

/**
 * Downloads the plan to the cache and returns the local file:// URI.
 * If the file is already cached, returns the cached path immediately
 * without hitting the network.
 */
export async function ensurePlanCached(
  remoteUrl: string,
): Promise<{ localUri: string; fromCache: boolean }> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) {
    throw new Error('plan cache is mobile-only');
  }
  if (!remoteUrl) throw new Error('empty url');

  const cached = await getCachedPlanUri(remoteUrl);
  if (cached) return { localUri: cached, fromCache: true };

  await ensureCacheDir();
  const key = hashUrl(remoteUrl);
  const ext = extOf(remoteUrl);
  const filename = `${key}.${ext}`;
  const dest = `${CACHE_DIR}${filename}`;

  const dl = await FileSystem.downloadAsync(remoteUrl, dest);
  if (dl.status && dl.status >= 400) {
    try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch {}
    throw new Error(`HTTP ${dl.status}`);
  }
  const info = await FileSystem.getInfoAsync(dl.uri);
  const size = info.exists && 'size' in info ? (info.size as number) : 0;

  let m = await loadManifest();
  m.entries[key] = {
    url: remoteUrl,
    size,
    lastAccess: Date.now(),
    filename,
  };
  m = await evictIfNeeded(m);
  await saveManifest(m);

  return { localUri: dl.uri, fromCache: false };
}

/**
 * Returns the cached URI immediately if present (works offline);
 * otherwise downloads + caches and returns the new local URI.
 * If we are offline AND not cached, throws — the caller should display
 * an "offline, plan not yet downloaded" message.
 */
export async function getPlanUriCacheFirst(
  remoteUrl: string,
): Promise<{ localUri: string; fromCache: boolean }> {
  const cached = await getCachedPlanUri(remoteUrl);
  if (cached) return { localUri: cached, fromCache: true };
  return ensurePlanCached(remoteUrl);
}

/**
 * Removes every cached plan file. Returns the number of bytes freed.
 */
export async function clearPlanCache(): Promise<number> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return 0;
  try {
    const m = await loadManifest();
    const total = Object.values(m.entries).reduce((sum, e) => sum + e.size, 0);
    const info = await FileSystem.getInfoAsync(CACHE_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
    }
    return total;
  } catch (e) {
    console.warn('[planCache] clearPlanCache failed:', e);
    return 0;
  }
}

/**
 * Reports cache usage for debugging / settings UI.
 */
export async function getPlanCacheStats(): Promise<{ count: number; bytes: number }> {
  if (Platform.OS === 'web') return { count: 0, bytes: 0 };
  const m = await loadManifest();
  const entries = Object.values(m.entries);
  return {
    count: entries.length,
    bytes: entries.reduce((sum, e) => sum + e.size, 0),
  };
}
