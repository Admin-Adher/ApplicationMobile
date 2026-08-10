export const APP_URL = process.env.EXPO_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://buildtrack-mobile.vercel.app';
const BRAND_COLOR = '#003082';
const ACCENT_COLOR = '#FFCB00';

export type EmailLanguage = 'fr' | 'en' | 'es';

type EmailParams = {
  language?: string | null;
};

type LabelSet = Record<string, string>;

const EMAIL_LOCALES: Record<EmailLanguage, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
};

const ROLE_LABELS: Record<EmailLanguage, LabelSet> = {
  fr: {
    admin: 'Administrateur',
    conducteur: 'Conducteur de travaux',
    magasinier: 'Magasinier',
    chef_equipe: "Chef d'équipe",
    observateur: 'Observateur',
    sous_traitant: 'Sous-traitant',
    super_admin: 'Super administrateur',
  },
  en: {
    admin: 'Administrator',
    conducteur: 'Construction manager',
    magasinier: 'Storekeeper',
    chef_equipe: 'Team lead',
    observateur: 'Observer',
    sous_traitant: 'Subcontractor',
    super_admin: 'Super administrator',
  },
  es: {
    admin: 'Administrador',
    conducteur: 'Jefe de obra',
    magasinier: 'Almacenero',
    chef_equipe: 'Jefe de equipo',
    observateur: 'Observador',
    sous_traitant: 'Subcontratista',
    super_admin: 'Superadministrador',
  },
};

export const ROLE_LABELS_FR = ROLE_LABELS.fr;

const STATUS_LABELS: Record<EmailLanguage, LabelSet> = {
  fr: {
    open: 'Ouverte',
    in_progress: 'En cours',
    waiting: 'En attente',
    verification: 'Vérification',
    closed: 'Clôturée',
  },
  en: {
    open: 'Open',
    in_progress: 'In progress',
    waiting: 'Pending',
    verification: 'Verification',
    closed: 'Closed',
  },
  es: {
    open: 'Abierta',
    in_progress: 'En curso',
    waiting: 'En espera',
    verification: 'Verificación',
    closed: 'Cerrada',
  },
};

const PRIORITY_LABELS: Record<EmailLanguage, LabelSet> = {
  fr: {
    critical: 'Critique',
    high: 'Haute',
    medium: 'Moyenne',
    low: 'Basse',
  },
  en: {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  },
  es: {
    critical: 'Crítica',
    high: 'Alta',
    medium: 'Media',
    low: 'Baja',
  },
};

const PRIORITY_COLORS: LabelSet = {
  critical: '#DC2626',
  high: '#EA580C',
  medium: '#D97706',
  low: '#6B7280',
};

const COPY = {
  fr: {
    footer: {
      product: 'BuildTrack — Gestion de chantier numérique',
      automated: 'Cet email a été envoyé automatiquement, merci de ne pas y répondre.',
      rights: 'BuildTrack. Tous droits réservés.',
    },
    common: {
      hello: (name: string) => `Bonjour ${name},`,
      ignore: "Si vous n'attendiez pas cet email, vous pouvez l'ignorer.",
      linkFallback: (url: string) => `Si le bouton ne fonctionne pas, copiez ce lien : ${url}`,
      chantier: 'Chantier',
      company: 'Entreprise',
      priority: 'Priorité',
      deadline: 'Échéance',
      location: 'Localisation',
      status: 'Statut',
      email: 'Email',
      role: 'Rôle',
      ref: 'Réf.',
    },
    invitation: {
      title: 'Vous avez été invité !',
      intro: (by: string, org: string) => `<strong>${by}</strong> vous invite à rejoindre l'organisation <strong>${org}</strong> sur BuildTrack en tant que :`,
      company: (company: string) => `Entreprise rattachée : <strong>${company}</strong>`,
      create: (email: string) => `Créez votre compte avec cette adresse email (<strong>${email}</strong>) pour accepter l'invitation :`,
      button: 'Créer mon compte →',
      howTitle: 'Comment ça marche ?',
      steps: (email: string, org: string) => `1. Cliquez sur le bouton ci-dessus<br/>2. Choisissez <em>« Invitation reçue »</em> et créez votre compte avec l'email <strong>${email}</strong><br/>3. Votre accès à <strong>${org}</strong> sera automatiquement activé`,
      token: "Votre code d'invitation (conservez-le)",
      expires: (date: string) => `Cette invitation expire le <strong>${date}</strong>.`,
      subject: (org: string) => `Invitation à rejoindre ${org} sur BuildTrack`,
      preheader: (by: string, org: string) => `${by} vous invite à rejoindre ${org}`,
    },
    welcome: {
      title: (name: string) => `Bienvenue, ${name} !`,
      account: (email: string) => `Votre compte BuildTrack a bien été créé pour l'adresse <strong>${email}</strong>.`,
      orgCreated: (org: string) => `Votre organisation <strong>${org}</strong> a été créée. Vous êtes maintenant administrateur et pouvez inviter vos collaborateurs depuis l'écran Administration.`,
      invited: "Votre compte est créé. Si vous avez reçu une invitation, connectez-vous : votre accès à l'organisation sera activé automatiquement.",
      open: 'Ouvrir BuildTrack →',
      security: "Si vous n'avez pas créé ce compte, contactez votre administrateur.",
      subject: 'Bienvenue sur BuildTrack !',
      preheader: (name: string) => `Votre compte BuildTrack est prêt, ${name}`,
    },
    passwordReset: {
      title: 'Réinitialisation du mot de passe',
      intro: 'Vous avez demandé la réinitialisation de votre mot de passe BuildTrack. Cliquez sur le bouton ci-dessous pour en choisir un nouveau :',
      button: 'Réinitialiser mon mot de passe →',
      validity: 'Ce lien est valable <strong>1 heure</strong>. Après expiration, vous devrez faire une nouvelle demande.',
      ignore: "Si vous n'avez pas demandé cette réinitialisation, ignorez cet email. Votre mot de passe reste inchangé.",
      subject: 'Réinitialisation de votre mot de passe BuildTrack',
      preheader: 'Réinitialisez votre mot de passe BuildTrack',
    },
    passwordChanged: {
      title: 'Mot de passe modifié',
      changed: (date: string) => `Votre mot de passe BuildTrack a bien été modifié le <strong>${date}</strong>.`,
      safe: "Si vous êtes à l'origine de cette modification, vous n'avez rien à faire. Vous pouvez vous connecter normalement avec votre nouveau mot de passe.",
      login: 'Se connecter →',
      warning: "Si vous n'avez pas effectué cette modification, contactez immédiatement votre administrateur ou changez votre mot de passe dès que possible.",
      subject: 'Votre mot de passe BuildTrack a été modifié',
      preheader: "Votre mot de passe BuildTrack vient d'être modifié",
    },
    accepted: {
      title: 'Invitation acceptée',
      intro: (name: string, org: string) => `<strong>${name}</strong> a accepté votre invitation et a rejoint <strong>${org}</strong> sur BuildTrack.`,
      manage: "Vous pouvez gérer les accès et les permissions de vos collaborateurs depuis l'écran Administration.",
      warning: "Si vous n'avez pas envoyé cette invitation, contactez votre administrateur système.",
      subject: (name: string, org: string) => `${name} a rejoint ${org} sur BuildTrack`,
      preheader: (name: string) => `${name} a accepté votre invitation`,
    },
    revoked: {
      title: 'Accès révoqué',
      intro: (org: string) => `Votre accès à l'organisation <strong>${org}</strong> sur BuildTrack a été révoqué par un administrateur.`,
      details: (org: string) => `Votre compte BuildTrack existe toujours, mais vous n'avez plus accès aux chantiers et données de <strong>${org}</strong>.`,
      help: "Si vous pensez qu'il s'agit d'une erreur, contactez directement votre responsable ou l'administrateur de votre organisation.",
      subject: (org: string) => `Votre accès à ${org} a été révoqué`,
      preheader: (org: string) => `Votre accès à ${org} sur BuildTrack a été révoqué`,
    },
    reserveCreated: {
      title: 'Nouvelle réserve assignée',
      intro: (by: string) => `Une nouvelle réserve a été créée et assignée à votre entreprise par <strong>${by}</strong>.`,
      description: 'Description',
      button: 'Voir la réserve',
      subject: (title: string) => `Nouvelle réserve : ${title}`,
      preheader: (company: string) => `Réserve assignée à ${company}`,
    },
    reserveStatus: {
      title: 'Mise à jour de réserve',
      intro: (by: string) => `Le statut d'une réserve qui vous concerne a été mis à jour par <strong>${by}</strong>.`,
      previous: 'Ancien statut',
      next: 'Nouveau statut',
      button: 'Voir la réserve',
      subject: (title: string) => `Réserve mise à jour : ${title}`,
      preheader: (status: string) => `Statut mis à jour : ${status}`,
    },
    overdue: {
      title: 'Réserve en retard',
      intro: (days: number) => `La réserve suivante est <strong>en retard de ${days} ${days > 1 ? 'jours' : 'jour'}</strong> et nécessite votre attention.`,
      missed: 'Échéance dépassée',
      thanks: 'Merci de mettre à jour le statut de cette réserve dès que possible.',
      button: 'Traiter la réserve',
      subject: (days: number, title: string) => `Réserve en retard (${days}j) : ${title}`,
      preheader: (days: number) => `Réserve en retard de ${days} ${days > 1 ? 'jours' : 'jour'}`,
    },
  },
  en: {
    footer: {
      product: 'BuildTrack — Digital construction site management',
      automated: 'This email was sent automatically. Please do not reply.',
      rights: 'BuildTrack. All rights reserved.',
    },
    common: {
      hello: (name: string) => `Hello ${name},`,
      ignore: 'If you were not expecting this email, you can ignore it.',
      linkFallback: (url: string) => `If the button does not work, copy this link: ${url}`,
      chantier: 'Project',
      company: 'Company',
      priority: 'Priority',
      deadline: 'Deadline',
      location: 'Location',
      status: 'Status',
      email: 'Email',
      role: 'Role',
      ref: 'Ref.',
    },
    invitation: {
      title: 'You have been invited!',
      intro: (by: string, org: string) => `<strong>${by}</strong> invites you to join <strong>${org}</strong> on BuildTrack as:`,
      company: (company: string) => `Linked company: <strong>${company}</strong>`,
      create: (email: string) => `Create your account with this email address (<strong>${email}</strong>) to accept the invitation:`,
      button: 'Create my account →',
      howTitle: 'How it works',
      steps: (email: string, org: string) => `1. Click the button above<br/>2. Choose <em>"Received invitation"</em> and create your account with <strong>${email}</strong><br/>3. Your access to <strong>${org}</strong> will be activated automatically`,
      token: 'Your invitation code (keep it)',
      expires: (date: string) => `This invitation expires on <strong>${date}</strong>.`,
      subject: (org: string) => `Invitation to join ${org} on BuildTrack`,
      preheader: (by: string, org: string) => `${by} invites you to join ${org}`,
    },
    welcome: {
      title: (name: string) => `Welcome, ${name}!`,
      account: (email: string) => `Your BuildTrack account has been created for <strong>${email}</strong>.`,
      orgCreated: (org: string) => `Your organisation <strong>${org}</strong> has been created. You are now an administrator and can invite teammates from the Administration screen.`,
      invited: 'Your account has been created. If you received an invitation, sign in and your organisation access will be activated automatically.',
      open: 'Open BuildTrack →',
      security: 'If you did not create this account, contact your administrator.',
      subject: 'Welcome to BuildTrack!',
      preheader: (name: string) => `Your BuildTrack account is ready, ${name}`,
    },
    passwordReset: {
      title: 'Password reset',
      intro: 'You requested a BuildTrack password reset. Click the button below to choose a new password:',
      button: 'Reset my password →',
      validity: 'This link is valid for <strong>1 hour</strong>. After it expires, you will need to request a new one.',
      ignore: 'If you did not request this reset, ignore this email. Your password remains unchanged.',
      subject: 'Reset your BuildTrack password',
      preheader: 'Reset your BuildTrack password',
    },
    passwordChanged: {
      title: 'Password changed',
      changed: (date: string) => `Your BuildTrack password was changed on <strong>${date}</strong>.`,
      safe: 'If you made this change, no action is needed. You can sign in normally with your new password.',
      login: 'Sign in →',
      warning: 'If you did not make this change, contact your administrator immediately or change your password as soon as possible.',
      subject: 'Your BuildTrack password was changed',
      preheader: 'Your BuildTrack password has just been changed',
    },
    accepted: {
      title: 'Invitation accepted',
      intro: (name: string, org: string) => `<strong>${name}</strong> accepted your invitation and joined <strong>${org}</strong> on BuildTrack.`,
      manage: 'You can manage access and permissions from the Administration screen.',
      warning: 'If you did not send this invitation, contact your system administrator.',
      subject: (name: string, org: string) => `${name} joined ${org} on BuildTrack`,
      preheader: (name: string) => `${name} accepted your invitation`,
    },
    revoked: {
      title: 'Access revoked',
      intro: (org: string) => `Your access to <strong>${org}</strong> on BuildTrack was revoked by an administrator.`,
      details: (org: string) => `Your BuildTrack account still exists, but you no longer have access to <strong>${org}</strong> projects and data.`,
      help: 'If you think this is a mistake, contact your manager or organisation administrator directly.',
      subject: (org: string) => `Your access to ${org} was revoked`,
      preheader: (org: string) => `Your access to ${org} on BuildTrack was revoked`,
    },
    reserveCreated: {
      title: 'New issue assigned',
      intro: (by: string) => `A new issue was created and assigned to your company by <strong>${by}</strong>.`,
      description: 'Description',
      button: 'View issue',
      subject: (title: string) => `New issue: ${title}`,
      preheader: (company: string) => `Issue assigned to ${company}`,
    },
    reserveStatus: {
      title: 'Issue update',
      intro: (by: string) => `The status of an issue related to you was updated by <strong>${by}</strong>.`,
      previous: 'Previous status',
      next: 'New status',
      button: 'View issue',
      subject: (title: string) => `Issue updated: ${title}`,
      preheader: (status: string) => `Status updated: ${status}`,
    },
    overdue: {
      title: 'Overdue issue',
      intro: (days: number) => `The following issue is <strong>${days} ${days > 1 ? 'days' : 'day'} overdue</strong> and needs your attention.`,
      missed: 'Missed deadline',
      thanks: 'Please update this issue status as soon as possible.',
      button: 'Handle issue',
      subject: (days: number, title: string) => `Overdue issue (${days}d): ${title}`,
      preheader: (days: number) => `Issue ${days} ${days > 1 ? 'days' : 'day'} overdue`,
    },
  },
  es: {
    footer: {
      product: 'BuildTrack — Gestión digital de obra',
      automated: 'Este correo se envió automáticamente. Por favor, no respondas.',
      rights: 'BuildTrack. Todos los derechos reservados.',
    },
    common: {
      hello: (name: string) => `Hola ${name},`,
      ignore: 'Si no esperabas este correo, puedes ignorarlo.',
      linkFallback: (url: string) => `Si el botón no funciona, copia este enlace: ${url}`,
      chantier: 'Obra',
      company: 'Empresa',
      priority: 'Prioridad',
      deadline: 'Fecha límite',
      location: 'Ubicación',
      status: 'Estado',
      email: 'Email',
      role: 'Rol',
      ref: 'Ref.',
    },
    invitation: {
      title: '¡Has recibido una invitación!',
      intro: (by: string, org: string) => `<strong>${by}</strong> te invita a unirte a <strong>${org}</strong> en BuildTrack como:`,
      company: (company: string) => `Empresa vinculada: <strong>${company}</strong>`,
      create: (email: string) => `Crea tu cuenta con este correo (<strong>${email}</strong>) para aceptar la invitación:`,
      button: 'Crear mi cuenta →',
      howTitle: 'Cómo funciona',
      steps: (email: string, org: string) => `1. Haz clic en el botón anterior<br/>2. Elige <em>"Invitación recibida"</em> y crea tu cuenta con <strong>${email}</strong><br/>3. Tu acceso a <strong>${org}</strong> se activará automáticamente`,
      token: 'Tu código de invitación (guárdalo)',
      expires: (date: string) => `Esta invitación caduca el <strong>${date}</strong>.`,
      subject: (org: string) => `Invitación para unirte a ${org} en BuildTrack`,
      preheader: (by: string, org: string) => `${by} te invita a unirte a ${org}`,
    },
    welcome: {
      title: (name: string) => `¡Bienvenido, ${name}!`,
      account: (email: string) => `Tu cuenta BuildTrack se ha creado para <strong>${email}</strong>.`,
      orgCreated: (org: string) => `Tu organización <strong>${org}</strong> se ha creado. Ahora eres administrador y puedes invitar a colaboradores desde Administración.`,
      invited: 'Tu cuenta se ha creado. Si recibiste una invitación, inicia sesión y tu acceso a la organización se activará automáticamente.',
      open: 'Abrir BuildTrack →',
      security: 'Si no creaste esta cuenta, contacta con tu administrador.',
      subject: '¡Bienvenido a BuildTrack!',
      preheader: (name: string) => `Tu cuenta BuildTrack está lista, ${name}`,
    },
    passwordReset: {
      title: 'Restablecimiento de contraseña',
      intro: 'Has solicitado restablecer tu contraseña de BuildTrack. Haz clic en el botón para elegir una nueva:',
      button: 'Restablecer mi contraseña →',
      validity: 'Este enlace es válido durante <strong>1 hora</strong>. Después tendrás que solicitar uno nuevo.',
      ignore: 'Si no solicitaste este restablecimiento, ignora este correo. Tu contraseña no cambia.',
      subject: 'Restablece tu contraseña de BuildTrack',
      preheader: 'Restablece tu contraseña de BuildTrack',
    },
    passwordChanged: {
      title: 'Contraseña modificada',
      changed: (date: string) => `Tu contraseña de BuildTrack se modificó el <strong>${date}</strong>.`,
      safe: 'Si realizaste este cambio, no tienes que hacer nada. Puedes iniciar sesión con tu nueva contraseña.',
      login: 'Iniciar sesión →',
      warning: 'Si no realizaste este cambio, contacta inmediatamente con tu administrador o cambia tu contraseña cuanto antes.',
      subject: 'Tu contraseña de BuildTrack se ha modificado',
      preheader: 'Tu contraseña de BuildTrack acaba de modificarse',
    },
    accepted: {
      title: 'Invitación aceptada',
      intro: (name: string, org: string) => `<strong>${name}</strong> aceptó tu invitación y se unió a <strong>${org}</strong> en BuildTrack.`,
      manage: 'Puedes gestionar accesos y permisos desde la pantalla Administración.',
      warning: 'Si no enviaste esta invitación, contacta con tu administrador del sistema.',
      subject: (name: string, org: string) => `${name} se unió a ${org} en BuildTrack`,
      preheader: (name: string) => `${name} aceptó tu invitación`,
    },
    revoked: {
      title: 'Acceso revocado',
      intro: (org: string) => `Un administrador ha revocado tu acceso a <strong>${org}</strong> en BuildTrack.`,
      details: (org: string) => `Tu cuenta BuildTrack sigue existiendo, pero ya no tienes acceso a las obras y datos de <strong>${org}</strong>.`,
      help: 'Si crees que es un error, contacta directamente con tu responsable o administrador.',
      subject: (org: string) => `Tu acceso a ${org} ha sido revocado`,
      preheader: (org: string) => `Tu acceso a ${org} en BuildTrack ha sido revocado`,
    },
    reserveCreated: {
      title: 'Nueva reserva asignada',
      intro: (by: string) => `Se ha creado una nueva reserva y se ha asignado a tu empresa por <strong>${by}</strong>.`,
      description: 'Descripción',
      button: 'Ver reserva',
      subject: (title: string) => `Nueva reserva: ${title}`,
      preheader: (company: string) => `Reserva asignada a ${company}`,
    },
    reserveStatus: {
      title: 'Actualización de reserva',
      intro: (by: string) => `El estado de una reserva relacionada contigo fue actualizado por <strong>${by}</strong>.`,
      previous: 'Estado anterior',
      next: 'Nuevo estado',
      button: 'Ver reserva',
      subject: (title: string) => `Reserva actualizada: ${title}`,
      preheader: (status: string) => `Estado actualizado: ${status}`,
    },
    overdue: {
      title: 'Reserva retrasada',
      intro: (days: number) => `La siguiente reserva lleva <strong>${days} ${days > 1 ? 'días' : 'día'} de retraso</strong> y necesita atención.`,
      missed: 'Fecha límite superada',
      thanks: 'Actualiza el estado de esta reserva lo antes posible.',
      button: 'Tratar reserva',
      subject: (days: number, title: string) => `Reserva retrasada (${days}d): ${title}`,
      preheader: (days: number) => `Reserva con ${days} ${days > 1 ? 'días' : 'día'} de retraso`,
    },
  },
} as const;

function escapeHtml(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeEmailLanguage(language?: string | null): EmailLanguage {
  const normalized = String(language ?? '').trim().toLowerCase();
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('es')) return 'es';
  return 'fr';
}

function copyFor(language?: string | null) {
  return COPY[normalizeEmailLanguage(language)];
}

function firstName(name: string): string {
  return String(name || '').trim().split(/\s+/)[0] || name || '';
}

function formatDate(value: string | Date, language?: string | null, withTime = false): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(EMAIL_LOCALES[normalizeEmailLanguage(language)], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function roleLabel(role: string, language?: string | null): string {
  const lang = normalizeEmailLanguage(language);
  return ROLE_LABELS[lang][role] ?? role;
}

function statusLabel(status?: string | null, language?: string | null): string {
  if (!status) return '—';
  const lang = normalizeEmailLanguage(language);
  return STATUS_LABELS[lang][status] ?? status;
}

function priorityLabel(priority?: string | null, language?: string | null): string {
  if (!priority) return '—';
  const lang = normalizeEmailLanguage(language);
  return PRIORITY_LABELS[lang][priority] ?? priority;
}

function priorityColor(priority?: string | null): string {
  if (!priority) return '#6B7280';
  return PRIORITY_COLORS[priority] ?? '#6B7280';
}

function baseLayout(content: string, preheader = '', language?: string | null): string {
  const lang = normalizeEmailLanguage(language);
  const c = COPY[lang];
  return `<!DOCTYPE html>
<html lang="${lang}">
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
  ${preheader ? `<span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</span>` : ''}
  <div class="wrapper">
    <div class="header">
      <div class="logo-box">B</div>
      <div class="brand">
        <div class="brand-name">BuildTrack</div>
        <div class="brand-sub">Gestion de chantier</div>
        <div class="divider-bar"></div>
      </div>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p>${c.footer.product}<br/>
      ${c.footer.automated}<br/>
      &copy; ${new Date().getFullYear()} ${c.footer.rights}</p>
    </div>
  </div>
</body>
</html>`;
}

export function invitationEmail(params: EmailParams & {
  invitedByName: string;
  organizationName: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  companyName?: string;
}) {
  const c = copyFor(params.language);
  const registerUrl = `${APP_URL}/invite?token=${encodeURIComponent(params.token)}`;
  const expDate = formatDate(params.expiresAt, params.language);
  const content = `
    <h1>${c.invitation.title}</h1>
    <p>${c.invitation.intro(escapeHtml(params.invitedByName), escapeHtml(params.organizationName))}</p>
    <p style="text-align:center;"><span class="role-badge">${escapeHtml(roleLabel(params.role, params.language))}</span></p>
    ${params.companyName ? `<p style="text-align:center;margin-top:-4px;">${c.invitation.company(escapeHtml(params.companyName))}</p>` : ''}
    <p>${c.invitation.create(escapeHtml(params.email))}</p>
    <div style="text-align:center;">
      <a href="${escapeHtml(registerUrl)}" class="btn">${c.invitation.button}</a>
    </div>
    <div class="info-box">
      <p><strong>${c.invitation.howTitle}</strong><br/>${c.invitation.steps(escapeHtml(params.email), escapeHtml(params.organizationName))}</p>
    </div>
    <div class="token-box">
      <p style="font-size:12px;color:#8899BB;margin:0 0 8px;">${c.invitation.token}</p>
      <div class="token">${escapeHtml(params.token)}</div>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${c.invitation.expires(escapeHtml(expDate))} ${c.common.ignore}</p>
  `;

  return {
    subject: c.invitation.subject(params.organizationName),
    html: baseLayout(content, c.invitation.preheader(params.invitedByName, params.organizationName), params.language),
  };
}

export function welcomeEmail(params: EmailParams & {
  name: string;
  email: string;
  organizationName?: string;
}) {
  const c = copyFor(params.language);
  const name = firstName(params.name);
  const content = `
    <h1>${c.welcome.title(escapeHtml(name))}</h1>
    <p>${c.welcome.account(escapeHtml(params.email))}</p>
    <div class="info-box">
      <p>${params.organizationName ? c.welcome.orgCreated(escapeHtml(params.organizationName)) : c.welcome.invited}</p>
    </div>
    <div style="text-align:center;">
      <a href="${APP_URL}" class="btn">${c.welcome.open}</a>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${c.welcome.security}</p>
  `;

  return {
    subject: c.welcome.subject,
    html: baseLayout(content, c.welcome.preheader(name), params.language),
  };
}

export function passwordResetEmail(params: EmailParams & {
  name: string;
  resetUrl: string;
}) {
  const c = copyFor(params.language);
  const name = firstName(params.name);
  const content = `
    <h1>${c.passwordReset.title}</h1>
    <p>${c.common.hello(escapeHtml(name))}</p>
    <p>${c.passwordReset.intro}</p>
    <div style="text-align:center;">
      <a href="${escapeHtml(params.resetUrl)}" class="btn">${c.passwordReset.button}</a>
    </div>
    <div class="info-box">
      <p>${c.passwordReset.validity}</p>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${c.passwordReset.ignore}</p>
  `;

  return {
    subject: c.passwordReset.subject,
    html: baseLayout(content, c.passwordReset.preheader, params.language),
  };
}

export function passwordChangedEmail(params: EmailParams & {
  name: string;
}) {
  const c = copyFor(params.language);
  const name = firstName(params.name);
  const loginUrl = `${APP_URL}/login`;
  const date = formatDate(new Date(), params.language, true);
  const content = `
    <h1>${c.passwordChanged.title}</h1>
    <p>${c.common.hello(escapeHtml(name))}</p>
    <p>${c.passwordChanged.changed(escapeHtml(date))}</p>
    <div class="info-box">
      <p>${c.passwordChanged.safe}</p>
    </div>
    <div style="text-align:center;">
      <a href="${loginUrl}" class="btn">${c.passwordChanged.login}</a>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${c.passwordChanged.warning}</p>
  `;

  return {
    subject: c.passwordChanged.subject,
    html: baseLayout(content, c.passwordChanged.preheader, params.language),
  };
}

export function invitationAcceptedEmail(params: EmailParams & {
  adminName: string;
  inviteeName: string;
  inviteeEmail: string;
  organizationName: string;
  role: string;
}) {
  const c = copyFor(params.language);
  const name = firstName(params.adminName);
  const content = `
    <h1>${c.accepted.title}</h1>
    <p>${c.common.hello(escapeHtml(name))}</p>
    <p>${c.accepted.intro(escapeHtml(params.inviteeName), escapeHtml(params.organizationName))}</p>
    <div class="info-box">
      <p><strong>${c.common.email} :</strong> ${escapeHtml(params.inviteeEmail)}<br/>
      <strong>${c.common.role} :</strong> <span class="role-badge">${escapeHtml(roleLabel(params.role, params.language))}</span></p>
    </div>
    <p>${c.accepted.manage}</p>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${c.accepted.warning}</p>
  `;

  return {
    subject: c.accepted.subject(params.inviteeName, params.organizationName),
    html: baseLayout(content, c.accepted.preheader(params.inviteeName), params.language),
  };
}

export function accessRevokedEmail(params: EmailParams & {
  name: string;
  organizationName: string;
}) {
  const c = copyFor(params.language);
  const name = firstName(params.name);
  const content = `
    <h1>${c.revoked.title}</h1>
    <p>${c.common.hello(escapeHtml(name))}</p>
    <p>${c.revoked.intro(escapeHtml(params.organizationName))}</p>
    <div class="info-box">
      <p>${c.revoked.details(escapeHtml(params.organizationName))}</p>
    </div>
    <p>${c.revoked.help}</p>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${c.footer.automated}</p>
  `;

  return {
    subject: c.revoked.subject(params.organizationName),
    html: baseLayout(content, c.revoked.preheader(params.organizationName), params.language),
  };
}

export function reserveCreatedEmail(params: EmailParams & {
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
  const c = copyFor(params.language);
  const name = firstName(params.recipientName);
  const url = params.reserveUrl ?? `${APP_URL}/reserve/${encodeURIComponent(params.reserveId)}`;
  const detailRows = [
    params.chantierName ? `<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">${c.common.chantier}</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${escapeHtml(params.chantierName)}</td></tr>` : '',
    params.companyName ? `<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">${c.common.company}</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${escapeHtml(params.companyName)}</td></tr>` : '',
    params.priority ? `<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">${c.common.priority}</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${escapeHtml(priorityLabel(params.priority, params.language))}</td></tr>` : '',
    params.deadline ? `<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">${c.common.deadline}</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${escapeHtml(formatDate(params.deadline, params.language))}</td></tr>` : '',
    params.building ? `<tr><td style="color:#64748B;font-size:13px;padding:4px 0;">${c.common.location}</td><td style="font-size:13px;font-weight:600;padding:4px 0 4px 12px;">${escapeHtml(params.building)}${params.level ? ` - ${escapeHtml(params.level)}` : ''}${params.zone ? ` / ${escapeHtml(params.zone)}` : ''}</td></tr>` : '',
  ].filter(Boolean).join('');

  const content = `
    <h1>${c.reserveCreated.title}</h1>
    <p>${c.common.hello(escapeHtml(name))}</p>
    <p>${c.reserveCreated.intro(escapeHtml(params.createdBy))}</p>
    <div class="info-box" style="border-left-color:${priorityColor(params.priority)};">
      <p style="font-size:15px;font-weight:700;margin-bottom:8px;">${escapeHtml(params.reserveTitle)}${params.reserveCode ? ` <span style="font-size:12px;font-weight:400;color:#64748B;">(#${escapeHtml(params.reserveCode)})</span>` : ''}</p>
      <table style="border-collapse:collapse;width:100%;">${detailRows}</table>
    </div>
    ${params.description ? `<p style="color:#475569;font-size:13px;"><strong>${c.reserveCreated.description} :</strong> ${escapeHtml(params.description)}</p>` : ''}
    <a href="${escapeHtml(url)}" class="btn">${c.reserveCreated.button}</a>
    <p style="font-size:12px;color:#8899BB;margin:0;">${c.common.linkFallback(escapeHtml(url))}</p>
  `;

  return {
    subject: c.reserveCreated.subject(params.reserveTitle),
    html: baseLayout(content, c.reserveCreated.preheader(params.companyName), params.language),
  };
}

export function reserveStatusChangedEmail(params: EmailParams & {
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
  const c = copyFor(params.language);
  const name = firstName(params.recipientName);
  const url = params.reserveUrl ?? `${APP_URL}/reserve/${encodeURIComponent(params.reserveId)}`;
  const newLabel = statusLabel(params.newStatus, params.language);
  const prevLabel = params.previousStatus ? statusLabel(params.previousStatus, params.language) : null;
  const content = `
    <h1>${c.reserveStatus.title}</h1>
    <p>${c.common.hello(escapeHtml(name))}</p>
    <p>${c.reserveStatus.intro(escapeHtml(params.changedBy))}</p>
    <div class="info-box">
      <p style="font-size:15px;font-weight:700;margin-bottom:8px;">${escapeHtml(params.reserveTitle)}${params.reserveCode ? ` <span style="font-size:12px;font-weight:400;color:#64748B;">(#${escapeHtml(params.reserveCode)})</span>` : ''}</p>
      ${prevLabel ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">${c.reserveStatus.previous} : <strong>${escapeHtml(prevLabel)}</strong></p>` : ''}
      <p style="font-size:13px;margin:4px 0;">${c.reserveStatus.next} : <strong>${escapeHtml(newLabel)}</strong></p>
      ${params.chantierName ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">${c.common.chantier} : ${escapeHtml(params.chantierName)}</p>` : ''}
      ${params.companyName ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">${c.common.company} : ${escapeHtml(params.companyName)}</p>` : ''}
    </div>
    <a href="${escapeHtml(url)}" class="btn">${c.reserveStatus.button}</a>
    <p style="font-size:12px;color:#8899BB;margin:0;">${c.common.linkFallback(escapeHtml(url))}</p>
  `;

  return {
    subject: c.reserveStatus.subject(params.reserveTitle),
    html: baseLayout(content, c.reserveStatus.preheader(newLabel), params.language),
  };
}

export function reserveOverdueEmail(params: EmailParams & {
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
  const c = copyFor(params.language);
  const name = firstName(params.recipientName);
  const url = params.reserveUrl ?? `${APP_URL}/reserve/${encodeURIComponent(params.reserveId)}`;
  const content = `
    <h1 style="color:#DC2626;">${c.overdue.title}</h1>
    <p>${c.common.hello(escapeHtml(name))}</p>
    <p>${c.overdue.intro(params.daysLate)}</p>
    <div class="info-box" style="border-left-color:#EF4444;">
      <p style="font-size:15px;font-weight:700;margin-bottom:8px;">${escapeHtml(params.reserveTitle)}${params.reserveCode ? ` <span style="font-size:12px;font-weight:400;color:#64748B;">(#${escapeHtml(params.reserveCode)})</span>` : ''}</p>
      <p style="font-size:13px;margin:4px 0;color:#EF4444;font-weight:600;">${c.overdue.missed} : ${escapeHtml(formatDate(params.deadline, params.language))}</p>
      ${params.priority ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">${c.common.priority} : ${escapeHtml(priorityLabel(params.priority, params.language))}</p>` : ''}
      ${params.chantierName ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">${c.common.chantier} : ${escapeHtml(params.chantierName)}</p>` : ''}
      ${params.companyName ? `<p style="font-size:13px;margin:4px 0;color:#64748B;">${c.common.company} : ${escapeHtml(params.companyName)}</p>` : ''}
    </div>
    <p>${c.overdue.thanks}</p>
    <a href="${escapeHtml(url)}" class="btn" style="background:#DC2626;color:#fff !important;">${c.overdue.button}</a>
    <p style="font-size:12px;color:#8899BB;margin:0;">${c.common.linkFallback(escapeHtml(url))}</p>
  `;

  return {
    subject: c.overdue.subject(params.daysLate, params.reserveTitle),
    html: baseLayout(content, c.overdue.preheader(params.daysLate), params.language),
  };
}

const ESCALATION_COPY = {
  fr: {
    title: 'Escalade — réserve non résolue',
    intro: (company: string, chantier: string | undefined, reminders: number) =>
      `La réserve ci-dessous, impliquant l'entreprise <strong>${company}</strong>${chantier ? ` sur le chantier <strong>${chantier}</strong>` : ''}, n'a pas été traitée malgré <strong>${reminders} rappels quotidiens</strong> envoyés à ses destinataires. Elle est désormais escaladée à l'équipe d'administration.`,
    overdue: (days: number) => `EN RETARD DE ${days} ${days > 1 ? 'JOURS' : 'JOUR'}`,
    admin: 'ESCALADE ADMIN',
    missed: 'Échéance dépassée',
    action: (company: string) => `Merci de relancer ${company} ou de prendre le relais directement depuis l'application.`,
    button: 'Voir la réserve →',
    footer: (company: string) => `Vous recevez cet email en tant qu'administrateur de l'organisation BuildTrack. Les rappels quotidiens à ${company} ont été suspendus pour éviter le spam.`,
    subject: (days: number, title: string, company: string) => `[Escalade ${days}j] ${title} — ${company} ne répond pas`,
    preheader: (reminders: number) => `Escalade : réserve non résolue après ${reminders} rappels`,
  },
  en: {
    title: 'Escalation — unresolved issue',
    intro: (company: string, chantier: string | undefined, reminders: number) =>
      `The issue below, involving <strong>${company}</strong>${chantier ? ` on project <strong>${chantier}</strong>` : ''}, has not been handled despite <strong>${reminders} daily reminders</strong> sent to its recipients. It is now escalated to the administration team.`,
    overdue: (days: number) => `${days} ${days > 1 ? 'DAYS' : 'DAY'} OVERDUE`,
    admin: 'ADMIN ESCALATION',
    missed: 'Missed deadline',
    action: (company: string) => `Please follow up with ${company} or take over directly from the app.`,
    button: 'View issue →',
    footer: (company: string) => `You are receiving this email as a BuildTrack organisation administrator. Daily reminders to ${company} have been suspended to avoid spam.`,
    subject: (days: number, title: string, company: string) => `[Escalation ${days}d] ${title} — ${company} has not responded`,
    preheader: (reminders: number) => `Escalation: unresolved issue after ${reminders} reminders`,
  },
  es: {
    title: 'Escalado — reserva sin resolver',
    intro: (company: string, chantier: string | undefined, reminders: number) =>
      `La reserva siguiente, relacionada con <strong>${company}</strong>${chantier ? ` en la obra <strong>${chantier}</strong>` : ''}, no se ha tratado pese a <strong>${reminders} recordatorios diarios</strong> enviados a sus destinatarios. Ahora se escala al equipo de administración.`,
    overdue: (days: number) => `${days} ${days > 1 ? 'DÍAS' : 'DÍA'} DE RETRASO`,
    admin: 'ESCALADO ADMIN',
    missed: 'Fecha límite superada',
    action: (company: string) => `Por favor, contacta con ${company} o toma el relevo directamente desde la aplicación.`,
    button: 'Ver reserva →',
    footer: (company: string) => `Recibes este correo como administrador de la organización BuildTrack. Los recordatorios diarios a ${company} se han suspendido para evitar spam.`,
    subject: (days: number, title: string, company: string) => `[Escalado ${days}d] ${title} — ${company} no responde`,
    preheader: (reminders: number) => `Escalado: reserva sin resolver tras ${reminders} recordatorios`,
  },
} as const;

export function reserveOverdueEscalationEmail(params: EmailParams & {
  recipientName: string;
  reserveTitle: string;
  reserveId: string;
  deadline: string;
  daysLate: number;
  reminderDays: number;
  priority?: string;
  companyName: string;
  chantierName?: string;
  reserveCode?: string;
  reserveUrl?: string;
}) {
  const lang = normalizeEmailLanguage(params.language);
  const c = copyFor(lang);
  const e = ESCALATION_COPY[lang];
  const name = firstName(params.recipientName);
  const prioLabel = priorityLabel(params.priority, lang);
  const prioColor = priorityColor(params.priority);
  const url = params.reserveUrl ?? `${APP_URL}/reserve/${encodeURIComponent(params.reserveId)}`;
  const deadlineDate = formatDate(params.deadline, lang);

  const content = `
    <h1 style="color:#DC2626;">${e.title}</h1>
    <p>${c.common.hello(escapeHtml(name))}</p>
    <p>${e.intro(escapeHtml(params.companyName), params.chantierName ? escapeHtml(params.chantierName) : undefined, params.reminderDays)}</p>

    <div class="info-box" style="border-left-color:#DC2626;background:#FEF2F2;">
      <p style="font-size:15px;font-weight:700;color:#1A2742;margin:0 0 6px;">${escapeHtml(params.reserveTitle)}</p>
      ${params.reserveCode ? `<p style="font-size:11px;color:#8899BB;margin:0 0 10px;">${c.common.ref} ${escapeHtml(params.reserveCode)}</p>` : ''}
      <p style="margin:0 0 6px;">
        <span style="display:inline-block;background:${prioColor}18;color:${prioColor};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;margin-right:6px;">${escapeHtml(prioLabel.toUpperCase())}</span>
        <span style="display:inline-block;background:#DC262618;color:#DC2626;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">${e.overdue(params.daysLate)}</span>
        <span style="display:inline-block;background:#7C3AED18;color:#7C3AED;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;margin-left:6px;">${e.admin}</span>
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#5E738A;">${e.missed} : <strong style="color:#DC2626;">${escapeHtml(deadlineDate)}</strong></p>
    </div>

    <p style="font-size:14px;color:#334155;">${e.action(escapeHtml(params.companyName))}</p>

    <div style="text-align:center;">
      <a href="${escapeHtml(url)}" class="btn" style="background:#DC2626;color:#fff !important;">${e.button}</a>
    </div>

    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">${e.footer(escapeHtml(params.companyName))}</p>
  `;

  return {
    subject: e.subject(params.daysLate, params.reserveTitle, params.companyName),
    html: baseLayout(content, e.preheader(params.reminderDays), lang),
  };
}
