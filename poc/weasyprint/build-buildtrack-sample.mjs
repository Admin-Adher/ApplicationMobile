import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const buildDir = path.join(__dirname, '.tmp', 'build');
const outputPath = path.resolve(process.argv[2] ?? path.join(__dirname, 'out', 'buildtrack-global-reserves.html'));

function svgDataUri(label, tone) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${tone}"/>
        <stop offset="1" stop-color="#ffcb00"/>
      </linearGradient>
    </defs>
    <rect width="900" height="600" rx="28" fill="#eef3fa"/>
    <rect x="44" y="44" width="812" height="512" rx="22" fill="url(#g)" opacity=".88"/>
    <path d="M90 438h720" stroke="rgba(255,255,255,.75)" stroke-width="26" stroke-linecap="round"/>
    <path d="M150 170h260M150 230h450M150 290h330" stroke="rgba(255,255,255,.55)" stroke-width="18" stroke-linecap="round"/>
    <text x="90" y="515" fill="#fff" font-family="Arial, sans-serif" font-size="44" font-weight="700">${label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const samplePhotos = [
  svgDataUri('Constat plafond', '#003082'),
  svgDataUri('Detail joint', '#dc2626'),
  svgDataUri('Vue circulation', '#059669'),
];

const statuses = ['open', 'in_progress', 'waiting', 'verification', 'closed'];
const priorities = ['critical', 'high', 'medium', 'low'];
const companies = ['ACUARIO', 'AISLANTE y TECHOS', 'BOUY GTC', 'GMD'];
const buildings = ['Batiment A', 'Batiment B', 'Batiment C'];
const levels = ['SS1', 'RDC', 'R+1', 'R+2', 'Toiture'];
const titles = [
  'Faux plafond perce autour du spot',
  'Joint coupe-feu incomplet',
  'Reprise peinture tableau electrique',
  'Protection angle absente',
  'Calfeutrement trappe a reprendre',
  'Nettoyage gaine technique avant reception',
  'Reprise seuil porte local technique',
  'Reservation mal rebouchee sur voile beton',
  'Etiquetage reseau absent',
  'Trace humidite sous faux plancher',
  'Finition plinthe a reprendre',
  'Protection chantier retiree trop tot',
];

function buildReserve(index) {
  const priority = priorities[index % priorities.length];
  const status = statuses[index % statuses.length];
  const critical = priority === 'critical';
  return {
    id: `RSV-${477 + index}-${String(index + 11).padStart(2, '0')}`,
    num: 477 + index,
    title: titles[index % titles.length],
    company: companies[index % companies.length],
    building: buildings[index % buildings.length],
    level: levels[index % levels.length],
    status,
    priority,
    deadline: status === 'closed' ? '' : `${String((index % 20) + 1).padStart(2, '0')}/06/2026`,
    description: critical
      ? 'Intervention prioritaire demandee avant la prochaine visite de controle. Ajouter photo avant/apres et commentaire de levee.'
      : 'Reserve constatee pendant la visite terrain. Reprise attendue avec controle visuel et validation conducteur travaux.',
    photos: index % 3 === 0
      ? [{ uri: samplePhotos[0] }, { uri: samplePhotos[1] }, { uri: samplePhotos[2] }]
      : index % 2 === 0
        ? [{ uri: samplePhotos[index % samplePhotos.length] }]
        : [],
  };
}

async function compileTsModule(sourceRelativePath, outputRelativePath, replacements = []) {
  const sourcePath = path.join(repoRoot, sourceRelativePath);
  const outputFile = path.join(buildDir, outputRelativePath);
  let source = await readFile(sourcePath, 'utf8');
  for (const [from, to] of replacements) {
    source = source.replaceAll(from, to);
  }
  const result = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourcePath,
  });
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, result.outputText, 'utf8');
}

await rm(buildDir, { recursive: true, force: true });
await compileTsModule('constants/colors.ts', 'constants/colors.js');
await compileTsModule('lib/reserveDescription.ts', 'lib/reserveDescription.js');
await compileTsModule('lib/reserveLabels.ts', 'lib/reserveLabels.js', [
  ["@/constants/colors", "../constants/colors"],
]);
await compileTsModule('vercel-app/lib/reportBuilder.ts', 'vercel-app/lib/reportBuilder.js', [
  ["@/lib/reserveLabels", "../../lib/reserveLabels"],
  ["@/lib/reserveDescription", "../../lib/reserveDescription"],
]);

const require = createRequire(import.meta.url);
const { buildGlobalReservesHtml } = require(path.join(buildDir, 'vercel-app', 'lib', 'reportBuilder.js'));

const payload = {
  type: 'global_reserves',
  chantierName: 'Tropicalia',
  companyFilter: null,
  generatedAt: '2026-05-30T10:30:00.000Z',
  language: 'fr',
  reserves: Array.from({ length: 18 }, (_, index) => buildReserve(index)),
};

const html = buildGlobalReservesHtml(payload);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, html, 'utf8');

console.log(`HTML BuildTrack genere: ${outputPath}`);
console.log('Rendre avec:');
console.log(`node render-sample.mjs "${outputPath}" "${path.join(path.dirname(outputPath), 'buildtrack-global-reserves-weasyprint.pdf')}"`);
