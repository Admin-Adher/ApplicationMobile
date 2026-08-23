import {
  assessPermanentFailure,
  shouldAbandonPassAfterInfrastructureFailure,
  type SyncFailureTrackingLike,
  type SyncQueueTerminalOutcome,
} from './syncQueuePolicy';
import {
  computeRetryDecision,
  normalizeAttemptCount,
  normalizeSameFailureCount,
  type RetryQueueOperationLike,
  type SyncFailureClass,
  type SyncFailureTransportMeta,
  type SyncRetrySource,
} from './syncRetryPolicy';

/**
 * Traduction d'un echec en issue d'ordonnanceur — module PUR.
 *
 * Il ne reconnait PAS les erreurs lui-meme : `computeRetryDecision` est la
 * seule politique normative. Une premiere version rejouait ici les anciens
 * classificateurs, ce qui recreait deux definitions concurrentes d'un echec
 * reseau — `REST_ABORTED` compte comme une tentative d'un cote et pas de
 * l'autre, un `429` attend trois echecs ici et bloque immediatement la-bas.
 *
 * Chaine normative :
 *   syncRetryPolicy      classe l'erreur et calcule le reessai
 *   syncOutcomeClassifier traduit cette decision en issue
 *   NetworkContext        applique les effets de bord
 */

export type FailureOutcomeKind = 'deferred' | 'terminal' | 'abandon';
export type FailureAbandonReason = 'backend' | 'authentication' | 'preempted';
export type SyncCancellationReason = 'preempted' | 'account_changed' | 'unmounted';

export interface FailureClassificationInput {
  operation: RetryQueueOperationLike & SyncFailureTrackingLike & { terminal?: boolean; terminalStatus?: string };
  error: unknown;
  meta?: SyncFailureTransportMeta;
  /** Refus metier deja etabli par l'appelant, a partir d'une ligne serveur. */
  terminalStatus?: string;
  terminalOutcome?: SyncQueueTerminalOutcome;
  nowMs: number;
  /** Compteur propre a la portee : operation, backend ou authentification. */
  retryOrdinal?: number;
  jitter?: number;
  /** Echecs alimentant le circuit AVANT celui-ci. */
  consecutiveServiceFailures: number;
  circuitAlreadyOpen: boolean;
  /**
   * L'appelant sait pourquoi son signal a ete annule ; l'erreur REST seule ne
   * distingue pas une preemption d'un changement de compte.
   */
  cancellationReason?: SyncCancellationReason;
}

export interface FailureClassification {
  kind: FailureOutcomeKind;
  abandonReason: FailureAbandonReason | null;
  message: string;
  failureClass: SyncFailureClass;
  retrySource: SyncRetrySource | null;
  nextAttemptAt: string | null;
  lastHttpStatus: number | null;
  reachedServer: boolean;
  contributesToCircuit: boolean;
  blocksCurrentPass: boolean;
  /** Faux pour une annulation : elle ne consomme aucune tentative. */
  incrementAttempt: boolean;
  attemptCount: number;
  fingerprint: string | null;
  sameFailureCount: number;
  isTerminal: boolean;
  terminalStatus: string | null;
  /** Le refus deterministe vient-il d'etre deduit, plutot que fourni ? */
  inferredTerminal: boolean;
  /**
   * Pourquoi l'appelant a annule, quand il s'agit d'une annulation. Le
   * diagnostic distingue ainsi une preemption benigne d'une file bloquee
   * derriere un changement de compte.
   */
  cancellationReason: SyncCancellationReason | null;
  /** Serie d'echecs alimentant le circuit APRES celui-ci. */
  serviceFailureStreak: number;
  opensAuthCircuit: boolean;
  opensServiceCircuit: boolean;
}

const MAX_MESSAGE_PART = 500;

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function safeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.-]{1,48}$/.test(trimmed) ? `[${trimmed}]` : null;
}

function safeStatus(value: unknown): string | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? `HTTP ${parsed}` : null;
}

/**
 * Message technique, sur LISTE BLANCHE.
 *
 * `lastError` est persiste dans la file et expose dans le diagnostic. Serialiser
 * un objet d'erreur arbitraire y ferait entrer ce qu'un SDK y attache :
 * configuration de requete, URL signee, en-tetes, payload, chemin local.
 */
export function formatSyncFailureMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') return safeText(error, 1000) ?? fallback;
  if (!error || typeof error !== 'object') return fallback;

  const candidate = error as Record<string, unknown>;
  const parts = [
    safeCode(candidate.code),
    safeStatus(candidate.status),
    safeText(candidate.message, MAX_MESSAGE_PART),
    safeText(candidate.details, 300),
    safeText(candidate.hint, 300),
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' — ') : fallback;
}

export function classifyFailureOutcome(input: FailureClassificationInput): FailureClassification {
  const { operation, error, consecutiveServiceFailures, circuitAlreadyOpen } = input;

  const decision = computeRetryDecision({
    failure: { error, meta: input.meta },
    operation,
    nowMs: input.nowMs,
    jitter: input.jitter,
    retryOrdinal: input.retryOrdinal,
  });

  const message = formatSyncFailureMessage(error, 'Erreur inconnue');
  const currentAttempts = normalizeAttemptCount(operation.attemptCount);
  const currentSameFailures = normalizeSameFailureCount(operation.sameFailureCount);
  const lastHttpStatus = typeof input.meta?.status === 'number' ? input.meta.status : null;

  // ── Annulation volontaire ────────────────────────────────────────────────
  // Elle ne consomme rien : ni tentative, ni serie, ni echeance. La generation
  // suivante reprendra l'operation telle qu'elle etait.
  if (decision.failureClass === 'cancelled') {
    return {
      kind: 'abandon',
      abandonReason: 'preempted',
      message,
      failureClass: 'cancelled',
      retrySource: null,
      nextAttemptAt: operation.nextAttemptAt ?? null,
      lastHttpStatus,
      reachedServer: false,
      contributesToCircuit: false,
      blocksCurrentPass: false,
      incrementAttempt: false,
      attemptCount: currentAttempts,
      fingerprint: operation.lastFailureFingerprint ?? null,
      sameFailureCount: currentSameFailures,
      isTerminal: Boolean(operation.terminal),
      terminalStatus: operation.terminalStatus ?? null,
      inferredTerminal: false,
      cancellationReason: input.cancellationReason ?? 'preempted',
      serviceFailureStreak: consecutiveServiceFailures,
      opensAuthCircuit: false,
      opensServiceCircuit: false,
    };
  }

  const providedStatus = input.terminalOutcome?.status ?? input.terminalStatus;

  // Un refus metier vient d'une ligne serveur structuree ; une panne globale
  // vient du transport. La meme tentative ne peut pas etre les deux, et laisser
  // l'un masquer l'autre reviendrait a choisir arbitrairement.
  if (providedStatus && decision.blocksCurrentPass) {
    throw new Error(
      'Invariant viole : refus metier terminal et panne de transport globale sur la meme tentative',
    );
  }

  const serviceFailureStreak = decision.contributesToCircuit ? consecutiveServiceFailures + 1 : 0;
  const reachesServiceThreshold = decision.contributesToCircuit
    && shouldAbandonPassAfterInfrastructureFailure(serviceFailureStreak);

  const authFailure = decision.failureClass === 'authentication';
  // « Ouvrir le circuit maintenant » et « interrompre cette passe » sont deux
  // notions distinctes : un circuit deja ouvert ne transforme pas une panne
  // globale en simple echec local, sinon la passe continuerait d'envoyer.
  const mustAbandon = decision.blocksCurrentPass || reachesServiceThreshold;

  const assessment = assessPermanentFailure(operation, error);
  // Un refus deduit est une PRESOMPTION tiree de trois verdicts identiques ; une
  // panne globale du transport est un FAIT observe. Le fait l'emporte : deduire
  // un refus definitif alors que le lien vient de tomber condamnerait une
  // operation que le serveur n'a jamais examinee. Les deux modules classent
  // aujourd'hui ces cas dans des familles disjointes, mais s'appuyer sur cette
  // coincidence ferait dependre l'integrite des donnees d'un detail interne a
  // `syncQueuePolicy`.
  const inferredTerminal = !providedStatus && assessment.terminal && !mustAbandon;
  // Sans le repli sur l'operation, une seconde classification rendait
  // `isTerminal: true` avec un `terminalStatus: null` — un refus sans motif.
  const terminalStatus = providedStatus
    ?? (inferredTerminal ? 'server_rejected' : operation.terminalStatus ?? null);
  const isTerminal = Boolean(terminalStatus) || Boolean(input.terminalOutcome) || Boolean(operation.terminal);

  const kind: FailureOutcomeKind = mustAbandon
    ? 'abandon'
    : isTerminal ? 'terminal' : 'deferred';

  return {
    kind,
    abandonReason: kind !== 'abandon' ? null : authFailure ? 'authentication' : 'backend',
    message,
    failureClass: decision.failureClass,
    retrySource: decision.retrySource,
    nextAttemptAt: decision.nextAttemptAt,
    lastHttpStatus,
    reachedServer: decision.reachedServer,
    contributesToCircuit: decision.contributesToCircuit,
    blocksCurrentPass: decision.blocksCurrentPass,
    incrementAttempt: decision.incrementAttempt,
    attemptCount: decision.incrementAttempt ? currentAttempts + 1 : currentAttempts,
    fingerprint: assessment.fingerprint,
    sameFailureCount: assessment.sameFailureCount,
    isTerminal,
    terminalStatus,
    inferredTerminal,
    cancellationReason: null,
    serviceFailureStreak,
    opensAuthCircuit: authFailure && !circuitAlreadyOpen,
    opensServiceCircuit: reachesServiceThreshold && !circuitAlreadyOpen,
  };
}
