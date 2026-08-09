import {
  lookupOpenFactsCatalogs,
  selectWebSearchMatch,
  type InventoryBarcodeMatch,
  type WebSearchResult,
} from '../lib/inventoryBarcodeCore.ts';
import { inventoryBtpBenchmark } from '../tests/fixtures/inventoryBtpBenchmark.ts';

const live = process.argv.includes('--live');
const braveKey = process.env.BRAVE_SEARCH_API_KEY ?? '';

function normalized(value: string): string {
  return value.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function isExpectedVariant(match: InventoryBarcodeMatch | null, expectedTokens: string[]): boolean {
  if (!match?.variantComplete) return false;
  const designation = normalized(match.designation);
  return expectedTokens.every(token => designation.includes(normalized(token)));
}

async function braveResults(code: string): Promise<WebSearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', `"${code}"`);
  url.searchParams.set('count', '20');
  url.searchParams.set('ui_lang', 'fr-FR');
  url.searchParams.set('safesearch', 'moderate');
  url.searchParams.set('spellcheck', 'false');
  url.searchParams.set('extra_snippets', 'true');
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Brave Search HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.web?.results) ? payload.web.results : [];
}

if (live && !braveKey) {
  throw new Error('BRAVE_SEARCH_API_KEY est requis pour le benchmark --live. La cle ne doit rester que cote serveur.');
}

const rows: Array<Record<string, string>> = [];
for (const sample of inventoryBtpBenchmark) {
  const openMatch = live ? await lookupOpenFactsCatalogs(sample.gtin, { timeoutMs: 5_000 }) : null;
  const results = live ? await braveResults(sample.gtin) : sample.results;
  const webMatch = openMatch?.variantComplete ? null : selectWebSearchMatch(results, sample.gtin);
  const match = webMatch ?? openMatch;
  rows.push({
    marque: sample.brand,
    gtin: sample.gtin,
    trouve: match ? 'oui' : 'non',
    variante_precise: isExpectedVariant(match, sample.expectedTokens) ? 'oui' : 'non',
    source: match?.source ?? '-',
    designation: match?.designation ?? '-',
  });
}

console.table(rows);
const found = rows.filter(row => row.trouve === 'oui').length;
const precise = rows.filter(row => row.variante_precise === 'oui').length;
console.log(`${live ? 'LIVE' : 'FIXTURES'}: trouves ${found}/${rows.length}; variantes precises ${precise}/${rows.length}`);
if (found !== rows.length || precise !== rows.length) process.exitCode = 1;
