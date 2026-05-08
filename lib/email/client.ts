import { Platform } from 'react-native';

function getBaseApiUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (apiUrl) return apiUrl;
  return '';
}

function getApiUrl(): string {
  const base = getBaseApiUrl();
  return base ? `${base}/api/send-email` : '/api/send-email';
}

async function callEmailApi(body: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
  try {
    const url = getApiUrl();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const errMsg = err?.message ?? 'Erreur réseau';
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
}): Promise<{ success: boolean; error?: string }> {
  return callEmailApi({ type: 'invitation', ...params });
}

export async function sendWelcomeEmail(params: {
  email: string;
  name: string;
  organizationName?: string;
}): Promise<void> {
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

export async function sendReserveStatusChangedEmail(params: {
  email: string;
  recipientName: string;
  reserveTitle: string;
  reserveId: string;
  newStatus: string;
  previousStatus?: string;
  changedBy: string;
  companyName: string;
  chantierName?: string;
  reserveCode?: string;
}): Promise<void> {
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
}): Promise<void> {
  await callEmailApi({ type: 'reserve-overdue', ...params });
}

export async function sendAccessRevokedEmail(params: {
  email: string;
  name: string;
  organizationName: string;
}): Promise<void> {
  await callEmailApi({ type: 'access-revoked', ...params });
}

export async function sendPasswordChangedEmail(params: {
  email: string;
  name: string;
}): Promise<void> {
  await callEmailApi({ type: 'password-changed', ...params });
}

export interface PdfReportPayload {
  chantierName: string;
  companyFilter: string | null;
  generatedAt: string;
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
    photos: Array<{ uri: string }>;
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, type: 'plans' }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data?.error ?? response.statusText };
    }
    const data = await response.json();
    return { success: true, pdfBase64: data.pdfBase64 };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Erreur réseau' };
  }
}

export interface GlobalReservesPayload {
  chantierName: string;
  companyFilter: string | null;
  generatedAt: string;
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
    photos: Array<{ uri: string }>;
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, type: 'global_reserves' }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data?.error ?? response.statusText };
    }
    const data = await response.json();
    return { success: true, pdfBase64: data.pdfBase64 };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Erreur réseau' };
  }
}

export interface IndividualReservePayload {
  chantierName: string;
  companyColor?: string;
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
    photos?: Array<{ uri: string; kind?: string }>;
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, type: 'individual_reserve' }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data?.error ?? response.statusText };
    }
    const data = await response.json();
    return { success: true, pdfBase64: data.pdfBase64 };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Erreur réseau' };
  }
}
