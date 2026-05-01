#!/usr/bin/env node
'use strict';

const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const http = require('http');

const app = express();
app.use(express.json());

const PORT = process.env.API_PORT || 3001;
const APP_URL = process.env.EXPO_PUBLIC_APP_URL || 'https://buildtrack-mobile.vercel.app';

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// ── Email sender ──────────────────────────────────────────────────────────────
let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.warn('[Email] GMAIL_USER or GMAIL_APP_PASSWORD not set — simulation mode.');
    return null;
  }
  cachedTransporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return cachedTransporter;
}

async function sendEmail({ to, subject, html }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('[Email] Simulating email to', to, ':', subject);
    return { success: true, simulated: true };
  }
  const from = process.env.EMAIL_FROM || 'BuildTrack <buildtrack.admin@gmail.com>';
  try {
    await transporter.sendMail({ from, to, subject, html });
    return { success: true };
  } catch (err) {
    console.error('[Email] SMTP error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Email templates ───────────────────────────────────────────────────────────
const BRAND_COLOR = '#003082';
const ACCENT_COLOR = '#FFCB00';

function baseLayout(content, preheader = '') {
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
    <div class="body">${content}</div>
    <div class="footer">
      <p>BuildTrack — Gestion de chantier numérique<br/>
      Cet email a été envoyé automatiquement, merci de ne pas y répondre.<br/>
      &copy; ${new Date().getFullYear()} Bouygues Construction. Tous droits réservés.</p>
    </div>
  </div>
</body>
</html>`;
}

const ROLE_LABELS_FR = {
  admin: 'Administrateur',
  conducteur: 'Conducteur de travaux',
  chef_equipe: "Chef d'équipe",
  observateur: 'Observateur',
  sous_traitant: 'Sous-traitant',
  super_admin: 'Super Administrateur',
};

const PRIORITY_LABELS_FR = {
  low:      { label: 'Faible',   color: '#6B7280' },
  medium:   { label: 'Moyenne',  color: '#D97706' },
  high:     { label: 'Haute',    color: '#EA580C' },
  critical: { label: 'Critique', color: '#DC2626' },
};

const STATUS_LABELS_FR = {
  open:         { label: 'Ouverte',    color: '#DC2626' },
  in_progress:  { label: 'En cours',   color: '#2563EB' },
  waiting:      { label: 'En attente', color: '#D97706' },
  verification: { label: 'À vérifier', color: '#7C3AED' },
  closed:       { label: 'Levée',      color: '#16A34A' },
};

function invitationTemplate({ invitedByName, organizationName, email, role, token, expiresAt, companyName }) {
  const roleLabel = ROLE_LABELS_FR[role] ?? role;
  const deepLinkUrl = `${APP_URL}/invite?token=${token}`;
  const expDate = new Date(expiresAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const companyBlock = companyName ? `<p style="text-align:center;margin-top:-4px;">Entreprise rattachée : <strong>${companyName}</strong></p>` : '';
  const content = `
    <h1>Vous avez été invité !</h1>
    <p><strong>${invitedByName}</strong> vous invite à rejoindre l'organisation <strong>${organizationName}</strong> sur BuildTrack en tant que :</p>
    <p style="text-align:center;"><span class="role-badge">${roleLabel}</span></p>
    ${companyBlock}
    <p>Cliquez sur le bouton ci-dessous pour rejoindre l'organisation :</p>
    <div style="text-align:center;"><a href="${deepLinkUrl}" class="btn">Rejoindre ${organizationName} →</a></div>
    <div class="info-box">
      <p><strong>Première fois sur BuildTrack ?</strong><br/>
      1. Cliquez sur le bouton ci-dessus<br/>
      2. Choisissez <em>« Invitation reçue »</em> et créez votre compte avec l'email <strong>${email}</strong><br/>
      3. Votre accès à <strong>${organizationName}</strong> sera automatiquement activé</p>
    </div>
    <div class="token-box">
      <p style="font-size:12px;color:#8899BB;margin:0 0 8px;">Votre code d'invitation</p>
      <div class="token">${token}</div>
    </div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">Cette invitation expire le <strong>${expDate}</strong>.</p>
  `;
  return { subject: `Invitation à rejoindre ${organizationName} sur BuildTrack`, html: baseLayout(content, `${invitedByName} vous invite à rejoindre ${organizationName}`) };
}

function welcomeTemplate({ name, email, organizationName }) {
  const firstName = name.split(' ')[0];
  const content = `
    <h1>Bienvenue, ${firstName} !</h1>
    <p>Votre compte BuildTrack a bien été créé pour l'adresse <strong>${email}</strong>.</p>
    ${organizationName ? `<div class="info-box"><p>Votre organisation <strong>${organizationName}</strong> a été créée. Vous êtes maintenant administrateur.</p></div>` : `<div class="info-box"><p>Votre compte est créé. Connectez-vous pour accéder à votre organisation.</p></div>`}
    <div style="text-align:center;"><a href="${APP_URL}" class="btn">Ouvrir BuildTrack →</a></div>
  `;
  return { subject: 'Bienvenue sur BuildTrack !', html: baseLayout(content, `Votre compte BuildTrack est prêt, ${firstName}`) };
}

function passwordResetTemplate({ name, resetUrl }) {
  const firstName = name.split(' ')[0];
  const content = `
    <h1>Réinitialisation du mot de passe</h1>
    <p>Bonjour ${firstName},</p>
    <p>Vous avez demandé la réinitialisation de votre mot de passe BuildTrack.</p>
    <div style="text-align:center;"><a href="${resetUrl}" class="btn">Réinitialiser mon mot de passe →</a></div>
    <div class="info-box"><p>Ce lien est valable <strong>1 heure</strong>.</p></div>
    <hr class="separator"/>
    <p style="font-size:12px;color:#8899BB;margin:0;">Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
  `;
  return { subject: 'Réinitialisation de votre mot de passe BuildTrack', html: baseLayout(content) };
}

function invitationAcceptedTemplate({ adminName, inviteeName, inviteeEmail, organizationName, role }) {
  const adminFirstName = adminName.split(' ')[0];
  const roleLabel = ROLE_LABELS_FR[role] ?? role;
  const content = `
    <h1>Invitation acceptée ✓</h1>
    <p>Bonjour ${adminFirstName},</p>
    <p><strong>${inviteeName}</strong> a accepté votre invitation et a rejoint <strong>${organizationName}</strong>.</p>
    <div class="info-box"><p><strong>Email :</strong> ${inviteeEmail}<br/><strong>Rôle :</strong> <span class="role-badge">${roleLabel}</span></p></div>
  `;
  return { subject: `${inviteeName} a rejoint ${organizationName} sur BuildTrack`, html: baseLayout(content) };
}

function accessRevokedTemplate({ name, organizationName }) {
  const firstName = name.split(' ')[0];
  const content = `
    <h1>Accès révoqué</h1>
    <p>Bonjour ${firstName},</p>
    <p>Votre accès à l'organisation <strong>${organizationName}</strong> sur BuildTrack a été révoqué par un administrateur.</p>
    <div class="info-box"><p>Si vous pensez qu'il s'agit d'une erreur, contactez votre responsable.</p></div>
  `;
  return { subject: `Votre accès à ${organizationName} a été révoqué`, html: baseLayout(content) };
}

function reserveCreatedTemplate(params) {
  const { recipientName, reserveTitle, reserveId, priority, deadline, building, level, zone, description, chantierName, companyName, createdBy, reserveCode, reserveUrl } = params;
  const firstName = recipientName.split(' ')[0];
  const prio = PRIORITY_LABELS_FR[priority || 'medium'] || PRIORITY_LABELS_FR.medium;
  const deepLinkUrl = reserveUrl || `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;
  const deadlineDate = deadline ? new Date(deadline).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const locationStr = [building, level, zone].filter(Boolean).join(' • ') || null;
  const content = `
    <h1>Nouvelle réserve pour ${companyName}</h1>
    <p>Bonjour ${firstName},</p>
    <p><strong>${createdBy}</strong> a créé une nouvelle réserve impliquant <strong>${companyName}</strong>${chantierName ? ` sur <strong>${chantierName}</strong>` : ''}.</p>
    <div class="info-box" style="border-left-color:${prio.color};">
      <p style="font-size:15px;font-weight:700;color:#1A2742;margin:0 0 6px;">${reserveTitle}</p>
      ${reserveCode ? `<p style="font-size:11px;color:#8899BB;margin:0 0 8px;">Réf. ${reserveCode}</p>` : ''}
      <p style="margin:0;"><span style="background:${prio.color}18;color:${prio.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">${prio.label.toUpperCase()}</span>
      ${deadlineDate ? `<span style="font-size:12px;color:#5E738A;margin-left:8px;">Échéance : <strong>${deadlineDate}</strong></span>` : ''}</p>
    </div>
    ${locationStr ? `<p style="font-size:13px;color:#5E738A;"><strong>Localisation :</strong> ${locationStr}</p>` : ''}
    ${description ? `<p style="font-size:13px;background:#F4F7FB;padding:12px;border-radius:8px;">${description}</p>` : ''}
    <div style="text-align:center;"><a href="${deepLinkUrl}" class="btn">Voir la réserve →</a></div>
  `;
  return { subject: `[${prio.label}] Nouvelle réserve — ${reserveTitle}`, html: baseLayout(content) };
}

function reserveStatusChangedTemplate(params) {
  const { recipientName, reserveTitle, reserveId, newStatus, previousStatus, changedBy, companyName, chantierName, reserveCode, reserveUrl } = params;
  const firstName = recipientName.split(' ')[0];
  const next = STATUS_LABELS_FR[newStatus] || { label: newStatus, color: '#1A2742' };
  const prev = previousStatus ? (STATUS_LABELS_FR[previousStatus] || { label: previousStatus, color: '#8899BB' }) : null;
  const deepLinkUrl = reserveUrl || `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;
  const content = `
    <h1>Statut de réserve mis à jour</h1>
    <p>Bonjour ${firstName},</p>
    <p><strong>${changedBy}</strong> a mis à jour le statut d'une réserve de <strong>${companyName}</strong>${chantierName ? ` sur <strong>${chantierName}</strong>` : ''}.</p>
    <div class="info-box" style="border-left-color:${next.color};">
      <p style="font-size:15px;font-weight:700;color:#1A2742;margin:0 0 6px;">${reserveTitle}</p>
      ${reserveCode ? `<p style="font-size:11px;color:#8899BB;margin:0 0 10px;">Réf. ${reserveCode}</p>` : ''}
      <p style="margin:0;">
        ${prev ? `<span style="background:#F4F7FB;color:${prev.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;text-decoration:line-through;">${prev.label.toUpperCase()}</span><span style="margin:0 6px;color:#8899BB;">→</span>` : ''}
        <span style="background:${next.color}18;color:${next.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">${next.label.toUpperCase()}</span>
      </p>
    </div>
    <div style="text-align:center;"><a href="${deepLinkUrl}" class="btn">Voir la réserve →</a></div>
  `;
  return { subject: `[${next.label}] Réserve mise à jour — ${reserveTitle}`, html: baseLayout(content) };
}

function reserveOverdueTemplate(params) {
  const { recipientName, reserveTitle, reserveId, deadline, daysLate, priority, companyName, chantierName, reserveCode, reserveUrl } = params;
  const firstName = recipientName.split(' ')[0];
  const prio = PRIORITY_LABELS_FR[priority || 'medium'] || PRIORITY_LABELS_FR.medium;
  const deepLinkUrl = reserveUrl || `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;
  const deadlineDate = new Date(deadline).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const dayWord = daysLate <= 1 ? 'jour' : 'jours';
  const content = `
    <h1 style="color:#DC2626;">Réserve en retard</h1>
    <p>Bonjour ${firstName},</p>
    <p>Une réserve impliquant <strong>${companyName}</strong>${chantierName ? ` sur <strong>${chantierName}</strong>` : ''} a dépassé son échéance.</p>
    <div class="info-box" style="border-left-color:#DC2626;background:#FEF2F2;">
      <p style="font-size:15px;font-weight:700;color:#1A2742;margin:0 0 6px;">${reserveTitle}</p>
      ${reserveCode ? `<p style="font-size:11px;color:#8899BB;margin:0 0 10px;">Réf. ${reserveCode}</p>` : ''}
      <p style="margin:0;">
        <span style="background:${prio.color}18;color:${prio.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">${prio.label.toUpperCase()}</span>
        <span style="background:#DC262618;color:#DC2626;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;margin-left:6px;">EN RETARD DE ${daysLate} ${dayWord.toUpperCase()}</span>
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#5E738A;">Échéance dépassée : <strong style="color:#DC2626;">${deadlineDate}</strong></p>
    </div>
    <div style="text-align:center;"><a href="${deepLinkUrl}" class="btn" style="background:#DC2626;">Traiter la réserve →</a></div>
  `;
  return { subject: `[Retard ${daysLate}j] Réserve à traiter — ${reserveTitle}`, html: baseLayout(content) };
}

// ── Reserve token (for reserve deep links) ────────────────────────────────────
function buildReserveUrl(reserveId, recipientEmail) {
  const secret = process.env.RESERVE_TOKEN_SECRET;
  if (!secret || secret.length < 16) {
    return `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;
  }
  const payload = { reserveId, email: recipientEmail.toLowerCase(), exp: Math.floor(Date.now() / 1000) + 30 * 86400 };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${APP_URL}/reserve/${encodeURIComponent(reserveId)}?t=${encodeURIComponent(`${body}.${sig}`)}`;
}

// ── POST /api/send-email ──────────────────────────────────────────────────────
app.post('/api/send-email', async (req, res) => {
  const { type, ...body } = req.body || {};
  if (!type) return res.status(400).json({ error: 'Type manquant' });

  let template = null;
  let to = '';

  try {
    if (type === 'invitation') {
      const { email, invitedByName, organizationName, role, token, expiresAt, companyName } = body;
      if (!email || !invitedByName || !organizationName || !role || !token || !expiresAt)
        return res.status(400).json({ error: 'Paramètres manquants' });
      to = email; template = invitationTemplate({ email, invitedByName, organizationName, role, token, expiresAt, companyName });
    } else if (type === 'welcome') {
      const { email, name, organizationName } = body;
      if (!email || !name) return res.status(400).json({ error: 'Paramètres manquants' });
      to = email; template = welcomeTemplate({ name, email, organizationName });
    } else if (type === 'password-reset') {
      const { email, name, resetUrl } = body;
      if (!email || !name || !resetUrl) return res.status(400).json({ error: 'Paramètres manquants' });
      to = email; template = passwordResetTemplate({ name, resetUrl });
    } else if (type === 'invitation-accepted') {
      const { adminEmail, adminName, inviteeName, inviteeEmail, organizationName, role } = body;
      if (!adminEmail || !adminName || !inviteeName || !inviteeEmail || !organizationName || !role)
        return res.status(400).json({ error: 'Paramètres manquants' });
      to = adminEmail; template = invitationAcceptedTemplate({ adminName, inviteeName, inviteeEmail, organizationName, role });
    } else if (type === 'reserve-created') {
      const { email, recipientName, reserveTitle, reserveId, companyName, createdBy } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !companyName || !createdBy)
        return res.status(400).json({ error: 'Paramètres manquants' });
      to = email; template = reserveCreatedTemplate({ ...body, reserveUrl: buildReserveUrl(reserveId, email) });
    } else if (type === 'reserve-status-changed') {
      const { email, recipientName, reserveTitle, reserveId, newStatus, changedBy, companyName } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !newStatus || !changedBy || !companyName)
        return res.status(400).json({ error: 'Paramètres manquants' });
      to = email; template = reserveStatusChangedTemplate({ ...body, reserveUrl: buildReserveUrl(reserveId, email) });
    } else if (type === 'reserve-overdue') {
      const { email, recipientName, reserveTitle, reserveId, deadline, daysLate, companyName } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !deadline || daysLate == null || !companyName)
        return res.status(400).json({ error: 'Paramètres manquants' });
      to = email; template = reserveOverdueTemplate({ ...body, reserveUrl: buildReserveUrl(reserveId, email) });
    } else if (type === 'access-revoked') {
      const { email, name, organizationName } = body;
      if (!email || !name || !organizationName) return res.status(400).json({ error: 'Paramètres manquants' });
      to = email; template = accessRevokedTemplate({ name, organizationName });
    } else {
      return res.status(400).json({ error: `Type inconnu: ${type}` });
    }

    const result = await sendEmail({ to, subject: template.subject, html: template.html });
    if (!result.success) return res.status(500).json({ error: result.error || "Échec de l'envoi" });
    return res.json({ success: true, simulated: result.simulated || false });
  } catch (err) {
    console.error('[send-email] Exception:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /api/request-password-reset ─────────────────────────────────────────
app.post('/api/request-password-reset', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !email.includes('@'))
      return res.status(400).json({ error: 'Email invalide' });

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.warn('[request-password-reset] SUPABASE_SERVICE_ROLE_KEY not set — simulating');
      return res.json({ success: true, simulated: true });
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: profileRows } = await supabaseAdmin
      .from('profiles').select('name').eq('email', email.toLowerCase().trim()).limit(1);
    const name = profileRows?.[0]?.name ?? email.split('@')[0];

    const resetRedirect = `${APP_URL}/reset-password`;
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery', email: email.toLowerCase().trim(), options: { redirectTo: resetRedirect },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('[request-password-reset] generateLink error:', linkError?.message);
      return res.status(500).json({ error: linkError?.message || 'Impossible de générer le lien' });
    }

    const template = passwordResetTemplate({ name, resetUrl: linkData.properties.action_link });
    const result = await sendEmail({ to: email.toLowerCase().trim(), subject: template.subject, html: template.html });
    if (!result.success) return res.status(500).json({ error: result.error || "Échec de l'envoi" });
    return res.json({ success: true, simulated: result.simulated || false });
  } catch (err) {
    console.error('[request-password-reset] Exception:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/cron/overdue-reserves ───────────────────────────────────────────
app.get('/api/cron/overdue-reserves', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  if (cronSecret && auth !== `Bearer ${cronSecret}`)
    return res.status(401).json({ error: 'Non autorisé' });

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey)
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY manquant' });

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().split('T')[0];
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayISO = yesterday.toISOString().split('T')[0];

  const stats = { scanned: 0, notified: 0, emailsSent: 0, errors: 0 };
  const LIMIT = 7;

  try {
    const { data: reserves, error: rErr } = await supabase
      .from('reserves').select('id, title, priority, status, deadline, companies, company, chantier_id, organization_id, overdue_last_notified_date, overdue_reminder_count')
      .not('status', 'in', '(closed,verification)').not('deadline', 'is', null).lt('deadline', todayISO);
    if (rErr) throw rErr;

    const list = reserves || [];
    stats.scanned = list.length;
    if (!list.length) return res.json({ ok: true, stats });

    const orgIds = [...new Set(list.map(r => r.organization_id).filter(Boolean))];
    const chantierIds = [...new Set(list.map(r => r.chantier_id).filter(Boolean))];
    const { data: companies } = await supabase.from('companies').select('id, name, organization_id').in('organization_id', orgIds.length ? orgIds : ['__none__']);
    const { data: profiles } = await supabase.from('profiles').select('id, name, email, company_id, organization_id, role').in('organization_id', orgIds.length ? orgIds : ['__none__']);
    const { data: chantiers } = chantierIds.length ? await supabase.from('chantiers').select('id, name').in('id', chantierIds) : { data: [] };

    const companiesByOrg = new Map();
    for (const c of companies || []) { const a = companiesByOrg.get(c.organization_id) || []; a.push(c); companiesByOrg.set(c.organization_id, a); }
    const profilesByCompany = new Map();
    const adminsByOrg = new Map();
    for (const p of profiles || []) {
      if (!p.email) continue;
      if (p.company_id) { const a = profilesByCompany.get(p.company_id) || []; a.push(p); profilesByCompany.set(p.company_id, a); }
      if (p.role === 'admin' || p.role === 'super_admin') { const a = adminsByOrg.get(p.organization_id) || []; a.push(p); adminsByOrg.set(p.organization_id, a); }
    }
    const chantierName = new Map(); for (const c of chantiers || []) chantierName.set(c.id, c.name);

    for (const r of list) {
      try {
        if (r.overdue_last_notified_date === todayISO) continue;
        const reserveCompanyNames = r.companies || (r.company ? [r.company] : []);
        if (!reserveCompanyNames.length) continue;
        const orgCompanies = companiesByOrg.get(r.organization_id) || [];
        const matched = orgCompanies.filter(c => reserveCompanyNames.some(n => n.trim().toLowerCase() === c.name.trim().toLowerCase()));
        if (!matched.length) continue;

        const daysLate = Math.max(1, Math.round((today.getTime() - new Date(r.deadline).getTime()) / 86400000));
        const prevCount = typeof r.overdue_reminder_count === 'number' ? r.overdue_reminder_count : 0;
        const continuing = r.overdue_last_notified_date === yesterdayISO || r.overdue_last_notified_date === todayISO;
        const reminderCount = continuing ? prevCount : 0;
        const escalate = reminderCount >= LIMIT;
        const sentEmails = new Set();
        let sentForReserve = 0;

        if (!escalate) {
          for (const company of matched) {
            for (const p of (profilesByCompany.get(company.id) || [])) {
              const key = `${p.email.toLowerCase()}|${company.id}`;
              if (sentEmails.has(key)) continue; sentEmails.add(key);
              const tpl = reserveOverdueTemplate({ recipientName: p.name || p.email, reserveTitle: r.title, reserveId: r.id, deadline: r.deadline, daysLate, priority: r.priority, companyName: company.name, chantierName: r.chantier_id ? chantierName.get(r.chantier_id) : undefined, reserveCode: r.id, reserveUrl: buildReserveUrl(r.id, p.email) });
              const sendRes = await sendEmail({ to: p.email, subject: tpl.subject, html: tpl.html });
              if (!sendRes.success) { stats.errors++; } else { stats.emailsSent++; sentForReserve++; }
            }
          }
        } else {
          const admins = adminsByOrg.get(r.organization_id) || [];
          const companyNames = matched.map(c => c.name).join(', ');
          for (const a of admins) {
            const key = a.email.toLowerCase(); if (sentEmails.has(key)) continue; sentEmails.add(key);
            const tpl = reserveOverdueTemplate({ recipientName: a.name || a.email, reserveTitle: r.title, reserveId: r.id, deadline: r.deadline, daysLate, priority: r.priority, companyName: companyNames, chantierName: r.chantier_id ? chantierName.get(r.chantier_id) : undefined, reserveCode: r.id, reserveUrl: buildReserveUrl(r.id, a.email) });
            const sendRes = await sendEmail({ to: a.email, subject: tpl.subject, html: tpl.html });
            if (!sendRes.success) { stats.errors++; } else { stats.emailsSent++; sentForReserve++; }
          }
        }

        const nextCount = escalate ? reminderCount : reminderCount + 1;
        const { error: upErr } = await supabase.from('reserves').update({ overdue_last_notified_date: todayISO, overdue_reminder_count: nextCount }).eq('id', r.id);
        if (upErr) { stats.errors++; } else if (sentForReserve > 0) { stats.notified++; }
      } catch (err) { stats.errors++; console.warn('[cron overdue] reserve', r.id, err.message); }
    }
    return res.json({ ok: true, stats });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stats });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[BuildTrack API] Server running on port ${PORT}`);
});
