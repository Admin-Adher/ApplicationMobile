import { sanitizePlanDrawings, type PlanDrawing } from './model';

/**
 * A local annotation document that must stay authoritative while a write is in
 * flight, and until a later server response proves that the write is visible.
 */
export interface PendingPlanAnnotationSnapshot {
  readonly ownerId: string | null;
  readonly annotations: readonly PlanDrawing[];
  readonly signature: string;
  readonly pending: boolean;
}

export interface PlanAnnotationOverlayResult<TPlan> {
  readonly plans: TPlan[];
  readonly acknowledgedIds: string[];
}

type PlanWithAnnotations = {
  readonly id: string | number;
  readonly annotations?: unknown;
};

/**
 * Builds a deterministic signature from the persisted domain contract rather
 * than from arbitrary input object shape or property order.
 */
export function getCanonicalPlanAnnotationSignature(annotations: unknown): string {
  return JSON.stringify(sanitizePlanDrawings(annotations));
}

export function createPendingPlanAnnotationSnapshot(
  ownerId: string | null,
  annotations: unknown,
  pending: boolean,
): PendingPlanAnnotationSnapshot {
  const canonicalAnnotations = sanitizePlanDrawings(annotations);
  return {
    ownerId,
    annotations: canonicalAnnotations,
    signature: JSON.stringify(canonicalAnnotations),
    pending,
  };
}

/**
 * Overlays local snapshots without mutating the server result or snapshot map.
 *
 * A completed snapshot is only acknowledged once the server returns the exact
 * same canonical document. Until then, even an empty local document remains
 * authoritative so a delayed fetch cannot resurrect annotations after clear or
 * undo. Snapshots owned by another authenticated user are ignored.
 */
export function overlayPendingPlanAnnotationSnapshots<TPlan extends PlanWithAnnotations>(
  plans: readonly TPlan[],
  snapshots: ReadonlyMap<string, PendingPlanAnnotationSnapshot>,
  ownerId: string | null,
): PlanAnnotationOverlayResult<TPlan> {
  const acknowledgedIds = new Set<string>();
  const overlayedPlans = plans.map(plan => {
    const planId = String(plan.id);
    const snapshot = snapshots.get(planId);
    if (!snapshot || snapshot.ownerId !== ownerId) return plan;

    const canonicalAnnotations = sanitizePlanDrawings(snapshot.annotations);
    const canonicalSnapshotSignature = JSON.stringify(canonicalAnnotations);
    const serverSignature = getCanonicalPlanAnnotationSignature(plan.annotations);
    const hasValidSnapshotSignature = snapshot.signature === canonicalSnapshotSignature;

    if (!snapshot.pending && hasValidSnapshotSignature && serverSignature === snapshot.signature) {
      acknowledgedIds.add(planId);
      return plan;
    }

    return { ...plan, annotations: canonicalAnnotations };
  });

  return {
    plans: overlayedPlans,
    acknowledgedIds: [...acknowledgedIds],
  };
}
