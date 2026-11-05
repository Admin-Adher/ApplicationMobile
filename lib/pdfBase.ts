import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { resolveMediaRef } from '@/lib/media';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  preRenderPdfPageToDataUrlImpl,
  preRenderPlanImageWithAnnotationsToDataUrlImpl,
} from '@/lib/pdfPreRender';
import { ensurePdfFilename } from '@/lib/pdfFilename';
import type { PlanDrawing } from '@/constants/types';

export * from './pdfHtml';

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
  uri = await resolveMediaRef(uri, { cacheDisk: false }) ?? '';
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
        // Use a unique random suffix in addition to Date.now() because parallel
        // calls (e.g. Promise.all over multiple photos) execute within the same
        // millisecond and would otherwise download to the SAME temp file —
        // causing one photo to overwrite the others and the PDF to show the
        // same image multiple times.
        const uniq = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const tempUri = `${FileSystem.cacheDirectory ?? ''}ph_${uniq}.${safeExt}`;
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
 * Compressed variant of loadPhotoAsDataUrl, designed for embedding photos in
 * generated PDFs that may contain many reserves (global reports, etc.).
 *
 * Uses expo-image-manipulator to resize to 800 px wide at JPEG 0.55 quality
 * before base64-encoding → ~40–80 KB per photo instead of 500 KB–2 MB.
 * This keeps the full HTML under ~10 MB even for 150-photo reports, well within
 * the memory budget of Print.printToFileAsync's WebView on Android and iOS.
 *
 * On web the browser loads images directly from their URL, so no compression
 * or base64 encoding is needed — the original URI is returned as-is.
 *
 * Returns null on any failure so the caller can skip the photo gracefully.
 */
export async function loadPhotoAsDataUrlForPdf(uri: string): Promise<string | null> {
  if (!uri) return null;
  uri = await resolveMediaRef(uri, { cacheDisk: false }) ?? '';
  if (!uri) return null;
  if (uri.startsWith('data:')) return uri;

  // Web: browser can fetch HTTPS directly — no need to embed as base64
  if (Platform.OS === 'web') {
    const result = await loadPhotoAsDataUrl(uri);
    return result || null;
  }

  // Native: compress before embedding so the HTML stays small
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 800 } }],
      {
        compress: 0.55,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );
    if (!manipulated.base64) return null;
    return `data:image/jpeg;base64,${manipulated.base64}`;
  } catch {
    // Compression failed (e.g. file deleted, low storage) — try uncompressed fallback
    try {
      const result = await loadPhotoAsDataUrl(uri);
      return result || null;
    } catch {
      return null;
    }
  }
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
  uri = await resolveMediaRef(uri, { cacheDisk: false }) ?? '';
  if (!uri) return '';
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
        const uniq = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const tempUri = `${FileSystem.cacheDirectory ?? ''}plan_${uniq}.${ext}`;
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
  annotations: readonly PlanDrawing[] = [],
): Promise<string | null> {
  return preRenderPdfPageToDataUrlImpl(pdfUri, renderW, annotations);
}

/**
 * Adds page-one plan annotations to an image that has already been resolved or
 * converted to a data URL by the caller. Returns null outside the web runtime.
 */
export async function preRenderPlanImageWithAnnotationsToDataUrl(
  resolvedImageUri: string,
  renderW: number,
  annotations: readonly PlanDrawing[] = [],
): Promise<string | null> {
  return preRenderPlanImageWithAnnotationsToDataUrlImpl(resolvedImageUri, renderW, annotations);
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

/**
 * Generates a PDF and opens the OS share sheet (WhatsApp, Mail, Drive, etc.).
 * On web, opens the document in a new browser tab so the user can save/print.
 */
export async function exportPDF(html: string, filename: string = 'buildtrack-export'): Promise<void> {
  const pdfFilename = ensurePdfFilename(filename);
  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    // Popup bloquée par le navigateur : sans cette erreur, le clic sur le
    // bouton PDF échouait en silence (aucun onglet, aucun message).
    if (!win) {
      throw new Error(
        'Fenêtre bloquée par le navigateur — autorisez les popups pour ce site afin d\'ouvrir le PDF.',
      );
    }
    win.document.write(html);
    win.document.close();
    win.document.title = pdfFilename.replace(/\.pdf$/i, '');
    win.focus();
    return;
  }
  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    const targetDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    const shareUri = targetDir ? `${targetDir}${pdfFilename}` : uri;
    if (targetDir) {
      await FileSystem.deleteAsync(shareUri, { idempotent: true }).catch(() => {});
      await FileSystem.copyAsync({ from: uri, to: shareUri });
    }
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(shareUri, { mimeType: 'application/pdf', dialogTitle: pdfFilename, UTI: 'com.adobe.pdf' });
    }
  } catch (e: any) {
    throw new Error(e?.message ?? 'PDF generation failed');
  }
}

/**
 * Generates a PDF and opens the OS print/save dialog (no share sheet).
 * Use this when the user wants to save the PDF to their device or print it,
 * not send it to another app.
 *
 * - Native: opens the system print dialog (which lets the user save the PDF
 *   to Files / Drive / etc., or send it to a printer).
 * - Web: opens the document in a new browser tab and triggers the print
 *   dialog so the user can save it as PDF.
 */
export async function printPDF(html: string, _filename: string = 'buildtrack-export'): Promise<void> {
  const pdfFilename = ensurePdfFilename(_filename);
  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    // Popup bloquée par le navigateur : sans cette erreur, le clic sur le
    // bouton d'impression échouait en silence (aucun onglet, aucun message).
    if (!win) {
      throw new Error(
        'Fenêtre bloquée par le navigateur — autorisez les popups pour ce site afin d\'ouvrir le PDF.',
      );
    }
    win.document.write(html);
    win.document.close();
    win.document.title = pdfFilename.replace(/\.pdf$/i, '');
    win.focus();
    setTimeout(() => { try { win.print(); } catch {} }, 500);
    return;
  }
  try {
    await Print.printAsync({ html });
  } catch (e: any) {
    throw new Error(e?.message ?? 'PDF print failed');
  }
}
