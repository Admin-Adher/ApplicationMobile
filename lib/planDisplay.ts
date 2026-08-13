export type PlanDisplaySource = {
  uri: string;
  fromCache: boolean;
};

type PlanDisplayDependencies = {
  getCachedUri: (remoteUri: string) => Promise<string | null>;
  resolveRemoteUri: (remoteUri: string) => Promise<string | null>;
  warmCache: (remoteUri: string, resolvedUri: string) => void;
};

function isLocalUri(uri: string): boolean {
  return uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('data:');
}

/**
 * Selects the fastest safe source for a plan. A local copy wins, otherwise the
 * short-lived authorized URL is returned immediately while the offline copy is
 * populated independently.
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
  if (!fromCache) dependencies.warmCache(remoteUri, resolvedUri);
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
