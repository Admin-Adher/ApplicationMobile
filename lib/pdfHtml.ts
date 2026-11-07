import { getPdfCompanyPalette, renderPdfCompanyLabel, type PdfCompany } from './pdfCompanyColors';
import { buildPhotoAnnotationsOverlayHtml } from './pdfReserveHelpers';
import type { PhotoAnnotation } from '../constants/types';
import { withPdfPagination } from './pdfPagination';

/**
 * Escapes user-supplied strings so they are safe to embed in HTML.
 * Prevents layout breakage from characters like <, >, &, " and '
 * and eliminates the risk of HTML injection in generated PDFs.
 */
export function escapeHtml(str: string | null | undefined): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const PDF_BRAND_COLOR = '#003082';
export const PDF_ACCENT = '#1A6FD8';
export const PDF_BG = '#F4F7FB';
export const PDF_BORDER = '#DDE4EE';
export const PDF_TEXT = '#1A2742';
export const PDF_MUTED = '#6B7280';

export const PDF_BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    background: #fff;
    color: ${PDF_TEXT};
    font-size: 12px;
    line-height: 1.5;
  }
  @page {
    margin: 15mm 12mm;
    @bottom-right {
      content: "Page " counter(page) " / " counter(pages);
      font-size: 9px;
      color: ${PDF_MUTED};
    }
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    .card { page-break-inside: avoid; }
    h2 { page-break-after: avoid; }
    .photo-grid { page-break-inside: avoid; }
  }
  .page-break { page-break-before: always; }

  /* Layout */
  .container { padding: 28px 32px; max-width: 900px; margin: 0 auto; }

  /* Header / Letterhead */
  .letterhead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 18px;
    border-bottom: 3px solid ${PDF_BRAND_COLOR};
    margin-bottom: 22px;
  }
  .letterhead-logo {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .letterhead-logo-mark {
    width: 42px; height: 42px;
    background: ${PDF_BRAND_COLOR};
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 800; font-size: 18px; letter-spacing: -0.5px;
  }
  .letterhead-brand { font-size: 20px; font-weight: 800; color: ${PDF_BRAND_COLOR}; }
  .letterhead-tagline { font-size: 10px; color: ${PDF_MUTED}; margin-top: 1px; }
  .letterhead-right { text-align: right; }
  .letterhead-doc-type { font-size: 14px; font-weight: 700; color: ${PDF_TEXT}; }
  .letterhead-doc-title { font-size: 11px; color: ${PDF_MUTED}; margin-top: 3px; }
  .letterhead-ref { font-size: 10px; color: ${PDF_MUTED}; margin-top: 8px; }
  .letterhead-ref strong { color: ${PDF_TEXT}; }

  /* Info cards */
  .info-grid { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .info-card {
    flex: 1; min-width: 130px;
    background: ${PDF_BG}; border-radius: 8px;
    padding: 10px 14px; border: 1px solid ${PDF_BORDER};
  }
  .info-card-label { font-size: 9px; color: ${PDF_MUTED}; text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 4px; font-weight: 700; }
  .info-card-value { font-size: 13px; font-weight: 700; color: ${PDF_TEXT}; }

  /* KPI row */
  .kpi-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
  .kpi-card {
    flex: 1; min-width: 90px;
    border: 1.5px solid ${PDF_BORDER}; border-radius: 10px;
    padding: 12px 16px; text-align: center;
  }
  .kpi-val { font-size: 28px; font-weight: 800; }
  .kpi-label { font-size: 10px; color: ${PDF_MUTED}; margin-top: 2px; }

  /* Section header */
  .section-header {
    font-size: 11px; font-weight: 700; color: ${PDF_MUTED};
    text-transform: uppercase; letter-spacing: 0.7px;
    margin-bottom: 10px; margin-top: 22px;
    padding-bottom: 6px; border-bottom: 1.5px solid ${PDF_BORDER};
  }

  /* Tables */
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
  thead th {
    background: ${PDF_BRAND_COLOR}; color: #fff;
    padding: 8px 10px; text-align: left;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  tbody tr:nth-child(even) { background: #F9FAFB; }
  tbody td { padding: 7px 10px; border-bottom: 1px solid ${PDF_BORDER}; vertical-align: top; }

  /* Badges */
  .badge {
    display: inline-block; padding: 2px 9px;
    border-radius: 12px; font-size: 10px; font-weight: 700;
  }
  .badge-open { background: #FEF2F2; color: #DC2626; }
  .badge-progress { background: #FFFBEB; color: #D97706; }
  .badge-waiting { background: #F3F4F6; color: #6B7280; }
  .badge-closed { background: #ECFDF5; color: #059669; }
  .badge-reserve { background: #FEF2F2; color: #DC2626; }
  .badge-ok { background: #ECFDF5; color: #059669; }
  .badge-na { background: #F3F4F6; color: #6B7280; }

  /* Alert box */
  .alert { border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 12px; }
  .alert-warning { background: #FFFBEB; border-left: 4px solid #F59E0B; color: #92400E; }
  .alert-danger { background: #FEF2F2; border-left: 4px solid #EF4444; color: #7F1D1D; }
  .alert-success { background: #ECFDF5; border-left: 4px solid #10B981; color: #064E3B; }
  .alert-info { background: #EFF6FF; border-left: 4px solid #3B82F6; color: #1E3A8A; }

  /* Signature blocks */
  .sig-row { display: flex; gap: 32px; flex-wrap: wrap; margin-top: 16px; }
  .sig-block {
    flex: 1; min-width: 200px;
    border: 1.5px solid ${PDF_BORDER}; border-radius: 10px;
    padding: 14px 18px; background: #FAFBFF;
  }
  .sig-label { font-size: 9px; color: ${PDF_MUTED}; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 10px; font-weight: 700; }
  .sig-line { height: 70px; border-bottom: 2px solid ${PDF_TEXT}; margin-bottom: 8px; }
  .sig-name { font-size: 12px; font-weight: 700; color: ${PDF_TEXT}; }
  .sig-date { font-size: 10px; color: ${PDF_MUTED}; margin-top: 2px; }

  /* Photo grid */
  .photo-grid { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .photo-item { text-align: center; }
  .photo-img {
    width: 190px; height: auto; max-height: 240px;
    object-fit: contain; background: #F9FAFB;
    border-radius: 8px;
    border: 1.5px solid ${PDF_BORDER}; display: block;
  }
  .photo-badge {
    display: inline-block; margin-top: 6px;
    padding: 2px 10px; border-radius: 10px;
    font-size: 10px; font-weight: 700;
  }
  .photo-caption {
    font-size: 10px; color: ${PDF_MUTED};
    margin-top: 4px; max-width: 190px;
    word-break: break-word;
  }

  /* Footer */
  .doc-footer {
    margin-top: 32px; padding-top: 14px;
    border-top: 1.5px solid ${PDF_BORDER};
    display: flex; justify-content: space-between; align-items: center;
    font-size: 9px; color: ${PDF_MUTED};
  }
`;

type PdfLetterheadCopy = {
  company?: PdfCompany;
  tagline?: string;
  projectLabel?: string;
  refLabel?: string;
  dateLabel?: string;
  locale?: string;
};

function pdfLocaleCopy(locale?: string) {
  if (locale?.startsWith('es')) {
    return {
      tagline: 'Gestion digital de obra',
      projectLabel: 'Obra',
      refLabel: 'Ref.',
      dateLabel: 'Fecha',
      generatedBy: 'Generado por BuildTrack',
      confidential: 'Documento confidencial',
    };
  }
  if (locale?.startsWith('en')) {
    return {
      tagline: 'Digital construction management',
      projectLabel: 'Project',
      refLabel: 'Ref.',
      dateLabel: 'Date',
      generatedBy: 'Generated by BuildTrack',
      confidential: 'Confidential document',
    };
  }
  return {
    tagline: 'Gestion de chantier numérique',
    projectLabel: 'Projet',
    refLabel: 'Réf.',
    dateLabel: 'Date',
    generatedBy: 'Généré par BuildTrack',
    confidential: 'Document confidentiel',
  };
}

export function buildLetterhead(
  docType: string,
  docTitle: string,
  docRef: string,
  date: string,
  projectName: string,
  copy: PdfLetterheadCopy = {},
): string {
  const defaults = pdfLocaleCopy(copy.locale);
  const tagline = copy.tagline ?? defaults.tagline;
  const projectLabel = copy.projectLabel ?? defaults.projectLabel;
  const refLabel = copy.refLabel ?? defaults.refLabel;
  const dateLabel = copy.dateLabel ?? defaults.dateLabel;
  return `
    <div class="letterhead">
      <div class="letterhead-logo">
        <div class="letterhead-logo-mark">BT</div>
        <div>
          <div class="letterhead-brand">BuildTrack</div>
          <div class="letterhead-tagline">${escapeHtml(tagline)}</div>
        </div>
      </div>
      <div class="letterhead-right">
        <div class="letterhead-doc-type">${escapeHtml(docType)}</div>
        <div class="letterhead-doc-title">${copy.company ? renderPdfCompanyLabel(docTitle, getPdfCompanyPalette([copy.company])) : escapeHtml(docTitle)}</div>
        <div class="letterhead-ref">${escapeHtml(projectLabel)} : <strong>${escapeHtml(projectName)}</strong></div>
        <div class="letterhead-ref">${escapeHtml(refLabel)} : <strong>${escapeHtml(docRef)}</strong> &nbsp;|&nbsp; ${escapeHtml(dateLabel)} : <strong>${escapeHtml(date)}</strong></div>
      </div>
    </div>
  `;
}

export function buildInfoGrid(items: Array<{ label: string; value: string }>): string {
  return `<div class="info-grid">${items.map(i =>
    `<div class="info-card"><div class="info-card-label">${escapeHtml(i.label)}</div><div class="info-card-value">${escapeHtml(i.value)}</div></div>`
  ).join('')}</div>`;
}

export function buildKpiRow(items: Array<{ val: string | number; label: string; color?: string }>): string {
  return `<div class="kpi-row">${items.map(i =>
    `<div class="kpi-card"><div class="kpi-val" style="color:${i.color ?? '#003082'}">${typeof i.val === 'number' ? i.val : escapeHtml(i.val)}</div><div class="kpi-label">${escapeHtml(i.label)}</div></div>`
  ).join('')}</div>`;
}

type PdfFooterCopy = {
  generatedBy?: string;
  confidential?: string;
  locale?: string;
};

export function buildDocFooter(projectName: string, copy: PdfFooterCopy = {}): string {
  const now = new Date().toLocaleDateString(copy.locale ?? 'fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const defaults = pdfLocaleCopy(copy.locale);
  const generatedBy = copy.generatedBy ?? defaults.generatedBy;
  const confidential = copy.confidential ?? defaults.confidential;
  return `
    <div class="doc-footer">
      <span>${escapeHtml(generatedBy)} — ${escapeHtml(projectName)}</span>
      <span>${escapeHtml(confidential)} — ${escapeHtml(now)}</span>
    </div>
  `;
}

export function buildPhotoGrid(
  photos: Array<{
    src: string;
    caption?: string;
    badge?: string;
    badgeColor?: string;
    badgeTextColor?: string;
    annotations?: PhotoAnnotation[] | null;
  }>,
  sectionTitle?: string,
): string {
  if (!photos.length) return '';
  const title = sectionTitle ?? `Photos (${photos.length})`;
  return `
    <div class="section-header">${escapeHtml(title)}</div>
    <div class="photo-grid">
      ${photos.map(p => {
        // Photo annotée : dimensions auto plafonnées — la boîte épouse l'image
        // (calque en % aligné) sans pouvoir dépasser les bornes de la grille ;
        // photo nue : rendu inchangé.
        const overlay = buildPhotoAnnotationsOverlayHtml(p.annotations);
        const img = `<img class="photo-img" src="${p.src}" onerror="this.style.opacity='0.2'"${overlay ? ' style="width:auto;height:auto;max-width:190px;max-height:240px;object-fit:unset;"' : ''} />`;
        return `
        <div class="photo-item">
          ${overlay ? `<div style="position:relative;display:inline-block;max-width:100%;">${img}${overlay}</div>` : img}
          ${p.badge
            ? `<span class="photo-badge" style="background:${p.badgeColor ?? PDF_BG};color:${p.badgeTextColor ?? PDF_TEXT}">${escapeHtml(p.badge)}</span>`
            : ''}
          ${p.caption
            ? `<div class="photo-caption">${escapeHtml(p.caption)}</div>`
            : ''}
        </div>
      `;
      }).join('')}
    </div>
  `;
}

export function wrapHTML(body: string, title: string): string {
  return withPdfPagination(`<!DOCTYPE html><html lang="fr"><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>${PDF_BASE_CSS}</style>
  </head><body>
    <div class="container">
      ${body}
    </div>
  </body></html>`);
}
