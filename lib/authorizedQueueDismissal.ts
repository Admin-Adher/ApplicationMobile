/**
 * Terminal queue entries Adrien explicitly authorized us to discard on
 * 2026-08-28. These are local outbox identities, not server row identities.
 *
 * The match is intentionally closed over identity + RPC + terminal verdict:
 * an unrelated operation can never be removed merely because it failed.
 */
const AUTHORIZED_TERMINAL_RPC_DISMISSALS = new Map<string, string>([
  ['2107b600-ed12-4284-a8f5-e8e7df1d4858', 'create_reserve_with_photos'],
  ['088dec54-4c7f-43de-b902-b90e2619d903', 'link_reserves_to_visite'],
]);

export interface AuthorizedDismissalQueueEntry {
  id?: string;
  queueEntryId?: string;
  op?: string;
  rpc?: { fn?: string } | null;
  terminal?: boolean;
  terminalStatus?: string;
}

export interface AuthorizedQueueDismissalResult<T> {
  kept: T[];
  dismissed: T[];
}

export function dismissAuthorizedTerminalQueueEntries<
  T extends AuthorizedDismissalQueueEntry,
>(queue: readonly T[]): AuthorizedQueueDismissalResult<T> {
  const kept: T[] = [];
  const dismissed: T[] = [];

  for (const operation of queue) {
    const authorizedIdentity = [operation.id, operation.queueEntryId]
      .find(identity => typeof identity === 'string'
        && AUTHORIZED_TERMINAL_RPC_DISMISSALS.has(identity));
    const expectedRpc = authorizedIdentity
      ? AUTHORIZED_TERMINAL_RPC_DISMISSALS.get(authorizedIdentity)
      : null;
    const matches = Boolean(
      expectedRpc
      && operation.op === 'rpc'
      && operation.rpc?.fn === expectedRpc
      && operation.terminal === true
      && operation.terminalStatus === 'server_rejected',
    );

    if (matches) dismissed.push(operation);
    else kept.push(operation);
  }

  return { kept, dismissed };
}
