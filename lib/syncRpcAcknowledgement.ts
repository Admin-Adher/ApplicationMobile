/** The REST adapter normalizes a JSON RPC object into a one-row array. */
export function isAppliedRpcAcknowledgement(data: unknown): boolean {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  return !!row && typeof row === 'object' && (row as { applied?: unknown }).applied === true;
}
