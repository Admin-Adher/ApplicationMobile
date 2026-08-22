import type { DiagnosticBundleIdentity } from './syncDiagnosticExport';

/**
 * Identite du bundle JavaScript en cours d'execution.
 *
 * `expo-updates` est charge en `require` paresseux, comme dans `useOtaUpdate` :
 * le module est absent en environnement de test et peut lever sur un build de
 * developpement. Un diagnostic ne doit jamais empecher l'ecran de s'afficher —
 * en cas de doute il rend des champs nuls, qui se lisent « inconnu ».
 */
export function currentBundleIdentity(): DiagnosticBundleIdentity {
  try {
    const Updates = require('expo-updates');
    return {
      updateId: typeof Updates.updateId === 'string' ? Updates.updateId : null,
      updateCreatedAt: Updates.createdAt instanceof Date
        ? Updates.createdAt.toISOString()
        : null,
      channel: typeof Updates.channel === 'string' ? Updates.channel : null,
      runtimeVersion: typeof Updates.runtimeVersion === 'string' ? Updates.runtimeVersion : null,
      embeddedLaunch: typeof Updates.isEmbeddedLaunch === 'boolean'
        ? Updates.isEmbeddedLaunch
        : null,
    };
  } catch {
    return {
      updateId: null,
      updateCreatedAt: null,
      channel: null,
      runtimeVersion: null,
      embeddedLaunch: null,
    };
  }
}
