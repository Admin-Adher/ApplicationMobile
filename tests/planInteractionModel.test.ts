import { describe, expect, it } from 'vitest';
import {
  PLAN_PIN_TOUCH_TARGET,
  calculatePdfFitScale,
  resolvePlanCanvasTapIntent,
} from '../vercel-app/app/web/plan-reserve-workspace/plan-interaction';
import { shouldRenderWorkspaceDetail } from '../vercel-app/app/web/plan-reserve-workspace/useResponsiveWorkspace';

describe('BuildTrack mobile plan interaction model', () => {
  it('fits the plan to the real viewport without artificial overscaling', () => {
    expect(calculatePdfFitScale(304, 760)).toBe(0.4);
    expect(calculatePdfFitScale(760, 760)).toBe(1);
    expect(calculatePdfFitScale(1200, 760)).toBe(1.2);
    expect(calculatePdfFitScale(0, 760)).toBe(1);
  });

  it('requires an explicit create mode before a canvas tap creates a reserve', () => {
    const base = {
      placementActive: false,
      moveMode: false,
      canMovePins: true,
      focusedReserveId: null,
      canCreate: true,
    };

    expect(resolvePlanCanvasTapIntent({ ...base, createModeActive: false })).toBe('none');
    expect(resolvePlanCanvasTapIntent({ ...base, createModeActive: true })).toBe('create-reserve');
    expect(resolvePlanCanvasTapIntent({ ...base, placementActive: true, createModeActive: true })).toBe('place-existing-pin');
    expect(resolvePlanCanvasTapIntent({ ...base, focusedReserveId: 'r1', createModeActive: true })).toBe('clear-focus');
    expect(resolvePlanCanvasTapIntent({ ...base, moveMode: true, focusedReserveId: 'r1', createModeActive: false })).toBe('move-focused-pin');
  });

  it('keeps detail media out of compact list mode and meets the touch target floor', () => {
    expect(shouldRenderWorkspaceDetail(true, false)).toBe(false);
    expect(shouldRenderWorkspaceDetail(true, true)).toBe(true);
    expect(shouldRenderWorkspaceDetail(false, false)).toBe(true);
    expect(PLAN_PIN_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  });
});
