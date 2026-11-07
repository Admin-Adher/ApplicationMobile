import { describe, expect, it } from 'vitest';
import {
  PLANNING_SCHEDULE_BATCH_SIZE,
  buildPlanningSchedule,
  buildPlanningGantt,
  groupPlanningGantt,
  filterPlanningCompany,
  filterPlanningSchedule,
  filterPlanningTasks,
  formatPlanningDayLabel,
  groupPlanningSchedule,
  groupPlanningTasks,
  isPlanningTaskLate,
} from '../vercel-app/app/web/planning-workspace/planning-model';

const now = new Date('2026-08-29T10:00:00');

describe('BuildTrack planning workspace model', () => {
  it('groups priorities in urgency order and preserves tasks with no known priority', () => {
    const tasks = [{ id: 'low', priority: 'low' }, { id: 'critical', priority: 'critical' }, { id: 'high', priority: 'high' }, { id: 'unknown' }];
    const groups = groupPlanningTasks(filterPlanningTasks(tasks, 'priority', now), [], 'priority');
    expect(groups.map(([label, rows]) => [label, rows.map(row => row.id)])).toEqual([
      ['Critique', ['critical']], ['Haute', ['high']], ['Basse', ['low']], ['Sans priorité', ['unknown']],
    ]);
  });

  it('extends the Gantt period and groups company IDs and names together without losing unassigned tasks', () => {
    const tasks = [{ id: 'a', title: 'A', company: 'c1', deadline: '2026-09-01' }, { id: 'b', title: 'B', company: 'Alpha', deadline: '22/09/2026' }, { id: 'c', title: 'C', deadline: '2026-09-03' }];
    const month = buildPlanningGantt(tasks, new Date(2026, 8, 1), 42);
    const groups = groupPlanningGantt(month.rows, [{ id: 'c1', name: 'Alpha' }]);
    expect(month.days).toHaveLength(42);
    expect(groups.map(group => [group.name, group.rows.map(row => row.task.id)])).toEqual([['Alpha', ['a', 'b']], ['Sans entreprise', ['c']]]);
    expect(buildPlanningGantt(tasks, new Date(2026, 8, 1)).rows.map(row => row.task.id)).toEqual(['a', 'c']);
  });
  it('builds a chronological agenda and excludes closed or obsolete entries', () => {
    const schedule = buildPlanningSchedule(
      [
        { id: 'visit-next', title: 'Inspection façade', date: '2026-09-01', status: 'planned', building: 'A' },
        { id: 'visit-past', title: 'Ancienne visite', date: '2026-08-28', status: 'planned' },
        { id: 'visit-undated', title: 'À programmer', date: null, status: 'draft' },
      ],
      [
        { id: 'RSV-1', title: 'Électricité balcon', deadline: '2026-08-20', status: 'open', company: 'Volt' },
        { id: 'RSV-2', title: 'Joint façade', deadline: '2026-08-29', status: 'open' },
        { id: 'RSV-3', title: 'Réserve clôturée', deadline: '2026-08-30', status: 'closed' },
      ],
      now,
    );

    expect(schedule.map(entry => entry.id)).toEqual([
      'reserve-RSV-1',
      'reserve-RSV-2',
      'visit-visit-next',
      'visit-visit-undated',
    ]);
    expect(schedule[0]).toMatchObject({ kind: 'reserve', isLate: true, isToday: false });
    expect(schedule[1]).toMatchObject({ kind: 'reserve', isLate: false, isToday: true });
    expect(schedule.some(entry => entry.id === 'visit-visit-past')).toBe(false);
    expect(schedule.some(entry => entry.id === 'reserve-RSV-3')).toBe(false);
  });

  it('supports source filters and accent-insensitive search', () => {
    const schedule = buildPlanningSchedule(
      [{ id: 'visit-1', title: 'Contrôle toiture', date: '2026-09-02', status: 'planned' }],
      [
        { id: 'RSV-1', title: 'Électricité balcon', deadline: '2026-08-20', status: 'open' },
        { id: 'RSV-2', title: 'Menuiserie', deadline: '2026-09-03', status: 'open' },
      ],
      now,
    );

    expect(filterPlanningSchedule(schedule, 'all', 'electricite').map(entry => entry.id)).toEqual(['reserve-RSV-1']);
    expect(filterPlanningSchedule(schedule, 'late', '')).toHaveLength(1);
    expect(filterPlanningSchedule(schedule, 'reserve', '')).toHaveLength(2);
    expect(filterPlanningSchedule(schedule, 'visit', '')).toHaveLength(1);
  });

  it('includes dated tasks in the agenda and keeps completed tasks out of overdue results', () => {
    const tasks = [
      { id: 'active', title: 'Préparer le balisage', company: 'electric', deadline: '29/08/2026', status: 'todo' },
      { id: 'finished', title: 'Contrôle terminé', company: 'Électricité', deadline: '2026-08-20', status: 'done' },
      { id: 'other', title: 'Autre entreprise', company: 'plumbing', deadline: '2026-08-28', status: 'todo' },
    ];
    const selected = filterPlanningCompany(tasks, { id: 'electric', name: 'Électricité' });
    const schedule = buildPlanningSchedule([], [], now, selected);
    expect(filterPlanningSchedule(schedule, 'task', 'balisage')).toMatchObject([{ id: 'task-active', isToday: true }]);
    expect(filterPlanningSchedule(schedule, 'task', '').map(entry => entry.id)).toEqual(['task-finished', 'task-active']);
    expect(filterPlanningSchedule(schedule, 'late', '')).toEqual([]);
    expect(groupPlanningSchedule(schedule, 'fr-FR', now)[0]?.relativeLabel).toBe('Passé');
  });

  it('groups dates with clear relative labels and keeps rendering bounded', () => {
    const schedule = buildPlanningSchedule(
      [{ id: 'visit-1', title: 'Visite du lendemain', date: '2026-08-30', status: 'planned' }],
      [
        { id: 'RSV-1', title: 'En retard', deadline: '2026-08-20', status: 'open' },
        { id: 'RSV-2', title: 'Aujourd’hui', deadline: '2026-08-29', status: 'open' },
      ],
      now,
    );
    const groups = groupPlanningSchedule(schedule, 'fr-FR', now);

    expect(groups.map(group => group.relativeLabel)).toEqual(['En retard', 'Aujourd’hui', 'Demain']);
    expect(formatPlanningDayLabel(null, 'fr-FR', now)).toEqual({ label: 'Sans date', relativeLabel: 'À planifier' });
    expect(PLANNING_SCHEDULE_BATCH_SIZE).toBe(18);
  });

  it('filters task lanes without treating completed tasks as late', () => {
    const tasks = [
      { id: 'late', company: 'c1', deadline: '2026-08-25', status: 'in_progress' },
      { id: 'week', company: 'c2', deadline: '2026-08-30', status: 'todo' },
      { id: 'undated', company: 'c1', deadline: null, status: 'todo' },
      { id: 'done', company: 'c2', deadline: '2026-08-20', status: 'done' },
      { id: 'delayed', company: null, deadline: null, status: 'delayed' },
    ];

    expect(isPlanningTaskLate(tasks[0], now)).toBe(true);
    expect(isPlanningTaskLate(tasks[3], now)).toBe(false);
    expect(filterPlanningTasks(tasks, 'late', now).map(task => task.id)).toEqual(['delayed', 'late']);
    expect(filterPlanningTasks(tasks, 'week', now).map(task => task.id)).toEqual(['undated', 'delayed', 'late', 'week']);
    expect(groupPlanningTasks(tasks, [{ id: 'c1', name: 'Alpha' }, { id: 'c2', name: 'Beta' }], 'company').map(([name]) => name))
      .toEqual(['Alpha', 'Beta', 'Sans entreprise']);
  });
});
