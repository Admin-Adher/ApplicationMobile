#!/usr/bin/env node
'use strict';

const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const http = require('http');
const emailTemplates = require('./email-templates');
const {
  claimInventoryBarcodeLookup: claimSharedInventoryBarcodeLookup,
  completeInventoryBarcodeLookup: completeSharedInventoryBarcodeLookup,
  markInventoryBarcodeNotFound: markSharedInventoryBarcodeNotFound,
  releaseInventoryBarcodeLookup: releaseSharedInventoryBarcodeLookup,
} = require('./inventory-barcode-cache');

const app = express();
app.use(express.json());

const PORT = process.env.API_PORT || 3001;
const APP_URL = process.env.EXPO_PUBLIC_APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5000'}`;

function safePdfFilePart(value, fallback = 'document') {
  const cleaned = String(value ?? fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019`]/g, '')
    .replace(/&/g, ' et ')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function buildPdfFilename(type, parts = []) {
  const segments = [type, ...parts]
    .map(part => safePdfFilePart(part, ''))
    .filter(Boolean);
  return `${segments.length > 0 ? segments.join('_') : 'Document'}.pdf`;
}

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

async function sendEmail({ to, subject, html, attachments }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('[Email] Simulating email to', to, ':', subject);
    return { success: true, simulated: true };
  }
  const from = process.env.EMAIL_FROM || 'BuildTrack <buildtrack.admin@gmail.com>';
  try {
    await transporter.sendMail({ from, to, subject, html, attachments });
    return { success: true };
  } catch (err) {
    console.error('[Email] SMTP error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Email templates ───────────────────────────────────────────────────────────
function reserveOverdueEmailsEnabled() {
  return process.env.RESERVE_OVERDUE_EMAILS_ENABLED === 'true';
}

async function reserveEmailLogInsert(supabase, { type, recipientEmail, reserveId = null, eventKey, metadata = {} }) {
  if (!supabase) {
    return { inserted: false, error: 'Supabase admin client indisponible' };
  }
  const email = String(recipientEmail || '').trim().toLowerCase();
  if (!type || !email || !eventKey) {
    return { inserted: false, error: 'Paramètres de déduplication incomplets' };
  }
  const { error } = await supabase
    .from('email_notification_log')
    .insert({
      notification_type: type,
      recipient_email: email,
      reserve_id: reserveId,
      event_key: eventKey,
      metadata,
    });
  if (!error) return { inserted: true };
  if (error.code === '23505') return { inserted: false, duplicate: true };
  console.warn('[email dedupe] insert failed:', error.code || '', error.message || error);
  return { inserted: false, error: error.message || String(error) };
}

const BRAND_COLOR = '#003082';
const ACCENT_COLOR = '#FFCB00';

const EMAIL_LAYOUT_COPY = {
  fr: {
    footerTagline: 'BuildTrack — Gestion de chantier numérique',
    footerAuto: 'Cet email a été envoyé automatiquement, merci de ne pas y répondre.',
    footerRights: 'Tous droits réservés.',
  },
  en: {
    footerTagline: 'BuildTrack — Digital construction management',
    footerAuto: 'This email was sent automatically. Please do not reply.',
    footerRights: 'All rights reserved.',
  },
  es: {
    footerTagline: 'BuildTrack — Gestión digital de obra',
    footerAuto: 'Este correo se ha enviado automáticamente. Por favor, no respondas.',
    footerRights: 'Todos los derechos reservados.',
  },
};

function emailLanguage(language) {
  return emailTemplates.normalizeEmailLanguage(language);
}

function baseLayout(content, preheader = '', language = 'fr') {
  const lang = emailLanguage(language);
  const layoutCopy = EMAIL_LAYOUT_COPY[lang] || EMAIL_LAYOUT_COPY.fr;
  return `<!DOCTYPE html>
<html lang="${lang}">
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
      <p>${layoutCopy.footerTagline}<br/>
      ${layoutCopy.footerAuto}<br/>
      &copy; ${new Date().getFullYear()} Bouygues Construction. ${layoutCopy.footerRights}</p>
    </div>
  </div>
</body>
</html>`;
}

const ROLE_LABELS_FR = {
  admin: 'Administrateur',
  conducteur: 'Conducteur de travaux',
  magasinier: 'Magasinier',
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
function reserveOverdueDigestTemplate({ recipientName, rows }) {
  const firstName = String(recipientName || '').split(' ')[0] || 'Bonjour';
  const sortedRows = [...rows].sort((a, b) => (b.daysLate || 0) - (a.daysLate || 0));
  const maxDaysLate = sortedRows.reduce((max, row) => Math.max(max, row.daysLate || 0), 0);
  const listHtml = sortedRows.map(row => {
    const prio = PRIORITY_LABELS_FR[row.priority || 'medium'] || PRIORITY_LABELS_FR.medium;
    const deadlineDate = new Date(row.deadline).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    return `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #EEF3FA;">
          <p style="font-size:14px;font-weight:700;color:#1A2742;margin:0 0 4px;">${escHtml(row.reserveTitle)}</p>
          <p style="font-size:11px;color:#8899BB;margin:0;">${escHtml(row.reserveId)}${row.chantierName ? ` — ${escHtml(row.chantierName)}` : ''}</p>
        </td>
        <td style="padding:12px;border-bottom:1px solid #EEF3FA;font-size:12px;color:#334155;">${escHtml(row.companyName)}</td>
        <td style="padding:12px;border-bottom:1px solid #EEF3FA;font-size:12px;color:#DC2626;font-weight:700;">${row.daysLate} j</td>
        <td style="padding:12px;border-bottom:1px solid #EEF3FA;font-size:12px;color:#5E738A;">${deadlineDate}</td>
        <td style="padding:12px;border-bottom:1px solid #EEF3FA;">
          <span style="background:${prio.color}18;color:${prio.color};font-size:10px;font-weight:700;padding:3px 8px;border-radius:12px;">${prio.label.toUpperCase()}</span>
        </td>
      </tr>
    `;
  }).join('');
  const firstUrl = sortedRows[0]?.reserveUrl || APP_URL;
  const content = `
    <h1 style="color:#DC2626;">${sortedRows.length} réserve${sortedRows.length > 1 ? 's' : ''} en retard</h1>
    <p>Bonjour ${escHtml(firstName)},</p>
    <p>Voici le récapitulatif quotidien des réserves en retard qui vous concernent. Un seul email est envoyé par jour pour limiter le bruit.</p>
    <div class="info-box" style="border-left-color:#DC2626;background:#FEF2F2;">
      <p><strong>${sortedRows.length}</strong> réserve${sortedRows.length > 1 ? 's' : ''} à traiter${maxDaysLate > 0 ? ` — retard maximal : <strong>${maxDaysLate} jour${maxDaysLate > 1 ? 's' : ''}</strong>` : ''}</p>
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #DDE4EE;border-radius:10px;overflow:hidden;margin:18px 0;">
      <thead>
        <tr style="background:#F4F7FB;">
          <th align="left" style="padding:10px 12px;font-size:11px;color:#5E738A;">Réserve</th>
          <th align="left" style="padding:10px 12px;font-size:11px;color:#5E738A;">Entreprise</th>
          <th align="left" style="padding:10px 12px;font-size:11px;color:#5E738A;">Retard</th>
          <th align="left" style="padding:10px 12px;font-size:11px;color:#5E738A;">${copy.deadline}</th>
          <th align="left" style="padding:10px 12px;font-size:11px;color:#5E738A;">Priorité</th>
        </tr>
      </thead>
      <tbody>${listHtml}</tbody>
    </table>
    <div style="text-align:center;"><a href="${firstUrl}" class="btn" style="background:#DC2626;color:#fff !important;">Ouvrir BuildTrack →</a></div>
  `;
  return {
    subject: `[Retards] ${sortedRows.length} réserve${sortedRows.length > 1 ? 's' : ''} à traiter`,
    html: baseLayout(content, `${sortedRows.length} réserves en retard à traiter`),
  };
}

const DIGEST_LOCALES = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };
const DIGEST_PRIORITY = {
  fr: { low: 'Faible', medium: 'Moyenne', high: 'Haute', critical: 'Critique' },
  en: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' },
  es: { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' },
};
const DIGEST_COPY = {
  fr: {
    title: count => `${count} réserve${count > 1 ? 's' : ''} en retard`,
    hello: name => `Bonjour${name ? ` ${name}` : ''},`,
    intro: 'Voici le récapitulatif quotidien des réserves en retard qui vous concernent. Un seul email est envoyé par jour pour limiter le bruit.',
    summary: (count, maxDaysLate) => `<strong>${count}</strong> réserve${count > 1 ? 's' : ''} à traiter${maxDaysLate > 0 ? ` — retard maximal : <strong>${maxDaysLate} jour${maxDaysLate > 1 ? 's' : ''}</strong>` : ''}`,
    reserve: 'Réserve',
    company: 'Entreprise',
    late: 'Retard',
    deadline: 'Échéance',
    priority: 'Priorité',
    days: days => `${days} j`,
    open: 'Ouvrir BuildTrack →',
    subject: count => `[Retards] ${count} réserve${count > 1 ? 's' : ''} à traiter`,
    preheader: count => `${count} réserves en retard à traiter`,
  },
  en: {
    title: count => `${count} overdue issue${count > 1 ? 's' : ''}`,
    hello: name => `Hello${name ? ` ${name}` : ''},`,
    intro: 'Here is your daily summary of overdue issues that concern you. Only one email is sent per day to reduce noise.',
    summary: (count, maxDaysLate) => `<strong>${count}</strong> issue${count > 1 ? 's' : ''} to handle${maxDaysLate > 0 ? ` — maximum delay: <strong>${maxDaysLate} day${maxDaysLate > 1 ? 's' : ''}</strong>` : ''}`,
    reserve: 'Issue',
    company: 'Company',
    late: 'Overdue',
    deadline: 'Deadline',
    priority: 'Priority',
    days: days => `${days}d`,
    open: 'Open BuildTrack →',
    subject: count => `[Overdue] ${count} issue${count > 1 ? 's' : ''} to handle`,
    preheader: count => `${count} overdue issues to handle`,
  },
  es: {
    title: count => `${count} reserva${count > 1 ? 's' : ''} atrasada${count > 1 ? 's' : ''}`,
    hello: name => `Hola${name ? ` ${name}` : ''},`,
    intro: 'Este es el resumen diario de las reservas atrasadas que te conciernen. Solo se envía un correo al día para reducir el ruido.',
    summary: (count, maxDaysLate) => `<strong>${count}</strong> reserva${count > 1 ? 's' : ''} por tratar${maxDaysLate > 0 ? ` — retraso máximo: <strong>${maxDaysLate} día${maxDaysLate > 1 ? 's' : ''}</strong>` : ''}`,
    reserve: 'Reserva',
    company: 'Empresa',
    late: 'Retraso',
    deadline: 'Fecha límite',
    priority: 'Prioridad',
    days: days => `${days} d`,
    open: 'Abrir BuildTrack →',
    subject: count => `[Retrasos] ${count} reserva${count > 1 ? 's' : ''} por tratar`,
    preheader: count => `${count} reservas atrasadas por tratar`,
  },
};

reserveOverdueDigestTemplate = function reserveOverdueDigestTemplateI18n({ recipientName, rows, language }) {
  const lang = emailLanguage(language);
  const copy = DIGEST_COPY[lang] || DIGEST_COPY.fr;
  const locale = DIGEST_LOCALES[lang] || DIGEST_LOCALES.fr;
  const firstName = String(recipientName || '').trim().split(' ')[0] || '';
  const sortedRows = [...rows].sort((a, b) => (b.daysLate || 0) - (a.daysLate || 0));
  const maxDaysLate = sortedRows.reduce((max, row) => Math.max(max, row.daysLate || 0), 0);
  const listHtml = sortedRows.map(row => {
    const priorityKey = row.priority || 'medium';
    const prio = {
      label: DIGEST_PRIORITY[lang]?.[priorityKey] || DIGEST_PRIORITY.fr[priorityKey] || priorityKey,
      color: PRIORITY_LABELS_FR[priorityKey]?.color || PRIORITY_LABELS_FR.medium.color,
    };
    const deadlineDate = new Date(row.deadline).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    return `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #EEF3FA;">
          <p style="font-size:14px;font-weight:700;color:#1A2742;margin:0 0 4px;">${escHtml(row.reserveTitle)}</p>
          <p style="font-size:11px;color:#8899BB;margin:0;">${escHtml(row.reserveId)}${row.chantierName ? ` &mdash; ${escHtml(row.chantierName)}` : ''}</p>
        </td>
        <td style="padding:12px;border-bottom:1px solid #EEF3FA;font-size:12px;color:#334155;">${escHtml(row.companyName)}</td>
        <td style="padding:12px;border-bottom:1px solid #EEF3FA;font-size:12px;color:#DC2626;font-weight:700;">${copy.days(row.daysLate)}</td>
        <td style="padding:12px;border-bottom:1px solid #EEF3FA;font-size:12px;color:#5E738A;">${deadlineDate}</td>
        <td style="padding:12px;border-bottom:1px solid #EEF3FA;">
          <span style="background:${prio.color}18;color:${prio.color};font-size:10px;font-weight:700;padding:3px 8px;border-radius:12px;">${prio.label.toUpperCase()}</span>
        </td>
      </tr>
    `;
  }).join('');
  const firstUrl = sortedRows[0]?.reserveUrl || APP_URL;
  const content = `
    <h1 style="color:#DC2626;">${copy.title(sortedRows.length)}</h1>
    <p>${copy.hello(escHtml(firstName))}</p>
    <p>${copy.intro}</p>
    <div class="info-box" style="border-left-color:#DC2626;background:#FEF2F2;">
      <p>${copy.summary(sortedRows.length, maxDaysLate)}</p>
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #DDE4EE;border-radius:10px;overflow:hidden;margin:18px 0;">
      <thead>
        <tr style="background:#F4F7FB;">
          <th align="left" style="padding:10px 12px;font-size:11px;color:#5E738A;">${copy.reserve}</th>
          <th align="left" style="padding:10px 12px;font-size:11px;color:#5E738A;">${copy.company}</th>
          <th align="left" style="padding:10px 12px;font-size:11px;color:#5E738A;">${copy.late}</th>
          <th align="left" style="padding:10px 12px;font-size:11px;color:#5E738A;">${copy.deadline}</th>
          <th align="left" style="padding:10px 12px;font-size:11px;color:#5E738A;">${copy.priority}</th>
        </tr>
      </thead>
      <tbody>${listHtml}</tbody>
    </table>
    <div style="text-align:center;"><a href="${firstUrl}" class="btn" style="background:#DC2626;color:#fff !important;">${copy.open}</a></div>
  `;
  return {
    subject: copy.subject(sortedRows.length),
    html: baseLayout(content, copy.preheader(sortedRows.length), lang),
  };
};

function buildReserveUrl(reserveId, recipientEmail, language) {
  const normalizedLang = emailLanguage(language);
  const langQuery = normalizedLang ? `lang=${encodeURIComponent(normalizedLang)}` : '';
  const secret = process.env.RESERVE_TOKEN_SECRET;
  if (!secret || secret.length < 16) {
    return `${APP_URL}/reserve/${encodeURIComponent(reserveId)}${langQuery ? `?${langQuery}` : ''}`;
  }
  const payload = { reserveId, email: recipientEmail.toLowerCase(), exp: Math.floor(Date.now() / 1000) + 30 * 86400 };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${APP_URL}/reserve/${encodeURIComponent(reserveId)}?t=${encodeURIComponent(`${body}.${sig}`)}${langQuery ? `&${langQuery}` : ''}`;
}

// Push notifications
let cachedSupabaseAdmin = null;
function getSupabaseAdmin() {
  if (cachedSupabaseAdmin) return cachedSupabaseAdmin;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  const { createClient } = require('@supabase/supabase-js');
  cachedSupabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedSupabaseAdmin;
}

function bearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function previewText(value, fallback = 'Nouvelle activite') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function reserveCompanyNames(reserve) {
  return Array.isArray(reserve?.companies) && reserve.companies.length > 0
    ? reserve.companies
    : reserve?.company
      ? [reserve.company]
      : [];
}

function notificationRoute(pathname, id) {
  return { pathname, id: String(id), path: pathname.replace('[id]', encodeURIComponent(String(id))) };
}

function isExpoPushToken(token) {
  return typeof token === 'string' && (
    token.startsWith('ExpoPushToken[') ||
    token.startsWith('ExponentPushToken[')
  );
}

function parseMinutes(value, fallback) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesInTimezone(timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = Number(parts.find(p => p.type === 'minute')?.value || '0');
    return hour * 60 + minute;
  } catch {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
}

function isQuietHour(pref) {
  if (!pref?.quiet_hours_enabled) return false;
  const current = minutesInTimezone(pref.quiet_hours_timezone || 'Europe/Paris');
  const start = parseMinutes(pref.quiet_hours_start, 19 * 60);
  const end = parseMinutes(pref.quiet_hours_end, 7 * 60);
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function pushPreferenceAllows(pref, column, critical = false) {
  if (!pref) return true;
  if (pref.push_enabled === false) return false;
  const criticalAllowed = critical && pref.reserve_critical_push !== false;
  if (pref[column] === false && !criticalAllowed) return false;
  if (isQuietHour(pref) && !(criticalAllowed && pref.critical_always_push !== false)) return false;
  return true;
}

async function preferencesForProfiles(supabase, profileIds) {
  const ids = Array.from(new Set((profileIds || []).filter(Boolean)));
  const map = new Map();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('user_id, push_enabled, email_enabled, messages_push, reserve_created_push, reserve_created_email, reserve_status_push, reserve_status_email, reserve_critical_push, reserve_critical_email, reserve_overdue_push, reserve_overdue_email, critical_always_push, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone')
    .in('user_id', ids);
  if (error) {
    console.warn('[push prefs] lecture impossible:', error.message);
    return map;
  }
  for (const row of data || []) map.set(row.user_id, row);
  return map;
}

async function authenticatedProfile(req, supabase) {
  const token = bearerToken(req);
  if (!token) return null;
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return null;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, email, role, organization_id, company_id')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile) return null;
  return profile;
}

const inventoryBarcodeRequestWindows = new Map();

function normalizeInventoryBarcodeLookupCode(value) {
  return String(value || '').trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 128);
}

function cleanInventoryWebText(value, maxLength = 500) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function inventoryWebEvidence(result) {
  return [result?.description, ...(Array.isArray(result?.extra_snippets) ? result.extra_snippets : [])]
    .map(value => cleanInventoryWebText(value, 500))
    .filter(Boolean)
    .join(' ')
    .slice(0, 1800);
}

function inventoryVariantTitleSegment(value) {
  const segment = cleanInventoryWebText(value, 60);
  return !!segment && /\d/.test(segment) && segment.length <= 60
    && !/^\d{8,14}$/.test(segment.replace(/[\s.\-]/g, ''))
    && !/^(?:19|20)\d{2}$/.test(segment);
}

function cleanInventoryWebTitle(value, code) {
  const escaped = String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let title = cleanInventoryWebText(value, 180)
    .replace(new RegExp(escaped, 'gi'), ' ')
    .replace(/\b(?:EAN(?:-?13)?|GTIN(?:-?\d+)?|UPC(?:-?[AE])?|code[- ]?barres?|barcode)\b\s*[:#-]?/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[|:;,\-–—\s]+|[|:;,\-–—\s]+$/g, '')
    .trim();
  const segments = title.split(/\s*[|•]\s*|\s+[–—]\s+/).map(segment => segment.trim()).filter(Boolean);
  const first = segments[0];
  if (first && first.length >= 4) {
    title = [first, ...segments.slice(1).filter(inventoryVariantTitleSegment).slice(0, 3)].join(' — ');
  }
  return title.length >= 4 ? title.slice(0, 180) : '';
}

function inventoryGenericCatalogueTitle(value) {
  const title = cleanInventoryWebText(value, 180).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return /^(?:accessories|accessoires|zubehor|catalog(?:ue)?|product catalog(?:ue)?|general catalog(?:ue)?)(?: \d{4})?$/.test(title)
    || /^(?:download|data sheet|datasheet|technical sheet|fiche technique)(?: \d{4})?$/.test(title);
}

function inventoryManufacturerReference(value, code) {
  const text = cleanInventoryWebText(value, 1800);
  const labels = /\b(?:manufacturer\s+part\s+(?:number|no\.?|#)|part\s+(?:number|no\.?|#)|product\s+(?:number|no\.?|code)|order\s+(?:number|no\.?|code)|article\s+(?:number|no\.?|code)|catalog(?:ue)?\s+(?:number|no\.?|code)|reference\s+(?:du\s+produit|number|no\.?|code)?|réf(?:érence)?|ref(?:erence)?|modèle|model|mpn|sku|index)\s*[.:#-]?\s*/gi;
  for (const label of text.matchAll(labels)) {
    let remaining = text.slice((label.index || 0) + label[0].length, (label.index || 0) + label[0].length + 60);
    const tokens = [];
    for (let index = 0; index < 4; index += 1) {
      const token = remaining.match(/^([A-Z0-9][A-Z0-9._/-]*)\b/i)?.[1]?.replace(/[.,;:]+$/, '');
      if (!token || !/\d/.test(token)) break;
      tokens.push(token);
      remaining = remaining.slice(remaining.indexOf(token) + token.length).replace(/^\s+/, '');
    }
    const candidate = tokens.join(' ');
    if (candidate.length >= 3 && candidate.replace(/[\s.\-]/g, '').toLowerCase() !== String(code).replace(/[\s.\-]/g, '').toLowerCase()) {
      return candidate;
    }
  }
  return undefined;
}

function inventoryVariantDetails(value, code) {
  const escaped = String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const text = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(new RegExp(escaped, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 1800);
  const normalized = field => String(field || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const patterns = [
    /\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:mm|cm|m)?\b/gi,
    /\b\d+(?:[.,]\d+)?\s*(?:mm²|mm2|cm²|cm2|m²|m2|kwh|mah|ah|wh|kg|mg|g|ml|cl|l\/min|m\/min|nm|kn|n|mm|cm|m|kv|v|ka|a|kw|w|bar|kpa|mpa|hz|rpm|dba?)\b/gi,
    /\b(?:PZ|PH|TX|TORX)\s*[-:]?\s*\d+\b/gi,
    /\bDN\s*[-:]?\s*\d+(?:[.,]\d+)?\b/gi,
    /\b(?:IP|IK)\s*\d{2}\b/gi,
    /\b(?:lot|pack|bo[iî]te|carton|sachet|conditionnement)\s*(?:de\s*)?\d+\b/gi,
    /\b\d+\s*(?:pièces?|pcs?|unités?|pôles?|poles?)\b/gi,
    /\b\d+\s*P(?:\s*\+\s*\d+\s*P?)?\b/gi,
    /\b(?:M|Ø|diam(?:ètre)?|diameter)\s*[-:]?\s*\d+(?:[.,]\d+)?\b/gi,
  ];
  const details = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const detail = match[0].replace(/\s+/g, ' ').trim();
      if (!detail || details.some(existing => normalized(existing) === normalized(detail))) continue;
      details.push(detail);
    }
  }
  return details;
}

function inventoryHasVariant(value) {
  const withoutYears = String(value || '').replace(/\b(?:19|20)\d{2}\b/g, ' ');
  return inventoryVariantDetails(withoutYears, '').length > 0
    || /\b(?=[A-Z0-9./-]{3,}\b)(?=[A-Z0-9./-]*[A-Z])(?=[A-Z0-9./-]*\d)[A-Z0-9][A-Z0-9./-]*\b/i.test(withoutYears);
}

const inventoryBtpBrandDomains = [
  ['legrand.', 'Legrand'], ['hager.', 'Hager'], ['grohe.', 'GROHE'], ['knipex.', 'KNIPEX'],
  ['wiha.', 'Wiha'], ['makita.', 'Makita'], ['bosch-professional.', 'Bosch Professional'],
  ['wera.', 'Wera'], ['hellermanntyton.', 'HellermannTyton'], ['rawlplug.', 'Rawlplug'],
  ['se.com', 'Schneider Electric'], ['wago.', 'WAGO'], ['hilti.', 'Hilti'], ['fischer.', 'fischer'],
  ['geberit.', 'Geberit'], ['dewalt.', 'DEWALT'],
];
const inventoryBtpBrandAliases = [
  ['bosch', 'Bosch Professional'], ['hellermanntyton', 'HellermannTyton'],
  ['schneiderelectric', 'Schneider Electric'], ['legrand', 'Legrand'], ['hager', 'Hager'],
  ['grohe', 'GROHE'], ['knipex', 'KNIPEX'], ['wiha', 'Wiha'], ['makita', 'Makita'],
  ['wera', 'Wera'], ['rawlplug', 'Rawlplug'], ['wago', 'WAGO'], ['hilti', 'Hilti'],
  ['fischer', 'fischer'], ['geberit', 'Geberit'], ['dewalt', 'DEWALT'],
];

function inventoryBtpBrand(result, url, designation) {
  const official = inventoryBtpBrandDomains.find(([domain]) => url.hostname.toLowerCase().includes(domain));
  if (official) return official[1];
  const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const context = normalized(`${designation} ${result?.profile?.long_name || ''}`);
  return inventoryBtpBrandAliases.find(([alias]) => context.includes(alias))?.[1];
}

function selectInventoryWebMatch(results, code) {
  const blockedHosts = [
    'barcodefinder.', 'barcodelookup.', 'gtinhub.', 'go-upc.', 'upcitemdb.',
    'openfoodfacts.', 'openproductsfacts.', 'google.', 'bing.', 'duckduckgo.',
  ];
  const needle = String(code).toLowerCase().replace(/[\s.\-]/g, '');
  const ranked = [];
  for (const result of results || []) {
    let url;
    try {
      url = new URL(String(result?.url || ''));
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    if (blockedHosts.some(host => url.hostname.toLowerCase().includes(host))) continue;
    const normalized = field => String(field || '').toLowerCase().replace(/[\s.\-]/g, '');
    const inTitle = normalized(result.title).includes(needle);
    const evidence = inventoryWebEvidence(result);
    const inDescription = normalized(evidence).includes(needle);
    const inUrl = normalized(result.url).includes(needle);
    const evidenceScore = (inTitle ? 8 : 0) + (inDescription ? 4 : 0) + (inUrl ? 2 : 0);
    if (evidenceScore < 4) continue;
    let designation = cleanInventoryWebTitle(result.title, code);
    if (inventoryGenericCatalogueTitle(designation)) continue;
    if (!designation || /^(product|produit|fiche produit|product sheet)$/i.test(designation)) {
      designation = cleanInventoryWebTitle(evidence.slice(0, 180).split(/[.!?](?:\s|$)/)[0], code);
    }
    if (!designation || inventoryGenericCatalogueTitle(designation)) continue;
    const manufacturerReference = inventoryManufacturerReference(evidence, code);
    if (designation
      && manufacturerReference
      && normalized(manufacturerReference) !== needle
      && !normalized(designation).includes(normalized(manufacturerReference))) {
      designation = `${designation} — Ref. ${manufacturerReference}`;
    }
    let appendedDetails = 0;
    const details = inventoryVariantDetails(evidence, code);
    for (const detail of details) {
      if (normalized(designation).includes(normalized(detail))) continue;
      designation = `${designation} — ${detail}`;
      appendedDetails += 1;
      if (appendedDetails >= 3) break;
    }
    const variantComplete = !!manufacturerReference || inventoryHasVariant(designation) || details.length > 0;
    const score = evidenceScore + (variantComplete ? 3 : 0) + (designation.length >= 12 ? 1 : 0);
    ranked.push({ designation, evidenceScore, score, url, result, variantComplete });
  }
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return best ? {
    barcode: code,
    designation: best.designation,
    brand: inventoryBtpBrand(best.result, best.url, best.designation),
    photoUrl: best.result?.thumbnail?.original || best.result?.thumbnail?.src || undefined,
    source: 'web',
    sourceUrl: best.url.toString(),
    confidence: best.evidenceScore >= 8 || (best.evidenceScore >= 4 && best.variantComplete) ? 'high' : 'medium',
    variantComplete: best.variantComplete,
  } : null;
}

function allowInventoryBarcodeLookup(userId) {
  const now = Date.now();
  const recent = (inventoryBarcodeRequestWindows.get(userId) || [])
    .filter(time => now - time < 60000);
  if (recent.length >= 20) {
    inventoryBarcodeRequestWindows.set(userId, recent);
    return false;
  }
  recent.push(now);
  inventoryBarcodeRequestWindows.set(userId, recent);
  return true;
}

let inventoryTavilyBlockedUntil = 0;

function firstDayOfNextUtcMonth(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

async function inventoryProviderFetch(url, init, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchInventoryWebProvidersServer(code, language) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  const serpApiKey = process.env.SERPAPI_API_KEY;
  const providersTried = [];
  const providerStatuses = {};
  const now = Date.now();
  let fallbackReason;

  if (tavilyKey && now >= inventoryTavilyBlockedUntil) {
    providersTried.push('tavily');
    try {
      const response = await inventoryProviderFetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${tavilyKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `"${code}"`,
          search_depth: 'basic',
          max_results: 20,
          topic: 'general',
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          exact_match: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      providerStatuses.tavily = response.status;
      if (response.ok) {
        return {
          provider: 'tavily',
          providersTried,
          results: Array.isArray(payload?.results) ? payload.results.map(result => ({
            title: result?.title,
            description: result?.content,
            url: result?.url,
          })) : [],
        };
      }
      fallbackReason = `tavily_http_${response.status}`;
      if (response.status === 432 || response.status === 433) {
        inventoryTavilyBlockedUntil = firstDayOfNextUtcMonth(now);
      } else if (response.status === 429) {
        inventoryTavilyBlockedUntil = now + 60000;
      }
    } catch (error) {
      fallbackReason = error?.name === 'AbortError' ? 'tavily_timeout' : 'tavily_unavailable';
    }
  } else if (tavilyKey) {
    fallbackReason = 'tavily_circuit_open';
  } else {
    fallbackReason = 'tavily_not_configured';
  }

  if (serpApiKey) {
    providersTried.push('serpapi');
    try {
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', `"${code}"`);
      url.searchParams.set('hl', ['fr', 'es', 'en'].includes(language) ? language : 'fr');
      url.searchParams.set('safe', 'active');
      url.searchParams.set('num', '20');
      url.searchParams.set('api_key', serpApiKey);
      const response = await inventoryProviderFetch(url.toString(), { headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      providerStatuses.serpapi = response.status;
      if (response.ok && !payload?.error) {
        return {
          provider: 'serpapi',
          providersTried,
          fallbackReason,
          results: Array.isArray(payload?.organic_results) ? payload.organic_results.map(result => ({
            title: result?.title,
            description: result?.snippet,
            url: result?.link,
            thumbnail: result?.thumbnail ? { src: result.thumbnail } : undefined,
          })) : [],
        };
      }
    } catch {
      // Fall through to a sanitized error response.
    }
  }

  const error = new Error(tavilyKey || serpApiKey
    ? 'No web search provider is currently available'
    : 'No web search provider is configured');
  error.providerStatuses = providerStatuses;
  throw error;
}

app.post('/api/inventory-barcode-lookup', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(503).json({ error: 'Configuration serveur manquante', code: 'server_not_configured' });
  const profile = await authenticatedProfile(req, supabase);
  if (!profile) return res.status(401).json({ error: 'Session invalide', code: 'invalid_session' });

  const code = normalizeInventoryBarcodeLookupCode(req.body?.code);
  const language = String(req.body?.language || 'fr').split('-')[0].toLowerCase();
  if (code.length < 4) return res.status(400).json({ error: 'Code-barres invalide', code: 'invalid_barcode' });

  let cacheClaim = null;
  try {
    cacheClaim = await claimSharedInventoryBarcodeLookup(supabase, code);
    if (cacheClaim.state === 'hit' && cacheClaim.match?.designation) {
      return res.json({
        match: cacheClaim.match,
        provider: 'supabase-cache',
        cachedProvider: cacheClaim.cachedProvider,
        providersTried: [],
        cacheHit: true,
      });
    }
    if (cacheClaim.state === 'negative_hit') {
      return res.status(404).json({
        error: 'Produit introuvable',
        code: 'product_not_found',
        provider: 'supabase-cache',
        cacheHit: true,
      });
    }
    if (cacheClaim.state === 'pending') {
      return res.status(409).json({
        error: 'Recherche identique deja en cours',
        code: 'lookup_in_progress',
        retryAfterMs: cacheClaim.retryAfterMs || 500,
      });
    }
  } catch (error) {
    // Cache deployment/outage must not disable the existing provider chain.
    console.warn('[inventory-barcode-cache] unavailable:', error?.message || error);
    cacheClaim = null;
  }

  // Shared cache hits are free; only real external searches consume the
  // per-user rate-limit budget.
  if (!allowInventoryBarcodeLookup(profile.id)) {
    if (cacheClaim?.state === 'claimed') {
      await releaseSharedInventoryBarcodeLookup(supabase, code, cacheClaim.leaseToken).catch(() => {});
    }
    return res.status(429).json({ error: 'Trop de recherches, reessayez dans une minute.', code: 'rate_limited' });
  }

  try {
    const search = await searchInventoryWebProvidersServer(code, language);
    const match = selectInventoryWebMatch(search.results, code);
    if (!match) {
      if (cacheClaim?.state === 'claimed') {
        await markSharedInventoryBarcodeNotFound(supabase, code, cacheClaim.leaseToken)
          .catch(error => console.warn('[inventory-barcode-cache] negative cache failed:', error?.message || error));
      }
      return res.status(404).json({ error: 'Produit introuvable', code: 'product_not_found' });
    }
    if (cacheClaim?.state === 'claimed') {
      try {
        await completeSharedInventoryBarcodeLookup(supabase, code, cacheClaim.leaseToken, match, {
          provider: search.provider,
          providersTried: search.providersTried,
          fallbackReason: search.fallbackReason,
          lookupVersion: 1,
        });
      } catch (error) {
        console.warn('[inventory-barcode-cache] completion failed:', error?.message || error);
        await releaseSharedInventoryBarcodeLookup(supabase, code, cacheClaim.leaseToken).catch(() => {});
      }
    }
    return res.json({
      match,
      provider: search.provider,
      providersTried: search.providersTried,
      fallbackReason: search.fallbackReason,
    });
  } catch (error) {
    if (cacheClaim?.state === 'claimed') {
      await releaseSharedInventoryBarcodeLookup(supabase, code, cacheClaim.leaseToken).catch(() => {});
    }
    console.error('[inventory-barcode-lookup]', error?.message || error);
    const notConfigured = error?.message?.includes('configured');
    return res.status(notConfigured ? 503 : 502).json({
      error: notConfigured ? 'Recherche web non configuree' : 'Recherche web temporairement indisponible',
      code: notConfigured ? 'web_search_not_configured' : 'provider_unavailable',
      providerStatuses: error?.providerStatuses,
    });
  }
});

async function adminTargetProfile(req, supabase, targetUserId) {
  const actor = await authenticatedProfile(req, supabase);
  if (!actor) return { status: 401, error: 'Session invalide' };
  if (actor.role !== 'admin' && actor.role !== 'super_admin') {
    return { status: 403, error: 'Acces admin requis' };
  }

  const { data: target, error: targetError } = await supabase
    .from('profiles')
    .select('id, name, email, role, organization_id')
    .eq('id', targetUserId)
    .maybeSingle();
  if (targetError || !target) return { status: 404, error: 'Utilisateur introuvable' };
  if (actor.role !== 'super_admin' && target.organization_id !== actor.organization_id) {
    return { status: 403, error: 'Utilisateur hors organisation' };
  }
  if (actor.role === 'admin' && (target.role === 'admin' || target.role === 'super_admin')) {
    return { status: 403, error: 'Modification reservee au super administrateur' };
  }
  return { actor, target };
}

async function getNotificationPreferencesForUser(supabase, profile) {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('user_id, organization_id, email_enabled, reserve_created_email, reserve_status_email, reserve_critical_email, reserve_overdue_email, email_admin_updated_at, email_admin_updated_by, email_admin_action')
    .eq('user_id', profile.id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: inserted, error: insertError } = await supabase
    .from('notification_preferences')
    .insert({
      user_id: profile.id,
      organization_id: profile.organization_id ?? null,
    })
    .select('user_id, organization_id, email_enabled, reserve_created_email, reserve_status_email, reserve_critical_email, reserve_overdue_email, email_admin_updated_at, email_admin_updated_by, email_admin_action')
    .single();
  if (insertError) throw insertError;
  return inserted;
}

const TRANSLATION_LANGS = {
  fr: { name: 'French', deepl: 'FR' },
  en: { name: 'English', deepl: 'EN-US' },
  es: { name: 'Spanish', deepl: 'ES' },
};

function sanitizeTranslationText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function translationProviderOrder() {
  return ['azure'];
}

function azureTranslatorUrl() {
  const endpoint = String(process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com').trim();
  if (/\/translate(\?|$)/i.test(endpoint)) return endpoint;
  const base = endpoint.replace(/\/+$/, '');
  if (/\/translator\/text\/v3\.0$/i.test(base)) return `${base}/translate`;
  if (/cognitiveservices\.azure\.com/i.test(base)) return `${base}/translator/text/v3.0/translate`;
  return `${base}/translate`;
}

async function translateWithAzure({ text, source, target }) {
  const apiKey = process.env.AZURE_TRANSLATOR_KEY;
  if (!apiKey) throw new Error('AZURE_TRANSLATOR_KEY manquant cote serveur');
  const url = new URL(azureTranslatorUrl());
  if (!url.searchParams.has('api-version')) url.searchParams.set('api-version', '3.0');
  if (source && source !== target) url.searchParams.set('from', source);
  url.searchParams.set('to', target);

  const headers = {
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
  };
  if (process.env.AZURE_TRANSLATOR_REGION) {
    headers['Ocp-Apim-Subscription-Region'] = process.env.AZURE_TRANSLATOR_REGION;
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify([{ Text: text }]),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || response.statusText);
  }
  const translated = payload?.[0]?.translations?.[0]?.text;
  return typeof translated === 'string' ? sanitizeTranslationText(translated) : null;
}

async function translateWithDeepL({ text, source, target }) {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) return null;
  const apiUrl = process.env.DEEPL_API_URL || (apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate');
  const body = new URLSearchParams();
  body.set('text', text);
  body.set('target_lang', TRANSLATION_LANGS[target].deepl);
  if (source && source !== target) body.set('source_lang', source.toUpperCase());
  body.set('preserve_formatting', '1');

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || response.statusText);
  const translated = payload?.translations?.[0]?.text;
  return typeof translated === 'string' ? sanitizeTranslationText(translated) : null;
}

async function translateWithOpenAI({ text, source, target, context }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const sourceLabel = TRANSLATION_LANGS[source]?.name || 'the source language';
  const targetLabel = TRANSLATION_LANGS[target].name;
  const model = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 900,
      messages: [
        {
          role: 'system',
          content: [
            `Translate from ${sourceLabel} to ${targetLabel}.`,
            'Use professional construction-site wording.',
            'Preserve IDs, names, building labels, levels, dates, line breaks, and bullet structure.',
            'Do not add explanations, comments, markdown, or quotation marks.',
            `Text context: ${context || 'generic'}.`,
          ].join(' '),
        },
        { role: 'user', content: text },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || response.statusText);
  const translated = payload?.choices?.[0]?.message?.content;
  return typeof translated === 'string' ? sanitizeTranslationText(translated) : null;
}

async function translateAdvancedOnline(params) {
  const providers = {
    azure: translateWithAzure,
    deepl: translateWithDeepL,
    openai: translateWithOpenAI,
  };
  let lastError = null;
  for (const provider of translationProviderOrder()) {
    const handler = providers[provider];
    if (!handler) continue;
    try {
      const translated = await handler(params);
      if (translated) return { text: translated, provider };
    } catch (err) {
      lastError = err;
      console.warn(`[translate-text] ${provider} failed:`, err?.message || err);
    }
  }
  if (lastError) throw lastError;
  return null;
}

app.post('/api/translate-text', async (req, res) => {
  try {
    const requireAuth = process.env.TRANSLATION_REQUIRE_AUTH !== 'false';
    if (requireAuth) {
      const supabase = getSupabaseAdmin();
      if (!supabase) return res.status(503).json({ success: false, error: 'Configuration serveur manquante' });
      const profile = await authenticatedProfile(req, supabase);
      if (!profile) return res.status(401).json({ success: false, error: 'Session invalide' });
    }

    const text = sanitizeTranslationText(req.body?.text);
    const target = String(req.body?.target || '').toLowerCase();
    const source = String(req.body?.source || 'fr').toLowerCase();
    const context = String(req.body?.context || 'generic');

    if (!text) return res.status(400).json({ success: false, error: 'Texte manquant' });
    if (text.length > 2500) return res.status(413).json({ success: false, error: 'Texte trop long' });
    if (!TRANSLATION_LANGS[target] || !TRANSLATION_LANGS[source]) {
      return res.status(400).json({ success: false, error: 'Langue non supportee' });
    }
    if (source === target) return res.json({ success: true, text, provider: 'none' });

    const result = await translateAdvancedOnline({ text, source, target, context });
    if (!result) {
      return res.status(503).json({ success: false, error: 'Aucun fournisseur de traduction configure' });
    }
    return res.json({ success: true, ...result });
  } catch (err) {
    const detail = err?.message || 'Erreur Azure inconnue';
    console.error('[translate-text] Exception:', detail);
    return res.status(502).json({ success: false, error: 'Traduction Azure indisponible', detail });
  }
});

async function enabledTokensForProfiles(supabase, profileIds, column, critical = false) {
  const ids = Array.from(new Set((profileIds || []).filter(Boolean)));
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token, user_id')
    .eq('enabled', true)
    .in('user_id', ids);
  if (error) throw error;
  const prefs = await preferencesForProfiles(supabase, ids);
  const seen = new Set();
  return (data || []).filter(row => {
    if (!pushPreferenceAllows(prefs.get(row.user_id), column, critical)) return false;
    if (!isExpoPushToken(row.token) || seen.has(row.token)) return false;
    seen.add(row.token);
    return true;
  });
}

async function sendExpoPushMessages(supabase, messages) {
  const valid = (messages || []).filter(m => isExpoPushToken(m.to));
  const stats = { requested: valid.length, sent: 0, invalidTokens: 0 };
  if (valid.length === 0) return stats;

  const invalid = new Set();
  const headers = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100);
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.errors?.[0]?.message || body?.error || response.statusText);
    }
    const tickets = Array.isArray(body?.data) ? body.data : [];
    tickets.forEach((ticket, index) => {
      if (ticket?.status === 'ok') {
        stats.sent += 1;
      } else if (ticket?.details?.error === 'DeviceNotRegistered') {
        invalid.add(chunk[index]?.to);
      }
    });
  }

  if (invalid.size > 0) {
    stats.invalidTokens = invalid.size;
    await supabase
      .from('push_tokens')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .in('token', Array.from(invalid));
  }
  return stats;
}

async function resolveReserveRecipientProfileIds(supabase, reserve) {
  const names = reserveCompanyNames(reserve);
  if (!reserve?.organization_id || names.length === 0) return [];
  const { data: companies, error: companyError } = await supabase
    .from('companies')
    .select('id, name, organization_id')
    .eq('organization_id', reserve.organization_id);
  if (companyError) throw companyError;

  const matched = (companies || []).filter(company =>
    names.some(name => sameName(name, company.name))
  );
  const companyIds = matched.map(c => c.id);
  if (companyIds.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, company_id, organization_id')
    .eq('organization_id', reserve.organization_id)
    .in('company_id', companyIds);
  if (profileError) throw profileError;
  return (profiles || []).map(p => p.id);
}

async function resolveMessageRecipientProfileIds(supabase, message, requesterProfile) {
  const orgId = message.organization_id || requesterProfile?.organization_id;
  if (!orgId) return [];
  const { data: channel } = await supabase
    .from('channels')
    .select('id, name, type, members, organization_id')
    .eq('id', message.channel_id)
    .maybeSingle();

  if (message.channel_id?.startsWith('company-')) {
    const companyId = message.channel_id.slice('company-'.length);
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, name, company_id, organization_id')
      .eq('organization_id', orgId)
      .eq('company_id', companyId);
    if (error) throw error;
    return (profiles || [])
      .filter(p => p.id !== requesterProfile.id && !sameName(p.name, message.sender))
      .map(p => p.id);
  }

  const memberNames = Array.isArray(channel?.members) ? channel.members : [];
  const dmNames = message.channel_id?.startsWith('dm-')
    ? message.channel_id.slice(3).split('__')
    : [];
  const targetNames = Array.from(new Set([...memberNames, ...dmNames].filter(Boolean)))
    .filter(name => !sameName(name, message.sender));

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, name, organization_id')
    .eq('organization_id', orgId);
  if (error) throw error;

  const candidates = targetNames.length > 0
    ? (profiles || []).filter(p => targetNames.some(name => sameName(name, p.name)))
    : (profiles || []);
  return candidates
    .filter(p => p.id !== requesterProfile.id && !sameName(p.name, message.sender))
    .map(p => p.id);
}

async function pushForMessage(supabase, profile, body) {
  const { messageId } = body;
  if (!messageId) throw new Error('messageId manquant');
  const { data: message, error } = await supabase
    .from('messages')
    .select('id, channel_id, sender, content, attachment_uri, organization_id')
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw error;
  if (!message) throw new Error('Message introuvable');
  if (message.organization_id && profile.organization_id && message.organization_id !== profile.organization_id) {
    const err = new Error('Message hors organisation');
    err.statusCode = 403;
    throw err;
  }
  if (!sameName(message.sender, profile.name)) {
    const err = new Error('Seul l expediteur peut notifier ce message');
    err.statusCode = 403;
    throw err;
  }

  const recipientIds = await resolveMessageRecipientProfileIds(supabase, message, profile);
  const tokens = await enabledTokensForProfiles(supabase, recipientIds, 'messages_push');
  const pushStats = await sendExpoPushMessages(supabase, tokens.map(row => ({
    to: row.token,
    sound: 'default',
    title: `Message de ${message.sender}`,
    body: previewText(message.content, message.attachment_uri ? 'Photo jointe' : 'Nouveau message'),
    data: notificationRoute('/channel/[id]', message.channel_id),
    channelId: 'buildtrack',
  })));
  return { recipients: recipientIds.length, ...pushStats };
}

async function pushForReserve(supabase, profile, body, statusChange = false) {
  const { reserveId, newStatus, previousStatus } = body;
  if (!reserveId) throw new Error('reserveId manquant');
  const { data: reserve, error } = await supabase
    .from('reserves')
    .select('id, title, status, priority, companies, company, organization_id')
    .eq('id', reserveId)
    .maybeSingle();
  if (error) throw error;
  if (!reserve) throw new Error('Reserve introuvable');
  if (reserve.organization_id && profile.organization_id && reserve.organization_id !== profile.organization_id) {
    const err = new Error('Reserve hors organisation');
    err.statusCode = 403;
    throw err;
  }

  const recipientIds = await resolveReserveRecipientProfileIds(supabase, reserve);
  const isCritical = reserve.priority === 'critical';
  const tokens = await enabledTokensForProfiles(
    supabase,
    recipientIds.filter(id => id !== profile.id),
    statusChange ? 'reserve_status_push' : 'reserve_created_push',
    isCritical,
  );
  const statusLabel = STATUS_LABELS_FR[newStatus || reserve.status]?.label || newStatus || reserve.status;
  const title = statusChange ? 'Statut de reserve modifie' : 'Nouvelle reserve';
  const fallback = statusChange ? `${reserve.id} - ${statusLabel}` : `${reserve.id} - ${reserve.title}`;
  const pushStats = await sendExpoPushMessages(supabase, tokens.map(row => ({
    to: row.token,
    sound: 'default',
    title,
    body: previewText(statusChange ? `${reserve.title} (${previousStatus || reserve.status} -> ${statusLabel})` : fallback, fallback),
    data: notificationRoute('/reserve/[id]', reserve.id),
    channelId: 'buildtrack',
  })));
  return { recipients: recipientIds.length, ...pushStats };
}

async function pushOverdueReserves(supabase) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().split('T')[0];
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayISO = yesterday.toISOString().split('T')[0];
  const stats = { scanned: 0, notified: 0, sent: 0, errors: 0 };
  const limit = 7;
  const { data: reserves, error } = await supabase
    .from('reserves')
    .select('id, title, priority, status, deadline, companies, company, chantier_id, organization_id, overdue_push_last_notified_date, overdue_push_reminder_count')
    .not('status', 'in', '(closed,verification)')
    .not('deadline', 'is', null)
    .lt('deadline', todayISO);
  if (error) throw error;

  const list = reserves || [];
  stats.scanned = list.length;
  if (list.length === 0) return stats;
  const orgIds = [...new Set(list.map(r => r.organization_id).filter(Boolean))];
  if (orgIds.length === 0) return stats;
  const { data: companies } = await supabase.from('companies').select('id, name, organization_id').in('organization_id', orgIds);
  const { data: profiles } = await supabase.from('profiles').select('id, name, company_id, organization_id, role').in('organization_id', orgIds);
  const { data: tokens } = await supabase.from('push_tokens').select('token, user_id').eq('enabled', true).in('organization_id', orgIds);
  const prefsByUser = await preferencesForProfiles(supabase, (profiles || []).map(p => p.id));

  const companiesByOrg = new Map();
  for (const c of companies || []) {
    const arr = companiesByOrg.get(c.organization_id) || [];
    arr.push(c);
    companiesByOrg.set(c.organization_id, arr);
  }
  const profilesByCompany = new Map();
  const adminsByOrg = new Map();
  for (const p of profiles || []) {
    if (p.company_id) {
      const arr = profilesByCompany.get(p.company_id) || [];
      arr.push(p);
      profilesByCompany.set(p.company_id, arr);
    }
    if (p.role === 'admin' || p.role === 'super_admin') {
      const arr = adminsByOrg.get(p.organization_id) || [];
      arr.push(p);
      adminsByOrg.set(p.organization_id, arr);
    }
  }
  const tokensByUser = new Map();
  for (const t of tokens || []) {
    if (!isExpoPushToken(t.token)) continue;
    const arr = tokensByUser.get(t.user_id) || [];
    arr.push(t.token);
    tokensByUser.set(t.user_id, arr);
  }

  for (const reserve of list) {
    try {
      if (reserve.overdue_push_last_notified_date === todayISO) continue;
      const names = reserveCompanyNames(reserve);
      const orgCompanies = companiesByOrg.get(reserve.organization_id) || [];
      const matchedCompanies = orgCompanies.filter(c => names.some(name => sameName(name, c.name)));
      if (matchedCompanies.length === 0) continue;
      const daysLate = Math.max(1, Math.round((today.getTime() - new Date(reserve.deadline).getTime()) / 86400000));
      const previousCount = typeof reserve.overdue_push_reminder_count === 'number'
        ? reserve.overdue_push_reminder_count
        : 0;
      const continuing = reserve.overdue_push_last_notified_date === yesterdayISO || reserve.overdue_push_last_notified_date === todayISO;
      const reminderCount = continuing ? previousCount : 0;
      const escalate = reminderCount >= limit;
      const recipients = [];
      if (escalate) {
        recipients.push(...(adminsByOrg.get(reserve.organization_id) || []));
      } else {
        for (const company of matchedCompanies) recipients.push(...(profilesByCompany.get(company.id) || []));
      }

      const seenUsers = new Set();
      const messages = [];
      for (const profileRow of recipients) {
        if (!pushPreferenceAllows(prefsByUser.get(profileRow.id), 'reserve_overdue_push', reserve.priority === 'critical')) continue;
        if (seenUsers.has(profileRow.id)) continue;
        seenUsers.add(profileRow.id);
        for (const token of tokensByUser.get(profileRow.id) || []) {
          messages.push({
            to: token,
            sound: 'default',
            title: escalate ? 'Escalade reserve en retard' : 'Reserve en retard',
            body: previewText(`${reserve.id} - ${reserve.title} (${daysLate}j de retard)`),
            data: notificationRoute('/reserve/[id]', reserve.id),
            channelId: 'buildtrack',
          });
        }
      }

      const pushStats = await sendExpoPushMessages(supabase, messages);
      stats.sent += pushStats.sent;
      if (pushStats.sent > 0) {
        const nextCount = escalate ? reminderCount : reminderCount + 1;
        const { error: upErr } = await supabase
          .from('reserves')
          .update({
            overdue_push_last_notified_date: todayISO,
            overdue_push_reminder_count: nextCount,
          })
          .eq('id', reserve.id);
        if (upErr) stats.errors += 1;
        else stats.notified += 1;
      }
    } catch (err) {
      stats.errors += 1;
      console.warn('[push overdue] reserve', reserve.id, err.message);
    }
  }
  return stats;
}

app.post('/api/send-push', async (req, res) => {
  const { type, ...body } = req.body || {};
  if (!type) return res.status(400).json({ error: 'Type manquant' });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Configuration Supabase serveur manquante' });

  try {
    if (type === 'reserve-overdue') {
      const cronSecret = process.env.CRON_SECRET;
      const auth = req.headers.authorization || '';
      if (!cronSecret || auth !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Non autorise' });
      const stats = await pushOverdueReserves(supabase);
      return res.json({ ok: true, stats });
    }

    const profile = await authenticatedProfile(req, supabase);
    if (!profile) return res.status(401).json({ error: 'Session invalide' });
    let stats;
    if (type === 'message-created') {
      stats = await pushForMessage(supabase, profile, body);
    } else if (type === 'reserve-created') {
      stats = await pushForReserve(supabase, profile, body, false);
    } else if (type === 'reserve-status-changed') {
      stats = await pushForReserve(supabase, profile, body, true);
    } else {
      return res.status(400).json({ error: `Type inconnu: ${type}` });
    }
    return res.json({ ok: true, stats });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error('[send-push] Exception:', err.message);
    return res.status(status).json({ ok: false, error: err.message || 'Erreur serveur' });
  }
});

app.get('/api/admin-notification-preferences', async (req, res) => {
  const userId = String(req.query.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId manquant' });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Configuration Supabase serveur manquante' });

  try {
    const access = await adminTargetProfile(req, supabase, userId);
    if (access.error) return res.status(access.status || 500).json({ error: access.error });
    const preferences = await getNotificationPreferencesForUser(supabase, access.target);
    return res.json({ ok: true, user: access.target, preferences });
  } catch (err) {
    console.error('[admin-notification-preferences] GET:', err.message);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.post('/api/admin-notification-preferences', async (req, res) => {
  const { userId, emailEnabled } = req.body || {};
  if (!userId || typeof emailEnabled !== 'boolean') {
    return res.status(400).json({ error: 'Parametres manquants' });
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Configuration Supabase serveur manquante' });

  try {
    const access = await adminTargetProfile(req, supabase, String(userId));
    if (access.error) return res.status(access.status || 500).json({ error: access.error });

    const action = emailEnabled ? 'enabled' : 'disabled';
    const payload = {
      user_id: access.target.id,
      organization_id: access.target.organization_id ?? null,
      email_enabled: emailEnabled,
      email_admin_updated_at: new Date().toISOString(),
      email_admin_updated_by: access.actor.id,
      email_admin_action: action,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert(payload, { onConflict: 'user_id' })
      .select('user_id, organization_id, email_enabled, reserve_created_email, reserve_status_email, reserve_critical_email, reserve_overdue_email, email_admin_updated_at, email_admin_updated_by, email_admin_action')
      .single();
    if (error) throw error;
    return res.json({ ok: true, user: access.target, preferences: data });
  } catch (err) {
    console.error('[admin-notification-preferences] POST:', err.message);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

function emailPreferenceAllows(pref, column, critical = false) {
  if (!pref) return true;
  if (pref.email_enabled === false) return false;
  const criticalAllowed = critical && pref.reserve_critical_email !== false;
  if (pref[column] === false && !criticalAllowed) return false;
  return true;
}

async function shouldSendConfigurableEmail(type, email, body) {
  const columnByType = {
    'reserve-created': 'reserve_created_email',
    'reserve-status-changed': 'reserve_status_email',
    'reserve-overdue': 'reserve_overdue_email',
  };
  const column = columnByType[type];
  if (!column) return true;
  const supabase = getSupabaseAdmin();
  if (!supabase) return true;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return true;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (profileError || !profile?.id) return true;
  const { data: pref, error: prefError } = await supabase
    .from('notification_preferences')
    .select('email_enabled, reserve_created_email, reserve_status_email, reserve_critical_email, reserve_overdue_email')
    .eq('user_id', profile.id)
    .maybeSingle();
  if (prefError) {
    console.warn('[email prefs] lecture impossible:', prefError.message);
    return true;
  }
  return emailPreferenceAllows(pref, column, body?.priority === 'critical');
}

async function resolveEmailLanguage(recipientEmail, fallback = null) {
  const supabase = getSupabaseAdmin();
  const email = String(recipientEmail || '').trim().toLowerCase();
  if (!supabase || !email) return fallback;
  const { data, error } = await supabase
    .from('profiles')
    .select('preferred_language')
    .eq('email', email)
    .maybeSingle();
  if (error) {
    console.warn('[email language] lookup failed:', error.message);
    return fallback;
  }
  return data?.preferred_language ?? fallback;
}

function reserveEmailDedupe(type, body = {}) {
  const reserveId = body.reserveId ? String(body.reserveId) : null;
  if (!reserveId) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (type === 'reserve-created') {
    return { notificationType: type, reserveId, eventKey: `reserve-created:${reserveId}` };
  }
  if (type === 'reserve-status-changed') {
    const status = String(body.newStatus || 'unknown').toLowerCase();
    return { notificationType: type, reserveId, eventKey: `reserve-status-changed:${reserveId}:${status}:${today}` };
  }
  if (type === 'reserve-overdue') {
    const deadline = String(body.deadline || 'no-deadline').slice(0, 10);
    return { notificationType: type, reserveId, eventKey: `reserve-overdue:${reserveId}:${deadline}:${today}` };
  }
  return null;
}

async function shouldSendDedupedReserveEmail(type, email, body) {
  const dedupe = reserveEmailDedupe(type, body);
  if (!dedupe) return { allowed: true };

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return type === 'reserve-overdue'
      ? { allowed: false, reason: 'dedupe-admin-unavailable' }
      : { allowed: true, reason: 'dedupe-admin-unavailable' };
  }

  const log = await reserveEmailLogInsert(supabase, {
    type: dedupe.notificationType,
    recipientEmail: email,
    reserveId: dedupe.reserveId,
    eventKey: dedupe.eventKey,
    metadata: {
      source: 'send-email',
      status: body?.newStatus,
      deadline: body?.deadline,
      priority: body?.priority,
    },
  });

  if (log.duplicate) return { allowed: false, duplicate: true, reason: 'duplicate' };
  if (!log.inserted) {
    return type === 'reserve-overdue'
      ? { allowed: false, reason: 'dedupe-unavailable', error: log.error }
      : { allowed: true, reason: 'dedupe-unavailable', error: log.error };
  }
  return { allowed: true };
}

// Email notifications
app.post('/api/send-email', async (req, res) => {
  const { type, ...body } = req.body || {};
  if (!type) return res.status(400).json({ error: 'Type manquant' });
  const language = body.language ?? body.preferredLanguage ?? null;

  let template = null;
  let to = '';

  try {
    if (type === 'invitation') {
      const { email, invitedByName, organizationName, role, token, expiresAt, companyName } = body;
      if (!email || !invitedByName || !organizationName || !role || !token || !expiresAt)
        return res.status(400).json({ error: 'Paramètres manquants' });
      to = email; template = emailTemplates.invitationEmail({ email, invitedByName, organizationName, role, token, expiresAt, companyName, language: await resolveEmailLanguage(email, language) });
    } else if (type === 'welcome') {
      const { email, name, organizationName } = body;
      if (!email || !name) return res.status(400).json({ error: 'Paramètres manquants' });
      to = email; template = emailTemplates.welcomeEmail({ name, email, organizationName, language: await resolveEmailLanguage(email, language) });
    } else if (type === 'password-reset') {
      const { email, name, resetUrl } = body;
      if (!email || !name || !resetUrl) return res.status(400).json({ error: 'Paramètres manquants' });
      to = email; template = emailTemplates.passwordResetEmail({ name, resetUrl, language: await resolveEmailLanguage(email, language) });
    } else if (type === 'invitation-accepted') {
      const { adminEmail, adminName, inviteeName, inviteeEmail, organizationName, role } = body;
      if (!adminEmail || !adminName || !inviteeName || !inviteeEmail || !organizationName || !role)
        return res.status(400).json({ error: 'Paramètres manquants' });
      to = adminEmail; template = emailTemplates.invitationAcceptedEmail({ adminName, inviteeName, inviteeEmail, organizationName, role, language: await resolveEmailLanguage(adminEmail, language) });
    } else if (type === 'reserve-created') {
      const { email, recipientName, reserveTitle, reserveId, companyName, createdBy } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !companyName || !createdBy)
        return res.status(400).json({ error: 'Paramètres manquants' });
      {
        const resolvedLanguage = await resolveEmailLanguage(email, language);
        to = email; template = emailTemplates.reserveCreatedEmail({ ...body, language: resolvedLanguage, reserveUrl: buildReserveUrl(reserveId, email, resolvedLanguage) });
      }
    } else if (type === 'reserve-status-changed') {
      const { email, recipientName, reserveTitle, reserveId, newStatus, changedBy, companyName } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !newStatus || !changedBy || !companyName)
        return res.status(400).json({ error: 'Paramètres manquants' });
      {
        const resolvedLanguage = await resolveEmailLanguage(email, language);
        to = email; template = emailTemplates.reserveStatusChangedEmail({ ...body, language: resolvedLanguage, reserveUrl: buildReserveUrl(reserveId, email, resolvedLanguage) });
      }
    } else if (type === 'reserve-overdue') {
      if (!reserveOverdueEmailsEnabled()) {
        return res.json({ success: true, suppressed: true, reason: 'overdue-emails-disabled' });
      }
      const { email, recipientName, reserveTitle, reserveId, deadline, daysLate, companyName } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !deadline || daysLate == null || !companyName)
        return res.status(400).json({ error: 'Paramètres manquants' });
      {
        const resolvedLanguage = await resolveEmailLanguage(email, language);
        to = email; template = emailTemplates.reserveOverdueEmail({ ...body, language: resolvedLanguage, reserveUrl: buildReserveUrl(reserveId, email, resolvedLanguage) });
      }
    } else if (type === 'password-changed') {
      const { email, name } = body;
      if (!email || !name) return res.status(400).json({ error: 'Param?tres manquants' });
      to = email; template = emailTemplates.passwordChangedEmail({ name, language: await resolveEmailLanguage(email, language) });
    } else if (type === 'access-revoked') {
      const { email, name, organizationName } = body;
      if (!email || !name || !organizationName) return res.status(400).json({ error: 'Paramètres manquants' });
      to = email; template = emailTemplates.accessRevokedEmail({ name, organizationName, language: await resolveEmailLanguage(email, language) });
    } else {
      return res.status(400).json({ error: `Type inconnu: ${type}` });
    }

    const allowedByPreferences = await shouldSendConfigurableEmail(type, to, body);
    if (!allowedByPreferences) return res.json({ success: true, suppressed: true });

    const dedupeDecision = await shouldSendDedupedReserveEmail(type, to, body);
    if (!dedupeDecision.allowed) {
      return res.json({ success: true, suppressed: true, ...dedupeDecision });
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
      .from('profiles').select('name, preferred_language').eq('email', email.toLowerCase().trim()).limit(1);
    const name = profileRows?.[0]?.name ?? email.split('@')[0];
    const language = profileRows?.[0]?.preferred_language ?? null;

    const resetRedirect = `${APP_URL}/reset-password`;
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery', email: email.toLowerCase().trim(), options: { redirectTo: resetRedirect },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('[request-password-reset] generateLink error:', linkError?.message);
      return res.status(500).json({ error: linkError?.message || 'Impossible de générer le lien' });
    }

    const template = emailTemplates.passwordResetEmail({ name, resetUrl: linkData.properties.action_link, language });
    const result = await sendEmail({ to: email.toLowerCase().trim(), subject: template.subject, html: template.html });
    if (!result.success) return res.status(500).json({ error: result.error || "Échec de l'envoi" });
    return res.json({ success: true, simulated: result.simulated || false });
  } catch (err) {
    console.error('[request-password-reset] Exception:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/cron/overdue-reserves', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  const stats = { scanned: 0, notified: 0, emailsSent: 0, errors: 0 };

  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Non autorise' });
  }

  if (!reserveOverdueEmailsEnabled()) {
    return res.json({ ok: true, disabled: true, stats });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY manquant' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().split('T')[0];
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayISO = yesterday.toISOString().split('T')[0];
  const LIMIT = 7;

  try {
    const { data: reserves, error: rErr } = await supabase
      .from('reserves')
      .select('id, title, priority, status, deadline, companies, company, chantier_id, organization_id, overdue_last_notified_date, overdue_reminder_count')
      .not('status', 'in', '(closed,verification)')
      .not('deadline', 'is', null)
      .lt('deadline', todayISO);
    if (rErr) throw rErr;

    const list = reserves || [];
    stats.scanned = list.length;
    if (!list.length) return res.json({ ok: true, stats });

    const orgIds = [...new Set(list.map(r => r.organization_id).filter(Boolean))];
    const chantierIds = [...new Set(list.map(r => r.chantier_id).filter(Boolean))];
    const { data: companies } = await supabase
      .from('companies')
      .select('id, name, organization_id')
      .in('organization_id', orgIds.length ? orgIds : ['__none__']);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name, email, company_id, organization_id, role, preferred_language')
      .in('organization_id', orgIds.length ? orgIds : ['__none__']);
    const { data: chantiers } = chantierIds.length
      ? await supabase.from('chantiers').select('id, name').in('id', chantierIds)
      : { data: [] };
    const emailPrefsByUser = await preferencesForProfiles(supabase, (profiles || []).map(p => p.id));

    const companiesByOrg = new Map();
    for (const c of companies || []) {
      const a = companiesByOrg.get(c.organization_id) || [];
      a.push(c);
      companiesByOrg.set(c.organization_id, a);
    }

    const profilesByCompany = new Map();
    const adminsByOrg = new Map();
    for (const p of profiles || []) {
      if (!p.email) continue;
      if (p.company_id) {
        const a = profilesByCompany.get(p.company_id) || [];
        a.push(p);
        profilesByCompany.set(p.company_id, a);
      }
      if (p.role === 'admin' || p.role === 'super_admin') {
        const a = adminsByOrg.get(p.organization_id) || [];
        a.push(p);
        adminsByOrg.set(p.organization_id, a);
      }
    }

    const chantierName = new Map();
    for (const c of chantiers || []) chantierName.set(c.id, c.name);

    const digestsByEmail = new Map();
    const reserveUpdates = new Map();

    const addDigestRow = (profile, row) => {
      const email = String(profile?.email || '').trim().toLowerCase();
      if (!email) return false;
      let digest = digestsByEmail.get(email);
      if (!digest) {
        digest = { profile, rows: [] };
        digestsByEmail.set(email, digest);
      }
      if (!digest.rows.some(existing => existing.reserveId === row.reserveId)) {
        digest.rows.push(row);
      }
      return true;
    };

    for (const r of list) {
      try {
        if (r.overdue_last_notified_date === todayISO) continue;
        const reserveCompanyNames = r.companies || (r.company ? [r.company] : []);
        if (!reserveCompanyNames.length) continue;
        const orgCompanies = companiesByOrg.get(r.organization_id) || [];
        const matched = orgCompanies.filter(c =>
          reserveCompanyNames.some(n => sameName(n, c.name))
        );
        if (!matched.length) continue;

        const daysLate = Math.max(1, Math.round((today.getTime() - new Date(r.deadline).getTime()) / 86400000));
        const prevCount = typeof r.overdue_reminder_count === 'number' ? r.overdue_reminder_count : 0;
        const continuing = r.overdue_last_notified_date === yesterdayISO || r.overdue_last_notified_date === todayISO;
        const reminderCount = continuing ? prevCount : 0;
        const escalate = reminderCount >= LIMIT;
        let targetCount = 0;

        if (!escalate) {
          for (const company of matched) {
            for (const p of (profilesByCompany.get(company.id) || [])) {
              if (!emailPreferenceAllows(emailPrefsByUser.get(p.id), 'reserve_overdue_email', r.priority === 'critical')) continue;
              if (addDigestRow(p, {
                reserveId: r.id,
                reserveTitle: r.title || r.id,
                deadline: r.deadline,
                daysLate,
                priority: r.priority,
                companyName: company.name,
                chantierName: r.chantier_id ? chantierName.get(r.chantier_id) : undefined,
                reserveUrl: buildReserveUrl(r.id, p.email, p.preferred_language),
              })) targetCount += 1;
            }
          }
        } else {
          const admins = adminsByOrg.get(r.organization_id) || [];
          const companyNames = matched.map(c => c.name).join(', ');
          for (const a of admins) {
            if (!emailPreferenceAllows(emailPrefsByUser.get(a.id), 'reserve_overdue_email', r.priority === 'critical')) continue;
            if (addDigestRow(a, {
              reserveId: r.id,
              reserveTitle: r.title || r.id,
              deadline: r.deadline,
              daysLate,
              priority: r.priority,
              companyName: companyNames,
              chantierName: r.chantier_id ? chantierName.get(r.chantier_id) : undefined,
              reserveUrl: buildReserveUrl(r.id, a.email, a.preferred_language),
            })) targetCount += 1;
          }
        }

        if (targetCount > 0) {
          reserveUpdates.set(r.id, { nextCount: escalate ? reminderCount : reminderCount + 1 });
        }
      } catch (err) {
        stats.errors += 1;
        console.warn('[cron overdue digest] reserve', r.id, err.message);
      }
    }

    const sentReserveIds = new Set();
    for (const [email, digest] of digestsByEmail.entries()) {
      try {
        const log = await reserveEmailLogInsert(supabase, {
          type: 'reserve-overdue-digest',
          recipientEmail: email,
          eventKey: `overdue-digest:${todayISO}`,
          metadata: { reserveIds: digest.rows.map(row => row.reserveId) },
        });
        if (log.duplicate) continue;
        if (!log.inserted) {
          stats.errors += 1;
          continue;
        }

        const template = reserveOverdueDigestTemplate({
          recipientName: digest.profile.name || email,
          rows: digest.rows,
          language: digest.profile.preferred_language,
        });
        const sendRes = await sendEmail({ to: email, subject: template.subject, html: template.html });
        if (!sendRes.success) {
          stats.errors += 1;
          continue;
        }

        stats.emailsSent += 1;
        digest.rows.forEach(row => sentReserveIds.add(row.reserveId));
      } catch (err) {
        stats.errors += 1;
        console.warn('[cron overdue digest] recipient', email, err.message);
      }
    }

    for (const reserveId of sentReserveIds) {
      const update = reserveUpdates.get(reserveId);
      if (!update) continue;
      const { error: upErr } = await supabase
        .from('reserves')
        .update({
          overdue_last_notified_date: todayISO,
          overdue_reminder_count: update.nextCount,
        })
        .eq('id', reserveId);
      if (upErr) stats.errors += 1;
      else stats.notified += 1;
    }

    return res.json({ ok: true, stats });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stats });
  }
});

// Legacy implementation kept off the public cron path.
app.get('/api/cron/overdue-reserves-legacy-disabled', async (req, res) => {
  return res.status(410).json({ error: 'Route obsolete' });
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
    const { data: profiles } = await supabase.from('profiles').select('id, name, email, company_id, organization_id, role, preferred_language').in('organization_id', orgIds.length ? orgIds : ['__none__']);
    const { data: chantiers } = chantierIds.length ? await supabase.from('chantiers').select('id, name').in('id', chantierIds) : { data: [] };
    const emailPrefsByUser = await preferencesForProfiles(supabase, (profiles || []).map(p => p.id));

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
              if (!emailPreferenceAllows(emailPrefsByUser.get(p.id), 'reserve_overdue_email', r.priority === 'critical')) continue;
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
            if (!emailPreferenceAllows(emailPrefsByUser.get(a.id), 'reserve_overdue_email', r.priority === 'critical')) continue;
            const key = a.email.toLowerCase(); if (sentEmails.has(key)) continue; sentEmails.add(key);
            const tpl = reserveOverdueTemplate({ recipientName: a.name || a.email, reserveTitle: r.title, reserveId: r.id, deadline: r.deadline, daysLate, priority: r.priority, companyName: companyNames, chantierName: r.chantier_id ? chantierName.get(r.chantier_id) : undefined, reserveCode: r.id, reserveUrl: buildReserveUrl(r.id, a.email) });
            const sendRes = await sendEmail({ to: a.email, subject: tpl.subject, html: tpl.html });
            if (!sendRes.success) { stats.errors++; } else { stats.emailsSent++; sentForReserve++; }
          }
        }

        if (sentForReserve > 0) {
          const nextCount = escalate ? reminderCount : reminderCount + 1;
          const { error: upErr } = await supabase.from('reserves').update({ overdue_last_notified_date: todayISO, overdue_reminder_count: nextCount }).eq('id', r.id);
          if (upErr) { stats.errors++; } else { stats.notified++; }
        }
      } catch (err) { stats.errors++; console.warn('[cron overdue] reserve', r.id, err.message); }
    }
    return res.json({ ok: true, stats });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stats });
  }
});

// ── PDF generation helpers ────────────────────────────────────────────────────
function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUS_FR = { open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé' };
const STATUS_COLORS_PDF = { open: '#ef4444', in_progress: '#3b82f6', waiting: '#f59e0b', verification: '#8b5cf6', closed: '#22c55e' };
const PRIORITY_FR = { critical: 'Critique', high: 'Haute', medium: 'Moyenne', low: 'Basse' };
const PRIORITY_COLORS_PDF = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#22c55e' };

const PDF_LOCALES = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };
const PDF_STATUS = {
  fr: STATUS_FR,
  en: { open: 'Open', in_progress: 'In progress', waiting: 'Pending', verification: 'Verification', closed: 'Closed' },
  es: { open: 'Abierta', in_progress: 'En curso', waiting: 'En espera', verification: 'Verificacion', closed: 'Cerrada' },
};
const PDF_STATUS_FEMININE = {
  fr: { open: 'Ouverte', in_progress: 'En cours', waiting: 'En attente', verification: 'Verification', closed: 'Cloturee' },
  en: PDF_STATUS.en,
  es: PDF_STATUS.es,
};
const PDF_PRIORITY = {
  fr: PRIORITY_FR,
  en: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' },
  es: { critical: 'Critica', high: 'Alta', medium: 'Media', low: 'Baja' },
};
const PDF_COPY = {
  fr: {
    allCompanies: 'Toutes les entreprises',
    noValue: '—',
    noBuilding: 'Sans batiment',
    noPlan: 'Aucun plan associe',
    reportReserves: 'Rapport des reserves',
    reportPlans: 'Rapport des plans',
    reserveSheet: 'Fiche de reserve',
    generatedOn: 'Genere le',
    generatedBy: 'Genere par BuildTrack',
    confidential: 'Document confidentiel',
    totalReserves: 'Total reserves',
    companySummary: 'Recapitulatif par entreprise',
    detailedList: count => `Liste detaillee (${count} reserve${count !== 1 ? 's' : ''})`,
    reserveCount: count => `${count} reserve${count !== 1 ? 's' : ''}`,
    exportedCount: count => `${count} reserve${count !== 1 ? 's' : ''} exportee${count !== 1 ? 's' : ''}`,
    title: 'Titre',
    company: 'Entreprise',
    total: 'Total',
    closed: 'Cloturees',
    closureRate: 'Taux cloture',
    location: 'Localisation',
    building: 'Batiment',
    buildingShort: 'Bat.',
    level: 'Niveau',
    zone: 'Zone',
    status: 'Statut',
    priority: 'Priorite',
    deadline: 'Echeance',
    photos: 'Photos',
    history: 'Historique',
    date: 'Date',
    action: 'Action',
    author: 'Auteur',
    detail: 'Detail',
    createdOn: 'Cree le',
    closedOn: 'Cloture le',
    locationPlan: 'Plan de localisation',
    defect: 'Constat',
    resolved: 'Levee',
    manager: 'Conducteur de travaux',
    offPlan: 'Reserves hors plan',
    statusSummary: 'Synthese par statut',
    hello: 'Bonjour,',
    attachedReserve: title => `Veuillez trouver ci-joint la fiche de reserve <strong>${title}</strong>.`,
    attachedReport: (kind, chantier, company, date) => `Veuillez trouver ci-joint le rapport des ${kind} pour <strong>${chantier}</strong> (${company}), genere le ${date}.`,
    reservesKind: 'reserves',
    plansKind: 'plans',
  },
  en: {
    allCompanies: 'All companies',
    noValue: '—',
    noBuilding: 'No building',
    noPlan: 'No linked plan',
    reportReserves: 'Issues report',
    reportPlans: 'Plans report',
    reserveSheet: 'Issue sheet',
    generatedOn: 'Generated on',
    generatedBy: 'Generated by BuildTrack',
    confidential: 'Confidential document',
    totalReserves: 'Total issues',
    companySummary: 'Summary by company',
    detailedList: count => `Detailed list (${count} issue${count !== 1 ? 's' : ''})`,
    reserveCount: count => `${count} issue${count !== 1 ? 's' : ''}`,
    exportedCount: count => `${count} issue${count !== 1 ? 's' : ''} exported`,
    title: 'Title',
    company: 'Company',
    total: 'Total',
    closed: 'Closed',
    closureRate: 'Closure rate',
    location: 'Location',
    building: 'Building',
    buildingShort: 'Bldg.',
    level: 'Level',
    zone: 'Zone',
    status: 'Status',
    priority: 'Priority',
    deadline: 'Deadline',
    photos: 'Photos',
    history: 'History',
    date: 'Date',
    action: 'Action',
    author: 'Author',
    detail: 'Detail',
    createdOn: 'Created on',
    closedOn: 'Closed on',
    locationPlan: 'Location plan',
    defect: 'Issue',
    resolved: 'Resolved',
    manager: 'Construction manager',
    offPlan: 'Issues without plan',
    statusSummary: 'Status summary',
    hello: 'Hello,',
    attachedReserve: title => `Please find attached the issue sheet for <strong>${title}</strong>.`,
    attachedReport: (kind, chantier, company, date) => `Please find attached the ${kind} report for <strong>${chantier}</strong> (${company}), generated on ${date}.`,
    reservesKind: 'issues',
    plansKind: 'plans',
  },
  es: {
    allCompanies: 'Todas las empresas',
    noValue: '—',
    noBuilding: 'Sin edificio',
    noPlan: 'Sin plano asociado',
    reportReserves: 'Informe de reservas',
    reportPlans: 'Informe de planos',
    reserveSheet: 'Ficha de reserva',
    generatedOn: 'Generado el',
    generatedBy: 'Generado por BuildTrack',
    confidential: 'Documento confidencial',
    totalReserves: 'Total reservas',
    companySummary: 'Resumen por empresa',
    detailedList: count => `Lista detallada (${count} reserva${count !== 1 ? 's' : ''})`,
    reserveCount: count => `${count} reserva${count !== 1 ? 's' : ''}`,
    exportedCount: count => `${count} reserva${count !== 1 ? 's' : ''} exportada${count !== 1 ? 's' : ''}`,
    title: 'Titulo',
    company: 'Empresa',
    total: 'Total',
    closed: 'Cerradas',
    closureRate: 'Tasa de cierre',
    location: 'Localizacion',
    building: 'Edificio',
    buildingShort: 'Edif.',
    level: 'Nivel',
    zone: 'Zona',
    status: 'Estado',
    priority: 'Prioridad',
    deadline: 'Fecha limite',
    photos: 'Fotos',
    history: 'Historial',
    date: 'Fecha',
    action: 'Accion',
    author: 'Autor',
    detail: 'Detalle',
    createdOn: 'Creada el',
    closedOn: 'Cerrada el',
    locationPlan: 'Plano de localizacion',
    defect: 'Constatacion',
    resolved: 'Levantada',
    manager: 'Jefe de obra',
    offPlan: 'Reservas sin plano',
    statusSummary: 'Resumen por estado',
    hello: 'Hola,',
    attachedReserve: title => `Adjuntamos la ficha de reserva <strong>${title}</strong>.`,
    attachedReport: (kind, chantier, company, date) => `Adjuntamos el informe de ${kind} para <strong>${chantier}</strong> (${company}), generado el ${date}.`,
    reservesKind: 'reservas',
    plansKind: 'planos',
  },
};

function pdfLanguage(language) {
  const normalized = String(language ?? '').trim().toLowerCase();
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('es')) return 'es';
  return 'fr';
}

function pdfCopy(language) {
  return PDF_COPY[pdfLanguage(language)];
}

function pdfDate(value, language, options = { day: '2-digit', month: 'long', year: 'numeric' }) {
  return new Date(value || Date.now()).toLocaleDateString(PDF_LOCALES[pdfLanguage(language)], options);
}

function pdfStatusLabel(status, language, feminine = false) {
  const lang = pdfLanguage(language);
  return (feminine ? PDF_STATUS_FEMININE[lang] : PDF_STATUS[lang])[status] ?? status ?? PDF_COPY[lang].noValue;
}

function pdfPriorityLabel(priority, language) {
  const lang = pdfLanguage(language);
  return PDF_PRIORITY[lang][priority] ?? priority ?? PDF_COPY[lang].noValue;
}

function buildReserveRowSmall(r, idx, language = 'fr') {
  const copy = pdfCopy(language);
  const sc = STATUS_COLORS_PDF[r.status] ?? '#6b7280';
  const pc = PRIORITY_COLORS_PDF[r.priority] ?? '#6b7280';
  const bg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
  const companies = Array.isArray(r.companies) && r.companies.length > 0 ? r.companies : r.company ? [r.company] : [copy.noValue];
  return `<tr style="background:${bg}">
    <td style="text-align:center;width:36px;padding:6px 8px">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#003082;color:#fff;font-weight:700;font-size:10px">${idx + 1}</span>
    </td>
    <td style="padding:6px 8px;font-weight:600;font-size:11px">${escHtml(r.title)}</td>
    <td style="padding:6px 8px;font-size:11px">${companies.map(c => escHtml(c)).join(', ')}</td>
    <td style="padding:6px 8px;font-size:11px">${copy.buildingShort} ${escHtml(r.building || copy.noValue)} - ${escHtml(r.level || copy.noValue)}</td>
    <td style="padding:6px 8px"><span style="color:${sc};font-weight:600;font-size:10px">${pdfStatusLabel(r.status, language)}</span></td>
    <td style="padding:6px 8px"><span style="color:${pc};font-weight:600;font-size:10px">${pdfPriorityLabel(r.priority, language)}</span></td>
    <td style="padding:6px 8px;font-size:11px">${escHtml(r.deadline || copy.noValue)}</td>
  </tr>`;
}

function buildPhotoRow(photos) {
  if (!photos || photos.length === 0) return '';
  const imgs = photos.slice(0, 3).map(p =>
    `<img src="${escHtml(p.uri)}" style="width:130px;height:95px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0" onerror="this.style.opacity='0.1'"/>`
  ).join('');
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-top:1px solid #f1f5f9">${imgs}</div>`;
}

function buildGlobalReservesHtml(payload) {
  const { chantierName, companyFilter, generatedAt, reserves } = payload;
  const language = pdfLanguage(payload.language);
  const copy = pdfCopy(language);
  const dateStr = pdfDate(generatedAt, language);
  const companyLabel = companyFilter ?? copy.allCompanies;

  const byStatus = {};
  for (const r of reserves) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const total = reserves.length;

  const byCompany = {};
  for (const r of reserves) {
    const names = Array.isArray(r.companies) && r.companies.length > 0 ? r.companies : r.company ? [r.company] : ['—'];
    for (const n of names) {
      if (!byCompany[n]) byCompany[n] = { total: 0, closed: 0 };
      byCompany[n].total++;
      if (r.status === 'closed') byCompany[n].closed++;
    }
  }
  const companyRows = Object.entries(byCompany)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([co, st]) => {
      const rate = st.total > 0 ? Math.round((st.closed / st.total) * 100) : 0;
      const rateColor = rate >= 80 ? '#059669' : rate >= 50 ? '#D97706' : '#DC2626';
      return `<tr>
        <td style="padding:7px 12px;font-weight:600">${escHtml(co)}</td>
        <td style="padding:7px 12px;text-align:center">${st.total}</td>
        <td style="padding:7px 12px;text-align:center;color:#22c55e;font-weight:700">${st.closed}</td>
        <td style="padding:7px 12px;text-align:center">
          <span style="background:${rateColor}18;color:${rateColor};padding:2px 8px;border-radius:8px;font-weight:700;font-size:11px">${rate}%</span>
        </td>
      </tr>`;
    }).join('');

  const summaryStats = ['open','in_progress','waiting','verification','closed'].map(s => {
    const cnt = byStatus[s] ?? 0;
    if (!cnt) return '';
    const col = STATUS_COLORS_PDF[s];
    return `<div style="text-align:center;background:#f8fafc;border-radius:8px;padding:10px 16px;border:1px solid #e2e8f0;min-width:80px">
      <div style="font-size:22px;font-weight:800;color:${col}">${cnt}</div>
      <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-top:2px">${pdfStatusLabel(s, language)}</div>
    </div>`;
  }).join('');

  const reserveRows = [...reserves]
    .sort((a, b) => {
      const ORDER = { open: 0, in_progress: 1, waiting: 2, verification: 3, closed: 4 };
      return (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9);
    })
    .map((r, i) => buildReserveRowSmall(r, i, language)).join('');

  const photoSection = reserves.filter(r => r.photos && r.photos.length > 0).slice(0, 20).map((r, i) => {
    const companies = Array.isArray(r.companies) && r.companies.length > 0 ? r.companies : r.company ? [r.company] : [];
    return `<div style="margin-bottom:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <div style="background:#f8fafc;padding:8px 12px;font-size:11px;font-weight:700;color:#1e293b;border-bottom:1px solid #e2e8f0">
        <span style="color:#003082">#${i+1}</span> ${escHtml(r.title)}
        <span style="color:#94a3b8;font-weight:400;margin-left:8px">— ${companies.map(c=>escHtml(c)).join(', ') || '—'} · Bât. ${escHtml(r.building||'?')}</span>
      </div>
      ${buildPhotoRow(r.photos)}
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <title>${copy.reportReserves} - ${escHtml(chantierName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #fff; color: #1e293b; font-size: 12px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif; }
    @page { margin: 15mm 12mm; size: A4; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
  </style>
</head>
<body>
  <div style="background:linear-gradient(135deg,#003082 0%,#1A6FD8 100%);color:#fff;padding:24px 28px;border-radius:8px;margin-bottom:20px">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.75;margin-bottom:4px">BuildTrack · ${copy.reportReserves}</div>
    <div style="font-size:22px;font-weight:800;margin-bottom:2px">${escHtml(chantierName)}</div>
    <div style="font-size:13px;opacity:0.8">${escHtml(companyLabel)} - ${copy.generatedOn} ${dateStr}</div>
  </div>

  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
    <div style="text-align:center;background:#f8fafc;border-radius:8px;padding:10px 20px;border:1px solid #e2e8f0">
      <div style="font-size:28px;font-weight:800;color:#003082">${total}</div>
      <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-top:2px">${copy.totalReserves}</div>
    </div>
    ${summaryStats}
  </div>

  <div style="margin-bottom:20px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:10px">${copy.companySummary}</div>
    <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#003082">
        <th style="color:#fff;padding:8px 12px;text-align:left;font-size:10px">${copy.company}</th>
        <th style="color:#fff;padding:8px 12px;text-align:center;font-size:10px">${copy.total}</th>
        <th style="color:#fff;padding:8px 12px;text-align:center;font-size:10px">${copy.closed}</th>
        <th style="color:#fff;padding:8px 12px;text-align:center;font-size:10px">${copy.closureRate}</th>
      </tr></thead>
      <tbody>${companyRows}</tbody>
    </table>
  </div>

  <div style="margin-bottom:20px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:10px">
      ${copy.detailedList(total)}
    </div>
    <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#003082">
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">#</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.title}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.company}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.location}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.status}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.priority}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.deadline}</th>
      </tr></thead>
      <tbody>${reserveRows}</tbody>
    </table>
  </div>

  ${photoSection ? `<div style="margin-bottom:20px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:10px">${copy.photos}</div>
    ${photoSection}
  </div>` : ''}

  <div style="margin-top:24px;padding-top:12px;border-top:1.5px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8">
    <span>${copy.generatedBy}</span>
    <span>${escHtml(chantierName)} - ${dateStr}</span>
  </div>
</body>
</html>`;
}

function buildIndividualReserveHtml(payload) {
  const { reserve, chantierName, companyColor, planUri, planX, planY, planName, pinNum } = payload;
  const language = pdfLanguage(payload.language);
  const copy = pdfCopy(language);
  const sColors = { open: '#DC2626', in_progress: '#F59E0B', waiting: '#3B82F6', verification: '#8B5CF6', closed: '#059669' };
  const sLabels = { open: 'Ouverte', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturée' };
  const pColors = { low: '#22C55E', medium: '#F59E0B', high: '#F97316', critical: '#EF4444' };
  const pLabels = { low: 'Faible', medium: 'Moyenne', high: 'Haute', critical: 'Critique' };
  const pinColor = companyColor || '#003082';
  const sColor = sColors[reserve.status] ?? '#6B7280';
  const sLabel = pdfStatusLabel(reserve.status, language, true);
  const pColor = pColors[reserve.priority] ?? '#6B7280';
  const pLabel = pdfPriorityLabel(reserve.priority, language);
  const companies = Array.isArray(reserve.companies) && reserve.companies.length > 0 ? reserve.companies : reserve.company ? [reserve.company] : [];
  const dateStr = pdfDate(Date.now(), language);

  let planSection = '';
  if (planUri && planX != null && planY != null) {
    const PIN_R = 2.2;
    const PIN_FONT = 3.5;
    const PIN_STROKE = 0.55;
    const svgPin = `<circle cx="${planX}" cy="${planY}" r="${PIN_R}" fill="${pinColor}" stroke="#fff" stroke-width="${PIN_STROKE}"/>
      <text x="${planX}" y="${planY}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="${PIN_FONT}" font-weight="bold" font-family="Arial,sans-serif">${pinNum || 1}</text>`;
    planSection = `
      <div style="margin-bottom:10px">
        <div style="font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #DDE4EE">${copy.locationPlan} - ${escHtml(planName || 'Plan')}</div>
        <div style="position:relative;border-radius:8px;overflow:hidden;border:1.5px solid #DDE4EE">
          <img src="${escHtml(planUri)}" style="width:100%;height:auto;display:block" onerror="this.style.display='none'"/>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;top:0;left:0;width:100%;height:100%">${svgPin}</svg>
        </div>
      </div>`;
  } else {
    planSection = `<div style="width:100%;height:100px;border-radius:8px;border:1.5px dashed #DDE4EE;background:#F9FAFB;display:flex;align-items:center;justify-content:center;margin-bottom:10px;font-size:11px;color:#9CA3AF">${copy.noPlan}</div>`;
  }

  const rawPhotos = Array.isArray(reserve.photos) && reserve.photos.length > 0
    ? reserve.photos
    : reserve.photoUri ? [{ uri: reserve.photoUri, kind: 'defect' }] : [];
  const photosToShow = rawPhotos.slice(0, 3).filter(p => p.uri && p.uri.startsWith('http'));

  const photoRowHtml = photosToShow.length > 0 ? `
    <div style="margin-top:10px">
      <div style="font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #DDE4EE">${copy.photos} (${photosToShow.length})</div>
      <div style="display:flex;gap:8px">
        ${photosToShow.map(p => {
          const isDefect = p.kind === 'defect';
          return `<div style="flex:1;min-width:0;text-align:center">
            <img src="${escHtml(p.uri)}" onerror="this.style.opacity='0.15'"
              style="width:100%;height:auto;max-height:240px;object-fit:contain;background:#F9FAFB;border-radius:6px;border:1.5px solid #DDE4EE;display:block"/>
            <span style="display:inline-block;margin-top:4px;padding:1px 7px;border-radius:8px;font-size:9px;font-weight:700;background:${isDefect ? '#FEF2F2' : '#ECFDF5'};color:${isDefect ? '#DC2626' : '#059669'}">
              ${isDefect ? copy.defect : copy.resolved}
            </span>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const historyRows = [...(reserve.history || [])].reverse().slice(0, 5).map(h =>
    `<tr>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;white-space:nowrap">${escHtml(h.createdAt)}</td>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;font-weight:600">${escHtml(h.action)}</td>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;color:#6B7280">${escHtml(h.author)}</td>
      ${h.oldValue && h.newValue ? `<td style="padding:4px 8px;font-size:9px;color:#6B7280;border-bottom:1px solid #EEF3FA">${escHtml(h.oldValue)} → ${escHtml(h.newValue)}</td>` : '<td></td>'}
    </tr>`
  ).join('');

  return `<!DOCTYPE html><html lang="${language}"><head><meta charset="UTF-8">
  <title>${copy.reserveSheet} ${escHtml(reserve.id)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #1A2742; font-size: 11px; line-height: 1.4; }
    @page { size: A4 portrait; margin: 10mm 12mm; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    .container { padding: 0; max-width: 780px; margin: 0 auto; }
    .top-bar { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #003082; padding-bottom: 10px; margin-bottom: 10px; }
    .badge { display: inline-block; padding: 2px 9px; border-radius: 10px; font-size: 9px; font-weight: 700; }
    .col2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
    .info-cell { background: #F4F7FB; border-radius: 6px; padding: 7px 10px; border: 1px solid #DDE4EE; }
    .lbl { font-size: 8px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 2px; }
    .val { font-size: 11px; color: #1A2742; font-weight: 600; }
    .desc-box { background: #F4F7FB; border-radius: 6px; padding: 8px 12px; border-left: 3px solid #003082; margin-bottom: 10px; font-size: 11px; line-height: 1.5; }
    .sh { font-size: 9px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.6px; padding-bottom: 4px; border-bottom: 1px solid #DDE4EE; margin-bottom: 6px; margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    thead th { background: #003082; color: #fff; padding: 5px 8px; text-align: left; font-size: 9px; text-transform: uppercase; }
    tbody td { padding: 4px 8px; border-bottom: 1px solid #EEF3FA; vertical-align: top; }
    tbody tr:nth-child(even) { background: #F9FAFB; }
    .doc-footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #DDE4EE; display: flex; justify-content: space-between; font-size: 8px; color: #9CA3AF; }
  </style></head>
  <body><div class="container">
    <div class="top-bar">
      <div>
        <div style="font-size:8px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">${copy.reserveSheet} · BuildTrack</div>
        <div style="font-size:22px;font-weight:900;color:#003082;line-height:1">${escHtml(reserve.id)}</div>
        <div style="font-size:14px;font-weight:700;color:#1A2742;margin-top:2px">${escHtml(reserve.title)}</div>
        <div style="font-size:10px;color:#6B7280">${escHtml(chantierName)}</div>
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap">
          <span class="badge" style="background:${sColor}22;color:${sColor}">${sLabel}</span>
          <span class="badge" style="background:${pColor}18;color:${pColor}">${pLabel}</span>
        </div>
      </div>
      <div style="text-align:right;font-size:10px;color:#6B7280;flex-shrink:0;margin-left:16px">
        <div>${copy.createdOn} <strong style="color:#1A2742">${escHtml(reserve.createdAt || copy.noValue)}</strong></div>
        ${reserve.closedAt ? `<div style="color:#059669;margin-top:2px;font-weight:700">${copy.closedOn} ${escHtml(reserve.closedAt)}</div>` : ''}
        <div style="margin-top:4px">${copy.deadline} : <strong>${escHtml(reserve.deadline || copy.noValue)}</strong></div>
        <div style="font-size:9px;color:#9CA3AF;margin-top:4px">${dateStr}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        <div class="col2" style="margin-bottom:8px">
          <div class="info-cell">
            <div class="lbl">${copy.company}${companies.length > 1 && language === 'fr' ? 's' : ''}</div>
            <div class="val" style="color:${pinColor}">${companies.map(c => escHtml(c)).join(', ') || copy.noValue}</div>
          </div>
          <div class="info-cell">
            <div class="lbl">${copy.location}</div>
            <div class="val">${copy.buildingShort} ${escHtml(reserve.building || copy.noValue)} - ${escHtml(reserve.level || copy.noValue)}</div>
          </div>
        </div>
        <div class="col2" style="margin-bottom:8px">
          <div class="info-cell">
            <div class="lbl">${copy.zone}</div>
            <div class="val">${escHtml(reserve.zone || copy.noValue)}</div>
          </div>
          <div class="info-cell">
            <div class="lbl">${copy.deadline}</div>
            <div class="val" style="color:${reserve.status !== 'closed' ? '#DC2626' : '#059669'}">${escHtml(reserve.deadline || copy.noValue)}</div>
          </div>
        </div>
        ${reserve.description ? `<div class="desc-box">${escHtml(reserve.description)}</div>` : ''}
        ${photoRowHtml}
      </div>
      <div>${planSection}</div>
    </div>

    ${historyRows ? `<div class="sh">${copy.history}</div>
    <table><thead><tr><th>${copy.date}</th><th>${copy.action}</th><th>${copy.author}</th><th>${copy.detail}</th></tr></thead>
    <tbody>${historyRows}</tbody></table>` : ''}

    <div style="margin-top:16px;display:flex;gap:20px">
      <div style="flex:1;text-align:center"><div style="height:50px;border-bottom:2px solid #1A2742;margin-bottom:5px"></div><div style="font-size:10px;color:#5E738A">${copy.manager}</div></div>
      <div style="flex:1;text-align:center"><div style="height:50px;border-bottom:2px solid #1A2742;margin-bottom:5px"></div><div style="font-size:10px;color:#5E738A">${companies.map(c => escHtml(c)).join(', ') || copy.company}</div></div>
    </div>

    <div class="doc-footer">
      <span>${copy.reserveSheet} - BuildTrack</span>
      <span>${escHtml(chantierName)} · ${dateStr}</span>
    </div>
  </div></body></html>`;
}

function buildGlobalPlansReportHtml(payload) {
  const { chantierName, companyFilter, generatedAt, plans, reserves } = payload;
  const language = pdfLanguage(payload.language);
  const copy = pdfCopy(language);
  const dateStr = pdfDate(generatedAt, language);
  const companyLabel = companyFilter ?? copy.allCompanies;

  const reservesByPlan = new Map();
  const orphanReserves = [];
  for (const r of reserves) {
    if (!r.planId) { orphanReserves.push(r); }
    else {
      if (!reservesByPlan.has(r.planId)) reservesByPlan.set(r.planId, []);
      reservesByPlan.get(r.planId).push(r);
    }
  }
  const activePlanIds = new Set(reservesByPlan.keys());
  const plansWithReserves = plans.filter(p => activePlanIds.has(p.id));

  const buildingSet = new Set();
  for (const p of plansWithReserves) buildingSet.add(p.building ?? '');
  const buildingNames = Array.from(buildingSet).sort((a, b) => {
    if (!a && !b) return 0; if (!a) return 1; if (!b) return -1;
    return a.localeCompare(b, language);
  });

  const buildingSections = [];
  for (const building of buildingNames) {
    const buildingPlans = plansWithReserves.filter(p => (p.building ?? '') === building);
    const buildingLabel = building || copy.noBuilding;
    const planBlocks = [];
    let buildingReserveCount = 0;
    for (const plan of buildingPlans) {
      const planReserves = reservesByPlan.get(plan.id) ?? [];
      if (planReserves.length === 0) continue;
      buildingReserveCount += planReserves.length;
      const levelBadge = plan.level ? `<span style="font-size:11px;background:#e2e8f0;color:#64748b;padding:2px 8px;border-radius:10px;margin-left:8px">${escHtml(plan.level)}</span>` : '';
      let planImgHtml = '';
      if (plan.uri && plan.fileType !== 'pdf' && plan.fileType !== 'dxf') {
        const pinsWithCoords = planReserves.filter(r => r.planX != null && r.planY != null);
        const circles = pinsWithCoords.map((r, i) =>
          `<circle cx="${r.planX}%" cy="${r.planY}%" r="10" fill="#003082" stroke="rgba(255,255,255,0.85)" stroke-width="1.5"/>
          <text x="${r.planX}%" y="${r.planY}%" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="9" font-weight="bold" font-family="Arial,sans-serif">${i + 1}</text>`
        ).join('');
        planImgHtml = `<div style="position:relative;width:100%;margin:12px 0">
          <img src="${escHtml(plan.uri)}" style="width:100%;height:auto;display:block;border-radius:6px;border:1px solid #e2e8f0" onerror="this.style.display='none'"/>
          ${circles ? `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible">${circles}</svg>` : ''}
        </div>`;
      }
      const rows = planReserves.map((r, i) => {
        const sc = STATUS_COLORS_PDF[r.status] ?? '#6b7280';
        const pc = PRIORITY_COLORS_PDF[r.priority] ?? '#6b7280';
        const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
        return `<tr style="background:${bg}">
          <td style="text-align:center;width:36px;padding:7px 10px"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#003082;color:#fff;font-weight:700;font-size:11px">${i+1}</span></td>
          <td style="padding:7px 10px;font-weight:600">${escHtml(r.title)}</td>
          <td style="padding:7px 10px">${escHtml(r.company) || '—'}</td>
          <td style="padding:7px 10px">${escHtml(r.level) || '—'}</td>
          <td style="padding:7px 10px"><span style="color:${sc};font-weight:600">${pdfStatusLabel(r.status, language)}</span></td>
          <td style="padding:7px 10px"><span style="color:${pc};font-weight:600">${pdfPriorityLabel(r.priority, language)}</span></td>
          <td style="padding:7px 10px">${escHtml(r.deadline) || '—'}</td>
        </tr>`;
      }).join('');
      const photoBlocks = planReserves.filter(r => r.photos && r.photos.length > 0).map((r, i) => {
        const imgs = r.photos.slice(0, 2).map(p => `<img src="${escHtml(p.uri)}" style="width:130px;height:95px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0" onerror="this.style.opacity='0.15'"/>`).join('');
        return `<div style="padding:8px 12px;border-bottom:1px solid #f1f5f9"><div style="font-size:10px;color:#64748b;margin-bottom:5px;font-weight:600">#${i+1} ${escHtml(r.title)}</div><div style="display:flex;gap:8px;flex-wrap:wrap">${imgs}</div></div>`;
      }).join('');
      planBlocks.push(`<div style="background:#fff;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:14px;overflow:hidden">
        <div style="background:#f8fafc;padding:10px 16px;font-size:12px;font-weight:700;color:#1e293b;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:6px">
          📐 ${escHtml(plan.name)}${levelBadge}
          <span style="margin-left:auto;font-size:11px;color:#94a3b8;font-weight:400">${copy.reserveCount(planReserves.length)}</span>
        </div>
        ${planImgHtml ? `<div style="padding:12px 16px">${planImgHtml}</div>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:#003082">
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">#</th>
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.title}</th>
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.company}</th>
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.level}</th>
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.status}</th>
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.priority}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.deadline}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${photoBlocks ? `<div style="background:#f8fafc;padding:8px 12px;font-size:10px;font-weight:700;color:#475569;border-top:1px solid #e2e8f0">${copy.photos}</div>${photoBlocks}` : ''}
      </div>`);
    }
    if (buildingReserveCount === 0) continue;
    buildingSections.push(`<div style="margin-bottom:24px;page-break-inside:avoid">
      <div style="background:linear-gradient(135deg,#003082 0%,#1A6FD8 100%);color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:10px">
        🏗️ ${escHtml(buildingLabel)}
        <span style="margin-left:auto;font-size:12px;opacity:0.8;font-weight:400">${copy.reserveCount(buildingReserveCount)}</span>
      </div>
      ${planBlocks.join('')}
    </div>`);
  }

  let orphanHtml = '';
  if (orphanReserves.length > 0) {
    const orphanRows = orphanReserves.map((r, i) => {
      const sc = STATUS_COLORS_PDF[r.status] ?? '#6b7280';
      const pc = PRIORITY_COLORS_PDF[r.priority] ?? '#6b7280';
      const bg = i % 2 === 0 ? '#fff' : '#f9fafb';
      return `<tr style="background:${bg}">
        <td style="text-align:center;width:36px;padding:7px 10px"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#475569;color:#fff;font-weight:700;font-size:11px">${i+1}</span></td>
        <td style="padding:7px 10px;font-weight:600">${escHtml(r.title)}</td>
        <td style="padding:7px 10px">${escHtml(r.company) || '—'}</td>
        <td style="padding:7px 10px">${escHtml(r.building) || '—'}</td>
        <td style="padding:7px 10px">${escHtml(r.level) || '—'}</td>
        <td style="padding:7px 10px"><span style="color:${sc};font-weight:600">${pdfStatusLabel(r.status, language)}</span></td>
        <td style="padding:7px 10px"><span style="color:${pc};font-weight:600">${pdfPriorityLabel(r.priority, language)}</span></td>
        <td style="padding:7px 10px">${escHtml(r.deadline) || '—'}</td>
      </tr>`;
    }).join('');
    orphanHtml = `<div style="margin-bottom:24px">
      <div style="background:linear-gradient(135deg,#475569 0%,#64748b 100%);color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:10px">
        ${copy.offPlan}
        <span style="margin-left:auto;font-size:12px;opacity:0.8;font-weight:400">${copy.reserveCount(orphanReserves.length)}</span>
      </div>
      <div style="background:#fff;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:#475569">
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">#</th>
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.title}</th>
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.company}</th>
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.building}</th>
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.level}</th>
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.status}</th>
            <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.priority}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.deadline}</th>
          </tr></thead>
          <tbody>${orphanRows}</tbody>
        </table>
      </div>
    </div>`;
  }

  const totalReserves = reserves.length;
  const byStatus = new Map();
  for (const r of reserves) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const summaryRows = ['open','in_progress','waiting','verification','closed'].map(s => {
    const count = byStatus.get(s) ?? 0;
    if (!count) return '';
    const color = STATUS_COLORS_PDF[s];
    const pct = totalReserves > 0 ? Math.round((count / totalReserves) * 100) : 0;
    return `<tr>
      <td style="padding:8px 12px"><span style="color:${color};font-weight:600">${pdfStatusLabel(s, language)}</span></td>
      <td style="padding:8px 12px;text-align:right;font-weight:700">${count}</td>
      <td style="padding:8px 12px;text-align:right;color:#94a3b8">${pct}%</td>
      <td style="padding:8px 12px;width:40%"><div style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden"><div style="background:${color};height:8px;width:${pct}%"></div></div></td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
  <html lang="${language}">
<head>
  <meta charset="UTF-8">
  <title>${copy.reportPlans} - ${escHtml(chantierName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #fff; color: #1e293b; font-size: 12px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif; }
    @page { margin: 15mm 12mm; size: A4; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .cover { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; text-align: center; padding: 60px 40px; page-break-after: always; }
  </style>
</head>
<body>
  <div class="cover">
    <div style="font-size:48px;margin-bottom:20px">📋</div>
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#003082;font-weight:700;margin-bottom:12px">BuildTrack</div>
    <div style="font-size:28px;font-weight:800;color:#1e293b;margin-bottom:8px">${copy.reportPlans}</div>
    <div style="font-size:18px;color:#64748b;margin-bottom:6px">${escHtml(chantierName)}</div>
    <div style="font-size:14px;color:#94a3b8;margin-bottom:32px">${escHtml(companyLabel)}</div>
    <div style="display:flex;gap:40px;margin:16px 0">
      <div style="text-align:center"><div style="font-size:40px;font-weight:800;color:#003082">${totalReserves}</div><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:4px">${copy.totalReserves}</div></div>
    </div>
    <div style="margin-top:20px;padding:12px 24px;background:#f0f4ff;border-radius:8px;border:1px solid #c7d2fe;font-size:11px;color:#475569">${copy.generatedOn} ${dateStr}</div>
  </div>
  <div style="padding:20px 24px">
    ${buildingSections.join('\n')}
    ${orphanHtml}
    ${summaryRows ? `<div style="margin-top:32px;page-break-before:auto">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:12px">${copy.statusSummary}</div>
      <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden"><tbody>${summaryRows}</tbody></table>
    </div>` : ''}
    <div style="margin-top:32px;padding-top:14px;border-top:1.5px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8">
      <span>${copy.generatedBy} - ${escHtml(chantierName)}</span>
      <span>${copy.confidential} - ${dateStr}</span>
    </div>
  </div>
</body>
</html>`;
}

// ── POST /api/generate-pdf ────────────────────────────────────────────────────
app.post('/api/generate-pdf', async (req, res) => {
  let browser;
  try {
    const payload = req.body || {};
    const type = payload.type || 'plans';

    let html;
    if (type === 'global_reserves') {
      if (!payload.chantierName || !Array.isArray(payload.reserves))
        return res.status(400).json({ success: false, error: 'Payload invalide (global_reserves)' });
      html = buildGlobalReservesHtml(payload);
    } else if (type === 'individual_reserve') {
      if (!payload.reserve || !payload.chantierName)
        return res.status(400).json({ success: false, error: 'Payload invalide (individual_reserve)' });
      html = buildIndividualReserveHtml(payload);
    } else {
      if (!payload.chantierName || !Array.isArray(payload.reserves))
        return res.status(400).json({ success: false, error: 'Payload invalide (plans)' });
      html = buildGlobalPlansReportHtml(payload);
    }

    let puppeteer;
    try {
      puppeteer = require('puppeteer');
    } catch (e) {
      console.error('[generate-pdf] puppeteer not available:', e.message);
      return res.status(503).json({ success: false, error: 'Puppeteer non disponible' });
    }

    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      headless: true,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
    });

    await browser.close();
    browser = null;

    if (payload.sendByEmail && Array.isArray(payload.recipients) && payload.recipients.length > 0) {
      const language = pdfLanguage(payload.language);
      const copy = pdfCopy(language);
      const dateStr = pdfDate(payload.generatedAt || Date.now(), language);
      const companyLabel = payload.companyFilter ?? copy.allCompanies;
      let filename, subject, emailHtml;

      if (type === 'individual_reserve') {
        const r = payload.reserve;
        filename = buildPdfFilename('Reserve', [r.id || 'reserve', r.title, payload.chantierName]);
        subject = `${copy.reserveSheet} - ${r.title || r.id} (${payload.chantierName})`;
        const sLabel = pdfStatusLabel(r.status, language, true);
        emailHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
          <div style="background:#003082;padding:24px 32px;border-radius:8px 8px 0 0">
            <div style="color:#fff;font-size:20px;font-weight:700">${copy.reserveSheet}</div>
            <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px">${escHtml(payload.chantierName)}</div>
          </div>
          <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
            <p style="margin:0 0 16px 0">${copy.hello}</p>
            <p style="margin:0 0 16px 0">${copy.attachedReserve(escHtml(r.title || r.id))}</p>
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0">
              <div style="font-size:13px;color:#64748b">${copy.status} : <strong>${escHtml(sLabel)}</strong></div>
              <div style="font-size:13px;color:#64748b;margin-top:4px">${copy.building} : <strong>${escHtml(r.building || copy.noValue)}</strong> - ${copy.level} : <strong>${escHtml(r.level || copy.noValue)}</strong></div>
            </div>
            <p style="margin:16px 0 0 0;color:#64748b;font-size:12px">BuildTrack</p>
          </div>
        </div>`;
      } else {
        const companyPart = companyLabel === copy.allCompanies ? null : companyLabel;
        filename = buildPdfFilename(type === 'global_reserves' ? 'Rapport_Reserves' : 'Rapport_Plans', [
          payload.chantierName,
          companyPart,
        ]);
        const count = Array.isArray(payload.reserves) ? payload.reserves.length : 0;
        const reportKind = type === 'global_reserves' ? copy.reservesKind : copy.plansKind;
        const reportTitle = type === 'global_reserves' ? copy.reportReserves : copy.reportPlans;
        subject = `${reportTitle} - ${payload.chantierName} (${companyLabel})`;
        emailHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
          <div style="background:#003082;padding:24px 32px;border-radius:8px 8px 0 0">
            <div style="color:#fff;font-size:20px;font-weight:700">${reportTitle}</div>
            <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px">${escHtml(payload.chantierName)} - ${escHtml(companyLabel)}</div>
          </div>
          <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
            <p style="margin:0 0 16px 0">${copy.hello}</p>
            <p style="margin:0 0 16px 0">${copy.attachedReport(escHtml(reportKind), escHtml(payload.chantierName), escHtml(companyLabel), dateStr)}</p>
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
              <div style="font-size:32px;font-weight:800;color:#003082">${count}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">${copy.exportedCount(count)}</div>
            </div>
            <p style="margin:16px 0 0 0;color:#64748b;font-size:12px">BuildTrack</p>
          </div>
        </div>`;
      }

      await Promise.allSettled(
        payload.recipients.map(to => sendEmail({
          to,
          subject,
          html: emailHtml,
          attachments: [{ filename, content: Buffer.from(pdfBuffer), contentType: 'application/pdf' }],
        }))
      );
    }

    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
    return res.json({ success: true, pdfBase64 });
  } catch (err) {
    if (browser) { try { await browser.close(); } catch (_) {} }
    console.error('[generate-pdf] Erreur:', err?.message ?? err);
    return res.status(500).json({ success: false, error: err?.message ?? 'Erreur serveur' });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[BuildTrack API] Server running on port ${PORT}`);
});
