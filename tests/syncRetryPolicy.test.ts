import { describe, expect, it } from 'vitest';
import {
  RETRY_AFTER_LONG_THRESHOLD_MS,
  classifySyncFailure,
  computeNextWakeAt,
  failureReachedServer,
  computeRetryDecision,
  isOperationDue,
  normalizeSameFailureCount,
  parseRetryAfter,
  selectEligibleOperationHeads,
  syncOrderingKey,
  type RetryQueueOperationLike,
} from '../lib/syncRetryPolicy';

/** Heure injectee : le module ne doit jamais lire l'horloge lui-meme. */
const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

describe('failure classification', () => {
  it('classifies a caller cancellation before any textual match', () => {
    // Le message d'une annulation contient « aborted ». Sans priorite explicite,
    // une preemption volontaire retomberait dans la classe reseau et
    // declencherait un backoff qu'elle ne merite pas.
    expect(classifySyncFailure({
      error: { code: 'REST_ABORTED', message: 'Requete aborted par l appelant' },
    })).toBe('cancelled');
  });

  it('does not let the word "aborted" override a real server verdict', () => {
    expect(classifySyncFailure({
      error: { code: '42501', status: 403, message: 'operation aborted by policy' },
    })).toBe('permanent_candidate');
    expect(classifySyncFailure({
      error: { status: 401, message: 'aborted' },
    })).toBe('authentication');
  });

  it('separates rate limiting from an infrastructure outage', () => {
    // Un 429 prouve que le backend repond : ce n'est pas une panne reseau.
    expect(classifySyncFailure({ error: { status: 429, message: 'HTTP 429' } })).toBe('rate_limited');
    expect(classifySyncFailure({ error: { status: 503, message: 'HTTP 503' } })).toBe('server_unavailable');
  });

  it('separates timeouts from transport cuts', () => {
    expect(classifySyncFailure({ error: { code: 'REST_TIMEOUT' } })).toBe('timeout');
    expect(classifySyncFailure({ error: { message: 'timeout after 150000ms' } })).toBe('timeout');
    expect(classifySyncFailure({ error: { message: 'Network request failed' } })).toBe('network');
    expect(classifySyncFailure({ error: { message: 'getaddrinfo EAI_AGAIN supabase.co' } })).toBe('network');
  });

  it('recognises auth, conflict, permanent and unknown', () => {
    expect(classifySyncFailure({ error: { code: 'PGRST301' } })).toBe('authentication');
    expect(classifySyncFailure({ error: { status: 409 } })).toBe('conflict');
    expect(classifySyncFailure({ error: { code: '23505' } })).toBe('conflict');
    expect(classifySyncFailure({ error: { code: '23503', status: 409 } })).toBe('permanent_candidate');
    expect(classifySyncFailure({ error: { code: 'PGRST202' } })).toBe('permanent_candidate');
    expect(classifySyncFailure({ error: { message: 'quelque chose d inattendu' } })).toBe('unknown');
  });

  it('reads the status from transport metadata when the error carries none', () => {
    expect(classifySyncFailure({ error: { message: 'slow down' }, meta: { status: 429 } })).toBe('rate_limited');
  });
});

describe('Retry-After parsing', () => {
  it('accepts a delay in seconds', () => {
    expect(parseRetryAfter('120', NOW)).toEqual({ delayMs: 120_000, long: false });
  });

  it('accepts an HTTP date', () => {
    const target = NOW + 90_000;
    expect(parseRetryAfter(new Date(target).toUTCString(), NOW).delayMs).toBe(90_000);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseRetryAfter('  45  ', NOW).delayMs).toBe(45_000);
  });

  it('ignores values that cannot be honoured', () => {
    for (const value of ['', '   ', 'plus tard', '-30', null, undefined]) {
      expect(parseRetryAfter(value as any, NOW).delayMs, String(value)).toBeNull();
    }
    // Zero et date deja passee : rien a attendre.
    expect(parseRetryAfter('0', NOW).delayMs).toBeNull();
    expect(parseRetryAfter(new Date(NOW - 60_000).toUTCString(), NOW).delayMs).toBeNull();
  });

  it('flags a long server delay instead of silently shortening it', () => {
    // 48 h : retenter apres 24 h reviendrait a ignorer la consigne du serveur.
    const result = parseRetryAfter(String(48 * 3600), NOW);
    expect(result.delayMs).toBe(48 * 3600 * 1000);
    expect(result.delayMs!).toBeGreaterThan(RETRY_AFTER_LONG_THRESHOLD_MS);
    expect(result.long).toBe(true);
  });

  it('honours an extreme delay rather than falling back to the client backoff', () => {
    // Ignorer une consigne de 45 jours faisait retomber sur le petit backoff
    // client : le serveur etait alors reinterroge au bout d une minute, soit
    // l inverse exact de ce qu il demandait.
    const result = parseRetryAfter(String(45 * 24 * 3600), NOW);
    expect(result.delayMs).toBe(45 * 24 * 3600 * 1000);
    expect(result.long).toBe(true);
  });

  it('rejects only a deadline that cannot be represented', () => {
    expect(parseRetryAfter(String(Number.MAX_SAFE_INTEGER), NOW).delayMs).toBeNull();
  });
});

describe('retry decision', () => {
  const decide = (error: any, extra: Partial<Parameters<typeof computeRetryDecision>[0]> = {}) =>
    computeRetryDecision({ failure: { error, meta: extra.failure?.meta }, nowMs: NOW, jitter: 0.5, ...extra });

  it('treats a cancellation as a non-event', () => {
    const decision = decide({ code: 'REST_ABORTED', message: 'aborted' });

    expect(decision.failureClass).toBe('cancelled');
    expect(decision.incrementAttempt).toBe(false);
    expect(decision.nextAttemptAt).toBeNull();
    expect(decision.contributesToCircuit).toBe(false);
    expect(decision.blocksCurrentPass).toBe(false);
    expect(decision.scope).toBe('none');
  });

  it('defers only the failing operation on an isolated timeout', () => {
    const decision = decide({ code: 'REST_TIMEOUT' });

    expect(decision.scope).toBe('operation');
    expect(decision.blocksCurrentPass).toBe(false);
    expect(decision.contributesToCircuit).toBe(true);
    expect(decision.nextAttemptAt).toBe(iso(NOW + 10_000));
  });

  it('stops the whole pass on a rate limit', () => {
    // Ne differer que l'operation courante enverrait les suivantes et
    // recolterait autant de 429 supplementaires.
    const decision = computeRetryDecision({
      failure: { error: { status: 429 }, meta: { status: 429, retryAfter: '120' } },
      nowMs: NOW,
      jitter: 0,
    });

    expect(decision.scope).toBe('backend');
    expect(decision.blocksCurrentPass).toBe(true);
    expect(decision.contributesToCircuit).toBe(false);
    expect(decision.reachedServer).toBe(true);
    expect(decision.retrySource).toBe('retry_after');
    expect(Date.parse(decision.nextAttemptAt!)).toBe(NOW + 120_000);
  });

  it('never brings a server deadline forward, and never applies negative jitter', () => {
    for (const jitter of [0, 0.25, 0.5, 0.75, 0.999]) {
      const decision = computeRetryDecision({
        failure: { error: { status: 429 }, meta: { retryAfter: '100' } },
        nowMs: NOW,
        jitter,
      });
      expect(Date.parse(decision.nextAttemptAt!)).toBeGreaterThanOrEqual(NOW + 100_000);
    }
  });

  it('keeps the later of the client backoff and the server deadline', () => {
    // Une consigne serveur courte ne doit pas annuler un backoff client devenu
    // long apres plusieurs echecs.
    const longClientBackoff = computeRetryDecision({
      failure: { error: { status: 503 }, meta: { retryAfter: '5' } },
      operation: { attemptCount: 4 },
      nowMs: NOW,
      jitter: 0.5,
    });
    expect(Date.parse(longClientBackoff.nextAttemptAt!)).toBe(NOW + 300_000);

    const longServerDeadline = computeRetryDecision({
      failure: { error: { status: 503 }, meta: { retryAfter: '600' } },
      operation: { attemptCount: 0 },
      nowMs: NOW,
      jitter: 0,
    });
    expect(Date.parse(longServerDeadline.nextAttemptAt!)).toBe(NOW + 600_000);
  });

  it('escalates the client backoff with the attempt count and caps it', () => {
    const delays = [0, 1, 2, 3, 4, 9].map(attemptCount => Date.parse(
      computeRetryDecision({
        failure: { error: { code: 'REST_TIMEOUT' } },
        operation: { attemptCount },
        nowMs: NOW,
        jitter: 0.5,
      }).nextAttemptAt!,
    ) - NOW);

    expect(delays).toEqual([10_000, 30_000, 60_000, 120_000, 300_000, 300_000]);
  });

  it('applies a deterministic symmetric jitter to client delays', () => {
    const at = (jitter: number) => Date.parse(computeRetryDecision({
      failure: { error: { code: 'REST_TIMEOUT' } },
      operation: { attemptCount: 1 },
      nowMs: NOW,
      jitter,
    }).nextAttemptAt!) - NOW;

    expect(at(0)).toBe(24_000);
    expect(at(0.5)).toBe(30_000);
    expect(at(1)).toBeCloseTo(35_999, -2);
  });

  it('marks a server verdict as reaching the server without feeding the circuit', () => {
    const decision = computeRetryDecision({
      failure: { error: { status: 400, message: 'HTTP 400' }, meta: { status: 400 } },
      nowMs: NOW,
      jitter: 0.5,
    });

    expect(decision.reachedServer).toBe(true);
    expect(decision.contributesToCircuit).toBe(false);
  });

  it('leaves conflict resolution to the existing business path', () => {
    const decision = decide({ status: 409 });

    expect(decision.failureClass).toBe('conflict');
    expect(decision.nextAttemptAt).toBeNull();
    expect(decision.contributesToCircuit).toBe(false);
  });

  it('blocks the pass on an authentication failure', () => {
    const decision = decide({ status: 401 });

    expect(decision.scope).toBe('authentication');
    expect(decision.blocksCurrentPass).toBe(true);
    expect(decision.retrySource).toBe('authentication');
  });

  it('reports a long server delay without truncating it', () => {
    const decision = computeRetryDecision({
      failure: { error: { status: 429 }, meta: { retryAfter: String(48 * 3600) } },
      nowMs: NOW,
      jitter: 0,
    });

    expect(decision.retryAfterLong).toBe(true);
    expect(Date.parse(decision.nextAttemptAt!)).toBe(NOW + 48 * 3600 * 1000);
  });
});

describe('ordering keys', () => {
  it('binds every write of one entity to a single key', () => {
    expect(syncOrderingKey({
      rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: 'P1' } } },
    })).toBe('inventory:P1');
    expect(syncOrderingKey({
      rpc: { fn: 'update_inventory_product', args: { p_product_id: 'P1' } },
    })).toBe('inventory:P1');
    expect(syncOrderingKey({
      rpc: { fn: 'create_reserve_with_photos', args: { p_reserve: { id: 'R7' } } },
    })).toBe('reserve:R7');
    expect(syncOrderingKey({
      rpc: { fn: 'apply_reserve_patch', args: { p_reserve_id: 'R7' } },
    })).toBe('reserve:R7');
    expect(syncOrderingKey({
      rpc: { fn: 'replace_site_plan_file_safely', args: { p_plan_id: 'PL3' } },
    })).toBe('plan:PL3');
  });

  it('gives one entity a single key across RPC and generic paths', () => {
    // Trois ecritures de la meme reserve. Des cles differentes auraient forme
    // des groupes distincts, et une ecriture aurait pu depasser la creation
    // dont elle depend.
    const creation = syncOrderingKey({
      rpc: { fn: 'create_reserve_with_photos', args: { p_reserve: { id: 'R7' } } },
    });
    const update = syncOrderingKey({
      table: 'reserves', op: 'update', filter: { column: 'id', value: 'R7' },
    });
    const photo = syncOrderingKey({
      table: 'photos', op: 'insert', data: { id: 'PH1', reserve_id: 'R7' },
    });

    expect(creation).toBe('reserve:R7');
    expect(update).toBe('reserve:R7');
    // Une photo hors ligne porte son rattachement dans `data`, pas dans un filtre.
    expect(photo).toBe('reserve:R7');
    expect(new Set([creation, update, photo]).size).toBe(1);
  });

  it('unifies the other entity tables too', () => {
    expect(syncOrderingKey({ table: 'inventory_products', op: 'update', filter: { column: 'id', value: 'P1' } }))
      .toBe('inventory:P1');
    expect(syncOrderingKey({ table: 'site_plans', op: 'update', filter: { column: 'id', value: 'PL1' } }))
      .toBe('plan:PL1');
    // Un insert generique rattache par son propre identifiant.
    expect(syncOrderingKey({ table: 'reserves', op: 'insert', data: { id: 'R9' } })).toBe('reserve:R9');
  });

  it('falls back conservatively rather than risk an order violation', () => {
    expect(syncOrderingKey({ table: 'reserves', op: 'insert' })).toBe('table:reserves');
    expect(syncOrderingKey({ table: 'photos', op: 'insert', data: { reserve_id: null } })).toBe('table:photos');
    expect(syncOrderingKey({})).toBe('table:inconnu');
  });
});

describe('eligible head selection', () => {
  const base: RetryQueueOperationLike[] = [
    { id: 'a1', queuedAt: '2026-08-22T10:00:00.000Z', nextAttemptAt: iso(NOW + 120_000), rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: 'A' } } } },
    { id: 'a2', queuedAt: '2026-08-22T10:05:00.000Z', rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: 'A' } } } },
    { id: 'b1', queuedAt: '2026-08-22T10:10:00.000Z', rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: 'B' } } } },
  ];

  it('lets an independent entity through while another one waits', () => {
    const heads = selectEligibleOperationHeads({ operations: base, nowMs: NOW });
    expect(heads.map(o => o.id)).toEqual(['b1']);
  });

  it('never lets a newer write overtake its deferred head', () => {
    // a2 est exigible, mais a1 — plus ancienne sur le meme produit — ne l'est
    // pas : la laisser passer corromprait le solde.
    const heads = selectEligibleOperationHeads({ operations: base, nowMs: NOW });
    expect(heads.map(o => o.id)).not.toContain('a2');
  });

  it('releases the whole group once the head becomes due', () => {
    const heads = selectEligibleOperationHeads({ operations: base, nowMs: NOW + 130_000 });
    expect(heads.map(o => o.id)).toEqual(['a1', 'b1']);
  });

  it('excludes terminal operations and treats invalid dates as due', () => {
    const heads = selectEligibleOperationHeads({
      operations: [
        { id: 'refusee', queuedAt: '2026-08-22T09:00:00.000Z', terminal: true, table: 'x' },
        { id: 'date-cassee', queuedAt: '2026-08-22T09:30:00.000Z', nextAttemptAt: 'pas-une-date', table: 'y' },
      ],
      nowMs: NOW,
    });
    expect(heads.map(o => o.id)).toEqual(['date-cassee']);
  });

  it('does not mutate the input and keeps a stable order', () => {
    const operations = [...base];
    const snapshot = operations.map(o => o.id);
    selectEligibleOperationHeads({ operations, nowMs: NOW + 200_000 });
    expect(operations.map(o => o.id)).toEqual(snapshot);

    const priority = (op: RetryQueueOperationLike) => (op.id === 'b1' ? 0 : 0);
    const heads = selectEligibleOperationHeads({ operations, nowMs: NOW + 200_000, priority });
    expect(heads.map(o => o.id)).toEqual(['a1', 'b1']);
  });

  it('honours an explicit priority before the queue date', () => {
    const heads = selectEligibleOperationHeads({
      operations: base,
      nowMs: NOW + 200_000,
      priority: op => (op.id === 'b1' ? 1 : 2),
    });
    expect(heads.map(o => o.id)).toEqual(['b1', 'a1']);
  });

  it('returns nothing for an empty queue', () => {
    expect(selectEligibleOperationHeads({ operations: [], nowMs: NOW })).toEqual([]);
  });
});

describe('next wake computation', () => {
  it('arms on the earliest useful deadline', () => {
    const wake = computeNextWakeAt({
      operations: [
        { id: 'a', table: 'x', nextAttemptAt: iso(NOW + 300_000) },
        { id: 'b', table: 'y', nextAttemptAt: iso(NOW + 45_000) },
      ],
      nowMs: NOW,
    });
    expect(wake).toBe(NOW + 45_000);
  });

  it('never schedules earlier than a global backend block', () => {
    const wake = computeNextWakeAt({
      operations: [{ id: 'a', table: 'x' }],
      nowMs: NOW,
      globalBlockUntilMs: NOW + 90_000,
    });
    expect(wake).toBe(NOW + 90_000);
  });

  it('wakes immediately when something is already due', () => {
    expect(computeNextWakeAt({
      operations: [{ id: 'a', table: 'x', nextAttemptAt: iso(NOW - 60_000) }],
      nowMs: NOW,
    })).toBe(NOW);
  });

  it('arms nothing when no replayable operation remains', () => {
    expect(computeNextWakeAt({ operations: [], nowMs: NOW })).toBeNull();
    expect(computeNextWakeAt({
      operations: [{ id: 'a', terminal: true, table: 'x' }],
      nowMs: NOW,
    })).toBeNull();
  });

  it('handles a queue where everything is in the future without busy-looping', () => {
    const wake = computeNextWakeAt({
      operations: [
        { id: 'a', table: 'x', nextAttemptAt: iso(NOW + 3_600_000) },
        { id: 'b', table: 'y', nextAttemptAt: iso(NOW + 7_200_000) },
      ],
      nowMs: NOW,
    });
    expect(wake).toBe(NOW + 3_600_000);
    expect(wake).toBeGreaterThan(NOW);
  });
});

describe('defensive normalisation', () => {
  it('clamps a corrupted same-failure counter', () => {
    expect(normalizeSameFailureCount(3)).toBe(3);
    expect(normalizeSameFailureCount(-1)).toBe(0);
    expect(normalizeSameFailureCount(1e9)).toBe(999);
    expect(normalizeSameFailureCount('trois')).toBe(0);
    expect(normalizeSameFailureCount(undefined)).toBe(0);
    expect(normalizeSameFailureCount(2.5)).toBe(0);
  });

  it('treats a missing or unreadable deadline as immediately due', () => {
    // Une donnee illisible ne doit jamais retarder indefiniment une ecriture.
    expect(isOperationDue({ table: 'x' }, NOW)).toBe(true);
    expect(isOperationDue({ table: 'x', nextAttemptAt: 'n importe quoi' }, NOW)).toBe(true);
    expect(isOperationDue({ table: 'x', nextAttemptAt: iso(NOW + 1) }, NOW)).toBe(false);
    expect(isOperationDue({ table: 'x', terminal: true }, NOW)).toBe(false);
  });
});

describe('hardened contracts', () => {
  it('answers "did the server reply" with one definition everywhere', () => {
    // Deux calculs divergents cohabitaient : la classification et la decision
    // pouvaient conclure l inverse l une de l autre sur la meme erreur.

    // Un statut HTTP prime sur un booleen contradictoire.
    expect(failureReachedServer({ status: 403 }, { reachedServer: false })).toBe(true);
    // Un code Postgres sans statut prouve quand meme une reponse.
    expect(failureReachedServer({ code: '42501' })).toBe(true);
    expect(failureReachedServer({ code: 'PGRST202' })).toBe(true);
    // Coupures et codes fabriques cote client : aucune reponse.
    expect(failureReachedServer({ code: 'ECONNRESET' })).toBe(false);
    expect(failureReachedServer({ code: 'REST_TIMEOUT' })).toBe(false);
    expect(failureReachedServer({ code: 'REST_ABORTED' })).toBe(false);
    expect(failureReachedServer({ message: 'Network request failed' })).toBe(false);
    // Le booleen de transport tranche quand rien d autre ne le fait.
    expect(failureReachedServer({ message: 'bizarre' }, { reachedServer: true })).toBe(true);
  });

  it('keeps classification and reachedServer consistent', () => {
    const cases: Array<[any, any, string, boolean]> = [
      [{ code: '42501' }, undefined, 'permanent_candidate', true],
      [{ code: 'ECONNRESET' }, undefined, 'network', false],
      [{ status: 403 }, { reachedServer: false }, 'permanent_candidate', true],
      [{ message: 'aborted' }, { reachedServer: true }, 'unknown', true],
    ];
    for (const [error, meta, expectedClass, expectedReached] of cases) {
      expect(classifySyncFailure({ error, meta }), JSON.stringify(error)).toBe(expectedClass);
      const decision = computeRetryDecision({ failure: { error, meta }, nowMs: NOW, jitter: 0.5 });
      expect(decision.reachedServer, JSON.stringify(error)).toBe(expectedReached);
    }
  });

  it('recognises system codes carried in error.code, not only in the message', () => {
    // { code: 'ECONNRESET', message: 'socket closed' } tombait en `unknown`.
    expect(classifySyncFailure({ error: { code: 'ECONNRESET', message: 'socket closed' } })).toBe('network');
    expect(classifySyncFailure({ error: { code: 'ENOTFOUND', message: '' } })).toBe('network');
    expect(classifySyncFailure({ error: { code: 'ESOCKETTIMEDOUT' } })).toBe('timeout');
  });

  it('covers the whole 5xx range and treats 408 as a timeout', () => {
    // Un HTTP 500 tombait en `unknown` faute de figurer dans une liste fermee.
    for (const status of [500, 501, 502, 503, 504, 520, 522, 524, 530, 544, 599]) {
      expect(classifySyncFailure({ error: { status } }), String(status)).toBe('server_unavailable');
    }
    expect(classifySyncFailure({ error: { status: 408 } })).toBe('timeout');
  });

  it('sees a status supplied only through transport metadata', () => {
    expect(classifySyncFailure({ error: { message: 'refuse' }, meta: { status: 400 } }))
      .toBe('permanent_candidate');
  });

  it('scales a global backoff on its own ordinal, not on the head operation', () => {
    // Deux pannes d authentification identiques doivent durer pareil, quelle
    // que soit l operation qui se trouve en tete de file.
    const withBusyOperation = computeRetryDecision({
      failure: { error: { status: 401 } },
      operation: { attemptCount: 8 },
      retryOrdinal: 0,
      nowMs: NOW,
      jitter: 0.5,
    });
    const withFreshOperation = computeRetryDecision({
      failure: { error: { status: 401 } },
      operation: { attemptCount: 0 },
      retryOrdinal: 0,
      nowMs: NOW,
      jitter: 0.5,
    });

    expect(withBusyOperation.nextAttemptAt).toBe(withFreshOperation.nextAttemptAt);
    expect(Date.parse(withBusyOperation.nextAttemptAt!) - NOW).toBe(5_000);

    // L ordinal de portee fait bien progresser le palier.
    const second = computeRetryDecision({
      failure: { error: { status: 401 } },
      retryOrdinal: 1,
      nowMs: NOW,
      jitter: 0.5,
    });
    expect(Date.parse(second.nextAttemptAt!) - NOW).toBe(15_000);
  });

  it('serialises plan revisions conservatively because they touch two identities', () => {
    // Le moteur passe p_parent_plan_id et p_new_plan.id, pas p_plan_id : une
    // cle unique n en couvrirait qu une, et une operation ciblant le nouveau
    // plan pourrait depasser la creation de sa propre revision.
    expect(syncOrderingKey({
      table: 'site_plans',
      rpc: {
        fn: 'create_site_plan_revision_with_reserve_migration',
        args: { p_parent_plan_id: 'PL1', p_new_plan: { id: 'PL2' } },
      },
    })).toBe('table:site_plans');

    // Le remplacement de fichier, lui, ne concerne qu un plan.
    expect(syncOrderingKey({
      rpc: { fn: 'replace_site_plan_file_safely', args: { p_plan_id: 'PL1' } },
    })).toBe('plan:PL1');
  });
});

describe('structured evidence outranks textual heuristics', () => {
  it('never lets network wording override a deterministic refusal', () => {
    // Le probleme trouve sur « aborted » n etait pas propre a ce mot : c est un
    // conflit general entre preuve structuree et heuristique textuelle.
    for (const message of [
      'network error while operation was rejected by policy',
      'connection terminated after refusal',
      'socket hang up',
      'failed to fetch',
      'aborted',
    ]) {
      expect(classifySyncFailure({ error: { code: '42501', status: 403, message } }), message)
        .toBe('permanent_candidate');
    }
  });

  it('still honours a timeout the server itself declared', () => {
    // 57014 et « statement timeout » viennent du serveur : ils restent valables
    // malgre une reponse HTTP.
    expect(classifySyncFailure({ error: { code: '57014', status: 400, message: 'statement timeout' } }))
      .toBe('timeout');
    expect(classifySyncFailure({ error: { status: 400, message: 'database timed out' } })).toBe('timeout');
    expect(classifySyncFailure({ error: { status: 408 } })).toBe('timeout');
  });

  it('keeps transport heuristics when nothing answered', () => {
    expect(classifySyncFailure({ error: { message: 'Network request failed' } })).toBe('network');
    expect(classifySyncFailure({ error: { code: 'ECONNRESET', message: 'socket closed' } })).toBe('network');
    expect(classifySyncFailure({ error: { message: 'timeout after 150000ms' } })).toBe('timeout');
  });

  it('does not mistake a local system code for a server reply', () => {
    // Accepter toute chaine de cinq caracteres alphanumeriques reconnaissait
    // EPERM, EBUSY, EINTR… comme preuve qu un serveur avait repondu : une erreur
    // de fichier local aurait pu remettre a zero le circuit reseau.
    for (const code of ['EPERM', 'EBUSY', 'EROFS', 'ELOOP', 'ENXIO', 'EINTR']) {
      expect(failureReachedServer({ code }), code).toBe(false);
    }
    for (const code of ['42501', '23505', 'XX000', '57014', 'PGRST202']) {
      expect(failureReachedServer({ code }), code).toBe(true);
    }
  });
});

describe('temporal robustness', () => {
  it('keeps the exact server deadline when jitter would overflow the date range', () => {
    // parseRetryAfter valide l echeance BRUTE ; le jitter pouvait la pousser
    // hors plage et faire lever toISOString().
    const nearLimit = 8.64e15 - 1000;
    const decision = computeRetryDecision({
      failure: { error: { status: 429 }, meta: { retryAfter: String(Math.floor(nearLimit / 1000)) } },
      nowMs: 0,
      jitter: 0.999,
    });

    expect(decision.nextAttemptAt).not.toBeNull();
    expect(() => new Date(decision.nextAttemptAt!).toISOString()).not.toThrow();
  });

  it('elects the head by real time, not by string comparison', () => {
    // Deux instants identiques ecrits avec des offsets differents : la
    // comparaison lexicographique elisait la mauvaise tete, donc un
    // depassement d ordre.
    const heads = selectEligibleOperationHeads({
      operations: [
        { id: 'plus-recente', table: 'photos', queuedAt: '2026-08-22T09:00:00.000Z' },
        { id: 'plus-ancienne', table: 'photos', queuedAt: '2026-08-22T11:00:00.000+03:00' },
      ],
      nowMs: NOW,
    });
    // 11:00+03:00 vaut 08:00Z : c est bien la plus ancienne.
    expect(heads.map(o => o.id)).toEqual(['plus-ancienne']);
  });

  it('falls back to persisted order when a queue date is unreadable', () => {
    const heads = selectEligibleOperationHeads({
      operations: [
        { id: 'premiere', table: 'photos', queuedAt: 'corrompue' },
        { id: 'seconde', table: 'photos', queuedAt: 'aussi-corrompue' },
      ],
      nowMs: NOW,
    });
    expect(heads.map(o => o.id)).toEqual(['premiere']);
  });
});

describe('timeout semantics after headers', () => {
  const circuitOf = (error: any, meta?: any) => computeRetryDecision({
    failure: { error, meta }, nowMs: NOW, jitter: 0.5,
  });

  it('still calls it a timeout when the headers already arrived', () => {
    // Depuis que la lecture du corps est bornee, un REST_TIMEOUT peut arriver
    // AVEC status 200. Derriere la garde `!hasServerVerdict`, il tombait en
    // `unknown`.
    expect(classifySyncFailure({ error: { code: 'REST_TIMEOUT', status: 200 } })).toBe('timeout');
    expect(classifySyncFailure({ error: { code: 'ECONNRESET', status: 200 } })).toBe('network');
  });

  it('only feeds the circuit when nothing answered', () => {
    // Un serveur parfaitement joignable ne doit pas ouvrir un circuit reseau.
    expect(circuitOf({ code: 'REST_TIMEOUT' }).contributesToCircuit).toBe(true);
    expect(circuitOf({ code: 'REST_TIMEOUT', status: 200 }).contributesToCircuit).toBe(false);
    expect(circuitOf({ status: 408 }).contributesToCircuit).toBe(false);
    expect(circuitOf({ code: '57014', status: 400, message: 'statement timeout' }).contributesToCircuit)
      .toBe(false);
    expect(circuitOf({ code: 'ECONNRESET' }).contributesToCircuit).toBe(true);
    expect(circuitOf({ code: 'REST_ABORTED' }).contributesToCircuit).toBe(false);
  });

  it('keeps counting an unavailable backend, even though it answers', () => {
    // Un serveur qui repond 503 a tout est injoignable en pratique : l exclure
    // du circuit ferait marteler un backend en panne.
    expect(circuitOf({ status: 503 }).contributesToCircuit).toBe(true);
    // Sauf s il a dit quand revenir : le blocage de portee backend suffit.
    expect(computeRetryDecision({
      failure: { error: { status: 503 }, meta: { retryAfter: '120' } },
      nowMs: NOW,
      jitter: 0.5,
    }).contributesToCircuit).toBe(false);
  });
});
