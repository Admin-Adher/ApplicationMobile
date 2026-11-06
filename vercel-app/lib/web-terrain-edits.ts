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
