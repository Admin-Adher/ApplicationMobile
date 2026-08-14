import { describe, expect, it } from 'vitest';
import {
  PlanAnnotationRasterizationError,
  requireAnnotatedPlanCapture,
} from '../lib/plan-annotations/report-capture';

const annotation = {
  id: 'stroke-1',
  tool: 'pen' as const,
  color: '#ef4444',
  strokeWidth: 3,
  page: 1,
  points: [{ x: 10, y: 20 }, { x: 20, y: 30 }],
};

describe('annotated plan report capture', () => {
  it('keeps valid captures and unannotated fallbacks', () => {
    expect(requireAnnotatedPlanCapture('data:image/jpeg;base64,ok', [annotation]))
      .toBe('data:image/jpeg;base64,ok');
    expect(requireAnnotatedPlanCapture(null, [])).toBeNull();
  });

  it('fails closed when an annotated native capture is missing', () => {
    expect(() => requireAnnotatedPlanCapture(null, [annotation]))
      .toThrow(PlanAnnotationRasterizationError);
  });

  it('ignores malformed annotation input rather than inventing report content', () => {
    expect(requireAnnotatedPlanCapture(null, [{ ...annotation, tool: 'invalid' } as any])).toBeNull();
  });
});
