'use client';

import { supabaseBrowser } from './supabase-browser';

export const WEB_WORKER_PATH = '/buildtrack-sw.js';
export const WEB_WORKER_SCOPE = '/web';

export function canUseBrowserPush() {
  return typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator
    && 'Notification' in window && 'PushManager' in window;
}

export async function browserPushRequest(input: Record<string, unknown>) {
  const { data: { session } } = await supabaseBrowser.auth.getSession();
  if (!session) throw new Error('Reconnectez-vous pour gérer les notifications.');
  const response = await fetch('/api/browser-push', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(input) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'Notifications navigateur indisponibles.');
  return payload;
}

export async function stopBrowserPush() {
  if (!canUseBrowserPush()) return;
  const worker = await navigator.serviceWorker.getRegistration(WEB_WORKER_SCOPE);
  const subscription = await worker?.pushManager.getSubscription();
  if (!subscription) return;
  // Stop delivery to this device before removing the server registration.
  await subscription.unsubscribe();
  await browserPushRequest({ action: 'remove', endpoint: subscription.endpoint });
}
