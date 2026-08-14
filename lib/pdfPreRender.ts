import type { PlanDrawing } from '@/constants/types';

export async function preRenderPdfPageToDataUrlImpl(
  _pdfUri: string,
  _renderW: number,
  _annotations: readonly PlanDrawing[] = [],
): Promise<string | null> {
  return null;
}

export async function preRenderPlanImageWithAnnotationsToDataUrlImpl(
  _resolvedImageUri: string,
  _renderW: number,
  _annotations: readonly PlanDrawing[] = [],
): Promise<string | null> {
  return null;
}
