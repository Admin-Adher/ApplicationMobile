import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { canonicalApiBaseUrl } from '@/lib/apiBase';

function getBaseApiUrl(): string {
  return canonicalApiBaseUrl();
}

function getPushApiUrl(): string {
  const base = getBaseApiUrl();
  return base ? `${base}/api/send-push` : '/api/send-push';
}

async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data } = await (supabase as any).auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function callPushApi(body: Record<string, unknown>): Promise<void> {
  try {
    const accessToken = await getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const response = await fetch(getPushApiUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.warn('[Push Client] Envoi push refuse:', data?.error ?? response.statusText);
    }
  } catch (err: any) {
    console.warn('[Push Client] Erreur reseau:', err?.message ?? err);
  }
}

export function triggerMessagePush(messageId: string, channelId: string): void {
  void callPushApi({ type: 'message-created', messageId, channelId });
}

export function triggerReserveCreatedPush(reserveId: string): void {
  void callPushApi({ type: 'reserve-created', reserveId });
}

export function triggerReserveStatusPush(
  reserveId: string,
  newStatus: string,
  previousStatus?: string,
): void {
  void callPushApi({ type: 'reserve-status-changed', reserveId, newStatus, previousStatus });
}
