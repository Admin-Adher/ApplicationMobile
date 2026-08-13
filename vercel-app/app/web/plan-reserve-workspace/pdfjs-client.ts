'use client';

let pdfJsModulePromise: Promise<any> | null = null;

const LOCAL_PDF_WORKER_SRC = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export function configurePdfJsWorker(pdfjs: any, workerSrc = LOCAL_PDF_WORKER_SRC) {
  // `pdfjs-dist/webpack.mjs` installs one shared Worker port. Destroying one
  // loading task then destroys that shared worker for every following plan.
  // A worker URL lets PDF.js create and own one worker per loading task.
  pdfjs.GlobalWorkerOptions.workerPort = null;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  return pdfjs;
}

export function createDedicatedPdfLoadingTask(pdfjs: any, source: Record<string, unknown>) {
  const worker = new pdfjs.PDFWorker();
  const loadingTask = pdfjs.getDocument({ ...source, worker });
  let destroyPromise: Promise<void> | null = null;

  return {
    loadingTask,
    worker,
    destroy() {
      if (!destroyPromise) {
        destroyPromise = (async () => {
          try {
            await loadingTask.destroy?.();
          } finally {
            worker.destroy?.();
          }
        })();
      }
      return destroyPromise;
    },
  };
}

export function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist')
      .then(pdfjs => configurePdfJsWorker(pdfjs))
      .catch(error => {
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
