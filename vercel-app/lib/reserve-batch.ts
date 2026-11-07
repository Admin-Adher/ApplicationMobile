import type { WebQueuedOperation } from './web-outbox';

export type ReserveBatchChange =
  | { field: 'deadline'; value: string }
  | { field: 'status'; value: string }
  | { field: 'company'; value: string };

export function reserveBatchOperation(row: Record<string, any>, change: ReserveBatchChange,
  context: { owner: string; organization: string; author: string; at: string; closedOn: string; id: string; createdAt: number },
): WebQueuedOperation | null {
  const { owner, organization, author, at, id, createdAt } = context;
  const oldValue = change.field === 'company'
    ? (Array.isArray(row.companies) ? row.companies : [row.company].filter(Boolean))
    : row[change.field];
  if (change.field === 'company' ? oldValue.length === 1 && oldValue[0] === change.value : oldValue === change.value) return null;
  const history = {
    id, author, createdAt: at,
    action: change.field === 'status' ? 'Statut modifié en groupe'
      : change.field === 'company' ? 'Entreprise modifiée en groupe' : 'Échéance modifiée en groupe',
    oldValue: Array.isArray(oldValue) ? oldValue.join(', ') : oldValue ?? '', newValue: change.value,
  };
  const kind = change.field === 'deadline' ? 'reserve_edit' : 'reserve_edit_full';
  return {
    key: owner + ':' + kind + ':' + id, owner, kind, createdAt,
    payload: { id, reserveId: row.id, organization_id: organization, version: row.version, title: row.title,
      editFormat: 'field-delta',
      patch: change.field === 'status' ? {} : change.field === 'company'
        ? { companies: [change.value], history: [history] } : { deadline: change.value, history: [history] },
      ...(change.field === 'status' ? { event: {
        from_status: row.status, to_status: change.value, actor_name: author, history_entry: history,
        closed_at: change.value === 'closed' ? context.closedOn : null,
      } } : {}),
    },
  };
}
