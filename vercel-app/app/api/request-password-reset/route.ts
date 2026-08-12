import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/sender';
import { passwordResetEmail } from '@/lib/templates';
import { checkRateLimit } from '@/lib/rateLimit';
import { normalizeLang } from '@/lib/i18n';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://jzeojdpgglbxjdasjgta.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const RESET_REDIRECT = 'https://buildtrack-mobile.vercel.app/reset-password';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// Réponse identique que le compte existe ou non (anti-énumération).
const GENERIC_SUCCESS = { success: true };

export async function POST(req: NextRequest) {
  try {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
    const rate = checkRateLimit(`password-reset:${ip}`, 5, 15 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Trop de demandes. Réessayez plus tard.' },
        { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': String(rate.retryAfterSeconds) } }
      );
    }

    const { email, language: requestedLanguage } = await req.json();

    if (typeof email !== 'string' || email.length > 160 || !email.includes('@')) {
      return NextResponse.json({ error: 'Email invalide' }, { status: 400, headers: CORS_HEADERS });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const fallbackLanguage = normalizeLang(typeof requestedLanguage === 'string' ? requestedLanguage : null);

    if (!SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY non configurée sur le serveur' },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profileRows } = await supabaseAdmin
      .from('profiles')
      .select('name, preferred_language')
      .eq('email', normalizedEmail)
      .limit(1);

    const name: string = profileRows?.[0]?.name ?? normalizedEmail.split('@')[0];
    const language = profileRows?.[0]?.preferred_language
      ? normalizeLang(profileRows[0].preferred_language)
      : fallbackLanguage;
    const redirectTo = `${RESET_REDIRECT}?lang=${encodeURIComponent(language)}`;

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: { redirectTo },
    });

    if (linkError || !linkData?.properties?.action_link) {
      // Compte inexistant ou erreur interne : même réponse générique (anti-énumération).
      console.error('[request-password-reset] generateLink error:', linkError?.message);
      return NextResponse.json(GENERIC_SUCCESS, { headers: CORS_HEADERS });
    }

    const resetUrl = linkData.properties.action_link;
    const template = passwordResetEmail({ name, resetUrl, language });

    const result = await sendEmail({
      to: normalizedEmail,
      subject: template.subject,
      html: template.html,
    });

    if (!result.success) {
      console.error('[request-password-reset] envoi échoué:', result.error);
      return NextResponse.json(GENERIC_SUCCESS, { headers: CORS_HEADERS });
    }

    return NextResponse.json(GENERIC_SUCCESS, { headers: CORS_HEADERS });
  } catch (err: any) {
    console.error('[request-password-reset] Exception:', err?.message ?? err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS_HEADERS });
  }
}
