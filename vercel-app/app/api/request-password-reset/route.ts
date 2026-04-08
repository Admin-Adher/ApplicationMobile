import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { passwordResetEmail } from '@/lib/templates';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://jzeojdpgglbxjdasjgta.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const FROM_EMAIL = 'BuildTrack <onboarding@resend.dev>';
const RESET_REDIRECT = 'https://buildtrack-mobile.vercel.app/reset-password';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Email invalide' }, { status: 400, headers: CORS_HEADERS });
    }

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
      .select('name')
      .eq('email', email.toLowerCase().trim())
      .limit(1);

    const name: string = profileRows?.[0]?.name ?? email.split('@')[0];

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email.toLowerCase().trim(),
      options: { redirectTo: RESET_REDIRECT },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('[request-password-reset] generateLink error:', linkError?.message);
      return NextResponse.json(
        { error: linkError?.message ?? 'Impossible de générer le lien de réinitialisation' },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const resetUrl = linkData.properties.action_link;

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.warn('[request-password-reset] RESEND_API_KEY absent — mode simulation');
      return NextResponse.json({ success: true, simulated: true }, { headers: CORS_HEADERS });
    }

    const resend = new Resend(resendKey);
    const template = passwordResetEmail({ name, resetUrl });

    const { error: sendError } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email.toLowerCase().trim(),
      subject: template.subject,
      html: template.html,
    });

    if (sendError) {
      console.error('[request-password-reset] Resend error:', sendError);
      return NextResponse.json({ error: sendError.message }, { status: 500, headers: CORS_HEADERS });
    }

    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (err: any) {
    console.error('[request-password-reset] Exception:', err?.message ?? err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS_HEADERS });
  }
}
