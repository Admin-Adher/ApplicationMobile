import type { PlanDrawing } from '../constants/types';
import { sanitizePlanDrawing } from '../lib/plan-annotations/model';

const MAX_BRIDGE_MESSAGE_LENGTH = 32 * 1024 * 1024;
const MAX_BRIDGE_ANNOTATIONS = 5_000;
const MAX_BRIDGE_CAPTURE_LENGTH = 30 * 1024 * 1024;
const MAX_BRIDGE_ID_LENGTH = 128;
const MAX_BRIDGE_ERROR_LENGTH = 240;

/**
 * Serializes data embedded in an inline <script> without allowing user data to
 * terminate that script. JSON.stringify alone leaves `</script>`, HTML comment
 * openers and JavaScript line separators intact.
 */
export function serializeForInlineScript(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return 'null';
  return serialized
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function parseBridgeId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_BRIDGE_ID_LENGTH) return null;
  if (value.trim() !== value || /[\u0000-\u001F\u007F]/.test(value)) return null;
  return value;
}

function parseStrictDrawings(value: unknown): PlanDrawing[] | null {
  if (!Array.isArray(value) || value.length > MAX_BRIDGE_ANNOTATIONS) return null;
  const drawings: PlanDrawing[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    const result = sanitizePlanDrawing(candidate);
    if (!result.drawing || result.issues.length > 0 || ids.has(result.drawing.id)) return null;
    ids.add(result.drawing.id);
    drawings.push(result.drawing);
  }
  return drawings;
}

export type NativePdfPlanBridgeMessage =
  | { type: 'tap'; planX: number; planY: number }
  | { type: 'pinSelect'; reserveId: string }
  | { type: 'pinMove'; reserveId: string; planX: number; planY: number }
  | { type: 'pinFocus'; reserveId: string | null }
  | { type: 'annotationsChange'; annotations: PlanDrawing[]; canUndo: boolean; canRedo: boolean; canClear: boolean }
  | { type: 'annotationState'; canUndo: boolean; canRedo: boolean; canClear: boolean; annotationCount: number }
  | { type: 'pageCount'; count: number }
  | { type: 'pageChange'; page: number }
  | { type: 'planReady' }
  | { type: 'canvasCapture'; dataUrl: string | null }
  | { type: 'zoomChange'; zoom: number }
  | { type: 'planError'; error: string };

/** Accepts only the small, explicit protocol emitted by the native plan WebView. */
export function parseNativePdfPlanBridgeMessage(raw: unknown): NativePdfPlanBridgeMessage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_BRIDGE_MESSAGE_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return null;

  switch (parsed.type) {
    case 'tap':
      return isFiniteInRange(parsed.planX, 0, 100) && isFiniteInRange(parsed.planY, 0, 100)
        ? { type: 'tap', planX: parsed.planX, planY: parsed.planY }
        : null;
    case 'pinSelect': {
      const reserveId = parseBridgeId(parsed.reserveId);
      return reserveId ? { type: 'pinSelect', reserveId } : null;
    }
    case 'pinMove': {
      const reserveId = parseBridgeId(parsed.reserveId);
      return reserveId && isFiniteInRange(parsed.planX, 0, 100) && isFiniteInRange(parsed.planY, 0, 100)
        ? { type: 'pinMove', reserveId, planX: parsed.planX, planY: parsed.planY }
        : null;
    }
    case 'pinFocus': {
      if (parsed.reserveId === null) return { type: 'pinFocus', reserveId: null };
      const reserveId = parseBridgeId(parsed.reserveId);
      return reserveId ? { type: 'pinFocus', reserveId } : null;
    }
    case 'annotationsChange': {
      const annotations = parseStrictDrawings(parsed.annotations);
      return annotations
        && typeof parsed.canUndo === 'boolean'
        && typeof parsed.canRedo === 'boolean'
        && typeof parsed.canClear === 'boolean'
        ? {
            type: 'annotationsChange',
            annotations,
            canUndo: parsed.canUndo,
            canRedo: parsed.canRedo,
            canClear: parsed.canClear,
          }
        : null;
    }
    case 'annotationState':
      return typeof parsed.canUndo === 'boolean'
        && typeof parsed.canRedo === 'boolean'
        && typeof parsed.canClear === 'boolean'
        && Number.isSafeInteger(parsed.annotationCount)
        && (parsed.annotationCount as number) >= 0
        && (parsed.annotationCount as number) <= MAX_BRIDGE_ANNOTATIONS
        ? {
            type: 'annotationState',
            canUndo: parsed.canUndo,
            canRedo: parsed.canRedo,
            canClear: parsed.canClear,
            annotationCount: parsed.annotationCount as number,
          }
        : null;
    case 'pageCount':
      return Number.isSafeInteger(parsed.count) && (parsed.count as number) >= 1 && (parsed.count as number) <= 100_000
        ? { type: 'pageCount', count: parsed.count as number }
        : null;
    case 'pageChange':
      return Number.isSafeInteger(parsed.page) && (parsed.page as number) >= 1 && (parsed.page as number) <= 100_000
        ? { type: 'pageChange', page: parsed.page as number }
        : null;
    case 'planReady':
      return { type: 'planReady' };
    case 'canvasCapture': {
      if (parsed.dataUrl === null) return { type: 'canvasCapture', dataUrl: null };
      if (
        typeof parsed.dataUrl !== 'string'
        || parsed.dataUrl.length > MAX_BRIDGE_CAPTURE_LENGTH
        || !/^data:image\/(?:jpeg|png);base64,/i.test(parsed.dataUrl)
      ) return null;
      return { type: 'canvasCapture', dataUrl: parsed.dataUrl };
    }
    case 'zoomChange':
      return isFiniteInRange(parsed.zoom, 0.05, 10)
        ? { type: 'zoomChange', zoom: parsed.zoom }
        : null;
    case 'planError':
      return typeof parsed.error === 'string' && parsed.error.length > 0 && parsed.error.length <= MAX_BRIDGE_ERROR_LENGTH
        ? { type: 'planError', error: parsed.error }
        : null;
    default:
      return null;
  }
}
