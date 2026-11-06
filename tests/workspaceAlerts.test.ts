import { describe, expect, it } from 'vitest';
import { toNotificationPreferences } from '../lib/notificationPreferences';
import { buildWorkspaceAlerts } from '../lib/workspaceAlerts';

describe('Shared workspace alerts', () => {
  const today = new Date(2026, 10, 6, 12);
  const reserve = { id: 'r1', title: 'Réserve', status: 'open', priority: 'critical', createdAt: '2026-11-02' };
  const task = { id: 't1', title: 'Tâche', status: 'delayed', deadline: '' };

  it('handles critical alerts, due dates and overdue tasks across date formats', () => {
    const alerts = buildWorkspaceAlerts([
      { ...reserve, deadline: '05/11/2026' },
      { ...reserve, id: 'r2', deadline: '2026-11-09', priority: 'high' },
      { ...reserve, id: 'r3', deadline: '2026-11-04', status: 'verification' },
      { ...reserve, id: 'r4', deadline: '2026-11-04', status: 'closed' },
    ], [task], toNotificationPreferences(null), today);
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'crit_r1', overdue: true }),
      expect.objectContaining({ id: 'soon_r2', daysLeft: 3 }),
      expect.objectContaining({ id: 'crit_r3', overdue: false }),
      expect.objectContaining({ id: 'task_t1', target: { kind: 'task', id: 't1' } }),
    ]));
    expect(alerts).toHaveLength(4);
  });

  it('honors the shared user preferences', () => {
    const items = [{ ...reserve, deadline: '2026-11-03' }];
    expect(buildWorkspaceAlerts(items, [task], toNotificationPreferences({ in_app_enabled: false }), today)).toEqual([]);
    const alerts = buildWorkspaceAlerts(items, [task], toNotificationPreferences({
      reserve_critical_in_app: false,
      task_late_in_app: false,
    }), today);
    expect(alerts.map(alert => alert.id)).toEqual(['late_r1']);
  });
});
