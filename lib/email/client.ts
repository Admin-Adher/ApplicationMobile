async function callEmailApi(body: Record<string, unknown>): Promise<void> {
  try {
    const response = await fetch('/api/send-email', {
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
