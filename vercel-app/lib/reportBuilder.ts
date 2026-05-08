import type { PdfReportPayload, PdfPlanItem, PdfReserveItem } from '../types/pdfReport';

const STATUS_FR: Record<string, string> = {
  open: 'Ouvert',
  in_progress: 'En cours',
  waiting: 'En attente',
  verification: 'Vérification',
  closed: 'Clôturé',
};

const STATUS_COLORS: Record<string, string> = {
  open: '#ef4444',
  in_progress: '#3b82f6',
  waiting: '#f59e0b',
  verification: '#8b5cf6',
  closed: '#22c55e',
};

const PRIORITY_FR: Record<string, string> = {
  critical: 'Critique',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#3b82f6',
  low: '#6b7280',
};

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
