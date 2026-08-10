import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import i18n from '@/lib/i18n';
import { canonicalApiBaseUrl } from '@/lib/apiBase';

async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data } = await (supabase as any).auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const accessToken = await getAccessToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function getBaseApiUrl(): string {
  return canonicalApiBaseUrl();
}

function getApiUrl(): string {
  const base = getBaseApiUrl();
  return base ? `${base}/api/send-email` : '/api/send-email';
}

type EmailLanguageParam = {
  language?: string | null;
};

async function callEmailApi(body: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
  try {
    const url = getApiUrl();
    const response = await fetch(url, {
      method: 'POST',
      headers: await buildAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const errMsg = data?.error ?? response.statusText;
      console.warn('[Email Client] Échec envoi email:', errMsg);
      return { success: false, error: errMsg };
    }
    return { success: true };
  } catch (err: any) {
    const errMsg = err?.message ?? i18n.t('subscriptionContext.networkError');
    console.warn('[Email Client] Erreur réseau:', errMsg);
    return { success: false, error: errMsg };
  }
}

export async function sendInvitationEmail(params: {
  email: string;
  invitedByName: string;
  organizationName: string;
  role: string;
  token: string;
  expiresAt: string;
  companyName?: string;
} & EmailLanguageParam): Promise<{ success: boolean; error?: string }> {
  return callEmailApi({ type: 'invitation', ...params });
}

export async function sendWelcomeEmail(params: {
  email: string;
  name: string;
  organizationName?: string;
} & EmailLanguageParam): Promise<void> {
  await callEmailApi({ type: 'welcome', ...params });
}

function getResetUrl(): string {
  const base = getBaseApiUrl();
  return base ? `${base}/api/request-password-reset` : '/api/request-password-reset';
}

export async function requestPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    const url = getResetUrl();
    const response = await fetch(url, {
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
    return { success: false, error: err?.message ?? i18n.t('subscriptionContext.networkError') };
  }
}

export async function sendInvitationAcceptedEmail(params: {
  adminEmail: string;
  adminName: string;
  inviteeName: string;
  inviteeEmail: string;
  organizationName: string;
  role: string;
} & EmailLanguageParam): Promise<void> {
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
} & EmailLanguageParam): Promise<void> {
  await callEmailApi({ type: 'reserve-created', ...params });
}

export async function sendReserveStatusChangedEmail(params: {
  email: string;
  recipientName: string;
  reserveTitle: string;
  reserveId: string;
  newStatus: string;
  previousStatus?: string;
  priority?: string;
  changedBy: string;
  companyName: string;
  chantierName?: string;
  reserveCode?: string;
} & EmailLanguageParam): Promise<void> {
  await callEmailApi({ type: 'reserve-status-changed', ...params });
}

export async function sendReserveOverdueEmail(params: {
  email: string;
  recipientName: string;
  reserveTitle: string;
  reserveId: string;
  deadline: string;
  daysLate: number;
  priority?: string;
  companyName: string;
  chantierName?: string;
  reserveCode?: string;
} & EmailLanguageParam): Promise<void> {
  await callEmailApi({ type: 'reserve-overdue', ...params });
}

export async function sendAccessRevokedEmail(params: {
  email: string;
  name: string;
  organizationName: string;
} & EmailLanguageParam): Promise<void> {
  await callEmailApi({ type: 'access-revoked', ...params });
}

export async function sendPasswordChangedEmail(params: {
  email: string;
  name: string;
} & EmailLanguageParam): Promise<void> {
  await callEmailApi({ type: 'password-changed', ...params });
}

export interface PdfReportPayload {
  chantierName: string;
  companyFilter: string | null;
  generatedAt: string;
  language?: string | null;
  plans: Array<{
    id: string;
    name: string;
    building?: string;
    level?: string;
    uri?: string;
    fileType?: string;
  }>;
  reserves: Array<{
    id: string;
    num: number;
    title: string;
    company: string;
    building?: string;
    level?: string;
    status: string;
    priority: string;
    deadline?: string;
    description?: string;
    planId?: string;
    planX?: number;
    planY?: number;
    photos: Array<{ uri: string; kind?: string; annotations?: unknown[] | null }>;
  }>;
  recipients: string[];
  sendByEmail: boolean;
}

export async function generateAndSendPdfReport(
  payload: PdfReportPayload
): Promise<{ success: boolean; pdfBase64?: string; error?: string }> {
  try {
    const url = `${getBaseApiUrl()}/api/generate-pdf`;
    const response = await fetch(url, {
      method: 'POST',
      headers: await buildAuthHeaders(),
      body: JSON.stringify({ ...payload, type: 'plans' }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data?.error ?? response.statusText };
    }
    const data = await response.json();
    return { success: true, pdfBase64: data.pdfBase64 };
  } catch (err: any) {
    return { success: false, error: err?.message ?? i18n.t('subscriptionContext.networkError') };
  }
}

export interface GlobalReservesPayload {
  chantierName: string;
  companyFilter: string | null;
  generatedAt: string;
  language?: string | null;
  reserves: Array<{
    id: string;
    title: string;
    company?: string;
    companies?: string[];
    building?: string;
    level?: string;
    zone?: string;
    status: string;
    priority: string;
    deadline?: string;
    description?: string;
    photos: Array<{ uri: string; kind?: string; annotations?: unknown[] | null }>;
  }>;
  recipients: string[];
  sendByEmail: boolean;
}

export async function generateAndSendReservesReport(
  payload: GlobalReservesPayload
): Promise<{ success: boolean; pdfBase64?: string; error?: string }> {
  try {
    const url = `${getBaseApiUrl()}/api/generate-pdf`;
    const response = await fetch(url, {
      method: 'POST',
      headers: await buildAuthHeaders(),
      body: JSON.stringify({ ...payload, type: 'global_reserves' }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data?.error ?? response.statusText };
    }
    const data = await response.json();
    return { success: true, pdfBase64: data.pdfBase64 };
  } catch (err: any) {
    return { success: false, error: err?.message ?? i18n.t('subscriptionContext.networkError') };
  }
}

export interface IndividualReservePayload {
  chantierName: string;
  companyColor?: string;
  language?: string | null;
  planUri?: string;
  planX?: number;
  planY?: number;
  planName?: string;
  pinNum?: number;
  reserve: {
    id: string;
    title: string;
    company?: string;
    companies?: string[];
    building?: string;
    level?: string;
    zone?: string;
    status: string;
    priority: string;
    deadline?: string;
    description?: string;
    createdAt?: string;
    closedAt?: string;
    photos?: Array<{ uri: string; kind?: string; annotations?: unknown[] | null }>;
    photoUri?: string;
    history?: Array<{ id: string; action: string; author: string; createdAt: string; oldValue?: string; newValue?: string }>;
  };
  recipients: string[];
  sendByEmail: boolean;
}

export async function generateAndSendIndividualReserve(
  payload: IndividualReservePayload
): Promise<{ success: boolean; pdfBase64?: string; error?: string }> {
  try {
    const url = `${getBaseApiUrl()}/api/generate-pdf`;
    const response = await fetch(url, {
      method: 'POST',
      headers: await buildAuthHeaders(),
      body: JSON.stringify({ ...payload, type: 'individual_reserve' }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data?.error ?? response.statusText };
    }
    const data = await response.json();
    return { success: true, pdfBase64: data.pdfBase64 };
  } catch (err: any) {
    return { success: false, error: err?.message ?? i18n.t('subscriptionContext.networkError') };
  }
}
