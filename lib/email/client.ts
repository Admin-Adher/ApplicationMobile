import { Platform } from 'react-native';

const VERCEL_API_URL = 'https://buildtrack-mobile.vercel.app/api/send-email';
const VERCEL_RESET_URL = 'https://buildtrack-mobile.vercel.app/api/request-password-reset';

function getApiUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const host = window.location?.hostname ?? '';
    if (host === 'localhost' || host === '127.0.0.1') {
      return '/api/send-email';
    }
  }
  return VERCEL_API_URL;
}

async function callEmailApi(body: Record<string, unknown>): Promise<void> {
  try {
    const url = getApiUrl();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.warn('[Email Client] Échec envoi email:', data?.error ?? response.statusText);
    }
  } catch (err: any) {
    console.warn('[Email Client] Erreur réseau:', err?.message ?? err);
  }
}

export async function sendInvitationEmail(params: {
  email: string;
  invitedByName: string;
  organizationName: string;
  role: string;
  token: string;
  expiresAt: string;
}): Promise<void> {
  await callEmailApi({ type: 'invitation', ...params });
}

export async function sendWelcomeEmail(params: {
  email: string;
  name: string;
  organizationName?: string;
}): Promise<void> {
  await callEmailApi({ type: 'welcome', ...params });
}

export async function requestPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(VERCEL_RESET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data?.error ?? response.statusText };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Erreur réseau' };
  }
}

export async function sendInvitationAcceptedEmail(params: {
  adminEmail: string;
  adminName: string;
  inviteeName: string;
  inviteeEmail: string;
  organizationName: string;
  role: string;
}): Promise<void> {
  await callEmailApi({ type: 'invitation-accepted', ...params });
}

export async function sendReserveCreatedEmail(params: {
  email: string;
  recipientName: string;
  reserveTitle: string;
  reserveId: string;
  priority?: string;
  deadline?: string | null;
  building?: string;
  level?: string;
  zone?: string;
  description?: string;
  chantierName?: string;
  companyName: string;
  createdBy: string;
  reserveCode?: string;
}): Promise<void> {
  await callEmailApi({ type: 'reserve-created', ...params });
}

export async function sendAccessRevokedEmail(params: {
  email: string;
  name: string;
  organizationName: string;
}): Promise<void> {
  await callEmailApi({ type: 'access-revoked', ...params });
}
