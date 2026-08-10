import { createClient } from '@supabase/supabase-js';
import {
  normalizeBarcodeLookupCode,
  selectWebSearchMatch,
} from '@/lib/inventoryBarcodeCore';
import {
  InventoryWebSearchError,
  searchInventoryBarcodeWeb,
} from '@/supabase/functions/_shared/inventoryWebSearchProviders';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? process.env.EXPO_PUBLIC_SUPABASE_KEY
  ?? '';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? '';
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY ?? '';
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

async function authenticatedUser(request: Request): Promise<{ id: string } | null> {
  const token = bearerToken(request);
  if (!token || !SUPABASE_URL || !SUPABASE_KEY) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data.user ? null : { id: data.user.id };
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
    const search = await searchInventoryBarcodeWeb({
      code,
      language,
      tavilyApiKey: TAVILY_API_KEY,
      serpApiKey: SERPAPI_API_KEY,
    });
    const match = selectWebSearchMatch(search.results, code);
    if (!match) return apiError('Produit introuvable', 404, 'product_not_found');
    return Response.json({
      match,
      provider: search.provider,
      providersTried: search.providersTried,
      fallbackReason: search.fallbackReason,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('[inventory-barcode-lookup]', error?.message ?? error);
    if (error instanceof InventoryWebSearchError) {
      const notConfigured = error.message.includes('configured');
      return Response.json({
        error: notConfigured ? 'Recherche web non configurée' : 'Recherche web temporairement indisponible',
        code: notConfigured ? 'web_search_not_configured' : 'provider_unavailable',
        providerStatuses: error.providerStatuses,
      }, {
        status: notConfigured ? 503 : 502,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return Response.json({
      error: 'Recherche web temporairement indisponible',
      code: 'provider_unavailable',
    }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
