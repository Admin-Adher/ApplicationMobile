import { describe, expect, it } from 'vitest';
import {
  buildSyncDiagnosticReport,
  formatSyncDiagnosticReport,
  type DiagnosticEnvironment,
  type DiagnosticQueuedOperation,
} from '../lib/syncDiagnosticExport';

const environment: DiagnosticEnvironment = {
  appVersion: '1.2.4',
  buildNumber: 1047,
  platform: 'android',
  generatedAt: '2026-08-22T18:30:00.000Z',
  isOnline: true,
  backendReachable: false,
  syncStatus: 'error',
  syncAuthBlocked: false,
  lastAttemptAt: '2026-08-22T18:29:30.000Z',
  lastSuccessAt: '2026-08-22T17:05:00.000Z',
  nextAttemptAt: '2026-08-22T18:30:30.000Z',
};

/** Operation realiste : payload metier complet, photo locale, donnees nominatives. */
const sensitiveOperation: DiagnosticQueuedOperation = {
  id: 'op-1',
  op: 'rpc',
  table: 'inventory_movements',
  queuedAt: '2026-08-22T18:00:00.000Z',
  attemptCount: 4,
  sameFailureCount: 2,
  lastError: '[42501] permission denied for function record_inventory_movement',
  lastFailureFingerprint: '42501|403|permission denied',
  rpc: {
    fn: 'record_inventory_movement',
    args: {
      p_operation_id: 'secret-operation-id',
      p_movement: {
        person_name: 'Jean Dupont',
        comment: 'Livraison chantier Tropicalia, code portail 4821',
        quantity: 100,
      },
      p_product: {
        designation: 'Trampa de botella',
        photo_url: 'file:///data/user/0/photos/IMG_0042.jpg',
      },
    },
  },
  data: {
    access_token: 'eyJhbGciOiJIUzI1NiJ9.super-secret-token',
    apikey: 'sb_publishable_LEAKED',
  },
} as DiagnosticQueuedOperation;

describe('sync diagnostic export', () => {
  it('never leaks credentials, payloads, photos or personal data', () => {
    const report = buildSyncDiagnosticReport([sensitiveOperation], environment);
    const serialised = `${JSON.stringify(report)}\n${formatSyncDiagnosticReport(report)}`;

    // La liste blanche doit tenir meme si l'operation grossit plus tard.
    for (const secret of [
      'eyJhbGciOiJIUzI1NiJ9',
      'super-secret-token',
      'sb_publishable_LEAKED',
      'Jean Dupont',
      'code portail 4821',
      'IMG_0042.jpg',
      'file:///data',
      'Trampa de botella',
      'secret-operation-id',
    ]) {
      expect(serialised, secret).not.toContain(secret);
    }

    // Le message d'erreur brut lui-meme peut contenir des valeurs metier : seule
    // sa nature est conservee.
    expect(serialised).not.toContain('permission denied for function');
  });

  it('keeps exactly what the support needs to act', () => {
    const report = buildSyncDiagnosticReport([sensitiveOperation], environment);

    expect(report.app).toEqual({ version: '1.2.4', build: 1047, platform: 'android' });
    expect(report.connectivity).toEqual({
      online: true,
      backendReachable: false,
      syncStatus: 'error',
      authBlocked: false,
    });

    const [operation] = report.operations;
    expect(operation.id).toBe('op-1');
    expect(operation.domain).toBe('inventory');
    // Le nom de la RPC decrit la nature de l'ecriture sans son contenu.
    expect(operation.operation).toBe('record_inventory_movement');
    expect(operation.attemptCount).toBe(4);
    expect(operation.sameFailureCount).toBe(2);
    expect(operation.failureClass).toBe('42501');
    expect(operation.failureFingerprint).toBe('42501|403|permission denied');
    expect(operation.state).toBe('pending');
  });

  it('reports queue depth and the age of the oldest operation', () => {
    const queue: DiagnosticQueuedOperation[] = [
      { id: 'a', queuedAt: '2026-08-22T18:00:00.000Z', attemptCount: 4 },
      { id: 'b', queuedAt: '2026-08-22T16:30:00.000Z', attemptCount: 0 },
      { id: 'c', queuedAt: '2026-08-22T17:00:00.000Z', terminal: true, terminalStatus: 'insufficient_stock' },
    ];

    const report = buildSyncDiagnosticReport(queue, environment);

    expect(report.queue.pending).toBe(2);
    expect(report.queue.rejected).toBe(1);
    expect(report.queue.stuck).toBe(1);
    expect(report.queue.oldestQueuedAt).toBe('2026-08-22T16:30:00.000Z');
    expect(report.queue.oldestAgeMinutes).toBe(120);
    expect(report.operations.find(o => o.id === 'c')?.state).toBe('rejected');
  });

  it('degrades gracefully on an empty or malformed queue', () => {
    const empty = buildSyncDiagnosticReport([], environment);
    expect(empty.queue.pending).toBe(0);
    expect(empty.queue.oldestQueuedAt).toBeNull();
    expect(empty.queue.oldestAgeMinutes).toBeNull();
    expect(formatSyncDiagnosticReport(empty)).toContain('(aucune)');

    const malformed = buildSyncDiagnosticReport(
      [{ queuedAt: 'pas-une-date' }, {}],
      environment,
    );
    expect(malformed.queue.oldestQueuedAt).toBeNull();
    expect(malformed.operations).toHaveLength(2);
    expect(malformed.operations[0].id).toBe('inconnu');
  });

  it('produces a report a human can read in a support ticket', () => {
    const text = formatSyncDiagnosticReport(
      buildSyncDiagnosticReport([sensitiveOperation], environment),
    );

    expect(text).toContain('1.2.4');
    expect(text).toContain('build 1047');
    expect(text).toContain('backend injoignable');
    expect(text).toContain('1 en attente');
    expect(text).toContain('record_inventory_movement');
  });
});
