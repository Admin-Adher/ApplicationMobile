import type { PdfReportPayload, PdfPlanItem, PdfReserveItem } from '../types/pdfReport';
import {
  RESERVE_PRIORITY_COLORS,
  RESERVE_PRIORITY_LABELS,
  RESERVE_STATUS_COLORS,
  RESERVE_STATUS_LABELS,
  RESERVE_STATUS_LABELS_FEMININE,
} from '@/lib/reserveLabels';
import { getReserveDescriptionText } from '@/lib/reserveDescription';

// ── Global Reserves HTML (no plans needed) ────────────────────────────────────
export function buildGlobalReservesHtml(payload: any): string {
  const { chantierName, companyFilter, generatedAt, reserves } = payload;
  const dateStr = new Date(generatedAt || Date.now()).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const companyLabel = (companyFilter as string | null) ?? 'Toutes les entreprises';

  const S_FR = RESERVE_STATUS_LABELS as Record<string, string>;
  const S_COL = RESERVE_STATUS_COLORS as Record<string, string>;
  const P_FR = RESERVE_PRIORITY_LABELS as Record<string, string>;
  const P_COL = RESERVE_PRIORITY_COLORS as Record<string, string>;

  const byStatus: Record<string, number> = {};
  for (const r of reserves) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const total = (reserves as any[]).length;

  const byCompany: Record<string, { total: number; closed: number }> = {};
  for (const r of reserves as any[]) {
    const names: string[] = Array.isArray(r.companies) && r.companies.length > 0 ? r.companies : r.company ? [r.company] : ['—'];
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

  const summaryStats = ['open', 'in_progress', 'waiting', 'verification', 'closed'].map(s => {
    const cnt = byStatus[s] ?? 0;
    if (!cnt) return '';
    const col = S_COL[s];
    return `<div style="text-align:center;background:#f8fafc;border-radius:8px;padding:10px 16px;border:1px solid #e2e8f0;min-width:80px">
      <div style="font-size:22px;font-weight:800;color:${col}">${cnt}</div>
      <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-top:2px">${S_FR[s]}</div>
    </div>`;
  }).join('');

  const reserveRows = [...(reserves as any[])]
    .sort((a, b) => {
      const O: Record<string, number> = { open: 0, in_progress: 1, waiting: 2, verification: 3, closed: 4 };
      return (O[a.status] ?? 9) - (O[b.status] ?? 9);
    })
    .map((r, i) => {
      const sc = S_COL[r.status] ?? '#6b7280';
      const pc = P_COL[r.priority] ?? '#6b7280';
      const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
      const cos: string[] = Array.isArray(r.companies) && r.companies.length > 0 ? r.companies : r.company ? [r.company] : ['—'];
      return `<tr style="background:${bg}">
        <td style="text-align:center;width:36px;padding:6px 8px">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#003082;color:#fff;font-weight:700;font-size:10px">${i + 1}</span>
        </td>
        <td style="padding:6px 8px;font-weight:600;font-size:11px">${escHtml(r.title)}</td>
        <td style="padding:6px 8px;font-size:11px">${cos.map(c => escHtml(c)).join(', ')}</td>
        <td style="padding:6px 8px;font-size:11px">Bât. ${escHtml(r.building || '?')} · ${escHtml(r.level || '—')}</td>
        <td style="padding:6px 8px"><span style="color:${sc};font-weight:600;font-size:10px">${S_FR[r.status] ?? r.status}</span></td>
        <td style="padding:6px 8px"><span style="color:${pc};font-weight:600;font-size:10px">${P_FR[r.priority] ?? r.priority}</span></td>
        <td style="padding:6px 8px;font-size:11px">${escHtml(r.deadline) || '—'}</td>
      </tr>`;
    }).join('');

  const photoSection = (reserves as any[])
    .filter(r => Array.isArray(r.photos) && r.photos.length > 0)
    .slice(0, 20)
    .map((r, i) => {
      const cos: string[] = Array.isArray(r.companies) && r.companies.length > 0 ? r.companies : r.company ? [r.company] : [];
      const imgs = (r.photos as any[]).slice(0, 3).map(p =>
        `<img src="${escHtml(p.uri)}" style="width:130px;height:95px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0" onerror="this.style.opacity='0.1'"/>`
      ).join('');
      return `<div style="margin-bottom:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <div style="background:#f8fafc;padding:8px 12px;font-size:11px;font-weight:700;color:#1e293b;border-bottom:1px solid #e2e8f0">
          <span style="color:#003082">#${i + 1}</span> ${escHtml(r.title)}
          <span style="color:#94a3b8;font-weight:400;margin-left:8px">— ${cos.map(c => escHtml(c)).join(', ') || '—'} · Bât. ${escHtml(r.building || '?')}</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px">${imgs}</div>
      </div>`;
    }).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport Réserves — ${escHtml(chantierName)}</title>
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
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.75;margin-bottom:4px">BuildTrack · Rapport des réserves</div>
    <div style="font-size:22px;font-weight:800;margin-bottom:2px">${escHtml(chantierName)}</div>
    <div style="font-size:13px;opacity:0.8">${escHtml(companyLabel)} · Généré le ${dateStr}</div>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
    <div style="text-align:center;background:#f8fafc;border-radius:8px;padding:10px 20px;border:1px solid #e2e8f0">
      <div style="font-size:28px;font-weight:800;color:#003082">${total}</div>
      <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-top:2px">Total réserves</div>
    </div>
    ${summaryStats}
  </div>
  <div style="margin-bottom:20px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:10px">Récapitulatif par entreprise</div>
    <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#003082">
        <th style="color:#fff;padding:8px 12px;text-align:left;font-size:10px">Entreprise</th>
        <th style="color:#fff;padding:8px 12px;text-align:center;font-size:10px">Total</th>
        <th style="color:#fff;padding:8px 12px;text-align:center;font-size:10px">Clôturées</th>
        <th style="color:#fff;padding:8px 12px;text-align:center;font-size:10px">Taux clôture</th>
      </tr></thead>
      <tbody>${companyRows}</tbody>
    </table>
  </div>
  <div style="margin-bottom:20px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:10px">
      Liste détaillée (${total} réserve${total !== 1 ? 's' : ''})
    </div>
    <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#003082">
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">#</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Titre</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Entreprise</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Localisation</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Statut</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Priorité</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Échéance</th>
      </tr></thead>
      <tbody>${reserveRows}</tbody>
    </table>
  </div>
  ${photoSection ? `<div style="margin-bottom:20px">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:10px">Photos</div>
    ${photoSection}
  </div>` : ''}
  <div style="margin-top:24px;padding-top:12px;border-top:1.5px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8">
    <span>Généré par BuildTrack</span>
    <span>${escHtml(chantierName)} · ${dateStr}</span>
  </div>
</body>
</html>`;
}

// ── Individual Reserve HTML ───────────────────────────────────────────────────
export function buildIndividualReserveHtml(payload: any): string {
  const { reserve, chantierName, companyColor, planUri, planX, planY, planName, pinNum } = payload;
  const sColors = RESERVE_STATUS_COLORS as Record<string, string>;
  const sLabels = RESERVE_STATUS_LABELS_FEMININE as Record<string, string>;
  const pColors = RESERVE_PRIORITY_COLORS as Record<string, string>;
  const pLabels = RESERVE_PRIORITY_LABELS as Record<string, string>;
  const pinColor: string = companyColor || '#003082';
  const sColor = sColors[reserve.status] ?? '#6B7280';
  const sLabel = sLabels[reserve.status] ?? reserve.status;
  const pColor = pColors[reserve.priority] ?? '#6B7280';
  const pLabel = pLabels[reserve.priority] ?? reserve.priority;
  const companies: string[] = Array.isArray(reserve.companies) && reserve.companies.length > 0 ? reserve.companies : reserve.company ? [reserve.company] : [];
  const dateStr = new Date().toLocaleDateString('fr-FR');

  let planSection = '';
  if (planUri && planX != null && planY != null) {
    planSection = `
      <div style="margin-bottom:10px">
        <div style="font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #DDE4EE">Plan de localisation — ${escHtml(planName || 'Plan')}</div>
        <div style="position:relative;border-radius:8px;overflow:hidden;border:1.5px solid #DDE4EE">
          <img src="${escHtml(planUri)}" style="width:100%;height:auto;display:block" onerror="this.style.display='none'"/>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;top:0;left:0;width:100%;height:100%">
            <circle cx="${planX}" cy="${planY}" r="2.2" fill="${pinColor}" stroke="#fff" stroke-width="0.55"/>
            <text x="${planX}" y="${planY}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="3.5" font-weight="bold" font-family="Arial,sans-serif">${pinNum || 1}</text>
          </svg>
        </div>
      </div>`;
  } else {
    planSection = `<div style="width:100%;height:100px;border-radius:8px;border:1.5px dashed #DDE4EE;background:#F9FAFB;display:flex;align-items:center;justify-content:center;margin-bottom:10px;font-size:11px;color:#9CA3AF">Aucun plan associé</div>`;
  }

  const rawPhotos: any[] = Array.isArray(reserve.photos) && reserve.photos.length > 0
    ? reserve.photos
    : reserve.photoUri ? [{ uri: reserve.photoUri, kind: 'defect' }] : [];
  const photosToShow = rawPhotos.slice(0, 3).filter((p: any) => p.uri && p.uri.startsWith('http'));

  const photoRowHtml = photosToShow.length > 0 ? `
    <div style="margin-top:10px">
      <div style="font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #DDE4EE">Photos (${photosToShow.length})</div>
      <div style="display:flex;gap:8px">
        ${photosToShow.map((p: any) => {
          const isDefect = p.kind === 'defect';
          return `<div style="flex:1;min-width:0;text-align:center">
            <img src="${escHtml(p.uri)}" onerror="this.style.opacity='0.15'"
              style="width:100%;height:auto;max-height:240px;object-fit:contain;background:#F9FAFB;border-radius:6px;border:1.5px solid #DDE4EE;display:block"/>
            <span style="display:inline-block;margin-top:4px;padding:1px 7px;border-radius:8px;font-size:9px;font-weight:700;background:${isDefect ? '#FEF2F2' : '#ECFDF5'};color:${isDefect ? '#DC2626' : '#059669'}">
              ${isDefect ? '● Constat' : '● Levée'}
            </span>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const historyRows = [...(reserve.history || [])].reverse().slice(0, 5).map((h: any) =>
    `<tr>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;white-space:nowrap">${escHtml(h.createdAt)}</td>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;font-weight:600">${escHtml(h.action)}</td>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;color:#6B7280">${escHtml(h.author)}</td>
      ${h.oldValue && h.newValue ? `<td style="padding:4px 8px;font-size:9px;color:#6B7280;border-bottom:1px solid #EEF3FA">${escHtml(h.oldValue)} → ${escHtml(h.newValue)}</td>` : '<td></td>'}
    </tr>`
  ).join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <title>Fiche réserve ${escHtml(reserve.id)}</title>
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
        <div style="font-size:8px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Fiche de réserve · BuildTrack</div>
        <div style="font-size:22px;font-weight:900;color:#003082;line-height:1">${escHtml(reserve.id)}</div>
        <div style="font-size:14px;font-weight:700;color:#1A2742;margin-top:2px">${escHtml(reserve.title)}</div>
        <div style="font-size:10px;color:#6B7280">${escHtml(chantierName)}</div>
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap">
          <span class="badge" style="background:${sColor}22;color:${sColor}">${sLabel}</span>
          <span class="badge" style="background:${pColor}18;color:${pColor}">${pLabel}</span>
        </div>
      </div>
      <div style="text-align:right;font-size:10px;color:#6B7280;flex-shrink:0;margin-left:16px">
        <div>Créé le <strong style="color:#1A2742">${escHtml(reserve.createdAt)}</strong></div>
        ${reserve.closedAt ? `<div style="color:#059669;margin-top:2px;font-weight:700">✓ Clôturé le ${escHtml(reserve.closedAt)}</div>` : ''}
        <div style="margin-top:4px">Échéance : <strong>${escHtml(reserve.deadline || '—')}</strong></div>
        <div style="font-size:9px;color:#9CA3AF;margin-top:4px">${dateStr}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        <div class="col2" style="margin-bottom:8px">
          <div class="info-cell">
            <div class="lbl">Entreprise${companies.length > 1 ? 's' : ''}</div>
            <div class="val" style="color:${pinColor}">${companies.map(c => escHtml(c)).join(', ') || '—'}</div>
          </div>
          <div class="info-cell">
            <div class="lbl">Localisation</div>
            <div class="val">Bât. ${escHtml(reserve.building)} · ${escHtml(reserve.level)}</div>
          </div>
        </div>
        <div class="col2" style="margin-bottom:8px">
          <div class="info-cell">
            <div class="lbl">Zone</div>
            <div class="val">${escHtml(reserve.zone || '—')}</div>
          </div>
          <div class="info-cell">
            <div class="lbl">Échéance</div>
            <div class="val" style="color:${reserve.status !== 'closed' ? '#DC2626' : '#059669'}">${escHtml(reserve.deadline || '—')}</div>
          </div>
        </div>
        <div class="desc-box">${escHtml(getReserveDescriptionText(reserve.description, reserve.title))}</div>
        ${photoRowHtml}
      </div>
      <div>${planSection}</div>
    </div>
    ${historyRows ? `<div class="sh">Historique</div>
    <table><thead><tr><th>Date</th><th>Action</th><th>Auteur</th><th>Détail</th></tr></thead>
    <tbody>${historyRows}</tbody></table>` : ''}
    <div style="margin-top:16px;display:flex;gap:20px">
      <div style="flex:1;text-align:center"><div style="height:50px;border-bottom:2px solid #1A2742;margin-bottom:5px"></div><div style="font-size:10px;color:#5E738A">Conducteur de travaux</div></div>
      <div style="flex:1;text-align:center"><div style="height:50px;border-bottom:2px solid #1A2742;margin-bottom:5px"></div><div style="font-size:10px;color:#5E738A">${companies.map(c => escHtml(c)).join(', ') || 'Entreprise'}</div></div>
    </div>
    <div class="doc-footer">
      <span>Fiche réserve · BuildTrack</span>
      <span>${escHtml(chantierName)} · ${dateStr}</span>
    </div>
  </div></body></html>`;
}

function escHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STATUS_FR = RESERVE_STATUS_LABELS as Record<string, string>;
const STATUS_COLORS = RESERVE_STATUS_COLORS as Record<string, string>;
const PRIORITY_FR = RESERVE_PRIORITY_LABELS as Record<string, string>;
const PRIORITY_COLORS = RESERVE_PRIORITY_COLORS as Record<string, string>;

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildReserveRow(r: PdfReserveItem, idx: number): string {
  const statusColor = STATUS_COLORS[r.status] ?? '#6b7280';
  const priorityColor = PRIORITY_COLORS[r.priority] ?? '#6b7280';
  const bg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
  return `<tr style="background:${bg}">
    <td style="text-align:center;width:36px;padding:7px 10px">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#003082;color:#fff;font-weight:700;font-size:11px">${idx + 1}</span>
    </td>
    <td style="padding:7px 10px;font-weight:600">${escapeHtml(r.title)}</td>
    <td style="padding:7px 10px">${escapeHtml(r.company) || '—'}</td>
    <td style="padding:7px 10px">${escapeHtml(r.level) || '—'}</td>
    <td style="padding:7px 10px"><span style="color:${statusColor};font-weight:600">${STATUS_FR[r.status] ?? r.status}</span></td>
    <td style="padding:7px 10px"><span style="color:${priorityColor};font-weight:600">${PRIORITY_FR[r.priority] ?? r.priority}</span></td>
    <td style="padding:7px 10px">${escapeHtml(r.deadline) || '—'}</td>
  </tr>`;
}

function buildTableHeader(bgColor = '#003082'): string {
  return `<thead><tr style="background:${bgColor}">
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">#</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">Titre</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">Entreprise</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">Niveau</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">Statut</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">Priorité</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">Échéance</th>
  </tr></thead>`;
}

function buildPlanBlock(plan: PdfPlanItem, planReserves: PdfReserveItem[]): string {
  const levelBadge = plan.level
    ? `<span style="font-size:11px;background:#e2e8f0;color:#64748b;padding:2px 8px;border-radius:10px;margin-left:8px">${escapeHtml(plan.level)}</span>`
    : '';

  let planImgHtml = '';
  if (plan.uri && plan.fileType !== 'pdf' && plan.fileType !== 'dxf') {
    const pinsWithCoords = planReserves.filter(r => r.planX != null && r.planY != null);
    const circles = pinsWithCoords
      .map((r, i) => `
        <circle cx="${r.planX}%" cy="${r.planY}%" r="10"
          fill="#003082" stroke="rgba(255,255,255,0.85)" stroke-width="1.5"/>
        <text x="${r.planX}%" y="${r.planY}%"
          text-anchor="middle" dominant-baseline="central"
          fill="#fff" font-size="9" font-weight="bold" font-family="Arial,sans-serif">${i + 1}</text>`)
      .join('');
    planImgHtml = `
      <div style="position:relative;width:100%;margin:12px 0">
        <img src="${escapeHtml(plan.uri)}"
          style="width:100%;height:auto;display:block;border-radius:6px;border:1px solid #e2e8f0"
          onerror="this.style.display='none'"/>
        ${circles
          ? `<svg xmlns="http://www.w3.org/2000/svg"
              style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible">${circles}</svg>`
          : ''}
      </div>`;
  }

  const rows = planReserves.map((r, i) => buildReserveRow(r, i)).join('');

  const photoBlocks = planReserves
    .filter(r => r.photos && r.photos.length > 0)
    .map((r, i) => {
      const imgs = r.photos
        .slice(0, 2)
        .map(p => `<img src="${escapeHtml(p.uri)}"
          style="width:130px;height:95px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0"
          onerror="this.style.opacity='0.15'"/>`)
        .join('');
      return `<div style="padding:8px 12px;border-bottom:1px solid #f1f5f9">
        <div style="font-size:10px;color:#64748b;margin-bottom:5px;font-weight:600">
          #${i + 1} ${escapeHtml(r.title)}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${imgs}</div>
      </div>`;
    })
    .join('');

  return `
    <div style="background:#fff;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:14px;overflow:hidden">
      <div style="background:#f8fafc;padding:10px 16px;font-size:12px;font-weight:700;color:#1e293b;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:6px">
        📐 ${escapeHtml(plan.name)}${levelBadge}
        <span style="margin-left:auto;font-size:11px;color:#94a3b8;font-weight:400">
          ${planReserves.length} réserve${planReserves.length !== 1 ? 's' : ''}
        </span>
      </div>
      ${planImgHtml ? `<div style="padding:12px 16px">${planImgHtml}</div>` : ''}
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        ${buildTableHeader()}
        <tbody>${rows}</tbody>
      </table>
      ${photoBlocks
        ? `<div style="background:#f8fafc;padding:8px 12px;font-size:10px;font-weight:700;color:#475569;border-top:1px solid #e2e8f0">
            📷 Photos
           </div>${photoBlocks}`
        : ''}
    </div>`;
}

export function buildGlobalReportHtml(payload: PdfReportPayload): string {
  const { chantierName, companyFilter, generatedAt, plans, reserves } = payload;

  const reservesByPlan = new Map<string, PdfReserveItem[]>();
  const orphanReserves: PdfReserveItem[] = [];

  for (const r of reserves) {
    if (!r.planId) {
      orphanReserves.push(r);
    } else {
      if (!reservesByPlan.has(r.planId)) reservesByPlan.set(r.planId, []);
      reservesByPlan.get(r.planId)!.push(r);
    }
  }

  const activePlanIds = new Set(reservesByPlan.keys());
  const plansWithReserves = plans.filter(p => activePlanIds.has(p.id));

  const buildingSet = new Set<string>();
  for (const p of plansWithReserves) buildingSet.add(p.building ?? '');
  const buildingNames = Array.from(buildingSet).sort((a, b) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, 'fr');
  });

  const buildingSections: string[] = [];

  for (const building of buildingNames) {
    const buildingPlans = plansWithReserves.filter(p => (p.building ?? '') === building);
    const buildingLabel = building || 'Sans bâtiment';
    const planBlocks: string[] = [];
    let buildingReserveCount = 0;

    for (const plan of buildingPlans) {
      const planReserves = reservesByPlan.get(plan.id) ?? [];
      if (planReserves.length === 0) continue;
      buildingReserveCount += planReserves.length;
      planBlocks.push(buildPlanBlock(plan, planReserves));
    }

    if (buildingReserveCount === 0) continue;

    buildingSections.push(`
      <div style="margin-bottom:24px;page-break-inside:avoid">
        <div style="background:linear-gradient(135deg,#003082 0%,#1A6FD8 100%);color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:10px">
          🏗️ ${escapeHtml(buildingLabel)}
          <span style="margin-left:auto;font-size:12px;opacity:0.8;font-weight:400">
            ${buildingReserveCount} réserve${buildingReserveCount !== 1 ? 's' : ''}
          </span>
        </div>
        ${planBlocks.join('')}
      </div>`);
  }

  let orphanHtml = '';
  if (orphanReserves.length > 0) {
    const orphanRows = orphanReserves
      .map((r, i) => {
        const statusColor = STATUS_COLORS[r.status] ?? '#6b7280';
        const priorityColor = PRIORITY_COLORS[r.priority] ?? '#6b7280';
        const bg = i % 2 === 0 ? '#fff' : '#f9fafb';
        return `<tr style="background:${bg}">
          <td style="text-align:center;width:36px;padding:7px 10px">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#475569;color:#fff;font-weight:700;font-size:11px">${i + 1}</span>
          </td>
          <td style="padding:7px 10px;font-weight:600">${escapeHtml(r.title)}</td>
          <td style="padding:7px 10px">${escapeHtml(r.company) || '—'}</td>
          <td style="padding:7px 10px">${escapeHtml(r.building) || '—'}</td>
          <td style="padding:7px 10px">${escapeHtml(r.level) || '—'}</td>
          <td style="padding:7px 10px"><span style="color:${statusColor};font-weight:600">${STATUS_FR[r.status] ?? r.status}</span></td>
          <td style="padding:7px 10px"><span style="color:${priorityColor};font-weight:600">${PRIORITY_FR[r.priority] ?? r.priority}</span></td>
          <td style="padding:7px 10px">${escapeHtml(r.deadline) || '—'}</td>
        </tr>`;
      })
      .join('');

    orphanHtml = `
      <div style="margin-bottom:24px">
        <div style="background:linear-gradient(135deg,#475569 0%,#64748b 100%);color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:10px">
          📍 Réserves hors plan
          <span style="margin-left:auto;font-size:12px;opacity:0.8;font-weight:400">
            ${orphanReserves.length} réserve${orphanReserves.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div style="background:#fff;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;overflow:hidden">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:#475569">
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">#</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Titre</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Entreprise</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Bâtiment</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Niveau</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Statut</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Priorité</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">Échéance</th>
            </tr></thead>
            <tbody>${orphanRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  const totalReserves = reserves.length;
  const byStatus = new Map<string, number>();
  for (const r of reserves) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  const summaryRows = ['open', 'in_progress', 'waiting', 'verification', 'closed']
    .map(s => {
      const count = byStatus.get(s) ?? 0;
      if (count === 0) return '';
      const color = STATUS_COLORS[s];
      const pct = totalReserves > 0 ? Math.round((count / totalReserves) * 100) : 0;
      return `<tr>
        <td style="padding:8px 12px">
          <span style="color:${color};font-weight:600">${STATUS_FR[s] ?? s}</span>
        </td>
        <td style="padding:8px 12px;text-align:right;font-weight:700">${count}</td>
        <td style="padding:8px 12px;text-align:right;color:#94a3b8">${pct}%</td>
        <td style="padding:8px 12px;width:40%">
          <div style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden">
            <div style="background:${color};height:8px;width:${pct}%"></div>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  const companyLabel = companyFilter ?? 'Toutes les entreprises';
  const dateStr = new Date(generatedAt).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const totalBuildings = buildingSections.length;
  const totalPlans = plansWithReserves.length;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport des réserves — ${escapeHtml(chantierName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #fff; color: #1e293b; font-size: 12px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif; }
    @page { margin: 15mm 12mm; size: A4; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    tbody tr:hover { background: #f1f5f9; }
    .cover { display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 90vh; text-align: center; padding: 60px 40px; page-break-after: always; }
  </style>
</head>
<body>
  <div class="cover">
    <div style="font-size:48px;margin-bottom:20px">📋</div>
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#003082;font-weight:700;margin-bottom:12px">
      BuildTrack
    </div>
    <div style="font-size:28px;font-weight:800;color:#1e293b;margin-bottom:8px">Rapport des réserves</div>
    <div style="font-size:18px;color:#64748b;margin-bottom:6px">${escapeHtml(chantierName)}</div>
    <div style="font-size:14px;color:#94a3b8;margin-bottom:32px">${escapeHtml(companyLabel)}</div>
    <div style="display:flex;gap:40px;margin:16px 0">
      <div style="text-align:center">
        <div style="font-size:40px;font-weight:800;color:#003082">${totalReserves}</div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:4px">réserves</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:40px;font-weight:800;color:#003082">${totalBuildings}</div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:4px">bâtiments</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:40px;font-weight:800;color:#003082">${totalPlans}</div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:4px">plans</div>
      </div>
    </div>
    <div style="margin-top:20px;padding:12px 24px;background:#f0f4ff;border-radius:8px;border:1px solid #c7d2fe;font-size:11px;color:#475569">
      Généré le ${dateStr}
    </div>
  </div>

  <div style="padding:20px 24px">
    ${buildingSections.join('\n')}
    ${orphanHtml}

    ${summaryRows ? `
    <div style="margin-top:32px;page-break-before:auto">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:12px">
        Synthèse par statut
      </div>
      <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <tbody>${summaryRows}</tbody>
      </table>
    </div>` : ''}

    <div style="margin-top:32px;padding-top:14px;border-top:1.5px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8">
      <span>Généré par BuildTrack — ${escapeHtml(chantierName)}</span>
      <span>Document confidentiel · ${dateStr}</span>
    </div>
  </div>
</body>
</html>`;
}
