import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const CORE = /^tesseract-core-(?:relaxedsimd-|simd-)?lstm\.wasm(?:\.js)?$/;
const LANGUAGE = /^(eng|fra|spa)\.traineddata\.gz$/;

export async function GET(_request: Request, { params }: { params: Promise<{ version: string; asset: string }> }) {
  const { version, asset } = await params;
  if (version !== '7.0.0') return new Response(null, { status: 404 });
  let file: string;
  let type: string;
  if (asset === 'worker.min.js') {
    file = path.join('tesseract.js', 'dist', asset);
    type = 'application/javascript';
  } else if (CORE.test(asset)) {
    file = path.join('tesseract.js-core', asset);
    type = asset.endsWith('.js') ? 'application/javascript' : 'application/wasm';
  } else {
    const language = LANGUAGE.exec(asset)?.[1];
    if (!language) return new Response(null, { status: 404 });
    file = path.join('@tesseract.js-data', language, '4.0.0_best_int', asset);
    type = 'application/octet-stream';
  }
  try {
    const content = await readFile(path.join(process.cwd(), 'node_modules', file));
    return new Response(new Uint8Array(content), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
