import {
  getSyncQueueCounts,
  getSyncQueueOperationDomain,
  type SyncQueueOperationLike,
} from './syncQueuePolicy';
import {
  HISTORICAL_VISIT_RECOVERY_SKIP_REASONS,
  type HistoricalVisitRecoveryAudit,
  type HistoricalVisitRecoverySkipReason,
} from './historicalVisitRecovery';

/**
 * Export de diagnostic destine au support.
 *
 * Regle de conception : LISTE BLANCHE stricte, doublee d'une NORMALISATION de
 * chaque valeur retenue. Choisir les champs ne suffit pas — un champ autorise
 * peut lui-meme transporter de la donnee sensible. C'est exactement ce qui
 * s'est produit avec l'empreinte d'erreur : derivee du message serveur, elle
 * conservait nom de produit, nom de chantier et adresse e-mail.
 */

/** Detail maximal embarque. Au-dela, seuls les compteurs globaux comptent. */
export const MAX_EXPORTED_OPERATIONS = 100;

const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 64;
const MAX_STATUS_LENGTH = 48;

export interface DiagnosticQueuedOperation extends SyncQueueOperationLike {
  id?: string;
  op?: string;
  queuedAt?: string;
  lastError?: string;
  lastFailureFingerprint?: string;
  sameFailureCount?: number;
}

/**
 * Identite du bundle JavaScript reellement en cours d'execution.
 *
 * `version` et `build` ne suffisent pas : plusieurs OTA se succedent sur le
 * meme `runtimeVersion`, avec des numeros identiques. Un rapport terrain ne
 * pouvait donc pas designer le bundle qu'il mesurait.
 */
export interface DiagnosticBundleIdentity {
  /** `null` sur un bundle embarque ou hors EAS Update. */
  updateId?: string | null;
  /** Date de publication de la mise a jour chargee. */
  updateCreatedAt?: string | null;
  channel?: string | null;
  runtimeVersion?: string | null;
  /**
   * `true` quand l'application tourne le bundle livre avec l'APK, donc
   * AUCUNE mise a jour appliquee. Repond directement a « l'OTA est-elle
   * active ? », au lieu de le deduire de la presence d'un bouton.
   */
  embeddedLaunch?: boolean | null;
}

export interface DiagnosticEnvironment extends DiagnosticBundleIdentity {
  appVersion: string;
  buildNumber: number | null;
  platform: string;
  generatedAt: string;
  isOnline: boolean;
  /** `null` tant qu'aucune sonde backend n'a abouti. */
  backendReachable?: boolean | null;
  syncStatus?: string;
  syncAuthBlocked?: boolean;
  lastAttemptAt?: string | null;
  /** Derniere operation individuellement acceptee par le serveur. */
  lastOperationSuccessAt?: string | null;
  /** Derniere fois que la file s'est videe entierement. */
  lastQueueDrainedAt?: string | null;
  nextAttemptAt?: string | null;
  /** Audit enumere uniquement : aucun payload ni identifiant de visite. */
  historicalVisitRecovery?: Partial<HistoricalVisitRecoveryAudit> | null;
}

export interface DiagnosticOperationLine {
  id: string;
  domain: string;
  operation: string;
  state: 'pending' | 'rejected';
  queuedAt?: string;
  attemptCount: number;
  sameFailureCount?: number;
  failureClass?: string;
  /**
   * Alias LOCAL au rapport (E1, E2…) regroupant les operations qui echouent de
   * la meme facon. Remplace l'empreinte brute, qui portait le message serveur
   * et donc potentiellement des donnees metier ou personnelles.
   */
  failureGroup?: string;
  terminalStatus?: string;
}

export interface SyncDiagnosticReport {
  generatedAt: string;
  app: {
    version: string;
    build: number | null;
    platform: string;
    updateId: string | null;
    updateCreatedAt: string | null;
    channel: string | null;
    runtimeVersion: string | null;
    embeddedLaunch: boolean | null;
  };
  connectivity: {
    online: boolean;
    backendReachable: boolean | null;
    syncStatus: string;
    authBlocked: boolean;
  };
  queue: {
    pending: number;
    rejected: number;
    stuck: number;
    attention: number;
    oldestPendingQueuedAt: string | null;
    oldestPendingAgeMinutes: number | null;
    oldestRejectedQueuedAt: string | null;
    lastAttemptAt: string | null;
    lastOperationSuccessAt: string | null;
    lastQueueDrainedAt: string | null;
    nextAttemptAt: string | null;
  };
  historicalVisitRecovery: HistoricalVisitRecoveryAudit;
  operations: DiagnosticOperationLine[];
  /** Operations non detaillees a cause du plafond ; les compteurs les incluent. */
  omittedOperations: number;
}

/**
 * Une file corrompue, migree ou manipulee peut contenir n'importe quoi dans un
 * champ pourtant sur en fonctionnement nominal. On ne fait donc confiance a
 * aucune valeur : format impose, longueur bornee, repli explicite.
 */
function safeToken(value: unknown, allowed: RegExp, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !allowed.test(trimmed)) return undefined;
  return trimmed.slice(0, maxLength);
}

const ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const NAME_PATTERN = /^[A-Za-z0-9_.]+$/;
const STATUS_PATTERN = /^[A-Za-z0-9_]+$/;

function safeIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function safeCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), 1_000_000);
}

function safeHistoricalVisitRecovery(
  value: Partial<HistoricalVisitRecoveryAudit> | null | undefined,
): HistoricalVisitRecoveryAudit {
  const candidateCount = safeCount(value?.candidateCount);
  const plannedCount = Math.min(candidateCount, safeCount(value?.plannedCount));
  const skippedReasons: Partial<Record<HistoricalVisitRecoverySkipReason, number>> = {};
  for (const reason of HISTORICAL_VISIT_RECOVERY_SKIP_REASONS) {
    const count = safeCount(value?.skippedReasons?.[reason]);
    if (count > 0) skippedReasons[reason] = count;
  }
  return {
    evaluated: value?.evaluated === true,
    candidateCount,
    plannedCount,
    profileOrganizationAvailable: value?.profileOrganizationAvailable === true,
    queuedOrganizationFallbackCount: Math.min(
      plannedCount,
      safeCount(value?.queuedOrganizationFallbackCount),
    ),
    skippedReasons,
    evidence: {
      createReserveOperationCount: safeCount(value?.evidence?.createReserveOperationCount),
      linkOperationCount: safeCount(value?.evidence?.linkOperationCount),
      legacyVisitReferenceCount: safeCount(value?.evidence?.legacyVisitReferenceCount),
      missingVisitFailureCount: safeCount(value?.evidence?.missingVisitFailureCount),
      foreignKeyFailureCount: safeCount(value?.evidence?.foreignKeyFailureCount),
      terminalForeignKeyRecoveryCount: safeCount(value?.evidence?.terminalForeignKeyRecoveryCount),
      foreignKeyContradictionCount: safeCount(value?.evidence?.foreignKeyContradictionCount),
      reserveLinkCorrelationCount: safeCount(value?.evidence?.reserveLinkCorrelationCount),
      ambiguousReserveLinkCount: safeCount(value?.evidence?.ambiguousReserveLinkCount),
    },
  };
}

/**
 * Ne conserve que la NATURE de l'echec. Le message brut n'est jamais retenu :
 * il porte le texte renvoye par le serveur, donc potentiellement un libelle
 * produit, un nom de chantier ou une adresse e-mail.
 */
function failureClassOf(operation: DiagnosticQueuedOperation): string | undefined {
  const status = safeToken(
    operation.terminalOutcome?.status ?? operation.terminalStatus,
    STATUS_PATTERN,
    MAX_STATUS_LENGTH,
  );
  if (status) return status;
  if (!operation.lastError) return undefined;
  const code = operation.lastError.match(/^\[([A-Za-z0-9_]{1,32})\]/)?.[1];
  return code ?? 'unclassified';
}

function ageInMinutes(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/** Plus ancienne date de mise en file parmi un sous-ensemble. */
function oldestQueuedAt(operations: readonly DiagnosticQueuedOperation[]): string | null {
  const dates = operations
    .map(operation => safeIsoDate(operation.queuedAt))
    .filter((value): value is string => value !== undefined)
    .sort();
  return dates[0] ?? null;
}

/**
 * Les operations les plus utiles au support d'abord : refus definitifs, puis
 * celles qui insistent le plus, puis les plus anciennes. Le plafond ne doit pas
 * amputer le rapport de ce qui explique la panne.
 */
function byDiagnosticInterest(
  a: DiagnosticQueuedOperation,
  b: DiagnosticQueuedOperation,
): number {
  const terminalDiff = Number(Boolean(b.terminal)) - Number(Boolean(a.terminal));
  if (terminalDiff !== 0) return terminalDiff;
  const attemptDiff = safeCount(b.attemptCount) - safeCount(a.attemptCount);
  if (attemptDiff !== 0) return attemptDiff;
  return (a.queuedAt ?? '').localeCompare(b.queuedAt ?? '');
}

export function buildSyncDiagnosticReport(
  queue: readonly DiagnosticQueuedOperation[],
  environment: DiagnosticEnvironment,
): SyncDiagnosticReport {
  const counts = getSyncQueueCounts(queue as SyncQueueOperationLike[]);

  const pendingOperations = queue.filter(operation => !operation.terminal);
  const rejectedOperations = queue.filter(operation => Boolean(operation.terminal));

  const selected = [...queue].sort(byDiagnosticInterest).slice(0, MAX_EXPORTED_OPERATIONS);

  // Alias LOCAL au rapport. Deux operations qui echouent identiquement portent
  // le meme groupe, ce qui suffit au support ; la valeur source ne sort jamais.
  const groupByFingerprint = new Map<string, string>();
  const failureGroupOf = (operation: DiagnosticQueuedOperation): string | undefined => {
    const fingerprint = operation.lastFailureFingerprint;
    if (typeof fingerprint !== 'string' || !fingerprint) return undefined;
    const existing = groupByFingerprint.get(fingerprint);
    if (existing) return existing;
    const alias = `E${groupByFingerprint.size + 1}`;
    groupByFingerprint.set(fingerprint, alias);
    return alias;
  };

  const operations: DiagnosticOperationLine[] = selected.map(operation => {
    const failureClass = failureClassOf(operation);
    const failureGroup = failureGroupOf(operation);
    const queuedAt = safeIsoDate(operation.queuedAt);
    const terminalStatus = safeToken(operation.terminalStatus, STATUS_PATTERN, MAX_STATUS_LENGTH);
    const sameFailureCount = operation.sameFailureCount;

    return {
      id: safeToken(operation.id, ID_PATTERN, MAX_ID_LENGTH) ?? 'inconnu',
      domain: getSyncQueueOperationDomain(operation),
      operation: safeToken(operation.rpc?.fn, NAME_PATTERN, MAX_NAME_LENGTH)
        ?? safeToken(operation.table, NAME_PATTERN, MAX_NAME_LENGTH)
        ?? safeToken(operation.op, NAME_PATTERN, MAX_NAME_LENGTH)
        ?? 'inconnu',
      state: operation.terminal ? 'rejected' : 'pending',
      ...(queuedAt ? { queuedAt } : {}),
      attemptCount: safeCount(operation.attemptCount),
      ...(sameFailureCount !== undefined ? { sameFailureCount: safeCount(sameFailureCount) } : {}),
      ...(failureClass ? { failureClass } : {}),
      ...(failureGroup ? { failureGroup } : {}),
      ...(terminalStatus ? { terminalStatus } : {}),
    };
  });

  const oldestPending = oldestQueuedAt(pendingOperations);

  return {
    generatedAt: environment.generatedAt,
    app: {
      version: environment.appVersion,
      build: environment.buildNumber,
      platform: environment.platform,
      // Bornes de longueur : ces valeurs viennent d'un module natif, on ne leur
      // fait pas plus confiance qu'aux champs d'une operation.
      updateId: safeToken(environment.updateId, ID_PATTERN, MAX_ID_LENGTH) ?? null,
      updateCreatedAt: safeIsoDate(environment.updateCreatedAt) ?? null,
      channel: safeToken(environment.channel, NAME_PATTERN, MAX_NAME_LENGTH) ?? null,
      runtimeVersion: safeToken(environment.runtimeVersion, ID_PATTERN, MAX_ID_LENGTH) ?? null,
      embeddedLaunch: typeof environment.embeddedLaunch === 'boolean'
        ? environment.embeddedLaunch
        : null,
    },
    connectivity: {
      online: environment.isOnline,
      backendReachable: environment.backendReachable ?? null,
      syncStatus: environment.syncStatus ?? 'unknown',
      authBlocked: Boolean(environment.syncAuthBlocked),
    },
    queue: {
      pending: counts.pending,
      rejected: counts.rejected,
      stuck: counts.stuck,
      attention: counts.attention,
      // Une vieille operation deja refusee masquait l'age reel de la plus
      // ancienne operation encore rejouable : les deux sont desormais distincts.
      oldestPendingQueuedAt: oldestPending,
      oldestPendingAgeMinutes: oldestPending
        ? ageInMinutes(oldestPending, environment.generatedAt)
        : null,
      oldestRejectedQueuedAt: oldestQueuedAt(rejectedOperations),
      lastAttemptAt: environment.lastAttemptAt ?? null,
      lastOperationSuccessAt: environment.lastOperationSuccessAt ?? null,
      lastQueueDrainedAt: environment.lastQueueDrainedAt ?? null,
      nextAttemptAt: environment.nextAttemptAt ?? null,
    },
    historicalVisitRecovery: safeHistoricalVisitRecovery(environment.historicalVisitRecovery),
    operations,
    omittedOperations: Math.max(0, queue.length - operations.length),
  };
}

/** Rendu texte copiable, sans dependance de plateforme. */
export function formatSyncDiagnosticReport(report: SyncDiagnosticReport): string {
  const backend = report.connectivity.backendReachable === null
    ? 'inconnu'
    : report.connectivity.backendReachable ? 'joignable' : 'injoignable';

  const lines: string[] = [
    'BuildTrack — diagnostic de synchronisation',
    `Genere le            : ${report.generatedAt}`,
    `Application          : ${report.app.version} (build ${report.app.build ?? 'n/a'}) — ${report.app.platform}`,
    `Bundle               : ${report.app.embeddedLaunch === null
      ? 'inconnu'
      : report.app.embeddedLaunch ? 'embarque dans l APK (aucune OTA appliquee)' : 'mise a jour OTA'}`,
    `Mise a jour          : ${report.app.updateId ?? 'n/a'}`
      + (report.app.updateCreatedAt ? ` publiee le ${report.app.updateCreatedAt}` : ''),
    `Canal / runtime      : ${report.app.channel ?? 'n/a'} / ${report.app.runtimeVersion ?? 'n/a'}`,
    `Connectivite         : ${report.connectivity.online ? 'en ligne' : 'hors connexion'} | backend ${backend}`,
    `Etat sync            : ${report.connectivity.syncStatus}`
      + (report.connectivity.authBlocked ? ' (authentification bloquee)' : ''),
    `Recuperation visite  : ${report.historicalVisitRecovery.evaluated
      ? `${report.historicalVisitRecovery.candidateCount} candidate(s), ${report.historicalVisitRecovery.plannedCount} planifiee(s)`
        + ` | org profil ${report.historicalVisitRecovery.profileOrganizationAvailable ? 'oui' : 'non'}`
        + ` | secours file ${report.historicalVisitRecovery.queuedOrganizationFallbackCount}`
      : 'non evaluee'}`,
    `Preuves recuperation : ${report.historicalVisitRecovery.evaluated
      ? `creations ${report.historicalVisitRecovery.evidence.createReserveOperationCount}, liens ${report.historicalVisitRecovery.evidence.linkOperationCount}`
        + ` | refs historiques ${report.historicalVisitRecovery.evidence.legacyVisitReferenceCount}`
        + ` | erreurs visite ${report.historicalVisitRecovery.evidence.missingVisitFailureCount}, FK 23503 ${report.historicalVisitRecovery.evidence.foreignKeyFailureCount}`
        + ` | FK terminales ${report.historicalVisitRecovery.evidence.terminalForeignKeyRecoveryCount}, contradictoires ${report.historicalVisitRecovery.evidence.foreignKeyContradictionCount}`
        + ` | correlations ${report.historicalVisitRecovery.evidence.reserveLinkCorrelationCount}, ambigues ${report.historicalVisitRecovery.evidence.ambiguousReserveLinkCount}`
      : 'n/a'}`,
    '',
    `File                 : ${report.queue.pending} en attente, ${report.queue.rejected} refusees,`
      + ` ${report.queue.stuck} bloquees`,
    `Plus ancienne attente: ${report.queue.oldestPendingQueuedAt ?? 'n/a'}`
      + (report.queue.oldestPendingAgeMinutes !== null ? ` (${report.queue.oldestPendingAgeMinutes} min)` : ''),
    `Plus ancien refus    : ${report.queue.oldestRejectedQueuedAt ?? 'n/a'}`,
    `Derniere tentative   : ${report.queue.lastAttemptAt ?? 'n/a'}`,
    `Derniere op reussie  : ${report.queue.lastOperationSuccessAt ?? 'n/a'}`,
    `File videe le        : ${report.queue.lastQueueDrainedAt ?? 'n/a'}`,
    `Prochaine tentative  : ${report.queue.nextAttemptAt ?? 'n/a'}`,
    '',
    'Operations :',
  ];

  const recoveryBlocks = HISTORICAL_VISIT_RECOVERY_SKIP_REASONS
    .map(reason => ({ reason, count: report.historicalVisitRecovery.skippedReasons[reason] ?? 0 }))
    .filter(item => item.count > 0);
  if (recoveryBlocks.length > 0) {
    lines.splice(
      lines.indexOf('Operations :'),
      0,
      `Blocages recuperation: ${recoveryBlocks.map(item => `${item.reason} x${item.count}`).join(', ')}`,
      '',
    );
  }

  if (report.operations.length === 0) {
    lines.push('  (aucune)');
  } else {
    for (const operation of report.operations) {
      lines.push(
        `  ${operation.id} | ${operation.domain} | ${operation.operation} | ${operation.state}`
        + ` | tentatives ${operation.attemptCount}`
        + (operation.sameFailureCount !== undefined ? ` | meme echec x${operation.sameFailureCount}` : '')
        + (operation.failureClass ? ` | ${operation.failureClass}` : '')
        + (operation.failureGroup ? ` | groupe ${operation.failureGroup}` : ''),
      );
    }
  }

  if (report.omittedOperations > 0) {
    lines.push(`  … ${report.omittedOperations} operation(s) non detaillee(s), incluses dans les compteurs.`);
  }

  return lines.join('\n');
}
