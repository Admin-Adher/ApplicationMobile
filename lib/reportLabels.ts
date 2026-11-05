export type TFunc = (key: string, options?: Record<string, any>) => string;

export function reserveStatusLabel(t: TFunc, status: string): string {
  const keyMap: Record<string, string> = {
    open: 'reserveLabels.status.open',
    in_progress: 'reserveLabels.status.in_progress',
    waiting: 'reserveLabels.status.waiting',
    verification: 'reserveLabels.status.verification',
    closed: 'reserveLabels.status.closed',
  };
  return keyMap[status] ? t(keyMap[status]) : status;
}

export function reservePriorityLabel(t: TFunc, priority: string): string {
  const keyMap: Record<string, string> = {
    low: 'reserveLabels.priority.low',
    medium: 'reserveLabels.priority.medium',
    high: 'reserveLabels.priority.high',
    critical: 'reserveLabels.priority.critical',
  };
  return keyMap[priority] ? t(keyMap[priority]) : priority;
}
