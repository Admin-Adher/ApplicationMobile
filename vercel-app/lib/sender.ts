import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

export type EmailFailureCode = 'email_not_configured' | 'invalid_recipient' | 'smtp_auth_failed'
  | 'recipient_rejected' | 'smtp_unavailable' | 'delivery_uncertain';
export type SendEmailResult =
  | { success: true; status: 'accepted'; messageId: string; requestId: string }
  | { success: false; error: string; code: EmailFailureCode; retryable: boolean; requestId: string };

function configured(value: string | undefined) {
  const result = String(value ?? '').trim();
  return result && result !== '[SENSITIVE]' ? result : '';
}

export function emailConfiguration() {
  const host = configured(process.env.SMTP_HOST);
  const user = configured(host ? process.env.SMTP_USER : process.env.GMAIL_USER);
  const pass = configured(host ? process.env.SMTP_PASSWORD : process.env.GMAIL_APP_PASSWORD);
  const port = Number(process.env.SMTP_PORT || '587');
  const from = configured(process.env.EMAIL_FROM) || (host ? '' : `BuildTrack <${user}>`);
  const ready = Boolean(user && pass && from && (!host || (Number.isInteger(port) && port > 0 && port <= 65535)));
  return {
    ready, from,
    options: {
      ...(host ? { host, port, secure: port === 465, requireTLS: port !== 465 } : { service: 'gmail' }),
      auth: { user, pass: host ? pass : pass.replace(/\s/g, '') },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000,
      disableFileAccess: true, disableUrlAccess: true,
    },
  };
}

export function classifyEmailFailure(error: unknown): { code: EmailFailureCode; retryable: boolean } {
  const failure = (error ?? {}) as { code?: string; command?: string; responseCode?: number };
  if (failure.code === 'EAUTH') return { code: 'smtp_auth_failed', retryable: false };
  if (failure.responseCode && failure.responseCode >= 400 && failure.responseCode < 500) {
    return { code: 'smtp_unavailable', retryable: true };
  }
  if (failure.responseCode && failure.responseCode >= 500) {
    return { code: 'recipient_rejected', retryable: false };
  }
  // A timeout during/after DATA may have delivered it; retrying duplicates mail.
  if (['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'AUTH PLAIN', 'AUTH LOGIN', 'MAIL FROM', 'RCPT TO'].includes(failure.command ?? '')) {
    return { code: 'smtp_unavailable', retryable: true };
  }
  return { code: 'delivery_uncertain', retryable: false };
}

export interface EmailAttachment { filename: string; content: Buffer; contentType: string }
export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  requestId?: string;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s<>(),;:"\\@]+@[^\s<>(),;:"\\@]+\.[^\s<>(),;:"\\@]+$/.test(email) ? email : null;
}

function readableText(html: string) {
  return html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/(p|div|h[1-6]|li)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
}

export async function sendEmail(params: SendEmailParams, createTransport = nodemailer.createTransport): Promise<SendEmailResult> {
  const requestId = params.requestId || randomUUID();
  const failure = (code: EmailFailureCode, retryable = false): SendEmailResult => {
    console.error('[email-delivery]', JSON.stringify({ requestId, status: 'failed', code, retryable }));
    return { success: false, error: "L'envoi de l'email n'a pas pu être confirmé. Réessayez dans quelques instants.", code, retryable, requestId };
  };
  const config = emailConfiguration();
  if (!config.ready) return failure('email_not_configured');
  const rawRecipients = Array.isArray(params.to) ? params.to : [params.to];
  const normalized = rawRecipients.map(normalizeEmail);
  if (!normalized.length || normalized.some(email => !email)) return failure('invalid_recipient');
  const recipients = [...new Set(normalized as string[])];
  const transport = createTransport(config.options);
  const started = Date.now();
  try {
    const info = await transport.sendMail({
      from: config.from, to: recipients, subject: params.subject,
      html: params.html, text: params.text || readableText(params.html),
      headers: params.headers, attachments: params.attachments,
    });
    const address = (value: unknown) => normalizeEmail(typeof value === 'string' ? value : (value as { address?: string })?.address);
    const accepted = new Set((info.accepted ?? []).map(address));
    if ((info.rejected ?? []).length > 0 || !recipients.every(email => accepted.has(email))) {
      return failure('recipient_rejected');
    }
    if (!info.messageId) return failure('delivery_uncertain');
    console.info('[email-delivery]', JSON.stringify({ requestId, status: 'accepted', messageId: info.messageId, durationMs: Date.now() - started, recipientCount: recipients.length }));
    // SMTP acceptance is not proof of inbox delivery.
    return { success: true, status: 'accepted', messageId: info.messageId, requestId };
  } catch (error) {
    const { code, retryable } = classifyEmailFailure(error);
    return failure(code, retryable);
  } finally {
    transport.close();
  }
}
