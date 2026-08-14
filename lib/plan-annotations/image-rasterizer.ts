import { renderPlanAnnotationsToCanvas } from './canvas-renderer';
import { sanitizePlanDrawings, type PlanDrawing } from './model';
import { PlanAnnotationRasterizationError } from './report-capture';

export { PlanAnnotationRasterizationError } from './report-capture';

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = document.createElement('img');
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Plan image could not be decoded.'));
    if (!source.startsWith('data:') && !source.startsWith('blob:')) {
      image.crossOrigin = 'anonymous';
    }
    image.src = source;
  });
}

/**
 * Composites annotations onto an image that has already passed through the
 * caller's private-media resolution/data-URL pipeline. This helper performs no
 * storage lookup and therefore cannot bypass RLS or private-media controls.
 */
export async function renderPlanImageWithAnnotationsToDataUrl(
  resolvedImageUri: string,
  renderWidth: number,
  annotations: readonly PlanDrawing[] = [],
  quality = 0.88,
): Promise<string | null> {
  if (typeof document === 'undefined' || !resolvedImageUri || !(renderWidth > 0)) return null;
  const hasAnnotations = sanitizePlanDrawings(annotations).length > 0;

  try {
    const image = await loadImage(resolvedImageUri);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
      if (hasAnnotations) throw new PlanAnnotationRasterizationError('The annotated plan image has invalid dimensions.');
      return null;
    }

    const width = Math.max(1, Math.round(Math.min(renderWidth, sourceWidth)));
    const height = Math.max(1, Math.round(sourceHeight * (width / sourceWidth)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      if (hasAnnotations) throw new PlanAnnotationRasterizationError('Canvas is unavailable for annotated plan export.');
      return null;
    }

    context.drawImage(image, 0, 0, width, height);
    renderPlanAnnotationsToCanvas(context, width, height, annotations, 1);
    return canvas.toDataURL('image/jpeg', Math.max(0.1, Math.min(0.95, quality)));
  } catch (error) {
    if (hasAnnotations) {
      if (error instanceof PlanAnnotationRasterizationError) throw error;
      throw new PlanAnnotationRasterizationError(undefined, { cause: error });
    }
    return null;
  }
}
