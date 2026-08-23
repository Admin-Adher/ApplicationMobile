import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SYNC_INFRA_CIRCUIT_THRESHOLD,
  SYNC_PERMANENT_FAILURE_ATTEMPTS,
  getSyncQueueCounts,
  getSyncQueueOperationDomain,
  hasReplayableQueuedOperations,
  inventoryOutcomeTranslationKey,
  isAuthenticationSyncFailure,
  isInfrastructureSyncFailure,
  isInventoryQueuedOperation,
  isPermanentSyncFailure,
  assessPermanentFailure,
  shouldAbandonPassAfterInfrastructureFailure,
  syncFailureFingerprint,
  syncFailureReachedServer,
} from '../lib/syncQueuePolicy';

describe('sync queue policy', () => {
  it('does not count deterministic server rejections as pending work', () => {
    const queue = [
      { terminal: true, terminalStatus: 'insufficient_stock', attemptCount: 1 },
      { terminal: false, attemptCount: 0 },
      { attemptCount: 3 },
    ];

    expect(getSyncQueueCounts(queue)).toEqual({
      pending: 2,
      rejected: 1,
      stuck: 1,
      attention: 2,
    });
  });

  it('does not retry a queue containing only terminal failures', () => {
    expect(hasReplayableQueuedOperations([
      { terminal: true },
      { terminal: true, attemptCount: 4 },
    ])).toBe(false);

    expect(hasReplayableQueuedOperations([
      { terminal: true },
      { attemptCount: 4 },
    ])).toBe(true);
  });

  it('recognizes operation domains and only localizes inventory outcomes', () => {
    const inventory = {
      rpc: { fn: 'record_inventory_movement' },
      terminalStatus: 'insufficient_stock',
    };
    const reserve = {
      table: 'reserves',
      rpc: { fn: 'append_reserve_status_event' },
      terminalStatus: 'forbidden',
    };

    expect(isInventoryQueuedOperation(inventory)).toBe(true);
    expect(isInventoryQueuedOperation({ rpc: { fn: 'update_inventory_product' } })).toBe(true);
    expect(isInventoryQueuedOperation({ rpc: { fn: 'create_reserve_with_photos' } })).toBe(false);
    expect(getSyncQueueOperationDomain(inventory)).toBe('inventory');
    expect(getSyncQueueOperationDomain(reserve)).toBe('reserve');
    expect(getSyncQueueOperationDomain({ table: 'site_plans' })).toBe('plan');
    expect(getSyncQueueOperationDomain({ table: 'messages' })).toBe('generic');
    expect(inventoryOutcomeTranslationKey(inventory)).toBe(
      'networkQueue.inventoryOutcome.insufficient_stock',
    );
    expect(inventoryOutcomeTranslationKey(reserve)).toBeNull();
    expect(inventoryOutcomeTranslationKey({
      ...reserve,
      terminalOutcome: { domain: 'inventory' as const, status: 'forbidden' },
    })).toBeNull();
    expect(inventoryOutcomeTranslationKey('forbidden')).toBeNull();
    expect(inventoryOutcomeTranslationKey('insufficient_stock', inventory)).toBe(
      'networkQueue.inventoryOutcome.insufficient_stock',
    );
    expect(inventoryOutcomeTranslationKey({
      ...inventory,
      terminalStatus: 'duplicate_operation_mismatch',
    })).toBe('networkQueue.inventoryOutcome.duplicate_operation_mismatch');
    expect(inventoryOutcomeTranslationKey({ ...inventory, terminalStatus: 'future_status' })).toBeNull();
  });

  it('never retries terminal outcomes and does not also count them as stuck', () => {
    const queue = [
      { terminal: true, attemptCount: 7, terminalOutcome: { domain: 'inventory' as const, status: 'duplicate_operation_mismatch' } },
      { attemptCount: 3 },
    ];

    expect(hasReplayableQueuedOperations(queue)).toBe(true);
    expect(getSyncQueueCounts(queue)).toEqual({
      pending: 1,
      rejected: 1,
      stuck: 1,
      attention: 2,
    });
  });
});

describe('sync failure classification', () => {
  it('treats deterministic server refusals as permanent', () => {
    for (const error of [
      { code: 'PGRST202', message: 'Could not find the function public.record_inventory_movement' },
      { code: '42501', message: 'permission denied for function record_inventory_movement' },
      { code: '22P02', message: 'invalid input syntax for type numeric' },
      { code: '23514', message: 'new row violates check constraint' },
      { code: 'MISSING_FILTER', message: 'filtre manquant' },
      { status: 400, message: 'HTTP 400' },
      { status: 404, message: 'HTTP 404' },
    ]) {
      expect(isPermanentSyncFailure(error)).toBe(true);
    }
  });

  it('never requalifies auth, infrastructure or ambiguous failures as permanent', () => {
    // Une session à rafraîchir, un serveur indisponible ou un conflit d'écriture
    // peuvent aboutir au réessai suivant : les requalifier détruirait la saisie.
    for (const error of [
      { status: 401, message: 'HTTP 401' },
      { code: 'PGRST301', message: 'JWT expired' },
      { code: 'REST_TIMEOUT', message: 'timeout' },
      { status: 429, message: 'HTTP 429' },
      { status: 503, message: 'HTTP 503' },
      { status: 409, message: 'HTTP 409' },
      { code: '23505', message: 'duplicate key value violates unique constraint' },
      { message: 'Network request failed' },
      { message: 'timeout after 150000ms' },
    ]) {
      expect(isPermanentSyncFailure(error)).toBe(false);
    }

    expect(isAuthenticationSyncFailure({ status: 401 })).toBe(true);
    expect(isInfrastructureSyncFailure({ code: 'REST_TIMEOUT' })).toBe(true);
  });

  /** Rejoue une séquence d'erreurs comme le ferait le moteur, opération par opération. */
  function replayFailureSequence(errors: any[]) {
    let tracking: { lastFailureFingerprint?: string; sameFailureCount?: number } = {};
    return errors.map(error => {
      const assessment = assessPermanentFailure(tracking, error);
      tracking = {
        lastFailureFingerprint: assessment.fingerprint ?? undefined,
        sameFailureCount: assessment.sameFailureCount,
      };
      return assessment;
    });
  }

  it('drops an operation only after repeated refusals with the SAME fingerprint', () => {
    const notFound = { status: 404, message: 'HTTP 404' };
    const verdicts = replayFailureSequence([notFound, notFound, notFound]);

    expect(verdicts.map(v => v.sameFailureCount)).toEqual([1, 2, 3]);
    expect(verdicts.map(v => v.terminal)).toEqual([false, false, true]);
    expect(SYNC_PERMANENT_FAILURE_ATTEMPTS).toBe(3);
  });

  it('never lets a heterogeneous sequence terminate an operation', () => {
    // Le scenario qui condamnait une saisie a tort : deux echecs transitoires
    // suffisaient a faire du premier 404 la troisieme tentative, donc terminale.
    const verdicts = replayFailureSequence([
      { code: 'REST_TIMEOUT', message: 'timeout' },
      { status: 503, message: 'HTTP 503' },
      { status: 404, message: 'HTTP 404' },
    ]);

    expect(verdicts[0]).toMatchObject({ sameFailureCount: 0, terminal: false });
    expect(verdicts[1]).toMatchObject({ sameFailureCount: 0, terminal: false });
    // Le 404 demarre sa propre serie a 1, il n'herite pas des timeouts.
    expect(verdicts[2]).toMatchObject({ sameFailureCount: 1, terminal: false });
  });

  it('restarts the streak when a different deterministic refusal appears', () => {
    const verdicts = replayFailureSequence([
      { status: 404, message: 'HTTP 404' },
      { status: 404, message: 'HTTP 404' },
      { code: '42501', message: 'permission denied' },
      { code: '42501', message: 'permission denied' },
    ]);

    expect(verdicts.map(v => v.sameFailureCount)).toEqual([1, 2, 1, 2]);
    expect(verdicts.every(v => !v.terminal)).toBe(true);
  });

  it('breaks the streak when a transient failure interrupts identical refusals', () => {
    const notFound = { status: 404, message: 'HTTP 404' };
    const verdicts = replayFailureSequence([
      notFound,
      notFound,
      { code: 'REST_TIMEOUT', message: 'timeout' },
      notFound,
    ]);

    expect(verdicts.map(v => v.sameFailureCount)).toEqual([1, 2, 0, 1]);
    expect(verdicts.every(v => !v.terminal)).toBe(true);
  });

  it('keeps fingerprints stable across volatile message fragments', () => {
    // Identifiants et durees changent a chaque essai sans changer la nature du
    // refus : ils ne doivent pas casser la serie.
    const first = syncFailureFingerprint({
      status: 404,
      message: 'reserve 3f2a1b4c-1111-2222-3333-444455556666 not found after 120ms',
    });
    const second = syncFailureFingerprint({
      status: 404,
      message: 'reserve 99887766-aaaa-bbbb-cccc-ddddeeeeffff not found after 4500ms',
    });

    expect(first).toBe(second);
    expect(syncFailureFingerprint({ status: 404, message: 'HTTP 404' })).not.toBe(first);
  });

  it('recognizes which failures prove the server answered', () => {
    // Un verdict serveur, meme negatif, prouve que le lien fonctionne.
    expect(syncFailureReachedServer({ status: 400, message: 'HTTP 400' })).toBe(true);
    expect(syncFailureReachedServer({ code: '42501', message: 'permission denied' })).toBe(true);
    expect(syncFailureReachedServer({ status: 503, message: 'HTTP 503' })).toBe(true);
    // Codes fabriques cote client et coupures de transport : aucune reponse.
    expect(syncFailureReachedServer({ code: 'REST_TIMEOUT', message: 'timeout' })).toBe(false);
    expect(syncFailureReachedServer({ code: 'MISSING_FILTER' })).toBe(false);
    expect(syncFailureReachedServer({ message: 'Network request failed' })).toBe(false);
    expect(syncFailureReachedServer({ message: 'timeout after 150000ms' })).toBe(false);
  });

  it('routes generic transport failures to the infrastructure class', () => {
    // Elles doivent alimenter le circuit reseau, jamais devenir des refus.
    for (const message of [
      'Network request failed',
      'Failed to fetch',
      'fetch failed',
      'socket hang up',
      'connect ECONNRESET 10.0.0.1:443',
      'getaddrinfo EAI_AGAIN supabase.co',
      'ENETUNREACH',
      'timeout after 150000ms',
      'The operation was aborted',
    ]) {
      expect(isInfrastructureSyncFailure({ message })).toBe(true);
      expect(isPermanentSyncFailure({ message })).toBe(false);
    }
  });
});

describe('unstable-network replay policy', () => {
  it('keeps replaying the pass while a single operation fails on infrastructure', () => {
    // Un timeout isolé ne condamne pas la passe : les opérations suivantes
    // doivent être tentées, sinon une seule avance par passe et la file
    // n'arrive jamais à se vider sur une connexion de chantier.
    for (let failures = 1; failures < SYNC_INFRA_CIRCUIT_THRESHOLD; failures += 1) {
      expect(shouldAbandonPassAfterInfrastructureFailure(failures)).toBe(false);
    }
    expect(shouldAbandonPassAfterInfrastructureFailure(SYNC_INFRA_CIRCUIT_THRESHOLD)).toBe(true);
    expect(SYNC_INFRA_CIRCUIT_THRESHOLD).toBeGreaterThan(1);
  });

  it('resets the consecutive and exponential counters as soon as one operation lands', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '..', 'context/NetworkContext.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    // Le compteur consécutif est borné par la passe, le compteur exponentiel
    // par un succès : sans cette remise à zéro le backoff restait épinglé à
    // son maximum de 5 min pendant des heures.
    expect(source).toContain('const failedOpsBefore = failedOps.length;');
    expect(source).toContain('if (failedOps.length === failedOpsBefore) {');
    expect(source).toContain('consecutiveInfraFailures = 0;');
    // Le seuil lui-meme vit desormais dans le classificateur pur, teste
    // directement ; le moteur ne fait qu'appliquer son verdict.
    expect(source).toContain('consecutiveInfraFailures = verdict.serviceFailureStreak;');
    const classifier = readFileSync(
      resolve(import.meta.dirname, '..', 'lib/syncOutcomeClassifier.ts'),
      'utf8',
    );
    expect(classifier).toContain('shouldAbandonPassAfterInfrastructureFailure(serviceFailureStreak)');

    // La branche web doit rejouer la file comme le ping natif.
    const webBranch = source.slice(
      source.indexOf("if (Platform.OS === 'web') {"),
      source.indexOf("const check = async () => {"),
    );
    expect(webBranch).toContain('hasReplayableQueuedOperations(queueRef.current)');
    expect(webBranch).toContain('processSyncQueueRef.current()');
  });
});
