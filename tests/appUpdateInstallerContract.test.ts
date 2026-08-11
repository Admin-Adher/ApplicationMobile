import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relative: string) {
  return readFileSync(
    fileURLToPath(new URL(`../${relative}`, import.meta.url)),
    'utf8',
  );
}

const installer = source('hooks/useApkInstaller.ts');
const terrainBanner = source('components/UpdateBanner.tsx');
const mandatoryGate = source('components/MandatoryUpdateGate.tsx');

describe('BuildTrack APK update experience', () => {
  it('uses one canonical installer from Terrain and the mandatory gate', () => {
    expect(terrainBanner).toContain("from '@/hooks/useApkInstaller'");
    expect(terrainBanner).toContain('useApkInstaller({');
    expect(mandatoryGate).toContain("from '@/hooks/useApkInstaller'");
    expect(mandatoryGate).toContain('useApkInstaller({');
    expect(mandatoryGate).not.toContain('Linking.openURL(downloadUrl)');
  });

  it('downloads inside the app and launches the Android package installer', () => {
    expect(installer).toContain('FileSystem.createDownloadResumable(');
    expect(installer).toContain('FileSystem.getContentUriAsync(result.uri)');
    expect(installer).toContain("'android.intent.action.VIEW'");
    expect(installer).toContain("type: 'application/vnd.android.package-archive'");
    expect(installer).toContain('Sharing.shareAsync(result.uri');
  });

  it('keeps progress feedback and browser fallback in both update contexts', () => {
    expect(installer).toContain('setProgress(');
    expect(installer).toContain('Linking.openURL(downloadUrl)');
    expect(terrainBanner).toContain('progressPercent: pct');
    expect(mandatoryGate).toContain('progressPercent');
    expect(mandatoryGate).toContain("state === 'downloading'");
  });
});
