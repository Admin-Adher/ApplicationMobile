import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from '@/lib/rateLimit';
import { isR2Configured, deleteR2Object, r2KeyFromPublicUrl } from '@/lib/r2';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Suppression de fichiers R2 à partir de leurs URLs publiques. Les clients
// envoient toutes les URLs à purger : seules celles hébergées sur notre hôte
// public R2 sont traitées (les URLs Supabase restent gérées côté client via
// storage.remove, comme avant). Réservé aux rôles de gestion — la suppression
// est destructive et ne concerne que les flux d'administration.

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

const MANAGER_ROLES = new Set(['admin', 'super_admin', 'conducteur']);

async function authenticatedManager(req: NextRequest) {
  const supabase = serviceClient();
  if (!supabase) return null;
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();
  if (!profile || !MANAGER_ROLES.has(String(profile.role ?? ''))) return null;
  return profile;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);

  if (!isR2Configured()) {
    return NextResponse.json({ ok: true, deleted: 0, skipped: 0 }, { headers });
  }

  const profile = await authenticatedManager(req);
  if (!profile) {
    return NextResponse.json({ error: 'Accès réservé aux rôles de gestion' }, { status: 403, headers });
  }

  const rate = checkRateLimit(`storage-delete:${profile.id}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Trop de suppressions. Réessayez dans quelques instants.' },
      { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const urls: unknown[] = Array.isArray(body?.urls) ? body.urls : [];
    if (urls.length === 0 || urls.length > 100) {
      return NextResponse.json({ error: 'urls requis (1 à 100)' }, { status: 400, headers });
    }

    let deleted = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const url of urls) {
      const key = r2KeyFromPublicUrl(String(url ?? ''));
      if (!key) { skipped += 1; continue; }
      const result = await deleteR2Object(key);
      if (result.ok) deleted += 1;
      else errors.push(`${key}: ${result.error}`);
    }
    if (errors.length) console.warn('[storage delete] échecs:', errors.slice(0, 5).join(' | '));
    return NextResponse.json({ ok: true, deleted, skipped, failed: errors.length }, { headers });
  } catch (err: any) {
    console.error('[storage delete]', err?.message ?? err);
    return NextResponse.json({ error: 'Suppression impossible' }, { status: 500, headers });
  }
}
