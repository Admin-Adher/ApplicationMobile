import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  InventoryWebSearchError,
  searchInventoryBarcodeWeb,
  type InventoryWebSearchResult as SearchResult,
} from '../_shared/inventoryWebSearchProviders.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const blockedHosts = [
  'barcodefinder.', 'barcodelookup.', 'gtinhub.', 'go-upc.', 'upcitemdb.',
  'openfoodfacts.', 'openproductsfacts.', 'google.', 'bing.', 'duckduckgo.',
];
const requestWindows = new Map<string, number[]>();

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
  });
}

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 128);
}

function compact(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[\s.\-]/g, '');
}

function cleanText(value: unknown, maxLength = 500): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function evidenceText(result: SearchResult): string {
  return [result.description, ...(Array.isArray(result.extra_snippets) ? result.extra_snippets : [])]
    .map(value => cleanText(value, 500))
    .filter(Boolean)
    .join(' ')
    .slice(0, 1800);
}

function variantTitleSegment(value: string): boolean {
  const segment = cleanText(value, 60);
  return !!segment && /\d/.test(segment) && segment.length <= 60
    && !/^\d{8,14}$/.test(segment.replace(/[\s.\-]/g, ''))
    && !/^(?:19|20)\d{2}$/.test(segment);
}

function cleanTitle(value: unknown, code: string): string {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let title = cleanText(value, 180)
    .replace(new RegExp(escaped, 'gi'), ' ')
    .replace(/\b(?:EAN(?:-?13)?|GTIN(?:-?\d+)?|UPC(?:-?[AE])?|code[- ]?barres?|barcode)\b\s*[:#-]?/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[|:;,\-–—\s]+|[|:;,\-–—\s]+$/g, '')
    .trim();
  const segments = title.split(/\s*[|•]\s*|\s+[–—]\s+/).map(segment => segment.trim()).filter(Boolean);
  const first = segments[0];
  if (first && first.length >= 4) {
    title = [first, ...segments.slice(1).filter(variantTitleSegment).slice(0, 3)].join(' — ');
  }
  return title.length >= 4 ? title.slice(0, 180) : '';
}

function genericCatalogueTitle(value: string): boolean {
  const title = cleanText(value, 180).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return /^(?:accessories|accessoires|zubehor|catalog(?:ue)?|product catalog(?:ue)?|general catalog(?:ue)?)(?: \d{4})?$/.test(title)
    || /^(?:download|data sheet|datasheet|technical sheet|fiche technique)(?: \d{4})?$/.test(title);
}

function manufacturerReference(value: unknown, code: string): string | undefined {
  const text = cleanText(value, 1800);
  const labels = /\b(?:manufacturer\s+part\s+(?:number|no\.?|#)|part\s+(?:number|no\.?|#)|product\s+(?:number|no\.?|code)|order\s+(?:number|no\.?|code)|article\s+(?:number|no\.?|code)|catalog(?:ue)?\s+(?:number|no\.?|code)|reference\s+(?:du\s+produit|number|no\.?|code)?|réf(?:érence)?|ref(?:erence)?|modèle|model|mpn|sku|index)\s*[.:#-]?\s*/gi;
  for (const label of text.matchAll(labels)) {
    let remaining = text.slice((label.index ?? 0) + label[0].length, (label.index ?? 0) + label[0].length + 60);
    const tokens: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const token = remaining.match(/^([A-Z0-9][A-Z0-9._/-]*)\b/i)?.[1]?.replace(/[.,;:]+$/, '');
      if (!token || !/\d/.test(token)) break;
      tokens.push(token);
      remaining = remaining.slice(remaining.indexOf(token) + token.length).replace(/^\s+/, '');
    }
    const candidate = tokens.join(' ');
    if (candidate.length >= 3 && compact(candidate) !== compact(code)) return candidate;
  }
  return undefined;
}

function normalizedProductText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function variantDetails(value: unknown, code: string): string[] {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const text = String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(new RegExp(escaped, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 1800);
  const patterns = [
    /\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:mm|cm|m)?\b/gi,
    /\b\d+(?:[.,]\d+)?\s*(?:mm²|mm2|cm²|cm2|m²|m2|kwh|mah|ah|wh|kg|mg|g|ml|cl|l\/min|m\/min|nm|kn|n|mm|cm|m|kv|v|ka|a|kw|w|bar|kpa|mpa|hz|rpm|dba?)\b/gi,
    /\b(?:PZ|PH|TX|TORX)\s*[-:]?\s*\d+\b/gi,
    /\bDN\s*[-:]?\s*\d+(?:[.,]\d+)?\b/gi,
    /\b(?:IP|IK)\s*\d{2}\b/gi,
    /\b(?:lot|pack|bo[iî]te|carton|sachet|conditionnement)\s*(?:de\s*)?\d+\b/gi,
    /\b\d+\s*(?:pièces?|pcs?|unités?|pôles?|poles?)\b/gi,
    /\b\d+\s*P(?:\s*\+\s*\d+\s*P?)?\b/gi,
    /\b(?:M|Ø|diam(?:ètre)?|diameter)\s*[-:]?\s*\d+(?:[.,]\d+)?\b/gi,
  ];
  const details: string[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const detail = match[0].replace(/\s+/g, ' ').trim();
      if (!detail || details.some(existing => normalizedProductText(existing) === normalizedProductText(detail))) continue;
      details.push(detail);
    }
  }
  return details;
}

function hasVariant(value: string): boolean {
  const withoutYears = value.replace(/\b(?:19|20)\d{2}\b/g, ' ');
  return variantDetails(withoutYears, '').length > 0
    || /\b(?=[A-Z0-9./-]{3,}\b)(?=[A-Z0-9./-]*[A-Z])(?=[A-Z0-9./-]*\d)[A-Z0-9][A-Z0-9./-]*\b/i.test(withoutYears);
}

const btpBrandDomains: Array<[string, string]> = [
  ['legrand.', 'Legrand'], ['hager.', 'Hager'], ['grohe.', 'GROHE'], ['knipex.', 'KNIPEX'],
  ['wiha.', 'Wiha'], ['makita.', 'Makita'], ['bosch-professional.', 'Bosch Professional'],
  ['wera.', 'Wera'], ['hellermanntyton.', 'HellermannTyton'], ['rawlplug.', 'Rawlplug'],
  ['se.com', 'Schneider Electric'], ['wago.', 'WAGO'], ['hilti.', 'Hilti'], ['fischer.', 'fischer'],
  ['geberit.', 'Geberit'], ['dewalt.', 'DEWALT'],
];
const btpBrandAliases: Array<[string, string]> = [
  ['bosch', 'Bosch Professional'], ['hellermanntyton', 'HellermannTyton'],
  ['schneiderelectric', 'Schneider Electric'], ['legrand', 'Legrand'], ['hager', 'Hager'],
  ['grohe', 'GROHE'], ['knipex', 'KNIPEX'], ['wiha', 'Wiha'], ['makita', 'Makita'],
  ['wera', 'Wera'], ['rawlplug', 'Rawlplug'], ['wago', 'WAGO'], ['hilti', 'Hilti'],
  ['fischer', 'fischer'], ['geberit', 'Geberit'], ['dewalt', 'DEWALT'],
];

function inferBrand(result: SearchResult, url: URL, designation: string): string | undefined {
  const official = btpBrandDomains.find(([domain]) => url.hostname.toLowerCase().includes(domain));
  if (official) return official[1];
  const context = normalizedProductText(`${designation} ${result.profile?.long_name ?? ''}`);
  return btpBrandAliases.find(([alias]) => context.includes(alias))?.[1];
}

function selectMatch(results: SearchResult[], code: string) {
  const needle = compact(code);
  const ranked: Array<{
    designation: string;
    evidenceScore: number;
    score: number;
    url: URL;
    result: SearchResult;
    variantComplete: boolean;
  }> = [];
  for (const result of results) {
    let url: URL;
    try {
      url = new URL(String(result.url ?? ''));
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    if (blockedHosts.some(host => url.hostname.toLowerCase().includes(host))) continue;
    const evidence = evidenceText(result);
    const inTitle = compact(result.title).includes(needle);
    const inDescription = compact(evidence).includes(needle);
    const inUrl = compact(result.url).includes(needle);
    const evidenceScore = (inTitle ? 8 : 0) + (inDescription ? 4 : 0) + (inUrl ? 2 : 0);
    if (evidenceScore < 4) continue;

    let designation = cleanTitle(result.title, code);
    if (genericCatalogueTitle(designation)) continue;
    if (!designation || /^(product|produit|fiche produit|product sheet)$/i.test(designation)) {
      designation = cleanTitle(evidence.slice(0, 180).split(/[.!?](?:\s|$)/)[0], code);
    }
    if (!designation || genericCatalogueTitle(designation)) continue;
    const reference = manufacturerReference(evidence, code);
    if (reference
      && compact(reference) !== needle
      && !compact(designation).includes(compact(reference))) {
      designation = `${designation} — Réf. ${reference}`;
    }
    const details = variantDetails(evidence, code);
    let appendedDetails = 0;
    for (const detail of details) {
      if (normalizedProductText(designation).includes(normalizedProductText(detail))) continue;
      designation = `${designation} — ${detail}`;
      appendedDetails += 1;
      if (appendedDetails >= 3) break;
    }
    const variantComplete = Boolean(reference) || hasVariant(designation) || details.length > 0;
    const score = evidenceScore + (variantComplete ? 3 : 0) + (designation.length >= 12 ? 1 : 0);
    ranked.push({ designation, evidenceScore, score, url, result, variantComplete });
  }
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return best ? {
    barcode: code,
    designation: best.designation,
    brand: inferBrand(best.result, best.url, best.designation),
    photoUrl: best.result.thumbnail?.original ?? best.result.thumbnail?.src,
    source: 'web',
    sourceUrl: best.url.toString(),
    confidence: best.evidenceScore >= 8 || (best.evidenceScore >= 4 && best.variantComplete) ? 'high' : 'medium',
    variantComplete: best.variantComplete,
  } : null;
}

function authenticatedIdentity(request: Request): string | null {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const claims = JSON.parse(atob(padded));
    // The Supabase gateway validates the JWT signature because verify_jwt is
    // enabled. Requiring the authenticated role rejects the public anon JWT.
    return claims?.role === 'authenticated' && typeof claims?.sub === 'string'
      ? claims.sub
      : null;
  } catch {
    return null;
  }
}

function allowRequest(identity: string): boolean {
  const now = Date.now();
  const recent = (requestWindows.get(identity) ?? []).filter(time => now - time < 60_000);
  if (recent.length >= 20) return false;
  recent.push(now);
  requestWindows.set(identity, recent);
  return true;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  const identity = authenticatedIdentity(request);
  if (!identity) return json({ error: 'Session invalide', code: 'invalid_session' }, 401);
  if (!allowRequest(identity)) return json({ error: 'Trop de recherches' }, 429);

  try {
    const body = await request.json();
    const code = normalizeCode(body?.code);
    const language = String(body?.language ?? 'fr').split('-')[0].toLowerCase();
    if (code.length < 4) return json({ error: 'Code-barres invalide' }, 400);

    const search = await searchInventoryBarcodeWeb({
      code,
      language,
      tavilyApiKey: Deno.env.get('TAVILY_API_KEY'),
      serpApiKey: Deno.env.get('SERPAPI_API_KEY'),
    });
    const match = selectMatch(search.results, code);
    return match
      ? json({
        match,
        provider: search.provider,
        providersTried: search.providersTried,
        fallbackReason: search.fallbackReason,
      })
      : json({ error: 'Produit introuvable', code: 'product_not_found', provider: search.provider }, 404);
  } catch (error) {
    console.error('[inventory-barcode-lookup]', error);
    if (error instanceof InventoryWebSearchError) {
      const notConfigured = error.message.includes('configured');
      return json({
        error: notConfigured ? 'Recherche web non configurée' : 'Recherche web temporairement indisponible',
        code: notConfigured ? 'web_search_not_configured' : 'provider_unavailable',
        providerStatuses: error.providerStatuses,
      }, notConfigured ? 503 : 502);
    }
    return json({ error: 'Recherche web temporairement indisponible', code: 'provider_unavailable' }, 502);
  }
});
