import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { authenticateRequest } from '@/lib/server-auth';
import { headR2Object } from '@/lib/r2';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = [
    process.env.EXPO_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    'https://buildtrack-mobile.vercel.app',
    'http://localhost:5000',
    'http://localhost:3000',
  ].filter(Boolean) as string[];
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: 'Session invalide' }, { status: 401, headers });

  const rate = checkRateLimit(`storage-complete:${auth.authority.userId}`, 240, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Trop de validations' }, {
      status: 429,
      headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) },
    });
  }

  const body = await req.json().catch(() => ({}));
  const assetId = String(body?.assetId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) {
    return NextResponse.json({ error: 'assetId invalide' }, { status: 400, headers });
  }
  const mediaRef = `btmedia://${assetId}`;
  const { data: rows, error: candidateError } = await auth.supabase.rpc('server_get_media_candidates', {
    p_user_id: auth.authority.userId,
    p_refs: [mediaRef],
  });
  const asset = Array.isArray(rows) ? rows[0] : rows;
  if (candidateError || !asset || asset.owner_user_id !== auth.authority.userId) {
    return NextResponse.json({ error: 'Média introuvable' }, { status: 404, headers });
  }

  let size: number | undefined;
  let etag: string | undefined;
  let actualContentType: string | undefined;
  if (asset.provider === 'r2') {
    const result = await headR2Object(asset.object_key);
    if (!result.ok) return NextResponse.json({ error: 'Upload R2 incomplet' }, { status: 409, headers });
    size = result.size;
    etag = result.etag;
    actualContentType = result.contentType;
  } else {
    const { data, error } = await auth.supabase.storage.from(asset.bucket).info(asset.object_key);
    if (error || !data) return NextResponse.json({ error: 'Upload Supabase incomplet' }, { status: 409, headers });
    size = Number(data.metadata?.size ?? data.metadata?.contentLength ?? 0);
    etag = String(data.metadata?.eTag ?? data.metadata?.etag ?? '') || undefined;
    actualContentType = String(data.metadata?.mimetype ?? data.metadata?.contentType ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase() || undefined;
  }
  if (!size || size <= 0) {
    return NextResponse.json({ error: 'Taille du média indéterminée' }, { status: 409, headers });
  }
  const expectedContentType = String(asset.content_type ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (expectedContentType && actualContentType && actualContentType !== expectedContentType) {
    return NextResponse.json({ error: 'Type du média différent de la réservation' }, { status: 409, headers });
  }

  const { data: completed, error: completeError } = await auth.supabase.rpc('server_complete_media_upload', {
    p_user_id: auth.authority.userId,
    p_asset_id: assetId,
    p_actual_size: size,
    p_etag: etag ?? null,
  });
  if (completeError || completed !== true) {
    return NextResponse.json({ error: completeError?.message ?? 'Validation impossible' }, { status: 409, headers });
  }
  return NextResponse.json({ ok: true, mediaRef, size }, { headers });
}
