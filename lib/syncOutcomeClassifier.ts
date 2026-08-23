import {
  assessPermanentFailure,
  isAuthenticationSyncFailure,
  isInfrastructureSyncFailure,
  shouldAbandonPassAfterInfrastructureFailure,
  type SyncFailureTrackingLike,
} from './syncQueuePolicy';
import type { SyncQueueTerminalOutcome } from './syncQueuePolicy';

/**
 * Classification d'un echec de synchronisation — module PUR.
 *
 * La decision « rejouable, definitif, ou passe abandonnee » vivait dans une
 * fermeture de 800 lignes, melangee aux effets de bord du moteur. Les 37
 * sorties de la boucle n'avaient donc aucune classification lisible, et rien
 * ne pouvait la tester.
 *
 * Elle est ici, une seule fois, sans effet de bord.
 */

export type FailureOutcomeKind = 'deferred' | 'terminal' | 'abandon';
export type FailureAbandonReason = 'backend' | 'authentication';

export interface FailureClassificationInput {
  operation: SyncFailureTrackingLike & { attemptCount?: number; terminalStatus?: string; terminal?: boolean };
  error: unknown;
  /** Refus metier deja etabli par l'appelant, prioritaire sur toute deduction. */
  terminalStatus?: string;
  terminalOutcome?: SyncQueueTerminalOutcome;
  /** Echecs d'infrastructure consecutifs AVANT celui-ci. */
  consecutiveInfraFailures: number;
  circuitAlreadyOpen: boolean;
}

export interface FailureClassification {
  kind: FailureOutcomeKind;
  /** Renseigne uniquement quand `kind` vaut `abandon`. */
  abandonReason: FailureAbandonReason | null;
  /** Message technique, conserve dans `lastError`. */
  message: string;
  attemptCount: number;
  fingerprint: string | null;
  sameFailureCount: number;
  isTerminal: boolean;
  terminalStatus: string | null;
  /** Le refus deterministe vient-il d'etre deduit, plutot que fourni ? */
  inferredTerminal: boolean;
  /** Serie d'echecs d'infrastructure APRES celui-ci. */
  infraFailureStreak: number;
  opensAuthCircuit: boolean;
  opensInfraCircuit: boolean;
}

/**
 * Message technique lisible. Le code, les details et l'indice du serveur sont
 * conserves : ils sont la seule piste exploitable dans un rapport de support.
 */
export function formatSyncFailureMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;

  const candidate = error as { message?: string; code?: string; details?: string; hint?: string };
  if (candidate.message) {
    let message = candidate.message;
    if (candidate.code) message = `[${candidate.code}] ${message}`;
    if (candidate.details) message += ` — ${candidate.details}`;
    if (candidate.hint) message += ` (${candidate.hint})`;
    return message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function classifyFailureOutcome(input: FailureClassificationInput): FailureClassification {
  const { operation, error, consecutiveInfraFailures, circuitAlreadyOpen } = input;

  const attemptCount = (operation.attemptCount ?? 0) + 1;

  // L'evaluation se fait sur l'EMPREINTE, pas sur le nombre total de
  // tentatives : une sequence timeout -> 503 -> 404 ne doit pas rendre le 404
  // terminal du premier coup.
  const assessment = assessPermanentFailure(operation, error);

  const providedStatus = input.terminalOutcome?.status ?? input.terminalStatus;
  const inferredTerminal = !providedStatus && assessment.terminal;
  const terminalStatus = providedStatus ?? (inferredTerminal ? 'server_rejected' : null);
  const isTerminal = Boolean(terminalStatus) || Boolean(input.terminalOutcome) || Boolean(operation.terminal);

  // ── Portee globale ───────────────────────────────────────────────────────
  // Une authentification inutilisable condamne la passe des le premier refus :
  // rejouer chaque operation avec le meme jeton ne ferait que bruler des
  // tentatives et declencher un rafraichissement par ligne.
  const authFailure = isAuthenticationSyncFailure(error);
  const infraFailure = !authFailure && isInfrastructureSyncFailure(error);
  const infraFailureStreak = infraFailure ? consecutiveInfraFailures + 1 : 0;

  const opensAuthCircuit = authFailure && !circuitAlreadyOpen;
  const opensInfraCircuit = infraFailure
    && !circuitAlreadyOpen
    && shouldAbandonPassAfterInfrastructureFailure(infraFailureStreak);

  // Un refus definitif prime sur la portee globale : l'operation ne sera plus
  // rejouee de toute facon, et la signaler comme abandon masquerait sa cause.
  const kind: FailureOutcomeKind = isTerminal
    ? 'terminal'
    : (opensAuthCircuit || opensInfraCircuit)
      ? 'abandon'
      : 'deferred';

  return {
    kind,
    abandonReason: kind !== 'abandon' ? null : opensAuthCircuit ? 'authentication' : 'backend',
    message: formatSyncFailureMessage(error, 'Erreur inconnue'),
    attemptCount,
    fingerprint: assessment.fingerprint,
    sameFailureCount: assessment.sameFailureCount,
    isTerminal,
    terminalStatus,
    inferredTerminal,
    infraFailureStreak,
    opensAuthCircuit,
    opensInfraCircuit,
  };
}
