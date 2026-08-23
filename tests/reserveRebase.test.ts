import { describe, expect, it, vi } from 'vitest';
import { rebaseReservePatchOnConflict } from '../lib/reserveRebase';
import type { SupabaseRestMeta, SupabaseRestResult } from '../lib/supabaseRest';

const OK_META: SupabaseRestMeta = { status: 200, reachedServer: true, retryAfter: null };
const NO_RESPONSE_META: SupabaseRestMeta = { status: null, reachedServer: false, retryAfter: null };

const restResult = <T,>(over: Partial<SupabaseRestResult<T>>): SupabaseRestResult<T> => ({
  data: null,
  error: null,
  meta: OK_META,
  ...over,
});

/** Conflit initial SANS `current_version` : c'est ce qui declenche le SELECT. */
const CONFLICT_WITHOUT_VERSION = { status: 'version_conflict', reserve_id: 'r-1' } as const;

function rebase(over: {
  selectVersion?: (reserveId: string, signal?: AbortSignal) => Promise<SupabaseRestResult<any>>;
  applyPatch?: (params: any, signal?: AbortSignal) => Promise<SupabaseRestResult<any>>;
  conflict?: Record<string, unknown>;
  signal?: AbortSignal;
  beforeApply?: (prepared: any) => Promise<void>;
} = {}) {
  const selectVersion = vi.fn(over.selectVersion ?? (async () => restResult({ data: [{ version: 7 }] })));
  const applyPatch = vi.fn(over.applyPatch ?? (async () => restResult({ data: [{ status: 'ok' }] })));
  const beforeApply = vi.fn(over.beforeApply ?? (async () => {}));
  let counter = 0;
  const newOperationId = vi.fn(() => `op-${(counter += 1)}`);

  return {
    selectVersion,
    applyPatch,
    beforeApply,
    newOperationId,
    run: () => rebaseReservePatchOnConflict(
      {
        reserveId: 'r-1',
        patch: { title: 'x' },
        conflict: (over.conflict ?? CONFLICT_WITHOUT_VERSION) as never,
        queueEntryId: 'entry-1',
      },
      { selectVersion, applyPatch, newOperationId, beforeApply, signal: over.signal },
    ),
  };
}

describe('the version SELECT is not allowed to fail silently', () => {
  it('sends no second RPC when the read is rate limited', async () => {
    // Le SELECT ignorait `error` et `meta` : une limitation laissait
    // `currentVersion` a null et envoyait quand meme l'ecriture — une requete
    // de plus pendant la limitation, et le `Retry-After` perdu.
    const harness = rebase({
      selectVersion: async () => restResult({
        error: { status: 429, message: 'HTTP 429' },
        meta: { status: 429, reachedServer: true, retryAfter: '120' },
      }),
    });

    const result = await harness.run();

    expect(harness.applyPatch).not.toHaveBeenCalled();
    expect(result.kind).toBe('retry_transport');
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    // L'echeance du serveur traverse : c'est elle qui pilotera l'abandon backend.
    expect(result.meta.retryAfter).toBe('120');
    expect(result.meta.status).toBe(429);
    expect((result.error as any).status).toBe(429);
    // Aucune version devinee : l'ecriture aurait pu partir avec `null`.
    expect(result.baseVersion).toBeNull();
  });

  it('sends no second RPC when the link is cut', async () => {
    const harness = rebase({
      selectVersion: async () => restResult({
        error: { code: 'REST_TIMEOUT', message: 'timeout' },
        meta: NO_RESPONSE_META,
      }),
    });

    const result = await harness.run();

    expect(harness.applyPatch).not.toHaveBeenCalled();
    expect(result.kind).toBe('retry_transport');
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    expect(result.meta.reachedServer).toBe(false);
    expect(result.baseVersion).toBeNull();
  });

  it('still writes when the read succeeds, using the version it read', async () => {
    // Verrou sur la premisse : sans lui, ne jamais ecrire ferait passer les
    // deux tests precedents sans rien prouver.
    const harness = rebase();
    const result = await harness.run();

    expect(harness.selectVersion).toHaveBeenCalledTimes(1);
    expect(harness.applyPatch.mock.calls[0][0]).toMatchObject({ baseVersion: 7 });
    expect(result.kind).toBe('applied');
  });

  it('skips the read entirely when the conflict already carries the version', async () => {
    const harness = rebase({ conflict: { status: 'version_conflict', current_version: 12 } });
    await harness.run();

    expect(harness.selectVersion).not.toHaveBeenCalled();
    expect(harness.applyPatch.mock.calls[0][0]).toMatchObject({ baseVersion: 12 });
  });
});

describe('no idempotent identity is burned without a write', () => {
  it('consumes none when the version read fails', async () => {
    // L'identifiant n'est utile qu'au second RPC. Le generer avant la lecture
    // brulait une identite pour une ecriture jamais envoyee, et changeait
    // l'identite de l'operation sans contrepartie.
    const harness = rebase({
      selectVersion: async () => restResult({ error: { status: 503 }, meta: OK_META }),
    });

    const result = await harness.run();

    expect(harness.newOperationId).not.toHaveBeenCalled();
    expect(result.kind).toBe('retry_transport');
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    expect(result.operationId).toBeNull();
  });

  it('consumes exactly one when the write is actually sent', async () => {
    const harness = rebase();
    await harness.run();

    expect(harness.newOperationId).toHaveBeenCalledTimes(1);
    expect(harness.applyPatch.mock.calls[0][0]).toMatchObject({ operationId: 'op-1' });
  });
});

describe('a preempted pass sends nothing', () => {
  it('reads nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = rebase({ signal: controller.signal });
    const result = await harness.run();

    expect(harness.selectVersion).not.toHaveBeenCalled();
    expect(harness.applyPatch).not.toHaveBeenCalled();
    expect(result.kind).toBe('retry_transport');
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    // Classee `cancelled` par la politique : aucune tentative consommee.
    expect((result.error as any).code).toBe('REST_ABORTED');
    expect(result.operationId).toBeNull();
  });

  it('writes nothing when the pass is preempted during the read', async () => {
    const controller = new AbortController();
    const harness = rebase({
      signal: controller.signal,
      selectVersion: async () => {
        controller.abort();
        return restResult({ data: [{ version: 7 }] });
      },
    });

    const result = await harness.run();

    expect(harness.selectVersion).toHaveBeenCalledTimes(1);
    // Une ecriture partie apres la preemption serait rejouee par la generation
    // suivante — deux fois le meme mouvement de stock.
    expect(harness.applyPatch).not.toHaveBeenCalled();
    expect(harness.newOperationId).not.toHaveBeenCalled();
    expect((result as any).error.code).toBe('REST_ABORTED');
  });

  it('still writes when no signal is aborted', async () => {
    // Verrou sur la premisse : sans lui, ne jamais ecrire ferait passer les
    // deux tests precedents sans rien prouver.
    const harness = rebase({ signal: new AbortController().signal });
    await harness.run();

    expect(harness.applyPatch).toHaveBeenCalledTimes(1);
  });

  it('hands the signal to BOTH requests, not just to the guard between them', async () => {
    // Une garde entre les etapes empeche de DEMARRER une requete apres la
    // preemption ; elle n'interrompt pas celle qui est deja en vol. Un SELECT
    // bloque continuerait jusqu'a sa reponse ou son delai d'attente.
    const controller = new AbortController();
    const harness = rebase({ signal: controller.signal });
    await harness.run();

    expect(harness.selectVersion.mock.calls[0]).toEqual(['r-1', controller.signal]);
    expect(harness.applyPatch.mock.calls[0][1]).toBe(controller.signal);
  });

  /** Requete qui ne se resout QUE lorsque son signal est annule. */
  const abortableCall = () => vi.fn((...args: any[]) => {
    const signal: AbortSignal | undefined = args[args.length - 1];
    return new Promise<SupabaseRestResult<any>>(resolve => {
      signal?.addEventListener('abort', () => resolve(restResult({
        error: { code: 'REST_ABORTED', message: 'aborted' },
        meta: NO_RESPONSE_META,
      })), { once: true });
    });
  });

  it('aborts a SELECT already in flight', async () => {
    // Les tests precedents prouvent le CABLAGE. Celui-ci prouve l'annulation :
    // sans le signal transmis, cette promesse ne se resoudrait jamais et le
    // test expirerait.
    const controller = new AbortController();
    const selectVersion = abortableCall();
    const harness = rebase({ signal: controller.signal, selectVersion });

    const pending = harness.run();
    controller.abort();
    const result = await pending;

    expect(selectVersion).toHaveBeenCalledTimes(1);
    expect(harness.applyPatch).not.toHaveBeenCalled();
    expect(result.kind).toBe('retry_transport');
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    expect((result.error as any).code).toBe('REST_ABORTED');
  });

  it('aborts a write already in flight', async () => {
    const controller = new AbortController();
    const applyPatch = abortableCall();
    const harness = rebase({ signal: controller.signal, applyPatch });

    const pending = harness.run();
    // L'ecriture ne part qu'apres la lecture : on laisse la micro-tache passer.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const result = await pending;

    expect(applyPatch).toHaveBeenCalledTimes(1);
    expect((result as any).error.code).toBe('REST_ABORTED');
    // Meme identifiant : si le serveur a malgre tout commite, il rendra son
    // resultat memorise plutot que d'ecrire deux fois.
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    expect(result.operationId).toBe('op-1');
  });

  it('lets an in-flight abort surface as a transport failure', async () => {
    // Le transport rend `REST_ABORTED` : la politique le classe `cancelled`,
    // donc aucune tentative n'est consommee.
    const controller = new AbortController();
    const harness = rebase({
      signal: controller.signal,
      applyPatch: async () => restResult({
        error: { code: 'REST_ABORTED', message: 'aborted' },
        meta: NO_RESPONSE_META,
      }),
    });

    const result = await harness.run();

    expect(result.kind).toBe('retry_transport');
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    expect((result.error as any).code).toBe('REST_ABORTED');
    // Meme identifiant : si l'ecriture a malgre tout abouti, le serveur rendra
    // son resultat memorise.
    expect(result.operationId).toBe('op-1');
  });
});

describe('the prepared identity is durable before the write leaves', () => {
  it('persists the preparation BEFORE calling the write', async () => {
    // Sans cet ordre : le serveur applique le patch sous `op-1`, la reponse se
    // perd, et la generation suivante repart de l'ancien identifiant. Elle en
    // genere un troisieme et rejoue la MEME ecriture metier — un mouvement de
    // stock compte deux fois.
    const order: string[] = [];
    const harness = rebase({
      // La persistance rend la main APRES un tour de boucle : sans `await`, le
      // corps synchrone d'une fonction async s'executerait quand meme en
      // premier, et le test ne prouverait rien.
      beforeApply: async () => {
        await Promise.resolve();
        await Promise.resolve();
        order.push('persist');
      },
      applyPatch: async () => { order.push('write'); return restResult({ data: [{ status: 'ok' }] }); },
    });

    await harness.run();

    expect(order).toEqual(['persist', 'write']);
    expect(harness.beforeApply.mock.calls[0][0]).toEqual({
      queueEntryId: 'entry-1',
      operationId: 'op-1',
      baseVersion: 7,
    });
  });

  it('sends nothing when the preparation cannot be persisted', async () => {
    // Mieux vaut rejouer le conflit que perdre la trace d'une ecriture partie.
    const harness = rebase({
      beforeApply: async () => { throw new Error('AsyncStorage indisponible'); },
    });

    const result = await harness.run();

    expect(harness.applyPatch).not.toHaveBeenCalled();
    expect(result.kind).toBe('retry_transport');
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    // Rien n'a ete ecrit NI persiste : l'operation garde son identite.
    expect(result.operationId).toBeNull();
    expect((result.error as Error).message).toContain('AsyncStorage');
  });

  it('sends nothing when the pass is preempted after the preparation', async () => {
    const controller = new AbortController();
    const harness = rebase({
      signal: controller.signal,
      beforeApply: async () => { controller.abort(); },
    });

    const result = await harness.run();

    expect(harness.beforeApply).toHaveBeenCalledTimes(1);
    expect(harness.applyPatch).not.toHaveBeenCalled();
    expect(result.kind).toBe('retry_transport');
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    // Annulation SAINE : l'identite preparee est deja durable, la generation
    // suivante la retrouvera au lieu d'en fabriquer une troisieme.
    expect(result.operationId).toBe('op-1');
    expect((result.error as any).code).toBe('REST_ABORTED');
  });

  it('consumes one identity per preparation, never more', async () => {
    const harness = rebase();
    await harness.run();

    expect(harness.newOperationId).toHaveBeenCalledTimes(1);
    expect(harness.beforeApply).toHaveBeenCalledTimes(1);
  });

  it('prepares nothing when the version read already failed', async () => {
    const harness = rebase({
      selectVersion: async () => restResult({ error: { status: 503 }, meta: OK_META }),
    });

    await harness.run();

    expect(harness.beforeApply).not.toHaveBeenCalled();
    expect(harness.newOperationId).not.toHaveBeenCalled();
  });
});

describe('the second call keeps transport and verdict apart', () => {
  it('reports a transport failure with its error and metadata', async () => {
    const harness = rebase({
      applyPatch: async () => restResult({
        error: { status: 503, message: 'HTTP 503' },
        meta: { status: 503, reachedServer: true, retryAfter: null },
      }),
    });

    const result = await harness.run();

    expect(result.kind).toBe('retry_transport');
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    expect(result.meta.status).toBe(503);
    // Meme identifiant : si l'ecriture a abouti, le serveur rend son resultat
    // memorise plutot que d'ecrire deux fois.
    expect(result.operationId).toBe('op-1');
  });

  it('reports a second version conflict as its own outcome, with a fresh id', async () => {
    const harness = rebase({
      applyPatch: async () => restResult({ data: [{ status: 'version_conflict', current_version: 9 }] }),
    });

    const result = await harness.run();

    expect(result.kind).toBe('retry_conflict');
    if (result.kind !== 'retry_conflict') throw new Error('issue inattendue');
    expect(result.baseVersion).toBe(9);
    // Identifiant NEUF : l'ancien porte desormais le conflit memorise, le
    // rejouer renverrait ce conflit indefiniment.
    expect(result.operationId).toBe('op-2');
  });

  it('carries the transport metadata on a terminal refusal', async () => {
    const harness = rebase({
      applyPatch: async () => restResult({
        data: [{ status: 'forbidden', message: 'refuse' }],
        meta: { status: 200, reachedServer: true, retryAfter: null },
      }),
    });

    const result = await harness.run();

    expect(result.kind).toBe('terminal');
    if (result.kind !== 'terminal') throw new Error('issue inattendue');
    expect(result.status).toBe('forbidden');
    // Sans elle, la serie de pannes n'etait pas rompue alors que le serveur
    // venait de rendre un verdict.
    expect(result.meta.reachedServer).toBe(true);
  });

  it.each([
    ['reponse vide', [] as any[]],
    ['ligne sans statut', [{ reserve_id: 'r-1' }]],
    ['statut inconnu', [{ status: 'peut_etre' }]],
    ['statut non textuel', [{ status: 42 }]],
  ])('never turns %s into a success', async (_label, data) => {
    // Une absence de verdict n'est ni un succes ni un refus. La declarer
    // `applied` retirerait de la file une ecriture dont on ignore le sort —
    // exactement le defaut deja corrige cote inventaire.
    const harness = rebase({ applyPatch: async () => restResult({ data }) });

    const result = await harness.run();

    expect(result.kind).toBe('retry_transport');
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    expect((result.error as any).code).toBe('REST_RESULT_INVALID');
    // L'ecriture EST partie : on garde son identite idempotente, sinon le
    // reessai en creerait une seconde.
    expect(result.operationId).toBe('op-1');
  });

  it('still accepts a well-formed success', async () => {
    // Verrou sur la premisse : tout refuser ferait passer le test ci-dessus
    // sans rien prouver.
    const harness = rebase({ applyPatch: async () => restResult({ data: [{ status: 'ok' }] }) });

    expect((await harness.run()).kind).toBe('applied');
  });
});

describe('a version read that answers without a version blocks the write', () => {
  it.each([
    ['aucune ligne', [] as any[]],
    ['ligne sans version', [{ id: 'r-1' }]],
    ['version non numerique', [{ version: 'trois' }]],
    ['version fractionnaire', [{ version: 2.5 }]],
    ['version negative', [{ version: -1 }]],
  ])('sends nothing on %s', async (_label, data) => {
    // Envoyer avec `base_version: null` ferait perdre la protection optimiste.
    // On ne conclut pas non plus a une suppression : une ligne absente peut
    // venir d'une visibilite RLS inattendue, et condamner l'operation sur cette
    // base detruirait une saisie.
    const harness = rebase({ selectVersion: async () => restResult({ data }) });

    const result = await harness.run();

    expect(harness.applyPatch).not.toHaveBeenCalled();
    expect(harness.newOperationId).not.toHaveBeenCalled();
    expect(result.kind).toBe('retry_transport');
    if (result.kind !== 'retry_transport') throw new Error('issue inattendue');
    expect((result.error as any).code).toBe('REST_RESULT_INVALID');
    expect(result.operationId).toBeNull();
  });
});
