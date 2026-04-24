import nodemailer, { type Transporter } from 'nodemailer';

const DEFAULT_FROM = 'BuildTrack <buildtrack.admin@gmail.com>';

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (cachedTransporter) return cachedTransporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.warn(
      '[Email] GMAIL_USER ou GMAIL_APP_PASSWORD non défini — emails désactivés (mode simulation).'
    );
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return cachedTransporter;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(
  params: SendEmailParams
): Promise<{ success: boolean; error?: string; simulated?: boolean }> {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('[Email] Mode simulation — email non envoyé à', params.to);
    return { success: true, simulated: true };
  }

  const from = process.env.EMAIL_FROM || DEFAULT_FROM;

  try {
    const info = await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    console.log('[Email] Email envoyé à', params.to, '—', params.subject, '(', info.messageId, ')');
    return { success: true };
  } catch (err: any) {
    const msg = err?.message ?? 'Erreur inconnue';
    console.error('[Email] Exception SMTP:', msg);
    return { success: false, error: msg };
  }
}
