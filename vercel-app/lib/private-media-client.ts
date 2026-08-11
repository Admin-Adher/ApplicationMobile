'use client';

import { supabaseBrowser } from '@/lib/supabase-browser';

type CachedMediaUrl = { url: string; expiresAt: number };

const resolvedUrls = new Map<string, CachedMediaUrl>();
const retryAfter = new Map<string, number>();
const queuedRefs = new Set<string>();
const listeners = new Set<() => void>();
let resolveScheduled = false;
let resolving = false;

const PRIVATE_MEDIA_HEADERS = {
  'X-BuildTrack-Client': 'web',
  'X-BuildTrack-Client-Version': 'web-current',
  'X-BuildTrack-Media-Protocol': '1',
};

function isRegistryBackedRef(value: string) {
  return /^btmedia:\/\/[0-9a-f-]{36}$/i.test(value)
    || /\/storage\/v1\/object\/public\/(photos|documents)\//i.test(value)
    || /buildtrack-files\.[^/]*workers\.dev/i.test(value);
}

function emitResolved() {
  for (const listener of listeners) listener();
}

async function flushResolveQueue() {
  if (resolving) return;
  resolving = true;
  try {
    while (queuedRefs.size > 0) {
      const refs = Array.from(queuedRefs).slice(0, 100);
      refs.forEach(ref => queuedRefs.delete(ref));
      const { data } = await supabaseBrowser.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        refs.forEach(ref => retryAfter.set(ref, Date.now() + 5_000));
        continue;
      }
      try {
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
          const ref = String(asset?.ref ?? '');
          const url = String(asset?.url ?? '');
          if (!ref || !url) continue;
          returned.add(ref);
          resolvedUrls.set(ref, {
            url,
            expiresAt: Number(asset?.expiresAt ?? Date.now() + 60_000),
          });
          retryAfter.delete(ref);
        }
        refs.filter(ref => !returned.has(ref)).forEach(ref => retryAfter.set(ref, Date.now() + 3_000));
        if (returned.size > 0) emitResolved();
      } catch (error) {
        console.warn('[private-media] résolution temporairement indisponible:', error);
        refs.forEach(ref => retryAfter.set(ref, Date.now() + 5_000));
      }
    }
  } finally {
    resolving = false;
  }
}

function queueResolve(ref: string) {
  if (queuedRefs.has(ref) || (retryAfter.get(ref) ?? 0) > Date.now()) return;
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

export function privateMediaUrl(raw: unknown) {
  const ref = String(raw ?? '').trim();
  if (!ref) return '';
  if (!isRegistryBackedRef(ref)) return ref;
  const cached = resolvedUrls.get(ref);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.url;
  if (cached) resolvedUrls.delete(ref);
  queueResolve(ref);
  // Legacy URLs stay usable during the dual-read rollout. btmedia references
  // never leak into src/href attributes while the signed URL is loading.
  return ref.startsWith('btmedia://') ? '' : ref;
}

export async function resolvePrivateMediaRefs(refs: string[]) {
  refs.filter(isRegistryBackedRef).forEach(queueResolve);
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
