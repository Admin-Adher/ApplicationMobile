import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase, SUPABASE_KEY } from './supabase';
import { canonicalApiBaseUrl } from './apiBase';
import { privateMediaClientHeaders } from './clientVersion';

type ResolvedMedia = {
  ref: string;
  assetId: string;
  url: string;
  expiresAt: number;
};

const memoryCache = new Map<string, ResolvedMedia>();
const pending = new Map<string, Promise<string | null>>();
const MEDIA_CACHE_ROOT = `${FileSystem.cacheDirectory ?? ''}btmedia-v2/`;

type MediaSession = {
  userId: string;
  token: string | null;
};

let offlineMediaUserId: string | null = null;

export function setMediaCacheUserId(userId: string | null): void {
  offlineMediaUserId = userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null;
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

async function mediaSession(): Promise<MediaSession | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  const userId = session?.user?.id ?? offlineMediaUserId;
  if (!userId) return null;
  const token = session?.access_token && session.access_token !== SUPABASE_KEY
    ? session.access_token
    : null;
  return { userId, token };
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

async function cacheOnDisk(userId: string, ref: string, assetId: string, url: string): Promise<string | null> {
  const path = diskPath(userId, ref, assetId);
  if (!path) return null;
  const existing = await existingDiskPath(userId, ref, assetId);
  if (existing) return existing;
  const directory = `${MEDIA_CACHE_ROOT}${userId}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => {});
  const result = await FileSystem.downloadAsync(url, path).catch(() => null);
  return result?.status && result.status >= 200 && result.status < 300 ? result.uri : null;
}

async function resolveBatch(refs: string[], session: MediaSession): Promise<Map<string, ResolvedMedia>> {
  const resolved = new Map<string, ResolvedMedia>();
  const unique = Array.from(new Set(refs.filter(isManagedMediaRef))).slice(0, 100);
  if (unique.length === 0 || !session.token) return resolved;

  const base = apiBaseUrl();
  const response = await fetch(base ? `${base}/api/storage/resolve` : '/api/storage/resolve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
      ...privateMediaClientHeaders(),
    },
    body: JSON.stringify({ refs: unique }),
  });
  if (!response.ok) return resolved;
  const body = await response.json().catch(() => ({}));
  for (const item of Array.isArray(body?.assets) ? body.assets : []) {
    if (!item?.ref || !item?.assetId || !item?.url) continue;
    const entry: ResolvedMedia = {
      ref: item.ref,
      assetId: item.assetId,
      url: item.url,
      expiresAt: Number(item.expiresAt ?? Date.now() + 5 * 60_000),
    };
    memoryCache.set(scopedKey(session.userId, entry.ref), entry);
    memoryCache.set(scopedKey(session.userId, `btmedia://${entry.assetId}`), entry);
    resolved.set(entry.ref, entry);
  }
  return resolved;
}

export async function resolveMediaRefs(refs: string[], options?: { cacheDisk?: boolean }): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  const missing: string[] = [];
  const managed = refs.filter(isManagedMediaRef);
  const session = managed.length > 0 ? await mediaSession() : null;
  for (const ref of refs) {
    if (!isManagedMediaRef(ref)) {
      output[ref] = ref;
      continue;
    }
    if (!session) continue;
    const assetId = ref.match(/^btmedia:\/\/([0-9a-f-]{36})$/i)?.[1];
    const disk = await existingDiskPath(session.userId, ref, assetId);
    if (disk) {
      output[ref] = disk;
      continue;
    }
    const cached = cachedValue(session.userId, ref);
    if (cached) output[ref] = cached;
    else missing.push(ref);
  }

  if (!session) return output;
  const fresh = await resolveBatch(missing, session);
  for (const ref of missing) {
    const item = fresh.get(ref) ?? memoryCache.get(scopedKey(session.userId, ref));
    if (!item) continue;
    let url = item.url;
    if (options?.cacheDisk !== false && Platform.OS !== 'web') {
      url = await cacheOnDisk(session.userId, ref, item.assetId, item.url) ?? item.url;
    }
    output[ref] = url;
  }
  return output;
}

export async function resolveMediaRef(ref: string, options?: { cacheDisk?: boolean }): Promise<string | null> {
  if (!isManagedMediaRef(ref)) return ref;
  const session = await mediaSession();
  if (!session) return null;
  const key = scopedKey(session.userId, ref);
  const existing = pending.get(key);
  if (existing) return existing;
  const work = resolveMediaRefs([ref], options).then(result => result[ref] ?? null).finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}

export function clearMediaUrlCache(): void {
  memoryCache.clear();
  pending.clear();
}

export async function clearMediaDiskCache(): Promise<void> {
  clearMediaUrlCache();
  if (Platform.OS === 'web' || !FileSystem.cacheDirectory) return;
  await FileSystem.deleteAsync(MEDIA_CACHE_ROOT, { idempotent: true }).catch(() => {});
  // Remove the former unscoped cache so an upgrade cannot preserve media from
  // another account on the same device.
  await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}btmedia/`, { idempotent: true }).catch(() => {});
}
