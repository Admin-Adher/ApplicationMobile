import type { Reserve, Visite } from '../constants/types';
import { fromVisite } from './mappers';

const LEGACY_VISIT_ID = /^VIS-\d{8}$/;
const MISSING_VISIT_ERROR = /(?:reserves_tenant_visite_fkey|visite\s+introuvable|visit\s+not\s+found|23503[^\n]*(?:visite|visit)|key\s+is\s+not\s+present\s+in\s+table\s+["']?visites?["']?)/i;

export const HISTORICAL_VISIT_RECOVERY_INTENT = 'insert_missing_historical_visit' as const;

export const HISTORICAL_VISIT_RECOVERY_SKIP_REASONS = [
  'organization_unproven',
  'organization_mismatch',
  'organization_ambiguous',
  'chantier_missing',
  'chantier_ambiguous',
] as const;

export type HistoricalVisitRecoverySkipReason = typeof HISTORICAL_VISIT_RECOVERY_SKIP_REASONS[number];
export type HistoricalVisitRecoveryOrganizationSource = 'active_profile' | 'queue_payload';

export interface HistoricalVisitQueueOperation {
  id?: string;
  queueEntryId?: string;
  queuedAt?: string;
  table?: string;
  op?: string;
  data?: Record<string, any> | null;
  rpc?: { fn?: string; args?: Record<string, any> };
  lastError?: string;
  terminal?: boolean;
  terminalStatus?: string;
  terminalOutcome?: unknown;
  nextAttemptAt?: string;
  failureClass?: unknown;
  retrySource?: unknown;
  sameFailureCount?: number;
  purgeState?: string;
  recoveryIntent?: string;
}

export interface HistoricalVisitRepair {
  visitId: string;
  payload: Record<string, any>;
  source: 'visit_cache' | 'dependent_reserves';
  organizationSource: HistoricalVisitRecoveryOrganizationSource;
  dependencyKeys: string[];
}

export interface HistoricalVisitRecoveryPlan {
  repairs: HistoricalVisitRepair[];
  skipped: { visitId: string; reason: HistoricalVisitRecoverySkipReason }[];
}

export interface HistoricalVisitRecoveryAudit {
  evaluated: boolean;
  candidateCount: number;
  plannedCount: number;
  profileOrganizationAvailable: boolean;
  queuedOrganizationFallbackCount: number;
  skippedReasons: Partial<Record<HistoricalVisitRecoverySkipReason, number>>;
}

function referencedVisitId(operation: HistoricalVisitQueueOperation): string | null {
  if (operation.op !== 'rpc') return null;

  if (operation.rpc?.fn === 'create_reserve_with_photos') {
    const reserve = reservePayload(operation);
    return typeof reserve?.visite_id === 'string' ? reserve.visite_id : null;
  }

  if (operation.rpc?.fn === 'link_reserves_to_visite') {
    const value = operation.rpc.args?.p_visite_id ?? operation.data?.visite_id;
    return typeof value === 'string' ? value : null;
  }

  return null;
}

function reservePayload(operation: HistoricalVisitQueueOperation): Record<string, any> | null {
  if (operation.op !== 'rpc' || operation.rpc?.fn !== 'create_reserve_with_photos') return null;
  const persisted = operation.data && typeof operation.data === 'object' ? operation.data : null;
  const rpcPayload = operation.rpc.args?.p_reserve;
  if (rpcPayload && typeof rpcPayload === 'object') {
    // Les anciennes files ont parfois ete enrichies dans `data` apres un
    // upload, sans que tous les champs aient ete recopies dans `p_reserve`.
    // Fusionner les deux representations conserve la version RPC prioritaire
    // tout en recuperant les preuves tenant/chantier manquantes.
    if (!persisted) return rpcPayload;
    const merged = { ...persisted, ...rpcPayload };
    for (const key of ['id', 'visite_id', 'chantier_id', 'organization_id']) {
      const rpcValue = rpcPayload[key];
      if (
        (typeof rpcValue !== 'string' || rpcValue.trim().length === 0)
        && typeof persisted[key] === 'string'
        && persisted[key].trim().length > 0
      ) {
        merged[key] = persisted[key];
      }
    }
    return merged;
  }
  return persisted;
}

function validIso(value: string | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function uniqueNonEmpty(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => (
    typeof value === 'string' && value.trim().length > 0
  )).map(value => value.trim()))];
}

/**
 * Plan a fail-closed repair for queues produced by the old eight-character
 * visit ID generator. A repair is considered only after the server has already
 * proved that the referenced parent visit is missing.
 */
export function planHistoricalVisitRecovery(input: {
  queue: HistoricalVisitQueueOperation[];
  cachedVisits: Visite[];
  cachedReserves: Reserve[];
  organizationId: string | null | undefined;
  userName?: string | null;
  recoveryTitle?: string;
  recoveryNotes?: string;
  now?: string;
}): HistoricalVisitRecoveryPlan {
  const repairs: HistoricalVisitRepair[] = [];
  const skipped: { visitId: string; reason: HistoricalVisitRecoverySkipReason }[] = [];
  const profileOrganizationId = input.organizationId?.trim() || null;

  const queuedParents = new Set(input.queue
    .filter(operation => operation.table === 'visites' && operation.op === 'insert')
    .map(operation => operation.data?.id)
    .filter((value): value is string => typeof value === 'string'));

  const recoveryCandidates = new Set<string>();
  for (const operation of input.queue) {
    if (operation.purgeState) continue;
    if (!MISSING_VISIT_ERROR.test(operation.lastError ?? '')) continue;
    const visitId = referencedVisitId(operation);
    if (!visitId || !LEGACY_VISIT_ID.test(visitId) || queuedParents.has(visitId)) continue;
    recoveryCandidates.add(visitId);
  }

  const dependencies = new Map<string, HistoricalVisitQueueOperation[]>();
  for (const operation of input.queue) {
    if (operation.purgeState) continue;
    const visitId = referencedVisitId(operation);
    // Une fois la visite manquante prouvee par au moins une operation, inclure
    // tous ses enfants encore conserves. Le lien peut avoir evolue d'une erreur
    // "visite introuvable" vers "reserve introuvable" apres plusieurs essais :
    // il doit etre reactive avec la creation qu'il suit, pas rester refuse.
    if (!visitId || !recoveryCandidates.has(visitId)) continue;
    const existing = dependencies.get(visitId) ?? [];
    existing.push(operation);
    dependencies.set(visitId, existing);
  }

  const now = validIso(input.now) ?? new Date().toISOString();
  for (const [visitId, operations] of dependencies) {
    const dependencyKeys = uniqueNonEmpty(operations.map(operation => operation.queueEntryId ?? operation.id));
    const queuedReserves = operations
      .map(reservePayload)
      .filter((value): value is Record<string, any> => value !== null);
    const reserveIdsFromLinks = operations.flatMap(operation => (
      Array.isArray(operation.rpc?.args?.p_reserve_ids)
        ? operation.rpc!.args!.p_reserve_ids
        : Array.isArray(operation.data?.reserve_ids) ? operation.data!.reserve_ids : []
    ));
    const relatedCachedReserves = input.cachedReserves.filter(reserve => (
      reserve.visiteId === visitId || reserveIdsFromLinks.includes(reserve.id)
    ));

    const queuedOrganizations = uniqueNonEmpty(queuedReserves.map(reserve => reserve.organization_id));
    // Une dependance link-only ne suffit pas a inventer un tenant. Il faut le
    // payload exact d'au moins une creation de reserve ayant deja atteint le
    // serveur et echoue sur la FK de cette visite.
    if (queuedReserves.length === 0) {
      skipped.push({ visitId, reason: 'organization_unproven' });
      continue;
    }
    if (queuedOrganizations.length > 1) {
      skipped.push({ visitId, reason: 'organization_ambiguous' });
      continue;
    }
    const queuedOrganizationId = queuedOrganizations[0] ?? null;
    if (
      profileOrganizationId
      && queuedOrganizationId
      && queuedOrganizationId !== profileOrganizationId
    ) {
      skipped.push({ visitId, reason: 'organization_mismatch' });
      continue;
    }
    // Le profil authentifie reste la source prioritaire. Pour les anciennes
    // files creees avant l'hydratation du profil, son tenant peut manquer du
    // payload : la presence de la creation RPC prouve alors la dependance et
    // le tenant actif suffit. A l'inverse, un profil sans tenant (notamment un
    // super-admin) peut reprendre le tenant UNIQUE deja porte par le payload.
    // L'INSERT reste SECURITY INVOKER et soumis aux RLS cote Supabase.
    const organizationId = profileOrganizationId ?? queuedOrganizationId;
    if (!organizationId) {
      skipped.push({ visitId, reason: 'organization_unproven' });
      continue;
    }
    const organizationSource: HistoricalVisitRecoveryOrganizationSource = profileOrganizationId
      ? 'active_profile'
      : 'queue_payload';

    const dependentChantierIds = uniqueNonEmpty([
      ...queuedReserves.map(reserve => reserve.chantier_id),
      ...relatedCachedReserves.map(reserve => reserve.chantierId),
    ]);
    const cachedVisit = input.cachedVisits.find(visit => visit.id === visitId);
    if (cachedVisit?.chantierId) {
      if (dependentChantierIds.some(chantierId => chantierId !== cachedVisit.chantierId)) {
        skipped.push({ visitId, reason: 'chantier_ambiguous' });
        continue;
      }
      repairs.push({
        visitId,
        payload: fromVisite(cachedVisit, organizationId),
        source: 'visit_cache',
        organizationSource,
        dependencyKeys,
      });
      continue;
    }

    const chantierIds = dependentChantierIds;
    if (chantierIds.length !== 1) {
      skipped.push({ visitId, reason: chantierIds.length === 0 ? 'chantier_missing' : 'chantier_ambiguous' });
      continue;
    }

    const reserveIds = uniqueNonEmpty([
      ...queuedReserves.map(reserve => reserve.id),
      ...reserveIdsFromLinks,
      ...relatedCachedReserves.map(reserve => reserve.id),
    ]);
    const createdAt = operations
      .map(operation => validIso(operation.queuedAt))
      .filter((value): value is string => value !== null)
      .sort()[0] ?? now;

    repairs.push({
      visitId,
      source: 'dependent_reserves',
      organizationSource,
      dependencyKeys,
      payload: fromVisite({
        id: visitId,
        chantierId: chantierIds[0],
        title: `${input.recoveryTitle?.trim() || 'Visite récupérée'} (${visitId})`,
        date: createdAt.slice(0, 10),
        conducteur: input.userName?.trim() || 'BuildTrack',
        status: 'planned',
        notes: input.recoveryNotes?.trim()
          || 'Visite reconstruite automatiquement depuis la file hors ligne.',
        reserveIds,
        createdAt,
      }, organizationId),
    });
  }

  return { repairs, skipped };
}

/** Resume strictement enumere, exportable sans payload ni identifiant metier. */
export function summarizeHistoricalVisitRecovery(
  plan: HistoricalVisitRecoveryPlan,
  profileOrganizationAvailable: boolean,
): HistoricalVisitRecoveryAudit {
  const skippedReasons: HistoricalVisitRecoveryAudit['skippedReasons'] = {};
  for (const item of plan.skipped) {
    skippedReasons[item.reason] = (skippedReasons[item.reason] ?? 0) + 1;
  }
  return {
    evaluated: true,
    candidateCount: plan.repairs.length + plan.skipped.length,
    plannedCount: plan.repairs.length,
    profileOrganizationAvailable,
    queuedOrganizationFallbackCount: plan.repairs.filter(
      repair => repair.organizationSource === 'queue_payload',
    ).length,
    skippedReasons,
  };
}

/**
 * Recovery inserts are insert-if-missing operations. If another device already
 * recreated the visit, matching tenant and chantier identity is sufficient to
 * acknowledge the replay without overwriting the server row.
 */
export function recoveredVisitMatchesPersistedIdentity(
  queued: Record<string, unknown> | null | undefined,
  persisted: Record<string, unknown> | null | undefined,
): boolean {
  if (!queued || !persisted) return false;
  return typeof queued.id === 'string'
    && queued.id === persisted.id
    && typeof queued.organization_id === 'string'
    && queued.organization_id === persisted.organization_id
    && typeof queued.chantier_id === 'string'
    && queued.chantier_id === persisted.chantier_id;
}

/** Reactivate only the child operations covered by a safe recovery plan. */
export function reviveRecoveredVisitDependencies<T extends HistoricalVisitQueueOperation>(
  queue: T[],
  repairs: HistoricalVisitRepair[],
): T[] {
  const dependencyKeys = new Set(repairs.flatMap(repair => repair.dependencyKeys));
  return queue.map(operation => {
    const key = operation.queueEntryId ?? operation.id;
    if (!key || !dependencyKeys.has(key)) return operation;
    const {
      terminal: _terminal,
      terminalStatus: _terminalStatus,
      terminalOutcome: _terminalOutcome,
      nextAttemptAt: _nextAttemptAt,
      failureClass: _failureClass,
      retrySource: _retrySource,
      ...revived
    } = operation;
    return { ...revived, sameFailureCount: 0 } as T;
  });
}
