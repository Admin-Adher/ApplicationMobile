import type { ReserveMutationResult } from './reserveOutbox';
import type { SupabaseRestMeta, SupabaseRestResult } from './supabaseRest';

/**
 * Import de TYPE uniquement : `reserveOutbox` tire `expo-crypto`, donc React
 * Native, et ce module ne serait plus chargeable hors application. C'est aussi
 * pour cela que `newOperationId` est injecte plutot qu'importe.
 */
function firstRow(data: SupabaseRestResult<ReserveMutationResult>['data']): ReserveMutationResult | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  return row as ReserveMutationResult;
}

/**
 * Resolution d'un `version_conflict` sur une reserve.
 *
 * Pourquoi c'est necessaire : `apply_reserve_patch` memorise son resultat — y
 * compris un `version_conflict` — dans `reserve_outbox_operations`, indexe par
 * `operation_id`. Rejouer la MEME operation renvoie indefiniment le conflit
 * memorise, et l'operation reste coincee pour toujours.
 *
 * Les dependances sont injectees pour que ce chemin soit reellement testable :
 * il decide d'envoyer ou non une ecriture, et cette decision ne doit pas
 * dependre d'un contexte React qu'aucun test unitaire ne peut instancier.
 */

export type ReserveRebaseResult =
  | { kind: 'applied'; outcome: ReserveMutationResult }
  /**
   * Echec de TRANSPORT — coupure, 401, 429, 503, timeout. Il doit suivre la
   * politique de reessai comme n'importe quel autre echec. Le confondre avec un
   * `version_conflict` faisait contourner toute la politique : ni classe
   * d'echec, ni echeance, ni portee backend ou authentification.
   */
  | {
    kind: 'retry_transport';
    baseVersion: number | null;
    /**
     * Nouvelle identite idempotente, ou `null` quand AUCUNE n'a ete consommee.
     * Elle n'est utile qu'au second RPC : la generer avant la lecture de version
     * brulait un identifiant pour une ecriture qui n'a jamais ete envoyee, et
     * changeait l'identite de l'operation sans contrepartie.
     */
    operationId: string | null;
    error: unknown;
    meta: SupabaseRestMeta;
  }
  /** Le serveur a de nouveau rendu `version_conflict` : il repond, lui. */
  | { kind: 'retry_conflict'; baseVersion: number | null; operationId: string }
  | { kind: 'terminal'; status: string; message?: string; meta: SupabaseRestMeta };

export interface ReserveRebaseDependencies {
  /** Lecture de la version courante, quand le conflit n'en porte pas. */
  selectVersion: (reserveId: string) => Promise<SupabaseRestResult<any>>;
  /**
   * Signal de la passe. Les deux appels doivent etre interruptibles, et aucun
   * ne doit meme demarrer si la passe a deja ete preemptee : une ecriture
   * envoyee apres la preemption serait rejouee par la generation suivante.
   */
  signal?: { readonly aborted: boolean };
  applyPatch: (params: {
    operationId: string;
    reserveId: string;
    baseVersion: number | null;
    patch: Record<string, any>;
  }) => Promise<SupabaseRestResult<ReserveMutationResult>>;
  /** Injecte : ce module doit rester chargeable hors React Native. */
  newOperationId: () => string;
}

export async function rebaseReservePatchOnConflict(
  params: {
    reserveId: string;
    patch: Record<string, any>;
    conflict: ReserveMutationResult;
  },
  dependencies: ReserveRebaseDependencies,
): Promise<ReserveRebaseResult> {
  const cancelled = (): ReserveRebaseResult => ({
    kind: 'retry_transport',
    baseVersion: null,
    operationId: null,
    error: { code: 'REST_ABORTED', message: 'Rebase annule : passe preemptee.' },
    meta: { status: null, reachedServer: false, retryAfter: null },
  });

  if (dependencies.signal?.aborted) return cancelled();

  // Version courante la plus fraiche connue : celle renvoyee par le conflit,
  // sinon un SELECT direct — le conflit peut etre un resultat memorise, donc
  // potentiellement perime.
  let currentVersion: number | null =
    typeof params.conflict.current_version === 'number' ? params.conflict.current_version : null;

  if (currentVersion === null) {
    const version = await dependencies.selectVersion(params.reserveId);

    // Ce SELECT ignorait `error` et `meta` : une limitation, une panne ou une
    // coupure laissait `currentVersion` a null et envoyait QUAND MEME le second
    // RPC. Une requete de plus pendant la panne, le premier `Retry-After`
    // perdu, et un `base_version: null` capable de transformer une erreur de
    // lecture en refus rendu par l'appel suivant.
    if (version.error) {
      return {
        kind: 'retry_transport',
        baseVersion: null,
        // Aucun identifiant consomme : rien n'a ete ecrit.
        operationId: null,
        error: version.error,
        meta: version.meta,
      };
    }

    const value = version.data?.[0]?.version;
    currentVersion = typeof value === 'number' ? value : null;
  }

  // Annulation entre la lecture et l'ecriture : on ne part pas quand meme.
  if (dependencies.signal?.aborted) return cancelled();

  // L'identite idempotente n'est consommee qu'ici, juste avant l'ecriture.
  const nextOperationId = dependencies.newOperationId;
  const operationId = nextOperationId();

  const rpc = await dependencies.applyPatch({
    operationId,
    reserveId: params.reserveId,
    baseVersion: currentVersion,
    patch: params.patch,
  });

  if (rpc.error) {
    // On reutilise le meme `operation_id` : si l'ecriture a en fait abouti, le
    // serveur renverra son resultat memorise plutot que d'ecrire deux fois.
    return {
      kind: 'retry_transport',
      baseVersion: currentVersion,
      operationId,
      error: rpc.error,
      meta: rpc.meta,
    };
  }

  const outcome = firstRow(rpc.data);
  if (!outcome || outcome.status === 'ok') {
    return { kind: 'applied', outcome: outcome ?? { status: 'ok', reserve_id: params.reserveId } };
  }

  if (outcome.status === 'version_conflict') {
    // Ecriture concurrente entre le SELECT et l'apply : on reessaie avec la
    // nouvelle version et un NOUVEL `operation_id`, l'actuel etant desormais
    // memorise avec un conflit.
    return {
      kind: 'retry_conflict',
      baseVersion: typeof outcome.current_version === 'number' ? outcome.current_version : currentVersion,
      operationId: nextOperationId(),
    };
  }

  return { kind: 'terminal', status: outcome.status, message: outcome.message, meta: rpc.meta };
}
