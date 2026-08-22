import { describe, expect, it } from 'vitest';
import { resources } from '../lib/i18n/resources';

const translations = resources as any;

describe('settings terminal-rejection copy', () => {
  it.each([
    ['fr', 'Marquer comme examinée'],
    ['en', 'Mark reviewed'],
    ['es', 'Marcar como revisada'],
  ])('uses a neutral reviewed action in %s', (language, expected) => {
    const queue = translations[language].translation.settings.syncQueue;
    expect(queue.dismissRejectedAction_one).toBe(expected);
    expect(queue.dismissRejectedHint).toBeTruthy();
    expect(queue.dismissFailedTitle).toBeTruthy();
    expect(queue.dismissFailedText).toBeTruthy();
    expect(queue.rejectedHint.toLowerCase()).not.toContain('stock');
  });

  it.each(['fr', 'en', 'es'])('keeps inventory-only guidance separate in %s', language => {
    const queue = translations[language].translation.settings.syncQueue;
    expect(queue.inventoryRejectedHint).toBeTruthy();
    expect(queue.inventoryMovement.in).toBeTruthy();
    expect(queue.inventoryMovement.out).toBeTruthy();
    expect(queue.inventoryServerStock).toBeTruthy();
  });

  it.each(['fr', 'en', 'es'])('localizes duplicate operation conflicts in %s', language => {
    const inventoryOutcome = translations[language].translation.networkQueue.inventoryOutcome;
    expect(inventoryOutcome.duplicate_operation_mismatch).toBeTruthy();
  });

  it.each(['fr', 'en', 'es'])('reports the operation count, not a category count, in %s', language => {
    const diagnostic = translations[language].translation.settings.diagnostic;

    // Le resume du diagnostic doit parler d'operations : « 1 probleme detecte »
    // au-dessus d'une file de 29 operations se lit comme un compteur faux.
    for (const key of [
      'queueSummary_one',
      'queueSummary_other',
      'accountAndQueueSummary_one',
      'accountAndQueueSummary_other',
    ]) {
      expect(diagnostic[key], `${language}.${key}`).toBeTruthy();
      expect(diagnostic[key]).toContain('{{count}}');
    }
    for (const key of ['accountAndQueueSummary_one', 'accountAndQueueSummary_other']) {
      expect(diagnostic[key]).toContain('{{problems}}');
    }
    // L'erreur serveur brute reste exposee pour le support.
    expect(translations[language].translation.settings.syncQueue.technicalError).toBeTruthy();
  });
});
