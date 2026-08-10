import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { sendEmail } from '@/lib/sender';
import type { Language } from '@/app/landing-copy';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^[+()\d\s.\-]{6,40}$/;

type DemoRequest = {
  name: string;
  company: string;
  email: string;
  phone: string;
  teamSize: string;
  message: string;
  website: string;
  language: Language;
};

const RESPONSES = {
  en: {
    origin: 'Request origin is not allowed.', tooLarge: 'The request is too large.', rate: 'Too many requests have been sent. Please try again later.', invalid: 'The form is invalid.', fields: 'Enter your name, company and a valid e-mail address.', phone: 'The phone number appears to be invalid.', send: 'The request could not be sent. Please try again in a moment.', success: 'Your request has been sent. We will contact you shortly.', recorded: 'Your request has been recorded.',
  },
  fr: {
    origin: 'Origine de la demande non autorisée.', tooLarge: 'La demande est trop volumineuse.', rate: 'Trop de demandes ont été envoyées. Réessayez un peu plus tard.', invalid: 'Le formulaire est invalide.', fields: 'Indiquez votre nom, votre entreprise et une adresse e-mail valide.', phone: 'Le numéro de téléphone semble invalide.', send: 'La demande n’a pas pu être envoyée. Réessayez dans un instant.', success: 'Votre demande est bien partie. Nous vous recontactons rapidement.', recorded: 'Votre demande est bien enregistrée.',
  },
  es: {
    origin: 'El origen de la solicitud no está autorizado.', tooLarge: 'La solicitud es demasiado grande.', rate: 'Se han enviado demasiadas solicitudes. Inténtalo de nuevo más tarde.', invalid: 'El formulario no es válido.', fields: 'Indica tu nombre, empresa y una dirección de e-mail válida.', phone: 'El número de teléfono no parece válido.', send: 'No se ha podido enviar la solicitud. Inténtalo de nuevo en un momento.', success: 'Tu solicitud se ha enviado. Nos pondremos en contacto contigo pronto.', recorded: 'Tu solicitud se ha registrado.',
  },
} as const;

function supportedLanguage(value: unknown): Language {
  const base = String(value || '').trim().toLowerCase().split(/[-,;]/)[0];
  return base === 'fr' || base === 'es' || base === 'en' ? base : 'en';
}

function requestLanguage(request: NextRequest): Language {
  return supportedLanguage(request.headers.get('accept-language'));
}

function clean(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function clientAddress(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    return Boolean(host && new URL(origin).host === host);
  } catch {
    return false;
  }
}

function parseRequest(value: unknown): DemoRequest {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    name: clean(data.name, 100),
    company: clean(data.company, 120),
    email: clean(data.email, 160).toLowerCase(),
    phone: clean(data.phone, 40),
    teamSize: clean(data.teamSize, 30),
    message: clean(data.message, 1500),
    website: clean(data.website, 200),
    language: supportedLanguage(data.language),
  };
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: RESPONSES[requestLanguage(request)].origin }, { status: 403 });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 20_000) {
    return NextResponse.json({ message: RESPONSES[requestLanguage(request)].tooLarge }, { status: 413 });
  }

  const rate = checkRateLimit(`demo:${clientAddress(request)}`, 5, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { message: RESPONSES[requestLanguage(request)].rate },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  let data: DemoRequest;
  try {
    data = parseRequest(await request.json());
  } catch {
    return NextResponse.json({ message: RESPONSES[requestLanguage(request)].invalid }, { status: 400 });
  }

  const response = RESPONSES[data.language];

  // Champ leurre : on répond comme si tout allait bien, sans envoyer d'e-mail.
  if (data.website) {
    return NextResponse.json({ success: true, message: response.recorded });
  }

  if (!data.name || !data.company || !EMAIL_PATTERN.test(data.email)) {
    return NextResponse.json(
      { message: response.fields },
      { status: 400 }
    );
  }

  if (data.phone && !PHONE_PATTERN.test(data.phone)) {
    return NextResponse.json({ message: response.phone }, { status: 400 });
  }

  const destination = process.env.BUILDTRACK_SALES_EMAIL || process.env.GMAIL_USER || 'buildtrack.admin@gmail.com';
  const safe = {
    name: escapeHtml(data.name),
    company: escapeHtml(data.company),
    email: escapeHtml(data.email),
    phone: escapeHtml(data.phone || 'Non renseigné'),
    teamSize: escapeHtml(data.teamSize || 'Non renseignée'),
    message: escapeHtml(data.message || 'Aucun message').replaceAll('\n', '<br>'),
  };

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#13243f">
      <div style="border-left:6px solid #ff861f;padding:8px 0 8px 18px;margin-bottom:28px">
        <div style="font-size:12px;color:#5d7088">NOUVELLE DEMANDE DE DÉMONSTRATION</div>
        <h1 style="font-size:26px;margin:5px 0 0;color:#071b3a">${safe.company}</h1>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        <tr><td style="padding:10px;border-bottom:1px solid #d9e2ec;color:#5d7088">Contact</td><td style="padding:10px;border-bottom:1px solid #d9e2ec"><strong>${safe.name}</strong></td></tr>
        <tr><td style="padding:10px;border-bottom:1px solid #d9e2ec;color:#5d7088">E-mail</td><td style="padding:10px;border-bottom:1px solid #d9e2ec">${safe.email}</td></tr>
        <tr><td style="padding:10px;border-bottom:1px solid #d9e2ec;color:#5d7088">Téléphone</td><td style="padding:10px;border-bottom:1px solid #d9e2ec">${safe.phone}</td></tr>
        <tr><td style="padding:10px;border-bottom:1px solid #d9e2ec;color:#5d7088">Équipe</td><td style="padding:10px;border-bottom:1px solid #d9e2ec">${safe.teamSize}</td></tr>
        <tr><td style="padding:10px;border-bottom:1px solid #d9e2ec;color:#5d7088">Langue</td><td style="padding:10px;border-bottom:1px solid #d9e2ec;text-transform:uppercase">${data.language}</td></tr>
      </table>
      <div style="margin-top:25px;padding:20px;background:#f7f9fc;border:1px solid #d9e2ec">
        <strong style="color:#071b3a">Besoin exprimé</strong>
        <p style="line-height:1.6;margin:10px 0 0">${safe.message}</p>
      </div>
    </div>
  `;

  const result = await sendEmail({
    to: destination,
    subject: `Demande de démo BuildTrack — ${data.company.replace(/[\r\n]/g, ' ')}`,
    html,
  });

  if (!result.success) {
    console.error('[demo-request] Envoi impossible:', result.error);
    return NextResponse.json(
      { message: response.send },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    message: response.success,
  });
}
