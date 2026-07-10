import type { PdfReportPayload, PdfPlanItem, PdfReserveItem } from '../types/pdfReport';
import {
  RESERVE_PRIORITY_COLORS,
  RESERVE_PRIORITY_LABELS,
  RESERVE_STATUS_COLORS,
  RESERVE_STATUS_LABELS,
  RESERVE_STATUS_LABELS_FEMININE,
} from '@/lib/reserveLabels';
import { getReserveDescriptionText, hasCustomReserveDescription } from '@/lib/reserveDescription';

type ReportLanguage = 'fr' | 'en' | 'es';

// Un <img> n'est inliné dans le PDF que si son URL est distante ou déjà une
// data-URL (le pipeline serveur bloque les hôtes non autorisés / blob:).
const PDF_EMBEDDABLE_URI_RE = /^(https?:|data:image\/)/i;

/**
 * Calque SVG des annotations d'une photo (format partagé mobile/web, champ
 * annotations du JSONB reserves.photos). Dans le PDF, la boîte de l'<img>
 * épouse l'image (width fixe, height auto) : les annotations coordSpace
 * 'image' et legacy (% du cadre) se rendent donc à l'identique sur la boîte
 * entière — aucun calcul de letterbox n'est nécessaire ici.
 * Retourne '' sans annotation.
 */
function buildReservePhotoAnnotationsSvg(annotations: unknown): string {
  const items = Array.isArray(annotations) ? annotations.filter(item => item && typeof item === 'object') : [];
  if (items.length === 0) return '';
  const clampPct = (value: unknown, fallback = 50) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : fallback;
  };
  const shapes = items.map((item: any) => {
    const color = typeof item.color === 'string' && item.color.trim() ? escapeHtml(item.color.trim()) : '#EF4444';
    const points = (Array.isArray(item.points) ? item.points : [])
      .map((point: any) => ({ x: Number(point?.x), y: Number(point?.y) }))
      .filter((point: any) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map((point: any) => ({ x: clampPct(point.x), y: clampPct(point.y) }));
    if (item.tool === 'pen' && points.length > 0) {
      // Trait d'un seul point = pastille (même convention que web/mobile).
      if (points.length === 1) {
        return `<circle cx="${points[0].x}" cy="${points[0].y}" r="1.2" fill="${color}"/>`;
      }
      const path = points.map((point: any) => `${point.x},${point.y}`).join(' ');
      return `<polyline points="${path}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    const x = clampPct(item.x ?? points[0]?.x);
    const y = clampPct(item.y ?? points[0]?.y);
    if (item.tool === 'text') {
      const label = String(item.label ?? item.text ?? '').trim().slice(0, 18);
      if (!label) return '';
      // Petite étiquette : rectangle arrondi de la couleur + texte blanc.
      const boxWidth = Math.min(64, label.length * 3 + 6);
      const left = Math.max(0, Math.min(100 - boxWidth, x - boxWidth / 2));
      const top = Math.max(0, Math.min(92, y - 4));
      return `<g><rect x="${left}" y="${top}" width="${boxWidth}" height="8" rx="2" fill="${color}"/>`
        + `<text x="${left + boxWidth / 2}" y="${top + 4}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="4.5" font-family="Arial,sans-serif">${escapeHtml(label)}</text></g>`;
    }
    // dot / arrow / rect / measure : pastille numérotée pleine.
    const label = String(item.label ?? '').trim().slice(0, 2) || '•';
    return `<g><circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#fff" stroke-width="0.8"/>`
      + `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="5" font-weight="bold" font-family="Arial,sans-serif">${escapeHtml(label)}</text></g>`;
  }).filter(Boolean).join('');
  if (!shapes) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${shapes}</svg>`;
}

/**
 * Pile verticale de miniatures pour la cellule « Observation » d'un tableau de
 * réserves — mise en page du rapport de pendientes : photos empilées sous le
 * texte, dans la cellule, plutôt qu'en section séparée. Les annotations de
 * chaque photo sont rendues en surimpression SVG (aucun <img> supplémentaire :
 * la limite d'images du pipeline serveur n'est pas impactée).
 * Retourne '' sans photo.
 */
function buildReservePhotoStackHtml(
  photos: Array<{ uri?: string | null; annotations?: unknown }> | undefined,
  opts?: { omittedNote?: string | null; width?: number },
): string {
  const width = opts?.width ?? 108;
  const usable = (photos ?? []).filter(p => typeof p?.uri === 'string' && PDF_EMBEDDABLE_URI_RE.test(p.uri.trim()));
  if (usable.length === 0) return '';
  const imgs = usable.map(p =>
    `<div style="margin-top:6px;page-break-inside:avoid">
      <div style="position:relative;width:${width}px;max-width:100%">
        <img src="${escapeHtml(p.uri as string)}" onerror="this.style.opacity='0.15'"
          style="width:100%;height:auto;display:block;border-radius:4px;border:1px solid #DDE4EE;background:#F9FAFB"/>
        ${buildReservePhotoAnnotationsSvg(p.annotations)}
      </div>
    </div>`,
  ).join('');
  const omitted = opts?.omittedNote
    ? `<div style="margin-top:4px;font-size:9px;color:#94A3B8">${escapeHtml(opts.omittedNote)}</div>`
    : '';
  return `${imgs}${omitted}`;
}

const PHOTOS_PER_RESERVE_IN_REPORT = 3;

const REPORT_LOCALES: Record<ReportLanguage, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
};

const STATUS_LABELS_I18N: Record<ReportLanguage, Record<string, string>> = {
  fr: RESERVE_STATUS_LABELS,
  en: { open: 'Open', in_progress: 'In progress', waiting: 'Pending', verification: 'Verification', closed: 'Closed' },
  es: { open: 'Abierta', in_progress: 'En curso', waiting: 'En espera', verification: 'Verificación', closed: 'Cerrada' },
};

const STATUS_LABELS_FEMININE_I18N: Record<ReportLanguage, Record<string, string>> = {
  fr: RESERVE_STATUS_LABELS_FEMININE,
  en: STATUS_LABELS_I18N.en,
  es: STATUS_LABELS_I18N.es,
};

const PRIORITY_LABELS_I18N: Record<ReportLanguage, Record<string, string>> = {
  fr: RESERVE_PRIORITY_LABELS,
  en: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' },
  es: { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' },
};

const REPORT_COPY = {
  fr: {
    allCompanies: 'Toutes les entreprises', noValue: '—', noBuilding: 'Sans bâtiment', reportReservesTitle: 'Rapport des réserves', reportPlansTitle: 'Rapport des plans', reserveSheetTitle: 'Fiche de réserve', generatedOn: 'Généré le', generatedBy: 'Généré par BuildTrack', confidential: 'Document confidentiel', totalReserves: 'Total réserves', reserves: 'réserves', buildings: 'bâtiments', plans: 'plans', companySummary: 'Récapitulatif par entreprise', company: 'Entreprise', total: 'Total', closed: 'Clôturées', closureRate: 'Taux clôture', title: 'Titre', location: 'Localisation', status: 'Statut', priority: 'Priorité', deadline: 'Échéance', building: 'Bâtiment', buildingShort: 'Bât.', level: 'Niveau', zone: 'Zone', photos: 'Photos', history: 'Historique', date: 'Date', action: 'Action', author: 'Auteur', detail: 'Détail', createdOn: 'Créé le', closedOn: 'Clôturé le', locationPlan: 'Plan de localisation', noPlan: 'Aucun plan associé', defect: 'Constat', resolved: 'Levée', manager: 'Conducteur de travaux', offPlan: 'Réserves hors plan', statusSummary: 'Synthèse par statut',
    observation: 'Observation', photosMore: (count: number) => `+${count} photo${count !== 1 ? 's' : ''} non incluse${count !== 1 ? 's' : ''}`,
    detailedList: (count: number) => `Liste détaillée (${count} réserve${count !== 1 ? 's' : ''})`, reserveCount: (count: number) => `${count} réserve${count !== 1 ? 's' : ''}`,
  },
  en: {
    allCompanies: 'All companies', noValue: '—', noBuilding: 'No building', reportReservesTitle: 'Issues report', reportPlansTitle: 'Plans report', reserveSheetTitle: 'Issue sheet', generatedOn: 'Generated on', generatedBy: 'Generated by BuildTrack', confidential: 'Confidential document', totalReserves: 'Total issues', reserves: 'issues', buildings: 'buildings', plans: 'plans', companySummary: 'Summary by company', company: 'Company', total: 'Total', closed: 'Closed', closureRate: 'Closure rate', title: 'Title', location: 'Location', status: 'Status', priority: 'Priority', deadline: 'Deadline', building: 'Building', buildingShort: 'Bldg.', level: 'Level', zone: 'Zone', photos: 'Photos', history: 'History', date: 'Date', action: 'Action', author: 'Author', detail: 'Detail', createdOn: 'Created on', closedOn: 'Closed on', locationPlan: 'Location plan', noPlan: 'No linked plan', defect: 'Issue', resolved: 'Resolved', manager: 'Construction manager', offPlan: 'Issues without plan', statusSummary: 'Status summary',
    observation: 'Observation', photosMore: (count: number) => `+${count} more photo${count !== 1 ? 's' : ''} not included`,
    detailedList: (count: number) => `Detailed list (${count} issue${count !== 1 ? 's' : ''})`, reserveCount: (count: number) => `${count} issue${count !== 1 ? 's' : ''}`,
  },
  es: {
    allCompanies: 'Todas las empresas', noValue: '—', noBuilding: 'Sin edificio', reportReservesTitle: 'Informe de reservas', reportPlansTitle: 'Informe de planos', reserveSheetTitle: 'Ficha de reserva', generatedOn: 'Generado el', generatedBy: 'Generado por BuildTrack', confidential: 'Documento confidencial', totalReserves: 'Total reservas', reserves: 'reservas', buildings: 'edificios', plans: 'planos', companySummary: 'Resumen por empresa', company: 'Empresa', total: 'Total', closed: 'Cerradas', closureRate: 'Tasa de cierre', title: 'Título', location: 'Localización', status: 'Estado', priority: 'Prioridad', deadline: 'Fecha límite', building: 'Edificio', buildingShort: 'Edif.', level: 'Nivel', zone: 'Zona', photos: 'Fotos', history: 'Historial', date: 'Fecha', action: 'Acción', author: 'Autor', detail: 'Detalle', createdOn: 'Creada el', closedOn: 'Cerrada el', locationPlan: 'Plano de localización', noPlan: 'Sin plano asociado', defect: 'Constatación', resolved: 'Levantada', manager: 'Jefe de obra', offPlan: 'Reservas sin plano', statusSummary: 'Resumen por estado',
    observation: 'Observación', photosMore: (count: number) => `+${count} foto${count !== 1 ? 's' : ''} no incluida${count !== 1 ? 's' : ''}`,
    detailedList: (count: number) => `Lista detallada (${count} reserva${count !== 1 ? 's' : ''})`, reserveCount: (count: number) => `${count} reserva${count !== 1 ? 's' : ''}`,
  },
} as const;

function reportLanguage(language?: string | null): ReportLanguage {
  const normalized = String(language ?? '').trim().toLowerCase();
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('es')) return 'es';
  return 'fr';
}

function statusLabel(status: string | undefined, language: ReportLanguage, feminine = false): string {
  const labels = feminine ? STATUS_LABELS_FEMININE_I18N[language] : STATUS_LABELS_I18N[language];
  return labels[status ?? ''] ?? status ?? REPORT_COPY[language].noValue;
}

function priorityLabel(priority: string | undefined, language: ReportLanguage): string {
  return PRIORITY_LABELS_I18N[language][priority ?? ''] ?? priority ?? REPORT_COPY[language].noValue;
}

// ── Global Reserves HTML (no plans needed) ────────────────────────────────────
export function buildGlobalReservesHtml(payload: any): string {
  const { chantierName, companyFilter, generatedAt, reserves } = payload;
  const lang = reportLanguage(payload.language);
  const copy = REPORT_COPY[lang];
  const dateStr = new Date(generatedAt || Date.now()).toLocaleDateString(REPORT_LOCALES[lang], { day: '2-digit', month: 'long', year: 'numeric' });
  const companyLabel = (companyFilter as string | null) ?? copy.allCompanies;

  const S_FR = STATUS_LABELS_I18N[lang] as Record<string, string>;
  const S_COL = RESERVE_STATUS_COLORS as Record<string, string>;
  const P_FR = PRIORITY_LABELS_I18N[lang] as Record<string, string>;
  const P_COL = RESERVE_PRIORITY_COLORS as Record<string, string>;

  const byStatus: Record<string, number> = {};
  for (const r of reserves) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const total = (reserves as any[]).length;

  const byCompany: Record<string, { total: number; closed: number }> = {};
  for (const r of reserves as any[]) {
    const names: string[] = Array.isArray(r.companies) && r.companies.length > 0 ? r.companies : r.company ? [r.company] : [copy.noValue];
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
      const cos: string[] = Array.isArray(r.companies) && r.companies.length > 0 ? r.companies : r.company ? [r.company] : [copy.noValue];
      // Colonne « Observation » : titre, description éventuelle, puis photos
      // empilées (comme le rapport de pendientes de référence).
      const rawPhotos: any[] = Array.isArray(r.photos) ? r.photos : [];
      const photoStack = buildReservePhotoStackHtml(
        rawPhotos.slice(0, PHOTOS_PER_RESERVE_IN_REPORT),
        { omittedNote: rawPhotos.length > PHOTOS_PER_RESERVE_IN_REPORT ? copy.photosMore(rawPhotos.length - PHOTOS_PER_RESERVE_IN_REPORT) : null },
      );
      const desc = hasCustomReserveDescription(r.description, r.title) ? String(r.description ?? '').trim() : '';
      const descHtml = desc ? `<div style="color:#64748b;font-size:10px;margin-top:2px">${escHtml(desc.length > 240 ? desc.slice(0, 240) + '…' : desc)}</div>` : '';
      return `<tr style="background:${bg}">
        <td style="text-align:center;width:36px;padding:6px 8px;vertical-align:top">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#003082;color:#fff;font-weight:700;font-size:10px">${i + 1}</span>
        </td>
        <td style="padding:6px 8px;font-size:11px;vertical-align:top;min-width:150px"><div style="font-weight:600">${escHtml(r.title)}</div>${descHtml}${photoStack}</td>
        <td style="padding:6px 8px;font-size:11px;vertical-align:top">${cos.map(c => escHtml(c)).join(', ')}</td>
        <td style="padding:6px 8px;font-size:11px;vertical-align:top">${copy.buildingShort} ${escHtml(r.building || '?')} · ${escHtml(r.level || copy.noValue)}</td>
        <td style="padding:6px 8px;vertical-align:top"><span style="color:${sc};font-weight:600;font-size:10px">${S_FR[r.status] ?? r.status}</span></td>
        <td style="padding:6px 8px;vertical-align:top"><span style="color:${pc};font-weight:600;font-size:10px">${P_FR[r.priority] ?? r.priority}</span></td>
        <td style="padding:6px 8px;font-size:11px;vertical-align:top">${escHtml(r.deadline) || '—'}</td>
      </tr>`;
    }).join('');

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>${copy.reportReservesTitle} — ${escHtml(chantierName)}</title>
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
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.75;margin-bottom:4px">BuildTrack · ${copy.reportReservesTitle}</div>
    <div style="font-size:22px;font-weight:800;margin-bottom:2px">${escHtml(chantierName)}</div>
    <div style="font-size:13px;opacity:0.8">${escHtml(companyLabel)} · ${copy.generatedOn} ${dateStr}</div>
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
        <th style="color:#fff;padding:8px 12px;text-align:center;font-size:10px">Total</th>
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
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.observation}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.company}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.location}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.status}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.priority}</th>
        <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.deadline}</th>
      </tr></thead>
      <tbody>${reserveRows}</tbody>
    </table>
  </div>
  <div style="margin-top:24px;padding-top:12px;border-top:1.5px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8">
    <span>${copy.generatedBy}</span>
    <span>${escHtml(chantierName)} · ${dateStr}</span>
  </div>
</body>
</html>`;
}

// ── Individual Reserve HTML ───────────────────────────────────────────────────
export function buildIndividualReserveHtml(payload: any): string {
  const { reserve, chantierName, companyColor, planUri, planX, planY, planName, pinNum } = payload;
  const lang = reportLanguage(payload.language);
  const copy = REPORT_COPY[lang];
  const sColors = RESERVE_STATUS_COLORS as Record<string, string>;
  const sLabels = STATUS_LABELS_FEMININE_I18N[lang] as Record<string, string>;
  const pColors = RESERVE_PRIORITY_COLORS as Record<string, string>;
  const pLabels = PRIORITY_LABELS_I18N[lang] as Record<string, string>;
  const pinColor: string = companyColor || '#003082';
  const sColor = sColors[reserve.status] ?? '#6B7280';
  const sLabel = sLabels[reserve.status] ?? reserve.status;
  const pColor = pColors[reserve.priority] ?? '#6B7280';
  const pLabel = pLabels[reserve.priority] ?? reserve.priority;
  const companies: string[] = Array.isArray(reserve.companies) && reserve.companies.length > 0 ? reserve.companies : reserve.company ? [reserve.company] : [];
  const dateStr = new Date().toLocaleDateString(REPORT_LOCALES[lang]);

  let planSection = '';
  if (planUri && planX != null && planY != null) {
    planSection = `
      <div style="margin-bottom:10px">
        <div style="font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #DDE4EE">${copy.locationPlan} — ${escHtml(planName || 'Plan')}</div>
        <div style="position:relative;border-radius:8px;overflow:hidden;border:1.5px solid #DDE4EE">
          <img src="${escHtml(planUri)}" style="width:100%;height:auto;display:block" onerror="this.style.display='none'"/>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;top:0;left:0;width:100%;height:100%">
            <circle cx="${planX}" cy="${planY}" r="2.2" fill="${pinColor}" stroke="#fff" stroke-width="0.55"/>
            <text x="${planX}" y="${planY}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="3.5" font-weight="bold" font-family="Arial,sans-serif">${pinNum || 1}</text>
          </svg>
        </div>
      </div>`;
  } else {
    planSection = `<div style="width:100%;height:100px;border-radius:8px;border:1.5px dashed #DDE4EE;background:#F9FAFB;display:flex;align-items:center;justify-content:center;margin-bottom:10px;font-size:11px;color:#9CA3AF">${copy.noPlan}</div>`;
  }

  const rawPhotos: any[] = Array.isArray(reserve.photos) && reserve.photos.length > 0
    ? reserve.photos
    : reserve.photoUri ? [{ uri: reserve.photoUri, kind: 'defect' }] : [];
  const photosToShow = rawPhotos
    .slice(0, 3)
    .filter((p: any) => typeof p.uri === 'string' && /^(https?:|data:image\/|blob:)/i.test(p.uri.trim()));

  const photoRowHtml = photosToShow.length > 0 ? `
    <div style="margin-top:10px">
      <div style="font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #DDE4EE">${copy.photos} (${photosToShow.length})</div>
      <div style="display:flex;gap:8px">
        ${photosToShow.map((p: any) => {
          const isDefect = p.kind === 'defect';
          return `<div style="flex:1;min-width:0;text-align:center">
            <img src="${escHtml(p.uri)}" onerror="this.style.opacity='0.15'"
              style="width:100%;height:auto;max-height:240px;object-fit:contain;background:#F9FAFB;border-radius:6px;border:1.5px solid #DDE4EE;display:block"/>
            <span style="display:inline-block;margin-top:4px;padding:1px 7px;border-radius:8px;font-size:9px;font-weight:700;background:${isDefect ? '#FEF2F2' : '#ECFDF5'};color:${isDefect ? '#DC2626' : '#059669'}">
              ● ${isDefect ? copy.defect : copy.resolved}
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

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8">
  <title>${copy.reserveSheetTitle} ${escHtml(reserve.id)}</title>
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
        <div style="font-size:8px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">${copy.reserveSheetTitle} · BuildTrack</div>
        <div style="font-size:22px;font-weight:900;color:#003082;line-height:1">${escHtml(reserve.id)}</div>
        <div style="font-size:14px;font-weight:700;color:#1A2742;margin-top:2px">${escHtml(reserve.title)}</div>
        <div style="font-size:10px;color:#6B7280">${escHtml(chantierName)}</div>
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap">
          <span class="badge" style="background:${sColor}22;color:${sColor}">${sLabel}</span>
          <span class="badge" style="background:${pColor}18;color:${pColor}">${pLabel}</span>
        </div>
      </div>
      <div style="text-align:right;font-size:10px;color:#6B7280;flex-shrink:0;margin-left:16px">
        <div>${copy.createdOn} <strong style="color:#1A2742">${escHtml(reserve.createdAt)}</strong></div>
        ${reserve.closedAt ? `<div style="color:#059669;margin-top:2px;font-weight:700">✓ ${copy.closedOn} ${escHtml(reserve.closedAt)}</div>` : ''}
        <div style="margin-top:4px">${copy.deadline} : <strong>${escHtml(reserve.deadline || copy.noValue)}</strong></div>
        <div style="font-size:9px;color:#9CA3AF;margin-top:4px">${dateStr}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        <div class="col2" style="margin-bottom:8px">
          <div class="info-cell">
            <div class="lbl">${copy.company}${companies.length > 1 && lang === 'fr' ? 's' : ''}</div>
            <div class="val" style="color:${pinColor}">${companies.map(c => escHtml(c)).join(', ') || copy.noValue}</div>
          </div>
          <div class="info-cell">
            <div class="lbl">${copy.location}</div>
            <div class="val">${copy.buildingShort} ${escHtml(reserve.building)} · ${escHtml(reserve.level)}</div>
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
        <div class="desc-box">${escHtml(getReserveDescriptionText(reserve.description, reserve.title))}</div>
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
      <span>${copy.reserveSheetTitle} · BuildTrack</span>
      <span>${escHtml(chantierName)} · ${dateStr}</span>
    </div>
  </div></body></html>`;
}

function escHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STATUS_COLORS = RESERVE_STATUS_COLORS as Record<string, string>;
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

const VISIT_REPORT_COPY = {
  fr: {
    title: 'Compte rendu de visite',
    generated: 'Généré le',
    project: 'Chantier',
    visit: 'Visite',
    date: 'Date',
    schedule: 'Horaires',
    manager: 'Conducteur',
    scope: 'Périmètre',
    companies: 'Entreprises concernées',
    participants: 'Participants',
    noParticipants: 'Aucun participant renseigné',
    coverPhoto: 'Photo de couverture',
    checklist: 'Checklist de contrôle',
    noChecklist: 'Aucun point de contrôle renseigné',
    notes: 'Notes de visite',
    noNotes: 'Aucune note renseignée',
    reserves: 'Réserves relevées',
    noReserves: 'Aucune réserve rattachée à cette visite',
    signature: 'Signature',
    statuses: { planned: 'Planifiée', in_progress: 'En cours', completed: 'Terminée' },
    types: { controle: 'Contrôle', opr: 'OPR', securite: 'Sécurité', reception: 'Réception', synthese: 'Synthèse', autre: 'Autre' },
  },
  en: {
    title: 'Site visit report',
    generated: 'Generated on',
    project: 'Project',
    visit: 'Visit',
    date: 'Date',
    schedule: 'Schedule',
    manager: 'Manager',
    scope: 'Scope',
    companies: 'Companies involved',
    participants: 'Participants',
    noParticipants: 'No participant recorded',
    coverPhoto: 'Cover photo',
    checklist: 'Control checklist',
    noChecklist: 'No checklist item recorded',
    notes: 'Visit notes',
    noNotes: 'No notes recorded',
    reserves: 'Issues raised',
    noReserves: 'No issue linked to this visit',
    signature: 'Signature',
    statuses: { planned: 'Planned', in_progress: 'In progress', completed: 'Completed' },
    types: { controle: 'Control', opr: 'OPR', securite: 'Safety', reception: 'Handover', synthese: 'Summary', autre: 'Other' },
  },
  es: {
    title: 'Informe de visita',
    generated: 'Generado el',
    project: 'Obra',
    visit: 'Visita',
    date: 'Fecha',
    schedule: 'Horario',
    manager: 'Responsable',
    scope: 'Alcance',
    companies: 'Empresas implicadas',
    participants: 'Participantes',
    noParticipants: 'Ningún participante registrado',
    coverPhoto: 'Foto de portada',
    checklist: 'Lista de control',
    noChecklist: 'No hay punto de control registrado',
    notes: 'Notas de visita',
    noNotes: 'No hay notas registradas',
    reserves: 'Reservas detectadas',
    noReserves: 'Ninguna reserva vinculada a esta visita',
    signature: 'Firma',
    statuses: { planned: 'Planificada', in_progress: 'En curso', completed: 'Terminada' },
    types: { controle: 'Control', opr: 'OPR', securite: 'Seguridad', reception: 'Recepción', synthese: 'Síntesis', autre: 'Otro' },
  },
} as const;

function formatReportDate(value: unknown, lang: ReportLanguage, withTime = false): string {
  if (!value) return REPORT_COPY[lang].noValue;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
  return date.toLocaleDateString(REPORT_LOCALES[lang], {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function buildVisitReportHtml(payload: any): string {
  const lang = reportLanguage(payload.language);
  const copy = VISIT_REPORT_COPY[lang];
  const common = REPORT_COPY[lang];
  const visit = payload.visit ?? {};
  const reserves = Array.isArray(payload.reserves) ? payload.reserves : [];
  const companies = Array.isArray(payload.companies) ? payload.companies : [];
  const participants = Array.isArray(visit.participants) ? visit.participants : [];
  const coverPhotoUri = visit.cover_photo_uri ?? visit.coverPhotoUri ?? null;
  const companyIds: string[] = Array.isArray(visit.concerned_company_ids)
    ? visit.concerned_company_ids
    : Array.isArray(visit.company_ids)
      ? visit.company_ids
      : [];
  const companyNames = companyIds
    .map(id => companies.find((company: any) => company.id === id)?.name ?? id)
    .filter(Boolean);
  const checklistItems = Array.isArray(visit.checklist_items)
    ? visit.checklist_items
    : Array.isArray(visit.checklist)
      ? visit.checklist
      : [];
  const scopeParts = [
    visit.building,
    visit.level,
    visit.zone,
    Array.isArray(visit.visited_locations) && visit.visited_locations.length
      ? visit.visited_locations.join(', ')
      : null,
  ].filter(Boolean);
  const generatedDate = formatReportDate(payload.generatedAt || Date.now(), lang, true);
  const visitDate = formatReportDate(visit.date ?? visit.created_at, lang);
  const status = copy.statuses[String(visit.status ?? 'planned') as keyof typeof copy.statuses] ?? String(visit.status ?? '');
  const visitType = copy.types[String(visit.visit_type ?? 'controle') as keyof typeof copy.types] ?? String(visit.visit_type ?? '');
  const participantsHtml = participants.length
    ? participants.map((participant: any) => {
        const name = participant.name ?? participant.full_name ?? participant.email ?? common.noValue;
        const meta = [participant.role, participant.company, participant.email].filter(Boolean).join(' · ');
        return `<div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:8px 10px">
          <div style="font-weight:800">${escapeHtml(name)}</div>
          <div style="font-size:10px;color:#64748b;margin-top:2px">${escapeHtml(meta || copy.participants)}</div>
        </div>`;
      }).join('')
    : `<p style="color:#94a3b8">${copy.noParticipants}</p>`;
  const checklistHtml = checklistItems.length
    ? checklistItems.map((item: any, index: number) => {
        const label = typeof item === 'string' ? item : item.label ?? item.title ?? item.text ?? '';
        const done = typeof item === 'object' && (item.done || item.checked || item.status === 'done');
        return `<li style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px">
          <span style="display:inline-flex;width:18px;height:18px;border-radius:50%;align-items:center;justify-content:center;background:${done ? '#059669' : '#e2e8f0'};color:${done ? '#fff' : '#64748b'};font-size:10px;font-weight:700">${done ? '✓' : index + 1}</span>
          <span>${escapeHtml(label)}</span>
        </li>`;
      }).join('')
    : `<p style="color:#94a3b8">${copy.noChecklist}</p>`;
  const reserveRows = reserves.length
    ? reserves.map((reserve: any, index: number) => {
        const statusColor = STATUS_COLORS[reserve.status] ?? '#6b7280';
        const priorityColor = PRIORITY_COLORS[reserve.priority] ?? '#6b7280';
        const companyLabel = Array.isArray(reserve.companies) && reserve.companies.length
          ? reserve.companies.join(', ')
          : reserve.company ?? common.noValue;
        return `<tr style="background:${index % 2 === 0 ? '#ffffff' : '#f8fafc'}">
          <td style="padding:8px 10px;font-weight:800;color:#003082">#${index + 1}</td>
          <td style="padding:8px 10px;font-weight:700">${escapeHtml(reserve.title)}</td>
          <td style="padding:8px 10px">${escapeHtml(companyLabel)}</td>
          <td style="padding:8px 10px">${escapeHtml([reserve.building, reserve.level, reserve.zone].filter(Boolean).join(' · ') || common.noValue)}</td>
          <td style="padding:8px 10px;color:${statusColor};font-weight:700">${statusLabel(reserve.status, lang)}</td>
          <td style="padding:8px 10px;color:${priorityColor};font-weight:700">${priorityLabel(reserve.priority, lang)}</td>
          <td style="padding:8px 10px">${escapeHtml(getReserveDescriptionText(reserve.description, reserve.title)).slice(0, 180)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="7" style="padding:14px;color:#94a3b8;text-align:center">${copy.noReserves}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>${copy.title} - ${escapeHtml(payload.chantierName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background:#fff; color:#1e293b; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:1.5; }
    @page { margin: 15mm 12mm; size: A4; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    table { width:100%; border-collapse:collapse; font-size:10.5px; }
    .section-title { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.7px; font-weight:800; margin:20px 0 8px; padding-bottom:5px; border-bottom:1.5px solid #e2e8f0; }
  </style>
</head>
<body>
  <div style="background:linear-gradient(135deg,#003082,#1A6FD8);color:#fff;padding:26px 30px;border-radius:10px;margin-bottom:20px">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.78;margin-bottom:6px">BuildTrack · ${copy.title}</div>
    <div style="font-size:25px;font-weight:900;margin-bottom:4px">${escapeHtml(visit.title ?? copy.visit)}</div>
    <div style="font-size:14px;opacity:.85">${escapeHtml(payload.chantierName)} · ${visitDate}</div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
    ${[
      [copy.project, payload.chantierName],
      [copy.date, visitDate],
      [copy.schedule, [visit.start_time, visit.end_time].filter(Boolean).join(' - ') || common.noValue],
      [copy.manager, visit.conducteur ?? common.noValue],
      [copy.visit, `${visitType} · ${status}`],
      [copy.scope, scopeParts.join(' · ') || common.noValue],
    ].map(([label, value]) => `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px">
      <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;font-weight:700">${escapeHtml(label)}</div>
      <div style="font-size:12px;font-weight:700;margin-top:3px">${escapeHtml(value)}</div>
    </div>`).join('')}
  </div>

  ${coverPhotoUri ? `<div class="section-title">${copy.coverPhoto}</div>
  <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:18px;background:#f8fafc">
    <img src="${escapeHtml(coverPhotoUri)}" style="width:100%;max-height:230px;object-fit:cover;display:block" onerror="this.parentElement.style.display='none'"/>
  </div>` : ''}

  <div class="section-title">${copy.companies}</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap">
    ${(companyNames.length ? companyNames : [common.allCompanies]).map(name => `<span style="background:#eef2ff;color:#003082;border:1px solid #c7d2fe;border-radius:999px;padding:5px 10px;font-weight:700">${escapeHtml(name)}</span>`).join('')}
  </div>

  <div class="section-title">${copy.participants}</div>
  <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">${participantsHtml}</div>

  <div class="section-title">${copy.checklist}</div>
  <ul style="list-style:none">${checklistHtml}</ul>

  <div class="section-title">${copy.notes}</div>
  <div style="min-height:70px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;white-space:pre-wrap">${escapeHtml(visit.notes || copy.noNotes)}</div>

  <div class="section-title">${copy.reserves}</div>
  <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
    <thead><tr style="background:#003082">
      <th style="color:#fff;padding:8px 10px;text-align:left">#</th>
      <th style="color:#fff;padding:8px 10px;text-align:left">${common.title}</th>
      <th style="color:#fff;padding:8px 10px;text-align:left">${common.company}</th>
      <th style="color:#fff;padding:8px 10px;text-align:left">${common.location}</th>
      <th style="color:#fff;padding:8px 10px;text-align:left">${common.status}</th>
      <th style="color:#fff;padding:8px 10px;text-align:left">${common.priority}</th>
      <th style="color:#fff;padding:8px 10px;text-align:left">${common.defect}</th>
    </tr></thead>
    <tbody>${reserveRows}</tbody>
  </table>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:34px">
    <div style="height:54px;border-bottom:2px solid #1e293b"></div>
    <div style="height:54px;border-bottom:2px solid #1e293b"></div>
    <div style="text-align:center;color:#64748b;font-size:10px">${copy.manager}</div>
    <div style="text-align:center;color:#64748b;font-size:10px">${copy.signature}</div>
  </div>

  <div style="margin-top:26px;padding-top:12px;border-top:1.5px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8">
    <span>BuildTrack · ${copy.generated} ${generatedDate}</span>
    <span>${common.confidential}</span>
  </div>
</body>
</html>`;
}

function buildReserveRow(r: PdfReserveItem, idx: number, lang: ReportLanguage = 'fr'): string {
  const statusColor = STATUS_COLORS[r.status] ?? '#6b7280';
  const priorityColor = PRIORITY_COLORS[r.priority] ?? '#6b7280';
  const copy = REPORT_COPY[lang];
  const bg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
  // Colonne « Observation » : titre + description éventuelle + photos empilées.
  const rawPhotos = Array.isArray(r.photos) ? r.photos : [];
  const photoStack = buildReservePhotoStackHtml(
    rawPhotos.slice(0, PHOTOS_PER_RESERVE_IN_REPORT),
    { omittedNote: rawPhotos.length > PHOTOS_PER_RESERVE_IN_REPORT ? copy.photosMore(rawPhotos.length - PHOTOS_PER_RESERVE_IN_REPORT) : null },
  );
  const desc = hasCustomReserveDescription(r.description, r.title) ? String(r.description ?? '').trim() : '';
  const descHtml = desc ? `<div style="color:#64748b;font-size:10px;margin-top:2px">${escapeHtml(desc.length > 240 ? desc.slice(0, 240) + '…' : desc)}</div>` : '';
  return `<tr style="background:${bg}">
    <td style="text-align:center;width:36px;padding:7px 10px;vertical-align:top">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#003082;color:#fff;font-weight:700;font-size:11px">${idx + 1}</span>
    </td>
    <td style="padding:7px 10px;vertical-align:top;min-width:150px"><div style="font-weight:600">${escapeHtml(r.title)}</div>${descHtml}${photoStack}</td>
    <td style="padding:7px 10px;vertical-align:top">${escapeHtml(r.company) || copy.noValue}</td>
    <td style="padding:7px 10px;vertical-align:top">${escapeHtml(r.level) || copy.noValue}</td>
    <td style="padding:7px 10px;vertical-align:top"><span style="color:${statusColor};font-weight:600">${statusLabel(r.status, lang)}</span></td>
    <td style="padding:7px 10px;vertical-align:top"><span style="color:${priorityColor};font-weight:600">${priorityLabel(r.priority, lang)}</span></td>
    <td style="padding:7px 10px;vertical-align:top">${escapeHtml(r.deadline) || copy.noValue}</td>
  </tr>`;
}

function buildTableHeader(bgColor = '#003082', lang: ReportLanguage = 'fr'): string {
  const copy = REPORT_COPY[lang];
  return `<thead><tr style="background:${bgColor}">
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">#</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">${copy.observation}</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">${copy.company}</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">${copy.level}</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">${copy.status}</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">${copy.priority}</th>
    <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700">${copy.deadline}</th>
  </tr></thead>`;
}

function buildPlanBlock(plan: PdfPlanItem, planReserves: PdfReserveItem[], lang: ReportLanguage = 'fr'): string {
  const copy = REPORT_COPY[lang];
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

  const rows = planReserves.map((r, i) => buildReserveRow(r, i, lang)).join('');

  return `
    <div style="background:#fff;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:14px;overflow:hidden">
      <div style="background:#f8fafc;padding:10px 16px;font-size:12px;font-weight:700;color:#1e293b;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:6px">
        📐 ${escapeHtml(plan.name)}${levelBadge}
        <span style="margin-left:auto;font-size:11px;color:#94a3b8;font-weight:400">
          ${copy.reserveCount(planReserves.length)}
        </span>
      </div>
      ${planImgHtml ? `<div style="padding:12px 16px">${planImgHtml}</div>` : ''}
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        ${buildTableHeader('#003082', lang)}
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export function buildGlobalReportHtml(payload: PdfReportPayload): string {
  const { chantierName, companyFilter, generatedAt, plans, reserves } = payload;
  const lang = reportLanguage((payload as any).language);
  const copy = REPORT_COPY[lang];

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
    return a.localeCompare(b, lang);
  });

  const buildingSections: string[] = [];

  for (const building of buildingNames) {
    const buildingPlans = plansWithReserves.filter(p => (p.building ?? '') === building);
    const buildingLabel = building || copy.noBuilding;
    const planBlocks: string[] = [];
    let buildingReserveCount = 0;

    for (const plan of buildingPlans) {
      const planReserves = reservesByPlan.get(plan.id) ?? [];
      if (planReserves.length === 0) continue;
      buildingReserveCount += planReserves.length;
      planBlocks.push(buildPlanBlock(plan, planReserves, lang));
    }

    if (buildingReserveCount === 0) continue;

    buildingSections.push(`
      <div style="margin-bottom:24px;page-break-inside:avoid">
        <div style="background:linear-gradient(135deg,#003082 0%,#1A6FD8 100%);color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:10px">
          🏗️ ${escapeHtml(buildingLabel)}
          <span style="margin-left:auto;font-size:12px;opacity:0.8;font-weight:400">
            ${copy.reserveCount(buildingReserveCount)}
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
        const rawPhotos = Array.isArray(r.photos) ? r.photos : [];
        const photoStack = buildReservePhotoStackHtml(
          rawPhotos.slice(0, PHOTOS_PER_RESERVE_IN_REPORT),
          { omittedNote: rawPhotos.length > PHOTOS_PER_RESERVE_IN_REPORT ? copy.photosMore(rawPhotos.length - PHOTOS_PER_RESERVE_IN_REPORT) : null },
        );
        const desc = hasCustomReserveDescription(r.description, r.title) ? String(r.description ?? '').trim() : '';
        const descHtml = desc ? `<div style="color:#64748b;font-size:10px;margin-top:2px">${escapeHtml(desc.length > 240 ? desc.slice(0, 240) + '…' : desc)}</div>` : '';
        return `<tr style="background:${bg}">
          <td style="text-align:center;width:36px;padding:7px 10px;vertical-align:top">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#475569;color:#fff;font-weight:700;font-size:11px">${i + 1}</span>
          </td>
          <td style="padding:7px 10px;vertical-align:top;min-width:150px"><div style="font-weight:600">${escapeHtml(r.title)}</div>${descHtml}${photoStack}</td>
          <td style="padding:7px 10px;vertical-align:top">${escapeHtml(r.company) || copy.noValue}</td>
          <td style="padding:7px 10px;vertical-align:top">${escapeHtml(r.building) || copy.noValue}</td>
          <td style="padding:7px 10px;vertical-align:top">${escapeHtml(r.level) || copy.noValue}</td>
          <td style="padding:7px 10px;vertical-align:top"><span style="color:${statusColor};font-weight:600">${statusLabel(r.status, lang)}</span></td>
          <td style="padding:7px 10px;vertical-align:top"><span style="color:${priorityColor};font-weight:600">${priorityLabel(r.priority, lang)}</span></td>
          <td style="padding:7px 10px;vertical-align:top">${escapeHtml(r.deadline) || copy.noValue}</td>
        </tr>`;
      })
      .join('');

    orphanHtml = `
      <div style="margin-bottom:24px">
        <div style="background:linear-gradient(135deg,#475569 0%,#64748b 100%);color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:10px">
          ${copy.offPlan}
          <span style="margin-left:auto;font-size:12px;opacity:0.8;font-weight:400">
            ${copy.reserveCount(orphanReserves.length)}
          </span>
        </div>
        <div style="background:#fff;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;overflow:hidden">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:#475569">
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">#</th>
              <th style="color:#fff;padding:8px 10px;text-align:left;font-size:10px">${copy.observation}</th>
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
          <span style="color:${color};font-weight:600">${statusLabel(s, lang)}</span>
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

  const companyLabel = companyFilter ?? copy.allCompanies;
  const dateStr = new Date(generatedAt).toLocaleDateString(REPORT_LOCALES[lang], {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const totalBuildings = buildingSections.length;
  const totalPlans = plansWithReserves.length;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>${copy.reportPlansTitle} - ${escapeHtml(chantierName)}</title>
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
    <div style="font-size:28px;font-weight:800;color:#1e293b;margin-bottom:8px">${copy.reportPlansTitle}</div>
    <div style="font-size:18px;color:#64748b;margin-bottom:6px">${escapeHtml(chantierName)}</div>
    <div style="font-size:14px;color:#94a3b8;margin-bottom:32px">${escapeHtml(companyLabel)}</div>
    <div style="display:flex;gap:40px;margin:16px 0">
      <div style="text-align:center">
        <div style="font-size:40px;font-weight:800;color:#003082">${totalReserves}</div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:4px">${copy.reserves}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:40px;font-weight:800;color:#003082">${totalBuildings}</div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:4px">${copy.buildings}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:40px;font-weight:800;color:#003082">${totalPlans}</div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:4px">${copy.plans}</div>
      </div>
    </div>
    <div style="margin-top:20px;padding:12px 24px;background:#f0f4ff;border-radius:8px;border:1px solid #c7d2fe;font-size:11px;color:#475569">
      ${copy.generatedOn} ${dateStr}
    </div>
  </div>

  <div style="padding:20px 24px">
    ${buildingSections.join('\n')}
    ${orphanHtml}

    ${summaryRows ? `
    <div style="margin-top:32px;page-break-before:auto">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1.5px solid #e2e8f0;padding-bottom:6px;margin-bottom:12px">
        ${copy.statusSummary}
      </div>
      <table style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <tbody>${summaryRows}</tbody>
      </table>
    </div>` : ''}

    <div style="margin-top:32px;padding-top:14px;border-top:1.5px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8">
      <span>${copy.generatedBy} - ${escapeHtml(chantierName)}</span>
      <span>${copy.confidential} - ${dateStr}</span>
    </div>
  </div>
</body>
</html>`;
}

