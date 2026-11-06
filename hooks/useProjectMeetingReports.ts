import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeetingReport } from '../constants/types';

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

export function useProjectMeetingReports(
  client: MeetingClient | null,
  userId: string | undefined,
  organizationId: string | null | undefined,
  chantierId: string | null,
) {
  const scope = client && userId && organizationId && chantierId ? `${userId}:${organizationId}:${chantierId}` : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [state, setState] = useState<{ scope: string; rows: MeetingRow[]; ready: boolean; failed: boolean } | null>(null);
  const request = useRef(0);
  const current = state?.scope === scope ? state : null;
  const rows = current?.rows ?? [];

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
      if (lease === request.current) setState({ scope, rows: reports, ready: true, failed: false });
    } catch {
      if (lease === request.current) setState({ scope, rows: [], ready: false, failed: true });
    }
  }, [client, scope, organizationId, chantierId]);

  useEffect(() => {
    void refresh();
    return () => { request.current += 1; };
  }, [refresh]);

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
    setState(value => {
      if (value?.scope !== scope) return value;
      const saved = data as MeetingRow;
      const existing = value.rows.find(row => row.report.id === report.id);
      if (existing && existing.version > saved.version) return value;
      return { ...value, rows: existing ? value.rows.map(row => row.report.id === report.id ? saved : row) : [saved, ...value.rows] };
    });
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
    setState(value => value?.scope === scope ? { ...value, rows: value.rows.filter(row => row.report.id !== id) } : value);
    return true;
  }

  return { rows, ready: Boolean(current?.ready), failed: Boolean(current?.failed), refresh, save, remove };
}
