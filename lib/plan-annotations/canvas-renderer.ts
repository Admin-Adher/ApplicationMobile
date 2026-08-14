import {
  filterPlanDrawingsByPage,
  sanitizePlanDrawings,
  type PlanDrawing,
  type PlanDrawingPoint,
} from './model';

/**
 * Canvas adapter for the canonical, percentage-based plan annotation model.
 *
 * This module deliberately has no DOM access of its own. Consumers can render
 * into an on-screen canvas or into the temporary canvas used to rasterize a
 * PDF report, while tests can provide a minimal mocked 2D context.
 */

function toCanvasPoint(point: PlanDrawingPoint, width: number, height: number) {
  return {
    x: (point.x / 100) * width,
    y: (point.y / 100) * height,
  };
}

function drawArrowHead(
  context: CanvasRenderingContext2D,
  start: ReturnType<typeof toCanvasPoint>,
  end: ReturnType<typeof toCanvasPoint>,
  strokeWidth: number,
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length < 1) return;

  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const arrowSize = Math.max(strokeWidth * 4, 12);
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - arrowSize * (unitX - unitY * 0.4),
    end.y - arrowSize * (unitY + unitX * 0.4),
  );
  context.lineTo(
    end.x - arrowSize * (unitX + unitY * 0.4),
    end.y - arrowSize * (unitY - unitX * 0.4),
  );
  context.closePath();
  context.fill();
}

function drawCloud(
  context: CanvasRenderingContext2D,
  first: ReturnType<typeof toCanvasPoint>,
  last: ReturnType<typeof toCanvasPoint>,
) {
  const left = Math.min(first.x, last.x);
  const top = Math.min(first.y, last.y);
  const width = Math.max(Math.abs(last.x - first.x), 1);
  const height = Math.max(Math.abs(last.y - first.y), 1);
  const horizontalBumps = 5;
  const verticalBumps = Math.max(
    2,
    Math.min(12, Math.round(height / Math.max(width / horizontalBumps, 1))),
  );
  const bumpWidth = width / horizontalBumps;
  const bumpHeight = height / verticalBumps;

  context.beginPath();
  context.moveTo(left, top);
  for (let index = 0; index < horizontalBumps; index += 1) {
    const startX = left + index * bumpWidth;
    context.quadraticCurveTo(startX + bumpWidth / 2, top - bumpHeight * 0.45, startX + bumpWidth, top);
  }
  for (let index = 0; index < verticalBumps; index += 1) {
    const startY = top + index * bumpHeight;
    context.quadraticCurveTo(left + width + bumpWidth * 0.45, startY + bumpHeight / 2, left + width, startY + bumpHeight);
  }
  for (let index = horizontalBumps; index > 0; index -= 1) {
    const startX = left + index * bumpWidth;
    context.quadraticCurveTo(startX - bumpWidth / 2, top + height + bumpHeight * 0.45, startX - bumpWidth, top + height);
  }
  for (let index = verticalBumps; index > 0; index -= 1) {
    const startY = top + index * bumpHeight;
    context.quadraticCurveTo(left - bumpWidth * 0.45, startY - bumpHeight / 2, left, startY - bumpHeight);
  }
  context.closePath();
  context.stroke();
}

export function renderPlanDrawingToCanvas(
  context: CanvasRenderingContext2D,
  drawing: PlanDrawing,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (!(canvasWidth > 0) || !(canvasHeight > 0) || drawing.points.length === 0) return;

  const points = drawing.points.map(point => toCanvasPoint(point, canvasWidth, canvasHeight));
  const first = points[0];
  const last = points[points.length - 1] ?? first;
  const opacity = drawing.opacity ?? (drawing.tool === 'highlight' ? 0.3 : 1);

  context.save();
  context.strokeStyle = drawing.color;
  context.fillStyle = drawing.color;
  context.lineWidth = drawing.strokeWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.globalAlpha = opacity;

  switch (drawing.tool) {
    case 'pen':
      context.beginPath();
      context.moveTo(first.x, first.y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
      break;
    case 'line':
    case 'arrow':
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(last.x, last.y);
      context.stroke();
      if (drawing.tool === 'arrow') drawArrowHead(context, first, last, drawing.strokeWidth);
      break;
    case 'rect': {
      const left = Math.min(first.x, last.x);
      const top = Math.min(first.y, last.y);
      context.strokeRect(left, top, Math.abs(last.x - first.x), Math.abs(last.y - first.y));
      break;
    }
    case 'ellipse': {
      const radiusX = Math.abs(last.x - first.x) / 2;
      const radiusY = Math.abs(last.y - first.y) / 2;
      if (radiusX < 0.5 || radiusY < 0.5) break;
      context.beginPath();
      context.ellipse(
        (first.x + last.x) / 2,
        (first.y + last.y) / 2,
        radiusX,
        radiusY,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
      break;
    }
    case 'text':
      context.font = `600 ${drawing.fontSize ?? 14}px Arial, sans-serif`;
      context.textBaseline = 'alphabetic';
      context.fillText(drawing.text ?? '', first.x, first.y);
      break;
    case 'cloud':
      drawCloud(context, first, last);
      break;
    case 'highlight': {
      const left = Math.min(first.x, last.x);
      const top = Math.min(first.y, last.y);
      const width = Math.abs(last.x - first.x);
      const height = Math.abs(last.y - first.y);
      context.fillRect(left, top, width, height);
      context.lineWidth = Math.min(1, drawing.strokeWidth);
      context.strokeRect(left, top, width, height);
      break;
    }
  }

  context.restore();
}

/**
 * Sanitizes persisted input, keeps only the requested PDF page, then draws it.
 * Legacy drawings without a page are canonicalized to page 1 by the model.
 * Returns the number of drawings rendered, which is useful for diagnostics.
 */
export function renderPlanAnnotationsToCanvas(
  context: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  annotations: unknown,
  page = 1,
): number {
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) return 0;
  const drawings = filterPlanDrawingsByPage(sanitizePlanDrawings(annotations), page);
  for (const drawing of drawings) {
    renderPlanDrawingToCanvas(context, drawing, canvasWidth, canvasHeight);
  }
  return drawings.length;
}
