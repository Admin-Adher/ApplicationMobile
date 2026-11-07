type TimeEntryWrite = {
  table: string;
  op: string;
  data?: Record<string, unknown>;
  filter?: { column: string; value: unknown };
  terminal?: boolean;
  terminalStatus?: string;
  lastError?: string;
  purgeState?: string;
  timeEntryMetadataRecoveryVersion?: number;
};

/** Retry only the proven missing-column rejection after its schema repair. */
export function recoverRejectedTimeEntryWrite<T extends TimeEntryWrite>(operation: T): T {
  if (operation.table !== 'time_entries' || !operation.data || !operation.terminal
    || operation.terminalStatus !== 'server_rejected' || operation.purgeState
    || operation.timeEntryMetadataRecoveryVersion === 1) return operation;
  const id = operation.op === 'insert' ? operation.data.id
    : operation.op === 'update' && operation.filter?.column === 'id' ? operation.filter.value : null;
  if (typeof id !== 'string' || !id.trim()) return operation;
  const error = operation.lastError ?? '';
  if (!/^\[(?:PGRST204|42703)\]/.test(error) || !/time_entries/.test(error)) return operation;
  const missingMetadata = ['updated_by', 'updated_at'].some(column =>
    Object.hasOwn(operation.data!, column) && new RegExp(`['".\\s]${column}['"\\s]`).test(error));
  if (!missingMetadata) return operation;
  return {
    ...operation,
    timeEntryMetadataRecoveryVersion: 1,
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
