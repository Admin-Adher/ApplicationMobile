import { parseDxf, type DxfParseResult } from '../../../../lib/dxfParser';

const MAX_ENTITIES = 25_000;
const MAX_BYTES = 40 * 1024 * 1024;

export async function readWebDxf(uri: string, signal?: AbortSignal) {
  const response = await fetch(uri, { signal });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('DXF indisponible ou trop volumineux.');
  const file = await response.blob();
  if (file.size > MAX_BYTES) throw new Error('DXF trop volumineux.');
  const drawing = parseDxf(await file.text());
  if (!drawing.entities.length) throw new Error('Le fichier DXF ne contient aucun tracé pris en charge.');
  return drawing;
}

export function paintWebDxf(canvas: HTMLCanvasElement, drawing: DxfParseResult, visible?: ReadonlySet<string>) {
  const context = canvas.getContext('2d');
  if (!context) return false;
  const { width, height } = canvas;
  const padding = 10;
  const scale = Math.min((width - padding * 2) / drawing.width, (height - padding * 2) / drawing.height);
  const dx = (width - drawing.width * scale) / 2;
  const dy = (height - drawing.height * scale) / 2;
  // Match the projection used in the mobile DXF viewer.
  const x = (value: number) => dx + (value - drawing.minX) * scale;
  const y = (value: number) => dy + (drawing.maxY - value) * scale;

  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#28527d';
  context.fillStyle = '#172c42';
  context.lineWidth = Math.max(0.8, width / 1200);
  context.font = '10px Arial, sans-serif';

  for (const entity of drawing.entities.slice(0, MAX_ENTITIES)) {
    if (visible && !visible.has(entity.layer)) continue;
    context.beginPath();
    switch (entity.type) {
      case 'LINE':
        context.moveTo(x(entity.x1), y(entity.y1));
        context.lineTo(x(entity.x2), y(entity.y2));
        break;
      case 'LWPOLYLINE':
        for (const [index, point] of entity.points.entries()) {
          if (index === 0) context.moveTo(x(point.x), y(point.y));
          else context.lineTo(x(point.x), y(point.y));
        }
        if (entity.closed) context.closePath();
        break;
      case 'CIRCLE':
      case 'ARC': {
        const radius = entity.r * scale;
        if (!Number.isFinite(radius) || radius <= 0) continue;
        const start = entity.type === 'ARC' ? (360 - entity.endAngle) * Math.PI / 180 : 0;
        const end = entity.type === 'ARC' ? (360 - entity.startAngle) * Math.PI / 180 : Math.PI * 2;
        context.arc(x(entity.cx), y(entity.cy), radius, start, end);
        break;
      }
      case 'TEXT':
        context.fillText(entity.text, x(entity.x), y(entity.y));
        break;
    }
    context.stroke();
  }
  return true;
}

export function dxfCanvasHeight(width: number) {
  return Math.round(width * 0.7);
}

export async function renderWebDxfToDataUrl(uri: string, width: number) {
  const drawing = await readWebDxf(uri);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = dxfCanvasHeight(width);
  return paintWebDxf(canvas, drawing) ? canvas.toDataURL('image/png') : null;
}
