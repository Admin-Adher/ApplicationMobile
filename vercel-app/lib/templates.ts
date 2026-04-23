const APP_URL = 'https://buildtrack-mobile.vercel.app';
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
    .header { background: ${BRAND_COLOR}; border-radius: 16px 16px 0 0; padding: 28px 36px; }
    .logo-row { display: flex; align-items: center; gap: 14px; }
    .logo-box { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: ${ACCENT_COLOR}; border-radius: 10px; font-size: 22px; font-weight: 700; color: ${BRAND_COLOR}; flex-shrink: 0; }
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
      <div class="logo-row">
        <div class="logo-box">B</div>
        <div>
          <div class="brand-name">Bouygues</div>
          <div class="brand-sub">Construction</div>
          <div class="divider-bar"></div>
        </div>
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

const ROLE_LABELS_FR: Record<string, string> = {
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
}) {
  const { invitedByName, organizationName, email, role, token, expiresAt } = params;
  const roleLabel = ROLE_LABELS_FR[role] ?? role;
  const deepLinkUrl = `${APP_URL}/invite?token=${token}`;
  const expDate = new Date(expiresAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const content = `
    <h1>Vous avez été invité !</h1>
    <p><strong>${invitedByName}</strong> vous invite à rejoindre l'organisation <strong>${organizationName}</strong> sur BuildTrack en tant que :</p>
    <p style="text-align:center;"><span class="role-badge">${roleLabel}</span></p>
    <p>Cliquez sur le bouton ci-dessous pour rejoindre l'organisation. Si vous avez l'application, elle s'ouvrira directement :</p>
    <div style="text-align:center;">
      <a href="${deepLinkUrl}" class="btn">Rejoindre ${organizationName} →</a>
    </div>
    <div class="info-box">
      <p><strong>Première fois sur BuildTrack ?</strong><br/>
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
  const appUrl = APP_URL;
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

export function invitationAcceptedEmail(params: {
  adminName: string;
  inviteeName: string;
  inviteeEmail: string;
  organizationName: string;
  role: string;
}) {
  const { adminName, inviteeName, inviteeEmail, organizationName, role } = params;
  const adminFirstName = adminName.split(' ')[0];
  const ROLE_LABELS_FR: Record<string, string> = {
    admin: 'Administrateur',
    conducteur: 'Conducteur de travaux',
    chef_equipe: "Chef d'équipe",
    observateur: 'Observateur',
    sous_traitant: 'Sous-traitant',
    super_admin: 'Super Administrateur',
  };
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

const PRIORITY_LABELS_FR: Record<string, { label: string; color: string }> = {
  low:      { label: 'Faible',   color: '#6B7280' },
  medium:   { label: 'Moyenne',  color: '#D97706' },
  high:     { label: 'Haute',    color: '#EA580C' },
  critical: { label: 'Critique', color: '#DC2626' },
};

export function reserveCreatedEmail(params: {
  recipientName: string;
  reserveTitle: string;
  reserveId: string;
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
    recipientName, reserveTitle, reserveId, priority, deadline,
    building, level, zone, description, chantierName, companyName, createdBy, reserveCode,
  } = params;
  const firstName = recipientName.split(' ')[0];
  const prio = PRIORITY_LABELS_FR[priority ?? 'medium'] ?? PRIORITY_LABELS_FR.medium;
  const deepLinkUrl = `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;
  const deadlineDate = deadline
    ? new Date(deadline).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const locationParts = [building, level, zone].filter(Boolean);
  const locationStr = locationParts.length > 0 ? locationParts.join(' • ') : null;

  const content = `
    <h1>Nouvelle réserve pour ${companyName}</h1>
    <p>Bonjour ${firstName},</p>
    <p><strong>${createdBy}</strong> vient de créer une nouvelle réserve impliquant votre entreprise <strong>${companyName}</strong>${chantierName ? ` sur le chantier <strong>${chantierName}</strong>` : ''}.</p>

    <div class="info-box" style="border-left-color:${prio.color};">
      <p style="font-size:15px;font-weight:700;color:#1A2742;margin:0 0 6px;">${reserveTitle}</p>
      ${reserveCode ? `<p style="font-size:11px;color:#8899BB;margin:0 0 8px;">Réf. ${reserveCode}</p>` : ''}
      <p style="margin:0;">
        <span style="display:inline-block;background:${prio.color}18;color:${prio.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;margin-right:6px;">${prio.label.toUpperCase()}</span>
        ${deadlineDate ? `<span style="font-size:12px;color:#5E738A;">Échéance : <strong style="color:#1A2742;">${deadlineDate}</strong></span>` : ''}
      </p>
    </div>

    ${locationStr ? `<p style="font-size:13px;color:#5E738A;margin:6px 0;"><strong style="color:#1A2742;">Localisation :</strong> ${locationStr}</p>` : ''}
    ${description ? `<p style="font-size:13px;color:#334155;background:#F4F7FB;padding:12px 14px;border-radius:8px;margin:10px 0;">${description}</p>` : ''}

    <div style="text-align:center;">
      <a href="${deepLinkUrl}" class="btn">Voir la réserve →</a>
    </div>

    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">Vous recevez cet email car votre profil est rattaché à <strong>${companyName}</strong> dans BuildTrack.</p>
  `;

  return {
    subject: `[${prio.label}] Nouvelle réserve — ${reserveTitle}`,
    html: baseLayout(content, `Nouvelle réserve pour ${companyName} : ${reserveTitle}`),
  };
}

const STATUS_LABELS_FR: Record<string, { label: string; color: string }> = {
  open:         { label: 'Ouverte',       color: '#DC2626' },
  in_progress:  { label: 'En cours',      color: '#2563EB' },
  waiting:      { label: 'En attente',    color: '#D97706' },
  verification: { label: 'À vérifier',    color: '#7C3AED' },
  closed:       { label: 'Levée',         color: '#16A34A' },
};

export function reserveStatusChangedEmail(params: {
  recipientName: string;
  reserveTitle: string;
  reserveId: string;
  newStatus: string;
  previousStatus?: string;
  changedBy: string;
  companyName: string;
  chantierName?: string;
  reserveCode?: string;
}) {
  const { recipientName, reserveTitle, reserveId, newStatus, previousStatus, changedBy, companyName, chantierName, reserveCode } = params;
  const firstName = recipientName.split(' ')[0];
  const next = STATUS_LABELS_FR[newStatus] ?? { label: newStatus, color: '#1A2742' };
  const prev = previousStatus ? (STATUS_LABELS_FR[previousStatus] ?? { label: previousStatus, color: '#8899BB' }) : null;
  const deepLinkUrl = `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;

  const content = `
    <h1>Statut de réserve mis à jour</h1>
    <p>Bonjour ${firstName},</p>
    <p><strong>${changedBy}</strong> a mis à jour le statut d'une réserve impliquant <strong>${companyName}</strong>${chantierName ? ` sur le chantier <strong>${chantierName}</strong>` : ''}.</p>

    <div class="info-box" style="border-left-color:${next.color};">
      <p style="font-size:15px;font-weight:700;color:#1A2742;margin:0 0 6px;">${reserveTitle}</p>
      ${reserveCode ? `<p style="font-size:11px;color:#8899BB;margin:0 0 10px;">Réf. ${reserveCode}</p>` : ''}
      <p style="margin:0;font-size:13px;color:#5E738A;">
        ${prev ? `<span style="display:inline-block;background:#F4F7FB;color:${prev.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;text-decoration:line-through;">${prev.label.toUpperCase()}</span>
        <span style="margin:0 6px;color:#8899BB;">→</span>` : ''}
        <span style="display:inline-block;background:${next.color}18;color:${next.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">${next.label.toUpperCase()}</span>
      </p>
    </div>

    <div style="text-align:center;">
      <a href="${deepLinkUrl}" class="btn">Voir la réserve →</a>
    </div>

    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">Vous recevez cet email car votre profil est rattaché à <strong>${companyName}</strong> dans BuildTrack.</p>
  `;

  return {
    subject: `[${next.label}] Réserve mise à jour — ${reserveTitle}`,
    html: baseLayout(content, `Statut de réserve : ${next.label}`),
  };
}

export function reserveOverdueEmail(params: {
  recipientName: string;
  reserveTitle: string;
  reserveId: string;
  deadline: string;
  daysLate: number;
  priority?: string;
  companyName: string;
  chantierName?: string;
  reserveCode?: string;
}) {
  const { recipientName, reserveTitle, reserveId, deadline, daysLate, priority, companyName, chantierName, reserveCode } = params;
  const firstName = recipientName.split(' ')[0];
  const prio = PRIORITY_LABELS_FR[priority ?? 'medium'] ?? PRIORITY_LABELS_FR.medium;
  const deepLinkUrl = `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;
  const deadlineDate = new Date(deadline).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const dayWord = daysLate <= 1 ? 'jour' : 'jours';

  const content = `
    <h1 style="color:#DC2626;">Réserve en retard</h1>
    <p>Bonjour ${firstName},</p>
    <p>Une réserve impliquant <strong>${companyName}</strong>${chantierName ? ` sur le chantier <strong>${chantierName}</strong>` : ''} a <strong>dépassé son échéance</strong> et n'est toujours pas levée.</p>

    <div class="info-box" style="border-left-color:#DC2626;background:#FEF2F2;">
      <p style="font-size:15px;font-weight:700;color:#1A2742;margin:0 0 6px;">${reserveTitle}</p>
      ${reserveCode ? `<p style="font-size:11px;color:#8899BB;margin:0 0 10px;">Réf. ${reserveCode}</p>` : ''}
      <p style="margin:0 0 6px;">
        <span style="display:inline-block;background:${prio.color}18;color:${prio.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;margin-right:6px;">${prio.label.toUpperCase()}</span>
        <span style="display:inline-block;background:#DC262618;color:#DC2626;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">EN RETARD DE ${daysLate} ${dayWord.toUpperCase()}</span>
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#5E738A;">Échéance dépassée : <strong style="color:#DC2626;">${deadlineDate}</strong></p>
    </div>

    <p style="font-size:14px;color:#334155;">Merci de traiter cette réserve dans les plus brefs délais ou de mettre à jour son statut depuis l'application.</p>

    <div style="text-align:center;">
      <a href="${deepLinkUrl}" class="btn" style="background:#DC2626;">Traiter la réserve →</a>
    </div>

    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">Vous recevez cet email car votre profil est rattaché à <strong>${companyName}</strong> dans BuildTrack.</p>
  `;

  return {
    subject: `[Retard ${daysLate}j] Réserve à traiter — ${reserveTitle}`,
    html: baseLayout(content, `Réserve en retard de ${daysLate} ${dayWord} : ${reserveTitle}`),
  };
}

