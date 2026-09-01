import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { canonicalApiBaseUrl } from './apiBase';
import { privateMediaClientHeaders } from './clientVersion';
import { createKeyedBatcher, type KeyedBatcher } from './mediaBatcher';
import {
  clearSupabaseRestTokenCache,
  getSupabaseAuthenticatedSession,
} from './supabaseRest';

type ResolvedMedia = {
  ref: string;
  assetId: string;
  url: string;
  expiresAt: number;
};

type MediaSession = {
  userId: string;
  token: string | null;
};

export type MediaResolutionFailureCode =
  | 'account_changed'
  | 'forbidden'
  | 'http'
  | 'invalid_response'
  | 'network'
  | 'not_found'
  | 'session_unavailable'
  | 'timeout';

export class MediaResolutionError extends Error {
  readonly code: MediaResolutionFailureCode;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    code: MediaResolutionFailureCode,
    message: string,
    options?: { retryable?: boolean; status?: number | null },
  ) {
    super(message);
    this.name = 'MediaResolutionError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.status = options?.status ?? null;
  }
}

const memoryCache = new Map<string, ResolvedMedia>();
const batchers = new Map<string, KeyedBatcher<string>>();
const MEDIA_CACHE_ROOT = `${FileSystem.cacheDirectory ?? ''}btmedia-v2/`;
const MEDIA_BATCH_WINDOW_MS = 20;
const MEDIA_RESOLVE_TIMEOUT_MS = 12_000;
const MEDIA_RESPONSE_TIMEOUT_MS = 4_000;
const MEDIA_DISK_WARM_DELAY_MS = 1_500;
const MEDIA_DISK_WARM_CONCURRENCY = 2;

type DiskWarmTask = {
  assetId: string;
  generation: number;
  ref: string;
  url: string;
  userId: string;
};

let offlineMediaUserId: string | null = null;
let mediaGeneration = 0;
let diskWarmTimer: ReturnType<typeof setTimeout> | null = null;
let activeDiskWarms = 0;
let diskWarmQueue: DiskWarmTask[] = [];
const scheduledDiskWarms = new Set<string>();

function mediaError(
  code: MediaResolutionFailureCode,
  message: string,
  retryable = false,
  status: number | null = null,
): MediaResolutionError {
  return new MediaResolutionError(code, message, { retryable, status });
}

function normalizeUserId(userId: string | null): string | null {
  return userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null;
}

function invalidateBatchers(reason: Error): void {
  mediaGeneration += 1;
  for (const batcher of batchers.values()) batcher.clear(reason);
  batchers.clear();
}

export function setMediaCacheUserId(userId: string | null): void {
  const nextUserId = normalizeUserId(userId);
  if (nextUserId === offlineMediaUserId) return;
  offlineMediaUserId = nextUserId;
  invalidateBatchers(mediaError('account_changed', 'Le compte actif a changé', true));
}

export function currentMediaCacheUserId(): string | null {
  return offlineMediaUserId;
}

function apiBaseUrl(): string {
  return canonicalApiBaseUrl();
}

export function isManagedMediaRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^btmedia:\/\/[0-9a-f-]{36}$/i.test(value)) return true;
  if (/^https:\/\/[^/]+[.]supabase[.]co\/storage\/v1\/object\/(?:public|sign|authenticated)\/(?:photos|documents)\//i.test(value)) return true;
  return /^https:\/\/buildtrack-files[.]customersuccess-kang[.]workers[.]dev\//i.test(value)
    || Boolean(process.env.EXPO_PUBLIC_R2_PUBLIC_BASE_URL && value.startsWith(process.env.EXPO_PUBLIC_R2_PUBLIC_BASE_URL));
}

function scopedKey(userId: string, ref: string): string {
  return `${userId}:${ref}`;
}

async function mediaSession(expectedUserId?: string | null): Promise<MediaSession> {
  const session = await getSupabaseAuthenticatedSession();
  if (!session) {
    throw mediaError(
      'session_unavailable',
      'Aucune session utilisateur exploitable pour ce média',
      true,
    );
  }
  if (expectedUserId && session.userId !== expectedUserId) {
    throw mediaError(
      'account_changed',
      'Le média appartient à une autre session locale',
      true,
    );
  }
  return { userId: session.userId, token: session.accessToken };
}

function cachedValue(userId: string, ref: string): string | null {
  const cached = memoryCache.get(scopedKey(userId, ref));
  if (!cached || cached.expiresAt - 60_000 <= Date.now()) return null;
  return cached.url;
}

function refCacheId(ref: string, assetId?: string): string {
  if (/^btmedia:\/\//i.test(ref) && assetId && /^[0-9a-f-]{36}$/i.test(assetId)) return assetId;
  let hash = 0x811c9dc5;
  for (let index = 0; index < ref.length; index += 1) {
    hash ^= ref.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `legacy-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function diskPath(userId: string, ref: string, assetId?: string): string | null {
  if (Platform.OS === 'web' || !FileSystem.cacheDirectory) return null;
  return `${MEDIA_CACHE_ROOT}${userId}/${refCacheId(ref, assetId)}`;
}

async function existingDiskPath(userId: string, ref: string, assetId?: string): Promise<string | null> {
  const path = diskPath(userId, ref, assetId);
  if (!path) return null;
  const info = await FileSystem.getInfoAsync(path).catch(() => null);
  return info?.exists ? path : null;
}

async function cacheOnDisk(task: DiskWarmTask): Promise<string | null> {
  const path = diskPath(task.userId, task.ref, task.assetId);
  if (!path || task.generation !== mediaGeneration) return null;
  const existing = await existingDiskPath(task.userId, task.ref, task.assetId);
  if (existing) return existing;
  const directory = `${MEDIA_CACHE_ROOT}${task.userId}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => {});
  const result = await FileSystem.downloadAsync(task.url, path).catch(() => null);
  if (task.generation !== mediaGeneration) {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    return null;
  }
  return result?.status && result.status >= 200 && result.status < 300 ? result.uri : null;
}

function pumpDiskWarmQueue(): void {
  if (diskWarmTimer) {
    clearTimeout(diskWarmTimer);
    diskWarmTimer = null;
  }
  while (activeDiskWarms < MEDIA_DISK_WARM_CONCURRENCY && diskWarmQueue.length > 0) {
    const task = diskWarmQueue.shift()!;
    const taskKey = scopedKey(task.userId, task.ref);
    if (task.generation !== mediaGeneration) {
      scheduledDiskWarms.delete(taskKey);
      continue;
    }
    activeDiskWarms += 1;
    void cacheOnDisk(task).finally(() => {
      activeDiskWarms -= 1;
      scheduledDiskWarms.delete(taskKey);
      pumpDiskWarmQueue();
    });
  }
}

function scheduleDiskWarm(task: Omit<DiskWarmTask, 'generation'>): void {
  if (Platform.OS === 'web' || !FileSystem.cacheDirectory) return;
  const taskKey = scopedKey(task.userId, task.ref);
  if (scheduledDiskWarms.has(taskKey)) return;
  scheduledDiskWarms.add(taskKey);
  diskWarmQueue.push({ ...task, generation: mediaGeneration });
  if (!diskWarmTimer && activeDiskWarms === 0) {
    diskWarmTimer = setTimeout(pumpDiskWarmQueue, MEDIA_DISK_WARM_DELAY_MS);
  }
}

async function sendResolveRequest(
  refs: string[],
  session: MediaSession,
): Promise<Response> {
  if (!session.token) {
    throw mediaError('session_unavailable', 'Jeton utilisateur indisponible', true);
  }
  const base = apiBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_RESOLVE_TIMEOUT_MS);
  try {
    return await fetch(base ? `${base}/api/storage/resolve` : '/api/storage/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        ...privateMediaClientHeaders(),
      },
      body: JSON.stringify({ refs }),
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw mediaError('timeout', 'Le service média a dépassé le délai maximal', true);
    }
    throw mediaError('network', 'Le service média est temporairement injoignable', true);
  } finally {
    clearTimeout(timer);
  }
}

async function readResolveBody(response: Response): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      response.json().catch(() => {
        throw mediaError('invalid_response', 'Réponse du service média invalide', true);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(
          mediaError('timeout', 'Lecture de la réponse média trop longue', true),
        ), MEDIA_RESPONSE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveBatch(
  refs: string[],
  session: MediaSession,
  expectedGeneration: number,
): Promise<Map<string, ResolvedMedia>> {
  const resolved = new Map<string, ResolvedMedia>();
  const unique = Array.from(new Set(refs.filter(isManagedMediaRef))).slice(0, 100);
  if (unique.length === 0) return resolved;

  let activeSession = session;
  let response = await sendResolveRequest(unique, activeSession);
  if (response.status === 401) {
    clearSupabaseRestTokenCache();
    const refreshed = await getSupabaseAuthenticatedSession({ forceRefresh: true });
    if (!refreshed || refreshed.userId !== session.userId) {
      throw mediaError('session_unavailable', 'La session média doit être renouvelée', true, 401);
    }
    activeSession = { userId: refreshed.userId, token: refreshed.accessToken };
    response = await sendResolveRequest(unique, activeSession);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw mediaError('session_unavailable', 'La session média est refusée', true, 401);
    }
    if (response.status === 403) {
      throw mediaError('forbidden', 'Accès au média refusé', false, 403);
    }
    throw mediaError(
      'http',
      'Le service média a répondu en erreur',
      response.status === 408 || response.status === 429 || response.status >= 500,
      response.status,
    );
  }

  const body = await readResolveBody(response);
  if (!body || !Array.isArray(body.assets)) {
    throw mediaError('invalid_response', 'Réponse du service média invalide', true);
  }
  if (expectedGeneration !== mediaGeneration) {
    throw mediaError('account_changed', 'La session média a changé', true);
  }

  for (const item of body.assets) {
    if (!item?.ref || !item?.assetId || !item?.url) continue;
    const rawExpiresAt = Number(item.expiresAt);
    const entry: ResolvedMedia = {
      ref: item.ref,
      assetId: item.assetId,
      url: item.url,
      expiresAt: Number.isFinite(rawExpiresAt) ? rawExpiresAt : Date.now() + 5 * 60_000,
    };
    memoryCache.set(scopedKey(activeSession.userId, entry.ref), entry);
    memoryCache.set(scopedKey(activeSession.userId, `btmedia://${entry.assetId}`), entry);
    resolved.set(entry.ref, entry);
  }
  return resolved;
}

async function resolveMediaRefsWithSession(
  refs: string[],
  session: MediaSession | null,
  options?: { cacheDisk?: boolean },
): Promise<Record<string, string>> {
  const expectedGeneration = mediaGeneration;
  const output: Record<string, string> = {};
  const unique = Array.from(new Set(refs));
  const managed = unique.filter(isManagedMediaRef);

  for (const ref of unique) {
    if (!isManagedMediaRef(ref)) output[ref] = ref;
  }
  if (!session || managed.length === 0) return output;

  const localResults = await Promise.all(managed.map(async ref => {
    const assetId = ref.match(/^btmedia:\/\/([0-9a-f-]{36})$/i)?.[1];
    const disk = await existingDiskPath(session.userId, ref, assetId);
    return { disk, ref };
  }));

  const missing: string[] = [];
  for (const { disk, ref } of localResults) {
    if (disk) {
      output[ref] = disk;
      continue;
    }
    const cached = cachedValue(session.userId, ref);
    if (cached) output[ref] = cached;
    else missing.push(ref);
  }

  if (!session.token) return output;

  const fresh = missing.length > 0
    ? await resolveBatch(missing, session, expectedGeneration)
    : new Map<string, ResolvedMedia>();
  if (expectedGeneration !== mediaGeneration) {
    throw mediaError('account_changed', 'La session média a changé', true);
  }
  for (const ref of managed) {
    if (output[ref]) continue;
    const item = fresh.get(ref) ?? memoryCache.get(scopedKey(session.userId, ref));
    if (!item) continue;

    // Render from the signed URL immediately. Waiting for FileSystem.downloadAsync
    // here blocked every thumbnail behind a full second download. The durable
    // offline copy is warmed later with bounded concurrency so it cannot starve
    // the visible image requests.
    output[ref] = item.url;
    if (options?.cacheDisk !== false) {
      scheduleDiskWarm({
        assetId: item.assetId,
        ref,
        url: item.url,
        userId: session.userId,
      });
    }
  }
  return output;
}

function batcherFor(
  expectedUserId: string | null,
  options?: { cacheDisk?: boolean },
): KeyedBatcher<string> {
  const cacheDisk = options?.cacheDisk !== false;
  const scope = `${expectedUserId ?? 'active-session'}:${cacheDisk ? 'disk' : 'remote'}`;
  const existing = batchers.get(scope);
  if (existing) return existing;

  const generation = mediaGeneration;
  const batcher = createKeyedBatcher<string>(async refs => {
    if (generation !== mediaGeneration) {
      throw mediaError('account_changed', 'La session média a changé', true);
    }
    const session = await mediaSession(expectedUserId);
    const output = await resolveMediaRefsWithSession(refs, session, { cacheDisk });
    if (generation !== mediaGeneration) {
      throw mediaError('account_changed', 'La session média a changé', true);
    }
    return new Map(Object.entries(output));
  }, {
    delayMs: MEDIA_BATCH_WINDOW_MS,
    maxBatchSize: 100,
    missingError: () => mediaError('not_found', 'Média introuvable ou hors périmètre', false),
  });
  batchers.set(scope, batcher);
  return batcher;
}

export async function resolveMediaRefs(
  refs: string[],
  options?: { cacheDisk?: boolean },
): Promise<Record<string, string>> {
  const expectedGeneration = mediaGeneration;
  const hasManagedRef = refs.some(isManagedMediaRef);
  if (!hasManagedRef) return resolveMediaRefsWithSession(refs, null, options);

  // Preserve the account-scoped offline path before touching auth or network.
  const local = offlineMediaUserId
    ? await resolveMediaRefsWithSession(
        refs,
        { userId: offlineMediaUserId, token: null },
        options,
      )
    : {};
  const unresolved = refs.filter(ref => isManagedMediaRef(ref) && !local[ref]);
  if (expectedGeneration !== mediaGeneration) {
    throw mediaError('account_changed', 'La session média a changé', true);
  }
  if (unresolved.length === 0) return local;

  let session: MediaSession;
  try {
    session = await mediaSession(offlineMediaUserId);
  } catch (error) {
    if (error instanceof MediaResolutionError && error.retryable) return local;
    throw error;
  }
  const remote = await resolveMediaRefsWithSession(unresolved, session, options);
  return { ...local, ...remote };
}

export async function resolveMediaRefOrThrow(
  ref: string,
  options?: { cacheDisk?: boolean },
): Promise<string> {
  if (!isManagedMediaRef(ref)) return ref;

  const expectedUserId = offlineMediaUserId;
  const expectedGeneration = mediaGeneration;
  if (expectedUserId) {
    const assetId = ref.match(/^btmedia:\/\/([0-9a-f-]{36})$/i)?.[1];
    const local = await existingDiskPath(expectedUserId, ref, assetId);
    if (
      local &&
      expectedGeneration === mediaGeneration &&
      expectedUserId === offlineMediaUserId
    ) return local;
  }

  return batcherFor(expectedUserId, options).request(ref);
}

export async function resolveMediaRef(
  ref: string,
  options?: { cacheDisk?: boolean },
): Promise<string | null> {
  try {
    return await resolveMediaRefOrThrow(ref, options);
  } catch {
    return null;
  }
}

export function isRetryableMediaResolutionError(error: unknown): boolean {
  return error instanceof MediaResolutionError && error.retryable;
}

export async function invalidateMediaRef(ref: string): Promise<void> {
  const userId = offlineMediaUserId;
  if (!userId || !isManagedMediaRef(ref)) return;
  const key = scopedKey(userId, ref);
  const cached = memoryCache.get(key);
  memoryCache.delete(key);
  if (cached?.assetId) {
    memoryCache.delete(scopedKey(userId, `btmedia://${cached.assetId}`));
  }
  const assetId = cached?.assetId ?? ref.match(/^btmedia:\/\/([0-9a-f-]{36})$/i)?.[1];
  const path = diskPath(userId, ref, assetId);
  if (path) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
}

export function clearMediaUrlCache(): void {
  memoryCache.clear();
  invalidateBatchers(mediaError('account_changed', 'Le cache média a été invalidé', true));
  if (diskWarmTimer) clearTimeout(diskWarmTimer);
  diskWarmTimer = null;
  diskWarmQueue = [];
  scheduledDiskWarms.clear();
}

export async function clearMediaDiskCache(): Promise<void> {
  clearMediaUrlCache();
  if (Platform.OS === 'web' || !FileSystem.cacheDirectory) return;
  await FileSystem.deleteAsync(MEDIA_CACHE_ROOT, { idempotent: true }).catch(() => {});
  // Remove the former unscoped cache so an upgrade cannot preserve media from
  // another account on the same device.
  await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}btmedia/`, { idempotent: true }).catch(() => {});
}
