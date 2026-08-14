import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPlanImageWithAnnotationsToDataUrl } from '../lib/plan-annotations/image-rasterizer';

function createDomHarness() {
  const context = {
    drawImage: vi.fn(),
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
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,composite'),
  };
  const image: Record<string, any> = {
    naturalWidth: 1440,
    naturalHeight: 720,
    width: 1440,
    height: 720,
    crossOrigin: '',
    onload: null,
    onerror: null,
  };
  Object.defineProperty(image, 'src', {
    configurable: true,
    set(value: string) {
      image.currentSrc = value;
      queueMicrotask(() => image.onload?.());
    },
  });
  const documentMock = {
    createElement: vi.fn((tag: string) => tag === 'img' ? image : canvas),
  };
  vi.stubGlobal('document', documentMock);
  return { canvas, context, image };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('annotated plan image rasterizer', () => {
  it('draws a resolved image before its page-one annotations', async () => {
    const { canvas, context, image } = createDomHarness();
    const result = await renderPlanImageWithAnnotationsToDataUrl(
      'data:image/png;base64,plan',
      720,
      [{
        id: 'line-1',
        tool: 'line',
        points: [{ x: 10, y: 20 }, { x: 80, y: 90 }],
        color: '#EF4444',
        strokeWidth: 3,
        page: 1,
      }],
    );

    expect(result).toBe('data:image/jpeg;base64,composite');
    expect(canvas.width).toBe(720);
    expect(canvas.height).toBe(360);
    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, 720, 360);
    expect(context.lineTo).toHaveBeenCalledWith(576, 324);
    expect(image.crossOrigin).toBe('');
  });

  it('requests anonymous CORS for an already resolved private-media URL', async () => {
    const { image } = createDomHarness();

    await renderPlanImageWithAnnotationsToDataUrl(
      'https://media.example.test/signed-plan.png?token=resolved',
      720,
      [],
    );

    expect(image.crossOrigin).toBe('anonymous');
  });

  it('fails closed instead of returning an unannotated image when composition fails', async () => {
    const { image } = createDomHarness();
    Object.defineProperty(image, 'src', {
      configurable: true,
      set() {
        queueMicrotask(() => image.onerror?.());
      },
    });

    await expect(renderPlanImageWithAnnotationsToDataUrl(
      'https://media.example.test/invalid-plan.png',
      720,
      [{
        id: 'line-1',
        tool: 'line',
        points: [{ x: 10, y: 20 }, { x: 80, y: 90 }],
        color: '#EF4444',
        strokeWidth: 3,
        page: 1,
      }],
    )).rejects.toThrow('Plan annotations could not be rasterized.');
  });
});
