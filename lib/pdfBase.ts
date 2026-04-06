import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

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

export function buildLetterhead(
  docType: string,
  docTitle: string,
  docRef: string,
  date: string,
  projectName: string,
): string {
  return `
    <div class="letterhead">
      <div class="letterhead-logo">
        <div class="letterhead-logo-mark">BT</div>
        <div>
          <div class="letterhead-brand">BuildTrack</div>
          <div class="letterhead-tagline">Gestion de chantier numérique</div>
        </div>
      </div>
      <div class="letterhead-right">
        <div class="letterhead-doc-type">${docType}</div>
        <div class="letterhead-doc-title">${docTitle}</div>
        <div class="letterhead-ref">Projet : <strong>${projectName}</strong></div>
        <div class="letterhead-ref">Réf. : <strong>${docRef}</strong> &nbsp;|&nbsp; Date : <strong>${date}</strong></div>
      </div>
    </div>
  `;
}

export function buildInfoGrid(items: Array<{ label: string; value: string }>): string {
  return `<div class="info-grid">${items.map(i =>
    `<div class="info-card"><div class="info-card-label">${i.label}</div><div class="info-card-value">${i.value}</div></div>`
  ).join('')}</div>`;
}

export function buildKpiRow(items: Array<{ val: string | number; label: string; color?: string }>): string {
  return `<div class="kpi-row">${items.map(i =>
    `<div class="kpi-card"><div class="kpi-val" style="color:${i.color ?? '#003082'}">${i.val}</div><div class="kpi-label">${i.label}</div></div>`
  ).join('')}</div>`;
}

export function buildDocFooter(projectName: string): string {
  const now = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  return `
    <div class="doc-footer">
      <span>Généré par BuildTrack — ${projectName}</span>
      <span>Document confidentiel — ${now}</span>
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
  }>
): string {
  if (!photos.length) return '';
  return `
    <div class="section-header">Photos (${photos.length})</div>
    <div class="photo-grid">
      ${photos.map(p => `
        <div class="photo-item">
          <img class="photo-img" src="${p.src}" onerror="this.style.opacity='0.2'" />
          ${p.badge
            ? `<span class="photo-badge" style="background:${p.badgeColor ?? PDF_BG};color:${p.badgeTextColor ?? PDF_TEXT}">${p.badge}</span>`
            : ''}
          ${p.caption
            ? `<div class="photo-caption">${p.caption}</div>`
            : ''}
        </div>
      `).join('')}
    </div>
  `;
}

export function wrapHTML(body: string, title: string): string {
  return `<!DOCTYPE html><html lang="fr"><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>${PDF_BASE_CSS}</style>
  </head><body>
    <div class="container">
      ${body}
    </div>
  </body></html>`;
}

/**
 * Converts any photo URI to a safe base64 data URL for embedding in a PDF.
 *
 * Print.printAsync's WebView on Android/iOS is sandboxed — it cannot load
 * external HTTPS URLs or local file:// paths. Every image must be embedded as
 * a data URL before the HTML is passed to Print.printAsync.
 *
 * Strategy:
 *  - data: URIs        → returned as-is
 *  - https:// on native → downloaded to a temp cache file, read as base64
 *  - https:// on web   → returned as-is (browser handles it)
 *  - file:// on native → read directly with FileSystem
 *  - anything else     → returned as-is (best-effort fallback)
 */
export async function loadPhotoAsDataUrl(uri: string): Promise<string> {
  if (!uri) return '';
  if (uri.startsWith('data:')) return uri;

  const lc = uri.toLowerCase();
  const imgMime = lc.endsWith('.png') ? 'image/png'
    : lc.endsWith('.webp') ? 'image/webp'
    : lc.endsWith('.gif') ? 'image/gif'
    : 'image/jpeg';

  if (Platform.OS !== 'web') {
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      // Download the remote image to a temp file, then base64-encode it.
      try {
        const ext = lc.split('?')[0].split('.').pop() ?? 'jpg';
        const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
        const tempUri = `${FileSystem.cacheDirectory ?? ''}ph_${Date.now()}.${safeExt}`;
        const { uri: localUri, status } = await FileSystem.downloadAsync(uri, tempUri);
        if (status !== 200) throw new Error(`HTTP ${status}`);
        const base64 = await FileSystem.readAsStringAsync(localUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
        return `data:${imgMime};base64,${base64}`;
      } catch {
        return uri;
      }
    }
    if (uri.startsWith('file://')) {
      try {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return `data:${imgMime};base64,${base64}`;
      } catch {
        return uri;
      }
    }
    return uri;
  }

  // Web: browser can load HTTPS directly
  return uri;
}

/**
 * Converts a plan file URI (image or PDF) to a base64 data URL so it can be
 * safely embedded in HTML passed to Print.printAsync.
 *
 * Same sandboxing constraint as loadPhotoAsDataUrl — all non-data URIs must be
 * converted before they reach the WebView.
 *
 * Strategy:
 *  - data: URIs           → returned as-is
 *  - https:// on native   → FileSystem.downloadAsync → base64
 *  - file:// on native    → FileSystem.readAsStringAsync → base64
 *  - https:// on web      → fetch → FileReader → base64
 *  - anything else        → returned as-is
 */
export async function loadFileAsDataUrl(
  uri: string,
  fileType?: 'pdf' | 'image' | 'dxf' | null,
): Promise<string> {
  if (!uri) return uri;
  if (uri.startsWith('data:')) return uri;

  const lc = uri.toLowerCase();
  const mimeType = fileType === 'pdf' || lc.includes('.pdf') || lc.includes('application/pdf')
    ? 'application/pdf'
    : lc.endsWith('.png') ? 'image/png'
    : lc.endsWith('.webp') ? 'image/webp'
    : lc.endsWith('.gif') ? 'image/gif'
    : 'image/jpeg';

  if (Platform.OS !== 'web') {
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      // Remote URL on native: download to cache, then read as base64.
      // FileSystem.readAsStringAsync() does NOT support network URLs —
      // it is only for local paths.
      try {
        const ext = fileType === 'pdf' ? 'pdf' : 'jpg';
        const tempUri = `${FileSystem.cacheDirectory ?? ''}plan_${Date.now()}.${ext}`;
        const { uri: localUri, status } = await FileSystem.downloadAsync(uri, tempUri);
        if (status !== 200) throw new Error(`HTTP ${status}`);
        const base64 = await FileSystem.readAsStringAsync(localUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
        return `data:${mimeType};base64,${base64}`;
      } catch {
        return uri;
      }
    }

    // Local file:// path
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return `data:${mimeType};base64,${base64}`;
    } catch {
      return uri;
    }
  }

  // Web: use fetch + FileReader
  try {
    const resp = await fetch(uri);
    if (!resp.ok) throw new Error('fetch failed');
    const blob = await resp.blob();
    return await new Promise<string>((res, rej) => {
      const reader = new FileReader();
      reader.onloadend = () => res(reader.result as string);
      reader.onerror = rej;
      reader.readAsDataURL(blob);
    });
  } catch {
    return uri;
  }
}

/**
 * Pre-renders the first page of a PDF (given as a data URL or remote URL)
 * to a JPEG data URL using PDF.js.
 *
 * Only works on web (requires document + canvas API).
 * Returns null on native or if rendering fails.
 */
export async function preRenderPdfPageToDataUrl(
  pdfUri: string,
  renderW: number,
): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  try {
    const { getDocument } = await import('@/lib/pdfjs.web');
    const srcArg = pdfUri.startsWith('data:')
      ? { data: atob(pdfUri.split(',')[1]) }
      : { url: pdfUri, withCredentials: false };
    const pdfDoc = await (getDocument(srcArg) as any).promise;
    const page = await pdfDoc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = renderW / vp1.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch {
    return null;
  }
}

/**
 * Converts a raw SVG string (returned by SignaturePad.getSVGData()) to a
 * data URL safe for use in <img src="...">.
 * A plain SVG string is not a valid URL — it must be encoded first.
 */
export function svgStringToDataUrl(svg: string): string {
  if (!svg) return '';
  if (svg.startsWith('data:')) return svg;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function exportPDF(html: string, filename: string = 'buildtrack-export'): Promise<void> {
  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
    }
    return;
  }
  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: filename });
    }
  } catch (e: any) {
    throw new Error(e?.message ?? 'PDF generation failed');
  }
}
