import { PlanDrawing } from '@/constants/types';

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  size: number,
) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawCloud(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  color: string,
  lineWidth: number,
) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (w < 4 || h < 4) return;

  const r = Math.max(5, Math.min(w, h) * 0.12);
  const bx = Math.max(2, Math.round(w / (r * 2.2)));
  const by = Math.max(2, Math.round(h / (r * 2.2)));

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  for (let i = 0; i < bx; i++) {
    const cx = left + (i + 0.5) * (w / bx);
    ctx.arc(cx, top, r, Math.PI, 0);
  }
  for (let i = 0; i < by; i++) {
    const cy = top + (i + 0.5) * (h / by);
    ctx.arc(left + w, cy, r, -Math.PI / 2, Math.PI / 2);
  }
  for (let i = bx - 1; i >= 0; i--) {
    const cx = left + (i + 0.5) * (w / bx);
    ctx.arc(cx, top + h, r, 0, Math.PI);
  }
  for (let i = by - 1; i >= 0; i--) {
    const cy = top + (i + 0.5) * (h / by);
    ctx.arc(left, cy, r, Math.PI / 2, -Math.PI / 2);
  }

  ctx.stroke();
  ctx.restore();
}

export function drawStrokeOnCanvas(
  ctx: CanvasRenderingContext2D,
  drawing: PlanDrawing,
  canvasW: number,
  canvasH: number,
) {
  const px = (v: number) => (v / 100) * canvasW;
  const py = (v: number) => (v / 100) * canvasH;
  const pts = drawing.points;
  if (pts.length === 0) return;

  ctx.save();
  ctx.strokeStyle = drawing.color;
  ctx.fillStyle = drawing.color;
  ctx.lineWidth = drawing.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (drawing.tool) {
    case 'pen': {
      if (pts.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(px(pts[0].x), py(pts[0].y));
      for (let i = 1; i < pts.length; i++) {
        const mx = (px(pts[i - 1].x) + px(pts[i].x)) / 2;
        const my = (py(pts[i - 1].y) + py(pts[i].y)) / 2;
        ctx.quadraticCurveTo(px(pts[i - 1].x), py(pts[i - 1].y), mx, my);
      }
      ctx.stroke();
      break;
    }
    case 'line': {
      if (pts.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(px(pts[0].x), py(pts[0].y));
      ctx.lineTo(px(pts[1].x), py(pts[1].y));
      ctx.stroke();
      break;
    }
    case 'arrow': {
      if (pts.length < 2) break;
      const ax1 = px(pts[0].x); const ay1 = py(pts[0].y);
      const ax2 = px(pts[1].x); const ay2 = py(pts[1].y);
      ctx.beginPath();
      ctx.moveTo(ax1, ay1);
      ctx.lineTo(ax2, ay2);
      ctx.stroke();
      drawArrowhead(ctx, ax1, ay1, ax2, ay2, Math.max(10, drawing.strokeWidth * 4));
      break;
    }
    case 'rect': {
      if (pts.length < 2) break;
      ctx.beginPath();
      ctx.rect(
        px(pts[0].x), py(pts[0].y),
        px(pts[1].x) - px(pts[0].x), py(pts[1].y) - py(pts[0].y),
      );
      ctx.stroke();
      break;
    }
    case 'ellipse': {
      if (pts.length < 2) break;
      const cx = (px(pts[0].x) + px(pts[1].x)) / 2;
      const cy = (py(pts[0].y) + py(pts[1].y)) / 2;
      const rx = Math.abs(px(pts[1].x) - px(pts[0].x)) / 2;
      const ry = Math.abs(py(pts[1].y) - py(pts[0].y)) / 2;
      if (rx < 1 || ry < 1) break;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'cloud': {
      if (pts.length < 2) break;
      drawCloud(
        ctx,
        px(pts[0].x), py(pts[0].y),
        px(pts[1].x), py(pts[1].y),
        drawing.color, drawing.strokeWidth,
      );
      break;
    }
    case 'highlight': {
      if (pts.length < 2) break;
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = drawing.color;
      ctx.fillRect(
        px(pts[0].x), py(pts[0].y),
        px(pts[1].x) - px(pts[0].x), py(pts[1].y) - py(pts[0].y),
      );
      ctx.restore();
      break;
    }
    case 'text': {
      if (!drawing.text) break;
      const fs = drawing.fontSize ?? 16;
      ctx.font = `700 ${fs}px Inter, sans-serif`;
      ctx.fillStyle = drawing.color;
      ctx.fillText(drawing.text, px(pts[0].x), py(pts[0].y));
      break;
    }
  }

  ctx.restore();
}

export function renderAnnotationsToCanvas(
  canvas: HTMLCanvasElement,
  annotations: PlanDrawing[],
  page?: number,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const filtered = page !== undefined
    ? annotations.filter(a => a.page === undefined || a.page === page)
    : annotations;
  for (const d of filtered) {
    drawStrokeOnCanvas(ctx, d, canvas.width, canvas.height);
  }
}
