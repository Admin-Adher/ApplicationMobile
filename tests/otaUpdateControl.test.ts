import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relative: string) {
  return readFileSync(
    fileURLToPath(new URL(`../${relative}`, import.meta.url).href),
    'utf8',
  );
}

describe('persistent OTA update control', () => {
  const hook = source('hooks/useOtaUpdate.ts');
  const control = source('components/OtaUpdateControl.tsx');
  const settings = source('app/settings.tsx');

  it('shares the native pending-update state between the banner and settings', () => {
    expect(hook).toContain('Updates.useUpdates()');
    expect(hook).toContain('updatesState.isUpdatePending');
    expect(hook).toContain('sharedCheckPromise');
    expect(control).toContain('useOtaUpdate({ automatic: false })');
  });

  it('checks, downloads, and only then offers the native reload', () => {
    expect(hook).toContain('Updates.checkForUpdateAsync()');
    expect(hook).toContain('Updates.fetchUpdateAsync()');
    expect(hook).toContain('Updates.reloadAsync()');
    expect(hook.indexOf('Updates.checkForUpdateAsync()')).toBeLessThan(hook.indexOf('Updates.fetchUpdateAsync()'));
  });

  it('keeps a reachable update action in account settings with complete states', () => {
    expect(settings).toContain("import OtaUpdateControl from '@/components/OtaUpdateControl'");
    expect(settings).toContain('<OtaUpdateControl />');
    for (const phase of ['checking', 'downloading', 'ready', 'up_to_date', 'error', 'restarting']) {
      expect(control).toContain(`phase === '${phase}'`);
    }
    expect(control).toContain('accessibilityLiveRegion="polite"');
    expect(control).toContain('minHeight: 48');
  });

  it('ships the persistent control in every supported interface language', () => {
    const translations = source('lib/i18n/resources.ts');
    for (const label of [
      "Forcer la vérification OTA",
      'Force OTA check',
      'Forzar comprobación OTA',
      'Redémarrer et appliquer',
      'Restart and apply',
      'Reiniciar y aplicar',
    ]) {
      expect(translations).toContain(label);
    }
  });
});
