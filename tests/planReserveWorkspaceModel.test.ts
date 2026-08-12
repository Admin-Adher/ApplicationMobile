import { describe, expect, it } from 'vitest';
import {
  buildPlanLibraryModel,
  buildReserveWorkspaceSummary,
  filterPlanLibraryGroups,
} from '../vercel-app/app/web/plan-reserve-workspace/workspace-model';

const now = new Date(2026, 7, 12, 12, 0, 0);

describe('BuildTrack plan and reserve workspace model', () => {
  it('derives reserve priorities from the authorized records without mutating them', () => {
    const reserves = [
      { id: 'r1', status: 'open', deadline: '2026-08-10', plan_id: 'p1', plan_x: 15, plan_y: 30 },
      { id: 'r2', status: 'verification', deadline: '2026-08-01' },
      { id: 'r3', status: 'closed', deadline: '2026-08-01' },
      { id: 'r4', status: 'open', archived_at: '2026-08-11' },
      { id: 'r5', status: 'open', deleted_at: '2026-08-11' },
    ];

    expect(buildReserveWorkspaceSummary(reserves, reserves.slice(0, 2), now)).toEqual({
      visible: 2,
      active: 2,
      overdue: 1,
      verification: 1,
      pinned: 1,
    });
    expect(reserves[0]).not.toHaveProperty('workspaceState');
  });

  it('builds a deterministic plan library with building, family and pin counts', () => {
    const plans = [
      { id: 'p1', name: 'Ground floor', building: 'Tower 1', level: 'RDC' },
      { id: 'p2', name: 'Level one', building: 'Tower 2', level: 'R+1' },
      { id: 'p3', name: 'Villa architecture', building: 'Villa 1' },
      { id: 'p4', name: 'Villa electricity', building: 'Villa 2' },
      { id: 'p5', name: 'Spa', building: 'SPA' },
      { id: 'p6', name: 'Arrival', building: 'Arrival' },
      { id: 'p7', name: 'Residence', building: 'Residence' },
      { id: 'p8', name: 'Service', building: 'Service Building' },
    ];
    const reserves = [
      { id: 'r1', plan_id: 'p1', building: 'Tower 1', plan_x: 20, plan_y: 40 },
      { id: 'r2', plan_id: 'p1', building: 'Tower 1' },
      { id: 'r3', plan_id: 'p3', building: 'Villa 1', archived_at: '2026-08-01', plan_x: 1, plan_y: 2 },
    ];

    const model = buildPlanLibraryModel(plans, reserves, 'en');

    expect(model.planCount).toBe(8);
    expect(model.buildingCount).toBe(8);
    expect(model.reserveCount).toBe(2);
    expect(model.pinnedCount).toBe(1);
    expect(model.useGrouping).toBe(true);
    expect(model.families.map(family => family.label)).toEqual(expect.arrayContaining(['Tower', 'Villa', 'Autres']));
    expect(model.groups.find(group => group.name === 'Tower 1')?.reserveCount).toBe(2);
  });

  it('filters by family and normalized plan metadata', () => {
    const model = buildPlanLibraryModel([
      { id: 'p1', name: 'Électricité générale', building: 'Tower 1', level: 'R+1', revision_code: 'B' },
      { id: 'p2', name: 'Architecture', building: 'Tower 2' },
      { id: 'p3', name: 'Plomberie', building: 'Villa 1' },
      { id: 'p4', name: 'CVC', building: 'Villa 2' },
      { id: 'p5', name: 'Spa', building: 'SPA' },
      { id: 'p6', name: 'Arrival', building: 'Arrival' },
      { id: 'p7', name: 'Residence', building: 'Residence' },
      { id: 'p8', name: 'Service', building: 'Service Building' },
    ], [], 'fr');

    expect(filterPlanLibraryGroups(model, 'electricite', 'all')).toHaveLength(1);
    expect(filterPlanLibraryGroups(model, 'electricite', 'all')[0].displayPlans).toHaveLength(1);
    expect(filterPlanLibraryGroups(model, '', 'tower').map(group => group.name)).toEqual(['Tower 1', 'Tower 2']);
  });
});
