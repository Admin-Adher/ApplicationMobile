import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

type SearchResult = {
  title?: string;
  description?: string;
  url?: string;
};

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

function cleanTitle(value: unknown, code: string): string {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let title = String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(new RegExp(escaped, 'gi'), ' ')
    .replace(/\b(?:EAN(?:-?13)?|GTIN(?:-?\d+)?|UPC(?:-?[AE])?|code[- ]?barres?|barcode)\b\s*[:#-]?/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[|:;,\-–—\s]+|[|:;,\-–—\s]+$/g, '')
    .trim();
  const first = title.split(/\s+[|•]\s+|\s+[–—]\s+/)[0]?.trim();
  if (first && first.length >= 4) title = first;
  return title.length >= 4 ? title.slice(0, 180) : '';
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
    .slice(0, 500);
  const patterns = [
    /\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:mm|cm|m)?\b/gi,
    /\b\d+(?:[.,]\d+)?\s*(?:mm²|mm2|cm²|cm2|m²|m2|kg|mg|g|ml|cl|l|mm|cm|m|kv|v|ka|a|kw|w|bar|kpa|mpa|hz)\b/gi,
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

function selectMatch(results: SearchResult[], code: string) {
  const needle = compact(code);
  const ranked: Array<{ designation: string; score: number; url: string }> = [];
  for (const result of results) {
    let url: URL;
    try {
      url = new URL(String(result.url ?? ''));
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    if (blockedHosts.some(host => url.hostname.toLowerCase().includes(host))) continue;
    const inTitle = compact(result.title).includes(needle);
    const inDescription = compact(result.description).includes(needle);
    const inUrl = compact(result.url).includes(needle);
    const score = (inTitle ? 8 : 0) + (inDescription ? 4 : 0) + (inUrl ? 2 : 0);
    if (score < 4) continue;

    let designation = cleanTitle(result.title, code);
    if (!designation || /^(product|produit|fiche produit|product sheet)$/i.test(designation)) {
      designation = cleanTitle(String(result.description ?? '').split(/[.!?](?:\s|$)/)[0], code);
    }
    if (!designation) continue;
    const manufacturerReference = String(result.description ?? '')
      .match(/\b(?:réf(?:érence)?|ref(?:erence)?|modèle|model|article|mpn)\s*[.:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})\b/i)?.[1];
    if (manufacturerReference
      && compact(manufacturerReference) !== needle
      && !compact(designation).includes(compact(manufacturerReference))) {
      designation = `${designation} — Réf. ${manufacturerReference}`;
    }
    let appendedDetails = 0;
    for (const detail of variantDetails(result.description, code)) {
      if (normalizedProductText(designation).includes(normalizedProductText(detail))) continue;
      designation = `${designation} — ${detail}`;
      appendedDetails += 1;
      if (appendedDetails >= 2) break;
    }
    ranked.push({ designation, score, url: url.toString() });
  }
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return best ? {
    barcode: code,
    designation: best.designation,
    source: 'web',
    sourceUrl: best.url,
    confidence: best.score >= 8 ? 'high' : 'medium',
    variantComplete: /\d/.test(best.designation),
  } : null;
}

function requestIdentity(request: Request): string {
  const auth = request.headers.get('authorization') ?? '';
  return auth.slice(-48) || 'anonymous';
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
  if (!allowRequest(requestIdentity(request))) return json({ error: 'Trop de recherches' }, 429);

  try {
    const body = await request.json();
    const code = normalizeCode(body?.code);
    const language = String(body?.language ?? 'fr').split('-')[0].toLowerCase();
    if (code.length < 4) return json({ error: 'Code-barres invalide' }, 400);

    const apiKey = Deno.env.get('BRAVE_SEARCH_API_KEY');
    if (!apiKey) return json({ error: 'Recherche web non configurée', code: 'web_search_not_configured' }, 503);
    const locale = language === 'es'
      ? { country: 'es', searchLang: 'es' }
      : language === 'en'
        ? { country: 'us', searchLang: 'en' }
        : { country: 'fr', searchLang: 'fr' };
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
        headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Brave Search HTTP ${response.status}`);
      const results = Array.isArray(payload?.web?.results) ? payload.web.results : [];
      const match = selectMatch(results, code);
      return match ? json({ match }) : json({ error: 'Produit introuvable' }, 404);
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error('[inventory-barcode-lookup]', error);
    return json({ error: 'Recherche web temporairement indisponible' }, 502);
  }
});
