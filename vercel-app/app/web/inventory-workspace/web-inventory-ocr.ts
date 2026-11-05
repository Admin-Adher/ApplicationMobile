import { extractInventoryLabelFields } from '../../../../lib/inventoryOcrParser';

const LANGS = { fr: 'fra', en: 'eng', es: 'spa' } as const;

export async function readInventoryLabel(file: File, language: keyof typeof LANGS) {
  const { default: Tesseract } = await import('tesseract.js');
  const base = window.location.origin + '/api/ocr-assets/7.0.0';
  const worker = await Tesseract.createWorker(LANGS[language], Tesseract.OEM.LSTM_ONLY, {
    workerPath: base + '/worker.min.js',
    corePath: base,
    langPath: base,
    workerBlobURL: false,
    legacyCore: false,
    legacyLang: false,
  });
  try {
    const { data } = await worker.recognize(file);
    return extractInventoryLabelFields(data.text);
  } finally {
    await worker.terminate();
  }
}
