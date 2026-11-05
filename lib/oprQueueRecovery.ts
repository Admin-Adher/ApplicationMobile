import { normalizeOprPayloadForSupabase } from './mappers';

type QueuedOprInsert = {
  table: string;
  op: string;
  data?: Record<string, unknown>;
  terminal?: boolean;
  terminalStatus?: string;
  lastError?: string;
  purgeState?: string;
};

export function recoverRejectedOprTimestamp<T extends QueuedOprInsert>(operation: T): T {
  const { table, op, data, terminal, terminalStatus, lastError, purgeState } = operation;
  if (table !== 'oprs' || op !== 'insert' || !terminal || terminalStatus !== 'server_rejected'
      || purgeState || typeof data?.id !== 'string' || !data.id.trim()
      || typeof data.created_at !== 'string' || !lastError?.startsWith('[22008]')
      || !lastError.includes(`date/time field value out of range: "${data.created_at}"`)) {
    return operation;
  }

  const repaired = normalizeOprPayloadForSupabase(data);
  if (repaired === data) return operation;
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
