export type InventoryBarcodeLookupSource =
  | 'open-products-facts'
  | 'open-food-facts'
  | 'web';

export interface InventoryBarcodeMatch {
  barcode: string;
  designation: string;
  brand?: string;
  photoUrl?: string;
  source: InventoryBarcodeLookupSource;
  sourceUrl?: string;
  confidence: 'high' | 'medium';
  variantComplete: boolean;
}

export interface OpenFactsLookupOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  language?: string;
}

export interface WebSearchResult {
  title?: string;
  description?: string;
  url?: string;
  profile?: {
    long_name?: string;
  };
}

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const LOOKUP_CODE_MAX_LENGTH = 128;

function compactDigits(value: string): string {
  return value.replace(/[\s.\-]/g, '');
}

/**
 * Extracts a GTIN from common scanner values, including GS1 Digital Link and
 * GS1 application identifier (01) payloads. Returns undefined for non-GTIN
 * references such as an internal Code 128 value.
 */
export function extractGtin(value: string): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A malformed percent sequence is still a valid scanner payload.
  }

  const exact = compactDigits(decoded);
  if (/^\d+$/.test(exact) && GTIN_LENGTHS.has(exact.length)) return exact;

  const patterns = [
    /(?:^|\/)01\/(\d{14})(?:[/?#]|$)/i,
    /\(01\)\s*(\d{14})/i,
    /(?:^|[?&#])(?:gtin|ean|upc|barcode|code)=?(\d{8,14})(?:[&#]|$)/i,
    /(?:^|\]C1)01(\d{14})/i,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern)?.[1];
    if (match && GTIN_LENGTHS.has(match.length)) return match;
  }
  return undefined;
}

/** Keeps internal references searchable while normalizing recognized GTINs. */
export function normalizeBarcodeLookupCode(value: string): string {
  const raw = String(value ?? '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!raw) return '';
  return (extractGtin(raw) ?? raw).slice(0, LOOKUP_CODE_MAX_LENGTH);
}

export function isValidGtin(value: string): boolean {
  if (!/^\d+$/.test(value) || !GTIN_LENGTHS.has(value.length)) return false;
  const digits = [...value].map(Number);
  const checkDigit = digits.pop();
  if (checkDigit === undefined) return false;
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

/** Canonical 14-digit database representation used to compare GTIN variants. */
export function canonicalizeGtin(value: string): string | undefined {
  const gtin = extractGtin(value);
  return gtin && isValidGtin(gtin) ? gtin.padStart(14, '0') : undefined;
}

function cleanText(value: unknown, maxLength = 220): string {
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

function meaningfulName(value: unknown): string | undefined {
  const name = cleanText(value);
  if (!name || /^(unknown|inconnu|undefined|null|product)$/i.test(name)) return undefined;
  return name;
}

function normalizedProductText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function openFactsQuantity(product: any): string | undefined {
  const declared = meaningfulName(product?.quantity);
  if (declared) return declared;
  const amount = meaningfulName(product?.product_quantity);
  const unit = meaningfulName(product?.product_quantity_unit);
  return amount ? `${amount}${unit ? ` ${unit}` : ''}` : undefined;
}

export function parseOpenFactsProduct(
  payload: any,
  barcode: string,
  source: Extract<InventoryBarcodeLookupSource, 'open-products-facts' | 'open-food-facts'>,
  language = 'fr',
): InventoryBarcodeMatch | null {
  const product = payload?.product;
  if (!product || payload?.status === 0) return null;
  const lang = language.split('-')[0].toLowerCase();
  const baseDesignation = [
    product[`product_name_${lang}`],
    product.product_name,
    product[`generic_name_${lang}`],
    product.generic_name,
  ].map(meaningfulName).find(Boolean);
  if (!baseDesignation) return null;

  const quantity = openFactsQuantity(product);
  const designation = quantity
    && !normalizedProductText(baseDesignation).includes(normalizedProductText(quantity))
    ? `${baseDesignation} — ${quantity}`
    : baseDesignation;

  const host = source === 'open-products-facts'
    ? 'world.openproductsfacts.org'
    : 'world.openfoodfacts.org';
  const brand = meaningfulName(String(product.brands ?? '').split(',')[0]);
  const photoUrl = meaningfulName(product.image_front_url ?? product.image_url);

  return {
    barcode,
    designation,
    brand,
    photoUrl,
    source,
    sourceUrl: meaningfulName(product.url) ?? `https://${host}/product/${encodeURIComponent(barcode)}`,
    confidence: 'high',
    variantComplete: Boolean(quantity) || /\d/.test(baseDesignation),
  };
}

async function fetchOpenFactsProvider(
  host: string,
  source: Extract<InventoryBarcodeLookupSource, 'open-products-facts' | 'open-food-facts'>,
  barcode: string,
  options: Required<Pick<OpenFactsLookupOptions, 'fetchImpl' | 'timeoutMs'>> & Pick<OpenFactsLookupOptions, 'language'>,
): Promise<InventoryBarcodeMatch | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const fields = [
    'code', 'product_name', 'product_name_fr', 'product_name_en', 'product_name_es',
    'generic_name', 'generic_name_fr', 'generic_name_en', 'generic_name_es',
    'brands', 'quantity', 'product_quantity', 'product_quantity_unit',
    'image_url', 'image_front_url', 'url',
  ].join(',');

  try {
    const response = await options.fetchImpl(
      `https://${host}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`,
      { headers: { Accept: 'application/json' }, signal: controller.signal },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    return parseOpenFactsProduct(payload, barcode, source, options.language);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Queries both open databases concurrently and prefers the generic catalogue. */
export async function lookupOpenFactsCatalogs(
  value: string,
  options: OpenFactsLookupOptions = {},
): Promise<InventoryBarcodeMatch | null> {
  const barcode = extractGtin(value);
  if (!barcode || !isValidGtin(barcode)) return null;

  const resolvedOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? 4000,
    language: options.language ?? 'fr',
  };
  const [generic, food] = await Promise.all([
    fetchOpenFactsProvider(
      'world.openproductsfacts.org',
      'open-products-facts',
      barcode,
      resolvedOptions,
    ),
    fetchOpenFactsProvider(
      'world.openfoodfacts.org',
      'open-food-facts',
      barcode,
      resolvedOptions,
    ),
  ]);
  return generic ?? food;
}

const GENERIC_LOOKUP_HOSTS = [
  'barcodefinder.', 'barcodelookup.', 'gtinhub.', 'go-upc.', 'upcitemdb.',
  'openfoodfacts.', 'openproductsfacts.', 'google.', 'bing.', 'duckduckgo.',
];

function searchableText(value: string): string {
  return compactDigits(value.toLowerCase());
}

function resultContainsCode(result: WebSearchResult, code: string): {
  title: boolean;
  description: boolean;
  url: boolean;
} {
  const needle = searchableText(code);
  return {
    title: searchableText(cleanText(result.title)).includes(needle),
    description: searchableText(cleanText(result.description)).includes(needle),
    url: searchableText(cleanText(result.url)).includes(needle),
  };
}

export function cleanWebProductTitle(value: string, code: string): string {
  let title = cleanText(value, 180);
  if (!title) return '';
  title = title
    .replace(new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
    .replace(/\b(?:EAN(?:-?13)?|GTIN(?:-?\d+)?|UPC(?:-?[AE])?|code[- ]?barres?|barcode)\b\s*[:#-]?/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[|:;,\-–—\s]+|[|:;,\-–—\s]+$/g, '')
    .trim();

  const firstSegment = title.split(/\s+[|•]\s+|\s+[–—]\s+/)[0]?.trim();
  if (firstSegment && firstSegment.length >= 4) title = firstSegment;
  return title.length >= 4 ? title : '';
}

function safeWebUrl(value: unknown): string | undefined {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function extractManufacturerReference(value: unknown, scannedCode: string): string | undefined {
  const text = cleanText(value, 500);
  const match = text.match(/\b(?:réf(?:érence)?|ref(?:erence)?|modèle|model|article|mpn)\s*[.:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})\b/i)?.[1];
  if (!match || searchableText(match) === searchableText(scannedCode)) return undefined;
  return match;
}

const VARIANT_DETAIL_PATTERNS = [
  /\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:mm|cm|m)?\b/gi,
  /\b\d+(?:[.,]\d+)?\s*(?:mm²|mm2|cm²|cm2|m²|m2|kg|mg|g|ml|cl|l|mm|cm|m|kv|v|ka|a|kw|w|bar|kpa|mpa|hz)\b/gi,
  /\bDN\s*[-:]?\s*\d+(?:[.,]\d+)?\b/gi,
  /\b(?:IP|IK)\s*\d{2}\b/gi,
  /\b(?:lot|pack|bo[iî]te|carton|sachet|conditionnement)\s*(?:de\s*)?\d+\b/gi,
  /\b\d+\s*(?:pièces?|pcs?|unités?|pôles?|poles?)\b/gi,
  /\b\d+\s*P(?:\s*\+\s*\d+\s*P?)?\b/gi,
  /\b(?:M|Ø|diam(?:ètre)?|diameter)\s*[-:]?\s*\d+(?:[.,]\d+)?\b/gi,
];

/** Extracts visible pack, dimension and electrical/plumbing discriminators from a result snippet. */
export function extractVariantDetails(value: unknown, scannedCode: string): string[] {
  const escapedCode = scannedCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const text = cleanText(value, 500).replace(new RegExp(escapedCode, 'gi'), ' ');
  const details: string[] = [];
  for (const pattern of VARIANT_DETAIL_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const detail = cleanText(match[0], 60);
      if (!detail) continue;
      const normalized = normalizedProductText(detail);
      if (details.some(existing => normalizedProductText(existing) === normalized)) continue;
      details.push(detail);
    }
  }
  return details;
}

/**
 * Selects only a result whose title/snippet contains the exact scanned code.
 * This prevents a broad search result from silently becoming a product record.
 */
export function selectWebSearchMatch(
  results: WebSearchResult[],
  value: string,
): InventoryBarcodeMatch | null {
  const code = normalizeBarcodeLookupCode(value);
  if (!code || code.length < 4) return null;

  const ranked = results.map(result => {
    const url = safeWebUrl(result.url);
    if (!url) return null;
    const hostname = new URL(url).hostname.toLowerCase();
    if (GENERIC_LOOKUP_HOSTS.some(blocked => hostname.includes(blocked))) return null;
    const contains = resultContainsCode(result, code);
    const score = (contains.title ? 8 : 0) + (contains.description ? 4 : 0) + (contains.url ? 2 : 0);
    if (score < 4) return null;

    let designation = cleanWebProductTitle(result.title ?? '', code);
    if (!designation || /^(product|produit|fiche produit|product sheet)$/i.test(designation)) {
      const firstSentence = cleanText(result.description, 180).split(/[.!?](?:\s|$)/)[0] ?? '';
      designation = cleanWebProductTitle(firstSentence, code);
    }
    if (!designation) return null;
    const manufacturerReference = extractManufacturerReference(result.description, code);
    if (manufacturerReference
      && !searchableText(designation).includes(searchableText(manufacturerReference))) {
      designation = `${designation} — Réf. ${manufacturerReference}`;
    }
    let appendedDetails = 0;
    for (const detail of extractVariantDetails(result.description, code)) {
      if (normalizedProductText(designation).includes(normalizedProductText(detail))) continue;
      designation = `${designation} — ${detail}`;
      appendedDetails += 1;
      if (appendedDetails >= 2) break;
    }
    return { result, url, score, designation };
  }).filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;
  return {
    barcode: extractGtin(code) ?? code,
    designation: best.designation,
    source: 'web',
    sourceUrl: best.url,
    confidence: best.score >= 8 ? 'high' : 'medium',
    variantComplete: /\d/.test(best.designation),
  };
}
