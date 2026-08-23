import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APK_DOWNLOAD_URL,
  extractBuildNumber,
  isCachedReleaseFresh,
  isReleaseNewer,
  parseAppReleasePayload,
  parseReleasePageUrl,
} from '../lib/appUpdateRelease';

function source(relative: string) {
  return readFileSync(
    fileURLToPath(new URL(`../${relative}`, import.meta.url).href),
    'utf8',
  );
}

describe('BuildTrack release identity', () => {
  it('compares the native GitHub build number instead of the marketing version', () => {
    const release = parseAppReleasePayload({
      buildNumber: 959,
      version: '1.2.4',
      tag: 'android-build-959',
      downloadUrl: 'https://github.com/Admin-Adher/ApplicationMobile/releases/download/android-build-959/buildtrack-release.apk',
    }, 1_000);

    expect(release?.buildNumber).toBe(959);
    expect(isReleaseNewer(release!, 956, '1.2.4')).toBe(true);
    expect(isReleaseNewer(release!, 959, '1.2.4')).toBe(false);
  });

  it('normalizes the live GitHub release payload and its exact APK asset', () => {
    const release = parseAppReleasePayload({
      tag_name: 'android-build-959',
      name: 'BuildTrack Android — Build 959',
      published_at: '2026-08-11T15:25:45Z',
      assets: [{
        name: 'buildtrack-release.apk',
        size: 170_398_210,
        browser_download_url: 'https://github.com/Admin-Adher/ApplicationMobile/releases/download/android-build-959/buildtrack-release.apk',
      }],
    }, 2_000);

    expect(release).toMatchObject({
      tag: 'android-build-959',
      buildNumber: 959,
      publishedAt: '2026-08-11T15:25:45Z',
      size: 170_398_210,
    });
    expect(release?.downloadUrl).toContain('/android-build-959/buildtrack-release.apk');
  });

  it('uses the latest-page redirect as an API-quota-independent fallback', () => {
    const release = parseReleasePageUrl(
      'https://github.com/Admin-Adher/ApplicationMobile/releases/tag/android-build-959',
      3_000,
    );
    expect(release?.buildNumber).toBe(959);
    expect(release?.downloadUrl).toContain('/android-build-959/buildtrack-release.apk');
  });

  it('rejects ambiguous identities and untrusted APK origins', () => {
    expect(extractBuildNumber('BuildTrack Android — Build 959')).toBe(959);
    expect(parseAppReleasePayload({ name: 'latest release' })).toBeNull();
    const release = parseAppReleasePayload({
      tag: 'android-build-959',
      downloadUrl: 'https://attacker.example/buildtrack-release.apk',
    });
    expect(release?.downloadUrl).toBe(APK_DOWNLOAD_URL);
  });

  it('does not treat stale cached release metadata as a fresh verification', () => {
    expect(isCachedReleaseFresh({ fetchedAt: 1_000 }, 1_500, 1_000)).toBe(true);
    expect(isCachedReleaseFresh({ fetchedAt: 1_000 }, 3_000, 1_000)).toBe(false);
  });
});

describe('BuildTrack update UX contracts', () => {
  it('keeps dismissed updates detectable and never equates dismissal with up-to-date', () => {
    const hook = source('hooks/useAppUpdate.ts');
    const row = source('components/UpdateCheckRow.tsx');
    expect(hook).toContain('const updateDetected =');
    expect(hook).toContain("checkStatus === 'fresh'");
    expect(row).toContain('updateDetected');
    expect(row).toContain("checkStatus === 'unavailable'");
    expect(row).not.toContain('latestLabel && !updateAvailable');
  });

  it('publishes a small release manifest beside every APK', () => {
    const workflow = source('.github/workflows/build-apk.yml');
    expect(workflow).toContain('buildtrack-release.json');
    expect(workflow).toContain("createHash('sha256')");
    expect(workflow).toContain('release-assets/buildtrack-release.json');
  });

  it('does not stack OTA, optional APK, and mandatory APK presentations', () => {
    const ota = source('components/OtaUpdateBanner.tsx');
    const terrain = source('components/UpdateBanner.tsx');
    expect(ota).toContain('apkUpdateDetected');
    expect(ota).toContain('apkCheckLoading');
    expect(terrain).toContain('!updateAvailable || updateRequired');
  });
});
