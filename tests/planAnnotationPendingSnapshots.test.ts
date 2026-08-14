import { describe, expect, it } from 'vitest';
import type { PlanDrawing } from '../constants/types';
import {
  createPendingPlanAnnotationSnapshot,
  getCanonicalPlanAnnotationSignature,
  overlayPendingPlanAnnotationSnapshots,
  type PendingPlanAnnotationSnapshot,
} from '../lib/plan-annotations/pending-snapshots';

function drawing(id: string, color = '#ef4444'): PlanDrawing {
  return {
    id,
    tool: 'line',
    points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
    color,
    strokeWidth: 3,
    page: 1,
  };
}

describe('pending plan annotation snapshots', () => {
  it('keeps a local clear authoritative over a stale server drawing', () => {
    const serverDrawing = drawing('server-drawing');
    const plans = [{ id: 'plan-1', name: 'RDC', annotations: [serverDrawing] }];
    const snapshots = new Map([
      ['plan-1', createPendingPlanAnnotationSnapshot('user-1', [], true)],
    ]);

    const result = overlayPendingPlanAnnotationSnapshots(plans, snapshots, 'user-1');

    expect(result.plans[0].annotations).toEqual([]);
    expect(result.acknowledgedIds).toEqual([]);
  });

  it('keeps a committed local snapshot over a stale server response', () => {
    const localDrawing = drawing('local-drawing');
    const plans = [{ id: 'plan-1', annotations: [drawing('stale-drawing')] }];
    const snapshots = new Map([
      ['plan-1', createPendingPlanAnnotationSnapshot('user-1', [localDrawing], false)],
    ]);

    const result = overlayPendingPlanAnnotationSnapshots(plans, snapshots, 'user-1');

    expect(result.plans[0].annotations).toEqual([
      { ...localDrawing, color: '#EF4444' },
    ]);
    expect(result.acknowledgedIds).toEqual([]);
  });

  it('acknowledges a completed snapshot once the server returns the same canonical document', () => {
    const serverDrawing = drawing('drawing-1', '#EF4444');
    const plans = [{ id: 'plan-1', annotations: [serverDrawing] }];
    const snapshots = new Map([
      ['plan-1', createPendingPlanAnnotationSnapshot('user-1', [drawing('drawing-1')], false)],
    ]);

    const result = overlayPendingPlanAnnotationSnapshots(plans, snapshots, 'user-1');

    expect(result.plans[0]).toBe(plans[0]);
    expect(result.acknowledgedIds).toEqual(['plan-1']);
  });

  it('ignores snapshots owned by another user', () => {
    const plans = [{ id: 'plan-1', annotations: [drawing('server-drawing')] }];
    const snapshots = new Map([
      ['plan-1', createPendingPlanAnnotationSnapshot('user-2', [], true)],
    ]);

    const result = overlayPendingPlanAnnotationSnapshots(plans, snapshots, 'user-1');

    expect(result.plans[0]).toBe(plans[0]);
    expect(result.plans[0].annotations).toEqual(plans[0].annotations);
    expect(result.acknowledgedIds).toEqual([]);
  });

  it('does not mutate plans, drawings, or the snapshot map', () => {
    const serverDrawing = drawing('server-drawing');
    const localDrawing = drawing('local-drawing');
    const plan = Object.freeze({
      id: 'plan-1',
      annotations: Object.freeze([Object.freeze(serverDrawing)]),
    });
    const snapshot = createPendingPlanAnnotationSnapshot('user-1', [localDrawing], true);
    const snapshots = new Map<string, PendingPlanAnnotationSnapshot>([['plan-1', snapshot]]);
    const originalMapEntries = [...snapshots.entries()];

    const plans = Object.freeze([plan]);
    const result = overlayPendingPlanAnnotationSnapshots(plans, snapshots, 'user-1');

    expect(result.plans).not.toBe(plans);
    expect(result.plans[0]).not.toBe(plan);
    expect(plan.annotations).toEqual([serverDrawing]);
    expect(snapshots.size).toBe(1);
    expect([...snapshots.entries()]).toEqual(originalMapEntries);
    expect(snapshots.get('plan-1')).toBe(snapshot);
  });

  it('derives signatures from sanitized canonical drawings', () => {
    const first = drawing('drawing-1', '#ef4444');
    const equivalent = {
      strokeWidth: 3,
      points: [{ y: 20, x: 10 }, { y: 40, x: 30 }],
      color: '#EF4444',
      tool: 'line',
      id: 'drawing-1',
      page: 1,
      ignored: 'not persisted',
    };

    expect(getCanonicalPlanAnnotationSignature([first]))
      .toBe(getCanonicalPlanAnnotationSignature([equivalent]));
  });
});
