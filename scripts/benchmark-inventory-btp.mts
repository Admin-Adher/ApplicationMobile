import {
  lookupOpenFactsCatalogs,
  selectWebSearchMatch,
  type InventoryBarcodeMatch,
} from '../lib/inventoryBarcodeCore.ts';
import { searchInventoryBarcodeWeb } from '../supabase/functions/_shared/inventoryWebSearchProviders.ts';
import { inventoryBtpBenchmark } from '../tests/fixtures/inventoryBtpBenchmark.ts';

const live = process.argv.includes('--live');
const tavilyKey = process.env.TAVILY_API_KEY ?? '';
const serpApiKey = process.env.SERPAPI_API_KEY ?? '';

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

if (live && !tavilyKey && !serpApiKey) {
  throw new Error('TAVILY_API_KEY ou SERPAPI_API_KEY est requis pour le benchmark --live. Les cles restent cote serveur.');
}

const rows: Array<Record<string, string>> = [];
for (const sample of inventoryBtpBenchmark) {
  const openMatch = live ? await lookupOpenFactsCatalogs(sample.gtin, { timeoutMs: 5_000 }) : null;
  const search = live ? await searchInventoryBarcodeWeb({
    code: sample.gtin,
    language: 'fr',
    tavilyApiKey: tavilyKey,
    serpApiKey,
    timeoutMs: 8_000,
  }) : null;
  const results = search?.results ?? sample.results;
  const webMatch = openMatch?.variantComplete ? null : selectWebSearchMatch(results, sample.gtin);
  const match = webMatch ?? openMatch;
  rows.push({
    marque: sample.brand,
    gtin: sample.gtin,
    trouve: match ? 'oui' : 'non',
    variante_precise: isExpectedVariant(match, sample.expectedTokens) ? 'oui' : 'non',
    source: search?.provider ?? match?.source ?? '-',
    designation: match?.designation ?? '-',
  });
}

console.table(rows);
const found = rows.filter(row => row.trouve === 'oui').length;
const precise = rows.filter(row => row.variante_precise === 'oui').length;
console.log(`${live ? 'LIVE' : 'FIXTURES'}: trouves ${found}/${rows.length}; variantes precises ${precise}/${rows.length}`);
if (found !== rows.length || precise !== rows.length) process.exitCode = 1;
