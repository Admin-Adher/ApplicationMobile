export type DebugLogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface DebugLogEntry {
  ts: string;
  level: DebugLogLevel;
  msg: string;
}

const MAX_ENTRIES = 120;

let entries: DebugLogEntry[] = [];
let listeners: Array<(entries: DebugLogEntry[]) => void> = [];

function now(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
}

export function debugLog(msg: string, level: DebugLogLevel = 'info') {
  const entry: DebugLogEntry = { ts: now(), level, msg };
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
  listeners.forEach(fn => fn(entries));
}

export function debugLogOk(msg: string) { debugLog(msg, 'ok'); }
export function debugLogWarn(msg: string) { debugLog(msg, 'warn'); }
export function debugLogError(msg: string) { debugLog(msg, 'error'); }

export function getDebugLogs(): DebugLogEntry[] { return entries; }

export function clearDebugLogs() {
  entries = [];
  listeners.forEach(fn => fn(entries));
}

export function subscribeDebugLogs(fn: (entries: DebugLogEntry[]) => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}
