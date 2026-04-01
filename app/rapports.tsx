import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { C } from '@/constants/colors';
import { exportPDF as exportPDFHelper, PDF_BASE_CSS } from '@/lib/pdfBase';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useIncidents } from '@/context/IncidentsContext';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';

function buildDailyHTML(reserves: any[], companies: any[], tasks: any[], incidents: any[], stats: any, userName: string, projectName: string): string {
  const now = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const today = new Date().toLocaleDateString('fr-FR');
  const docRef = `RJ-${today.replace(/\//g, '')}`;

  const severityLabels: Record<string, string> = { minor: 'Mineur', moderate: 'Modéré', major: 'Majeur', critical: 'Critique' };
  const severityColors: Record<string, string> = { minor: '#6B7280', moderate: '#F59E0B', major: '#EF4444', critical: '#7F1D1D' };
  const incidentStatusLabels: Record<string, string> = { open: 'Ouvert', investigating: 'En cours', resolved: 'Résolu' };
  const statusLabels: Record<string, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'Attente', verification: 'Vérif.', closed: 'Clôturé' };
  const statusColors: Record<string, string> = { open: '#DC2626', in_progress: '#D97706', waiting: '#6B7280', verification: '#7C3AED', closed: '#059669' };
  const priorityLabels: Record<string, string> = { low: 'Basse', medium: 'Moyenne', high: 'Haute', critical: 'Critique' };
  const pColor: Record<string, string> = { low: '#6B7280', medium: '#F59E0B', high: '#EF4444', critical: '#7C3AED' };
  const openIncidents = incidents.filter((i: any) => i.status !== 'resolved');
  const activeReserves = reserves.filter((r: any) => r.status !== 'closed');

  const personnelRows = companies.map((c: any) =>
    `<tr><td>${c.name}</td><td style="text-align:center;font-weight:700">${c.actualWorkers}</td><td style="text-align:center">${c.plannedWorkers}</td><td style="text-align:center;color:${c.actualWorkers >= c.plannedWorkers ? '#059669' : '#DC2626'}">${c.actualWorkers >= c.plannedWorkers ? '✓' : '↓'}</td></tr>`
  ).join('');
  const taskRows = tasks.filter((t: any) => t.status === 'in_progress').map((t: any) =>
    `<tr><td>${t.title}</td><td>${t.assignee}</td><td style="text-align:center">
      <div style="background:#E8F0FE;border-radius:4px;height:8px;width:100%;margin-bottom:3px"><div style="background:#003082;height:8px;border-radius:4px;width:${t.progress}%"></div></div>
      <span style="font-size:10px;color:#003082;font-weight:700">${t.progress}%</span>
    </td><td>${t.deadline}</td></tr>`
  ).join('');
  const incidentRows = openIncidents.map((i: any) =>
    `<tr>
      <td><span style="color:${severityColors[i.severity] || '#000'};font-weight:700">${severityLabels[i.severity] || i.severity}</span></td>
      <td>${i.title}</td><td>Bât. ${i.building} — ${i.location}</td>
      <td>${incidentStatusLabels[i.status] || i.status}</td>
      <td>${i.reportedAt}</td><td>${i.reportedBy}</td>
    </tr>`
  ).join('');
  const reserveRows = activeReserves.map((r: any) =>
    `<tr>
      <td style="font-weight:700;font-size:10px">${r.id}</td>
      <td>${r.title}</td>
      <td>Bât. ${r.building} — ${r.level}</td>
      <td>${r.company}</td>
      <td><span style="color:${pColor[r.priority] || '#000'};font-weight:700">${priorityLabels[r.priority] || r.priority}</span></td>
      <td><span style="color:${statusColors[r.status] || '#000'}">${statusLabels[r.status] || r.status}</span></td>
      <td>${r.deadline}</td>
    </tr>`
  ).join('');

  const progressBarHtml = `
    <div style="background:#E8F0FE;border-radius:6px;height:14px;margin:10px 0 4px;overflow:hidden">
      <div style="background:#003082;height:14px;border-radius:6px;width:${stats.progress}%;transition:width 0.3s"></div>
    </div>
    <div style="font-size:10px;color:#003082;font-weight:700;text-align:right">${stats.progress}% de clôture</div>
  `;

  const header = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #003082;margin-bottom:22px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:42px;height:42px;background:#003082;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px">BT</div>
        <div>
          <div style="font-size:20px;font-weight:800;color:#003082">BuildTrack</div>
          <div style="font-size:10px;color:#6B7280">Gestion de chantier numérique</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:15px;font-weight:700;color:#1A2742">Rapport journalier</div>
        <div style="font-size:11px;color:#6B7280;margin-top:3px">${now}</div>
        <div style="font-size:10px;color:#6B7280;margin-top:6px">Projet : <strong style="color:#1A2742">${projectName}</strong></div>
        <div style="font-size:10px;color:#6B7280">Réf. : <strong style="color:#1A2742">${docRef}</strong> &nbsp;|&nbsp; Rédigé par : <strong style="color:#1A2742">${userName}</strong></div>
      </div>
    </div>
  `;

  const kpis = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      ${[
        { val: stats.total, label: 'Réserves totales', color: '#003082' },
        { val: stats.open + stats.inProgress, label: 'En cours', color: '#F59E0B' },
        { val: stats.closed, label: 'Clôturées', color: '#059669' },
        { val: stats.progress + '%', label: 'Taux clôture', color: '#003082' },
        { val: openIncidents.length, label: 'Incidents ouverts', color: openIncidents.length > 0 ? '#DC2626' : '#059669' },
        { val: companies.reduce((s: number, c: any) => s + (c.actualWorkers || 0), 0), label: 'Effectif présent', color: '#1A2742' },
      ].map(k => `
        <div style="flex:1;min-width:90px;border:1.5px solid #DDE4EE;border-radius:10px;padding:12px 14px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:${k.color}">${k.val}</div>
          <div style="font-size:10px;color:#6B7280;margin-top:2px">${k.label}</div>
        </div>
      `).join('')}
    </div>
    ${progressBarHtml}
  `;

  const sectionH = (t: string) => `<div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:10px;margin-top:22px;padding-bottom:6px;border-bottom:1.5px solid #DDE4EE">${t}</div>`;

  const tableStyle = 'width:100%;border-collapse:collapse;margin-bottom:16px;font-size:11px';
  const thStyle = `background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px`;
  const tdStyle = 'padding:7px 10px;border-bottom:1px solid #EEF3FA;vertical-align:top';

  const footer = `
    <div style="margin-top:32px;padding-top:14px;border-top:1.5px solid #DDE4EE;display:flex;justify-content:space-between;font-size:9px;color:#6B7280">
      <span>Généré par BuildTrack — ${projectName}</span>
      <span>Document confidentiel — ${today}</span>
    </div>
  `;

  const incidentAlert = openIncidents.length > 0
    ? `<div style="background:#FEF2F2;border-left:4px solid #EF4444;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:12px;font-size:12px;color:#7F1D1D">
        ⚠️ <strong>${openIncidents.length} incident${openIncidents.length > 1 ? 's' : ''} de sécurité ouvert${openIncidents.length > 1 ? 's' : ''}</strong> — À traiter en priorité
       </div>`
    : `<div style="background:#ECFDF5;border-left:4px solid #10B981;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:12px;font-size:12px;color:#064E3B">
        ✅ Chantier sécurisé — Aucun incident ouvert
       </div>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #1A2742; font-size: 12px; padding: 28px 32px; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } @page { margin: 15mm 12mm; } }
    </style>
  </head><body>
    ${header}
    ${incidentAlert}
    ${kpis}
    ${sectionH('Personnel présent')}
    <table style="${tableStyle}">
      <thead><tr><th style="${thStyle}">Entreprise</th><th style="${thStyle}">Présents</th><th style="${thStyle}">Prévus</th><th style="${thStyle}">Écart</th></tr></thead>
      <tbody>${personnelRows || `<tr><td style="${tdStyle}" colspan="4">Aucune donnée de personnel</td></tr>`}</tbody>
    </table>
    ${sectionH('Tâches en cours')}
    <table style="${tableStyle}">
      <thead><tr><th style="${thStyle}">Tâche</th><th style="${thStyle}">Responsable</th><th style="${thStyle};width:120px">Avancement</th><th style="${thStyle}">Échéance</th></tr></thead>
      <tbody>${taskRows || `<tr><td style="${tdStyle}" colspan="4">Aucune tâche en cours</td></tr>`}</tbody>
    </table>
    ${sectionH(`Incidents de sécurité (${openIncidents.length} ouverts)`)}
    <table style="${tableStyle}">
      <thead><tr><th style="${thStyle}">Gravité</th><th style="${thStyle}">Titre</th><th style="${thStyle}">Lieu</th><th style="${thStyle}">Statut</th><th style="${thStyle}">Date</th><th style="${thStyle}">Signalé par</th></tr></thead>
      <tbody>${incidentRows || `<tr><td style="${tdStyle};color:#059669" colspan="6">Aucun incident ouvert</td></tr>`}</tbody>
    </table>
    ${sectionH(`Réserves actives (${activeReserves.length})`)}
    <table style="${tableStyle}">
      <thead><tr><th style="${thStyle}">Réf.</th><th style="${thStyle}">Titre</th><th style="${thStyle}">Localisation</th><th style="${thStyle}">Entreprise</th><th style="${thStyle}">Priorité</th><th style="${thStyle}">Statut</th><th style="${thStyle}">Échéance</th></tr></thead>
      <tbody>${reserveRows || `<tr><td style="${tdStyle};color:#059669" colspan="7">Aucune réserve active — Excellent !</td></tr>`}</tbody>
    </table>
    ${footer}
  </body></html>`;
}

function buildWeeklyHTML(reserves: any[], companies: any[], tasks: any[], incidents: any[], stats: any, userName: string, weekNum: number, projectName: string): string {
  const today = new Date().toLocaleDateString('fr-FR');
  const docRef = `RH-S${weekNum}-${new Date().getFullYear()}`;

  const openIncidents = incidents.filter((i: any) => i.status !== 'resolved');
  const resolvedThisWeek = incidents.filter((i: any) => i.status === 'resolved');
  const severityLabels: Record<string, string> = { minor: 'Mineur', moderate: 'Modéré', major: 'Majeur', critical: 'Critique' };
  const severityColors: Record<string, string> = { minor: '#6B7280', moderate: '#F59E0B', major: '#EF4444', critical: '#7F1D1D' };
  const incStatusLabels: Record<string, string> = { open: 'Ouvert', investigating: 'En cours', resolved: 'Résolu' };

  const reserveByStatus = [
    { label: 'Ouvert', count: stats.open, color: '#DC2626' },
    { label: 'En cours', count: stats.inProgress, color: '#D97706' },
    { label: 'En attente', count: stats.waiting, color: '#6366F1' },
    { label: 'Vérification', count: stats.verification, color: '#3B82F6' },
    { label: 'Clôturé', count: stats.closed, color: '#059669' },
  ];
  const criticalReserves = reserves.filter((r: any) => r.priority === 'critical' && r.status !== 'closed');
  const thStyle = 'background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px';
  const tdStyle = 'padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px';
  const sH = (t: string) => `<div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:10px;margin-top:22px;padding-bottom:6px;border-bottom:1.5px solid #DDE4EE">${t}</div>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #1A2742; font-size: 12px; padding: 28px 32px; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } @page { margin: 15mm 12mm; } }
    </style>
  </head><body>

    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #003082;margin-bottom:22px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:42px;height:42px;background:#003082;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px">BT</div>
        <div>
          <div style="font-size:20px;font-weight:800;color:#003082">BuildTrack</div>
          <div style="font-size:10px;color:#6B7280">Gestion de chantier numérique</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:15px;font-weight:700;color:#1A2742">Rapport hebdomadaire — Semaine ${weekNum}</div>
        <div style="font-size:11px;color:#6B7280;margin-top:3px">Rédigé par : ${userName}</div>
        <div style="font-size:10px;color:#6B7280;margin-top:8px">Projet : <strong style="color:#1A2742">${projectName}</strong></div>
        <div style="font-size:10px;color:#6B7280">Réf. : <strong style="color:#1A2742">${docRef}</strong> &nbsp;|&nbsp; <strong style="color:#1A2742">${today}</strong></div>
      </div>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      ${[
        { val: `${stats.progress}%`, label: 'Taux de clôture', color: '#003082' },
        { val: `${stats.closed}/${stats.total}`, label: 'Réserves clôturées', color: '#059669' },
        { val: openIncidents.length, label: 'Incidents ouverts', color: openIncidents.length > 0 ? '#DC2626' : '#059669' },
        { val: resolvedThisWeek.length, label: 'Incidents résolus', color: '#059669' },
        { val: criticalReserves.length, label: 'Réserves critiques', color: criticalReserves.length > 0 ? '#7C3AED' : '#059669' },
      ].map(k => `
        <div style="flex:1;min-width:90px;border:1.5px solid #DDE4EE;border-radius:10px;padding:12px 14px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:${k.color}">${k.val}</div>
          <div style="font-size:10px;color:#6B7280;margin-top:2px">${k.label}</div>
        </div>`).join('')}
    </div>

    <div style="background:#E8F0FE;border-radius:6px;height:14px;margin-bottom:4px;overflow:hidden">
      <div style="background:#003082;height:14px;border-radius:6px;width:${stats.progress}%"></div>
    </div>
    <div style="font-size:10px;color:#003082;font-weight:700;text-align:right;margin-bottom:20px">${stats.progress}% de clôture globale</div>

    ${sH('Répartition des réserves par statut')}
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <thead><tr>
        <th style="${thStyle}">Statut</th>
        <th style="${thStyle};text-align:center">Nombre</th>
        <th style="${thStyle};text-align:center">Proportion</th>
        <th style="${thStyle}">Indicateur</th>
      </tr></thead>
      <tbody>
        ${reserveByStatus.map(s => `
          <tr>
            <td style="${tdStyle}"><span style="color:${s.color};font-weight:700">${s.label}</span></td>
            <td style="${tdStyle};text-align:center;font-weight:700">${s.count}</td>
            <td style="${tdStyle};text-align:center">${stats.total ? Math.round((s.count / stats.total) * 100) : 0}%</td>
            <td style="${tdStyle}">
              <div style="background:#EEF3FA;border-radius:4px;height:8px;width:180px;overflow:hidden">
                <div style="background:${s.color};height:8px;width:${stats.total ? Math.round((s.count / stats.total) * 100) : 0}%"></div>
              </div>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>

    ${sH(`Réserves critiques ouvertes (${criticalReserves.length})`)}
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <thead><tr>
        <th style="${thStyle}">Réf.</th><th style="${thStyle}">Titre</th>
        <th style="${thStyle}">Bâtiment</th><th style="${thStyle}">Entreprise</th><th style="${thStyle}">Échéance</th>
      </tr></thead>
      <tbody>${criticalReserves.map((r: any) =>
        `<tr><td style="${tdStyle};font-weight:700">${r.id}</td><td style="${tdStyle}">${r.title}</td>
         <td style="${tdStyle}">Bât. ${r.building}</td><td style="${tdStyle}">${r.company}</td>
         <td style="${tdStyle};color:#DC2626;font-weight:600">${r.deadline}</td></tr>`
      ).join('') || `<tr><td style="${tdStyle};color:#059669" colspan="5">Aucune réserve critique ouverte cette semaine</td></tr>`}</tbody>
    </table>

    ${sH(`Incidents de sécurité — Semaine ${weekNum}`)}
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="${thStyle}">Gravité</th><th style="${thStyle}">Titre</th>
        <th style="${thStyle}">Bâtiment</th><th style="${thStyle}">Statut</th><th style="${thStyle}">Date</th>
      </tr></thead>
      <tbody>${openIncidents.map((i: any) =>
        `<tr>
          <td style="${tdStyle}"><span style="color:${severityColors[i.severity]||'#000'};font-weight:700">${severityLabels[i.severity]||i.severity}</span></td>
          <td style="${tdStyle}">${i.title}</td><td style="${tdStyle}">Bât. ${i.building}</td>
          <td style="${tdStyle}">${incStatusLabels[i.status]||i.status}</td><td style="${tdStyle}">${i.reportedAt}</td>
        </tr>`
      ).join('') || `<tr><td style="${tdStyle};color:#059669" colspan="5">Aucun incident ouvert cette semaine</td></tr>`}</tbody>
    </table>

    <div style="margin-top:32px;padding-top:14px;border-top:1.5px solid #DDE4EE;display:flex;justify-content:space-between;font-size:9px;color:#6B7280">
      <span>Généré par BuildTrack — ${projectName}</span>
      <span>Document confidentiel — ${today}</span>
    </div>
  </body></html>`;
}

function buildIncidentHTML(incident: any, projectName: string): string {
  const severityLabels: Record<string, string> = { minor: 'Mineur', moderate: 'Modéré', major: 'Majeur', critical: 'Critique' };
  const severityBg: Record<string, string> = { minor: '#F3F4F6', moderate: '#FFFBEB', major: '#FEF2F2', critical: '#FDF2F8' };
  const severityColor: Record<string, string> = { minor: '#6B7280', moderate: '#D97706', major: '#DC2626', critical: '#9D174D' };
  const statusLabels: Record<string, string> = { open: 'Ouvert', investigating: 'En cours d\'investigation', resolved: 'Résolu' };
  const statusColor: Record<string, string> = { open: '#DC2626', investigating: '#D97706', resolved: '#059669' };
  const statusBg: Record<string, string> = { open: '#FEF2F2', investigating: '#FFFBEB', resolved: '#ECFDF5' };
  const sevBg = severityBg[incident.severity] ?? '#F3F4F6';
  const sevCol = severityColor[incident.severity] ?? '#6B7280';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <title>Fiche incident ${incident.id}</title>
  <style>${PDF_BASE_CSS}
    .inc-header { display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #DC2626;padding-bottom:18px;margin-bottom:22px; }
    .info-row { display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px; }
    .field { background:#F9FAFB;border-radius:8px;padding:12px 16px; }
    .field-label { font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:4px; }
    .field-value { font-size:13px;color:#1A2742;font-weight:600; }
    .content-block { background:#F9FAFB;border-radius:10px;padding:14px 18px;margin-bottom:14px;border-left:4px solid #E5E7EB; }
    .content-label { font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px; }
    .content-text { font-size:13px;color:#1A2742;line-height:1.6; }
    .badge-sev { display:inline-block;padding:4px 14px;border-radius:14px;font-weight:700;font-size:12px; }
    .badge-status { display:inline-block;padding:4px 14px;border-radius:14px;font-weight:700;font-size:12px; }
  </style></head>
  <body><div class="container">
    <div class="inc-header">
      <div>
        <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Fiche d'incident</div>
        <div style="font-size:22px;font-weight:900;color:#DC2626">${incident.id}</div>
        <div style="font-size:15px;font-weight:700;color:#1A2742;margin-top:4px">${incident.title}</div>
        <div style="font-size:12px;color:#6B7280;margin-top:2px">${projectName}</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <span class="badge-sev" style="background:${sevBg};color:${sevCol}">⚠ ${severityLabels[incident.severity] ?? incident.severity}</span>
          <span class="badge-status" style="background:${statusBg[incident.status]??'#F9FAFB'};color:${statusColor[incident.status]??'#6B7280'}">${statusLabels[incident.status] ?? incident.status}</span>
        </div>
      </div>
      <div style="text-align:right;font-size:11px;color:#6B7280">
        <div>Signalé le <strong style="color:#1A2742">${incident.reportedAt}</strong></div>
        <div style="margin-top:4px">Par <strong style="color:#1A2742">${incident.reportedBy}</strong></div>
        ${incident.closedAt ? `<div style="color:#059669;margin-top:6px;font-weight:700">✓ Résolu le ${incident.closedAt}</div>` : ''}
      </div>
    </div>

    <div class="info-row">
      <div class="field"><div class="field-label">Localisation</div><div class="field-value">Bât. ${incident.building} — ${incident.location}</div></div>
      <div class="field"><div class="field-label">Signalé par</div><div class="field-value">${incident.reportedBy}</div></div>
    </div>

    <div class="content-block" style="border-left-color:#3B82F6">
      <div class="content-label">Description de l'incident</div>
      <div class="content-text">${incident.description || 'Aucune description.'}</div>
    </div>

    <div class="content-block" style="border-left-color:#6B7280">
      <div class="content-label">Témoins</div>
      <div class="content-text">${incident.witnesses || 'Aucun témoin renseigné.'}</div>
    </div>

    <div class="content-block" style="border-left-color:#F59E0B">
      <div class="content-label">Actions correctives</div>
      <div class="content-text">${incident.actions || 'Aucune action corrective renseignée.'}</div>
    </div>

    ${incident.closedAt ? `
      <div class="content-block" style="border-left-color:#059669;background:#ECFDF5">
        <div class="content-label">Clôture</div>
        <div class="content-text">
          Résolu le <strong>${incident.closedAt}</strong>
          ${incident.closedBy ? ` par <strong>${incident.closedBy}</strong>` : ''}.
        </div>
      </div>
    ` : ''}

    <div class="doc-footer">
      <span>Fiche incident générée par BuildTrack — ${projectName}</span>
      <span>${new Date().toLocaleDateString('fr-FR')}</span>
    </div>
  </div></body></html>`;
}

function buildCompanyReserveHTML(company: any, companyReserves: any[], projectName: string): string {
  const now = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const today = new Date().toLocaleDateString('fr-FR');
  const docRef = `BON-${company.name.slice(0, 4).toUpperCase().replace(/\s/g, '')}-${today.replace(/\//g, '')}`;
  const priorityLabels: Record<string, string> = { low: 'Basse', medium: 'Moyenne', high: 'Haute', critical: 'Critique' };
  const priorityColors: Record<string, string> = { low: '#6B7280', medium: '#D97706', high: '#DC2626', critical: '#7C3AED' };
  const statusLabels: Record<string, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé' };
  const statusColors: Record<string, string> = { open: '#DC2626', in_progress: '#D97706', waiting: '#6366F1', verification: '#3B82F6', closed: '#059669' };
  const openCount = companyReserves.filter((r: any) => r.status !== 'closed').length;
  const closedCount = companyReserves.filter((r: any) => r.status === 'closed').length;
  const criticalCount = companyReserves.filter((r: any) => r.priority === 'critical' && r.status !== 'closed').length;
  const thStyle = 'background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px';
  const tdStyle = 'padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;vertical-align:top';

  const rows = companyReserves.map((r: any, idx: number) =>
    `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="${tdStyle};font-weight:700;white-space:nowrap">${r.id}</td>
      <td style="${tdStyle}">${r.title}${r.description && r.description !== r.title ? `<div style="color:#6B7280;font-size:10px;margin-top:2px">${r.description.slice(0, 80)}${r.description.length > 80 ? '…' : ''}</div>` : ''}</td>
      <td style="${tdStyle};white-space:nowrap">Bât. ${r.building}<br><span style="color:#6B7280;font-size:10px">${r.zone} — ${r.level}</span></td>
      <td style="${tdStyle}"><span style="color:${priorityColors[r.priority]||'#000'};font-weight:700">${priorityLabels[r.priority]||r.priority}</span></td>
      <td style="${tdStyle}"><span style="color:${statusColors[r.status]||'#000'};font-weight:700">${statusLabels[r.status]||r.status}</span></td>
      <td style="${tdStyle};white-space:nowrap${r.deadline && r.deadline !== '—' && !r.closedAt ? ';color:#DC2626;font-weight:600' : ''}">${r.deadline||'—'}</td>
      <td style="${tdStyle};color:#059669">${r.closedAt||'—'}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #1A2742; font-size: 12px; padding: 28px 32px; line-height: 1.5; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { margin: 15mm 12mm; }
        tr { page-break-inside: avoid; }
      }
    </style>
  </head><body>

    <!-- Letterhead -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #003082;margin-bottom:22px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:42px;height:42px;background:#003082;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px">BT</div>
        <div>
          <div style="font-size:20px;font-weight:800;color:#003082">BuildTrack</div>
          <div style="font-size:10px;color:#6B7280">Gestion de chantier numérique</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:15px;font-weight:700;color:#1A2742">Bon de réserves</div>
        <div style="font-size:12px;color:#6B7280;margin-top:3px">${company.name}</div>
        <div style="font-size:10px;color:#6B7280;margin-top:8px">Projet : <strong style="color:#1A2742">${projectName}</strong></div>
        <div style="font-size:10px;color:#6B7280">Réf. : <strong style="color:#1A2742">${docRef}</strong> &nbsp;|&nbsp; <strong style="color:#1A2742">${now}</strong></div>
      </div>
    </div>

    <!-- Company info + KPIs -->
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
      <div style="flex:2;min-width:200px;background:#F4F7FB;border-radius:8px;padding:12px 16px;border:1px solid #DDE4EE">
        <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;font-weight:700">Entreprise</div>
        <div style="font-size:16px;font-weight:800;color:#1A2742">${company.name}</div>
        ${company.contact ? `<div style="font-size:11px;color:#6B7280;margin-top:4px">📞 ${company.contact}</div>` : ''}
        ${company.email ? `<div style="font-size:11px;color:#6B7280">✉ ${company.email}</div>` : ''}
        ${company.specialty ? `<div style="font-size:11px;color:#6B7280">🔧 ${company.specialty}</div>` : ''}
      </div>
      ${[
        { val: companyReserves.length, label: 'Total réserves', color: '#003082' },
        { val: openCount, label: 'À lever', color: openCount > 0 ? '#DC2626' : '#059669' },
        { val: closedCount, label: 'Levées', color: '#059669' },
        { val: criticalCount, label: 'Critiques', color: criticalCount > 0 ? '#7C3AED' : '#059669' },
      ].map(k => `
        <div style="flex:1;min-width:80px;border:1.5px solid #DDE4EE;border-radius:10px;padding:12px 14px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:${k.color}">${k.val}</div>
          <div style="font-size:10px;color:#6B7280;margin-top:2px">${k.label}</div>
        </div>`).join('')}
    </div>

    ${openCount > 0 ? `
      <div style="background:#FEF2F2;border-left:4px solid #EF4444;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:12px;color:#7F1D1D">
        ⚠️ <strong>${openCount} réserve${openCount > 1 ? 's' : ''} à lever</strong> — Délais contractuels à respecter
      </div>` : `
      <div style="background:#ECFDF5;border-left:4px solid #10B981;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:12px;color:#064E3B">
        ✅ Toutes les réserves ont été levées — Merci de votre réactivité
      </div>`}

    <!-- Section header -->
    <div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:10px;padding-bottom:6px;border-bottom:1.5px solid #DDE4EE">
      Liste des réserves (${companyReserves.length})
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <thead><tr>
        <th style="${thStyle}">Réf.</th>
        <th style="${thStyle}">Intitulé</th>
        <th style="${thStyle}">Localisation</th>
        <th style="${thStyle}">Priorité</th>
        <th style="${thStyle}">Statut</th>
        <th style="${thStyle}">Échéance</th>
        <th style="${thStyle}">Date levée</th>
      </tr></thead>
      <tbody>
        ${rows || `<tr><td style="${tdStyle};color:#059669;text-align:center" colspan="7">Aucune réserve pour cette entreprise</td></tr>`}
      </tbody>
    </table>

    <!-- Signature block -->
    <div style="background:#FFFBEB;border:1.5px solid #FCD34D;border-radius:10px;padding:16px 20px;margin-bottom:20px;font-size:12px;color:#92400E">
      <strong>Instructions :</strong> Ce bon de réserves est à retourner signé au conducteur de travaux dans les délais indiqués.
      Toute levée de réserve doit être attestée sur site avant validation.
    </div>
    <div style="display:flex;gap:32px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px;background:#FAFBFF">
        <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:30px;font-weight:700">Représentant de l'entreprise</div>
        <div style="border-bottom:2px solid #1A2742;margin-bottom:8px"></div>
        <div style="font-size:11px;color:#6B7280">Nom, prénom et cachet</div>
        <div style="font-size:11px;color:#6B7280;margin-top:4px">Date : _______________</div>
      </div>
      <div style="flex:1;min-width:200px;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px;background:#FAFBFF">
        <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:30px;font-weight:700">Conducteur de travaux</div>
        <div style="border-bottom:2px solid #1A2742;margin-bottom:8px"></div>
        <div style="font-size:11px;color:#6B7280">Signature et cachet</div>
        <div style="font-size:11px;color:#6B7280;margin-top:4px">Date : _______________</div>
      </div>
    </div>

    <div style="margin-top:20px;padding-top:12px;border-top:1.5px solid #DDE4EE;display:flex;justify-content:space-between;font-size:9px;color:#6B7280">
      <span>Généré par BuildTrack — ${projectName}</span>
      <span>Document contractuel — À conserver — ${now}</span>
    </div>
  </body></html>`;
}

function buildCsvReport(reserves: any[]): string {
  const header = ['ID', 'Titre', 'Statut', 'Priorité', 'Bâtiment', 'Zone', 'Niveau', 'Entreprise', 'Date création', 'Échéance', 'Date clôture', 'Clôturé par'];
  const statusMap: Record<string, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé' };
  const priorityMap: Record<string, string> = { low: 'Faible', medium: 'Moyen', high: 'Élevé', critical: 'Critique' };
  const rows = reserves.map(r => [
    r.id, `"${r.title}"`, statusMap[r.status] ?? r.status, priorityMap[r.priority] ?? r.priority,
    r.building, r.zone, r.level, `"${r.company}"`, r.createdAt, r.deadline,
    r.closedAt ?? '', `"${r.closedBy ?? ''}"`,
  ]);
  return [header, ...rows].map(row => row.join(';')).join('\n');
}

export default function RapportsScreen() {
  const { reserves, companies, tasks, stats, chantiers, activeChantierId } = useApp();
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();
  const { incidents } = useIncidents();
  const userName = user?.name ?? 'Équipe BuildTrack';

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const weekNum = (() => {
    const d = new Date();
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
  })();

  async function exportPDF(type: 'daily' | 'weekly') {
    if (!permissions.canExport) {
      Alert.alert('Accès refusé', "Votre rôle ne permet pas d'exporter des rapports.");
      return;
    }
    try {
      const html = type === 'daily'
        ? buildDailyHTML(reserves, companies, tasks, incidents, stats, userName, projectName)
        : buildWeeklyHTML(reserves, companies, tasks, incidents, stats, userName, weekNum, projectName);
      await exportPDFHelper(html, type === 'daily' ? 'Rapport journalier' : 'Rapport hebdomadaire');
    } catch (e: any) {
      Alert.alert('Erreur', `Impossible de générer le PDF : ${e?.message ?? e}`);
    }
  }

  async function exportCSV() {
    if (!permissions.canExport) {
      Alert.alert('Accès refusé', "Votre rôle ne permet pas d'exporter des rapports.");
      return;
    }
    try {
      const csv = buildCsvReport(reserves);

      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `buildtrack_reserves_${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }

      const filename = `buildtrack_reserves_${Date.now()}.csv`;
      const fileUri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Partager le rapport CSV', UTI: 'public.comma-separated-values-text' });
      } else {
        Alert.alert('CSV généré', `${reserves.length} réserves exportées.\n${fileUri}`);
      }
    } catch (e: any) {
      Alert.alert('Erreur', `Impossible d'exporter : ${e?.message ?? e}`);
    }
  }

  return (
    <View style={styles.container}>
      <Header title="Rapports" subtitle="Journalier & hebdomadaire" showBack />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="document-text" size={20} color={C.inProgress} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>Rapport journalier</Text>
              <Text style={styles.reportDate}>{today}</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={() => exportPDF('daily')}>
                <Ionicons name="download-outline" size={14} color={C.primary} />
                <Text style={styles.exportBtnText}>PDF</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Personnel présent</Text>
            {companies.map(co => (
              <View key={co.id} style={styles.coRow}>
                <View style={[styles.coDot, { backgroundColor: co.color }]} />
                <Text style={styles.coName}>{co.name}</Text>
                <Text style={[styles.coVal, { color: co.color }]}>{co.actualWorkers} pers.</Text>
              </View>
            ))}
            <View style={[styles.coRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>TOTAL</Text>
              <Text style={[styles.coVal, { color: C.primary }]}>{stats.totalWorkers} / {stats.plannedWorkers} prévus</Text>
            </View>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Réserves</Text>
            <View style={styles.statRow}>
              <StatItem label="Ouvertes" val={stats.open} color={C.open} />
              <StatItem label="En cours" val={stats.inProgress} color={C.inProgress} />
              <StatItem label="Clôturées" val={stats.closed} color={C.closed} />
            </View>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Tâches en cours</Text>
            {tasks.filter(t => t.status === 'in_progress').map(t => (
              <View key={t.id} style={styles.taskItem}>
                <View style={styles.taskDot} />
                <Text style={styles.taskText}>{t.title}</Text>
                <Text style={[styles.taskPct, { color: C.inProgress }]}>{t.progress}%</Text>
              </View>
            ))}
            {tasks.filter(t => t.status === 'in_progress').length === 0 && (
              <Text style={styles.emptyText}>Aucune tâche en cours</Text>
            )}
          </View>
        </View>

        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="calendar" size={20} color={C.closed} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>Rapport hebdomadaire</Text>
              <Text style={styles.reportDate}>Semaine {weekNum}</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={() => exportPDF('weekly')}>
                <Ionicons name="download-outline" size={14} color={C.primary} />
                <Text style={styles.exportBtnText}>PDF</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Synthèse réserves</Text>
            <View style={styles.statRow}>
              <StatItem label="Total" val={stats.total} color={C.textSub} />
              <StatItem label="Ouvertes" val={stats.open + stats.inProgress} color={C.open} />
              <StatItem label="Clôturées" val={stats.closed} color={C.closed} />
            </View>
            <View style={styles.progressWrap}>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${stats.progress}%` as any }]} />
              </View>
              <Text style={[styles.progressPct, { color: C.primary }]}>{stats.progress}%</Text>
            </View>
            <Text style={styles.progressLabel}>Avancement global du projet</Text>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Réserves critiques ouvertes</Text>
            {reserves.filter(r => r.priority === 'critical' && r.status !== 'closed').map(r => (
              <View key={r.id} style={styles.critItem}>
                <Ionicons name="warning" size={14} color={C.critical} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.critTitle}>{r.id} — {r.title}</Text>
                  <Text style={styles.critSub}>Bât. {r.building} — Éch. : {r.deadline}</Text>
                </View>
              </View>
            ))}
            {reserves.filter(r => r.priority === 'critical' && r.status !== 'closed').length === 0 && (
              <Text style={styles.emptyText}>Aucune réserve critique ouverte</Text>
            )}
          </View>

          <View style={[styles.reportSection, { marginBottom: 0, borderBottomWidth: 0 }]}>
            <Text style={styles.sectionTitle}>Incidents de sécurité</Text>
            {incidents.filter(i => i.status !== 'resolved').map(i => {
              const sevColor: Record<string, string> = { minor: C.textSub, moderate: C.waiting, major: C.open, critical: C.critical };
              const sevLabel: Record<string, string> = { minor: 'Mineur', moderate: 'Modéré', major: 'Majeur', critical: 'Critique' };
              return (
                <View key={i.id} style={[styles.critItem, { borderLeftWidth: 3, borderLeftColor: sevColor[i.severity] ?? C.open, paddingLeft: 8, marginBottom: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.critTitle, { color: sevColor[i.severity] ?? C.open }]}>{sevLabel[i.severity] ?? i.severity} — {i.title}</Text>
                    <Text style={styles.critSub}>Bât. {i.building} — {i.location} — {i.reportedAt}</Text>
                  </View>
                  {permissions.canExport && (
                    <TouchableOpacity
                      onPress={async () => {
                        try {
                          const html = buildIncidentHTML(i, projectName);
                          await exportPDFHelper(html, `Incident ${i.id}`);
                        } catch {}
                      }}
                      style={[styles.exportBtn, { marginLeft: 8 }]}
                    >
                      <Ionicons name="download-outline" size={12} color={C.primary} />
                      <Text style={styles.exportBtnText}>PDF</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            {incidents.filter(i => i.status !== 'resolved').length === 0 && (
              <Text style={[styles.emptyText, { color: C.closed }]}>Aucun incident ouvert — chantier sécurisé</Text>
            )}
          </View>
        </View>

        {/* BON DE RÉSERVE PAR ENTREPRISE */}
        {permissions.canExport && companies.length > 0 && (
          <View style={styles.reportCard}>
            <View style={styles.reportHeader}>
              <Ionicons name="briefcase-outline" size={20} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle}>Bons de réserve par entreprise</Text>
                <Text style={styles.reportDate}>PDF individuel par sous-traitant</Text>
              </View>
            </View>
            {companies.map(company => {
              const companyReserves = reserves.filter(r => r.company === company.name);
              const openCount = companyReserves.filter(r => r.status !== 'closed').length;
              const closedCount = companyReserves.filter(r => r.status === 'closed').length;
              const activeChantier = chantiers.find(c => c.id === activeChantierId);
              const projectName = activeChantier?.name ?? 'Projet BuildTrack';
              return (
                <View key={company.id} style={styles.companyRow}>
                  <View style={[styles.companyDot, { backgroundColor: company.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.companyName}>{company.name}</Text>
                    <Text style={styles.companyMeta}>
                      {companyReserves.length} réserve{companyReserves.length !== 1 ? 's' : ''}
                      {openCount > 0 ? ` · ${openCount} à lever` : ''}
                      {closedCount > 0 ? ` · ${closedCount} levée${closedCount > 1 ? 's' : ''}` : ''}
                    </Text>
                  </View>
                  {companyReserves.length > 0 ? (
                    <TouchableOpacity
                      style={styles.exportBtn}
                      onPress={async () => {
                        try {
                          const html = buildCompanyReserveHTML(company, companyReserves, projectName);
                          await exportPDFHelper(html, `Bon réserves — ${company.name}`);
                        } catch {}
                      }}
                    >
                      <Ionicons name="document-text-outline" size={13} color={C.primary} />
                      <Text style={styles.exportBtnText}>PDF</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted }}>Aucune</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="warning" size={20} color={C.waiting} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>Rapport réserves</Text>
              <Text style={styles.reportDate}>{stats.total} réserves au total</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={exportCSV}>
                <Ionicons name="download-outline" size={14} color={C.closed} />
                <Text style={[styles.exportBtnText, { color: C.closed }]}>CSV</Text>
              </TouchableOpacity>
            )}
          </View>

          {(['open', 'in_progress', 'waiting', 'verification', 'closed'] as const).map(s => {
            const labels: Record<string, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé' };
            const colors: Record<string, string> = { open: C.open, in_progress: C.inProgress, waiting: C.waiting, verification: C.verification, closed: C.closed };
            const count = reserves.filter(r => r.status === s).length;
            return (
              <View key={s} style={styles.statusBreakRow}>
                <View style={[styles.statusDot, { backgroundColor: colors[s] }]} />
                <Text style={styles.statusLabel}>{labels[s]}</Text>
                <View style={styles.statusBarBg}>
                  <View style={[styles.statusBarFill, {
                    width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%` as any,
                    backgroundColor: colors[s],
                  }]} />
                </View>
                <Text style={[styles.statusCount, { color: colors[s] }]}>{count}</Text>
              </View>
            );
          })}

          {permissions.canExport && (
            <TouchableOpacity style={styles.fullExportBtn} onPress={exportCSV}>
              <Ionicons name="document-outline" size={16} color="#fff" />
              <Text style={styles.fullExportBtnText}>Exporter toutes les réserves (CSV)</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
      <BottomNavBar />
    </View>
  );
}

function StatItem({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statVal, { color }]}>{val}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  reportCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  reportTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  reportDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8, backgroundColor: C.primaryBg, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '40' },
  exportBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  reportSection: { marginBottom: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  sectionTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  companyDot: { width: 10, height: 10, borderRadius: 5 },
  companyName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  companyMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  coRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  coDot: { width: 8, height: 8, borderRadius: 4 },
  coName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  coVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  totalRow: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, marginTop: 4 },
  totalLabel: { flex: 1, fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  statRow: { flexDirection: 'row', gap: 8 },
  statItem: { flex: 1, alignItems: 'center', backgroundColor: C.surface2, borderRadius: 10, padding: 10 },
  statVal: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  taskItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  taskDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.inProgress },
  taskText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  taskPct: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  progressBg: { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  progressPct: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4 },
  critItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  critTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  critSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  statusBreakRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, width: 82 },
  statusBarBg: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  statusBarFill: { height: '100%', borderRadius: 3 },
  statusCount: { fontSize: 13, fontFamily: 'Inter_600SemiBold', width: 20, textAlign: 'right' },
  fullExportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, marginTop: 10 },
  fullExportBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
