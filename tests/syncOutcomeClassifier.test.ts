import { describe, expect, it } from 'vitest';
import {
  classifyFailureOutcome,
  formatSyncFailureMessage,
  type FailureClassificationInput,
} from '../lib/syncOutcomeClassifier';

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

function classify(overrides: Partial<FailureClassificationInput> = {}) {
  return classifyFailureOutcome({
    operation: {},
    error: new Error('quelque chose'),
    nowMs: NOW,
    jitter: 0.5,
    consecutiveServiceFailures: 0,
    circuitAlreadyOpen: false,
    ...overrides,
  });
}

describe('the retry policy is the only normative classifier', () => {
  it('follows P5 on a rate limit, not the legacy infrastructure streak', () => {
    // L ancienne politique traitait un 429 comme une panne d infrastructure et
    // n abandonnait qu au troisieme echec. P5 bloque le backend immediatement.
    const result = classify({
      error: { status: 429 },
      meta: { status: 429, retryAfter: '120' },
      jitter: 0,
    });

    expect(result.failureClass).toBe('rate_limited');
    expect(result.kind).toBe('abandon');
    expect(result.abandonReason).toBe('backend');
    expect(result.blocksCurrentPass).toBe(true);
    expect(result.contributesToCircuit).toBe(false);
    expect(Date.parse(result.nextAttemptAt!)).toBe(NOW + 120_000);
    expect(result.retrySource).toBe('retry_after');
  });

  it('covers the whole 5xx range', () => {
    // Un HTTP 500 tombait en `unknown` sous la liste fermee de l ancienne
    // politique.
    for (const status of [500, 502, 503, 599]) {
      expect(classify({ error: { status } }).failureClass, String(status)).toBe('server_unavailable');
    }
  });

  it('does not feed the circuit with a timeout that arrived after the headers', () => {
    // Depuis que la lecture du corps est bornee, un REST_TIMEOUT peut arriver
    // avec un statut 200 : le backend repond, ce n est pas une panne de lien.
    const result = classify({
      error: { code: 'REST_TIMEOUT', status: 200 },
      meta: { status: 200, reachedServer: true },
    });

    expect(result.failureClass).toBe('timeout');
    expect(result.reachedServer).toBe(true);
    expect(result.contributesToCircuit).toBe(false);
    expect(result.kind).toBe('deferred');
  });
});

describe('a cancellation consumes nothing', () => {
  it('leaves every counter and deadline untouched', () => {
    const operation = {
      attemptCount: 7,
      sameFailureCount: 2,
      nextAttemptAt: '2026-08-23T12:30:00.000Z',
      lastFailureFingerprint: '42501|403|permission denied',
    };

    const result = classify({
      operation,
      error: { code: 'REST_ABORTED', message: 'Requete aborted par l appelant' },
      cancellationReason: 'account_changed',
    });

    expect(result.kind).toBe('abandon');
    expect(result.abandonReason).toBe('preempted');
    // La passe s arrete de la meme facon, mais le diagnostic doit pouvoir
    // distinguer une preemption benigne d une file bloquee derriere un
    // changement de compte.
    expect(result.cancellationReason).toBe('account_changed');
    expect(result.incrementAttempt).toBe(false);
    expect(result.attemptCount).toBe(7);
    expect(result.sameFailureCount).toBe(2);
    expect(result.nextAttemptAt).toBe('2026-08-23T12:30:00.000Z');
    expect(result.fingerprint).toBe('42501|403|permission denied');
    expect(result.contributesToCircuit).toBe(false);
    expect(result.opensAuthCircuit).toBe(false);
    expect(result.opensServiceCircuit).toBe(false);
  });

  it('never counts as a deferred attempt', () => {
    // La renvoyer en simple `deferred` consommerait une tentative pour une
    // interruption que nous avons nous-memes demandee.
    const result = classify({ error: { code: 'REST_ABORTED' } });

    expect(result.kind).not.toBe('deferred');
    expect(result.failureClass).toBe('cancelled');
    expect(result.cancellationReason).toBe('preempted');
  });
});

describe('global scope versus local failure', () => {
  it('abandons on an authentication failure even when the circuit is already open', () => {
    // « Ouvrir le circuit maintenant » et « interrompre cette passe » sont deux
    // notions distinctes. Les confondre laissait la passe continuer d envoyer.
    const closed = classify({ error: { status: 401 } });
    expect(closed.kind).toBe('abandon');
    expect(closed.abandonReason).toBe('authentication');
    expect(closed.opensAuthCircuit).toBe(true);

    const alreadyOpen = classify({ error: { status: 401 }, circuitAlreadyOpen: true });
    expect(alreadyOpen.kind).toBe('abandon');
    expect(alreadyOpen.abandonReason).toBe('authentication');
    expect(alreadyOpen.opensAuthCircuit).toBe(false);
  });

  it('abandons only after enough consecutive service failures', () => {
    const streak = [0, 1, 2].map(consecutiveServiceFailures => classify({
      error: { status: 503 },
      consecutiveServiceFailures,
    }));

    expect(streak.map(r => r.kind)).toEqual(['deferred', 'deferred', 'abandon']);
    expect(streak[2].abandonReason).toBe('backend');
    expect(streak.map(r => r.serviceFailureStreak)).toEqual([1, 2, 3]);
  });

  it('does not feed the circuit twice when the server said when to return', () => {
    const result = classify({
      error: { status: 503 },
      meta: { status: 503, retryAfter: '60' },
      jitter: 0,
    });

    expect(result.kind).toBe('abandon');
    expect(result.blocksCurrentPass).toBe(true);
    // Le blocage de portee backend suffit : pas de double comptabilisation.
    expect(result.contributesToCircuit).toBe(false);
    expect(result.serviceFailureStreak).toBe(0);
  });

  it('resets the streak on a verdict that proves the server answers', () => {
    const result = classify({
      error: { status: 400 },
      meta: { status: 400 },
      consecutiveServiceFailures: 2,
    });

    expect(result.reachedServer).toBe(true);
    expect(result.serviceFailureStreak).toBe(0);
    expect(result.opensServiceCircuit).toBe(false);
  });
});

describe('terminal refusals', () => {
  it('honours a business refusal established by the caller', () => {
    const result = classify({
      error: { status: 400, message: 'stock insuffisant' },
      meta: { status: 400 },
      terminalStatus: 'insufficient_stock',
    });

    expect(result.kind).toBe('terminal');
    expect(result.terminalStatus).toBe('insufficient_stock');
    expect(result.inferredTerminal).toBe(false);
  });

  it('only infers a refusal on the third identical deterministic verdict', () => {
    const notFound = { status: 404, message: 'HTTP 404' };
    let operation: FailureClassificationInput['operation'] = {};
    const kinds: string[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = classify({ operation, error: notFound, meta: { status: 404 } });
      kinds.push(result.kind);
      operation = {
        attemptCount: result.attemptCount,
        lastFailureFingerprint: result.fingerprint ?? undefined,
        sameFailureCount: result.sameFailureCount,
      };
    }

    expect(kinds).toEqual(['deferred', 'deferred', 'terminal']);
  });

  it('lets a global outage outrank a refusal already recorded', () => {
    // `classifyFailureOutcome` est pur : son contrat doit tenir pour toute
    // entree. Rendre `terminal` ici laisserait la passe continuer d envoyer
    // alors que le transport est globalement en panne.
    const result = classify({
      operation: { terminal: true, terminalStatus: 'insufficient_stock' },
      error: { status: 401 },
    });

    expect(result.kind).toBe('abandon');
    expect(result.abandonReason).toBe('authentication');
    // Le refus deja acquis n est pas efface pour autant.
    expect(result.isTerminal).toBe(true);
    expect(result.terminalStatus).toBe('insufficient_stock');
  });

  it('rejects the impossible combination instead of silently picking one', () => {
    // Un refus metier vient d une ligne serveur structuree, une panne globale
    // du transport. La meme tentative ne peut pas etre les deux, et masquer
    // l un par l autre serait un choix arbitraire.
    expect(() => classify({
      error: { status: 401 },
      terminalStatus: 'forbidden',
    })).toThrow(/Invariant/);
  });
});

describe('defensive normalisation', () => {
  it('never concatenates a corrupted counter', () => {
    // `(operation.attemptCount ?? 0) + 1` sur la chaine "4" produisait "41".
    // La normalisation coerce proprement une valeur numerique — un aller-retour
    // JSON peut legitimement en produire une — et rejette le reste.
    expect(classify({ operation: { attemptCount: '4' as unknown as number } }).attemptCount).toBe(5);
    expect(classify({ operation: { attemptCount: 4 } }).attemptCount).toBe(5);
    // Valeurs impossibles : on repart de zero plutot que de propager l absurde.
    expect(classify({ operation: { attemptCount: -3 } }).attemptCount).toBe(1);
    expect(classify({ operation: { attemptCount: 2.5 } }).attemptCount).toBe(1);
    expect(classify({ operation: { attemptCount: NaN } }).attemptCount).toBe(1);
    expect(classify({ operation: { attemptCount: 'quatre' as unknown as number } }).attemptCount).toBe(1);
  });
});

describe('failure messages stay on a whitelist', () => {
  it('keeps the code, status, message, details and hint', () => {
    const message = formatSyncFailureMessage(
      { code: '42501', status: 403, message: 'permission denied', details: 'for function x', hint: 'grant it' },
      'inconnu',
    );

    expect(message).toBe('[42501] — HTTP 403 — permission denied — for function x (grant it)'
      .replace(' (grant it)', ' — grant it'));
  });

  it('lets nothing else through, whatever an SDK attached', () => {
    // `lastError` est persiste dans la file ET expose dans le diagnostic :
    // serialiser l objet entier y ferait entrer ce qu un SDK y accroche.
    const sdkError = {
      message: 'Request failed',
      code: 'ERR_BAD_REQUEST',
      config: {
        url: 'https://exemple.supabase.co/rest/v1/rpc/x?token=SECRET_SIGNE',
        headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.FUITE' },
        data: { person_name: 'Jean Dupont', comment: 'code portail 4821' },
      },
      request: { path: '/data/user/0/photos/IMG_0042.jpg' },
    };

    const message = formatSyncFailureMessage(sdkError, 'inconnu');

    for (const canary of ['SECRET_SIGNE', 'eyJhbGciOiJIUzI1NiJ9', 'Jean Dupont', 'code portail', 'IMG_0042']) {
      expect(message, canary).not.toContain(canary);
    }
    expect(message).toBe('[ERR_BAD_REQUEST] — Request failed');
  });

  it('degrades without throwing on anything else', () => {
    expect(formatSyncFailureMessage(null, 'repli')).toBe('repli');
    expect(formatSyncFailureMessage(undefined, 'repli')).toBe('repli');
    expect(formatSyncFailureMessage('texte brut', 'repli')).toBe('texte brut');
    expect(formatSyncFailureMessage({ nothing: true }, 'repli')).toBe('repli');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatSyncFailureMessage(circular, 'repli')).toBe('repli');
  });

  it('bounds every part so a hostile payload cannot bloat the queue', () => {
    const message = formatSyncFailureMessage({ message: 'x'.repeat(5000) }, 'repli');
    expect(message.length).toBeLessThanOrEqual(500);
  });
});
