import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isSupabaseConfigured,
  supabase,
  SUPABASE_KEY,
  SUPABASE_URL,
} from '@/lib/supabase';
import {
  lookupOpenFactsCatalogs,
  normalizeBarcodeLookupCode,
  type InventoryBarcodeMatch,
} from '@/lib/inventoryBarcodeCore';

// Parser/provider rules changed materially: invalidate matches accepted by the
// former, more permissive variant detector instead of serving stale results.
const CACHE_PREFIX = 'buildtrack_inventory_barcode_v2';
const OPEN_CATALOG_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const WEB_CATALOG_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedBarcodeMatch {
  expiresAt: number;
  match: InventoryBarcodeMatch;
}

export interface InventoryBarcodeLookupOptions {
  language?: string;
  fetchImpl?: typeof fetch;
  openCatalogTimeoutMs?: number;
  webTimeoutMs?: number;
  apiBaseUrl?: string;
  accessToken?: string | null;
  useCache?: boolean;
}

function cacheKey(code: string): string {
  return `${CACHE_PREFIX}:${encodeURIComponent(code)}`;
}

async function readCachedMatch(code: string): Promise<InventoryBarcodeMatch | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(code));
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedBarcodeMatch;
    if (!cached?.match?.designation || cached.expiresAt <= Date.now()) {
      await AsyncStorage.removeItem(cacheKey(code));
      return null;
    }
    return cached.match;
  } catch {
    return null;
  }
}

async function writeCachedMatch(code: string, match: InventoryBarcodeMatch): Promise<void> {
  try {
    const cached: CachedBarcodeMatch = {
      expiresAt: Date.now() + (match.source === 'web' ? WEB_CATALOG_CACHE_MS : OPEN_CATALOG_CACHE_MS),
      match,
    };
    await AsyncStorage.setItem(cacheKey(code), JSON.stringify(cached));
  } catch {
    // Lookup remains functional even when device storage is unavailable.
  }
}

function defaultApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return (process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_APP_URL || '').replace(/\/+$/, '');
}

async function currentAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data } = await (supabase as any).auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function lookupWebProvider(
  code: string,
  options: InventoryBarcodeLookupOptions,
): Promise<InventoryBarcodeMatch | null> {
  const base = (options.apiBaseUrl ?? defaultApiBaseUrl()).replace(/\/+$/, '');
  const token = options.accessToken === undefined ? await currentAccessToken() : options.accessToken;
  if (!token) return null;

  const endpoints: Array<{ url: string; apiKey?: string }> = [];
  if (SUPABASE_URL && SUPABASE_KEY) {
    endpoints.push({
      url: `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/inventory-barcode-lookup`,
      apiKey: SUPABASE_KEY,
    });
  }
  if (base) endpoints.push({ url: `${base}/api/inventory-barcode-lookup` });

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.webTimeoutMs ?? 7000);
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };
      if (endpoint.apiKey) headers.apikey = endpoint.apiKey;
      const response = await (options.fetchImpl ?? fetch)(endpoint.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code, language: options.language ?? 'fr' }),
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!payload?.match?.designation || payload.match.source !== 'web') continue;
      return payload.match as InventoryBarcodeMatch;
    } catch {
      // Continue with the regular API server when the Edge Function is unavailable.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * External resolution order after the calling screen has checked BuildTrack:
 * open product catalogues, then an authenticated server-side web search.
 */
export async function lookupInventoryBarcode(
  value: string,
  options: InventoryBarcodeLookupOptions = {},
): Promise<InventoryBarcodeMatch | null> {
  const code = normalizeBarcodeLookupCode(value);
  if (code.length < 4) return null;

  const cached = options.useCache === false ? null : await readCachedMatch(code);
  if (cached?.variantComplete) return cached;

  const openMatch = cached ?? await lookupOpenFactsCatalogs(code, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.openCatalogTimeoutMs,
    language: options.language,
  });
  if (openMatch) {
    if (options.useCache !== false) await writeCachedMatch(code, openMatch);
    if (openMatch.variantComplete) return openMatch;
  }

  const webMatch = await lookupWebProvider(code, options);
  if (webMatch) {
    const mergedMatch = {
      ...webMatch,
      brand: webMatch.brand ?? openMatch?.brand,
      photoUrl: webMatch.photoUrl ?? openMatch?.photoUrl,
    };
    if (options.useCache !== false) await writeCachedMatch(code, mergedMatch);
    return mergedMatch;
  }
  return openMatch;
}

export function inventoryBarcodeWebSearchUrl(value: string): string {
  const code = normalizeBarcodeLookupCode(value);
  return `https://www.google.com/search?q=${encodeURIComponent(`"${code}" produit EAN GTIN`)}`;
}

export type { InventoryBarcodeMatch } from '@/lib/inventoryBarcodeCore';
