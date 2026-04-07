import { sendEmail } from '@/lib/email/sender';
import {
  invitationEmail,
  welcomeEmail,
  passwordResetEmail,
} from '@/lib/email/templates';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type } = body;

    if (!type) {
      return Response.json({ error: 'Type manquant' }, { status: 400 });
    }

    if (type === 'invitation') {
      const { email, invitedByName, organizationName, role, token, expiresAt } = body;
      if (!email || !invitedByName || !organizationName || !role || !token || !expiresAt) {
        return Response.json({ error: 'Paramètres manquants pour invitation' }, { status: 400 });
      }
      const template = invitationEmail({ email, invitedByName, organizationName, role, token, expiresAt });
      const result = await sendEmail({ to: email, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? "Échec de l'envoi" }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    if (type === 'welcome') {
      const { email, name, organizationName } = body;
      if (!email || !name) {
        return Response.json({ error: 'Paramètres manquants pour welcome' }, { status: 400 });
      }
      const template = welcomeEmail({ email, name, organizationName });
      const result = await sendEmail({ to: email, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? "Échec de l'envoi" }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    if (type === 'password-reset') {
      const { email, name, resetUrl } = body;
      if (!email || !name || !resetUrl) {
        return Response.json({ error: 'Paramètres manquants pour password-reset' }, { status: 400 });
      }
      const template = passwordResetEmail({ name, resetUrl });
      const result = await sendEmail({ to: email, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? "Échec de l'envoi" }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    return Response.json({ error: `Type inconnu: ${type}` }, { status: 400 });
  } catch (err: any) {
    console.error('[API send-email] Exception:', err?.message ?? err);
    return Response.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
