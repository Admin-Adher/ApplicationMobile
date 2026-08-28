import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  classifySyncFailure,
  type SyncFailureTransportMeta,
} from '../lib/syncRetryPolicy';
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
  isInventoryMovementOperation,
  isInventoryQueuedOperation,
  isPermanentSyncFailure,
  mustSurviveCoalescing,
  assessRepeatedPermanentFailure,
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
      purgePending: 0,
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

  it('does not dispatch or coalesce away a child waiting for its recovered parent', () => {
    const blocked = { recoveryBlockedByVisitId: 'VIS-17875223' };
    expect(hasReplayableQueuedOperations([blocked])).toBe(false);
    expect(mustSurviveCoalescing(blocked)).toBe(true);
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
      purgePending: 0,
      attention: 2,
    });
  });
});

describe('a purge awaiting reconciliation is counted apart', () => {
  it('is neither pending work nor a refusal', () => {
    // La compter « en attente » laisserait croire qu'elle repartira, alors
    // qu'elle attend une reparation locale ; la compter « refusee » suggererait
    // un verdict serveur qui n'existe pas.
    const queue = [
      { purgeState: 'pending_reconciliation', attemptCount: 4 },
      { terminal: true },
      { attemptCount: 0 },
    ];

    expect(getSyncQueueCounts(queue)).toEqual({
      pending: 1,
      rejected: 1,
      stuck: 0,
      purgePending: 1,
      attention: 2,
    });
  });

  it('is never replayed', () => {
    expect(hasReplayableQueuedOperations([{ purgeState: 'pending_reconciliation' }])).toBe(false);
  });
});

describe('a movement whose RPC name vanished is still a movement', () => {
  it('recognises it by table when no function is present', () => {
    // Le stock optimiste d'un mouvement dont `rpc.fn` a disparu doit etre annule
    // comme les autres : sans cela le cache local reste durablement decale, et
    // le filet de securite du rejet manuel ne rattrape pas le cas puisqu'il
    // exigeait la fonction exacte.
    expect(isInventoryMovementOperation({ rpc: { fn: 'record_inventory_movement' } })).toBe(true);
    expect(isInventoryMovementOperation({ table: 'inventory_movements' })).toBe(true);
    expect(isInventoryMovementOperation({ table: 'inventory_movements', rpc: {} })).toBe(true);
  });

  it('never mistakes a product write for a movement', () => {
    // Une modification de produit ne touche aucun mouvement : l'annuler comme
    // tel corromprait le stock dans l'autre sens.
    expect(isInventoryMovementOperation({ rpc: { fn: 'update_inventory_product' } })).toBe(false);
    expect(isInventoryMovementOperation({ table: 'inventory_products' })).toBe(false);
    // Elargissement volontairement etroit : une AUTRE fonction connue sur la
    // table des mouvements reste hors du champ.
    expect(isInventoryMovementOperation({
      table: 'inventory_movements',
      rpc: { fn: 'update_inventory_product' },
    })).toBe(false);
    expect(isInventoryMovementOperation({ table: 'reserves' })).toBe(false);
    expect(isInventoryMovementOperation({})).toBe(false);
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

  /**
   * Rejoue une sequence d'erreurs COMME LE FAIT le classificateur.
   *
   * La question « cet echec est-il un refus deterministe ? » appartient
   * desormais a `classifySyncFailure` seul ; `assessRepeatedPermanentFailure`
   * ne fait plus que compter les repetitions. Rejouer sans cette porte
   * testerait une composition qui n'existe plus dans le moteur.
   */
  function replayFailureSequence(
    errors: any[],
    metas: (SyncFailureTransportMeta | undefined)[] = [],
  ) {
    let tracking: { lastFailureFingerprint?: string; sameFailureCount?: number } = {};
    return errors.map((error, index) => {
      const meta = metas[index];
      const assessment = classifySyncFailure({ error, meta }) === 'permanent_candidate'
        ? assessRepeatedPermanentFailure({ operation: tracking, error, status: meta?.status ?? undefined })
        : { fingerprint: null, sameFailureCount: 0, terminal: false };
      tracking = {
        lastFailureFingerprint: assessment.fingerprint ?? undefined,
        sameFailureCount: assessment.sameFailureCount,
      };
      return assessment;
    });
  }

  it('counts identical refusals whose status lives only on the transport', () => {
    // L'ancienne evaluation ne recevait que `error` : une erreur sans statut
    // accompagnee d'un `meta.status = 404` n'etait jamais reconnue comme un
    // refus deterministe, et l'operation restait rejouable indefiniment.
    const bare = { message: 'not found' };
    const meta = { status: 404, reachedServer: true } as SyncFailureTransportMeta;
    const verdicts = replayFailureSequence([bare, bare, bare], [meta, meta, meta]);

    expect(verdicts.map(v => v.sameFailureCount)).toEqual([1, 2, 3]);
    expect(verdicts.map(v => v.terminal)).toEqual([false, false, true]);
  });

  it('bounds the error code before it enters the fingerprint', () => {
    // L'empreinte est persistee dans la file ET regroupee dans l'export : un
    // `code` arbitraire y entrait sans aucun controle de format.
    const hostile = syncFailureFingerprint({
      code: 'Jean Dupont <jean@exemple.fr> — ' + 'x'.repeat(400),
      message: 'refus',
    });

    expect(hostile).not.toContain('Jean Dupont');
    expect(hostile).not.toContain('jean@exemple.fr');
    expect(hostile.startsWith('<CODE>|')).toBe(true);
    // Un code legitime traverse intact.
    expect(syncFailureFingerprint({ code: '42501', message: 'refus' })).toContain('42501');
  });

  it('never concatenates a corrupted repetition counter', () => {
    // `(value ?? 0) + 1` sur la chaine "2" produisait "21" : l'operation
    // devenait terminale des le premier refus, puisque "21" >= 3.
    const error = { status: 404, message: 'HTTP 404' };
    const fingerprint = syncFailureFingerprint(error);
    const count = (sameFailureCount: unknown) => assessRepeatedPermanentFailure({
      operation: { lastFailureFingerprint: fingerprint, sameFailureCount } as any,
      error,
    }).sameFailureCount;

    // Une chaine numerique reste une valeur exploitable : un aller-retour JSON
    // peut legitimement en produire une.
    expect(count('2')).toBe(3);
    expect(count(2)).toBe(3);
    // Valeurs impossibles : la serie repart de zero plutot que de propager
    // l'absurde jusqu'a condamner une saisie utilisateur.
    for (const corrupted of [-1, 2.5, 'deux', NaN, Infinity, null, undefined, {}]) {
      expect(count(corrupted), String(corrupted)).toBe(1);
    }
    // Borne haute : une file gonflee ne doit pas faire deborder le compteur.
    expect(count(10_000)).toBe(999);
  });

  it('does not merge two refusals that differ only by their transport status', () => {
    // Sans le statut normalise, `{ message: 'not found' }` rendu en 404 puis en
    // 403 partageaient une empreinte : deux refus DIFFERENTS comptaient comme
    // deux repetitions du meme, et rapprochaient l'abandon definitif d'un cran
    // sans preuve.
    const bare = { message: 'not found' };
    const verdicts = replayFailureSequence(
      [bare, bare],
      [{ status: 404 } as SyncFailureTransportMeta, { status: 403 } as SyncFailureTransportMeta],
    );

    expect(verdicts.map(v => v.sameFailureCount)).toEqual([1, 1]);
    expect(verdicts[0].fingerprint).not.toBe(verdicts[1].fingerprint);
  });

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

    // Le compteur exponentiel est remis à zéro par une preuve que le backend
    // répond : sans cela le backoff restait épinglé à son maximum de 5 min
    // pendant des heures.
    //
    // Le succès est maintenant DÉCLARÉ par l'issue, non plus déduit de
    // `failedOps.length`. L'ancienne heuristique se trompait dans les deux
    // sens : une réserve écrite avec un patch photo différé était comptée en
    // échec, et un patch de commentaire malformé — abandonné sans qu'aucun
    // serveur ne soit joint — remettait le backoff à zéro.
    expect(source).toContain("if (outcome.kind === 'applied' || outcome.provesServerReachable === true) {");
    expect(source).toContain('syncInfrastructureFailureCountRef.current = 0;');
    expect(source).not.toContain('failedOps.length === failedOpsBefore');
    // La série consécutive, elle, est pliée par un module pur — voir
    // `tests/syncServiceStreak.test.ts`, qui l'éprouve vraiment.
    expect(source).toContain('consecutiveInfraFailures = nextServiceFailureStreak({');
    expect(source).not.toContain('consecutiveInfraFailures = verdict.serviceFailureStreak;');
    // Le seuil lui-meme vit desormais dans le classificateur pur, teste
    // directement ; le moteur ne fait qu'appliquer son verdict, que la boucle
    // plie ensuite avec les issues non-echec.
    expect(source).toContain('failureStreak: outcome.serviceFailureStreak,');
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

/**
 * Contrats de SOURCE sur `NetworkContext`.
 *
 * Seam de dernier recours : la boucle vit dans une fermeture React que rien ne
 * permet d'instancier en test unitaire. Ces assertions disparaitront avec la
 * conversion des 37 sorties, qui rendra le verdict observable directement.
 */
describe('the legacy loop honours a global abandon', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '..', 'context/NetworkContext.tsx'),
    'utf8',
  ).replace(/\r\n/g, '\n');

  it('stops the pass on any abandon verdict, not only when a circuit opens', () => {
    // Un 429, ou un 503 porteur d'un `Retry-After`, rend `blocksCurrentPass`
    // SANS alimenter le circuit : `opensServiceCircuit` reste volontairement
    // faux pour ne pas comptabiliser deux fois le meme blocage. Tant que les
    // 37 sorties ignorent la valeur rendue par `fail()`, cette garde est la
    // seule chose qui empeche la boucle de continuer a envoyer pendant toute
    // la limitation serveur.
    expect(source).toContain('if (circuitOpened || passMustStop) break;');
    expect(source).toContain('passMustStop = true;');
  });

  it('waits for the server deadline instead of the fixed retry delay', () => {
    // Le bloc d'apres-passe fait `syncBackoffUntilRef.current = 0` des que le
    // disjoncteur est ferme. Sans ouverture explicite, l'echeance imposee par
    // le serveur etait effacee et la file repartait au bout de 30 s.
    const abandonBranch = source.slice(
      source.indexOf("if (verdict.kind === 'abandon') {"),
      source.indexOf("if (verdict.kind === 'terminal') {"),
    );

    expect(abandonBranch).toContain("verdict.abandonReason === 'backend'");
    expect(abandonBranch).toContain('circuitOpened = true;');
    expect(abandonBranch).toContain('syncBackoffUntilRef.current = Date.now() + circuitDelayMs;');
    // Le compteur exponentiel ne doit PAS bouger : le blocage de portee backend
    // est deja porte par `blocksCurrentPass`. On ignore les commentaires, qui
    // citent legitimement le compteur pour expliquer pourquoi il reste fige.
    const codeOnly = abandonBranch
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n');
    expect(codeOnly).not.toContain('syncInfrastructureFailureCountRef');
  });

  it('writes no failure metadata when no attempt was consumed', () => {
    // Une preemption apparaissait sinon dans le diagnostic comme le dernier
    // echec de l'operation.
    const failedOperationBlock = source.slice(
      source.indexOf('const failedOperation: QueuedOperation'),
      source.indexOf('failedOps.push(failedOperation);'),
    );

    expect(failedOperationBlock).toContain('verdict.incrementAttempt');
    // Les ecritures d'echec vivent toutes DANS la branche conditionnelle.
    for (const field of ['lastError:', 'lastFailureAt:', 'attemptCount:', 'failureClass:']) {
      expect(failedOperationBlock.indexOf(field), field)
        .toBeGreaterThan(failedOperationBlock.indexOf('verdict.incrementAttempt'));
    }
  });
});
