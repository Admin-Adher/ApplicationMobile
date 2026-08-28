import type { Reserve, Visite } from '../constants/types';
import { fromVisite } from './mappers';

const LEGACY_VISIT_ID = /^VIS-\d{8}$/;
const MISSING_VISIT_ERROR = /(?:reserves_tenant_visite_fkey|visite\s+introuvable|visita\s+(?:introuvable|no\s+encontrada)|visit\s+not\s+found|key\s+is\s+not\s+present\s+in\s+table\s+["']?visites?["']?)/i;
const FOREIGN_KEY_23503_ERROR = /^\s*\[?23503\]?(?:\s|—|-|$)/i;
const BARE_FOREIGN_KEY_23503_ERROR = /^\s*\[?23503\]?(?:(?:\s*—\s*|\s+)HTTP\s+409)*\s*$/i;
const VISIT_FOREIGN_KEY_CONSTRAINT = 'reserves_tenant_visite_fkey';
const FOREIGN_KEY_CONSTRAINT_TOKEN = /\b([a-z][a-z0-9_]*_fkey)\b/gi;
const MISSING_TABLE_REFERENCE = /\bkey\s+is\s+not\s+present\s+in\s+table\s+["'`]?([a-z][a-z0-9_.]*)["'`]?/gi;
const EXPLICIT_FOREIGN_KEY_COLUMN = /\b([a-z][a-z0-9_]*_id)\s+(?:violates?|viola|viole)\b.{0,80}\b(?:foreign\s+key|clave\s+for[aá]nea|cl[eé]\s+[eé]trang[eè]re)\b/gi;

export const HISTORICAL_VISIT_RECOVERY_INTENT = 'insert_missing_historical_visit' as const;

export const HISTORICAL_VISIT_RECOVERY_SKIP_REASONS = [
  'organization_unproven',
  'organization_mismatch',
  'organization_ambiguous',
  'chantier_missing',
  'chantier_ambiguous',
  'recovery_parent_mismatch',
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
  attemptCount?: number;
  lastAttemptAt?: string;
  lastFailureAt?: string;
  lastFailureFingerprint?: string;
  lastHttpStatus?: number;
  nextAttemptAt?: string;
  failureClass?: unknown;
  retrySource?: unknown;
  sameFailureCount?: number;
  purgeState?: string;
  recoveryIntent?: string;
  recoveryBlockedByVisitId?: string;
  recoveryDependencyKeys?: string[];
}

export interface HistoricalVisitRepair {
  visitId: string;
  payload: Record<string, any>;
  source: 'visit_cache' | 'dependent_reserves';
  organizationSource: HistoricalVisitRecoveryOrganizationSource;
  dependencyKeys: string[];
  /** Reuse a parent persisted by an earlier OTA instead of inserting a twin. */
  reuseQueuedParent?: boolean;
}

export interface HistoricalVisitRecoveryPlan {
  repairs: HistoricalVisitRepair[];
  skipped: { visitId: string; reason: HistoricalVisitRecoverySkipReason }[];
  evidence: HistoricalVisitRecoveryEvidence;
}

/**
 * Compteurs strictement enumeres : ils expliquent quelle porte du filtre a
 * ete franchie sans exporter les identifiants, payloads ou messages serveur.
 */
export interface HistoricalVisitRecoveryEvidence {
  createReserveOperationCount: number;
  linkOperationCount: number;
  legacyVisitReferenceCount: number;
  missingVisitFailureCount: number;
  foreignKeyFailureCount: number;
  terminalForeignKeyRecoveryCount: number;
  foreignKeyContradictionCount: number;
  reserveLinkCorrelationCount: number;
  ambiguousReserveLinkCount: number;
}

export interface HistoricalVisitRecoveryAudit {
  evaluated: boolean;
  candidateCount: number;
  plannedCount: number;
  profileOrganizationAvailable: boolean;
  queuedOrganizationFallbackCount: number;
  skippedReasons: Partial<Record<HistoricalVisitRecoverySkipReason, number>>;
  evidence: HistoricalVisitRecoveryEvidence;
}

function exactNonEmptyIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Ne jamais reparer un identifiant en le normalisant silencieusement : le
  // parent cree avec la valeur tronquee ne satisferait pas la FK de l'enfant.
  return trimmed.length > 0 && trimmed === value ? value : null;
}

function referencedVisitId(operation: HistoricalVisitQueueOperation): string | null {
  if (operation.op !== 'rpc') return null;

  if (operation.rpc?.fn === 'create_reserve_with_photos') {
    const reserve = reservePayload(operation);
    return exactNonEmptyIdentifier(reserve?.visite_id);
  }

  if (operation.rpc?.fn === 'link_reserves_to_visite') {
    const value = operation.rpc.args?.p_visite_id ?? operation.data?.visite_id;
    return exactNonEmptyIdentifier(value);
  }

  return null;
}

function referencedReserveId(operation: HistoricalVisitQueueOperation): string | null {
  return exactNonEmptyIdentifier(reservePayload(operation)?.id);
}

function linkedReserveIds(operation: HistoricalVisitQueueOperation): string[] {
  if (operation.op !== 'rpc' || operation.rpc?.fn !== 'link_reserves_to_visite') return [];
  const values = Array.isArray(operation.rpc.args?.p_reserve_ids)
    ? operation.rpc.args!.p_reserve_ids
    : Array.isArray(operation.data?.reserve_ids) ? operation.data!.reserve_ids : [];
  return [...new Set(values
    .map(exactNonEmptyIdentifier)
    .filter((value): value is string => value !== null))];
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

  const activeQueue = input.queue.filter(operation => !operation.purgeState);
  const queuedParentsByVisitId = new Map<string, HistoricalVisitQueueOperation[]>();
  for (const operation of activeQueue) {
    if (operation.table !== 'visites' || operation.op !== 'insert') continue;
    const visitId = exactNonEmptyIdentifier(operation.data?.id);
    if (!visitId) continue;
    const parents = queuedParentsByVisitId.get(visitId) ?? [];
    parents.push(operation);
    queuedParentsByVisitId.set(visitId, parents);
  }
  const reusableQueuedRecoveryParents = new Map<string, HistoricalVisitQueueOperation>();
  for (const [visitId, parents] of queuedParentsByVisitId) {
    if (
      parents.length === 1
      && parents[0].recoveryIntent === HISTORICAL_VISIT_RECOVERY_INTENT
    ) {
      reusableQueuedRecoveryParents.set(visitId, parents[0]);
    }
  }

  const evidence: HistoricalVisitRecoveryEvidence = {
    createReserveOperationCount: 0,
    linkOperationCount: 0,
    legacyVisitReferenceCount: 0,
    missingVisitFailureCount: 0,
    foreignKeyFailureCount: 0,
    terminalForeignKeyRecoveryCount: 0,
    foreignKeyContradictionCount: 0,
    reserveLinkCorrelationCount: 0,
    ambiguousReserveLinkCount: 0,
  };
  const directVisitIds = new Map<HistoricalVisitQueueOperation, string>();
  const linkedVisitIdsByReserve = new Map<string, Set<string>>();
  const linkedOperationsByReserve = new Map<string, HistoricalVisitQueueOperation[]>();

  for (const operation of activeQueue) {
    const rpcName = operation.op === 'rpc' ? operation.rpc?.fn : null;
    if (rpcName === 'create_reserve_with_photos') evidence.createReserveOperationCount += 1;
    if (rpcName === 'link_reserves_to_visite') evidence.linkOperationCount += 1;

    const visitId = referencedVisitId(operation);
    if (visitId) directVisitIds.set(operation, visitId);
    if (visitId && LEGACY_VISIT_ID.test(visitId)) {
      evidence.legacyVisitReferenceCount += 1;
    }
    if (MISSING_VISIT_ERROR.test(operation.lastError ?? '')) {
      evidence.missingVisitFailureCount += 1;
    }
    if (FOREIGN_KEY_23503_ERROR.test(operation.lastError ?? '')) {
      evidence.foreignKeyFailureCount += 1;
      if (explicitlyContradictsVisitForeignKey(operation.lastError ?? '')) {
        evidence.foreignKeyContradictionCount += 1;
      }
    }

    if (rpcName !== 'link_reserves_to_visite' || !visitId || !LEGACY_VISIT_ID.test(visitId)) {
      continue;
    }
    for (const reserveId of linkedReserveIds(operation)) {
      const linkedVisitIds = linkedVisitIdsByReserve.get(reserveId) ?? new Set<string>();
      linkedVisitIds.add(visitId);
      linkedVisitIdsByReserve.set(reserveId, linkedVisitIds);
      const linkedOperations = linkedOperationsByReserve.get(reserveId) ?? [];
      linkedOperations.push(operation);
      linkedOperationsByReserve.set(reserveId, linkedOperations);
    }
  }

  // Les anciennes files peuvent avoir perdu `visite_id` dans la copie de la
  // creation de reserve alors que l'operation de liaison conserve encore la
  // relation exacte reserve -> visite. Une correlation UNIQUE restaure cette
  // preuve ; plusieurs visites possibles restent volontairement bloquees.
  const resolvedVisitIds = new Map<HistoricalVisitQueueOperation, string>();
  const corroboratedCreateOperations = new Set<HistoricalVisitQueueOperation>();
  for (const operation of activeQueue) {
    const directVisitId = directVisitIds.get(operation) ?? null;
    if (directVisitId && LEGACY_VISIT_ID.test(directVisitId)) {
      resolvedVisitIds.set(operation, directVisitId);
    }
    if (operation.op !== 'rpc' || operation.rpc?.fn !== 'create_reserve_with_photos') continue;
    const reserveId = referencedReserveId(operation);
    if (!reserveId) continue;
    const linkedVisitIds = linkedVisitIdsByReserve.get(reserveId);
    if (!linkedVisitIds || linkedVisitIds.size === 0) continue;
    if (linkedVisitIds.size > 1) {
      evidence.ambiguousReserveLinkCount += 1;
      continue;
    }
    const [correlatedVisitId] = linkedVisitIds;
    if (directVisitId && directVisitId !== correlatedVisitId) {
      evidence.ambiguousReserveLinkCount += 1;
      continue;
    }
    evidence.reserveLinkCorrelationCount += 1;
    corroboratedCreateOperations.add(operation);
    resolvedVisitIds.set(operation, correlatedVisitId);
  }

  const recoveryCandidates = new Set<string>();
  for (const operation of activeQueue) {
    const lastError = operation.lastError ?? '';
    const messageProvesMissingVisit = MISSING_VISIT_ERROR.test(lastError);
    const directVisitId = directVisitIds.get(operation) ?? null;
    const reserveId = referencedReserveId(operation);
    const correlatedVisitId = resolvedVisitIds.get(operation) ?? null;
    const hasRepeatedTerminalLink = Boolean(reserveId && correlatedVisitId && (
      linkedOperationsByReserve.get(reserveId) ?? []
    ).some(link => (
      referencedVisitId(link) === correlatedVisitId
      && repeatedTerminalFailure(link)
    )));
    const hasExactCreateAndLinkCorrelation = (
      operation.op === 'rpc'
      && operation.rpc?.fn === 'create_reserve_with_photos'
      && directVisitId !== null
      && LEGACY_VISIT_ID.test(directVisitId)
      && corroboratedCreateOperations.has(operation)
    );
    const isBareCorroboratedReserveForeignKey = (
      hasExactCreateAndLinkCorrelation
      && BARE_FOREIGN_KEY_23503_ERROR.test(lastError)
    );
    const isTerminalCorroboratedReserveForeignKey = (
      hasExactCreateAndLinkCorrelation
      && FOREIGN_KEY_23503_ERROR.test(lastError)
      && !messageProvesMissingVisit
      && !explicitlyContradictsVisitForeignKey(lastError)
      && repeatedTerminalFailure(operation)
      && hasRepeatedTerminalLink
    );
    if (isTerminalCorroboratedReserveForeignKey) {
      evidence.terminalForeignKeyRecoveryCount += 1;
    }
    const isCorroboratedReserveForeignKey = (
      isBareCorroboratedReserveForeignKey || isTerminalCorroboratedReserveForeignKey
    );
    if (!messageProvesMissingVisit && !isCorroboratedReserveForeignKey) continue;
    const visitId = resolvedVisitIds.get(operation) ?? null;
    if (!visitId || !LEGACY_VISIT_ID.test(visitId)) continue;
    const queuedParents = queuedParentsByVisitId.get(visitId) ?? [];
    // Une operation parente ordinaire (ou plusieurs parents concurrents) reste
    // hors du reparateur. Seul l'ancien parent cree par CE workflow peut etre
    // migre sans insertion supplementaire.
    if (queuedParents.length > 0 && !reusableQueuedRecoveryParents.has(visitId)) continue;
    recoveryCandidates.add(visitId);
  }

  const dependencies = new Map<string, HistoricalVisitQueueOperation[]>();
  for (const operation of activeQueue) {
    const visitId = resolvedVisitIds.get(operation) ?? null;
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
    const reusableQueuedParent = reusableQueuedRecoveryParents.get(visitId) ?? null;
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
      const payload = fromVisite(cachedVisit, organizationId);
      if (
        reusableQueuedParent
        && !recoveredVisitMatchesPersistedIdentity(payload, reusableQueuedParent.data)
      ) {
        skipped.push({ visitId, reason: 'recovery_parent_mismatch' });
        continue;
      }
      repairs.push({
        visitId,
        payload,
        source: 'visit_cache',
        organizationSource,
        dependencyKeys,
        reuseQueuedParent: Boolean(reusableQueuedParent),
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

    const payload = fromVisite({
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
    }, organizationId);
    if (
      reusableQueuedParent
      && !recoveredVisitMatchesPersistedIdentity(payload, reusableQueuedParent.data)
    ) {
      skipped.push({ visitId, reason: 'recovery_parent_mismatch' });
      continue;
    }
    repairs.push({
      visitId,
      source: 'dependent_reserves',
      organizationSource,
      dependencyKeys,
      payload,
      reuseQueuedParent: Boolean(reusableQueuedParent),
    });
  }

  return { repairs, skipped, evidence };
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
    evidence: plan.evidence,
  };
}

function repeatedTerminalFailure(operation: HistoricalVisitQueueOperation): boolean {
  return operation.terminal === true
    && operation.terminalStatus === 'server_rejected'
    && (operation.sameFailureCount ?? 0) >= 3;
}

/**
 * Refuse un 23503 opaque des qu'il contient une preuve explicite qu'une autre
 * relation est en cause. En l'absence de contradiction, l'admission reste
 * reservee plus bas a deux operations terminales exactement correlees.
 */
function explicitlyContradictsVisitForeignKey(message: string): boolean {
  const constraintNames = [...message.matchAll(FOREIGN_KEY_CONSTRAINT_TOKEN)]
    .map(match => match[1].toLowerCase());
  if (constraintNames.some(name => name !== VISIT_FOREIGN_KEY_CONSTRAINT)) return true;

  const referencedTables = [...message.matchAll(MISSING_TABLE_REFERENCE)]
    .map(match => match[1].toLowerCase().split('.').pop());
  if (referencedTables.some(table => table !== 'visite' && table !== 'visites')) return true;

  // Si PostgreSQL a donne le nom exact de la contrainte, il prime sur une
  // eventuelle liste de colonnes de la FK composite (tenant_id, visite_id).
  if (constraintNames.length > 0) return false;
  const explicitColumns = [...message.matchAll(EXPLICIT_FOREIGN_KEY_COLUMN)]
    .map(match => match[1].toLowerCase());
  return explicitColumns.some(column => column !== 'visite_id');
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

/**
 * Hold every exact child while its synthetic parent is still unconfirmed.
 * The marker is durable so a crash between INSERT and queue commit cannot let
 * the children overtake the idempotent parent verification on restart.
 */
export function blockRecoveredVisitDependencies<T extends HistoricalVisitQueueOperation>(
  queue: T[],
  repairs: HistoricalVisitRepair[],
): T[] {
  const visitIdByDependencyKey = new Map<string, string>();
  const ambiguousKeys = new Set<string>();
  for (const repair of repairs) {
    for (const key of repair.dependencyKeys) {
      const existing = visitIdByDependencyKey.get(key);
      if (existing && existing !== repair.visitId) ambiguousKeys.add(key);
      else visitIdByDependencyKey.set(key, repair.visitId);
    }
  }

  return queue.map(operation => {
    const key = operation.queueEntryId ?? operation.id;
    if (!key || ambiguousKeys.has(key)) return operation;
    const visitId = visitIdByDependencyKey.get(key);
    if (!visitId) return operation;
    if (operation.recoveryBlockedByVisitId && operation.recoveryBlockedByVisitId !== visitId) {
      return operation;
    }
    return { ...operation, recoveryBlockedByVisitId: visitId } as T;
  });
}

/**
 * Apply the durable child barrier and upgrade a unique parent persisted by an
 * earlier OTA. The existing parent is reused only after the planner verified
 * its visit/tenant/chantier identity against the reconstructed payload.
 */
export function prepareRecoveredVisitQueue<T extends HistoricalVisitQueueOperation>(
  queue: T[],
  repairs: HistoricalVisitRepair[],
): T[] {
  const blocked = blockRecoveredVisitDependencies(queue, repairs);
  const reusableRepairs = new Map(repairs
    .filter(repair => repair.reuseQueuedParent)
    .map(repair => [repair.visitId, repair]));

  return blocked.map(operation => {
    if (
      operation.table !== 'visites'
      || operation.op !== 'insert'
      || operation.recoveryIntent !== HISTORICAL_VISIT_RECOVERY_INTENT
    ) return operation;
    const visitId = exactNonEmptyIdentifier(operation.data?.id);
    if (!visitId) return operation;
    const repair = reusableRepairs.get(visitId);
    if (!repair || !recoveredVisitMatchesPersistedIdentity(repair.payload, operation.data)) {
      return operation;
    }
    const barrierWasAlreadyMigrated = Array.isArray(operation.recoveryDependencyKeys);
    const dependencyKeys = [...new Set([
      ...(Array.isArray(operation.recoveryDependencyKeys) ? operation.recoveryDependencyKeys : []),
      ...repair.dependencyKeys,
    ].map(exactNonEmptyIdentifier).filter((value): value is string => value !== null))];
    const migrated = { ...operation, recoveryDependencyKeys: dependencyKeys };
    if (barrierWasAlreadyMigrated || operation.terminal !== true) return migrated as T;

    // Une OTA precedente a pu rendre ce parent terminal AVANT de persister la
    // barriere. Le rearmement est autorise une seule fois : la presence future
    // de `recoveryDependencyKeys` empeche toute boucle si le parent echoue de
    // nouveau pour une raison deterministe legitime.
    const {
      terminal: _terminal,
      terminalStatus: _terminalStatus,
      terminalOutcome: _terminalOutcome,
      lastError: _lastError,
      attemptCount: _attemptCount,
      lastAttemptAt: _lastAttemptAt,
      lastFailureAt: _lastFailureAt,
      lastFailureFingerprint: _lastFailureFingerprint,
      lastHttpStatus: _lastHttpStatus,
      nextAttemptAt: _nextAttemptAt,
      failureClass: _failureClass,
      retrySource: _retrySource,
      ...rearmed
    } = migrated;
    return { ...rearmed, attemptCount: 0, sameFailureCount: 0 } as T;
  });
}

/** Reactivate only children released by the successfully applied exact parent. */
export function releaseRecoveredVisitDependencies<T extends HistoricalVisitQueueOperation>(
  queue: T[],
  visitId: string,
  dependencyKeys: string[],
): T[] {
  const exactDependencyKeys = new Set(dependencyKeys);
  return queue.map(operation => {
    // Le plan peut preceder la migration qui attribue `queueEntryId` aux
    // anciennes files. Conserver les deux identites permet au parent persiste
    // avec l'ancien `id` de liberer l'enfant apres cette attribution.
    const operationKeys = [operation.queueEntryId, operation.id]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (
      !operationKeys.some(key => exactDependencyKeys.has(key))
      || operation.recoveryBlockedByVisitId !== visitId
    ) return operation;
    const {
      terminal: _terminal,
      terminalStatus: _terminalStatus,
      terminalOutcome: _terminalOutcome,
      lastError: _lastError,
      attemptCount: _attemptCount,
      lastAttemptAt: _lastAttemptAt,
      lastFailureAt: _lastFailureAt,
      lastFailureFingerprint: _lastFailureFingerprint,
      lastHttpStatus: _lastHttpStatus,
      nextAttemptAt: _nextAttemptAt,
      failureClass: _failureClass,
      retrySource: _retrySource,
      recoveryBlockedByVisitId: _recoveryBlockedByVisitId,
      ...revived
    } = operation;
    return { ...revived, attemptCount: 0, sameFailureCount: 0 } as T;
  });
}

/** Compatibility helper used by focused planning tests and callers. */
export function reviveRecoveredVisitDependencies<T extends HistoricalVisitQueueOperation>(
  queue: T[],
  repairs: HistoricalVisitRepair[],
): T[] {
  let next = blockRecoveredVisitDependencies(queue, repairs);
  for (const repair of repairs) {
    next = releaseRecoveredVisitDependencies(next, repair.visitId, repair.dependencyKeys);
  }
  return next;
}
