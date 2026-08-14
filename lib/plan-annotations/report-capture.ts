import { sanitizePlanDrawings, type PlanDrawing } from './model';

export class PlanAnnotationRasterizationError extends Error {
  constructor(message = 'Plan annotations could not be rasterized.', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PlanAnnotationRasterizationError';
  }
}

/**
 * Prevents annotated reports from silently falling back to the unannotated
 * source when a native WebView capture could not be produced.
 */
export function requireAnnotatedPlanCapture(
  capture: string | null,
  annotations: readonly PlanDrawing[] = [],
): string | null {
  if (!capture && sanitizePlanDrawings(annotations).length > 0) {
    throw new PlanAnnotationRasterizationError('The annotated plan capture is unavailable.');
  }
  return capture;
}
