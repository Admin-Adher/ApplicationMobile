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
} = {}) {
  const selectVersion = vi.fn(over.selectVersion ?? (async () => restResult({ data: [{ version: 7 }] })));
  const applyPatch = vi.fn(over.applyPatch ?? (async () => restResult({ data: [{ status: 'ok' }] })));
  let counter = 0;
  const newOperationId = vi.fn(() => `op-${(counter += 1)}`);

  return {
    selectVersion,
    applyPatch,
    newOperationId,
    run: () => rebaseReservePatchOnConflict(
      {
        reserveId: 'r-1',
        patch: { title: 'x' },
        conflict: (over.conflict ?? CONFLICT_WITHOUT_VERSION) as never,
      },
      { selectVersion, applyPatch, newOperationId, signal: over.signal },
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

  it('treats an empty result as applied rather than inventing a refusal', async () => {
    const harness = rebase({ applyPatch: async () => restResult({ data: [] }) });
    const result = await harness.run();

    expect(result.kind).toBe('applied');
  });
});
