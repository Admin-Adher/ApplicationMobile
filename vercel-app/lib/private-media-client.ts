'use client';

import { supabaseBrowser } from './supabase-browser';

type CachedMediaUrl = { url: string; expiresAt: number };

export type PrivateMediaAccess = {
  managed: boolean;
  status: 'empty' | 'idle' | 'resolving' | 'ready' | 'error';
  url: string;
  reason?: 'session_required' | 'unavailable' | 'temporary_failure';
};

export type PrivateMediaPriority = 'critical' | 'background';

type PrivateMediaRequestOptions = {
  priority?: PrivateMediaPriority;
};

type ResolveFailure = {
  reason: NonNullable<PrivateMediaAccess['reason']>;
};

const resolvedUrls = new Map<string, CachedMediaUrl>();
const retryAfter = new Map<string, number>();
const failures = new Map<string, ResolveFailure>();
const criticalQueuedRefs = new Set<string>();
const backgroundQueuedRefs = new Set<string>();
const resolvingRefs = new Set<string>();
const listeners = new Set<() => void>();
let criticalResolveScheduled = false;
let backgroundResolveScheduled = false;
let criticalFlushPromise: Promise<void> | null = null;
let backgroundFlushPromise: Promise<void> | null = null;

const PRIVATE_MEDIA_HEADERS = {
  'X-BuildTrack-Client': 'web',
  'X-BuildTrack-Client-Version': 'web-current',
  'X-BuildTrack-Media-Protocol': '1',
};

export function isRegistryBackedRef(value: string) {
  return /^btmedia:\/\/[0-9a-f-]{36}$/i.test(value)
    || /\/storage\/v1\/object\/public\/(photos|documents)\//i.test(value)
    || /buildtrack-files\.[^/]*workers\.dev/i.test(value);
}

function emitResolved() {
  for (const listener of listeners) listener();
}

function markFailure(
  refs: string[],
  reason: ResolveFailure['reason'],
  retryDelayMs: number,
) {
  const nextRetry = Date.now() + retryDelayMs;
  refs.forEach(ref => {
    failures.set(ref, { reason });
    retryAfter.set(ref, nextRetry);
  });
}

async function resolveBatch(refs: string[]) {
  try {
    const { data } = await supabaseBrowser.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      markFailure(refs, 'session_required', 5_000);
      return;
    }

    const response = await fetch('/api/storage/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...PRIVATE_MEDIA_HEADERS,
      },
      body: JSON.stringify({ refs }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json().catch(() => ({}));
    const returned = new Set<string>();
    for (const asset of Array.isArray(payload?.assets) ? payload.assets : []) {
      const ref = String(asset?.ref ?? '').trim();
      const url = String(asset?.url ?? '').trim();
      if (!ref || !url) continue;
      returned.add(ref);
      resolvedUrls.set(ref, {
        url,
        expiresAt: Number(asset?.expiresAt ?? Date.now() + 60_000),
      });
      retryAfter.delete(ref);
      failures.delete(ref);
    }

    markFailure(refs.filter(ref => !returned.has(ref)), 'unavailable', 5_000);
  } catch (error) {
    console.warn('[private-media] signed media resolution temporarily unavailable', error);
    markFailure(refs, 'temporary_failure', 5_000);
  } finally {
    refs.forEach(ref => resolvingRefs.delete(ref));
    emitResolved();
  }
}

async function runResolveLane(priority: PrivateMediaPriority) {
  const queue = priority === 'critical' ? criticalQueuedRefs : backgroundQueuedRefs;
  const batchSize = priority === 'critical' ? 10 : 100;
  while (queue.size > 0) {
    const refs = Array.from(queue).slice(0, batchSize);
    refs.forEach(ref => {
      queue.delete(ref);
      resolvingRefs.add(ref);
    });
    await resolveBatch(refs);
  }
}

async function flushResolveLane(priority: PrivateMediaPriority) {
  const queue = priority === 'critical' ? criticalQueuedRefs : backgroundQueuedRefs;
  let lanePromise = priority === 'critical' ? criticalFlushPromise : backgroundFlushPromise;
  if (!lanePromise) {
    lanePromise = runResolveLane(priority).finally(() => {
      if (priority === 'critical') criticalFlushPromise = null;
      else backgroundFlushPromise = null;
    });
    if (priority === 'critical') criticalFlushPromise = lanePromise;
    else backgroundFlushPromise = lanePromise;
  }
  await lanePromise;
  if (queue.size > 0) await flushResolveLane(priority);
}

function queueResolve(ref: string, priority: PrivateMediaPriority = 'background') {
  if (resolvingRefs.has(ref) || (retryAfter.get(ref) ?? 0) > Date.now()) return;
  failures.delete(ref);
  if (priority === 'critical') {
    backgroundQueuedRefs.delete(ref);
    criticalQueuedRefs.add(ref);
    if (criticalResolveScheduled) return;
    criticalResolveScheduled = true;
    queueMicrotask(() => {
      criticalResolveScheduled = false;
      void flushResolveLane('critical');
    });
    return;
  }
  if (criticalQueuedRefs.has(ref) || backgroundQueuedRefs.has(ref)) return;
  backgroundQueuedRefs.add(ref);
  if (backgroundResolveScheduled) return;
  backgroundResolveScheduled = true;
  queueMicrotask(() => {
    backgroundResolveScheduled = false;
    void flushResolveLane('background');
  });
}

export function subscribePrivateMedia(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function peekPrivateMediaAccess(raw: unknown): PrivateMediaAccess {
  const ref = String(raw ?? '').trim();
  if (!ref) return { managed: false, status: 'empty', url: '' };
  if (!isRegistryBackedRef(ref)) return { managed: false, status: 'ready', url: ref };

  const cached = resolvedUrls.get(ref);
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return { managed: true, status: 'ready', url: cached.url };
  }
  if (cached) resolvedUrls.delete(ref);

  const failure = failures.get(ref);
  const throttled = (retryAfter.get(ref) ?? 0) > Date.now();
  if (failure && throttled) {
    return { managed: true, status: 'error', url: '', reason: failure.reason };
  }

  if (criticalQueuedRefs.has(ref) || backgroundQueuedRefs.has(ref) || resolvingRefs.has(ref)) {
    return { managed: true, status: 'resolving', url: '' };
  }
  return { managed: true, status: 'idle', url: '' };
}

export function requestPrivateMedia(raw: unknown, options: PrivateMediaRequestOptions = {}) {
  const ref = String(raw ?? '').trim();
  const snapshot = peekPrivateMediaAccess(ref);
  if (snapshot.managed && options.priority === 'critical' && backgroundQueuedRefs.has(ref)) {
    queueResolve(ref, 'critical');
    return { ...snapshot, status: 'resolving' as const };
  }
  if (snapshot.managed && snapshot.status === 'idle') {
    queueResolve(ref, options.priority);
    return { ...snapshot, status: 'resolving' as const };
  }
  return snapshot;
}

export function privateMediaAccess(raw: unknown, options: PrivateMediaRequestOptions = {}): PrivateMediaAccess {
  return requestPrivateMedia(raw, options);
}

export function privateMediaUrl(raw: unknown) {
  return privateMediaAccess(raw).url;
}

export function retryPrivateMedia(raw: unknown, options: PrivateMediaRequestOptions = {}) {
  const ref = String(raw ?? '').trim();
  if (!ref || !isRegistryBackedRef(ref)) return;
  resolvedUrls.delete(ref);
  failures.delete(ref);
  retryAfter.delete(ref);
  queueResolve(ref, options.priority);
  emitResolved();
}

function waitForPrivateMediaTerminal(ref: string) {
  const terminal = () => {
    const status = peekPrivateMediaAccess(ref).status;
    return status === 'ready' || status === 'error' || status === 'empty';
  };
  if (terminal()) return Promise.resolve();
  return new Promise<void>(resolve => {
    let unsubscribe: () => void = () => undefined;
    const settle = () => {
      if (!terminal()) return;
      unsubscribe();
      resolve();
    };
    unsubscribe = subscribePrivateMedia(settle);
    settle();
  });
}

export async function resolvePrivateMediaRefs(
  refs: string[],
  options: PrivateMediaRequestOptions = { priority: 'critical' },
) {
  const priority = options.priority ?? 'critical';
  const managedRefs = Array.from(new Set(refs.filter(isRegistryBackedRef)));
  managedRefs.forEach(ref => {
    if (peekPrivateMediaAccess(ref).status === 'ready') return;
    retryAfter.delete(ref);
    failures.delete(ref);
    queueResolve(ref, priority);
  });
  await Promise.all(managedRefs.map(waitForPrivateMediaTerminal));
  return new Map(refs.map(ref => [ref, peekPrivateMediaAccess(ref).url]));
}

export async function uploadRegisteredWebFile(
  bucket: 'photos' | 'documents',
  file: File,
  prefix: string,
) {
  const safe = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const filename = `${safe(prefix)}_${Date.now()}_${safe(file.name || 'upload')}`;
  const contentType = file.type || (bucket === 'photos' ? 'image/jpeg' : 'application/octet-stream');
  const { data } = await supabaseBrowser.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Session requise pour téléverser un fichier.');

  const reservationResponse = await fetch('/api/storage/presign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...PRIVATE_MEDIA_HEADERS,
    },
    body: JSON.stringify({
      kind: bucket === 'photos' ? 'photo' : 'document',
      filename,
      contentType,
      size: file.size,
    }),
  });
  const reservation = await reservationResponse.json().catch(() => ({}));
  if (!reservationResponse.ok || !reservation?.assetId || !reservation?.mediaRef) {
    throw new Error(reservation?.error || `Réservation média impossible (HTTP ${reservationResponse.status}).`);
  }

  if (reservation.provider === 'r2') {
    if (!reservation.uploadUrl) throw new Error('URL de téléversement R2 absente.');
    const upload = await fetch(reservation.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });
    if (!upload.ok) throw new Error(`Téléversement R2 impossible (HTTP ${upload.status}).`);
  } else {
    const { error } = await supabaseBrowser.storage
      .from(String(reservation.bucket ?? bucket))
      .upload(String(reservation.objectKey), file, { contentType, upsert: false });
    if (error) throw error;
  }

  const completeResponse = await fetch('/api/storage/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...PRIVATE_MEDIA_HEADERS,
    },
    body: JSON.stringify({ assetId: reservation.assetId }),
  });
  const completed = await completeResponse.json().catch(() => ({}));
  if (!completeResponse.ok || completed?.ok !== true) {
    throw new Error(completed?.error || `Validation média impossible (HTTP ${completeResponse.status}).`);
  }
  return String(reservation.mediaRef);
}
