import {
  getSyncQueueCounts,
  getSyncQueueOperationDomain,
  type SyncQueueOperationLike,
} from './syncQueuePolicy';

/**
 * Export de diagnostic destine au support.
 *
 * Regle de conception : LISTE BLANCHE stricte. Rien n'est serialise qui ne soit
 * explicitement choisi champ par champ. Une liste noire aurait laisse fuiter le
 * premier champ ajoute plus tard a une operation — or ces operations portent des
 * payloads metier complets, des URI de photos et parfois des identifiants
 * personnels. Le cout de l'oubli est une fuite, pas une donnee manquante.
 */

/** Operation telle qu'on accepte de la decrire dans un export. */
export interface DiagnosticQueuedOperation extends SyncQueueOperationLike {
  id?: string;
  op?: string;
  queuedAt?: string;
  lastError?: string;
  lastFailureFingerprint?: string;
  sameFailureCount?: number;
}

export interface DiagnosticEnvironment {
  appVersion: string;
  buildNumber: number | null;
  platform: string;
  /** Horodatage de generation, injecte pour rester testable. */
  generatedAt: string;
  isOnline: boolean;
  /** `null` quand l'etat du backend n'est pas connu separement d'Internet. */
  backendReachable?: boolean | null;
  syncStatus?: string;
  syncAuthBlocked?: boolean;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  nextAttemptAt?: string | null;
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
  failureFingerprint?: string;
  terminalStatus?: string;
}

export interface SyncDiagnosticReport {
  generatedAt: string;
  app: { version: string; build: number | null; platform: string };
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
    oldestQueuedAt: string | null;
    oldestAgeMinutes: number | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    nextAttemptAt: string | null;
  };
  operations: DiagnosticOperationLine[];
}

/**
 * Fragments d'un message d'erreur susceptibles de porter une donnee metier ou
 * un secret. On ne conserve QUE la nature de l'echec, jamais son contenu.
 */
function failureClassOf(operation: DiagnosticQueuedOperation): string | undefined {
  const status = operation.terminalOutcome?.status ?? operation.terminalStatus;
  if (status) return status;
  if (!operation.lastError) return undefined;
  // Un code entre crochets est prefixe par le moteur : `[42501] permission…`.
  const code = operation.lastError.match(/^\[([A-Za-z0-9_]{1,32})\]/)?.[1];
  return code ?? 'unclassified';
}

function ageInMinutes(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 60_000));
}

export function buildSyncDiagnosticReport(
  queue: readonly DiagnosticQueuedOperation[],
  environment: DiagnosticEnvironment,
): SyncDiagnosticReport {
  const counts = getSyncQueueCounts(queue as SyncQueueOperationLike[]);

  const queuedTimestamps = queue
    .map(operation => operation.queuedAt)
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort();
  const oldestQueuedAt = queuedTimestamps[0] ?? null;

  const operations: DiagnosticOperationLine[] = queue.map(operation => ({
    id: String(operation.id ?? 'inconnu'),
    domain: getSyncQueueOperationDomain(operation),
    // Le nom de la RPC ou de la table decrit la nature de l'ecriture sans en
    // reveler le contenu.
    operation: operation.rpc?.fn ?? operation.table ?? String(operation.op ?? 'inconnu'),
    state: operation.terminal ? 'rejected' : 'pending',
    ...(operation.queuedAt ? { queuedAt: operation.queuedAt } : {}),
    attemptCount: operation.attemptCount ?? 0,
    ...(operation.sameFailureCount !== undefined
      ? { sameFailureCount: operation.sameFailureCount }
      : {}),
    ...(failureClassOf(operation) ? { failureClass: failureClassOf(operation) } : {}),
    ...(operation.lastFailureFingerprint
      ? { failureFingerprint: operation.lastFailureFingerprint }
      : {}),
    ...(operation.terminalStatus ? { terminalStatus: operation.terminalStatus } : {}),
  }));

  return {
    generatedAt: environment.generatedAt,
    app: {
      version: environment.appVersion,
      build: environment.buildNumber,
      platform: environment.platform,
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
      oldestQueuedAt,
      oldestAgeMinutes: oldestQueuedAt
        ? ageInMinutes(oldestQueuedAt, environment.generatedAt)
        : null,
      lastAttemptAt: environment.lastAttemptAt ?? null,
      lastSuccessAt: environment.lastSuccessAt ?? null,
      nextAttemptAt: environment.nextAttemptAt ?? null,
    },
    operations,
  };
}

/** Rendu texte copiable/partageable, sans dependance de plateforme. */
export function formatSyncDiagnosticReport(report: SyncDiagnosticReport): string {
  const lines: string[] = [
    'BuildTrack — diagnostic de synchronisation',
    `Genere le        : ${report.generatedAt}`,
    `Application      : ${report.app.version} (build ${report.app.build ?? 'n/a'}) — ${report.app.platform}`,
    `Connectivite     : ${report.connectivity.online ? 'en ligne' : 'hors connexion'}`
      + ` | backend ${report.connectivity.backendReachable === null ? 'inconnu' : report.connectivity.backendReachable ? 'joignable' : 'injoignable'}`,
    `Etat sync        : ${report.connectivity.syncStatus}`
      + (report.connectivity.authBlocked ? ' (authentification bloquee)' : ''),
    '',
    `File             : ${report.queue.pending} en attente, ${report.queue.rejected} refusees,`
      + ` ${report.queue.stuck} bloquees`,
    `Plus ancienne    : ${report.queue.oldestQueuedAt ?? 'n/a'}`
      + (report.queue.oldestAgeMinutes !== null ? ` (${report.queue.oldestAgeMinutes} min)` : ''),
    `Derniere tentative: ${report.queue.lastAttemptAt ?? 'n/a'}`,
    `Dernier succes   : ${report.queue.lastSuccessAt ?? 'n/a'}`,
    `Prochaine tentative: ${report.queue.nextAttemptAt ?? 'n/a'}`,
    '',
    'Operations :',
  ];

  if (report.operations.length === 0) {
    lines.push('  (aucune)');
  } else {
    for (const operation of report.operations) {
      lines.push(
        `  ${operation.id} | ${operation.domain} | ${operation.operation} | ${operation.state}`
        + ` | tentatives ${operation.attemptCount}`
        + (operation.sameFailureCount !== undefined ? ` | meme echec x${operation.sameFailureCount}` : '')
        + (operation.failureClass ? ` | ${operation.failureClass}` : '')
        + (operation.failureFingerprint ? ` | ${operation.failureFingerprint}` : ''),
      );
    }
  }

  return lines.join('\n');
}
