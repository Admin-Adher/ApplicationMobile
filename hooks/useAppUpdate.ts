import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { currentApplicationVersion, currentBuildNumber } from '@/lib/clientVersion';
import {
  APK_DOWNLOAD_URL,
  AppRelease,
  cleanSemver,
  isCachedReleaseFresh,
  isReleaseNewer,
  parseAppReleasePayload,
  resolveLatestAppRelease,
  subscribeToAppRelease,
} from '@/lib/appUpdateRelease';

const CACHE_KEY = 'app.update.latestRelease.v4';
const DISMISS_KEY = 'app.update.dismissedBuild.v3';
const LAST_SEEN_BUILD_KEY = 'app.update.lastSeenBuild.v1';
const JUST_UPDATED_ACK_KEY = 'app.update.justUpdatedAck.v1';
const SECURITY_REQUIREMENTS_KEY = 'app.security.requirements.v1';

let sharedDismissedBuild: string | null | undefined;
const dismissedBuildListeners = new Set<(value: string | null) => void>();

function publishDismissedBuild(value: string | null) {
  sharedDismissedBuild = value;
  for (const listener of dismissedBuildListeners) listener(value);
}

function subscribeToDismissedBuild(listener: (value: string | null) => void): () => void {
  dismissedBuildListeners.add(listener);
  if (sharedDismissedBuild !== undefined) listener(sharedDismissedBuild);
  return () => { dismissedBuildListeners.delete(listener); };
}

interface SecurityRequirements {
  privateMediaStorage: boolean;
  minimumAndroidBuild: number;
  minimumMediaProtocol: number;
  downloadUrl: string;
  fetchedAt: number;
}

const DEFAULT_REQUIREMENTS: SecurityRequirements = {
  privateMediaStorage: false,
  minimumAndroidBuild: 0,
  minimumMediaProtocol: 1,
  downloadUrl: APK_DOWNLOAD_URL,
  fetchedAt: 0,
};

export type AppUpdateCheckStatus = 'idle' | 'cached' | 'checking' | 'fresh' | 'unavailable';

function currentSemver(): string {
  const version = currentApplicationVersion();
  return cleanSemver(version) ?? version;
}

function formatRelative(iso: string | null, language: string): string | null {
  if (!iso) return null;
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return null;

  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 24 * 60 * 60],
    ['month', 30 * 24 * 60 * 60],
    ['week', 7 * 24 * 60 * 60],
    ['day', 24 * 60 * 60],
    ['hour', 60 * 60],
    ['minute', 60],
  ];
  const locale = language.toLowerCase().startsWith('es')
    ? 'es'
    : language.toLowerCase().startsWith('fr')
      ? 'fr'
      : 'en';

  try {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    for (const [unit, seconds] of ranges) {
      if (Math.abs(elapsedSeconds) >= seconds) {
        return formatter.format(Math.round(elapsedSeconds / seconds), unit);
      }
    }
    return formatter.format(Math.round(elapsedSeconds / 60), 'minute');
  } catch {
    return null;
  }
}

export interface AppUpdateState {
  loading: boolean;
  checkStatus: AppUpdateCheckStatus;
  updateAvailable: boolean;
  updateDetected: boolean;
  isUpToDate: boolean;
  isDismissed: boolean;
  updateRequired: boolean;
  minimumAndroidBuild: number;
  currentLabel: string;
  latestLabel: string | null;
  latestPublishedAt: string | null;
  lastSuccessfulCheckAt: number | null;
  publishedRelative: string | null;
  downloadUrl: string;
  dismiss: () => Promise<void>;
  refresh: () => Promise<boolean>;
  justUpdated: boolean;
  justUpdatedFromBuild: number | null;
  acknowledgeJustUpdated: () => Promise<void>;
}

export function useAppUpdate(): AppUpdateState {
  const { i18n } = useTranslation();
  const currentBuild = currentBuildNumber();
  const installedSemver = currentSemver();
  const currentLabel = currentBuild != null ? `Build ${currentBuild}` : installedSemver;

  const [latestTag, setLatestTag] = useState<string | null>(null);
  const [latestBuild, setLatestBuild] = useState<number | null>(null);
  const [latestSemver, setLatestSemver] = useState<string | null>(null);
  const [latestPublishedAt, setLatestPublishedAt] = useState<string | null>(null);
  const [latestDownloadUrl, setLatestDownloadUrl] = useState<string>(APK_DOWNLOAD_URL);
  const [lastSuccessfulCheckAt, setLastSuccessfulCheckAt] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkStatus, setCheckStatus] = useState<AppUpdateCheckStatus>('idle');
  const [justUpdated, setJustUpdated] = useState(false);
  const [justUpdatedFromBuild, setJustUpdatedFromBuild] = useState<number | null>(null);
  const [requirements, setRequirements] = useState<SecurityRequirements>(DEFAULT_REQUIREMENTS);

  const applyRelease = useCallback((release: AppRelease) => {
    setLatestTag(release.tag || null);
    setLatestBuild(release.buildNumber);
    setLatestSemver(release.semver);
    setLatestPublishedAt(release.publishedAt ?? null);
    setLatestDownloadUrl(release.downloadUrl || APK_DOWNLOAD_URL);
    setLastSuccessfulCheckAt(release.fetchedAt);
  }, []);

  useEffect(() => subscribeToAppRelease(applyRelease), [applyRelease]);
  useEffect(() => subscribeToDismissedBuild(setDismissed), []);

  const checkLatestRelease = useCallback(async (force: boolean): Promise<boolean> => {
    setCheckStatus('checking');
    try {
      const release = await resolveLatestAppRelease({ force });
      applyRelease(release);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(release));
      setCheckStatus('fresh');
      return true;
    } catch {
      setCheckStatus('unavailable');
      return false;
    }
  }, [applyRelease]);

  const fetchSecurityRequirements = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any).rpc('get_client_security_requirements');
      if (error || !data) return;
      const minimumBuild = Number(data.minimum_android_build ?? 0);
      const configuredUrl = String(data.download_url ?? APK_DOWNLOAD_URL);
      const next: SecurityRequirements = {
        privateMediaStorage: data.private_media_storage === true,
        minimumAndroidBuild: Number.isSafeInteger(minimumBuild) && minimumBuild > 0 ? minimumBuild : 0,
        minimumMediaProtocol: Math.max(1, Number(data.minimum_media_protocol ?? 1) || 1),
        downloadUrl: /^https:\/\//i.test(configuredUrl) ? configuredUrl : APK_DOWNLOAD_URL,
        fetchedAt: Date.now(),
      };
      setRequirements(next);
      await AsyncStorage.setItem(SECURITY_REQUIREMENTS_KEY, JSON.stringify(next));
    } catch {
      // Keep the last signed control-plane value while offline.
    }
  }, []);

  const runRefresh = useCallback(async (force: boolean): Promise<boolean> => {
    setLoading(true);
    const [releaseResolved] = await Promise.all([
      checkLatestRelease(force),
      fetchSecurityRequirements(),
    ]);
    setLoading(false);
    return releaseResolved;
  }, [checkLatestRelease, fetchSecurityRequirements]);

  const refresh = useCallback(async () => {
    const resolved = await runRefresh(true);
    if (resolved) {
      await AsyncStorage.removeItem(DISMISS_KEY).catch(() => {});
      publishDismissedBuild(null);
    }
    return resolved;
  }, [runRefresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [releaseRaw, dismissedRaw, requirementRaw] = await Promise.all([
          AsyncStorage.getItem(CACHE_KEY),
          AsyncStorage.getItem(DISMISS_KEY),
          AsyncStorage.getItem(SECURITY_REQUIREMENTS_KEY),
        ]);
        if (!cancelled && releaseRaw) {
          try {
            const raw = JSON.parse(releaseRaw) as Record<string, unknown>;
            const cachedAt = typeof raw.fetchedAt === 'number' ? raw.fetchedAt : 0;
            const cached = parseAppReleasePayload(raw, cachedAt);
            if (cached) {
              applyRelease(cached);
              setCheckStatus(isCachedReleaseFresh(cached) ? 'cached' : 'idle');
            }
          } catch {}
        }
        if (!cancelled) publishDismissedBuild(dismissedRaw);
        if (!cancelled && requirementRaw) {
          try {
            const cached = JSON.parse(requirementRaw) as SecurityRequirements;
            if (cached && Number.isFinite(cached.minimumAndroidBuild)) setRequirements(cached);
          } catch {}
        }
      } catch {}

      try {
        if (currentBuild != null && Platform.OS !== 'web') {
          const [lastSeenRaw, acknowledgedRaw] = await Promise.all([
            AsyncStorage.getItem(LAST_SEEN_BUILD_KEY),
            AsyncStorage.getItem(JUST_UPDATED_ACK_KEY),
          ]);
          const lastSeen = lastSeenRaw ? Number.parseInt(lastSeenRaw, 10) : null;
          const acknowledged = acknowledgedRaw ? Number.parseInt(acknowledgedRaw, 10) : null;
          if (lastSeen != null && currentBuild > lastSeen && acknowledged !== currentBuild && !cancelled) {
            setJustUpdated(true);
            setJustUpdatedFromBuild(lastSeen);
          }
          await AsyncStorage.setItem(LAST_SEEN_BUILD_KEY, String(currentBuild));
        }
      } catch {}

      if (!cancelled) await runRefresh(false);
    })();
    return () => { cancelled = true; };
  }, [applyRelease, currentBuild, runRefresh]);

  const acknowledgeJustUpdated = useCallback(async () => {
    setJustUpdated(false);
    if (currentBuild != null) {
      await AsyncStorage.setItem(JUST_UPDATED_ACK_KEY, String(currentBuild)).catch(() => {});
    }
  }, [currentBuild]);

  let latestLabel: string | null = null;
  if (latestBuild != null) latestLabel = `Build ${latestBuild}`;
  else if (latestSemver) latestLabel = latestSemver;
  else if (latestTag) latestLabel = latestTag;

  const isNewer = isReleaseNewer(
    { buildNumber: latestBuild, semver: latestSemver },
    currentBuild,
    installedSemver,
  );
  const dismissKey = latestBuild != null ? `build:${latestBuild}` : (latestTag ?? '');
  const isDismissed = Boolean(dismissed && dismissed === dismissKey);
  const updateRequired = Platform.OS === 'android'
    && requirements.privateMediaStorage
    && requirements.minimumAndroidBuild > 0
    && (currentBuild == null || currentBuild < requirements.minimumAndroidBuild);
  const updateDetected = updateRequired || (isNewer && Platform.OS !== 'ios');
  const isUpToDate = checkStatus === 'fresh' && !updateDetected && latestLabel != null;

  const dismiss = useCallback(async () => {
    if (updateRequired || !dismissKey) return;
    await AsyncStorage.setItem(DISMISS_KEY, dismissKey).catch(() => {});
    publishDismissedBuild(dismissKey);
  }, [dismissKey, updateRequired]);

  const publishedRelative = useMemo(
    () => formatRelative(latestPublishedAt, i18n.resolvedLanguage ?? i18n.language ?? 'en'),
    [i18n.language, i18n.resolvedLanguage, latestPublishedAt],
  );

  return {
    loading,
    checkStatus,
    updateAvailable: updateRequired || (isNewer && !isDismissed && Platform.OS !== 'ios'),
    updateDetected,
    isUpToDate,
    isDismissed,
    updateRequired,
    minimumAndroidBuild: requirements.minimumAndroidBuild,
    currentLabel,
    latestLabel: latestLabel ?? (requirements.minimumAndroidBuild > 0 ? `Build ${requirements.minimumAndroidBuild}` : null),
    latestPublishedAt,
    lastSuccessfulCheckAt,
    publishedRelative,
    downloadUrl: updateRequired ? requirements.downloadUrl : latestDownloadUrl,
    dismiss,
    refresh,
    justUpdated,
    justUpdatedFromBuild,
    acknowledgeJustUpdated,
  };
}
