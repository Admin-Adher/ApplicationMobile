import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from '@/lib/rateLimit';
import { isR2Configured, presignR2Upload } from '@/lib/r2';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

// URL présignée PUT vers Cloudflare R2. Le client uploade ensuite directement
// vers R2 (aucun octet ne transite par Vercel), puis stocke publicUrl en base.
// Si R2 n'est pas configuré → 503, et les clients retombent sur Supabase
// Storage (chemin historique) : la route est déployable avant le bucket.

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

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function authenticatedUserId(req: NextRequest): Promise<string | null> {
  const supabase = serviceClient();
  if (!supabase) return null;
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return null;
  return userId;
}

// Préfixes de clé alignés sur les buckets Supabase historiques.
const KIND_PREFIX: Record<string, string> = {
  photo: 'photos',
  document: 'documents',
};

// Compteur module pour garantir l'unicité même en rafale (sync offline).
let uploadSeq = 0;

function sanitizeFilename(value: unknown): string {
  const name = String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return name || 'fichier';
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);

  if (!isR2Configured()) {
    return NextResponse.json(
      { error: 'Stockage R2 non configuré' },
      { status: 503, headers }
    );
  }

  const userId = await authenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Session invalide' }, { status: 401, headers });
  }

  // Large : une visite chantier peut uploader des dizaines de photos d'un coup.
  const rate = checkRateLimit(`storage-presign:${userId}`, 240, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Trop d'uploads simultanés. Réessayez dans quelques instants." },
      { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind ?? '');
    const prefix = KIND_PREFIX[kind];
    if (!prefix) {
      return NextResponse.json({ error: 'kind invalide (photo | document)' }, { status: 400, headers });
    }
    const filename = sanitizeFilename(body?.filename);
    const key = `${prefix}/${Date.now()}_${++uploadSeq}_${filename}`;
    const presigned = await presignR2Upload(key);
    return NextResponse.json({ ...presigned, key }, { headers });
  } catch (err: any) {
    console.error('[storage presign]', err?.message ?? err);
    return NextResponse.json({ error: 'Présignature impossible' }, { status: 500, headers });
  }
}
