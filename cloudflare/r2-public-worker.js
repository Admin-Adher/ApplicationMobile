// ─────────────────────────────────────────────────────────────────────────────
// BuildTrack — Worker public de lecture du bucket R2
//
// Sert les fichiers du bucket R2 (photos, documents) en lecture seule sur
// l'URL *.workers.dev du Worker — aucune zone/domaine Cloudflare nécessaire.
// C'est l'hôte à mettre dans R2_PUBLIC_BASE_URL côté Vercel.
//
// Déploiement (dashboard Cloudflare, ~2 min) :
//   1. Workers & Pages → Create → Worker → coller ce fichier.
//   2. Settings → Bindings → R2 bucket : variable « FILES » → votre bucket.
//   3. Noter l'URL https://<nom>.<compte>.workers.dev
//
// Garanties :
//   - GET/HEAD/OPTIONS uniquement (lecture seule — l'écriture passe par les
//     URLs présignées S3, jamais par ce Worker).
//   - Cache navigateur agressif (les noms de fichiers sont uniques/horodatés,
//     jamais réécrits → immutable).
//   - CORS « * » : nécessaire pour l'annotateur photo (canvas) et les PDF.
//   - Anti-XSS : les types html/svg/xml/js sont neutralisés en octet-stream
//     (le bucket ne doit servir que des médias, pas des pages).
// ─────────────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Type, ETag',
};

function safeContentType(raw) {
  const type = String(raw || 'application/octet-stream').toLowerCase();
  if (/html|svg|xml|javascript|ecmascript/.test(type)) {
    return 'application/octet-stream';
  }
  return type;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!key) {
      return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    }

    const object = await env.FILES.get(key);
    if (!object) {
      return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    }

    const headers = new Headers(CORS_HEADERS);
    headers.set('Content-Type', safeContentType(object.httpMetadata?.contentType));
    headers.set('Content-Length', String(object.size));
    headers.set('ETag', object.httpEtag);
    // Les clés sont uniques (timestamp + compteur) et jamais réécrites.
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Disposition', 'inline');

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }
    return new Response(object.body, { status: 200, headers });
  },
};
