import { getDocument } from '@/lib/pdfjs.web';

export async function preRenderPdfPageToDataUrlImpl(
  pdfUri: string,
  renderW: number,
): Promise<string | null> {
  if (typeof document === 'undefined') return null;

  try {
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
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch {
    return null;
  }
}
