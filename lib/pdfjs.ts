let _promise: Promise<any> | null = null;
const PDFJS_VERSION = '6.2.108';
const PDFJS_MODULE_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.mjs`;

function loadPdfjsLib(): Promise<any> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (_promise) return _promise;
  _promise = new Promise<any>(resolve => {
    const win = window as any;
    if (win.pdfjsLib) {
      const lib = win.pdfjsLib;
      if (!lib.GlobalWorkerOptions.workerSrc) {
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      }
      resolve(lib);
      return;
    }
    const onReady = () => {
      window.removeEventListener('buildtrack:pdfjs-ready', onReady);
      resolve((window as any).pdfjsLib ?? null);
    };
    window.addEventListener('buildtrack:pdfjs-ready', onReady, { once: true });
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import * as pdfjsLib from '${PDFJS_MODULE_URL}';
      pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS_WORKER_URL}';
      window.pdfjsLib = pdfjsLib;
      window.dispatchEvent(new Event('buildtrack:pdfjs-ready'));
    `;
    script.onerror = () => {
      window.removeEventListener('buildtrack:pdfjs-ready', onReady);
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return _promise;
}

export const GlobalWorkerOptions = {
  workerSrc: PDFJS_WORKER_URL,
};

export function getDocument(args: any): { promise: Promise<any> } {
  return {
    promise: loadPdfjsLib().then(lib => {
      if (!lib) return null;
      return lib.getDocument(args).promise;
    }),
  };
}
