export const PLAN_PIN_TOUCH_TARGET = 44;

export type PlanCanvasTapIntent =
  | 'place-existing-pin'
  | 'move-focused-pin'
  | 'clear-focus'
  | 'create-reserve'
  | 'none';

export function calculatePdfFitScale(viewportWidth: number, pageWidth: number) {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(pageWidth) || viewportWidth <= 0 || pageWidth <= 0) {
    return 1;
  }
  return Number(Math.min(1.2, Math.max(0.08, viewportWidth / pageWidth)).toFixed(3));
}

export function resolvePlanCanvasTapIntent({
  placementActive,
  moveMode,
  canMovePins,
  focusedReserveId,
  canCreate,
  createModeActive,
}: {
  placementActive: boolean;
  moveMode: boolean;
  canMovePins: boolean;
  focusedReserveId?: string | null;
  canCreate: boolean;
  createModeActive: boolean;
}): PlanCanvasTapIntent {
  if (placementActive) return 'place-existing-pin';
  if (moveMode && canMovePins && focusedReserveId) return 'move-focused-pin';
  if (focusedReserveId) return 'clear-focus';
  if (canCreate && createModeActive) return 'create-reserve';
  return 'none';
}
