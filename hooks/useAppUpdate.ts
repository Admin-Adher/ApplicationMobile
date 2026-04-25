import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';

const RELEASES_API = 'https://api.github.com/repos/Admin-Adher/ApplicationMobile/releases/latest';
export const APK_DOWNLOAD_URL = 'https://github.com/Admin-Adher/ApplicationMobile/releases/latest/download/buildtrack-release.apk';

const CACHE_KEY = 'app.update.latestRelease.v3';
const DISMISS_KEY = 'app.update.dismissedBuild.v3';

interface CachedRelease {
  tag: string;
  buildNumber: number | null;
  semver: string | null;
  fetchedAt: number;
  publishedAt?: string | null;
  notes?: string;
}

function cleanSemver(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = String(v).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3] ?? '0'}`;
}

function extractBuildNumber(tag: string | null | undefined): number | null {
  if (!tag) return null;
  // Format attendu: "android-build-544", "build-544", "v544", etc.
  const m = String(tag).match(/(?:build[-_]?|^v)(\d+)/i);
  if (m) return parseInt(m[1], 10);
  // Fallback: tout dernier nombre du tag
  const all = String(tag).match(/(\d+)/g);
  if (all && all.length === 1) return parseInt(all[0], 10);
  return null;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function getCurrentBuildNumber(): number | null {
  // Source la plus fiable: numéro de build natif de l'APK installé.
  if (Platform.OS === 'android') {
    const native = (Application as any).nativeBuildVersion;
    if (typeof native === 'string' && /^\d+$/.test(native)) {
      const n = parseInt(native, 10);
      if (n > 0) return n;
    }
  }
  // Fallback: config Expo (utile sur web et en mode dev).
  const cfg: any = Constants.expoConfig ?? (Constants as any).manifest;
  const code = cfg?.android?.versionCode;
  if (typeof code === 'number') return code;
  if (typeof code === 'string' && /^\d+$/.test(code)) return parseInt(code, 10);
  return null;
}

function getCurrentSemver(): string {
  const fromNative = (Application as any).nativeApplicationVersion;
  if (typeof fromNative === 'string' && fromNative.length > 0) {
    return cleanSemver(fromNative) ?? fromNative;
  }
  const cfg: any = Constants.expoConfig ?? (Constants as any).manifest;
  return cleanSemver(cfg?.version) ?? '0.0.0';
}

export interface AppUpdateState {
  loading: boolean;
  updateAvailable: boolean;
  currentLabel: string;
  latestLabel: string | null;
  latestPublishedAt: string | null;
  publishedRelative: string | null;
  downloadUrl: string;
  dismiss: () => Promise<void>;
  refresh: () => Promise<void>;
}

function formatRelativeFr(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return 'à l\'instant';
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  const w = Math.floor(d / 7);
  if (w < 5) return `il y a ${w} sem.`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `il y a ${mo} mois`;
  const y = Math.floor(d / 365);
  return `il y a ${y} an${y > 1 ? 's' : ''}`;
}

export function useAppUpdate(): AppUpdateState {
  const currentBuild = getCurrentBuildNumber();
  const currentSemver = getCurrentSemver();
  const currentLabel = currentBuild != null ? `Build ${currentBuild}` : currentSemver;

  const [latestTag, setLatestTag] = useState<string | null>(null);
  const [latestBuild, setLatestBuild] = useState<number | null>(null);
  const [latestSemver, setLatestSemver] = useState<string | null>(null);
  const [latestPublishedAt, setLatestPublishedAt] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applyRelease = useCallback((rel: CachedRelease) => {
    setLatestTag(rel.tag || null);
    setLatestBuild(rel.buildNumber);
    setLatestSemver(rel.semver);
    setLatestPublishedAt(rel.publishedAt ?? null);
  }, []);

  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const tag: string = data?.tag_name ?? data?.name ?? '';
      const payload: CachedRelease = {
        tag,
        buildNumber: extractBuildNumber(tag),
        semver: cleanSemver(tag) ?? cleanSemver(data?.name),
        fetchedAt: Date.now(),
        publishedAt: data?.published_at ?? data?.created_at ?? null,
        notes: data?.body,
      };
      applyRelease(payload);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Réseau / GitHub indisponible — on ignore silencieusement.
    } finally {
      setLoading(false);
    }
  }, [applyRelease]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Affichage immédiat depuis le cache (s'il existe).
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw && !cancelled) {
          try {
            const cached: CachedRelease = JSON.parse(raw);
            if (cached) applyRelease(cached);
          } catch {}
        }
        const d = await AsyncStorage.getItem(DISMISS_KEY);
        if (!cancelled) setDismissed(d);
      } catch {}
      // Toujours rafraîchir en arrière-plan (stale-while-revalidate).
      if (!cancelled) await fetchLatest();
    })();
    return () => { cancelled = true; };
  }, [fetchLatest, applyRelease]);

  // Étiquette à afficher pour la dernière version
  let latestLabel: string | null = null;
  if (latestBuild != null) latestLabel = `Build ${latestBuild}`;
  else if (latestSemver) latestLabel = latestSemver;
  else if (latestTag) latestLabel = latestTag;

  // Détection mise à jour
  let isNewer = false;
  if (latestBuild != null && currentBuild != null) {
    isNewer = latestBuild > currentBuild;
  } else if (latestSemver) {
    isNewer = compareSemver(latestSemver, currentSemver) > 0;
  }

  // Filtre dismiss : on garde caché tant que la dernière étiquette n'a pas changé
  const dismissKey = latestBuild != null ? `build:${latestBuild}` : (latestTag ?? '');
  const isDismissed = !!dismissed && dismissed === dismissKey;

  const dismiss = useCallback(async () => {
    if (!dismissKey) return;
    try {
      await AsyncStorage.setItem(DISMISS_KEY, dismissKey);
      setDismissed(dismissKey);
    } catch {}
  }, [dismissKey]);

  const updateAvailable = isNewer && !isDismissed && Platform.OS !== 'ios';

  return {
    loading,
    updateAvailable,
    currentLabel,
    latestLabel,
    latestPublishedAt,
    publishedRelative: formatRelativeFr(latestPublishedAt),
    downloadUrl: APK_DOWNLOAD_URL,
    dismiss,
    refresh: fetchLatest,
  };
}
