import type { MeetingReport } from '../constants/types';
import { meetingCacheKey, readMeetingSnapshot, writeMeetingSnapshot, type MeetingStorage } from '../lib/meetingReportCache';

type MeetingRow = { report: MeetingReport; version: number };
const TABLE = 'project_meeting_reports';

// The Android and web clients bundle separate copies of Supabase's SDK.
type MeetingResult = { data: unknown; error: unknown };
type MeetingQuery = PromiseLike<MeetingResult> & {
  eq: (column: string, value: string | number) => MeetingQuery;
  order: (column: string, options: { ascending: boolean }) => MeetingQuery;
  range: (from: number, to: number) => MeetingQuery;
  select: (columns: string) => MeetingQuery;
  single: () => PromiseLike<MeetingResult>;
};
type MeetingClient = { from: (table: typeof TABLE) => unknown };
type MeetingTable = {
  select: (columns: string) => MeetingQuery;
  insert: (row: { organization_id: string; chantier_id: string; id: string; report: MeetingReport }) => MeetingQuery;
  update: (row: MeetingRow) => MeetingQuery;
  delete: () => MeetingQuery;
};

function tableFor(client: MeetingClient) {
  return client.from(TABLE) as MeetingTable;
}

// Each app supplies hooks from its own React installation. Vercel installs
// dependencies under vercel-app, while Expo installs them at the repo root.
type MeetingReactHooks = {
  useState: <T>(initial: T) => [T, (next: T | ((previous: T) => T)) => void];
  useRef: <T>(initial: T) => { current: T };
  useEffect: (effect: () => void | (() => void), dependencies: readonly unknown[]) => void;
  useCallback: <T extends () => Promise<void>>(callback: T, dependencies: readonly unknown[]) => T;
};

export function useProjectMeetingReports(
  { useState, useRef, useEffect, useCallback }: MeetingReactHooks,
  client: MeetingClient | null,
  userId: string | undefined,
  organizationId: string | null | undefined,
  chantierId: string | null,
  storage?: MeetingStorage,
) {
  const scope = client && userId && organizationId && chantierId ? `${userId}:${organizationId}:${chantierId}` : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [state, setState] = useState<{ scope: string; rows: MeetingRow[]; ready: boolean; failed: boolean } | null>(null);
  const request = useRef(0);
  const current = state?.scope === scope ? state : null;
  const rows = current?.rows ?? [];
  const stateRef = useRef(state);
  stateRef.current = state;

  function commit(next: NonNullable<typeof state>) {
    stateRef.current = next;
    setState(next);
    if (storage) void writeMeetingSnapshot(storage, next.scope, next.rows).catch(() => {
      // The server remains authoritative. Do not turn a successful server write
      // into a second create merely because the device cache is unavailable.
      console.warn('[meetings] Offline copy could not be updated.');
    });
  }

  const refresh = useCallback(async () => {
    if (!client || !scope || scopeRef.current !== scope || !organizationId || !chantierId) return;
    const lease = ++request.current;
    try {
      const reports: MeetingRow[] = [];
      const pageSize = 250;
      for (let offset = 0; lease === request.current; offset += pageSize) {
        const { data, error } = await tableFor(client).select('report,version')
          .eq('organization_id', organizationId).eq('chantier_id', chantierId)
          .order('created_at', { ascending: false }).order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error || !Array.isArray(data)) throw error ?? new Error('Invalid meeting report response');
        reports.push(...data as MeetingRow[]);
        if (data.length < pageSize) break;
      }
      if (lease === request.current && scopeRef.current === scope) commit({ scope, rows: reports, ready: true, failed: false });
    } catch {
      if (lease === request.current && scopeRef.current === scope) {
        const previous = stateRef.current;
        const next = { scope, rows: previous?.scope === scope ? previous.rows : [], ready: false, failed: true };
        stateRef.current = next;
        setState(next);
      }
    }
  }, [client, scope, organizationId, chantierId, storage]);

  useEffect(() => {
    let cancelled = false;
    if (scope && storage) {
      void storage.getItem(meetingCacheKey(scope)).then(raw => {
        if (cancelled || scopeRef.current !== scope || stateRef.current?.scope === scope && stateRef.current.ready) return;
        const cached = readMeetingSnapshot(raw, scope);
        if (!cached) return;
        const next = { scope, rows: cached, ready: false, failed: stateRef.current?.scope === scope && stateRef.current.failed || false };
        stateRef.current = next;
        setState(next);
      }).catch(() => {});
    }
    void refresh();
    return () => { cancelled = true; request.current += 1; };
  }, [refresh, scope, storage]);

  async function save(report: MeetingReport, mode: 'create' | 'update', expectedVersion?: number) {
    if (!client || !scope || scopeRef.current !== scope || !organizationId || !chantierId || !current?.ready) return false;
    const previous = rows.find(row => row.report.id === report.id);
    if (mode === 'update' && (!previous || (expectedVersion !== undefined && previous.version !== expectedVersion))) {
      throw new Error('Ce compte rendu a changé. Rouvrez-le avant de modifier son contenu.');
    }
    const table = tableFor(client);
    const operation = previous
      ? table.update({ report, version: previous.version + 1 }).eq('organization_id', organizationId)
        .eq('chantier_id', chantierId).eq('id', report.id).eq('version', previous.version)
      : table.insert({ organization_id: organizationId, chantier_id: chantierId, id: report.id, report });
    if (mode === 'create' && previous) return false;
    const { data, error } = await operation.select('report,version').single();
    if (error || !data) {
      void refresh();
      throw new Error('Enregistrement impossible. Actualisez le compte rendu puis réessayez.');
    }
    if (scopeRef.current !== scope) return true;
    request.current += 1;
    {
      const value = stateRef.current;
      if (value?.scope !== scope) return true;
      const saved = data as MeetingRow;
      const existing = value.rows.find(row => row.report.id === report.id);
      if (existing && existing.version > saved.version) return true;
      commit({ ...value, rows: existing ? value.rows.map(row => row.report.id === report.id ? saved : row) : [saved, ...value.rows] });
    }
    return true;
  }

  async function remove(id: string) {
    const previous = rows.find(row => row.report.id === id);
    if (!client || !scope || scopeRef.current !== scope || !organizationId || !chantierId || !current?.ready || !previous) return false;
    const { error } = await tableFor(client).delete().eq('organization_id', organizationId)
      .eq('chantier_id', chantierId).eq('id', id).eq('version', previous.version).select('id').single();
    if (error) {
      void refresh();
      throw new Error('Suppression impossible. Actualisez le compte rendu puis réessayez.');
    }
    if (scopeRef.current !== scope) return true;
    request.current += 1;
    const value = stateRef.current;
    if (value?.scope === scope) commit({ ...value, rows: value.rows.filter(row => row.report.id !== id) });
    return true;
  }

  return { rows, ready: Boolean(current?.ready), failed: Boolean(current?.failed), refresh, save, remove };
}
