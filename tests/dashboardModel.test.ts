import { describe, expect, it } from 'vitest';
import { buildDashboardModel, type DashboardSource } from '../vercel-app/app/web/dashboard/dashboard-model';

const now = new Date(2026, 7, 12, 12, 0, 0);

function source(currentReserves: DashboardSource['current']['reserves']): DashboardSource {
  return {
    projects: [
      { id: 'p1', name: 'Tropicalia', buildings: [{ id: 'b1', name: 'Service Building' }] },
      { id: 'p2', name: 'Horizon' },
    ],
    plans: [{ id: 'plan-1', building_id: 'b1' }],
    companies: [
      { id: 'c1', name: 'INICA', short_name: 'INI', actual_workers: 8, planned_workers: 10 },
      { id: 'c2', name: 'SYMAN', actual_workers: 2, planned_workers: 2 },
    ],
    messageCount: 7,
    current: {
      reserves: currentReserves,
      tasks: [
        { id: 't1', title: 'Finish riser', status: 'delayed', deadline: '2026-08-08', company: 'INICA' },
        { id: 't2', title: 'Done task', status: 'done', deadline: '2026-08-01' },
      ],
      incidents: [
        { id: 'i1', status: 'open' },
        { id: 'i2', status: 'resolved' },
      ],
      plansCount: 4,
      visitsCount: 2,
      documentsCount: 3,
    },
  };
}

const p1Reserves: DashboardSource['current']['reserves'] = [
  {
    id: 'r1',
    chantier_id: 'p1',
    title: 'Missing valve',
    status: 'open',
    priority: 'high',
    deadline: '2026-08-01',
    plan_id: 'plan-1',
    plan_x: 21,
    plan_y: 34,
    companies: ['INICA'],
    created_at: '2026-08-04',
  },
  {
    id: 'r2',
    chantier_id: 'p1',
    title: 'Critical leak',
    status: 'open',
    priority: 'critical',
    deadline: '2026-08-03',
    building: 'SPA',
    company: 'SYMAN',
    created_at: '2026-08-05',
  },
  {
    id: 'r3',
    chantier_id: 'p1',
    title: 'Closed item',
    status: 'closed',
    priority: 'low',
    created_at: '2026-07-30',
    closed_at: '2026-08-10',
    company_name: 'INICA',
  },
  {
    id: 'r4',
    chantier_id: 'p1',
    title: 'Archived item',
    status: 'open',
    archived_at: '2026-08-11',
  },
];

describe('BuildTrack web Dashboard model', () => {
  it('derives operational metrics from the already-authorized project scope', () => {
    const model = buildDashboardModel(source(p1Reserves), { selectedProjectId: 'p1', now });

    expect(model.projectName).toBe('Tropicalia');
    expect(model.totalCount).toBe(3);
    expect(model.closedCount).toBe(1);
    expect(model.remainingCount).toBe(2);
    expect(model.progress).toBe(33);
    expect(model.overdueCount).toBe(2);
    expect(model.criticalCount).toBe(1);
    expect(model.lateTaskCount).toBe(1);
    expect(model.openIncidentCount).toBe(1);
    expect(model.pinnedCount).toBe(1);
    expect(model.priorities.map(item => item.kind)).toEqual([
      'critical-reserve',
      'overdue-reserve',
      'late-task',
    ]);
    expect(model.buildings.find(building => building.name === 'SPA')).toMatchObject({ overdue: 1, total: 1 });
    expect(model.companies.find(company => company.name === 'INICA')).toMatchObject({
      total: 2,
      closed: 1,
      overdue: 1,
      rate: 50,
    });
    expect(model.workforce).toEqual({ actual: 10, planned: 12 });
    expect(model.quick).toEqual({ plans: 4, visits: 2, messages: 7, documents: 3 });
    expect(model.weeks.reduce((total, week) => total + week.closed, 0)).toBe(1);
  });

  it('builds the portfolio only from rows supplied through the authorized source seam', () => {
    const model = buildDashboardModel(source([
      ...p1Reserves,
      { id: 'r5', chantier_id: 'p2', title: 'Horizon item', status: 'unexpected_status' },
    ]), { selectedProjectId: 'all', now });

    expect(model.totalCount).toBe(4);
    expect(model.statuses.open).toBe(3);
    expect(model.portfolio).toHaveLength(2);
    expect(model.portfolio.find(project => project.id === 'p1')).toMatchObject({ total: 3, closed: 1 });
    expect(model.portfolio.find(project => project.id === 'p2')).toMatchObject({ total: 1, closed: 0 });
  });
});
