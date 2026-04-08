import { Platform } from 'react-native';

const VERCEL_API_URL = 'https://buildtrack-mobile.vercel.app/api/send-email';

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

export async function sendPasswordResetEmail(params: {
  email: string;
  name: string;
  resetUrl: string;
}): Promise<void> {
  await callEmailApi({ type: 'password-reset', ...params });
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

export async function sendAccessRevokedEmail(params: {
  email: string;
  name: string;
  organizationName: string;
}): Promise<void> {
  await callEmailApi({ type: 'access-revoked', ...params });
}
