'use client';

import { supabaseBrowser } from '@/lib/supabase-browser';

type CachedMediaUrl = { url: string; expiresAt: number };

export type PrivateMediaAccess = {
  managed: boolean;
  status: 'empty' | 'resolving' | 'ready' | 'error';
  url: string;
  reason?: 'session_required' | 'unavailable' | 'temporary_failure';
};

type ResolveFailure = {
  reason: NonNullable<PrivateMediaAccess['reason']>;
};

const resolvedUrls = new Map<string, CachedMediaUrl>();
const retryAfter = new Map<string, number>();
const failures = new Map<string, ResolveFailure>();
const queuedRefs = new Set<string>();
const resolvingRefs = new Set<string>();
const listeners = new Set<() => void>();
let resolveScheduled = false;
let flushPromise: Promise<void> | null = null;

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

async function runResolveQueue() {
  while (queuedRefs.size > 0) {
    const refs = Array.from(queuedRefs).slice(0, 100);
    refs.forEach(ref => {
      queuedRefs.delete(ref);
      resolvingRefs.add(ref);
    });

    try {
      const { data } = await supabaseBrowser.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        markFailure(refs, 'session_required', 5_000);
        continue;
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
}

async function flushResolveQueue() {
  if (!flushPromise) {
    flushPromise = runResolveQueue().finally(() => {
      flushPromise = null;
    });
  }
  await flushPromise;
  if (queuedRefs.size > 0) await flushResolveQueue();
}

function queueResolve(ref: string) {
  if (queuedRefs.has(ref) || resolvingRefs.has(ref) || (retryAfter.get(ref) ?? 0) > Date.now()) return;
  failures.delete(ref);
  queuedRefs.add(ref);
  if (resolveScheduled) return;
  resolveScheduled = true;
  queueMicrotask(() => {
    resolveScheduled = false;
    void flushResolveQueue();
  });
}

export function subscribePrivateMedia(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function privateMediaAccess(raw: unknown): PrivateMediaAccess {
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

  queueResolve(ref);
  return { managed: true, status: 'resolving', url: '' };
}

export function privateMediaUrl(raw: unknown) {
  return privateMediaAccess(raw).url;
}

export function retryPrivateMedia(raw: unknown) {
  const ref = String(raw ?? '').trim();
  if (!ref || !isRegistryBackedRef(ref)) return;
  resolvedUrls.delete(ref);
  failures.delete(ref);
  retryAfter.delete(ref);
  queueResolve(ref);
  emitResolved();
}

export async function resolvePrivateMediaRefs(refs: string[]) {
  refs.filter(isRegistryBackedRef).forEach(ref => {
    retryAfter.delete(ref);
    failures.delete(ref);
    queueResolve(ref);
  });
  await flushResolveQueue();
  return new Map(refs.map(ref => [ref, privateMediaUrl(ref)]));
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
