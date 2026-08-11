import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { authenticateRequest, enforcePrivateMediaClient } from '@/lib/server-auth';
import { resolveAuthorizedMediaRefs } from '@/lib/private-media-server';

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BuildTrack-Client, X-BuildTrack-Client-Version, X-BuildTrack-Build, X-BuildTrack-Media-Protocol',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: 'Session invalide' }, { status: 401, headers });
  const clientGate = await enforcePrivateMediaClient(req, auth.supabase);
  if (!clientGate.allowed) {
    return NextResponse.json({ error: clientGate.reason, ...clientGate }, { status: clientGate.status, headers });
  }

  const rate = checkRateLimit(`storage-resolve:${auth.authority.userId}`, 180, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Trop de résolutions' }, {
      status: 429,
      headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) },
    });
  }

  const body = await req.json().catch(() => ({}));
  const refs: string[] = Array.from(new Set<string>(
    (Array.isArray(body?.refs) ? body.refs : [])
      .map((value: unknown) => String(value ?? '').trim())
      .filter(Boolean),
  )).slice(0, 100);
  if (refs.length === 0) return NextResponse.json({ assets: [] }, { headers });

  try {
    const assets = await resolveAuthorizedMediaRefs(auth, refs, 600);
    return NextResponse.json({ assets }, {
      headers: { ...headers, 'Cache-Control': 'private, no-store' },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Résolution impossible' }, { status: 400, headers });
  }
}
