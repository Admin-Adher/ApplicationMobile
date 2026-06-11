import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyOptoutToken, normalizeFooterLang } from '@/lib/emailOptout';
import { checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

const COPY = {
  fr: {
    title: 'Préférences email — BuildTrack',
    done: 'Vous êtes désinscrit(e).',
    doneDetail: 'ne recevra plus les emails de notification BuildTrack (réserves, messages, relances). Les emails de sécurité du compte restent actifs.',
    resub: 'Je me suis trompé(e) — réactiver les notifications',
    resubDone: 'Les notifications email sont réactivées pour',
    invalid: 'Lien invalide ou expiré.',
    invalidDetail: 'Demandez un nouvel email de notification ou contactez votre administrateur.',
    error: 'Une erreur est survenue. Réessayez plus tard.',
  },
  en: {
    title: 'Email preferences — BuildTrack',
    done: 'You have been unsubscribed.',
    doneDetail: 'will no longer receive BuildTrack notification emails (reserves, messages, reminders). Account security emails remain active.',
    resub: 'I made a mistake — re-enable notifications',
    resubDone: 'Email notifications are re-enabled for',
    invalid: 'Invalid or expired link.',
    invalidDetail: 'Request a new notification email or contact your administrator.',
    error: 'Something went wrong. Please try again later.',
  },
  es: {
    title: 'Preferencias de email — BuildTrack',
    done: 'Te has dado de baja.',
    doneDetail: 'ya no recibirá los emails de notificación de BuildTrack (reservas, mensajes, recordatorios). Los emails de seguridad de la cuenta siguen activos.',
    resub: 'Me equivoqué — reactivar las notificaciones',
    resubDone: 'Las notificaciones por email están reactivadas para',
    invalid: 'Enlace inválido o caducado.',
    invalidDetail: 'Solicita un nuevo email de notificación o contacta con tu administrador.',
    error: 'Se produjo un error. Inténtalo de nuevo más tarde.',
  },
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(lang: 'fr' | 'en' | 'es', body: string): NextResponse {
  const copy = COPY[lang];
  const html = `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${copy.title}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f1f5f9; color: #0f172a; }
    .card { max-width: 480px; margin: 64px auto; background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(15,23,42,.12); text-align: center; }
    .brand { font-weight: 800; color: #003082; font-size: 18px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 16px; }
    a.btn { display: inline-block; padding: 10px 18px; border-radius: 10px; background: #003082; color: #fff; text-decoration: none; font-size: 13px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">BuildTrack</div>
    ${body}
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

async function handleOptout(req: NextRequest, oneClick: boolean) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  const lang = normalizeFooterLang(url.searchParams.get('lang'));
  const action = url.searchParams.get('action') ?? 'unsubscribe';
  const copy = COPY[lang];

  const rate = checkRateLimit(`email-optout:${clientIp(req)}`, 20, 15 * 60 * 1000);
  if (!rate.allowed) {
    return new NextResponse('Too many requests', { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } });
  }

  const payload = verifyOptoutToken(token);
  if (!payload) {
    if (oneClick) return NextResponse.json({ error: 'invalid token' }, { status: 400 });
    return page(lang, `<h1>${copy.invalid}</h1><p>${copy.invalidDetail}</p>`);
  }

  const supabase = serviceClient();
  if (!supabase) {
    if (oneClick) return NextResponse.json({ error: 'server' }, { status: 500 });
    return page(lang, `<h1>${copy.error}</h1>`);
  }

  const safeEmail = escapeHtml(payload.email);

  try {
    if (action === 'resubscribe') {
      await supabase.from('email_optouts').delete().eq('email', payload.email);
      if (oneClick) return NextResponse.json({ ok: true });
      return page(lang, `<h1>${copy.resubDone} ${safeEmail}.</h1>`);
    }
    await supabase
      .from('email_optouts')
      .upsert({ email: payload.email, source: oneClick ? 'one-click' : 'link' }, { onConflict: 'email' });
    if (oneClick) return NextResponse.json({ ok: true });
    const resubHref = `/api/email-optout?t=${encodeURIComponent(token)}&lang=${lang}&action=resubscribe`;
    return page(lang, `
      <h1>${copy.done}</h1>
      <p><strong>${safeEmail}</strong> ${copy.doneDetail}</p>
      <a class="btn" href="${resubHref}">${copy.resub}</a>
    `);
  } catch (err: any) {
    console.error('[email-optout]', err?.message ?? err);
    if (oneClick) return NextResponse.json({ error: 'server' }, { status: 500 });
    return page(lang, `<h1>${copy.error}</h1>`);
  }
}

export async function GET(req: NextRequest) {
  return handleOptout(req, false);
}

// POST = désinscription en un clic depuis le client mail (List-Unsubscribe-Post).
export async function POST(req: NextRequest) {
  return handleOptout(req, true);
}
