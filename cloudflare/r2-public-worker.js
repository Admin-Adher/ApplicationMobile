// BuildTrack legacy public-R2 retirement worker.
//
// Deploy this only after the btmedia-compatible minimum client version is
// enforced and server-side resolution is healthy. It intentionally never
// reads the R2 binding: all authorized reads use short-lived signed S3 URLs.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }
    return new Response(request.method === 'HEAD' ? null : 'Legacy public media access retired', {
      status: 410,
      headers: CORS_HEADERS,
    });
  },
};
