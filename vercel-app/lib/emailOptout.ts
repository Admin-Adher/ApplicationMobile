import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Désinscription des emails de notification (RGPD / CAN-SPAM).
//
// Chaque email de notification embarque dans son pied de page un lien signé
// (HMAC, même secret que les liens publics de réserve) vers
// /api/email-optout?t=<token>. La page confirme la désinscription et inscrit
// l'adresse dans la table `email_optouts`, vérifiée avant chaque envoi non
// transactionnel (send-email, cron de relance, partage de rapport PDF).
//
// Les emails de sécurité (réinitialisation / changement de mot de passe) et
// l'email de bienvenue restent exemptés : ils sont transactionnels et ne se
// reproduisent pas.
// ─────────────────────────────────────────────────────────────────────────────

const OPTOUT_TTL_DAYS = 365;

// Types d'emails qui restent envoyés même après désinscription (sécurité du
// compte / transactionnel one-shot).
export const OPTOUT_EXEMPT_EMAIL_TYPES = new Set([
  'password-reset',
  'password-changed',
  'welcome',
]);

function getSecret(): string {
  const s = process.env.RESERVE_TOKEN_SECRET;
  if (!s || s.length < 16) {
    throw new Error('RESERVE_TOKEN_SECRET manquant ou trop court (min 16 caractères).');
  }
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(payload: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

export interface OptoutTokenPayload {
  email: string;
  exp: number; // seconds since epoch
}

export function signOptoutToken(email: string, ttlDays = OPTOUT_TTL_DAYS): string {
  const secret = getSecret();
  const payload: OptoutTokenPayload = {
    email: String(email ?? '').trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + ttlDays * 86400,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${hmac(body, secret)}`;
}

export function verifyOptoutToken(token: string): OptoutTokenPayload | null {
  try {
    const secret = getSecret();
    const [body, sig] = String(token ?? '').split('.');
    if (!body || !sig) return null;
    const expected = hmac(body, secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as OptoutTokenPayload;
    if (!payload.email || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { ...payload, email: payload.email.trim().toLowerCase() };
  } catch {
    return null;
  }
}

export function buildOptoutUrl(appUrl: string, email: string, language?: string | null): string {
  let token = '';
  try {
    token = signOptoutToken(email);
  } catch (e: any) {
    console.warn('[email-optout] signature impossible:', e?.message);
    return '';
  }
  const lang = String(language ?? '').toLowerCase().slice(0, 2);
  const langQuery = ['fr', 'en', 'es'].includes(lang) ? `&lang=${lang}` : '';
  return `${appUrl}/api/email-optout?t=${encodeURIComponent(token)}${langQuery}`;
}

const FOOTER_TEXT: Record<string, { line: string; link: string }> = {
  fr: { line: 'Vous ne souhaitez plus recevoir ces notifications ?', link: 'Se désinscrire' },
  en: { line: 'You no longer wish to receive these notifications?', link: 'Unsubscribe' },
  es: { line: '¿Ya no quieres recibir estas notificaciones?', link: 'Darse de baja' },
};

export function normalizeFooterLang(language?: string | null): 'fr' | 'en' | 'es' {
  const lang = String(language ?? '').toLowerCase().slice(0, 2);
  return lang === 'en' || lang === 'es' ? lang : 'fr';
}

// Injecte le pied de page de désinscription juste avant la fermeture du body
// (ou en fin de document si la structure diffère).
export function withUnsubscribeFooter(html: string, appUrl: string, email: string, language?: string | null): string {
  const url = buildOptoutUrl(appUrl, email, language);
  if (!url) return html;
  const lang = normalizeFooterLang(language);
  const copy = FOOTER_TEXT[lang];
  const footer = `
    <div style="max-width:600px;margin:0 auto;padding:16px 24px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
        ${copy.line}
        <a href="${url}" style="color:#64748b;text-decoration:underline;">${copy.link}</a>
      </p>
    </div>`;
  if (html.includes('</body>')) return html.replace('</body>', `${footer}</body>`);
  return `${html}${footer}`;
}

// Header standard List-Unsubscribe (améliore la délivrabilité et permet la
// désinscription en un clic dans Gmail/Outlook).
export function listUnsubscribeHeaders(appUrl: string, email: string): Record<string, string> {
  const url = buildOptoutUrl(appUrl, email);
  if (!url) return {};
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

// Vérifie l'opt-out en base. Fail-open : si la table est inaccessible (p. ex.
// migration pas encore appliquée), on envoie quand même — la désinscription
// est une exigence de confort/légale, pas un garde-fou de sécurité.
export async function isOptedOut(supabase: any, email: string): Promise<boolean> {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!supabase || !normalized) return false;
  try {
    const { data, error } = await supabase
      .from('email_optouts')
      .select('email')
      .eq('email', normalized)
      .maybeSingle();
    if (error) {
      console.warn('[email-optout] lecture impossible:', error.message);
      return false;
    }
    return Boolean(data);
  } catch {
    return false;
  }
}
