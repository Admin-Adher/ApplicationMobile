type Entry = {
  rpc?: { fn?: string; args?: Record<string, unknown> } | null;
  kind?: string;
  payload?: Record<string, unknown>;
};
function scope(entry: Entry) {
  const data = entry.rpc?.fn === 'apply_plan_progress' ? entry.rpc.args : entry.kind === 'plan_progress' ? entry.payload : null;
  if (!data) return null;
  const plan = data.p_plan_id ?? data.planId, source = data.p_source_ref ?? data.sourceRef;
  return typeof plan === 'string' && typeof source === 'string' ? JSON.stringify([plan,source]) : null;
}
/** A later edit must wait for the earlier edit on the same PDF to succeed.
 * Otherwise a transient create failure could turn valid following edits into
 * permanent "missing work" refusals. Other plans/domains continue normally.
 */
export function progressReplayBarrier(nowMs: number, unresolved: readonly Entry[] = []) {
  const blocked = new Map<string,string>();
  const fallback = new Date(nowMs + 30_000).toISOString();
  for (const entry of unresolved) { const key = scope(entry); if (key) blocked.set(key,fallback); }
  return {
    deadline(entry: Entry) { const key = scope(entry); return key ? blocked.get(key) : undefined; },
    block(entry: Entry, deadline?: string | null) { const key = scope(entry); if (key) blocked.set(key,deadline ?? fallback); },
  };
}
