import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');

function workflow(name: string): string {
  return readFileSync(resolve(repositoryRoot, '.github/workflows', name), 'utf8').replace(/\r\n/g, '\n');
}

const reusable = workflow('reusable-quality-gates.yml');
const securityGates = workflow('security-gates.yml');
const releaseChain = workflow('build-apk.yml');

describe('release pipeline policy', () => {
  it('keeps a single canonical definition of a publishable commit', () => {
    // Il existait deux contrats : un portail « leger » dans la chaine Android
    // et ce workflow « complet » sur les PR. Un commit pouvait donc etre publie
    // apres avoir satisfait le plus faible des deux.
    expect(reusable).toContain('workflow_call:');
    for (const gate of [
      'npm test',
      'npx tsc --noEmit',
      'working-directory: vercel-app',
      'supabase/tests/tenant_isolation_matrix.sql',
      'supabase/tests/inventory_operation_idempotency.sql',
      'raven-actions/actionlint@',
    ]) {
      expect(reusable, gate).toContain(gate);
    }

    // Les deux appelants pointent sur le MEME fichier.
    for (const caller of [securityGates, releaseChain]) {
      expect(caller).toContain('uses: ./.github/workflows/reusable-quality-gates.yml');
    }

    // Aucun appelant ne redefinit ses propres controles.
    expect(securityGates).not.toContain('npm test');
    expect(releaseChain).not.toContain('run: npm test');
  });

  it('never publishes from a pull request or outside main', () => {
    for (const job of ['publish-ota', 'build']) {
      const start = releaseChain.indexOf(`  ${job}:`);
      expect(start, job).toBeGreaterThan(-1);
      const block = releaseChain.slice(start, releaseChain.indexOf('    steps:', start));
      expect(block, job).toContain("github.ref == 'refs/heads/main'");
      expect(block, job).toContain('environment: mobile-release');
    }
  });

  it('requires a real bundle change before republishing an OTA', () => {
    // Le pipeline garantissait qu'une OTA etait VALIDEE, pas qu'elle etait
    // NECESSAIRE : le merge d'une PR ne touchant que des workflows republiait
    // un bundle identique sur le canal production.
    const start = releaseChain.indexOf('  publish-ota:');
    const block = releaseChain.slice(start, releaseChain.indexOf('    steps:', start));

    expect(block).toContain("needs.detect-changes.outputs.ota_changed == 'true'");
    // Un changement natif ne doit jamais partir en OTA automatique : le bundle
    // dependrait d'un module absent du binaire deja installe.
    expect(block).toContain("needs.detect-changes.outputs.native_changed != 'true'");
    expect(block).toContain('inputs.force_ota');
  });

  it('builds an APK only when the native runtime is affected', () => {
    const start = releaseChain.indexOf('  build:');
    const block = releaseChain.slice(start, releaseChain.indexOf('    steps:', start));

    expect(block).toContain("needs.detect-changes.outputs.native_changed == 'true'");
    expect(block).toContain('inputs.build_apk');
    // Seul le job publiant une GitHub Release conserve le droit d'ecriture.
    expect(block).toContain('contents: write');
    expect(releaseChain).toContain('permissions:\n  contents: read');
  });

  it('classifies dependency and config changes as native, not OTA-safe', () => {
    const start = releaseChain.indexOf('  detect-changes:');
    const block = releaseChain.slice(start, releaseChain.indexOf('  publish-ota:'));

    // Politique volontairement conservatrice : une dependance ajoutee peut
    // embarquer du code natif.
    for (const conservative of ['package\\.json', 'package-lock\\.json', 'app\\.json', 'eas\\.json']) {
      expect(block, conservative).toContain(conservative);
    }
    // Le bundle mobile.
    for (const bundled of ['app|components', 'lib', 'assets']) {
      expect(block, bundled).toContain(bundled);
    }
    // Une base de comparaison absente ne doit jamais signifier « rien change ».
    expect(block).toContain('git rev-parse HEAD^');
  });
});
