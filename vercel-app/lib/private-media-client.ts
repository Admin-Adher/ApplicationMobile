'use client';

import { supabaseBrowser } from './supabase-browser';
import { boundedRead } from './bounded-read';

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
const resolvingRefs = new Map<string, number>();
const failureAttempts = new Map<string, number>();
const mediaWatches = new Map<string, Map<() => void, PrivateMediaPriority>>();
const wakeTimers = new Map<string, ReturnType<typeof setTimeout>>();
let mediaGeneration = 0;
let mediaController = new AbortController();
const listeners = new Set<() => void>();
const watchedListeners = new Set<() => void>();
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

function emitResolved(refs?: string[]) {
  if (!refs) { for (const listener of listeners) listener(); return; }
  const affected = new Set<() => void>([...listeners].filter(listener => !watchedListeners.has(listener)));
  for (const ref of refs) for (const listener of mediaWatches.get(ref)?.keys() ?? []) affected.add(listener);
  for (const listener of affected) listener();
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
    failureAttempts.set(ref, (failureAttempts.get(ref) ?? 0) + 1);
    scheduleMediaWake(ref);
  });
}

async function resolveBatch(refs: string[], generation: number, signal: AbortSignal) {
  try {
    const payload = await boundedRead(async requestSignal => {
      const { data } = await supabaseBrowser.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw Object.assign(new Error('Session requise.'), { code: 'MEDIA_SESSION_REQUIRED' });
      if (requestSignal.aborted) throw new Error('Lecture annulée.');
      const response = await fetch('/api/storage/resolve', {
        method: 'POST', signal: requestSignal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...PRIVATE_MEDIA_HEADERS },
        body: JSON.stringify({ refs }),
      });
      if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), { status: response.status });
      return response.json();
    }, { signal, timeoutMs: 12_000, retries: 1 });
    if (generation !== mediaGeneration) return;
    const returned = new Set<string>();
    for (const asset of Array.isArray(payload?.assets) ? payload.assets : []) {
      const ref = String(asset?.ref ?? '').trim(), url = String(asset?.url ?? '').trim();
      if (!refs.includes(ref) || !url) continue;
      returned.add(ref);
      const expiry = Number(asset?.expiresAt);
      resolvedUrls.set(ref, { url, expiresAt: Number.isFinite(expiry) && expiry > Date.now() ? expiry : Date.now() + 600_000 });
      retryAfter.delete(ref); failures.delete(ref); failureAttempts.delete(ref); scheduleMediaWake(ref);
    }
    markFailure(refs.filter(ref => !returned.has(ref)), 'unavailable', 5_000);
  } catch (error) {
    if (generation !== mediaGeneration || signal.aborted) return;
    console.warn('[private-media] signed media resolution temporarily unavailable');
    markFailure(refs, (error as { code?: string })?.code === 'MEDIA_SESSION_REQUIRED' ? 'session_required' : 'temporary_failure', 5_000);
  } finally {
    for (const ref of refs) if (resolvingRefs.get(ref) === generation) resolvingRefs.delete(ref);
    if (generation === mediaGeneration) emitResolved(refs);
  }
}

async function runResolveLane(priority: PrivateMediaPriority) {
  const queue = priority === 'critical' ? criticalQueuedRefs : backgroundQueuedRefs;
  const batchSize = priority === 'critical' ? 10 : 100;
  const generation = mediaGeneration, signal = mediaController.signal;
  while (generation === mediaGeneration && queue.size > 0) {
    const refs = Array.from(queue).slice(0, batchSize);
    refs.forEach(ref => {
      queue.delete(ref);
      resolvingRefs.set(ref, generation);
    });
    await resolveBatch(refs, generation, signal);
  }
}

async function flushResolveLane(priority: PrivateMediaPriority) {
  const queue = priority === 'critical' ? criticalQueuedRefs : backgroundQueuedRefs;
  let lanePromise = priority === 'critical' ? criticalFlushPromise : backgroundFlushPromise;
  if (!lanePromise) {
    const work = runResolveLane(priority).finally(() => {
      if (priority === 'critical' && criticalFlushPromise === work) criticalFlushPromise = null;
      else if (priority === 'background' && backgroundFlushPromise === work) backgroundFlushPromise = null;
    });
    lanePromise = work;
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

function scheduleMediaWake(ref: string) {
  clearTimeout(wakeTimers.get(ref)); wakeTimers.delete(ref);
  if (!mediaWatches.has(ref)) return;
  const cached = resolvedUrls.get(ref);
  const retry = retryAfter.get(ref);
  if (!cached && (!retry || (failureAttempts.get(ref) ?? 0) >= 3)) return;
  const delay = Math.max(1000, (cached ? cached.expiresAt - 60_000 : retry!) - Date.now());
  const timer = setTimeout(() => {
    wakeTimers.delete(ref);
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    refreshPrivateMediaSession();
  }, delay);
  (timer as any).unref?.();
  wakeTimers.set(ref, timer);
}

/** Wake mounted media after expiry, reconnect, token refresh or returning to the tab. */
export function refreshPrivateMediaSession(resume?: Event | boolean) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  for (const [ref, watches] of mediaWatches) {
    if (resume && failures.has(ref)) { failureAttempts.delete(ref); retryAfter.delete(ref); }
    const access = peekPrivateMediaAccess(ref);
    if (access.status === 'ready') { scheduleMediaWake(ref); continue; }
    if (access.status === 'idle' || (access.status === 'error' && (retryAfter.get(ref) ?? 0) <= Date.now() && (failureAttempts.get(ref) ?? 0) < 3)) {
      queueResolve(ref, [...watches.values()].includes('critical') ? 'critical' : 'background');
    }
  }
  emitResolved();
}

export function resetPrivateMedia() {
  mediaGeneration++; mediaController.abort(); mediaController = new AbortController();
  for (const timer of wakeTimers.values()) clearTimeout(timer);
  wakeTimers.clear(); resolvedUrls.clear(); retryAfter.clear(); failures.clear(); failureAttempts.clear();
  criticalQueuedRefs.clear(); backgroundQueuedRefs.clear(); resolvingRefs.clear();
  criticalFlushPromise = null; backgroundFlushPromise = null;
  emitResolved();
}

export function subscribePrivateMedia(listener: () => void, watch?: { ref: string; priority: PrivateMediaPriority }) {
  listeners.add(listener);
  if (watch?.ref) {
    watchedListeners.add(listener);
    const first = mediaWatches.size === 0;
    const watches = mediaWatches.get(watch.ref) ?? new Map();
    watches.set(listener, watch.priority); mediaWatches.set(watch.ref, watches); scheduleMediaWake(watch.ref);
    if (first && typeof window !== 'undefined') {
      window.addEventListener('focus', refreshPrivateMediaSession);
      window.addEventListener('online', refreshPrivateMediaSession);
      document.addEventListener('visibilitychange', refreshPrivateMediaSession);
    }
  }
  return () => {
    listeners.delete(listener);
    watchedListeners.delete(listener);
    if (watch?.ref) {
      const watches = mediaWatches.get(watch.ref); watches?.delete(listener);
      if (!watches?.size) { mediaWatches.delete(watch.ref); clearTimeout(wakeTimers.get(watch.ref)); wakeTimers.delete(watch.ref); }
      if (!mediaWatches.size && typeof window !== 'undefined') {
        window.removeEventListener('focus', refreshPrivateMediaSession);
        window.removeEventListener('online', refreshPrivateMediaSession);
        document.removeEventListener('visibilitychange', refreshPrivateMediaSession);
      }
    }
  };
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
  if (failure && (throttled || (failureAttempts.get(ref) ?? 0) >= 3)) {
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
  failureAttempts.delete(ref);
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
    throw Object.assign(new Error(reservation?.error || `Réservation média impossible (HTTP ${reservationResponse.status}).`), { status: reservationResponse.status });
  }

  if (reservation.provider === 'r2') {
    if (!reservation.uploadUrl) throw new Error('URL de téléversement R2 absente.');
    const upload = await fetch(reservation.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });
    if (!upload.ok) throw Object.assign(new Error(`Téléversement R2 impossible (HTTP ${upload.status}).`), { status: upload.status });
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
    throw Object.assign(new Error(completed?.error || `Validation média impossible (HTTP ${completeResponse.status}).`), { status: completeResponse.status });
  }
  return String(reservation.mediaRef);
}
