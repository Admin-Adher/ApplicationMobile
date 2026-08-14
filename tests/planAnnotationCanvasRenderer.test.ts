import { describe, expect, it, vi } from 'vitest';
import type { PlanDrawing, PlanDrawingTool } from '../constants/types';
import {
  renderPlanAnnotationsToCanvas,
  renderPlanDrawingToCanvas,
} from '../lib/plan-annotations/canvas-renderer';

function createContextMock() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    ellipse: vi.fn(),
    fillText: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '',
    textBaseline: 'alphabetic',
  };
}

function drawing(tool: PlanDrawingTool, index: number, page = 1): PlanDrawing {
  return {
    id: `${tool}-${index}`,
    tool,
    points: tool === 'text'
      ? [{ x: 15, y: 20 }]
      : [{ x: 10, y: 10 }, { x: 55, y: 72 }],
    color: '#EF4444',
    strokeWidth: 3,
    page,
    ...(tool === 'text' ? { text: 'Contrôle', fontSize: 18 } : {}),
    ...(tool === 'highlight' ? { opacity: 0.24 } : {}),
  };
}

describe('plan annotation canvas renderer', () => {
  it('renders every canonical tool and only the requested PDF page', () => {
    const context = createContextMock();
    const tools: PlanDrawingTool[] = [
      'pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'cloud', 'highlight',
    ];
    const annotations = [
      ...tools.map((tool, index) => drawing(tool, index)),
      drawing('line', 99, 2),
    ];

    const rendered = renderPlanAnnotationsToCanvas(
      context as unknown as CanvasRenderingContext2D,
      720,
      480,
      annotations,
      1,
    );

    expect(rendered).toBe(8);
    expect(context.save).toHaveBeenCalledTimes(8);
    expect(context.restore).toHaveBeenCalledTimes(8);
    expect(context.lineTo).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalledTimes(1);
    expect(context.strokeRect).toHaveBeenCalledTimes(2);
    expect(context.fillRect).toHaveBeenCalledTimes(1);
    expect(context.ellipse).toHaveBeenCalledTimes(1);
    expect(context.fillText).toHaveBeenCalledWith('Contrôle', 108, 96);
    expect(context.quadraticCurveTo).toHaveBeenCalled();
  });

  it('keeps cloud geometry finite and bounded for extremely narrow shapes', () => {
    const context = createContextMock();
    const cloud: PlanDrawing = {
      ...drawing('cloud', 1),
      points: [{ x: 50, y: 0 }, { x: 50, y: 100 }],
    };

    renderPlanDrawingToCanvas(
      context as unknown as CanvasRenderingContext2D,
      cloud,
      720,
      480,
    );

    expect(context.quadraticCurveTo.mock.calls.length).toBeLessThanOrEqual(34);
    expect(context.quadraticCurveTo.mock.calls.flat().every(Number.isFinite)).toBe(true);
  });

  it('sanitizes persisted input and treats legacy drawings as page one', () => {
    const context = createContextMock();
    const legacy = { ...drawing('line', 1), page: undefined };
    const invalid = { ...drawing('line', 2), id: '', points: [{ x: Infinity, y: 10 }] };

    expect(renderPlanAnnotationsToCanvas(
      context as unknown as CanvasRenderingContext2D,
      320,
      200,
      [legacy, invalid],
      1,
    )).toBe(1);
    expect(renderPlanAnnotationsToCanvas(
      context as unknown as CanvasRenderingContext2D,
      0,
      200,
      [legacy],
      1,
    )).toBe(0);
  });
});
