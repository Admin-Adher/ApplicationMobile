import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { currentApplicationVersion, currentBuildNumber } from '@/lib/clientVersion';

const RELEASES_API = 'https://api.github.com/repos/Admin-Adher/ApplicationMobile/releases/latest';
export const APK_DOWNLOAD_URL = 'https://github.com/Admin-Adher/ApplicationMobile/releases/latest/download/buildtrack-release.apk';

const CACHE_KEY = 'app.update.latestRelease.v3';
const DISMISS_KEY = 'app.update.dismissedBuild.v3';
const LAST_SEEN_BUILD_KEY = 'app.update.lastSeenBuild.v1';
const JUST_UPDATED_ACK_KEY = 'app.update.justUpdatedAck.v1';
const SECURITY_REQUIREMENTS_KEY = 'app.security.requirements.v1';

interface CachedRelease {
  tag: string;
  buildNumber: number | null;
  semver: string | null;
  fetchedAt: number;
  publishedAt?: string | null;
  notes?: string;
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

function cleanSemver(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return `${match[1]}.${match[2]}.${match[3] ?? '0'}`;
}

function extractBuildNumber(tag: string | null | undefined): number | null {
  if (!tag) return null;
  const match = String(tag).match(/(?:build[-_]?|^v)(\d+)/i);
  if (match) return Number.parseInt(match[1], 10);
  const numbers = String(tag).match(/(\d+)/g);
  return numbers?.length === 1 ? Number.parseInt(numbers[0], 10) : null;
}

function compareSemver(left: string, right: string): number {
  const a = left.split('.').map(value => Number.parseInt(value, 10) || 0);
  const b = right.split('.').map(value => Number.parseInt(value, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) > (b[index] ?? 0)) return 1;
    if ((a[index] ?? 0) < (b[index] ?? 0)) return -1;
  }
  return 0;
}

function currentSemver(): string {
  const version = currentApplicationVersion();
  return cleanSemver(version) ?? version;
}

function formatRelativeFr(iso: string | null): string | null {
  if (!iso) return null;
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} j`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `il y a ${weeks} sem.`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(days / 365);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

export interface AppUpdateState {
  loading: boolean;
  updateAvailable: boolean;
  updateRequired: boolean;
  minimumAndroidBuild: number;
  currentLabel: string;
  latestLabel: string | null;
  latestPublishedAt: string | null;
  publishedRelative: string | null;
  downloadUrl: string;
  dismiss: () => Promise<void>;
  refresh: () => Promise<void>;
  justUpdated: boolean;
  justUpdatedFromBuild: number | null;
  acknowledgeJustUpdated: () => Promise<void>;
}

export function useAppUpdate(): AppUpdateState {
  const currentBuild = currentBuildNumber();
  const installedSemver = currentSemver();
  const currentLabel = currentBuild != null ? `Build ${currentBuild}` : installedSemver;

  const [latestTag, setLatestTag] = useState<string | null>(null);
  const [latestBuild, setLatestBuild] = useState<number | null>(null);
  const [latestSemver, setLatestSemver] = useState<string | null>(null);
  const [latestPublishedAt, setLatestPublishedAt] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [justUpdated, setJustUpdated] = useState(false);
  const [justUpdatedFromBuild, setJustUpdatedFromBuild] = useState<number | null>(null);
  const [requirements, setRequirements] = useState<SecurityRequirements>(DEFAULT_REQUIREMENTS);

  const applyRelease = useCallback((release: CachedRelease) => {
    setLatestTag(release.tag || null);
    setLatestBuild(release.buildNumber);
    setLatestSemver(release.semver);
    setLatestPublishedAt(release.publishedAt ?? null);
  }, []);

  const fetchLatest = useCallback(async () => {
    try {
      const response = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const tag = String(data?.tag_name ?? data?.name ?? '');
      const release: CachedRelease = {
        tag,
        buildNumber: extractBuildNumber(tag),
        semver: cleanSemver(tag) ?? cleanSemver(data?.name),
        fetchedAt: Date.now(),
        publishedAt: data?.published_at ?? data?.created_at ?? null,
        notes: data?.body,
      };
      applyRelease(release);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(release));
    } catch {
      // Keep the cached release when GitHub is temporarily unreachable.
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
      // Fail closed to the last control-plane value while offline.
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchLatest(), fetchSecurityRequirements()]);
    setLoading(false);
  }, [fetchLatest, fetchSecurityRequirements]);

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
          try { applyRelease(JSON.parse(releaseRaw) as CachedRelease); } catch {}
        }
        if (!cancelled) setDismissed(dismissedRaw);
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

      if (!cancelled) await refresh();
    })();
    return () => { cancelled = true; };
  }, [applyRelease, currentBuild, refresh]);

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

  const isNewer = latestBuild != null && currentBuild != null
    ? latestBuild > currentBuild
    : Boolean(latestSemver && compareSemver(latestSemver, installedSemver) > 0);
  const dismissKey = latestBuild != null ? `build:${latestBuild}` : (latestTag ?? '');
  const isDismissed = Boolean(dismissed && dismissed === dismissKey);
  const updateRequired = Platform.OS === 'android'
    && requirements.privateMediaStorage
    && requirements.minimumAndroidBuild > 0
    && (currentBuild == null || currentBuild < requirements.minimumAndroidBuild);

  const dismiss = useCallback(async () => {
    if (updateRequired || !dismissKey) return;
    await AsyncStorage.setItem(DISMISS_KEY, dismissKey).catch(() => {});
    setDismissed(dismissKey);
  }, [dismissKey, updateRequired]);

  return {
    loading,
    updateAvailable: updateRequired || (isNewer && !isDismissed && Platform.OS !== 'ios'),
    updateRequired,
    minimumAndroidBuild: requirements.minimumAndroidBuild,
    currentLabel,
    latestLabel: latestLabel ?? (requirements.minimumAndroidBuild > 0 ? `Build ${requirements.minimumAndroidBuild}` : null),
    latestPublishedAt,
    publishedRelative: formatRelativeFr(latestPublishedAt),
    downloadUrl: requirements.downloadUrl,
    dismiss,
    refresh,
    justUpdated,
    justUpdatedFromBuild,
    acknowledgeJustUpdated,
  };
}
