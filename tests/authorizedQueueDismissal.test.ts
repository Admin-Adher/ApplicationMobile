import { describe, expect, it } from 'vitest';
import { dismissAuthorizedTerminalQueueEntries } from '../lib/authorizedQueueDismissal';

describe('explicitly authorized terminal queue dismissal', () => {
  const create = {
    id: '2107b600-ed12-4284-a8f5-e8e7df1d4858',
    op: 'rpc',
    rpc: { fn: 'create_reserve_with_photos' },
    terminal: true,
    terminalStatus: 'server_rejected',
  };
  const link = {
    id: '088dec54-4c7f-43de-b902-b90e2619d903',
    op: 'rpc',
    rpc: { fn: 'link_reserves_to_visite' },
    terminal: true,
    terminalStatus: 'server_rejected',
  };

  it('removes exactly the two entries authorized by the user', () => {
    const unrelated = {
      id: 'unrelated',
      op: 'rpc',
      rpc: { fn: 'create_reserve_with_photos' },
      terminal: true,
      terminalStatus: 'server_rejected',
    };
    const result = dismissAuthorizedTerminalQueueEntries([create, unrelated, link]);

    expect(result.dismissed).toEqual([create, link]);
    expect(result.kept).toEqual([unrelated]);
  });

  it('fails closed when identity, RPC or terminal verdict differs', () => {
    const variants = [
      { ...create, terminal: false },
      { ...create, terminalStatus: 'auth_required' },
      { ...create, rpc: { fn: 'link_reserves_to_visite' } },
      { ...create, id: 'another-id' },
    ];

    const result = dismissAuthorizedTerminalQueueEntries(variants);
    expect(result.dismissed).toEqual([]);
    expect(result.kept).toEqual(variants);
  });

  it('also recognizes a migrated physical queue identity', () => {
    const migrated = { ...create, id: 'business-id-changed', queueEntryId: create.id };
    expect(dismissAuthorizedTerminalQueueEntries([migrated]).dismissed).toEqual([migrated]);
  });
});
