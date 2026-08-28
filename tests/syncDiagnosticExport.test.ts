import { describe, expect, it } from 'vitest';
import {
  MAX_EXPORTED_OPERATIONS,
  buildSyncDiagnosticReport,
  formatSyncDiagnosticReport,
  type DiagnosticEnvironment,
  type DiagnosticQueuedOperation,
} from '../lib/syncDiagnosticExport';
import { syncFailureFingerprint } from '../lib/syncQueuePolicy';

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
  lastOperationSuccessAt: '2026-08-22T18:10:00.000Z',
  lastQueueDrainedAt: '2026-08-22T17:05:00.000Z',
  nextAttemptAt: '2026-08-22T18:30:30.000Z',
};

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

    expect(serialised).not.toContain('permission denied for function');
  });

  it('never exports the raw failure fingerprint, which carries the server message', () => {
    // L'empreinte est derivee du message serveur et sa normalisation ne retire
    // que UUID, horodatages et chiffres. Un libelle produit, un nom de chantier
    // ou une adresse e-mail y survivent donc integralement.
    const realFingerprint = syncFailureFingerprint({
      code: 'PGRST204',
      status: 400,
      message: 'Produit Cable HTA chantier Opera invalide pour jean.dupont@example.com',
    });

    // Defense en profondeur : l'empreinte expurge desormais les secrets
    // reconnaissables — jeton, chemin local, adresse e-mail — avant meme d'etre
    // persistee dans la file.
    expect(realFingerprint).not.toContain('jean.dupont@example.com');

    // Verrou sur la premisse : le texte metier, lui, n'est pas un secret
    // reconnaissable et survit integralement. Si l'empreinte cessait de le
    // porter, ce test deviendrait vide sans que personne ne le remarque — et
    // c'est bien ce qui justifie l'alias local dans l'export.
    expect(realFingerprint).toContain('chantier opera');

    const report = buildSyncDiagnosticReport(
      [{ id: 'op-9', table: 'inventory_movements', lastFailureFingerprint: realFingerprint }],
      environment,
    );
    const serialised = `${JSON.stringify(report)}\n${formatSyncDiagnosticReport(report)}`;

    expect(serialised).not.toContain('jean.dupont@example.com');
    expect(serialised).not.toContain('chantier opera');
    expect(serialised).not.toContain('Cable HTA');
    expect(serialised).not.toContain(realFingerprint);
    // Seul un alias local subsiste.
    expect(report.operations[0].failureGroup).toBe('E1');
  });

  it('groups identical failures behind one local alias', () => {
    const shared = 'PGRST204|400|meme cause';
    const report = buildSyncDiagnosticReport(
      [
        { id: 'a', lastFailureFingerprint: shared },
        { id: 'b', lastFailureFingerprint: shared },
        { id: 'c', lastFailureFingerprint: 'AUTRE|500|autre cause' },
        { id: 'd' },
      ],
      environment,
    );

    const groups = Object.fromEntries(report.operations.map(o => [o.id, o.failureGroup]));
    expect(groups.a).toBe(groups.b);
    expect(groups.c).not.toBe(groups.a);
    // Sans empreinte, aucun groupe : on n'invente pas de regroupement.
    expect(groups.d).toBeUndefined();
  });

  it('refuses arbitrary strings in fields that are normally safe', () => {
    // Une file corrompue, migree ou manipulee peut porter n'importe quoi.
    const report = buildSyncDiagnosticReport(
      [{
        id: 'Jean Dupont <jean@example.com>',
        table: 'commentaire: code portail 4821',
        rpc: { fn: 'DROP TABLE inventory; --' },
        terminalStatus: 'refuse car Trampa de botella',
        attemptCount: -5,
      } as DiagnosticQueuedOperation],
      environment,
    );
    const serialised = `${JSON.stringify(report)}\n${formatSyncDiagnosticReport(report)}`;

    for (const injected of ['Jean Dupont', 'jean@example.com', 'code portail', 'DROP TABLE', 'Trampa']) {
      expect(serialised, injected).not.toContain(injected);
    }
    expect(report.operations[0].id).toBe('inconnu');
    expect(report.operations[0].operation).toBe('inconnu');
    expect(report.operations[0].attemptCount).toBe(0);
  });

  it('caps the detail and says how much it left out', () => {
    const queue: DiagnosticQueuedOperation[] = Array.from({ length: 250 }, (_, index) => ({
      id: `op-${index}`,
      table: 'reserves',
      queuedAt: new Date(Date.UTC(2026, 7, 22, 10, index)).toISOString(),
      attemptCount: index % 7,
    }));

    const report = buildSyncDiagnosticReport(queue, environment);

    expect(report.operations).toHaveLength(MAX_EXPORTED_OPERATIONS);
    expect(report.omittedOperations).toBe(250 - MAX_EXPORTED_OPERATIONS);
    // Les compteurs portent toujours sur la file entiere.
    expect(report.queue.pending).toBe(250);
    expect(formatSyncDiagnosticReport(report)).toContain('150 operation(s) non detaillee(s)');
  });

  it('details rejected and most-retried operations first when capping', () => {
    const queue: DiagnosticQueuedOperation[] = [
      ...Array.from({ length: MAX_EXPORTED_OPERATIONS }, (_, i) => ({
        id: `filler-${i}`, table: 'reserves', attemptCount: 0,
      })),
      { id: 'rejete', table: 'reserves', terminal: true, terminalStatus: 'forbidden' },
      { id: 'insistante', table: 'reserves', attemptCount: 42 },
    ];

    const report = buildSyncDiagnosticReport(queue, environment);
    const ids = report.operations.map(o => o.id);

    // Le plafond ne doit pas amputer le rapport de ce qui explique la panne.
    expect(ids).toContain('rejete');
    expect(ids).toContain('insistante');
    expect(ids[0]).toBe('rejete');
  });

  it('separates pending age from rejected age, and both success timestamps', () => {
    const queue: DiagnosticQueuedOperation[] = [
      { id: 'a', queuedAt: '2026-08-22T18:00:00.000Z', attemptCount: 4 },
      { id: 'b', queuedAt: '2026-08-22T17:30:00.000Z', attemptCount: 0 },
      // Refus ancien : ne doit plus masquer l'age reel des operations en attente.
      { id: 'c', queuedAt: '2026-08-20T09:00:00.000Z', terminal: true, terminalStatus: 'insufficient_stock' },
    ];

    const report = buildSyncDiagnosticReport(queue, environment);

    expect(report.queue.oldestPendingQueuedAt).toBe('2026-08-22T17:30:00.000Z');
    expect(report.queue.oldestPendingAgeMinutes).toBe(60);
    expect(report.queue.oldestRejectedQueuedAt).toBe('2026-08-20T09:00:00.000Z');
    expect(report.queue.lastOperationSuccessAt).toBe('2026-08-22T18:10:00.000Z');
    expect(report.queue.lastQueueDrainedAt).toBe('2026-08-22T17:05:00.000Z');
  });

  it('keeps exactly what the support needs to act', () => {
    const report = buildSyncDiagnosticReport([sensitiveOperation], environment);

    expect(report.app).toMatchObject({ version: '1.2.4', build: 1047, platform: 'android' });
    expect(report.connectivity).toEqual({
      online: true,
      backendReachable: false,
      syncStatus: 'error',
      authBlocked: false,
    });

    const [operation] = report.operations;
    expect(operation.id).toBe('op-1');
    expect(operation.domain).toBe('inventory');
    expect(operation.operation).toBe('record_inventory_movement');
    expect(operation.attemptCount).toBe(4);
    expect(operation.sameFailureCount).toBe(2);
    expect(operation.failureClass).toBe('42501');
    expect(operation.state).toBe('pending');
  });

  it('exports only enumerated historical-recovery evidence', () => {
    const report = buildSyncDiagnosticReport([], {
      ...environment,
      historicalVisitRecovery: {
        evaluated: true,
        candidateCount: 2,
        plannedCount: 1,
        profileOrganizationAvailable: false,
        queuedOrganizationFallbackCount: 1,
        skippedReasons: {
          organization_unproven: 1,
          'chantier Jean Dupont <jean@example.com>': 99,
        },
        evidence: {
          createReserveOperationCount: 1,
          linkOperationCount: 1,
          legacyVisitReferenceCount: 1,
          missingVisitFailureCount: 1,
          foreignKeyFailureCount: 1,
          reserveLinkCorrelationCount: 1,
          ambiguousReserveLinkCount: 0,
          'chantier Jean Dupont <jean@example.com>': 99,
        },
      } as any,
    });
    const text = formatSyncDiagnosticReport(report);

    expect(report.historicalVisitRecovery).toEqual({
      evaluated: true,
      candidateCount: 2,
      plannedCount: 1,
      profileOrganizationAvailable: false,
      queuedOrganizationFallbackCount: 1,
      skippedReasons: { organization_unproven: 1 },
      evidence: {
        createReserveOperationCount: 1,
        linkOperationCount: 1,
        legacyVisitReferenceCount: 1,
        missingVisitFailureCount: 1,
        foreignKeyFailureCount: 1,
        reserveLinkCorrelationCount: 1,
        ambiguousReserveLinkCount: 0,
      },
    });
    expect(text).toContain('2 candidate(s), 1 planifiee(s)');
    expect(text).toContain('creations 1, liens 1');
    expect(text).toContain('correlations 1, ambigues 0');
    expect(text).toContain('organization_unproven x1');
    expect(text).not.toContain('Jean Dupont');
    expect(text).not.toContain('jean@example.com');
  });

  it('degrades gracefully on an empty or malformed queue', () => {
    const empty = buildSyncDiagnosticReport([], environment);
    expect(empty.queue.pending).toBe(0);
    expect(empty.queue.oldestPendingQueuedAt).toBeNull();
    expect(empty.omittedOperations).toBe(0);
    expect(formatSyncDiagnosticReport(empty)).toContain('(aucune)');

    const malformed = buildSyncDiagnosticReport([{ queuedAt: 'pas-une-date' }, {}], environment);
    expect(malformed.queue.oldestPendingQueuedAt).toBeNull();
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

describe('bundle identity', () => {
  it('names the exact bundle being measured', () => {
    // `version` et `build` sont identiques sur toutes les OTA d un meme
    // runtime : un rapport terrain ne pouvait pas designer ce qu il mesurait.
    const report = buildSyncDiagnosticReport([], {
      ...environment,
      updateId: 'a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
      updateCreatedAt: '2026-08-22T21:37:00.000Z',
      channel: 'production',
      runtimeVersion: '1.2.4',
      embeddedLaunch: false,
    });

    expect(report.app.updateId).toBe('a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d');
    expect(report.app.channel).toBe('production');
    expect(report.app.embeddedLaunch).toBe(false);

    const text = formatSyncDiagnosticReport(report);
    expect(text).toContain('mise a jour OTA');
    expect(text).toContain('production / 1.2.4');
  });

  it('says plainly when no update has been applied', () => {
    // Repond a « l OTA est-elle active ? » sans le deduire de la presence
    // d un bouton dans l interface.
    const text = formatSyncDiagnosticReport(buildSyncDiagnosticReport([], {
      ...environment,
      embeddedLaunch: true,
      updateId: null,
    }));

    expect(text).toContain('embarque dans l APK (aucune OTA appliquee)');
  });

  it('degrades to unknown rather than failing', () => {
    // Le module natif est absent en test et peut lever sur un build de dev.
    const report = buildSyncDiagnosticReport([], environment);

    expect(report.app.updateId).toBeNull();
    expect(report.app.embeddedLaunch).toBeNull();
    expect(formatSyncDiagnosticReport(report)).toContain('Bundle               : inconnu');
  });

  it('trusts the native module no more than a queue field', () => {
    const report = buildSyncDiagnosticReport([], {
      ...environment,
      updateId: 'jean.dupont@example.com',
      channel: 'canal avec espaces et accents é',
      updateCreatedAt: 'pas-une-date',
    });

    expect(report.app.updateId).toBeNull();
    expect(report.app.channel).toBeNull();
    expect(report.app.updateCreatedAt).toBeNull();
    expect(JSON.stringify(report)).not.toContain('jean.dupont');
  });
});
