import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { C } from '@/constants/colors';
import {
  exportPDF as exportPDFHelper,
  buildLetterhead,
  buildKpiRow,
  buildDocFooter,
  wrapHTML,
  buildInfoGrid,
  loadPhotoAsDataUrl,
} from '@/lib/pdfBase';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useIncidents } from '@/context/IncidentsContext';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';

function buildLotSummaryRows(reserves: any[], companies: any[]): string {
  const companyNames = [...new Set(reserves.map((r: any) => r.company))];
  return companyNames.map(name => {
    const co = companies.find((c: any) => c.name === name);
    const coReserves = reserves.filter((r: any) => r.company === name);
    const open = coReserves.filter((r: any) => r.status !== 'closed').length;
    const closed = coReserves.filter((r: any) => r.status === 'closed').length;
    const pct = coReserves.length > 0 ? Math.round((closed / coReserves.length) * 100) : 0;
    const barColor = pct >= 80 ? '#059669' : pct >= 40 ? '#F59E0B' : '#DC2626';
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-weight:600">${name}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center;font-weight:700;color:#003082">${coReserves.length}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center;color:#DC2626;font-weight:700">${open}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center;color:#059669;font-weight:700">${closed}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;background:#EEF3FA;border-radius:4px;height:8px;overflow:hidden">
            <div style="background:${barColor};height:8px;width:${pct}%"></div>
          </div>
          <span style="font-size:10px;font-weight:700;color:${barColor};min-width:28px">${pct}%</span>
        </div>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#059669">Aucune réserve</td></tr>';
}

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
  const totalWorkers = companies.reduce((s: number, c: any) => s + (c.actualWorkers || 0), 0);

  const thS = 'background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px';
  const tdS = 'padding:7px 10px;border-bottom:1px solid #EEF3FA;vertical-align:top';

  const personnelRows = companies.map((c: any) =>
    `<tr><td style="${tdS}">${c.name}</td><td style="${tdS};text-align:center;font-weight:700">${c.actualWorkers}</td><td style="${tdS};text-align:center">${c.plannedWorkers}</td><td style="${tdS};text-align:center;color:${c.actualWorkers >= c.plannedWorkers ? '#059669' : '#DC2626'}">${c.actualWorkers >= c.plannedWorkers ? '✓' : '↓'}</td></tr>`
  ).join('');

  const taskRows = tasks.filter((t: any) => t.status === 'in_progress').map((t: any) =>
    `<tr><td style="${tdS}">${t.title}</td><td style="${tdS}">${t.assignee}</td><td style="${tdS};text-align:center">
      <div style="background:#E8F0FE;border-radius:4px;height:8px;width:100%;margin-bottom:3px"><div style="background:#003082;height:8px;border-radius:4px;width:${t.progress}%"></div></div>
      <span style="font-size:10px;color:#003082;font-weight:700">${t.progress}%</span>
    </td><td style="${tdS}">${t.deadline}</td></tr>`
  ).join('');

  const incidentRows = openIncidents.map((i: any) =>
    `<tr><td style="${tdS}"><span style="color:${severityColors[i.severity] || '#000'};font-weight:700">${severityLabels[i.severity] || i.severity}</span></td>
      <td style="${tdS}">${i.title}</td><td style="${tdS}">Bât. ${i.building} — ${i.location}</td>
      <td style="${tdS}">${incidentStatusLabels[i.status] || i.status}</td>
      <td style="${tdS}">${i.reportedAt}</td><td style="${tdS}">${i.reportedBy}</td></tr>`
  ).join('');

  const reserveRows = activeReserves.map((r: any) =>
    `<tr><td style="${tdS};font-weight:700;font-size:10px">${r.id}</td>
      <td style="${tdS}">${r.title}</td>
      <td style="${tdS}">Bât. ${r.building} — ${r.level}</td>
      <td style="${tdS}">${r.company}</td>
      <td style="${tdS}"><span style="color:${pColor[r.priority] || '#000'};font-weight:700">${priorityLabels[r.priority] || r.priority}</span></td>
      <td style="${tdS}"><span style="color:${statusColors[r.status] || '#000'}">${statusLabels[r.status] || r.status}</span></td>
      <td style="${tdS}">${r.deadline}</td></tr>`
  ).join('');

  const incidentAlert = openIncidents.length > 0
    ? `<div class="alert alert-danger">⚠️ <strong>${openIncidents.length} incident${openIncidents.length > 1 ? 's' : ''} de sécurité ouvert${openIncidents.length > 1 ? 's' : ''}</strong> — À traiter en priorité</div>`
    : `<div class="alert alert-success">✅ Chantier sécurisé — Aucun incident ouvert</div>`;

  const body = `
    ${buildLetterhead('Rapport journalier', now, docRef, today, projectName)}
    <div style="font-size:10px;color:#6B7280;margin-top:-16px;margin-bottom:20px">Rédigé par : <strong style="color:#1A2742">${userName}</strong></div>
    ${incidentAlert}
    ${buildKpiRow([
      { val: stats.total, label: 'Réserves totales', color: '#003082' },
      { val: stats.open + stats.inProgress, label: 'En cours', color: '#F59E0B' },
      { val: stats.closed, label: 'Clôturées', color: '#059669' },
      { val: stats.progress + '%', label: 'Taux clôture', color: '#003082' },
      { val: openIncidents.length, label: 'Incidents ouverts', color: openIncidents.length > 0 ? '#DC2626' : '#059669' },
      { val: totalWorkers, label: 'Effectif présent', color: '#1A2742' },
    ])}
    <div style="background:#E8F0FE;border-radius:6px;height:12px;margin:8px 0 4px;overflow:hidden"><div style="background:#003082;height:12px;border-radius:6px;width:${stats.progress}%"></div></div>
    <div style="font-size:10px;color:#003082;font-weight:700;text-align:right;margin-bottom:20px">${stats.progress}% de clôture globale</div>

    <div class="section-header">Récapitulatif par entreprise (lots)</div>
    <table>
      <thead><tr><th style="${thS}">Entreprise / Lot</th><th style="${thS};text-align:center">Total</th><th style="${thS};text-align:center">À lever</th><th style="${thS};text-align:center">Levées</th><th style="${thS}">Avancement</th></tr></thead>
      <tbody>${buildLotSummaryRows(reserves, companies)}</tbody>
    </table>

    <div class="section-header">Personnel présent</div>
    <table>
      <thead><tr><th style="${thS}">Entreprise</th><th style="${thS};text-align:center">Présents</th><th style="${thS};text-align:center">Prévus</th><th style="${thS};text-align:center">Écart</th></tr></thead>
      <tbody>${personnelRows || `<tr><td style="${tdS}" colspan="4">Aucune donnée de personnel</td></tr>`}</tbody>
    </table>

    <div class="section-header">Tâches en cours</div>
    <table>
      <thead><tr><th style="${thS}">Tâche</th><th style="${thS}">Responsable</th><th style="${thS};width:120px">Avancement</th><th style="${thS}">Échéance</th></tr></thead>
      <tbody>${taskRows || `<tr><td style="${tdS}" colspan="4">Aucune tâche en cours</td></tr>`}</tbody>
    </table>

    <div class="section-header">Incidents de sécurité (${openIncidents.length} ouverts)</div>
    <table>
      <thead><tr><th style="${thS}">Gravité</th><th style="${thS}">Titre</th><th style="${thS}">Lieu</th><th style="${thS}">Statut</th><th style="${thS}">Date</th><th style="${thS}">Signalé par</th></tr></thead>
      <tbody>${incidentRows || `<tr><td style="${tdS};color:#059669" colspan="6">Aucun incident ouvert</td></tr>`}</tbody>
    </table>

    <div class="section-header">Réserves actives (${activeReserves.length})</div>
    <table>
      <thead><tr><th style="${thS}">Réf.</th><th style="${thS}">Titre</th><th style="${thS}">Localisation</th><th style="${thS}">Entreprise</th><th style="${thS}">Priorité</th><th style="${thS}">Statut</th><th style="${thS}">Échéance</th></tr></thead>
      <tbody>${reserveRows || `<tr><td style="${tdS};color:#059669" colspan="7">Aucune réserve active — Excellent !</td></tr>`}</tbody>
    </table>

    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, `Rapport journalier — ${projectName}`);
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
  const thS = 'background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px';
  const tdS = 'padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px';

  const body = `
    ${buildLetterhead(`Rapport hebdomadaire — Semaine ${weekNum}`, `${projectName}`, docRef, today, projectName)}
    <div style="font-size:10px;color:#6B7280;margin-top:-16px;margin-bottom:20px">Rédigé par : <strong style="color:#1A2742">${userName}</strong></div>
    ${buildKpiRow([
      { val: `${stats.progress}%`, label: 'Taux de clôture', color: '#003082' },
      { val: `${stats.closed}/${stats.total}`, label: 'Réserves clôturées', color: '#059669' },
      { val: openIncidents.length, label: 'Incidents ouverts', color: openIncidents.length > 0 ? '#DC2626' : '#059669' },
      { val: resolvedThisWeek.length, label: 'Incidents résolus', color: '#059669' },
      { val: criticalReserves.length, label: 'Réserves critiques', color: criticalReserves.length > 0 ? '#7C3AED' : '#059669' },
    ])}
    <div style="background:#E8F0FE;border-radius:6px;height:12px;margin:4px 0 4px;overflow:hidden"><div style="background:#003082;height:12px;border-radius:6px;width:${stats.progress}%"></div></div>
    <div style="font-size:10px;color:#003082;font-weight:700;text-align:right;margin-bottom:20px">${stats.progress}% de clôture globale</div>

    <div class="section-header">Récapitulatif par entreprise (lots)</div>
    <table>
      <thead><tr><th style="${thS}">Entreprise / Lot</th><th style="${thS};text-align:center">Total</th><th style="${thS};text-align:center">À lever</th><th style="${thS};text-align:center">Levées</th><th style="${thS}">Avancement</th></tr></thead>
      <tbody>${buildLotSummaryRows(reserves, companies)}</tbody>
    </table>

    <div class="section-header">Répartition des réserves par statut</div>
    <table>
      <thead><tr>
        <th style="${thS}">Statut</th>
        <th style="${thS};text-align:center">Nombre</th>
        <th style="${thS};text-align:center">Proportion</th>
        <th style="${thS}">Indicateur</th>
      </tr></thead>
      <tbody>
        ${reserveByStatus.map(s => `
          <tr>
            <td style="${tdS}"><span style="color:${s.color};font-weight:700">${s.label}</span></td>
            <td style="${tdS};text-align:center;font-weight:700">${s.count}</td>
            <td style="${tdS};text-align:center">${stats.total ? Math.round((s.count / stats.total) * 100) : 0}%</td>
            <td style="${tdS}">
              <div style="background:#EEF3FA;border-radius:4px;height:8px;width:180px;overflow:hidden">
                <div style="background:${s.color};height:8px;width:${stats.total ? Math.round((s.count / stats.total) * 100) : 0}%"></div>
              </div>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>

    <div class="section-header">Réserves critiques ouvertes (${criticalReserves.length})</div>
    <table>
      <thead><tr>
        <th style="${thS}">Réf.</th><th style="${thS}">Titre</th>
        <th style="${thS}">Bâtiment</th><th style="${thS}">Entreprise</th><th style="${thS}">Échéance</th>
      </tr></thead>
      <tbody>${criticalReserves.map((r: any) =>
        `<tr><td style="${tdS};font-weight:700">${r.id}</td><td style="${tdS}">${r.title}</td>
         <td style="${tdS}">Bât. ${r.building}</td><td style="${tdS}">${r.company}</td>
         <td style="${tdS};color:#DC2626;font-weight:600">${r.deadline}</td></tr>`
      ).join('') || `<tr><td style="${tdS};color:#059669" colspan="5">Aucune réserve critique ouverte</td></tr>`}</tbody>
    </table>

    <div class="section-header">Incidents de sécurité — Semaine ${weekNum}</div>
    <table>
      <thead><tr>
        <th style="${thS}">Gravité</th><th style="${thS}">Titre</th>
        <th style="${thS}">Bâtiment</th><th style="${thS}">Statut</th><th style="${thS}">Date</th>
      </tr></thead>
      <tbody>${openIncidents.map((i: any) =>
        `<tr>
          <td style="${tdS}"><span style="color:${severityColors[i.severity]||'#000'};font-weight:700">${severityLabels[i.severity]||i.severity}</span></td>
          <td style="${tdS}">${i.title}</td><td style="${tdS}">Bât. ${i.building}</td>
          <td style="${tdS}">${incStatusLabels[i.status]||i.status}</td><td style="${tdS}">${i.reportedAt}</td>
        </tr>`
      ).join('') || `<tr><td style="${tdS};color:#059669" colspan="5">Aucun incident ouvert cette semaine</td></tr>`}</tbody>
    </table>

    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, `Rapport hebdomadaire S${weekNum} — ${projectName}`);
}

function buildIncidentHTML(incident: any, projectName: string): string {
  const severityLabels: Record<string, string> = { minor: 'Mineur', moderate: 'Modéré', major: 'Majeur', critical: 'Critique' };
  const severityBg: Record<string, string> = { minor: '#F3F4F6', moderate: '#FFFBEB', major: '#FEF2F2', critical: '#FDF2F8' };
  const severityColor: Record<string, string> = { minor: '#6B7280', moderate: '#D97706', major: '#DC2626', critical: '#9D174D' };
  const statusLabels: Record<string, string> = { open: 'Ouvert', investigating: "En cours d'investigation", resolved: 'Résolu' };
  const statusColor: Record<string, string> = { open: '#DC2626', investigating: '#D97706', resolved: '#059669' };
  const statusBg: Record<string, string> = { open: '#FEF2F2', investigating: '#FFFBEB', resolved: '#ECFDF5' };
  const sevBg = severityBg[incident.severity] ?? '#F3F4F6';
  const sevCol = severityColor[incident.severity] ?? '#6B7280';
  const today = new Date().toLocaleDateString('fr-FR');
  const docRef = `INC-${incident.id}`;

  const infoItems = [
    { label: 'Localisation', value: `Bât. ${incident.building} — ${incident.location}` },
    { label: 'Signalé par', value: incident.reportedBy },
    { label: 'Date du signalement', value: incident.reportedAt },
    ...(incident.closedAt ? [{ label: 'Résolu le', value: incident.closedAt }] : []),
  ];

  const body = `
    ${buildLetterhead('Fiche d\'incident', incident.title, docRef, today, projectName)}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <span style="display:inline-block;padding:4px 14px;border-radius:14px;font-weight:700;font-size:12px;background:${sevBg};color:${sevCol}">⚠ ${severityLabels[incident.severity] ?? incident.severity}</span>
      <span style="display:inline-block;padding:4px 14px;border-radius:14px;font-weight:700;font-size:12px;background:${statusBg[incident.status]??'#F9FAFB'};color:${statusColor[incident.status]??'#6B7280'}">${statusLabels[incident.status] ?? incident.status}</span>
      ${incident.closedAt ? '<span style="display:inline-block;padding:4px 14px;border-radius:14px;font-weight:700;font-size:12px;background:#ECFDF5;color:#059669">✓ Résolu</span>' : ''}
    </div>
    ${buildInfoGrid(infoItems)}
    <div class="section-header">Description de l'incident</div>
    <div style="background:#F9FAFB;border-radius:10px;padding:14px 18px;margin-bottom:14px;border-left:4px solid #3B82F6;font-size:13px;color:#1A2742;line-height:1.6">
      ${incident.description || 'Aucune description.'}
    </div>
    <div class="section-header">Témoins</div>
    <div style="background:#F9FAFB;border-radius:10px;padding:14px 18px;margin-bottom:14px;border-left:4px solid #6B7280;font-size:13px;color:#1A2742;line-height:1.6">
      ${incident.witnesses || 'Aucun témoin renseigné.'}
    </div>
    <div class="section-header">Actions correctives</div>
    <div style="background:#F9FAFB;border-radius:10px;padding:14px 18px;margin-bottom:14px;border-left:4px solid #F59E0B;font-size:13px;color:#1A2742;line-height:1.6">
      ${incident.actions || 'Aucune action corrective renseignée.'}
    </div>
    ${incident.closedAt ? `
      <div class="section-header">Clôture</div>
      <div style="background:#ECFDF5;border-radius:10px;padding:14px 18px;margin-bottom:14px;border-left:4px solid #059669;font-size:13px;color:#1A2742;line-height:1.6">
        Résolu le <strong>${incident.closedAt}</strong>${incident.closedBy ? ` par <strong>${incident.closedBy}</strong>` : ''}.
      </div>` : ''}
    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, `Fiche incident — ${incident.id}`);
}

async function buildCompanyReserveHTML(company: any, companyReserves: any[], projectName: string): Promise<string> {
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
  const thS = 'background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px';
  const tdS = 'padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;vertical-align:top';

  const photoMap: Record<string, string> = {};
  await Promise.all(
    companyReserves.map(async (r: any) => {
      const firstPhoto = r.photos?.find?.((p: any) => p.kind === 'defect') ?? r.photos?.[0];
      if (firstPhoto?.uri) {
        const src = await loadPhotoAsDataUrl(firstPhoto.uri);
        if (src) photoMap[r.id] = src;
      }
    })
  );

  const rows = companyReserves.map((r: any, idx: number) => {
    const photo = photoMap[r.id];
    return `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="${tdS};font-weight:700;white-space:nowrap;vertical-align:middle">${r.id}</td>
      <td style="${tdS}">
        ${photo ? `<img src="${photo}" style="width:56px;height:40px;object-fit:cover;border-radius:5px;border:1px solid #DDE4EE;float:left;margin-right:8px;margin-bottom:2px" />` : ''}
        <span style="font-weight:600">${r.title}</span>
        ${r.description && r.description !== r.title ? `<div style="color:#6B7280;font-size:10px;margin-top:2px;clear:both">${r.description.slice(0, 80)}${r.description.length > 80 ? '…' : ''}</div>` : ''}
      </td>
      <td style="${tdS};white-space:nowrap">Bât. ${r.building}<br><span style="color:#6B7280;font-size:10px">${r.zone} — ${r.level}</span></td>
      <td style="${tdS}"><span style="color:${priorityColors[r.priority]||'#000'};font-weight:700">${priorityLabels[r.priority]||r.priority}</span></td>
      <td style="${tdS}"><span style="color:${statusColors[r.status]||'#000'};font-weight:700">${statusLabels[r.status]||r.status}</span></td>
      <td style="${tdS};white-space:nowrap${r.deadline && r.deadline !== '—' && !r.closedAt ? ';color:#DC2626;font-weight:600' : ''}">${r.deadline||'—'}</td>
      <td style="${tdS};color:#059669">${r.closedAt||'—'}</td>
    </tr>`;
  }).join('');

  const alertHtml = openCount > 0
    ? `<div class="alert alert-danger">⚠️ <strong>${openCount} réserve${openCount > 1 ? 's' : ''} à lever</strong> — Délais contractuels à respecter</div>`
    : `<div class="alert alert-success">✅ Toutes les réserves ont été levées — Merci de votre réactivité</div>`;

  const body = `
    ${buildLetterhead('Bon de réserves', company.name, docRef, now, projectName)}
    ${buildInfoGrid([
      ...(company.contact ? [{ label: 'Contact', value: company.contact }] : []),
      ...(company.email ? [{ label: 'Email', value: company.email }] : []),
      ...(company.specialty ? [{ label: 'Spécialité', value: company.specialty }] : []),
    ])}
    ${buildKpiRow([
      { val: companyReserves.length, label: 'Total réserves', color: '#003082' },
      { val: openCount, label: 'À lever', color: openCount > 0 ? '#DC2626' : '#059669' },
      { val: closedCount, label: 'Levées', color: '#059669' },
      { val: criticalCount, label: 'Critiques', color: criticalCount > 0 ? '#7C3AED' : '#059669' },
    ])}
    ${alertHtml}
    <div class="section-header">Liste des réserves (${companyReserves.length})</div>
    <table>
      <thead><tr>
        <th style="${thS}">Réf.</th>
        <th style="${thS}">Intitulé</th>
        <th style="${thS}">Localisation</th>
        <th style="${thS}">Priorité</th>
        <th style="${thS}">Statut</th>
        <th style="${thS}">Échéance</th>
        <th style="${thS}">Date levée</th>
      </tr></thead>
      <tbody>
        ${rows || `<tr><td style="${tdS};color:#059669;text-align:center" colspan="7">Aucune réserve pour cette entreprise</td></tr>`}
      </tbody>
    </table>
    <div class="alert alert-info" style="margin-top:20px">
      <strong>Instructions :</strong> Ce bon de réserves est à retourner signé au conducteur de travaux dans les délais indiqués.
      Toute levée de réserve doit être attestée sur site avant validation.
    </div>
    <div class="sig-row" style="margin-top:20px">
      <div class="sig-block">
        <div class="sig-label">Représentant de l'entreprise</div>
        <div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>
        <div style="font-size:11px;color:#6B7280">Nom, prénom et cachet</div>
        <div class="sig-date">Date : _______________</div>
      </div>
      <div class="sig-block">
        <div class="sig-label">Conducteur de travaux</div>
        <div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>
        <div style="font-size:11px;color:#6B7280">Signature et cachet</div>
        <div class="sig-date">Date : _______________</div>
      </div>
    </div>
    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, `Bon de réserves — ${company.name}`);
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
                        } catch (e: any) {
                          Alert.alert('Erreur', e?.message ?? 'Impossible de générer le PDF');
                        }
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
                          const html = await buildCompanyReserveHTML(company, companyReserves, projectName);
                          await exportPDFHelper(html, `Bon réserves — ${company.name}`);
                        } catch (e: any) {
                          Alert.alert('Erreur', e?.message ?? 'Impossible de générer le PDF');
                        }
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
