import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/sender';
import { passwordResetEmail } from '@/lib/email/templates';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const RESET_REDIRECT = process.env.EXPO_PUBLIC_APP_URL
  ? `${process.env.EXPO_PUBLIC_APP_URL}/reset-password`
  : `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5000'}/reset-password`;

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Email invalide' }, { status: 400 });
    }

    if (!SERVICE_ROLE_KEY) {
      return Response.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY non configurée sur le serveur' },
        { status: 500 }
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

    const { data: linkData, error: linkError } = await (supabaseAdmin as any).auth.admin.generateLink({
      type: 'recovery',
      email: email.toLowerCase().trim(),
      options: { redirectTo: RESET_REDIRECT },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('[request-password-reset] generateLink error:', linkError?.message);
      return Response.json(
        { error: linkError?.message ?? 'Impossible de générer le lien de réinitialisation' },
        { status: 500 }
      );
    }

    const resetUrl = linkData.properties.action_link;
    const template = passwordResetEmail({ name, resetUrl });

    const result = await sendEmail({
      to: email.toLowerCase().trim(),
      subject: template.subject,
      html: template.html,
    });

    if (!result.success) {
      return Response.json({ error: result.error ?? "Échec de l'envoi" }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err: any) {
    console.error('[request-password-reset] Exception:', err?.message ?? err);
    return Response.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
