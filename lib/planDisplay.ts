export type PlanDisplaySource = {
  uri: string;
  fromCache: boolean;
};

type PlanDisplayDependencies = {
  getCachedUri: (remoteUri: string) => Promise<string | null>;
  resolveRemoteUri: (remoteUri: string) => Promise<string | null>;
};

const USER_ID_PATTERN = /^[0-9a-f-]{36}$/i;

/**
 * Identifies plan references that need the private-media/cache adapter before
 * they can be rendered. In particular, `btmedia://` is not a WebView URL.
 */
export function isResolvablePlanUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri) || /^btmedia:\/\/[0-9a-f-]{36}$/i.test(uri);
}

/**
 * Resolves the account scope for the private plan store. The locally restored
 * owner is authoritative for reading an already account-scoped file, so an
 * offline cache hit never waits for (or depends on) a network session refresh.
 */
export async function resolvePlanCacheScope(
  knownOwnerId: string | null,
  loadSessionOwnerId: () => Promise<string | null>,
): Promise<string | null> {
  if (knownOwnerId && USER_ID_PATTERN.test(knownOwnerId)) return knownOwnerId;
  const sessionOwnerId = await loadSessionOwnerId().catch(() => null);
  return sessionOwnerId && USER_ID_PATTERN.test(sessionOwnerId) ? sessionOwnerId : null;
}

export type PrivateCacheOwnerTransition = {
  rememberedOwnerId: string | null;
  shouldClear: boolean;
};

/**
 * Applies the private-file ownership policy across auth bootstrap and account
 * switches. Null is transient here; explicit logout owns its separate purge.
 */
export function transitionPrivateCacheOwner(
  rememberedOwnerId: string | null,
  nextOwnerId: string | null,
): PrivateCacheOwnerTransition {
  if (!nextOwnerId) return { rememberedOwnerId, shouldClear: false };
  return {
    rememberedOwnerId: nextOwnerId,
    shouldClear: Boolean(rememberedOwnerId && rememberedOwnerId !== nextOwnerId),
  };
}

function isLocalUri(uri: string): boolean {
  return uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('data:');
}

/**
 * Selects the fastest safe source for a plan. A local copy wins, otherwise the
 * short-lived authorized URL is returned immediately. The screen-level plan
 * queue owns durable downloads so rendering and caching never fetch the same
 * PDF concurrently.
 */
export async function resolvePlanDisplaySource(
  remoteUri: string,
  dependencies: PlanDisplayDependencies,
): Promise<PlanDisplaySource> {
  const cachedUri = await dependencies.getCachedUri(remoteUri);
  if (cachedUri) return { uri: cachedUri, fromCache: true };

  const resolvedUri = await dependencies.resolveRemoteUri(remoteUri);
  if (!resolvedUri) throw new Error('plan access denied or unavailable');

  const fromCache = isLocalUri(resolvedUri);
  return { uri: resolvedUri, fromCache };
}

/**
 * Gives an HTML-string WebView the same origin as a signed HTTP URL without
 * copying its query-string credential into the base URL.
 */
export function planWebViewBaseUrl(uri: string): string {
  if (uri.startsWith('file://')) return uri;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.origin}/`;
    }
  } catch {
    // Data/content URIs intentionally use the neutral local origin below.
  }
  return 'https://localhost';
}
