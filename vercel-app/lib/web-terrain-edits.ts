import type { Comment } from '../../constants/types';
import type { PlanDrawing } from '../../lib/plan-annotations/model';
import type { WebQueuedOperation } from './web-outbox';

export type ReserveCommentChange =
  | { action: 'add'; comment: Comment }
  | { action: 'edit'; commentId: string; content: string; previousContent: string; editedAt: string }
  | { action: 'delete'; commentId: string };

export type PlanAnnotationDelta = { added: PlanDrawing[]; removed: string[] };

export function planAnnotationDelta(previous: readonly PlanDrawing[], next: readonly PlanDrawing[]): PlanAnnotationDelta {
  const oldIds = new Set(previous.map(item => item.id));
  const nextIds = new Set(next.map(item => item.id));
  return { added: next.filter(item => !oldIds.has(item.id)), removed: previous.filter(item => !nextIds.has(item.id)).map(item => item.id) };
}

export function applyPlanAnnotationDelta(annotations: PlanDrawing[], delta: PlanAnnotationDelta): PlanDrawing[] {
  const removed = new Set(delta.removed);
  const remaining = annotations.filter(item => !removed.has(item?.id));
  const ids = new Set(remaining.map(item => item?.id));
  return [...remaining, ...delta.added.filter(item => !ids.has(item.id))];
}

function applyCommentChange(comments: Comment[], change: ReserveCommentChange): Comment[] {
  if (change.action === 'add') {
    return comments.some(item => item.id === change.comment.id) ? comments : [...comments, change.comment];
  }
  if (change.action === 'delete') return comments.filter(item => item.id !== change.commentId);
  return comments.map(item => item.id === change.commentId ? { ...item, content: change.content, editedAt: change.editedAt } : item);
}

export function projectReserveComments<T extends { id: string; comments?: unknown }>(rows: T[], operations: WebQueuedOperation[]) {
  const pending = operations.filter(operation => operation.kind === 'reserve_comment' && !operation.error);
  if (!pending.length) return rows;
  return rows.map(row => {
    const changes = pending.filter(operation => operation.payload.reserveId === row.id);
    if (!changes.length) return row;
    const comments = Array.isArray(row.comments) ? row.comments as Comment[] : [];
    return { ...row, comments: changes.reduce((current, operation) => applyCommentChange(current, operation.payload.change as ReserveCommentChange), comments) };
  });
}

export function projectPlanAnnotations<T extends { id: string; annotations?: unknown }>(rows: T[], operations: WebQueuedOperation[]) {
  const pending = operations.filter(operation => operation.kind === 'plan_annotation' && !operation.error);
  if (!pending.length) return rows;
  return rows.map(row => {
    const changes = pending.filter(operation => operation.payload.planId === row.id);
    if (!changes.length) return row;
    const annotations = Array.isArray(row.annotations) ? row.annotations as PlanDrawing[] : [];
    return { ...row, annotations: changes.reduce((current, operation) => applyPlanAnnotationDelta(current, operation.payload.delta as PlanAnnotationDelta), annotations) };
  });
}

export type WebTerrainChange =
  | { action: 'reserve_archive'; archived: boolean; actor: string; at: string }
  | { action: 'visit_checklist_item'; itemId: string; checked: boolean }
  | { action: 'task_comment'; change: ReserveCommentChange };

export const terrainActionLabels: Record<WebTerrainChange['action'], string> = {
  reserve_archive: 'Archivage de réserve',
  visit_checklist_item: 'Point de contrôle de visite',
  task_comment: 'Commentaire de tâche',
};

export function projectTerrainChanges<T extends Record<string, unknown>>(
  rows: T[], operations: WebQueuedOperation[], action: WebTerrainChange['action'],
): T[] {
  const pending = operations.filter(operation => operation.kind === 'terrain_action' && !operation.error &&
    (operation.payload.change as WebTerrainChange).action === action);
  if (!pending.length) return rows;
  return rows.map(row => pending.reduce((current, operation) => {
    if (operation.payload.rowId !== row.id) return current;
    const change = operation.payload.change as WebTerrainChange;
    if (change.action === 'reserve_archive') {
      return { ...current, archived_at: change.archived ? change.at : null, archived_by: change.archived ? change.actor : null };
    }
    if (change.action === 'task_comment') {
      const task = current as T & { comments?: Comment[] };
      return { ...current, comments: applyCommentChange(Array.isArray(task.comments) ? task.comments : [], change.change) };
    }
    const visit = current as T & { checklist_items?: Array<{ id: string; checked: boolean }>; checklistItems?: Array<{ id: string; checked: boolean }>; status?: string };
    const items = visit.checklist_items ?? visit.checklistItems;
    if (!Array.isArray(items) || !items.some(item => item.id === change.itemId)) return current;
    return {
      ...current,
      checklist_items: items.map(item => item.id === change.itemId ? { ...item, checked: change.checked } : item),
      status: !visit.status || visit.status === 'planned' ? 'in_progress' : visit.status,
    };
  }, row));
}

export function projectPendingRowPatches<T extends Record<string, unknown>>(
  rows: T[], operations: WebQueuedOperation[], kind: 'reserve_pin' | 'inventory_product_edit',
): T[] {
  const patches = new Map<unknown, Record<string, unknown>>();
  for (const operation of operations) {
    if (operation.kind !== kind || operation.error) continue;
    const { rowId, patch } = operation.payload;
    patches.set(rowId, { ...patches.get(rowId), ...(patch as Record<string, unknown>) });
  }
  if (!patches.size) return rows;
  return rows.map(row => patches.has(row.id) ? { ...row, ...patches.get(row.id) } : row);
}
