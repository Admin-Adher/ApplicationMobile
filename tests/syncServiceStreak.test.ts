import { describe, expect, it } from 'vitest';
import { nextServiceFailureStreak } from '../lib/syncServiceStreak';
import { classifyFailureOutcome } from '../lib/syncOutcomeClassifier';

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);

/** Un timeout reseau : personne n'a repondu, la serie doit croitre. */
function timeout(current: number) {
  const verdict = classifyFailureOutcome({
    operation: {},
    error: { code: 'REST_TIMEOUT', message: 'timeout' },
    nowMs: NOW,
    consecutiveServiceFailures: current,
    circuitAlreadyOpen: false,
  });

  return nextServiceFailureStreak({ current, failureStreak: verdict.serviceFailureStreak });
}

/** Rejoue une sequence d'issues comme le fait la boucle, operation par operation. */
function replay(steps: ((current: number) => number)[]) {
  let current = 0;
  return steps.map(step => {
    current = step(current);
    return current;
  });
}

const conflict = (current: number) =>
  nextServiceFailureStreak({ current, provesServerReachable: true });

const rebaseOnServerVerdict = (current: number) =>
  nextServiceFailureStreak({ current, provesServerReachable: true });

const rebaseOnNetworkError = (current: number) =>
  nextServiceFailureStreak({ current, provesServerReachable: false });

const localRefusal = (current: number) => nextServiceFailureStreak({ current });

const applied = (current: number) => nextServiceFailureStreak({ current, applied: true });

describe('only proof that the backend answers breaks the streak', () => {
  it('breaks it on an observed status conflict', () => {
    // Le conflit arrive APRES un SELECT reussi : le serveur a bien repondu.
    expect(replay([timeout, conflict, timeout])).toEqual([1, 0, 1]);
  });

  it('breaks it on a rebase resolved by a server verdict', () => {
    // `version_conflict` est rendu par le serveur, pas deduit localement.
    expect(replay([timeout, rebaseOnServerVerdict, timeout])).toEqual([1, 0, 1]);
  });

  it('keeps it through a rebase interrupted by the network', () => {
    // Meme issue `deferred`, cause opposee : rien ne prouve que le lien marche.
    expect(replay([timeout, rebaseOnNetworkError, timeout])).toEqual([1, 1, 2]);
  });

  it('keeps it through a local refusal that contacted nobody', () => {
    // Patch malforme, fichier absent, filtre manquant : aucune requete emise.
    expect(replay([timeout, localRefusal, timeout])).toEqual([1, 1, 2]);
  });

  it('breaks it on a local refusal that FOLLOWED a server answer', () => {
    // E13, E33 et E53 refusent ou different l'operation apres une reponse
    // serveur : le RPC de plan avait abouti, le SELECT des commentaires aussi,
    // les reserves liees venaient d'etre lues. La preuve existait deja et
    // n'etait simplement pas transmise.
    //
    // C'est le meme pliage que pour un conflit — le test ci-dessus le couvre
    // deja ; ce qui se verifie ici, c'est que ces sorties portent bien le
    // drapeau, et cela se joue dans `syncLoopExitContract`.
    const proven = (current: number) => nextServiceFailureStreak({ current, provesServerReachable: true });

    expect(replay([timeout, timeout, proven, timeout])).toEqual([1, 2, 0, 1]);
  });

  it('breaks it on an accepted operation', () => {
    expect(replay([timeout, timeout, applied, timeout])).toEqual([1, 2, 0, 1]);
  });
});

describe('the failure verdict is authoritative, never reinterpreted', () => {
  it('lets a 503 keep feeding the streak although the server answered', () => {
    // Le piege exact que `provesServerReachable` evite : un 503 EST une reponse
    // serveur. Remettre la serie a zero sur « le serveur a repondu »
    // empecherait le disjoncteur de s'ouvrir sur une panne prolongee.
    const streaks = [0, 1, 2].map(current => {
      const verdict = classifyFailureOutcome({
        operation: {},
        error: { status: 503 },
        nowMs: NOW,
        consecutiveServiceFailures: current,
        circuitAlreadyOpen: false,
      });

      expect(verdict.reachedServer, 'un 503 est bien une reponse serveur').toBe(true);
      return nextServiceFailureStreak({ current, failureStreak: verdict.serviceFailureStreak });
    });

    expect(streaks).toEqual([1, 2, 3]);
  });

  it('resets on a refusal that proves the server answers', () => {
    const verdict = classifyFailureOutcome({
      operation: {},
      error: { status: 400 },
      meta: { status: 400 },
      nowMs: NOW,
      consecutiveServiceFailures: 2,
      circuitAlreadyOpen: false,
    });

    expect(nextServiceFailureStreak({ current: 2, failureStreak: verdict.serviceFailureStreak })).toBe(0);
  });

  it('prefers the verdict over any proof flag on the same outcome', () => {
    // Defense : si les deux arrivaient ensemble, le verdict d'echec gagne.
    expect(nextServiceFailureStreak({
      current: 2,
      failureStreak: 3,
      provesServerReachable: true,
      applied: true,
    })).toBe(3);
  });
});

/**
 * Le second appel du rebase passe desormais par `fail()`. On modelise ici ce
 * que la boucle en fait : le classificateur tranche, le pliage applique.
 *
 * `serverAnsweredEarlier` se traduit par une serie de depart a zero : le rebase
 * n'est atteint qu'APRES un premier `version_conflict` rendu par le serveur.
 */
function rebaseTransportFailure(error: unknown, meta: Record<string, unknown> | undefined, previous: number) {
  const verdict = classifyFailureOutcome({
    operation: {},
    error,
    meta: meta as never,
    nowMs: NOW,
    jitter: 0,
    consecutiveServiceFailures: 0,
    circuitAlreadyOpen: false,
  });

  return {
    verdict,
    streak: nextServiceFailureStreak({ current: previous, failureStreak: verdict.serviceFailureStreak }),
  };
}

describe('a rebase that fails on transport follows the policy', () => {
  it('stops the pass immediately on a rate limit, with the exact deadline', () => {
    const { verdict } = rebaseTransportFailure({ status: 429 }, { status: 429, retryAfter: '120' }, 0);

    expect(verdict.failureClass).toBe('rate_limited');
    expect(verdict.kind).toBe('abandon');
    expect(verdict.abandonReason).toBe('backend');
    expect(Date.parse(verdict.nextAttemptAt!)).toBe(NOW + 120_000);
    expect(verdict.retrySource).toBe('retry_after');
  });

  it('feeds the streak on a 503 instead of faking proof of reachability', () => {
    // Le defaut central : l'ancienne issue lisait `meta.reachedServer`, vrai
    // pour un 503, et remettait la serie a zero — alors que ce statut doit
    // precisement l'alimenter.
    const { verdict, streak } = rebaseTransportFailure({ status: 503 }, { status: 503 }, 4);

    expect(verdict.failureClass).toBe('server_unavailable');
    expect(verdict.contributesToCircuit).toBe(true);
    expect(streak).toBe(1);
  });

  it('opens the authentication scope on a 401', () => {
    const { verdict } = rebaseTransportFailure({ status: 401 }, { status: 401 }, 0);

    expect(verdict.kind).toBe('abandon');
    expect(verdict.abandonReason).toBe('authentication');
    expect(verdict.opensAuthCircuit).toBe(true);
  });

  it('restarts the streak at one after the initial server verdict', () => {
    // Ancien compteur 2, premier `version_conflict` rendu par le serveur, puis
    // coupure reseau sur le second appel : la serie repart de 1, pas de 3.
    const { streak } = rebaseTransportFailure({ code: 'REST_TIMEOUT', message: 'timeout' }, undefined, 2);

    expect(streak).toBe(1);
  });
});

describe('a corrupted counter cannot poison the circuit', () => {
  it.each([
    ['negatif', -4],
    ['fractionnaire', 2.5],
    ['NaN', Number.NaN],
    ['Infini', Number.POSITIVE_INFINITY],
    ['chaine', 'trois'],
  ])('restarts from zero on a %s current value', (_label, current) => {
    expect(nextServiceFailureStreak({ current: current as number })).toBe(0);
  });

  it('bounds a runaway streak', () => {
    expect(nextServiceFailureStreak({ current: 5, failureStreak: 10 ** 9 })).toBe(1_000);
  });

  it('coerces a numeric string, which a JSON round-trip can legitimately produce', () => {
    expect(nextServiceFailureStreak({ current: '3' as unknown as number })).toBe(3);
  });
});
