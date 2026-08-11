import { canonicalApiBaseUrl } from './apiBase';

export const RELEASES_API = 'https://api.github.com/repos/Admin-Adher/ApplicationMobile/releases/latest';
export const RELEASE_PAGE_URL = 'https://github.com/Admin-Adher/ApplicationMobile/releases/latest';
export const RELEASE_MANIFEST_URL = `${RELEASE_PAGE_URL}/download/buildtrack-release.json`;
export const APK_DOWNLOAD_URL = `${RELEASE_PAGE_URL}/download/buildtrack-release.apk`;

const RELEASE_REPOSITORY_PATH = '/Admin-Adher/ApplicationMobile/releases/';
const SESSION_RELEASE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;

export interface AppRelease {
  tag: string;
  buildNumber: number | null;
  semver: string | null;
  fetchedAt: number;
  publishedAt: string | null;
  notes?: string;
  downloadUrl: string;
  sha256?: string | null;
  size?: number | null;
}

export interface ResolveLatestReleaseOptions {
  force?: boolean;
  now?: number;
  timeoutMs?: number;
  apiBaseUrl?: string;
}

type JsonRecord = Record<string, unknown>;

let sessionRelease: AppRelease | null = null;
let inFlightRelease: Promise<AppRelease> | null = null;
const releaseListeners = new Set<(release: AppRelease) => void>();

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number.parseInt(value, 10)
      : Number.NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function cleanSemver(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(/(?:^|[^\d])(\d+)\.(\d+)(?:\.(\d+))?(?:[^\d]|$)/);
  if (!match) return null;
  return `${match[1]}.${match[2]}.${match[3] ?? '0'}`;
}

export function extractBuildNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = String(value);
  const explicit = text.match(/(?:android[-_\s]*)?build(?:\s*android)?[-_#:\s]*(\d+)/i);
  if (explicit) return positiveInteger(explicit[1]);
  const versionCode = text.match(/version\s*code[-_#:\s]*(\d+)/i);
  if (versionCode) return positiveInteger(versionCode[1]);
  const compact = text.match(/^v?(\d+)$/i);
  return compact ? positiveInteger(compact[1]) : null;
}

export function compareSemver(left: string, right: string): number {
  const a = left.split('.').map(value => Number.parseInt(value, 10) || 0);
  const b = right.split('.').map(value => Number.parseInt(value, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) > (b[index] ?? 0)) return 1;
    if ((a[index] ?? 0) < (b[index] ?? 0)) return -1;
  }
  return 0;
}

function safeDownloadUrl(value: unknown): string | null {
  const candidate = asString(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    if (!url.pathname.startsWith(RELEASE_REPOSITORY_PATH)) return null;
    if (!url.pathname.endsWith('/buildtrack-release.apk')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function githubAsset(record: JsonRecord): JsonRecord | null {
  const assets = Array.isArray(record.assets) ? record.assets : [];
  for (const value of assets) {
    const asset = asRecord(value);
    if (asset && asString(asset.name) === 'buildtrack-release.apk') return asset;
  }
  return null;
}

/**
 * Accepts both the compact BuildTrack manifest and GitHub's release payload.
 * A release without a trustworthy build/version identity is rejected so the
 * UI can never claim "up to date" from an ambiguous response.
 */
export function parseAppReleasePayload(payload: unknown, fetchedAt = Date.now()): AppRelease | null {
  const record = asRecord(payload);
  if (!record) return null;

  const apk = asRecord(record.apk);
  const asset = githubAsset(record);
  const name = asString(record.name);
  const body = asString(record.body) ?? asString(record.notes);
  const tag = asString(record.tag)
    ?? asString(record.tag_name)
    ?? (name && extractBuildNumber(name) != null ? `android-build-${extractBuildNumber(name)}` : '');
  const buildNumber = positiveInteger(record.buildNumber)
    ?? positiveInteger(record.build_number)
    ?? extractBuildNumber(tag)
    ?? extractBuildNumber(name)
    ?? extractBuildNumber(body);
  const semver = cleanSemver(asString(record.version))
    ?? cleanSemver(asString(record.semver))
    ?? cleanSemver(tag)
    ?? cleanSemver(name);

  if (buildNumber == null && semver == null) return null;

  const downloadUrl = safeDownloadUrl(record.downloadUrl)
    ?? safeDownloadUrl(record.download_url)
    ?? safeDownloadUrl(apk?.downloadUrl)
    ?? safeDownloadUrl(apk?.url)
    ?? safeDownloadUrl(asset?.browser_download_url)
    ?? APK_DOWNLOAD_URL;
  const publishedAt = asString(record.publishedAt)
    ?? asString(record.published_at)
    ?? asString(record.created_at);
  const sha256 = asString(record.sha256) ?? asString(apk?.sha256);
  const size = positiveInteger(record.size)
    ?? positiveInteger(apk?.size)
    ?? positiveInteger(asset?.size);

  return {
    tag: tag || (buildNumber != null ? `android-build-${buildNumber}` : semver ?? ''),
    buildNumber,
    semver,
    fetchedAt,
    publishedAt,
    notes: body ?? undefined,
    downloadUrl,
    sha256,
    size,
  };
}

export function parseReleasePageUrl(value: string | null | undefined, fetchedAt = Date.now()): AppRelease | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    const prefix = `${RELEASE_REPOSITORY_PATH}tag/`;
    if (!url.pathname.startsWith(prefix)) return null;
    const tag = decodeURIComponent(url.pathname.slice(prefix.length).split('/')[0] ?? '');
    const buildNumber = extractBuildNumber(tag);
    if (buildNumber == null) return null;
    return {
      tag,
      buildNumber,
      semver: cleanSemver(tag),
      fetchedAt,
      publishedAt: null,
      downloadUrl: `https://github.com/Admin-Adher/ApplicationMobile/releases/download/${encodeURIComponent(tag)}/buildtrack-release.apk`,
    };
  } catch {
    return null;
  }
}

export function isReleaseNewer(
  release: Pick<AppRelease, 'buildNumber' | 'semver'>,
  currentBuild: number | null,
  currentSemver: string,
): boolean {
  if (release.buildNumber != null && currentBuild != null) {
    return release.buildNumber > currentBuild;
  }
  return Boolean(release.semver && compareSemver(release.semver, currentSemver) > 0);
}

export function isCachedReleaseFresh(
  release: Pick<AppRelease, 'fetchedAt'>,
  now = Date.now(),
  maxAgeMs = 15 * 60_000,
): boolean {
  return Number.isFinite(release.fetchedAt)
    && release.fetchedAt > 0
    && now >= release.fetchedAt
    && now - release.fetchedAt <= maxAgeMs;
}

function appendCheckNonce(url: string, now: number): string {
  const parsed = new URL(url);
  parsed.searchParams.set('buildtrack_check', String(Math.floor(now / 30_000)));
  return parsed.toString();
}

async function fetchWithTimeout(url: string, timeoutMs: number, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: accept },
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonRelease(url: string, now: number, timeoutMs: number): Promise<AppRelease | null> {
  const response = await fetchWithTimeout(appendCheckNonce(url, now), timeoutMs, 'application/json');
  if (!response.ok) return null;
  return parseAppReleasePayload(await response.json(), now);
}

async function fetchReleasePage(now: number, timeoutMs: number): Promise<AppRelease | null> {
  const response = await fetchWithTimeout(appendCheckNonce(RELEASE_PAGE_URL, now), timeoutMs, 'text/html');
  if (!response.ok) return null;
  const release = parseReleasePageUrl(response.url, now);
  try { await response.body?.cancel(); } catch {}
  return release;
}

function publishSessionRelease(release: AppRelease): AppRelease {
  sessionRelease = release;
  for (const listener of releaseListeners) listener(release);
  return release;
}

export function subscribeToAppRelease(listener: (release: AppRelease) => void): () => void {
  releaseListeners.add(listener);
  if (sessionRelease) listener(sessionRelease);
  return () => { releaseListeners.delete(listener); };
}

/**
 * Resolve the latest APK through independent public paths. The release asset
 * manifest avoids GitHub API quotas; the BuildTrack API centralizes fallback
 * traffic; the GitHub API and latest-page redirect remain last-resort paths.
 */
export async function resolveLatestAppRelease(
  options: ResolveLatestReleaseOptions = {},
): Promise<AppRelease> {
  const now = options.now ?? Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!options.force && sessionRelease && now - sessionRelease.fetchedAt <= SESSION_RELEASE_TTL_MS) {
    return sessionRelease;
  }
  if (inFlightRelease) return inFlightRelease;

  inFlightRelease = (async () => {
    const apiBase = (options.apiBaseUrl ?? canonicalApiBaseUrl()).replace(/\/+$/, '');
    const jsonSources = [
      RELEASE_MANIFEST_URL,
      ...(apiBase ? [`${apiBase}/api/app-update`] : []),
      RELEASES_API,
    ];

    for (const source of jsonSources) {
      try {
        const release = await fetchJsonRelease(source, now, timeoutMs);
        if (release) return publishSessionRelease(release);
      } catch {}
    }

    try {
      const release = await fetchReleasePage(now, timeoutMs);
      if (release) return publishSessionRelease(release);
    } catch {}

    throw new Error('latest_release_unavailable');
  })();

  try {
    return await inFlightRelease;
  } finally {
    inFlightRelease = null;
  }
}
