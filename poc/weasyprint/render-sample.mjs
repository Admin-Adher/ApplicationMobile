import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const inputPath = path.resolve(process.argv[2] ?? path.join(__dirname, 'samples', 'complex-reserves.html'));
const outputPath = path.resolve(process.argv[3] ?? path.join(__dirname, 'out', 'weasyprint-complex-reserves.pdf'));
const serviceUrl = process.env.WEASYPRINT_URL ?? 'http://127.0.0.1:8010/render';

const html = await readFile(inputPath, 'utf8');
await mkdir(path.dirname(outputPath), { recursive: true });

const samplesDir = path.resolve(__dirname, 'samples');
const inputInsideSamples = inputPath === samplesDir || inputPath.startsWith(samplesDir + path.sep);
const baseUrl = process.env.WEASYPRINT_BASE_URL ?? (inputInsideSamples ? 'file:///work/samples/' : undefined);

const response = await fetch(serviceUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    html,
    filename: path.basename(outputPath),
    ...(baseUrl ? { baseUrl } : {}),
  }),
});

if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`WeasyPrint render failed (${response.status}): ${errorText}`);
}

const pdfBuffer = Buffer.from(await response.arrayBuffer());
await writeFile(outputPath, pdfBuffer);

console.log(`PDF WeasyPrint genere: ${outputPath}`);
console.log(`Taille: ${(pdfBuffer.length / 1024).toFixed(1)} Ko`);
