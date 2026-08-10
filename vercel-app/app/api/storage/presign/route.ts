import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { isR2Configured, presignR2Upload } from '@/lib/r2';
import { authenticateRequest, createServiceClient } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

// Reserve a tenant-owned registry object before issuing any upload target.
// The tenant and owner come only from the verified JWT/membership context.

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = [
    process.env.EXPO_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    'https://buildtrack-mobile.vercel.app',
    'http://localhost:5000',
    'http://localhost:3000',
  ].filter(Boolean) as string[];
  const corsOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);

  const supabase = createServiceClient();
  const auth = await authenticateRequest(req, supabase);
  if (!auth) {
    return NextResponse.json({ error: 'Session invalide' }, { status: 401, headers });
  }

  // Large : une visite chantier peut uploader des dizaines de photos d'un coup.
  const rate = checkRateLimit(`storage-presign:${auth.authority.userId}`, 240, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Trop d'uploads simultanés. Réessayez dans quelques instants." },
      { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind ?? '');
    if (kind !== 'photo' && kind !== 'document') {
      return NextResponse.json({ error: 'kind invalide (photo | document)' }, { status: 400, headers });
    }
    const filename = String(body?.filename ?? 'file');
    const contentType = String(body?.contentType ?? body?.content_type ?? '');
    const expectedSize = Number(body?.size ?? body?.expectedSize ?? 0);
    const provider = isR2Configured() ? 'r2' : 'supabase';
    const { data, error } = await auth.supabase.rpc('server_begin_media_upload', {
      p_user_id: auth.authority.userId,
      p_kind: kind,
      p_filename: filename,
      p_content_type: contentType,
      p_expected_size: expectedSize,
      p_provider: provider,
    });
    const reservation = Array.isArray(data) ? data[0] : data;
    if (error || !reservation) {
      return NextResponse.json({ error: error?.message ?? 'Réservation impossible' }, { status: 400, headers });
    }

    if (provider === 'r2') {
      const { uploadUrl, expiresIn } = await presignR2Upload(
        reservation.object_key,
        contentType,
      );
      return NextResponse.json({
        provider,
        assetId: reservation.asset_id,
        mediaRef: reservation.media_ref,
        bucket: reservation.bucket,
        objectKey: reservation.object_key,
        uploadUrl,
        expiresIn,
      }, { headers });
    }

    return NextResponse.json({
      provider,
      assetId: reservation.asset_id,
      mediaRef: reservation.media_ref,
      bucket: reservation.bucket,
      objectKey: reservation.object_key,
    }, { headers });
  } catch (err: any) {
    console.error('[storage presign]', err?.message ?? err);
    return NextResponse.json({ error: 'Présignature impossible' }, { status: 500, headers });
  }
}
