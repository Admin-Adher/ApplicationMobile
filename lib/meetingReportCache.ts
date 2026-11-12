import type { MeetingReport } from '../constants/types';

export type MeetingRow = { report: MeetingReport; version: number };
export type MeetingStorage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown> };
export const meetingCacheKey = (scope: string) => `buildtrack_shared_meetings_v1:${scope}`;

export function readMeetingSnapshot(raw: string | null, scope: string): MeetingRow[] | null {
  try {
    const parsed = JSON.parse(raw ?? 'null');
    if (parsed?.scope !== scope || parsed?.version !== 1 || !Array.isArray(parsed.rows)) return null;
    const ids = new Set<string>();
    for (const row of parsed.rows) {
      const report = row?.report;
      if (!Number.isInteger(row?.version) || row.version < 1 || !report || typeof report.id !== 'string' || !report.id || ids.has(report.id) ||
        !Array.isArray(report.actions) || !Array.isArray(report.decisions) || typeof report.subject !== 'string') return null;
      ids.add(report.id);
    }
    return parsed.rows;
  } catch { return null; }
}

// Serialize writes across mounted editors, including a refresh followed by a
// deletion. An older asynchronous write must not resurrect a deleted report.
const pending = new Map<string, Promise<unknown>>();
export async function writeMeetingSnapshot(storage: MeetingStorage, scope: string, rows: MeetingRow[]) {
  const key = meetingCacheKey(scope);
  const raw = JSON.stringify({ version: 1, scope, rows });
  const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(() => storage.setItem(key, raw));
  pending.set(key, next);
  try { await next; }
  finally { if (pending.get(key) === next) pending.delete(key); }
}
