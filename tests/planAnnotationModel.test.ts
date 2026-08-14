import { describe, expect, it } from 'vitest';
import type { PlanDrawing, PlanDrawingTool } from '../constants/types';
import {
  PLAN_DRAWING_TOOLS,
  appendPlanDrawingPoint,
  beginPlanDrawing,
  canRedoPlanDrawing,
  canUndoPlanDrawing,
  cancelPlanDrawing,
  clearPlanDrawings,
  commitPlanDrawing,
  createPlanAnnotationSession,
  deletePlanDrawing,
  deletePlanDrawingsForPage,
  filterPlanDrawingsByPage,
  getSelectedPlanDrawing,
  redoPlanDrawing,
  resolvePlanDrawingPage,
  sanitizePlanDrawing,
  sanitizePlanDrawings,
  selectPlanDrawing,
  simplifyPlanDrawingPoints,
  undoPlanDrawing,
} from '../lib/plan-annotations/model';

function drawing(
  id: string,
  tool: PlanDrawingTool = 'line',
  page?: number,
): PlanDrawing {
  return {
    id,
    tool,
    points: tool === 'text' ? [{ x: 10, y: 10 }] : [{ x: 10, y: 10 }, { x: 20, y: 20 }],
    color: '#EF4444',
    strokeWidth: 3,
    text: tool === 'text' ? `Text ${id}` : undefined,
    fontSize: tool === 'text' ? 14 : undefined,
    page,
  };
}

function commitLine(session: ReturnType<typeof createPlanAnnotationSession>, id: string, page = 1) {
  return commitPlanDrawing(appendPlanDrawingPoint(beginPlanDrawing(session, {
    id,
    tool: 'line',
    point: { x: 10, y: 10 },
    page,
  }), { x: 20, y: 20 }));
}

describe('plan annotation domain model', () => {
  it('keeps the canonical eight-tool contract', () => {
    expect(PLAN_DRAWING_TOOLS).toEqual([
      'pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'cloud', 'highlight',
    ]);
    for (const tool of PLAN_DRAWING_TOOLS) {
      const result = sanitizePlanDrawing(drawing(`tool-${tool}`, tool, 2));
      expect(result.drawing?.tool).toBe(tool);
      expect(result.drawing?.page).toBe(2);
    }
  });

  it('normalizes legacy page-less drawings to page one and filters strictly by page', () => {
    const legacy = drawing('legacy');
    const pageTwo = drawing('page-two', 'rect', 2);
    const canonical = sanitizePlanDrawings([legacy, pageTwo]);

    expect(resolvePlanDrawingPage(undefined)).toBe(1);
    expect(canonical[0].page).toBe(1);
    expect(filterPlanDrawingsByPage(canonical, 1).map(item => item.id)).toEqual(['legacy']);
    expect(filterPlanDrawingsByPage(canonical, 2).map(item => item.id)).toEqual(['page-two']);
  });

  it('sanitizes unsafe or excessive fields and rejects invalid objects', () => {
    const result = sanitizePlanDrawing({
      id: '  abc\u0000  ',
      tool: 'pen',
      points: [{ x: -20, y: 130 }, { x: 25, y: 30 }],
      color: 'url(javascript:alert(1))',
      strokeWidth: 999,
      opacity: -4,
      page: -9,
    });

    expect(result.drawing).toMatchObject({
      id: 'abc',
      color: '#EF4444',
      strokeWidth: 64,
      opacity: 0,
      page: 1,
      points: [{ x: 0, y: 100 }, { x: 25, y: 30 }],
    });
    expect(result.issues.some(issue => issue.code === 'sanitized_field')).toBe(true);
    expect(sanitizePlanDrawing({
      ...drawing('clamped-point'),
      points: [{ x: -1, y: 20 }, { x: 30, y: 101 }],
    }).issues).toContainEqual({ code: 'sanitized_field', path: '*' });
    expect(sanitizePlanDrawing({ id: '', tool: 'pen', points: [] }).drawing).toBeNull();
    expect(sanitizePlanDrawing({ id: 'x', tool: 'eraser', points: [] }).drawing).toBeNull();
    expect(sanitizePlanDrawing(drawing('bad', 'line', 1)).drawing).not.toBeNull();
  });

  it('begins, appends, commits and cancels immutable drafts', () => {
    const initial = createPlanAnnotationSession();
    const begun = beginPlanDrawing(initial, {
      id: 'pen-1', tool: 'pen', point: { x: 0, y: 0 }, page: 3,
    });
    const appended = appendPlanDrawingPoint(begun, { x: 25, y: 25 });
    const committed = commitPlanDrawing(appended, { simplifyTolerance: 0 });

    expect(initial.draft).toBeNull();
    expect(begun.draft?.points).toEqual([{ x: 0, y: 0 }]);
    expect(committed.drawings).toHaveLength(1);
    expect(committed.drawings[0]).toMatchObject({ id: 'pen-1', page: 3 });
    expect(committed.selectedId).toBe('pen-1');
    expect(canUndoPlanDrawing(committed)).toBe(true);

    const cancelled = cancelPlanDrawing(beginPlanDrawing(committed, {
      id: 'line-cancel', tool: 'line', point: { x: 5, y: 5 },
    }));
    expect(cancelled.draft).toBeNull();
    expect(cancelled.drawings.map(item => item.id)).toEqual(['pen-1']);
  });

  it('keeps shape drafts at two points and commits text with the active page', () => {
    let shape = beginPlanDrawing(createPlanAnnotationSession(), {
      id: 'rect-1', tool: 'rect', point: { x: 1, y: 1 }, page: 4,
    });
    shape = appendPlanDrawingPoint(shape, { x: 2, y: 2 });
    shape = appendPlanDrawingPoint(shape, { x: 9, y: 8 });
    expect(shape.draft?.points).toEqual([{ x: 1, y: 1 }, { x: 9, y: 8 }]);

    const text = commitPlanDrawing(beginPlanDrawing(createPlanAnnotationSession(), {
      id: 'text-1', tool: 'text', point: { x: 40, y: 50 }, page: 5,
    }), { text: '  Mur porteur  ', fontSize: 18 });
    expect(text.drawings[0]).toMatchObject({
      id: 'text-1', tool: 'text', text: 'Mur porteur', fontSize: 18, page: 5,
    });
  });

  it('provides bounded undo and redo and clears redo after a new command', () => {
    let session = createPlanAnnotationSession([], { historyLimit: 2 });
    session = commitLine(session, 'one');
    session = commitLine(session, 'two');
    session = commitLine(session, 'three');
    expect(session.undoStack).toHaveLength(2);

    session = undoPlanDrawing(session);
    expect(session.drawings.map(item => item.id)).toEqual(['one', 'two']);
    session = undoPlanDrawing(session);
    expect(session.drawings.map(item => item.id)).toEqual(['one']);
    expect(undoPlanDrawing(session)).toBe(session);
    expect(canRedoPlanDrawing(session)).toBe(true);

    session = redoPlanDrawing(session);
    expect(session.drawings.map(item => item.id)).toEqual(['one', 'two']);
    session = commitLine(session, 'replacement');
    expect(canRedoPlanDrawing(session)).toBe(false);
  });

  it('deletes one object, one page, or the whole document and keeps selection valid', () => {
    let session = createPlanAnnotationSession([
      drawing('legacy'), drawing('page-one', 'line', 1), drawing('page-two', 'ellipse', 2),
    ], { selectedId: 'page-two' });
    expect(getSelectedPlanDrawing(session.drawings, session.selectedId)?.id).toBe('page-two');

    session = deletePlanDrawing(session, 'page-one');
    expect(session.drawings.map(item => item.id)).toEqual(['legacy', 'page-two']);
    session = deletePlanDrawingsForPage(session, 1);
    expect(session.drawings.map(item => item.id)).toEqual(['page-two']);
    session = deletePlanDrawingsForPage(session, 2);
    expect(session.drawings).toEqual([]);
    expect(session.selectedId).toBeNull();

    session = undoPlanDrawing(session);
    expect(session.drawings.map(item => item.id)).toEqual(['page-two']);
    session = clearPlanDrawings(session);
    expect(session.drawings).toEqual([]);
  });

  it('selects only existing objects without mutating the document', () => {
    const initial = createPlanAnnotationSession([drawing('one')]);
    const selected = selectPlanDrawing(initial, 'one');
    expect(selected.drawings).toBe(initial.drawings);
    expect(selected.selectedId).toBe('one');
    expect(selectPlanDrawing(selected, 'missing').selectedId).toBeNull();
    expect(getSelectedPlanDrawing(initial.drawings, 'missing')).toBeNull();
  });

  it('simplifies collinear pen points while preserving endpoints and corners', () => {
    const straight = simplifyPlanDrawingPoints([
      { x: 0, y: 0 }, { x: 10, y: 0.01 }, { x: 20, y: -0.01 }, { x: 30, y: 0 },
    ], 0.1);
    expect(straight).toEqual([{ x: 0, y: 0 }, { x: 30, y: 0 }]);

    const corner = simplifyPlanDrawingPoints([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 },
    ], 0.5);
    expect(corner[0]).toEqual({ x: 0, y: 0 });
    expect(corner.at(-1)).toEqual({ x: 20, y: 10 });
    expect(corner.length).toBeGreaterThan(2);
  });

  it('drops invalid commits without polluting history', () => {
    const session = beginPlanDrawing(createPlanAnnotationSession(), {
      id: 'tap-only', tool: 'pen', point: { x: 10, y: 10 },
    });
    const committed = commitPlanDrawing(session);
    expect(committed.draft).toBeNull();
    expect(committed.drawings).toEqual([]);
    expect(committed.undoStack).toEqual([]);
  });
});
