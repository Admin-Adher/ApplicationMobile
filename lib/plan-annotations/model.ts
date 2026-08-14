import type {
  PlanDrawing,
  PlanDrawingPoint,
  PlanDrawingTool,
} from '../../constants/types';

export type { PlanDrawing, PlanDrawingPoint, PlanDrawingTool } from '../../constants/types';

/** Canonical tool list shared by every plan-annotation adapter. */
export const PLAN_DRAWING_TOOLS = [
  'pen',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'text',
  'cloud',
  'highlight',
] as const satisfies readonly PlanDrawingTool[];

export const LEGACY_PLAN_DRAWING_PAGE = 1;
export const DEFAULT_PLAN_ANNOTATION_HISTORY_LIMIT = 20;
export const DEFAULT_PLAN_POINT_SIMPLIFICATION_TOLERANCE = 0.05;

const DEFAULT_COLOR = '#EF4444';
const DEFAULT_STROKE_WIDTH = 3;
const DEFAULT_FONT_SIZE = 14;
const MAX_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 80;
const MAX_POINTS_PER_DRAWING = 10_000;
const MAX_PAGE = 100_000;
const MAX_HISTORY_LIMIT = 100;
const MIN_STROKE_WIDTH = 0.5;
const MAX_STROKE_WIDTH = 64;
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 144;
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const TOOL_SET = new Set<string>(PLAN_DRAWING_TOOLS);

export interface PlanDrawingSanitizationIssue {
  code:
    | 'not_object'
    | 'invalid_id'
    | 'invalid_tool'
    | 'invalid_points'
    | 'invalid_geometry'
    | 'missing_text'
    | 'sanitized_field';
  path: string;
}

export interface PlanDrawingSanitizationResult {
  drawing: PlanDrawing | null;
  issues: readonly PlanDrawingSanitizationIssue[];
}

export interface PlanAnnotationSnapshot {
  readonly drawings: readonly PlanDrawing[];
  readonly selectedId: string | null;
}

export interface PlanAnnotationSession {
  readonly drawings: readonly PlanDrawing[];
  readonly draft: PlanDrawing | null;
  readonly selectedId: string | null;
  readonly undoStack: readonly PlanAnnotationSnapshot[];
  readonly redoStack: readonly PlanAnnotationSnapshot[];
  readonly historyLimit: number;
  readonly pointSimplificationTolerance: number;
}

export interface CreatePlanAnnotationSessionOptions {
  historyLimit?: number;
  pointSimplificationTolerance?: number;
  selectedId?: string | null;
}

export interface BeginPlanDrawingCommand {
  id: string;
  tool: PlanDrawingTool;
  point: PlanDrawingPoint;
  color?: string;
  strokeWidth?: number;
  page?: number;
  text?: string;
  fontSize?: number;
  opacity?: number;
}

export interface CommitPlanDrawingCommand {
  text?: string;
  fontSize?: number;
  opacity?: number;
  simplifyTolerance?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.replace(CONTROL_CHARACTERS, '').trim().slice(0, MAX_ID_LENGTH);
  return id || null;
}

function sanitizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/[\u2028\u2029]/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function sanitizeColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_COLOR;
  const color = value.trim();
  return HEX_COLOR.test(color) ? color.toUpperCase() : DEFAULT_COLOR;
}

function sanitizeStrokeWidth(value: unknown): number {
  const width = finiteNumber(value);
  return width === null ? DEFAULT_STROKE_WIDTH : clamp(width, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH);
}

function sanitizeFontSize(value: unknown): number {
  const size = finiteNumber(value);
  return size === null ? DEFAULT_FONT_SIZE : clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE);
}

function sanitizeOpacity(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const opacity = finiteNumber(value);
  return opacity === null ? undefined : clamp(opacity, 0, 1);
}

export function resolvePlanDrawingPage(page: unknown): number {
  const value = finiteNumber(page);
  if (value === null) return LEGACY_PLAN_DRAWING_PAGE;
  return clamp(Math.trunc(value), LEGACY_PLAN_DRAWING_PAGE, MAX_PAGE);
}

export function sanitizePlanDrawingPoint(point: unknown): PlanDrawingPoint | null {
  if (!point || typeof point !== 'object' || Array.isArray(point)) return null;
  const candidate = point as Record<string, unknown>;
  const x = finiteNumber(candidate.x);
  const y = finiteNumber(candidate.y);
  if (x === null || y === null) return null;
  return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
}

function pointsDiffer(left: PlanDrawingPoint, right: PlanDrawingPoint): boolean {
  return left.x !== right.x || left.y !== right.y;
}

function hasDrawableGeometry(drawing: PlanDrawing): boolean {
  if (drawing.tool === 'text') return drawing.points.length >= 1 && !!drawing.text;
  if (drawing.points.length < 2) return false;
  const first = drawing.points[0];
  return drawing.points.slice(1).some(point => pointsDiffer(first, point));
}

/**
 * Converts unknown persisted input into the canonical PlanDrawing contract.
 * Text remains plain domain text: HTML/JavaScript escaping belongs to the
 * rendering adapter for its target context.
 */
export function sanitizePlanDrawing(input: unknown): PlanDrawingSanitizationResult {
  const issues: PlanDrawingSanitizationIssue[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { drawing: null, issues: [{ code: 'not_object', path: '' }] };
  }

  const candidate = input as Record<string, unknown>;
  const id = sanitizeId(candidate.id);
  if (!id) issues.push({ code: 'invalid_id', path: 'id' });
  const tool = typeof candidate.tool === 'string' && TOOL_SET.has(candidate.tool)
    ? candidate.tool as PlanDrawingTool
    : null;
  if (!tool) issues.push({ code: 'invalid_tool', path: 'tool' });

  const rawPoints = Array.isArray(candidate.points)
    ? candidate.points.slice(0, MAX_POINTS_PER_DRAWING)
    : [];
  const points = rawPoints
    .map(sanitizePlanDrawingPoint)
    .filter((point): point is PlanDrawingPoint => point !== null);
  const pointCoordinatesChanged = rawPoints.some((rawPoint, index) => {
    if (!rawPoint || typeof rawPoint !== 'object' || Array.isArray(rawPoint)) return false;
    const source = rawPoint as Record<string, unknown>;
    const canonical = points[index];
    return !canonical || source.x !== canonical.x || source.y !== canonical.y;
  });
  if (!Array.isArray(candidate.points) || points.length !== candidate.points.length) {
    issues.push({ code: 'invalid_points', path: 'points' });
  }

  if (!id || !tool) return { drawing: null, issues };

  const drawing: PlanDrawing = {
    id,
    tool,
    points,
    color: sanitizeColor(candidate.color),
    strokeWidth: sanitizeStrokeWidth(candidate.strokeWidth),
    page: resolvePlanDrawingPage(candidate.page),
  };

  const text = sanitizeText(candidate.text);
  if (tool === 'text') {
    drawing.text = text;
    drawing.fontSize = sanitizeFontSize(candidate.fontSize);
    if (!text) issues.push({ code: 'missing_text', path: 'text' });
  }
  const opacity = sanitizeOpacity(candidate.opacity);
  if (opacity !== undefined) drawing.opacity = opacity;

  if (
    drawing.color !== candidate.color
    || drawing.strokeWidth !== candidate.strokeWidth
    || drawing.page !== candidate.page
    || pointCoordinatesChanged
    || (tool === 'text' && (drawing.text !== candidate.text || drawing.fontSize !== candidate.fontSize))
    || (candidate.opacity !== undefined && drawing.opacity !== candidate.opacity)
  ) {
    issues.push({ code: 'sanitized_field', path: '*' });
  }

  if (!hasDrawableGeometry(drawing)) {
    issues.push({ code: 'invalid_geometry', path: 'points' });
    return { drawing: null, issues };
  }
  return { drawing, issues };
}

export function sanitizePlanDrawings(input: unknown): PlanDrawing[] {
  if (!Array.isArray(input)) return [];
  const drawings: PlanDrawing[] = [];
  const indexById = new Map<string, number>();
  for (const item of input) {
    const drawing = sanitizePlanDrawing(item).drawing;
    if (!drawing) continue;
    const existingIndex = indexById.get(drawing.id);
    if (existingIndex === undefined) {
      indexById.set(drawing.id, drawings.length);
      drawings.push(drawing);
    } else {
      // A duplicated object ID is one logical object; latest input wins while
      // its stable position in the document is preserved.
      drawings[existingIndex] = drawing;
    }
  }
  return drawings;
}

export function filterPlanDrawingsByPage(
  drawings: readonly PlanDrawing[],
  page: number,
): PlanDrawing[] {
  const targetPage = resolvePlanDrawingPage(page);
  return drawings.filter(drawing => resolvePlanDrawingPage(drawing.page) === targetPage);
}

function perpendicularDistanceSquared(
  point: PlanDrawingPoint,
  start: PlanDrawingPoint,
  end: PlanDrawingPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  const projectedX = start.x + t * dx;
  const projectedY = start.y + t * dy;
  const px = point.x - projectedX;
  const py = point.y - projectedY;
  return px * px + py * py;
}

/** Iterative Ramer-Douglas-Peucker simplification in normalized 0..100 units. */
export function simplifyPlanDrawingPoints(
  input: readonly PlanDrawingPoint[],
  tolerance = DEFAULT_PLAN_POINT_SIMPLIFICATION_TOLERANCE,
): PlanDrawingPoint[] {
  const points = input
    .map(sanitizePlanDrawingPoint)
    .filter((point): point is PlanDrawingPoint => point !== null)
    .filter((point, index, all) => index === 0 || pointsDiffer(point, all[index - 1]));
  if (points.length <= 2 || !Number.isFinite(tolerance) || tolerance <= 0) return points;

  const threshold = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop()!;
    let farthestIndex = -1;
    let farthestDistance = threshold;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = perpendicularDistanceSquared(points[index], points[startIndex], points[endIndex]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex !== -1) {
      keep[farthestIndex] = 1;
      stack.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

function sanitizeHistoryLimit(value: unknown): number {
  const limit = finiteNumber(value);
  if (limit === null) return DEFAULT_PLAN_ANNOTATION_HISTORY_LIMIT;
  return clamp(Math.trunc(limit), 0, MAX_HISTORY_LIMIT);
}

function sanitizeTolerance(value: unknown): number {
  const tolerance = finiteNumber(value);
  return tolerance === null || tolerance < 0
    ? DEFAULT_PLAN_POINT_SIMPLIFICATION_TOLERANCE
    : tolerance;
}

function selectedIdFor(drawings: readonly PlanDrawing[], selectedId: string | null | undefined): string | null {
  if (!selectedId) return null;
  return drawings.some(drawing => drawing.id === selectedId) ? selectedId : null;
}

function snapshot(session: PlanAnnotationSession): PlanAnnotationSnapshot {
  return { drawings: session.drawings, selectedId: session.selectedId };
}

function boundedPush<T>(items: readonly T[], item: T, limit: number): readonly T[] {
  if (limit <= 0) return [];
  return [...items, item].slice(-limit);
}

function commitDocumentMutation(
  session: PlanAnnotationSession,
  drawings: readonly PlanDrawing[],
  selectedId: string | null,
): PlanAnnotationSession {
  return {
    ...session,
    drawings,
    draft: null,
    selectedId: selectedIdFor(drawings, selectedId),
    undoStack: boundedPush(session.undoStack, snapshot(session), session.historyLimit),
    redoStack: [],
  };
}

export function createPlanAnnotationSession(
  drawings: unknown = [],
  options: CreatePlanAnnotationSessionOptions = {},
): PlanAnnotationSession {
  const canonicalDrawings = sanitizePlanDrawings(drawings);
  return {
    drawings: canonicalDrawings,
    draft: null,
    selectedId: selectedIdFor(canonicalDrawings, options.selectedId),
    undoStack: [],
    redoStack: [],
    historyLimit: sanitizeHistoryLimit(options.historyLimit),
    pointSimplificationTolerance: sanitizeTolerance(options.pointSimplificationTolerance),
  };
}

function createDraft(command: BeginPlanDrawingCommand): PlanDrawing | null {
  const id = sanitizeId(command.id);
  const point = sanitizePlanDrawingPoint(command.point);
  if (!id || !point || !TOOL_SET.has(command.tool)) return null;
  const draft: PlanDrawing = {
    id,
    tool: command.tool,
    points: [point],
    color: sanitizeColor(command.color),
    strokeWidth: sanitizeStrokeWidth(command.strokeWidth),
    page: resolvePlanDrawingPage(command.page),
  };
  if (command.tool === 'text') {
    const text = sanitizeText(command.text);
    if (text) draft.text = text;
    draft.fontSize = sanitizeFontSize(command.fontSize);
  }
  const opacity = sanitizeOpacity(command.opacity);
  if (opacity !== undefined) draft.opacity = opacity;
  return draft;
}

export function beginPlanDrawing(
  session: PlanAnnotationSession,
  command: BeginPlanDrawingCommand,
): PlanAnnotationSession {
  const draft = createDraft(command);
  if (!draft || session.drawings.some(drawing => drawing.id === draft.id)) return session;
  return { ...session, draft, selectedId: null };
}

export function appendPlanDrawingPoint(
  session: PlanAnnotationSession,
  point: PlanDrawingPoint,
): PlanAnnotationSession {
  if (!session.draft) return session;
  const canonicalPoint = sanitizePlanDrawingPoint(point);
  if (!canonicalPoint) return session;
  const currentPoints = session.draft.points;
  const previousPoint = currentPoints[currentPoints.length - 1];
  if (previousPoint && !pointsDiffer(previousPoint, canonicalPoint)) return session;

  let points: PlanDrawingPoint[];
  if (session.draft.tool === 'pen') {
    if (currentPoints.length >= MAX_POINTS_PER_DRAWING) return session;
    points = [...currentPoints, canonicalPoint];
  } else if (session.draft.tool === 'text') {
    return session;
  } else {
    points = currentPoints.length === 1
      ? [currentPoints[0], canonicalPoint]
      : [currentPoints[0], canonicalPoint];
  }
  return { ...session, draft: { ...session.draft, points } };
}

export function commitPlanDrawing(
  session: PlanAnnotationSession,
  command: CommitPlanDrawingCommand = {},
): PlanAnnotationSession {
  if (!session.draft) return session;
  let points = session.draft.points;
  if (session.draft.tool === 'pen') {
    points = simplifyPlanDrawingPoints(
      points,
      command.simplifyTolerance ?? session.pointSimplificationTolerance,
    );
  }
  const candidate: PlanDrawing = {
    ...session.draft,
    points,
  };
  if (candidate.tool === 'text') {
    candidate.text = sanitizeText(command.text ?? candidate.text);
    candidate.fontSize = sanitizeFontSize(command.fontSize ?? candidate.fontSize);
  }
  const opacity = sanitizeOpacity(command.opacity ?? candidate.opacity);
  if (opacity === undefined) delete candidate.opacity;
  else candidate.opacity = opacity;

  const drawing = sanitizePlanDrawing(candidate).drawing;
  if (!drawing) return { ...session, draft: null };
  return commitDocumentMutation(session, [...session.drawings, drawing], drawing.id);
}

export function cancelPlanDrawing(session: PlanAnnotationSession): PlanAnnotationSession {
  return session.draft ? { ...session, draft: null } : session;
}

export function selectPlanDrawing(
  session: PlanAnnotationSession,
  drawingId: string | null,
): PlanAnnotationSession {
  const selectedId = selectedIdFor(session.drawings, drawingId);
  return selectedId === session.selectedId ? session : { ...session, selectedId };
}

export function getSelectedPlanDrawing(
  drawings: readonly PlanDrawing[],
  drawingId: string | null | undefined,
): PlanDrawing | null {
  if (!drawingId) return null;
  return drawings.find(drawing => drawing.id === drawingId) ?? null;
}

export function canUndoPlanDrawing(session: PlanAnnotationSession): boolean {
  return session.undoStack.length > 0;
}

export function canRedoPlanDrawing(session: PlanAnnotationSession): boolean {
  return session.redoStack.length > 0;
}

export function undoPlanDrawing(session: PlanAnnotationSession): PlanAnnotationSession {
  const previous = session.undoStack[session.undoStack.length - 1];
  if (!previous) return session;
  return {
    ...session,
    drawings: previous.drawings,
    draft: null,
    selectedId: selectedIdFor(previous.drawings, previous.selectedId),
    undoStack: session.undoStack.slice(0, -1),
    redoStack: boundedPush(session.redoStack, snapshot(session), session.historyLimit),
  };
}

export function redoPlanDrawing(session: PlanAnnotationSession): PlanAnnotationSession {
  const next = session.redoStack[session.redoStack.length - 1];
  if (!next) return session;
  return {
    ...session,
    drawings: next.drawings,
    draft: null,
    selectedId: selectedIdFor(next.drawings, next.selectedId),
    undoStack: boundedPush(session.undoStack, snapshot(session), session.historyLimit),
    redoStack: session.redoStack.slice(0, -1),
  };
}

export function deletePlanDrawing(
  session: PlanAnnotationSession,
  drawingId: string,
): PlanAnnotationSession {
  const drawings = session.drawings.filter(drawing => drawing.id !== drawingId);
  const draft = session.draft?.id === drawingId ? null : session.draft;
  if (drawings.length === session.drawings.length) {
    return draft === session.draft ? session : { ...session, draft };
  }
  return commitDocumentMutation(
    { ...session, draft },
    drawings,
    session.selectedId === drawingId ? null : session.selectedId,
  );
}

export function deletePlanDrawingsForPage(
  session: PlanAnnotationSession,
  page: number,
): PlanAnnotationSession {
  const targetPage = resolvePlanDrawingPage(page);
  const deletedIds = new Set(
    session.drawings
      .filter(drawing => resolvePlanDrawingPage(drawing.page) === targetPage)
      .map(drawing => drawing.id),
  );
  const draft = session.draft && resolvePlanDrawingPage(session.draft.page) === targetPage
    ? null
    : session.draft;
  if (deletedIds.size === 0) {
    return draft === session.draft ? session : { ...session, draft };
  }
  const drawings = session.drawings.filter(drawing => !deletedIds.has(drawing.id));
  return commitDocumentMutation(
    { ...session, draft },
    drawings,
    session.selectedId && deletedIds.has(session.selectedId) ? null : session.selectedId,
  );
}

export function clearPlanDrawings(session: PlanAnnotationSession): PlanAnnotationSession {
  if (session.drawings.length === 0) return cancelPlanDrawing(selectPlanDrawing(session, null));
  return commitDocumentMutation({ ...session, draft: null }, [], null);
}
