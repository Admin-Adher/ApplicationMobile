const WORKSPACE_CACHE = 'buildtrack-public-workspace-v1';
const WORKSPACE_SHELL = '/web';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function isPublicAsset(value) {
  try {
    const url = new URL(value);
    return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/');
  } catch { return false; }
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'warm-workspace' || !Array.isArray(event.data.assets)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(WORKSPACE_CACHE);
    const assets = [...new Set(event.data.assets.filter(isPublicAsset))].slice(0, 120);
    const shell = fetch(WORKSPACE_SHELL, { credentials: 'omit', cache: 'reload' }).then(response => {
      if (response.ok && response.headers.get('content-type')?.includes('text/html')) return cache.put(WORKSPACE_SHELL, response);
    });
    await Promise.allSettled([shell, ...assets.map(async asset => {
      if (!await cache.match(asset)) await cache.add(new Request(asset, { credentials: 'omit' }));
    })]);
    const keys = (await cache.keys()).filter(key => isPublicAsset(key.url));
    await Promise.all(keys.slice(0, Math.max(0, keys.length - 400)).map(key => cache.delete(key)));
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.pathname === WORKSPACE_SHELL) {
    event.respondWith(fetch(request).catch(async () => {
      const cached = await (await caches.open(WORKSPACE_CACHE)).match(WORKSPACE_SHELL);
      return cached || new Response('BuildTrack doit être ouvert une première fois en ligne.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }));
  } else if (isPublicAsset(request.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(WORKSPACE_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone()).catch(() => undefined);
      return response;
    })());
  }
});

function workspaceUrl(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/web', self.location.origin);
    if (url.origin === self.location.origin && url.pathname === '/web') return url.href;
  } catch { /* Use the workspace entry point for malformed links. */ }
  return self.location.origin + '/web';
}

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* Use generic copy for malformed payloads. */ }
  event.waitUntil(self.registration.showNotification('BuildTrack', {
    body: typeof data.body === 'string' ? data.body : 'Nouvelle activité sur votre chantier.',
    data: { href: workspaceUrl(data.href) },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const href = workspaceUrl(event.notification.data?.href);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).pathname === '/web');
    if (existing) {
      if (existing.url !== href) await existing.navigate(href);
      await existing.focus();
    } else {
      await self.clients.openWindow(href);
    }
  })());
});
