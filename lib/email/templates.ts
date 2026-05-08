const APP_URL = process.env.EXPO_PUBLIC_APP_URL ?? 'https://buildtrack-mobile.vercel.app';
const BRAND_COLOR = '#003082';
const ACCENT_COLOR = '#FFCB00';

function baseLayout(content: string, preheader: string = ''): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BuildTrack</title>
  <style>
    body { margin: 0; padding: 0; background: #F4F7FB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 560px; margin: 0 auto; padding: 32px 16px; }
    .header { background: ${BRAND_COLOR}; border-radius: 16px 16px 0 0; padding: 28px 36px; display: flex; align-items: center; }
    .logo-box { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: ${ACCENT_COLOR}; border-radius: 10px; font-size: 22px; font-weight: 700; color: ${BRAND_COLOR}; flex-shrink: 0; }
    .brand { display: inline-block; margin-left: 14px; }
    .brand-name { font-size: 18px; font-weight: 700; color: #fff; line-height: 1.2; }
    .brand-sub { font-size: 12px; color: rgba(255,255,255,0.65); }
    .divider-bar { width: 36px; height: 3px; background: ${ACCENT_COLOR}; border-radius: 2px; margin: 14px 0 0; }
    .body { background: #fff; padding: 36px; border-left: 1px solid #DDE4EE; border-right: 1px solid #DDE4EE; }
    .footer { background: #EEF3FA; border-radius: 0 0 16px 16px; padding: 20px 36px; text-align: center; border: 1px solid #DDE4EE; border-top: 0; }
    .footer p { font-size: 11px; color: #8899BB; margin: 0; line-height: 1.6; }
    h1 { font-size: 22px; font-weight: 700; color: ${BRAND_COLOR}; margin: 0 0 12px; }
    p { font-size: 14px; color: #334155; line-height: 1.7; margin: 0 0 14px; }
    .btn { display: inline-block; background: ${ACCENT_COLOR}; color: ${BRAND_COLOR} !important; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 12px; margin: 10px 0 20px; }
    .info-box { background: #EEF3FA; border-radius: 10px; padding: 16px 20px; border-left: 3px solid ${BRAND_COLOR}; margin: 18px 0; }
    .info-box p { margin: 0; font-size: 13px; color: #334155; }
    .token-box { background: #F4F7FB; border-radius: 10px; padding: 14px 20px; border: 1px solid #DDE4EE; text-align: center; margin: 16px 0; }
    .token { font-size: 22px; font-weight: 700; color: ${BRAND_COLOR}; letter-spacing: 3px; font-family: 'Courier New', monospace; }
    .role-badge { display: inline-block; background: #EEF3FA; border: 1px solid ${BRAND_COLOR}33; color: ${BRAND_COLOR}; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; margin: 4px 0; }
    .separator { border: none; border-top: 1px solid #EEF3FA; margin: 24px 0; }
  </style>
</head>
<body>
  ${preheader ? `<span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>` : ''}
  <div class="wrapper">
    <div class="header">
      <div class="logo-box">B</div>
      <div class="brand">
        <div class="brand-name">Bouygues</div>
        <div class="brand-sub">Construction</div>
        <div class="divider-bar"></div>
      </div>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p>BuildTrack — Gestion de chantier numérique<br/>
      Cet email a été envoyé automatiquement, merci de ne pas y répondre.<br/>
      &copy; ${new Date().getFullYear()} Bouygues Construction. Tous droits réservés.</p>
    </div>
  </div>
</body>
</html>`;
}

export const ROLE_LABELS_FR: Record<string, string> = {
  admin: 'Administrateur',
  conducteur: 'Conducteur de travaux',
  chef_equipe: "Chef d'équipe",
  observateur: 'Observateur',
  sous_traitant: 'Sous-traitant',
  super_admin: 'Super Administrateur',
};

export function invitationEmail(params: {
  invitedByName: string;
  organizationName: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  companyName?: string;
}) {
  const { invitedByName, organizationName, email, role, token, expiresAt, companyName } = params;
  const roleLabel = ROLE_LABELS_FR[role] ?? role;
  const registerUrl = `${APP_URL}/register`;
  const expDate = new Date(expiresAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const companyBlock = companyName
    ? `<p style="text-align:center;margin-top:-4px;">Entreprise rattachée : <strong>${companyName}</strong></p>`
    : '';

  const content = `
    <h1>Vous avez été invité !</h1>
    <p><strong>${invitedByName}</strong> vous invite à rejoindre l'organisation <strong>${organizationName}</strong> sur BuildTrack en tant que :</p>
    <p style="text-align:center;"><span class="role-badge">${roleLabel}</span></p>
    ${companyBlock}
    <p>Créez votre compte avec cette adresse email (<strong>${email}</strong>) pour accepter l'invitation :</p>
    <div style="text-align:center;">
      <a href="${registerUrl}" class="btn">Créer mon compte →</a>
    </div>
    <div class="info-box">
      <p><strong>Comment ça marche ?</strong><br/>
      1. Cliquez sur le bouton ci-dessus<br/>
      2. Choisissez <em>« Invitation reçue »</em> et créez votre compte avec l'email <strong>${email}</strong><br/>
      3. Votre accès à <strong>${organizationName}</strong> sera automatiquement activé</p>
    </div>
    <div class="token-box">
      <p style="font-size:12px;color:#8899BB;margin:0 0 8px;">Votre code d'invitation (conservez-le)</p>
      <div class="token">${token}</div>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">Cette invitation expire le <strong>${expDate}</strong>. Si vous n'attendiez pas cet email, vous pouvez l'ignorer.</p>
  `;

  return {
    subject: `Invitation à rejoindre ${organizationName} sur BuildTrack`,
    html: baseLayout(content, `${invitedByName} vous invite à rejoindre ${organizationName}`),
  };
}

export function welcomeEmail(params: {
  name: string;
  email: string;
  organizationName?: string;
}) {
  const { name, email, organizationName } = params;
  const appUrl = `${APP_URL}`;
  const firstName = name.split(' ')[0];

  const content = `
    <h1>Bienvenue, ${firstName} !</h1>
    <p>Votre compte BuildTrack a bien été créé pour l'adresse <strong>${email}</strong>.</p>
    ${organizationName ? `
    <div class="info-box">
      <p>Votre organisation <strong>${organizationName}</strong> a été créée. Vous êtes maintenant administrateur et pouvez inviter vos collaborateurs depuis l'écran Administration.</p>
    </div>
    ` : `
    <div class="info-box">
      <p>Votre compte est créé. Si vous avez reçu une invitation, connectez-vous : votre accès à l'organisation sera activé automatiquement.</p>
    </div>
    `}
    <p>Accédez à BuildTrack depuis votre navigateur ou scannez le QR code dans l'application Expo Go :</p>
    <div style="text-align:center;">
      <a href="${appUrl}" class="btn">Ouvrir BuildTrack →</a>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">Si vous n'avez pas créé ce compte, contactez votre administrateur.</p>
  `;

  return {
    subject: 'Bienvenue sur BuildTrack !',
    html: baseLayout(content, `Votre compte BuildTrack est prêt, ${firstName}`),
  };
}

export function passwordResetEmail(params: {
  name: string;
  resetUrl: string;
}) {
  const { name, resetUrl } = params;
  const firstName = name.split(' ')[0];

  const content = `
    <h1>Réinitialisation du mot de passe</h1>
    <p>Bonjour ${firstName},</p>
    <p>Vous avez demandé la réinitialisation de votre mot de passe BuildTrack. Cliquez sur le bouton ci-dessous pour en choisir un nouveau :</p>
    <div style="text-align:center;">
      <a href="${resetUrl}" class="btn">Réinitialiser mon mot de passe →</a>
    </div>
    <div class="info-box">
      <p>Ce lien est valable <strong>1 heure</strong>. Après expiration, vous devrez faire une nouvelle demande.</p>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">Si vous n'avez pas demandé cette réinitialisation, ignorez cet email. Votre mot de passe reste inchangé.</p>
  `;

  return {
    subject: 'Réinitialisation de votre mot de passe BuildTrack',
    html: baseLayout(content, 'Réinitialisez votre mot de passe BuildTrack'),
  };
}

export function passwordChangedEmail(params: {
  name: string;
}) {
  const { name } = params;
  const firstName = name.split(' ')[0];
  const loginUrl = `${APP_URL}/login`;
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const content = `
    <h1>Mot de passe modifié</h1>
    <p>Bonjour ${firstName},</p>
    <p>Votre mot de passe BuildTrack a bien été modifié le <strong>${date}</strong>.</p>
    <div class="info-box">
      <p>Si vous êtes à l'origine de cette modification, vous n'avez rien à faire. Vous pouvez vous connecter normalement avec votre nouveau mot de passe.</p>
    </div>
    <div style="text-align:center;">
      <a href="${loginUrl}" class="btn">Se connecter →</a>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">Si vous n'avez pas effectué cette modification, contactez immédiatement votre administrateur ou changez votre mot de passe dès que possible.</p>
  `;

  return {
    subject: 'Votre mot de passe BuildTrack a été modifié',
    html: baseLayout(content, 'Votre mot de passe BuildTrack vient d\'être modifié'),
  };
}

export function invitationAcceptedEmail(params: {
  adminName: string;
  inviteeName: string;
  inviteeEmail: string;
  organizationName: string;
  role: string;
}) {
  const { adminName, inviteeName, inviteeEmail, organizationName, role } = params;
  const adminFirstName = adminName.split(' ')[0];
  const roleLabel = ROLE_LABELS_FR[role] ?? role;

  const content = `
    <h1>Invitation acceptée ✓</h1>
    <p>Bonjour ${adminFirstName},</p>
    <p><strong>${inviteeName}</strong> a accepté votre invitation et a rejoint <strong>${organizationName}</strong> sur BuildTrack.</p>
    <div class="info-box">
      <p><strong>Email :</strong> ${inviteeEmail}<br/>
      <strong>Rôle :</strong> <span class="role-badge">${roleLabel}</span></p>
    </div>
    <p>Vous pouvez gérer les accès et les permissions de vos collaborateurs depuis l'écran Administration.</p>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">Si vous n'avez pas envoyé cette invitation, contactez votre administrateur système.</p>
  `;

  return {
    subject: `${inviteeName} a rejoint ${organizationName} sur BuildTrack`,
    html: baseLayout(content, `${inviteeName} a accepté votre invitation`),
  };
}

export function accessRevokedEmail(params: {
  name: string;
  organizationName: string;
}) {
  const { name, organizationName } = params;
  const firstName = name.split(' ')[0];

  const content = `
    <h1>Accès révoqué</h1>
    <p>Bonjour ${firstName},</p>
    <p>Votre accès à l'organisation <strong>${organizationName}</strong> sur BuildTrack a été révoqué par un administrateur.</p>
    <div class="info-box">
      <p>Votre compte BuildTrack existe toujours, mais vous n'avez plus accès aux chantiers et données de <strong>${organizationName}</strong>.</p>
    </div>
    <p>Si vous pensez qu'il s'agit d'une erreur, contactez directement votre responsable ou l'administrateur de votre organisation.</p>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">Cet email a été envoyé automatiquement suite à une action d'administration.</p>
  `;

  return {
    subject: `Votre accès à ${organizationName} a été révoqué`,
    html: baseLayout(content, `Votre accès à ${organizationName} sur BuildTrack a été révoqué`),
  };
}

export function reserveCreatedEmail(params: {
  recipientName: string;
  reserveTitle: string;
  reserveId: string;
  reserveUrl?: string;
  priority?: string;
  deadline?: string | null;
  building?: string;
  level?: string;
  zone?: string;
  description?: string;
  chantierName?: string;
  companyName: string;
  createdBy: string;
  reserveCode?: string;
}) {
  const {
    recipientName, reserveTitle, reserveId, reserveUrl, priority, deadline,
    building, level, zone, description, chantierName, companyName, createdBy, reserveCode,
  } = params;
  const firstName = recipientName.split(' ')[0];
  const url = reserveUrl ?? `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;
  const detailRows = [
    chantierName ? `<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">Chantier</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${chantierName}</td></tr>` : '',
    companyName ? `<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">Entreprise</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${companyName}</td></tr>` : '',
    priority ? `<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">Priorité</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${priority}</td></tr>` : '',
    deadline ? `<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">Échéance</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${deadline}</td></tr>` : '',
    building ? `<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">Bâtiment</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${building}${level ? ` – ${level}` : ''}${zone ? ` / ${zone}` : ''}</td></tr>` : '',
  ].filter(Boolean).join('');

  const content = `
    <h1>Nouvelle réserve assignée</h1>
    <p>Bonjour ${firstName},</p>
    <p>Une nouvelle réserve a été créée et assignée à votre entreprise par <strong>${createdBy}</strong>.</p>
    <div class="info-box">
      <p style="font-size:15px;font-weight:700;margin-bottom:8px;">${reserveTitle}${reserveCode ? ` <span style="font-size:12px;font-weight:400;color:#64748B;">(#${reserveCode})</span>` : ''}</p>
      <table style="border-collapse:collapse;width:100%;">${detailRows}</table>
    </div>
    ${description ? `<p style="color:#475569;font-size:13px;"><strong>Description :</strong> ${description}</p>` : ''}
    <a href="${url}" class="btn">Voir la réserve</a>
    <p style="font-size:12px;color:#8899BB;margin:0;">Si le bouton ne fonctionne pas, copiez ce lien : ${url}</p>
  `;

  return {
    subject: `Nouvelle réserve : ${reserveTitle}`,
    html: baseLayout(content, `Réserve assignée à ${companyName}`),
  };
}

export function reserveStatusChangedEmail(params: {
  recipientName: string;
  reserveTitle: string;
  reserveId: string;
  reserveUrl?: string;
  newStatus: string;
  previousStatus?: string;
  changedBy: string;
  companyName: string;
  chantierName?: string;
  reserveCode?: string;
}) {
  const {
    recipientName, reserveTitle, reserveId, reserveUrl, newStatus,
    previousStatus, changedBy, companyName, chantierName, reserveCode,
  } = params;
  const firstName = recipientName.split(' ')[0];
  const url = reserveUrl ?? `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;
  const statusLabel: Record<string, string> = {
    open: 'Ouverte', in_progress: 'En cours', verification: 'Vérification', closed: 'Clôturée',
  };
  const newLabel = statusLabel[newStatus] ?? newStatus;
  const prevLabel = previousStatus ? (statusLabel[previousStatus] ?? previousStatus) : null;

  const content = `
    <h1>Mise à jour de réserve</h1>
    <p>Bonjour ${firstName},</p>
    <p>Le statut d'une réserve qui vous concerne a été mis à jour par <strong>${changedBy}</strong>.</p>
    <div class="info-box">
      <p style="font-size:15px;font-weight:700;margin-bottom:8px;">${reserveTitle}${reserveCode ? ` <span style="font-size:12px;font-weight:400;color:#64748B;">(#${reserveCode})</span>` : ''}</p>
      ${prevLabel ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">Ancien statut : <strong>${prevLabel}</strong></p>` : ''}
      <p style="font-size:13px;margin:4px 0;">Nouveau statut : <strong>${newLabel}</strong></p>
      ${chantierName ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">Chantier : ${chantierName}</p>` : ''}
      ${companyName ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">Entreprise : ${companyName}</p>` : ''}
    </div>
    <a href="${url}" class="btn">Voir la réserve</a>
    <p style="font-size:12px;color:#8899BB;margin:0;">Si le bouton ne fonctionne pas, copiez ce lien : ${url}</p>
  `;

  return {
    subject: `Réserve mise à jour : ${reserveTitle}`,
    html: baseLayout(content, `Statut mis à jour : ${newLabel}`),
  };
}

export function reserveOverdueEmail(params: {
  recipientName: string;
  reserveTitle: string;
  reserveId: string;
  reserveUrl?: string;
  deadline: string;
  daysLate: number;
  priority?: string;
  companyName: string;
  chantierName?: string;
  reserveCode?: string;
}) {
  const {
    recipientName, reserveTitle, reserveId, reserveUrl, deadline, daysLate,
    priority, companyName, chantierName, reserveCode,
  } = params;
  const firstName = recipientName.split(' ')[0];
  const url = reserveUrl ?? `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;

  const content = `
    <h1>⚠️ Réserve en retard</h1>
    <p>Bonjour ${firstName},</p>
    <p>La réserve suivante est <strong>en retard de ${daysLate} jour${daysLate > 1 ? 's' : ''}</strong> et nécessite votre attention.</p>
    <div class="info-box" style="border-left-color:#EF4444;">
      <p style="font-size:15px;font-weight:700;margin-bottom:8px;">${reserveTitle}${reserveCode ? ` <span style="font-size:12px;font-weight:400;color:#64748B;">(#${reserveCode})</span>` : ''}</p>
      <p style="font-size:13px;margin:4px 0;color:#EF4444;font-weight:600;">Échéance dépassée : ${deadline}</p>
      ${priority ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">Priorité : ${priority}</p>` : ''}
      ${chantierName ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">Chantier : ${chantierName}</p>` : ''}
      ${companyName ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">Entreprise : ${companyName}</p>` : ''}
    </div>
    <p>Merci de mettre à jour le statut de cette réserve dès que possible.</p>
    <a href="${url}" class="btn">Traiter la réserve</a>
    <p style="font-size:12px;color:#8899BB;margin:0;">Si le bouton ne fonctionne pas, copiez ce lien : ${url}</p>
  `;

  return {
    subject: `⚠️ Réserve en retard (${daysLate}j) : ${reserveTitle}`,
    html: baseLayout(content, `Réserve en retard de ${daysLate} jour${daysLate > 1 ? 's' : ''}`),
  };
}
