import { Resend } from 'resend';

const FROM_EMAIL = 'BuildTrack <onboarding@resend.dev>';

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY non défini — emails désactivés.');
    return null;
  }
  return new Resend(apiKey);
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; error?: string }> {
  const resend = getResendClient();
  if (!resend) {
    console.log('[Email] Mode simulation — email non envoyé à', params.to);
    return { success: true };
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (error) {
      console.error('[Email] Erreur Resend:', error);
      return { success: false, error: error.message };
    }

    console.log('[Email] Email envoyé à', params.to, '—', params.subject);
    return { success: true };
  } catch (err: any) {
    console.error('[Email] Exception:', err?.message ?? err);
    return { success: false, error: err?.message ?? 'Erreur inconnue' };
  }
}
