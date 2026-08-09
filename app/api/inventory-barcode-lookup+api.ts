import { createClient } from '@supabase/supabase-js';
import {
  normalizeBarcodeLookupCode,
  selectWebSearchMatch,
  type WebSearchResult,
} from '@/lib/inventoryBarcodeCore';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? process.env.EXPO_PUBLIC_SUPABASE_KEY
  ?? '';
const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY ?? '';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

const requestWindows = new Map<string, number[]>();

function bearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

function apiError(error: string, status: number, code?: string): Response {
  return Response.json({ error, code }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function allowRequest(userId: string): boolean {
  const now = Date.now();
  const recent = (requestWindows.get(userId) ?? []).filter(time => now - time < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    requestWindows.set(userId, recent);
    return false;
  }
  recent.push(now);
  requestWindows.set(userId, recent);
  return true;
}

function braveLocale(language: string): { country: string; searchLang: string } {
  const lang = language.split('-')[0].toLowerCase();
  if (lang === 'es') return { country: 'es', searchLang: 'es' };
  if (lang === 'en') return { country: 'us', searchLang: 'en' };
  return { country: 'fr', searchLang: 'fr' };
}

async function authenticatedUser(request: Request): Promise<{ id: string } | null> {
  const token = bearerToken(request);
  if (!token || !SUPABASE_URL || !SUPABASE_KEY) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data.user ? null : { id: data.user.id };
}

async function searchBrave(code: string, language: string): Promise<WebSearchResult[]> {
  const locale = braveLocale(language);
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', `"${code}" produit référence modèle EAN GTIN`);
  url.searchParams.set('count', '8');
  url.searchParams.set('country', locale.country);
  url.searchParams.set('search_lang', locale.searchLang);
  url.searchParams.set('safesearch', 'moderate');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': BRAVE_SEARCH_API_KEY,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Brave Search HTTP ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload?.web?.results) ? payload.web.results : [];
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request): Promise<Response> {
  const user = await authenticatedUser(request);
  if (!user) return apiError('Session invalide', 401, 'invalid_session');
  if (!allowRequest(user.id)) return apiError('Trop de recherches, réessayez dans une minute.', 429, 'rate_limited');

  try {
    const body = await request.json();
    const code = normalizeBarcodeLookupCode(String(body?.code ?? ''));
    const language = String(body?.language ?? 'fr');
    if (code.length < 4 || code.length > 128) {
      return apiError('Code-barres invalide', 400, 'invalid_barcode');
    }
    if (!BRAVE_SEARCH_API_KEY) {
      return apiError('Recherche web non configurée', 503, 'web_search_not_configured');
    }

    const results = await searchBrave(code, language);
    const match = selectWebSearchMatch(results, code);
    if (!match) return apiError('Produit introuvable', 404, 'product_not_found');
    return Response.json({ match }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('[inventory-barcode-lookup]', error?.message ?? error);
    return apiError('Recherche web temporairement indisponible', 502, 'provider_unavailable');
  }
}
