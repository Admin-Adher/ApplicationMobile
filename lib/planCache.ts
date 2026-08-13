import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { currentMediaCacheUserId, isManagedMediaRef, resolveMediaRef, resolveMediaRefs } from './media';
import { resolvePlanCacheScope, resolvePlanDisplaySource } from './planDisplay';
import { supabase } from './supabase';

const LEGACY_CACHE_DIR = `${FileSystem.documentDirectory ?? ''}plans_cache/`;
const CACHE_ROOT = `${FileSystem.documentDirectory ?? ''}plans_cache_v2/`;
const MAX_CACHE_SIZE = 500 * 1024 * 1024;
const PLAN_DOWNLOAD_TIMEOUT_MS = 20_000;
const inFlightDownloads = new Map<string, Promise<{ localUri: string; fromCache: boolean }>>();
const manifestMutationQueues = new Map<string, Promise<void>>();
let legacyCleanup: Promise<void> | null = null;
let cacheGeneration = 0;

type ManifestEntry = {
  url: string;
  size: number;
  lastAccess: number;
  filename: string;
};

type Manifest = {
  version: 2;
  entries: Record<string, ManifestEntry>;
};

async function currentUserScope(): Promise<string | null> {
  return resolvePlanCacheScope(currentMediaCacheUserId(), async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  });
}

function cacheDir(scope: string): string {
  return `${CACHE_ROOT}${scope}/`;
}

function manifestPath(scope: string): string {
  return `${cacheDir(scope)}.manifest.json`;
}

async function removeLegacyUnscopedCache(): Promise<void> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return;
  if (!legacyCleanup) {
    legacyCleanup = FileSystem.deleteAsync(LEGACY_CACHE_DIR, { idempotent: true }).catch(() => {});
  }
  await legacyCleanup;
}

function hashUrl(url: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function extensionOf(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  return clean.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase() ?? 'bin';
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timeout after ${PLAN_DOWNLOAD_TIMEOUT_MS}ms`)),
      PLAN_DOWNLOAD_TIMEOUT_MS,
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function ensureCacheDir(scope: string): Promise<void> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return;
  await removeLegacyUnscopedCache();
  const directory = cacheDir(scope);
  const info = await FileSystem.getInfoAsync(directory).catch(() => null);
  if (!info?.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
}

async function loadManifest(scope: string): Promise<Manifest> {
  if (Platform.OS === 'web') return { version: 2, entries: {} };
  await removeLegacyUnscopedCache();
  try {
    const path = manifestPath(scope);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return { version: 2, entries: {} };
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path));
    if (parsed?.version === 2 && parsed.entries && typeof parsed.entries === 'object') {
      return parsed as Manifest;
    }
  } catch (error) {
    console.warn('[planCache] loadManifest failed:', error);
  }
  return { version: 2, entries: {} };
}

async function saveManifest(scope: string, manifest: Manifest): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await ensureCacheDir(scope);
    await FileSystem.writeAsStringAsync(manifestPath(scope), JSON.stringify(manifest));
  } catch (error) {
    console.warn('[planCache] saveManifest failed:', error);
    throw error;
  }
}

/** Serializes every read-modify-write cycle for one account's manifest. */
async function mutateManifest(
  scope: string,
  mutate: (manifest: Manifest) => Promise<Manifest | void> | Manifest | void,
): Promise<void> {
  const previous = manifestMutationQueues.get(scope) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      let manifest = await loadManifest(scope);
      manifest = (await mutate(manifest)) ?? manifest;
      await saveManifest(scope, manifest);
    });
  manifestMutationQueues.set(scope, next);
  try {
    await next;
  } finally {
    if (manifestMutationQueues.get(scope) === next) manifestMutationQueues.delete(scope);
  }
}

async function evictIfNeeded(scope: string, manifest: Manifest): Promise<Manifest> {
  let total = Object.values(manifest.entries).reduce((sum, entry) => sum + entry.size, 0);
  if (total <= MAX_CACHE_SIZE) return manifest;

  const oldestFirst = Object.entries(manifest.entries)
    .sort((left, right) => left[1].lastAccess - right[1].lastAccess);
  for (const [key, entry] of oldestFirst) {
    if (total <= MAX_CACHE_SIZE) break;
    await FileSystem.deleteAsync(`${cacheDir(scope)}${entry.filename}`, { idempotent: true }).catch(() => {});
    total -= entry.size;
    delete manifest.entries[key];
  }
  return manifest;
}

async function getCachedPlanUriForScope(scope: string, remoteUrl: string): Promise<string | null> {
  const key = hashUrl(remoteUrl);
  const manifest = await loadManifest(scope);
  const entry = manifest.entries[key];
  if (!entry) return null;
  const path = `${cacheDir(scope)}${entry.filename}`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await mutateManifest(scope, latest => {
      delete latest.entries[key];
    });
    return null;
  }
  const lastAccess = Date.now();
  // LRU bookkeeping must not delay an otherwise instant cache hit.
  void mutateManifest(scope, latest => {
    if (latest.entries[key]) latest.entries[key].lastAccess = lastAccess;
  }).catch(() => {});
  return path;
}

async function ensurePlanCachedForScope(
  scope: string,
  remoteUrl: string,
  preResolvedUrl?: string,
): Promise<{ localUri: string; fromCache: boolean }> {
  const key = hashUrl(remoteUrl);
  const inFlightKey = `${scope}:${key}`;
  const existing = inFlightDownloads.get(inFlightKey);
  if (existing) return existing;
  const generation = cacheGeneration;

  const download = (async () => {
    const cached = await getCachedPlanUriForScope(scope, remoteUrl).catch(() => null);
    if (cached) return { localUri: cached, fromCache: true };

    await ensureCacheDir(scope);
    const resolvedUrl = preResolvedUrl ?? await resolveMediaRef(remoteUrl, { cacheDisk: false });
    if (!resolvedUrl) throw new Error('plan access denied or unavailable');
    const filename = `${key}.${extensionOf(resolvedUrl)}`;
    const destination = `${cacheDir(scope)}${filename}`;
    let result: FileSystem.FileSystemDownloadResult;
    try {
      if (resolvedUrl.startsWith('file://')) {
        await withTimeout(
          FileSystem.copyAsync({ from: resolvedUrl, to: destination }),
          'plan cache copy',
        );
        result = { uri: destination, status: 200, headers: {}, mimeType: null };
      } else {
        result = await withTimeout(
          FileSystem.downloadAsync(resolvedUrl, destination),
          'plan download',
        );
      }
    } catch (error) {
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
      throw error;
    }
    if (result.status && result.status >= 400) {
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
      throw new Error(`HTTP ${result.status}`);
    }
    if (generation !== cacheGeneration) {
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
      throw new Error('plan cache was cleared during download');
    }

    const info = await FileSystem.getInfoAsync(result.uri);
    const size = info.exists && 'size' in info ? Number(info.size) : 0;
    await mutateManifest(scope, async manifest => {
      if (generation !== cacheGeneration) {
        await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
        throw new Error('plan cache was cleared before manifest commit');
      }
      manifest.entries[key] = {
        url: remoteUrl,
        size,
        lastAccess: Date.now(),
        filename,
      };
      return evictIfNeeded(scope, manifest);
    });
    return { localUri: result.uri, fromCache: false };
  })();

  inFlightDownloads.set(inFlightKey, download);
  try {
    return await download;
  } finally {
    if (inFlightDownloads.get(inFlightKey) === download) {
      inFlightDownloads.delete(inFlightKey);
    }
  }
}

/** Returns a cached plan only inside the currently authenticated user's scope. */
export async function getCachedPlanUri(remoteUrl: string): Promise<string | null> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory || !remoteUrl) return null;
  try {
    const scope = await currentUserScope();
    return scope ? await getCachedPlanUriForScope(scope, remoteUrl) : null;
  } catch (error) {
    console.warn('[planCache] getCachedPlanUri failed:', error);
    return null;
  }
}

/** Downloads a plan into the authenticated user's private offline cache. */
export async function ensurePlanCached(
  remoteUrl: string,
): Promise<{ localUri: string; fromCache: boolean }> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) {
    throw new Error('plan cache is mobile-only');
  }
  if (!remoteUrl) throw new Error('empty url');

  const scope = await currentUserScope();
  if (!scope) throw new Error('authenticated session required for plan cache');
  return ensurePlanCachedForScope(scope, remoteUrl);
}

export type OfflinePlanSyncResult = {
  total: number;
  available: number;
  failed: number;
};

/**
 * Makes a chantier's plan files durable with bounded network pressure. Managed
 * refs are authorized in one batch, then downloaded by at most `concurrency`
 * workers. The caller controls priority by ordering the input list.
 */
export async function syncPlansForOffline(
  remoteUrls: string[],
  options?: { concurrency?: number },
): Promise<OfflinePlanSyncResult> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) {
    return { total: 0, available: 0, failed: 0 };
  }
  const scope = await currentUserScope();
  if (!scope) throw new Error('authenticated session required for plan cache');
  const accountScope = scope;

  const urls = Array.from(new Set(remoteUrls.filter(Boolean)));
  if (urls.length === 0) return { total: 0, available: 0, failed: 0 };

  const managedUrls = urls.filter(isManagedMediaRef);
  const preResolvedUrls = managedUrls.length > 0
    ? await resolveMediaRefs(managedUrls, { cacheDisk: false }).catch(() => ({} as Record<string, string>))
    : {};
  let cursor = 0;
  let available = 0;
  let failed = 0;
  const workerCount = Math.min(Math.max(1, options?.concurrency ?? 2), urls.length);

  async function worker(): Promise<void> {
    while (cursor < urls.length) {
      const remoteUrl = urls[cursor++];
      try {
        await ensurePlanCachedForScope(accountScope, remoteUrl, preResolvedUrls[remoteUrl]);
        available += 1;
      } catch {
        failed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { total: urls.length, available, failed };
}

/**
 * Returns a local plan immediately when available; otherwise returns the
 * authorized short-lived URL. Durable downloads are owned by the prioritized
 * screen/project sync queues, avoiding a second competing fetch in this path.
 */
export async function getPlanUriForDisplay(
  remoteUrl: string,
): Promise<{ uri: string; fromCache: boolean }> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) {
    throw new Error('plan display resolver is mobile-only');
  }
  if (!remoteUrl) throw new Error('empty url');

  const scope = await currentUserScope();
  if (!scope) throw new Error('authenticated session required for plan access');
  return resolvePlanDisplaySource(remoteUrl, {
    getCachedUri: () => getCachedPlanUriForScope(scope, remoteUrl).catch(() => null),
    resolveRemoteUri: () => resolveMediaRef(remoteUrl, { cacheDisk: false }),
  });
}

/** Clears every account-scoped cache plus the unsafe legacy unscoped cache. */
export async function clearPlanCache(): Promise<number> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return 0;
  try {
    cacheGeneration += 1;
    inFlightDownloads.clear();
    await Promise.allSettled(Array.from(manifestMutationQueues.values()));
    manifestMutationQueues.clear();
    let total = 0;
    const scope = await currentUserScope();
    if (scope) {
      const manifest = await loadManifest(scope);
      total = Object.values(manifest.entries).reduce((sum, entry) => sum + entry.size, 0);
    }
    await FileSystem.deleteAsync(CACHE_ROOT, { idempotent: true }).catch(() => {});
    await FileSystem.deleteAsync(LEGACY_CACHE_DIR, { idempotent: true }).catch(() => {});
    legacyCleanup = Promise.resolve();
    return total;
  } catch (error) {
    console.warn('[planCache] clearPlanCache failed:', error);
    return 0;
  }
}

export async function getPlanCacheStats(): Promise<{ count: number; bytes: number }> {
  if (Platform.OS === 'web') return { count: 0, bytes: 0 };
  const scope = await currentUserScope();
  if (!scope) return { count: 0, bytes: 0 };
  const entries = Object.values((await loadManifest(scope)).entries);
  return {
    count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
}
