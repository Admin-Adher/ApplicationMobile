import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import i18n from '@/lib/i18n';
import { canonicalApiBaseUrl } from '@/lib/apiBase';

export interface AdminEmailPreferenceState {
  emailEnabled: boolean;
  emailAdminAction?: 'disabled' | 'enabled' | null;
  emailAdminUpdatedAt?: string | null;
  emailAdminUpdatedBy?: string | null;
}

function getBaseApiUrl(): string {
  return canonicalApiBaseUrl();
}

function getApiUrl(userId?: string): string {
  const base = getBaseApiUrl();
  const path = '/api/admin-notification-preferences';
  if (!userId) return base ? `${base}${path}` : path;
  const qs = new URLSearchParams({ userId });
  return base ? `${base}${path}?${qs.toString()}` : `${path}?${qs.toString()}`;
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

function mapPreferences(row: any): AdminEmailPreferenceState {
  return {
    emailEnabled: row?.email_enabled !== false,
    emailAdminAction: row?.email_admin_action ?? null,
    emailAdminUpdatedAt: row?.email_admin_updated_at ?? null,
    emailAdminUpdatedBy: row?.email_admin_updated_by ?? null,
  };
}

async function requestAdminPreferences(
  url: string,
  init?: RequestInit,
): Promise<AdminEmailPreferenceState> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Session admin introuvable.');
  if (Platform.OS !== 'web' && !/^https?:\/\//i.test(url)) {
    throw new Error('URL API manquante. Configurez EXPO_PUBLIC_APP_URL ou EXPO_PUBLIC_API_URL.');
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch (err: any) {
    throw new Error(err?.message || i18n.t('apiClient.unreachable'));
  }

  const raw = await response.text();
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const detail = payload?.error || payload?.message || response.statusText || raw.slice(0, 180);
    throw new Error(detail || `API BuildTrack indisponible (${response.status}).`);
  }
  return mapPreferences(payload?.preferences);
}

export function fetchUserEmailPreference(userId: string): Promise<AdminEmailPreferenceState> {
  return requestAdminPreferences(getApiUrl(userId), { method: 'GET' });
}

export function setUserEmailEnabled(
  userId: string,
  emailEnabled: boolean,
): Promise<AdminEmailPreferenceState> {
  return requestAdminPreferences(getApiUrl(), {
    method: 'POST',
    body: JSON.stringify({ userId, emailEnabled }),
  });
}
