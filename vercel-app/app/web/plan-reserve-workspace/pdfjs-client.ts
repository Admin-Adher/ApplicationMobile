'use client';

let pdfJsModulePromise: Promise<any> | null = null;

export function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist/webpack.mjs').catch(error => {
      pdfJsModulePromise = null;
      throw error;
    });
  }
  return pdfJsModulePromise;
}

export function warmPdfJsWhenIdle() {
  if (typeof window === 'undefined' || !('Worker' in window)) return () => undefined;

  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => undefined;

  const warm = () => {
    void loadPdfJs().catch(() => undefined);
  };

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const idleId = idleWindow.requestIdleCallback(warm, { timeout: 2500 });
    return () => idleWindow.cancelIdleCallback?.(idleId);
  }

  const timeoutId = window.setTimeout(warm, 900);
  return () => window.clearTimeout(timeoutId);
}
