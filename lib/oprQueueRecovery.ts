import { normalizeOprPayloadForSupabase } from './mappers';

type QueuedOprWrite = {
  table: string;
  op: string;
  data?: Record<string, unknown>;
  terminal?: boolean;
  terminalStatus?: string;
  lastError?: string;
  purgeState?: string;
  filter?: { column: string; value: unknown };
};

export function recoverRejectedOprWrite<T extends QueuedOprWrite>(operation: T): T {
  const { table, op, data, terminal, terminalStatus, lastError, purgeState } = operation;
  if (table !== 'oprs' || !data || !terminal || terminalStatus !== 'server_rejected' || purgeState) return operation;

  const id = op === 'insert' ? data.id : operation.filter?.column === 'id' ? operation.filter.value : null;
  if (typeof id !== 'string' || !id.trim()) return operation;
  const visitDate = data.visit_contradictoire;
  const rejectedVisitDate = (op === 'insert' || op === 'update') && typeof visitDate === 'string'
    && lastError?.startsWith('[22P02]')
    && lastError.includes(`invalid input syntax for type boolean: "${visitDate}"`);
  const rejectedTimestamp = op === 'insert' && typeof data.created_at === 'string'
    && lastError?.startsWith('[22008]')
    && lastError.includes(`date/time field value out of range: "${data.created_at}"`);
  if (!rejectedVisitDate && !rejectedTimestamp) return operation;

  const repaired = normalizeOprPayloadForSupabase(data);
  if (rejectedTimestamp && repaired === data) return operation;
  return {
    ...operation,
    data: repaired,
    terminal: false,
    terminalStatus: undefined,
    terminalOutcome: undefined,
    lastError: undefined,
    lastFailureFingerprint: undefined,
    sameFailureCount: undefined,
    attemptCount: undefined,
    lastFailureAt: undefined,
    nextAttemptAt: undefined,
    failureClass: undefined,
    retrySource: undefined,
    lastHttpStatus: undefined,
  };
}
