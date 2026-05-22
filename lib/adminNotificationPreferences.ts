import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface AdminEmailPreferenceState {
  emailEnabled: boolean;
  emailAdminAction?: 'disabled' | 'enabled' | null;
  emailAdminUpdatedAt?: string | null;
  emailAdminUpdatedBy?: string | null;
}

function getBaseApiUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_APP_URL || '';
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
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error ?? response.statusText);
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
