export type WebPdfReportType = 'global_reserves' | 'plans' | 'individual_reserve' | 'visit_report';

export const WEB_PDF_BATCH_MAX_RESERVES = 150;
export const WEB_PDF_BATCH_MAX_PHOTOS = 60;
export const WEB_PDF_BATCH_MAX_PLANS = 8;
export const WEB_PDF_BATCH_CONCURRENCY = 3;

function photoCount(reserve: any): number {
  return Array.isArray(reserve?.photos) ? reserve.photos.length : 0;
}

export function partitionReserveReportItems<T>(
  reserves: T[],
  maxReserves = WEB_PDF_BATCH_MAX_RESERVES,
  maxPhotos = WEB_PDF_BATCH_MAX_PHOTOS,
): T[][] {
  if (reserves.length === 0) return [];
  const batches: T[][] = [];
  let current: T[] = [];
  let currentPhotos = 0;

  for (const reserve of reserves) {
    const reservePhotos = photoCount(reserve);
    const overReserveLimit = current.length >= Math.max(1, maxReserves);
    const overPhotoLimit = current.length > 0 && currentPhotos + reservePhotos > Math.max(1, maxPhotos);
    if (overReserveLimit || overPhotoLimit) {
      batches.push(current);
      current = [];
      currentPhotos = 0;
    }
    current.push(reserve);
    currentPhotos += reservePhotos;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  const safeSize = Math.max(1, size);
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
}

function reportPlanId(item: any): string {
  return String(item?.planId ?? item?.plan_id ?? '').trim();
}

function partLabel(language: string, index: number, total: number): string {
  if (language === 'en') return `Part ${index + 1}/${total}`;
  if (language === 'es') return `Parte ${index + 1}/${total}`;
  return `Partie ${index + 1}/${total}`;
}

function withPartLabel(payload: any, language: string, index: number, total: number) {
  const label = partLabel(language, index, total);
  return {
    ...payload,
    companyFilter: [payload.companyFilter, label].filter(Boolean).join(' · '),
    batchPart: index + 1,
    batchTotal: total,
  };
}

export function createWebPdfBatchPayloads(type: WebPdfReportType, payload: any, language: string): any[] {
  if (type === 'global_reserves') {
    const batches = partitionReserveReportItems(Array.isArray(payload.reserves) ? payload.reserves : []);
    if (batches.length <= 1) return [payload];
    return batches.map((reserves, index) => withPartLabel({ ...payload, reserves }, language, index, batches.length));
  }

  if (type === 'plans') {
    const planBatches = chunkItems(Array.isArray(payload.plans) ? payload.plans : [], WEB_PDF_BATCH_MAX_PLANS);
    if (planBatches.length <= 1) return [payload];
    const reserves = Array.isArray(payload.reserves) ? payload.reserves : [];
    const unassigned = reserves.filter((reserve: any) => !reportPlanId(reserve));
    return planBatches.map((plans, index) => {
      const planIds = new Set(plans.map((plan: any) => String(plan?.id ?? '').trim()).filter(Boolean));
      const scopedReserves = reserves.filter((reserve: any) => planIds.has(reportPlanId(reserve)));
      return withPartLabel({
        ...payload,
        plans,
        reserves: index === 0 ? [...unassigned, ...scopedReserves] : scopedReserves,
      }, language, index, planBatches.length);
    });
  }

  return [payload];
}

export function pdfApiErrorMessage(status: number, rawResult: string, parsedResult?: any): string {
  if (status === 504 || /FUNCTION_INVOCATION_TIMEOUT|gateway timeout|timed?\s*out/i.test(rawResult)) {
    return 'Le rapport a dépassé le délai de génération. Réessayez dans quelques instants.';
  }
  if (status === 413 || /request entity too large|payload too large/i.test(rawResult)) {
    return 'Export PDF trop volumineux. Réduisez le périmètre ou filtrez par entreprise, puis réessayez.';
  }
  const parsedError = parsedResult?.error;
  if (typeof parsedError === 'string' && parsedError.trim()) return parsedError;
  if (typeof parsedError?.message === 'string' && parsedError.message.trim()) return parsedError.message;
  if (parsedResult && typeof parsedResult === 'object') return 'Génération PDF impossible.';
  const preview = rawResult.slice(0, 240).trim();
  return preview && preview !== '[object Object]' ? preview : 'Génération PDF impossible.';
}
