export const MESSAGE_REACTION_CHOICES = ['👍', '✅', '❤️', '⚠️', '🔥', '💯', '❌'] as const;

export function projectMessageReactions<T extends { id: string; reactions?: unknown }>(rows: T[], queue: readonly any[], name: string): T[] {
  if (!name) return rows;
  return rows.map(row => {
    const intents = queue.flatMap(operation => operation.kind === 'message_reaction'
      ? [{ ...operation.payload, messageId: operation.payload.messageId }]
      : operation.op === 'rpc' && operation.rpc?.fn === 'set_message_reaction'
        ? [{ messageId: operation.rpc.args.p_message_id, emoji: operation.rpc.args.p_emoji, active: operation.rpc.args.p_active }] : []);
    const pending = intents.filter(intent => intent.messageId === row.id);
    if (!pending.length) return row;
    const reactions = { ...(row.reactions ?? {}) } as Record<string, string[]>;
    for (const intent of pending) {
      const names = (reactions[intent.emoji] ?? []).filter(value => value !== name);
      if (intent.active) names.push(name);
      if (names.length) reactions[intent.emoji] = names; else delete reactions[intent.emoji];
    }
    return { ...row, reactions };
  });
}
