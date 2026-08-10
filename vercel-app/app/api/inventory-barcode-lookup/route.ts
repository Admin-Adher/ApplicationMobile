import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server-auth';
import { checkRateLimit } from '@/lib/rateLimit';
import {
  normalizeBarcodeLookupCode,
  selectWebSearchMatch,
} from '../../../../lib/inventoryBarcodeCore';
import {
  InventoryWebSearchError,
  searchInventoryBarcodeWeb,
} from '../../../../lib/server/inventoryWebSearchProviders';
import {
  claimInventoryBarcodeLookup,
  completeInventoryBarcodeLookup,
  markInventoryBarcodeNotFound,
  releaseInventoryBarcodeLookup,
  type InventoryBarcodeCacheClient,
} from '../../../../lib/server/inventoryBarcodeCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = [
    process.env.EXPO_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    'https://buildtrack-mobile.vercel.app',
    'http://localhost:5000',
    'http://localhost:3000',
  ].filter(Boolean) as string[];
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'private, no-store',
  };
}

async function releaseLease(
  client: InventoryBarcodeCacheClient,
  code: string,
  leaseToken: string,
) {
  await releaseInventoryBarcodeLookup(client, code, leaseToken).catch(() => undefined);
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: 'Session invalide', code: 'invalid_session' }, { status: 401, headers });

  const body = await req.json().catch(() => ({}));
  const code = normalizeBarcodeLookupCode(String(body?.code ?? ''));
  const language = String(body?.language ?? 'fr').split('-')[0].toLowerCase();
  if (code.length < 4 || code.length > 128) {
    return NextResponse.json({ error: 'Code-barres invalide', code: 'invalid_barcode' }, { status: 400, headers });
  }

  const leaseToken = randomUUID();
  let ownsLease = false;
  const cacheClient = auth.supabase as unknown as InventoryBarcodeCacheClient;
  try {
    const claim = await claimInventoryBarcodeLookup(cacheClient, code, leaseToken, {
      leaseSeconds: 20,
      maxWaitMs: 4_000,
      pollMs: 250,
    });
    if (claim?.state === 'hit' && claim?.match?.designation) {
      return NextResponse.json({
        match: claim.match,
        provider: 'supabase-cache',
        cachedProvider: claim.cachedProvider,
        providersTried: [],
        cacheHit: true,
      }, { headers });
    }
    if (claim?.state === 'negative_hit') {
      return NextResponse.json({ error: 'Produit introuvable', code: 'product_not_found', provider: 'supabase-cache', cacheHit: true }, { status: 404, headers });
    }
    if (claim?.state === 'pending') {
      return NextResponse.json({ error: 'Recherche identique déjà en cours', code: 'lookup_in_progress', retryAfterMs: claim.retryAfterMs ?? 500 }, { status: 409, headers });
    }
    ownsLease = claim?.state === 'claimed';

    const rate = checkRateLimit(`inventory-barcode:${auth.authority.userId}`, 20, 60_000);
    if (!rate.allowed) {
      if (ownsLease) await releaseLease(cacheClient, code, leaseToken);
      return NextResponse.json({ error: 'Trop de recherches', code: 'rate_limited' }, { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } });
    }

    const search = await searchInventoryBarcodeWeb({
      code,
      language,
      tavilyApiKey: process.env.TAVILY_API_KEY,
      serpApiKey: process.env.SERPAPI_API_KEY,
    });
    const match = selectWebSearchMatch(search.results, code);
    if (!match) {
      if (ownsLease) {
        await markInventoryBarcodeNotFound(cacheClient, code, leaseToken);
      }
      return NextResponse.json({ error: 'Produit introuvable', code: 'product_not_found' }, { status: 404, headers });
    }
    if (ownsLease) {
      await completeInventoryBarcodeLookup(cacheClient, code, leaseToken, match, {
        provider: search.provider,
        providersTried: search.providersTried,
        fallbackReason: search.fallbackReason,
        lookupVersion: 1,
      });
    }
    return NextResponse.json({
      match,
      provider: search.provider,
      providersTried: search.providersTried,
      fallbackReason: search.fallbackReason,
      cacheHit: false,
    }, { headers });
  } catch (error: any) {
    if (ownsLease) await releaseLease(cacheClient, code, leaseToken);
    if (error instanceof InventoryWebSearchError) {
      const notConfigured = error.message.includes('configured');
      return NextResponse.json({
        error: notConfigured ? 'Recherche web non configurée' : 'Recherche web temporairement indisponible',
        code: notConfigured ? 'web_search_not_configured' : 'provider_unavailable',
        providerStatuses: error.providerStatuses,
      }, { status: notConfigured ? 503 : 502, headers });
    }
    console.error('[inventory-barcode-lookup]', error?.message ?? error);
    return NextResponse.json({ error: 'Recherche web temporairement indisponible', code: 'provider_unavailable' }, { status: 502, headers });
  }
}
