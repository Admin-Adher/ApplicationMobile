import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const RELEASES_API = 'https://api.github.com/repos/Admin-Adher/ApplicationMobile/releases/latest';
export const APK_DOWNLOAD_URL = 'https://github.com/Admin-Adher/ApplicationMobile/releases/latest/download/buildtrack-release.apk';

const CACHE_KEY = 'app.update.latestRelease.v1';
const DISMISS_KEY = 'app.update.dismissedVersion.v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CachedRelease {
  version: string;
  fetchedAt: number;
  notes?: string;
}

function cleanVersion(v: string | null | undefined): string {
  if (!v) return '';
  return String(v).trim().replace(/^v/i, '').split(/[-+ ]/)[0];
}

function compareVersions(a: string, b: string): number {
  const pa = cleanVersion(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = cleanVersion(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export interface AppUpdateState {
  loading: boolean;
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  downloadUrl: string;
  dismiss: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAppUpdate(): AppUpdateState {
  const currentVersion = cleanVersion(
    (Constants.expoConfig as any)?.version ??
    (Constants as any).manifest?.version ??
    '0.0.0'
  );
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLatest = useCallback(async (force = false) => {
    setLoading(true);
    try {
      if (!force) {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw) {
          try {
            const cached: CachedRelease = JSON.parse(raw);
            if (cached.version && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
              setLatestVersion(cleanVersion(cached.version));
              setLoading(false);
              return;
            }
          } catch {}
        }
      }
      const res = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const tag: string = data?.tag_name ?? data?.name ?? '';
      const version = cleanVersion(tag);
      if (version) {
        setLatestVersion(version);
        const payload: CachedRelease = {
          version,
          fetchedAt: Date.now(),
          notes: data?.body,
        };
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload));
      }
    } catch {
      // Réseau / GitHub indisponible — on ignore silencieusement.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await AsyncStorage.getItem(DISMISS_KEY);
        if (!cancelled) setDismissedVersion(d);
      } catch {}
      if (!cancelled) await fetchLatest(false);
    })();
    return () => { cancelled = true; };
  }, [fetchLatest]);

  const dismiss = useCallback(async () => {
    if (!latestVersion) return;
    try {
      await AsyncStorage.setItem(DISMISS_KEY, latestVersion);
      setDismissedVersion(latestVersion);
    } catch {}
  }, [latestVersion]);

  const updateAvailable = !!latestVersion
    && compareVersions(latestVersion, currentVersion) > 0
    && (!dismissedVersion || compareVersions(latestVersion, dismissedVersion) > 0)
    && Platform.OS !== 'ios'; // l'APK ne s'applique pas à iOS

  return {
    loading,
    updateAvailable,
    currentVersion,
    latestVersion,
    downloadUrl: APK_DOWNLOAD_URL,
    dismiss,
    refresh: () => fetchLatest(true),
  };
}
