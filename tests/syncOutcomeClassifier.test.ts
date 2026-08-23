import { describe, expect, it } from 'vitest';
import {
  classifyFailureOutcome,
  formatSyncFailureMessage,
  type FailureClassificationInput,
} from '../lib/syncOutcomeClassifier';

function classify(overrides: Partial<FailureClassificationInput> = {}) {
  return classifyFailureOutcome({
    operation: {},
    error: new Error('quelque chose'),
    consecutiveInfraFailures: 0,
    circuitAlreadyOpen: false,
    ...overrides,
  });
}

describe('the classification matrix', () => {
  it('defers a temporary failure', () => {
    for (const error of [
      { code: 'REST_TIMEOUT' },
      { message: 'Network request failed' },
      { code: 'REST_BODY_READ_FAILED', status: 200 },
      { code: 'REST_RESULT_INVALID' },
    ]) {
      const result = classify({ error });
      expect(result.kind, JSON.stringify(error)).toBe('deferred');
      expect(result.isTerminal).toBe(false);
      expect(result.terminalStatus).toBeNull();
    }
  });

  it('honours a business refusal the caller already established', () => {
    const result = classify({
      error: { message: 'stock insuffisant' },
      terminalStatus: 'insufficient_stock',
    });

    expect(result.kind).toBe('terminal');
    expect(result.terminalStatus).toBe('insufficient_stock');
    // Fourni par l appelant, pas deduit : la distinction pilote la
    // reconciliation du stock cote moteur.
    expect(result.inferredTerminal).toBe(false);
  });

  it('only infers a refusal on the third identical deterministic verdict', () => {
    const notFound = { status: 404, message: 'HTTP 404' };
    let operation: FailureClassificationInput['operation'] = {};
    const kinds: string[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = classify({ operation, error: notFound });
      kinds.push(result.kind);
      operation = {
        attemptCount: result.attemptCount,
        lastFailureFingerprint: result.fingerprint ?? undefined,
        sameFailureCount: result.sameFailureCount,
      };
    }

    expect(kinds).toEqual(['deferred', 'deferred', 'terminal']);
  });

  it('never infers a refusal from a heterogeneous sequence', () => {
    let operation: FailureClassificationInput['operation'] = {};
    for (const error of [{ code: 'REST_TIMEOUT' }, { status: 503 }, { status: 404 }]) {
      const result = classify({ operation, error });
      expect(result.kind).not.toBe('terminal');
      operation = {
        attemptCount: result.attemptCount,
        lastFailureFingerprint: result.fingerprint ?? undefined,
        sameFailureCount: result.sameFailureCount,
      };
    }
  });

  it('abandons the pass on the first authentication failure', () => {
    const result = classify({ error: { status: 401, message: 'jwt expired' } });

    expect(result.kind).toBe('abandon');
    expect(result.abandonReason).toBe('authentication');
    expect(result.opensAuthCircuit).toBe(true);
    // Une auth inutilisable condamne la passe des le premier refus : rejouer
    // chaque operation avec le meme jeton ne brulerait que des tentatives.
    expect(result.infraFailureStreak).toBe(0);
  });

  it('abandons the pass only after enough consecutive infrastructure failures', () => {
    const first = classify({ error: { status: 503 }, consecutiveInfraFailures: 0 });
    expect(first.kind).toBe('deferred');
    expect(first.infraFailureStreak).toBe(1);

    const second = classify({ error: { status: 503 }, consecutiveInfraFailures: 1 });
    expect(second.kind).toBe('deferred');

    const third = classify({ error: { status: 503 }, consecutiveInfraFailures: 2 });
    expect(third.kind).toBe('abandon');
    expect(third.abandonReason).toBe('backend');
    expect(third.opensInfraCircuit).toBe(true);
  });

  it('resets the infrastructure streak on a failure that is not one', () => {
    // Un verdict serveur prouve que le lien fonctionne : la serie repart de zero.
    const result = classify({ error: { status: 400 }, consecutiveInfraFailures: 2 });

    expect(result.infraFailureStreak).toBe(0);
    expect(result.opensInfraCircuit).toBe(false);
  });

  it('does not reopen a circuit that is already open', () => {
    const auth = classify({ error: { status: 401 }, circuitAlreadyOpen: true });
    expect(auth.opensAuthCircuit).toBe(false);
    expect(auth.kind).toBe('deferred');

    const infra = classify({ error: { status: 503 }, consecutiveInfraFailures: 5, circuitAlreadyOpen: true });
    expect(infra.opensInfraCircuit).toBe(false);
    // La serie continue de compter, meme si elle n ouvre plus rien.
    expect(infra.infraFailureStreak).toBe(6);
  });

  it('keeps a refusal terminal even when the scope would be global', () => {
    // L operation ne sera plus rejouee de toute facon ; la signaler comme
    // abandon masquerait sa cause reelle.
    const result = classify({
      error: { status: 401 },
      terminalStatus: 'forbidden',
    });

    expect(result.kind).toBe('terminal');
    expect(result.opensAuthCircuit).toBe(true);
  });

  it('keeps an operation terminal once it already was', () => {
    const result = classify({ operation: { terminal: true }, error: { code: 'REST_TIMEOUT' } });

    expect(result.isTerminal).toBe(true);
    expect(result.kind).toBe('terminal');
  });

  it('counts every attempt, whatever the verdict', () => {
    expect(classify({ operation: { attemptCount: 4 } }).attemptCount).toBe(5);
    expect(classify({ operation: {} }).attemptCount).toBe(1);
  });
});

describe('failure messages', () => {
  it('keeps the code, details and hint, which are the only usable clues', () => {
    const message = formatSyncFailureMessage(
      { message: 'permission denied', code: '42501', details: 'for function x', hint: 'grant it' },
      'inconnu',
    );

    expect(message).toBe('[42501] permission denied — for function x (grant it)');
  });

  it('degrades without throwing on anything else', () => {
    expect(formatSyncFailureMessage(null, 'repli')).toBe('repli');
    expect(formatSyncFailureMessage(undefined, 'repli')).toBe('repli');
    expect(formatSyncFailureMessage('texte brut', 'repli')).toBe('texte brut');
    expect(formatSyncFailureMessage({ nothing: true }, 'repli')).toBe('{"nothing":true}');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => formatSyncFailureMessage(circular, 'repli')).not.toThrow();
  });
});
