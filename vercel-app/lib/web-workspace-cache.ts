'use client';

import { WEB_WORKER_PATH, WEB_WORKER_SCOPE } from './browser-push-client';

const DATA_CACHE = 'buildtrack-workspace-data-v1';
const MAX_OFFLINE_AGE = 24 * 60 * 60 * 1000;
const cacheKey = (id: string) => `/__buildtrack_offline_workspace__/${encodeURIComponent(id)}`;

export async function warmOfflineWorkspace() {
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !navigator.onLine) return;
  await navigator.serviceWorker.register(WEB_WORKER_PATH, { scope: WEB_WORKER_SCOPE });
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({
    type: 'warm-workspace',
    assets: performance.getEntriesByType('resource').map(entry => entry.name),
  });
}

export async function writeWorkspaceSnapshot<T>(id: string, snapshot: T) {
  if (!('caches' in window)) return;
  const cache = await caches.open(DATA_CACHE);
  await cache.put(cacheKey(id), new Response(JSON.stringify({ savedAt: Date.now(), snapshot })));
}

export async function readWorkspaceSnapshot<T>(id: string): Promise<{ savedAt: number; snapshot: T } | null> {
  if (!('caches' in window)) return null;
  const cache = await caches.open(DATA_CACHE);
  const response = await cache.match(cacheKey(id));
  if (!response) return null;
  const entry = await response.json();
  return typeof entry.savedAt === 'number' && Date.now() - entry.savedAt <= MAX_OFFLINE_AGE ? entry : null;
}

export async function clearWorkspaceSnapshot(id: string) {
  if ('caches' in window) await (await caches.open(DATA_CACHE)).delete(cacheKey(id));
}
