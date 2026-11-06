import type { NotificationPreferences } from '../constants/types';
import { parseDeadline } from './reserveUtils';

type AlertReserve = { id: string; title: string; priority: string; status: string; deadline: string; createdAt: string };
type AlertTask = { id: string; title: string; status: string; deadline: string; createdAt?: string };

export type WorkspaceAlert = {
  id: string;
  target: { kind: 'reserve' | 'task'; id: string };
  title: string;
  createdAt: string;
} & (
  | { type: 'critical_reserve'; overdue: boolean }
  | { type: 'overdue_reserve' | 'late_task' }
  | { type: 'due_soon_reserve'; daysLeft: number }
);

export function buildWorkspaceAlerts(
  reserves: readonly AlertReserve[],
  tasks: readonly AlertTask[],
  preferences: NotificationPreferences,
  now = new Date(),
): WorkspaceAlert[] {
  if (!preferences.inAppEnabled) return [];
  const alerts: WorkspaceAlert[] = [];
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  for (const reserve of reserves) {
    if (reserve.status === 'closed') continue;
    const deadline = parseDeadline(reserve.deadline);
    const overdue = deadline !== null && deadline.getTime() < today && reserve.status !== 'verification';
    const daysLeft = deadline === null ? -1 : Math.floor((deadline.getTime() - today) / 86_400_000);
    const common = { target: { kind: 'reserve' as const, id: reserve.id }, title: reserve.title, createdAt: reserve.createdAt };
    if (reserve.priority === 'critical' && preferences.reserveCriticalInApp) {
      alerts.push({ ...common, id: `crit_${reserve.id}`, type: 'critical_reserve', overdue });
    } else if (overdue && preferences.reserveOverdueInApp) {
      alerts.push({ ...common, id: `late_${reserve.id}`, type: 'overdue_reserve', createdAt: reserve.deadline });
    }
    if (preferences.dueSoonInApp && daysLeft >= 0 && daysLeft <= 3) {
      alerts.push({ ...common, id: `soon_${reserve.id}`, type: 'due_soon_reserve', daysLeft });
    }
  }
  if (preferences.taskLateInApp) {
    for (const task of tasks) {
      const deadline = parseDeadline(task.deadline);
      if (task.status === 'done' || (task.status !== 'delayed' && !(deadline && deadline.getTime() < today))) continue;
      alerts.push({ id: `task_${task.id}`, target: { kind: 'task', id: task.id }, type: 'late_task',
        title: task.title, createdAt: task.deadline || task.createdAt || now.toISOString() });
    }
  }
  const sortableDate = (value: string) => parseDeadline(value.split(' ')[0])?.getTime() ?? 0;
  return alerts.sort((a, b) => sortableDate(b.createdAt) - sortableDate(a.createdAt));
}
