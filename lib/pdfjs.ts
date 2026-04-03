let _promise: Promise<any> | null = null;

function loadPdfjsLib(): Promise<any> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (_promise) return _promise;
  _promise = new Promise<any>(resolve => {
    const win = window as any;
    if (win.pdfjsLib) {
      const lib = win.pdfjsLib;
      if (!lib.GlobalWorkerOptions.workerSrc) {
        lib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      resolve(lib);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      const lib = (window as any).pdfjsLib ?? null;
      if (lib) {
        lib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      resolve(lib);
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return _promise;
}

export const GlobalWorkerOptions = {
  workerSrc: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
};

export function getDocument(args: any): { promise: Promise<any> } {
  return {
    promise: loadPdfjsLib().then(lib => {
      if (!lib) return null;
      return lib.getDocument(args).promise;
    }),
  };
}
