import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { isR2Configured, deleteR2Object } from '@/lib/r2';
import { authenticateRequest, createUserScopedClient, enforcePrivateMediaClient } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Delete by registry identity and linked resource, never by caller-supplied URL
// or raw object key. Physical deletion occurs only after the last link is gone.

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BuildTrack-Client, X-BuildTrack-Client-Version, X-BuildTrack-Build, X-BuildTrack-Media-Protocol',
  };
}

const MANAGER_ROLES = new Set(['admin', 'super_admin', 'conducteur']);
const RESOURCE_TABLES = new Set([
  'photos', 'documents', 'site_plans', 'regulatory_docs', 'incidents',
  'inventory_products', 'visites', 'messages', 'reserves',
]);

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

  const rate = checkRateLimit(`storage-delete:${auth.authority.userId}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Trop de suppressions. Réessayez dans quelques instants.' },
      { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const links: any[] = Array.isArray(body?.links) ? body.links : [];
    if (links.length === 0 || links.length > 100) {
      return NextResponse.json({ error: 'links requis (1 à 100)' }, { status: 400, headers });
    }

    const userClient = createUserScopedClient(auth.token);
    if (!userClient) return NextResponse.json({ error: 'Configuration serveur manquante' }, { status: 503, headers });
    let deleted = 0;
    let unlinked = 0;
    const errors: string[] = [];
    for (const link of links) {
      const assetId = String(link?.assetId ?? '');
      const resourceType = String(link?.resourceType ?? '');
      const resourceId = String(link?.resourceId ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(assetId) || !RESOURCE_TABLES.has(resourceType) || !resourceId) {
        errors.push('Lien invalide');
        continue;
      }
      const canManageResource = MANAGER_ROLES.has(auth.authority.role)
        || (
          resourceType === 'inventory_products'
          && (auth.authority.role === 'magasinier'
            || auth.authority.permissionsOverride.canManageInventoryProducts === true)
        );
      if (!canManageResource) {
        errors.push(`${assetId}: droit de suppression absent`);
        continue;
      }

      const { data: visible } = await userClient.from(resourceType).select('id').eq('id', resourceId).maybeSingle();
      if (!visible?.id) {
        errors.push(`${assetId}: ressource inaccessible`);
        continue;
      }
      const { data: rows, error } = await auth.supabase.rpc('server_unlink_media_asset', {
        p_user_id: auth.authority.userId,
        p_asset_id: assetId,
        p_resource_type: resourceType,
        p_resource_id: resourceId,
      });
      const object = Array.isArray(rows) ? rows[0] : rows;
      if (error || !object) {
        errors.push(`${assetId}: ${error?.message ?? 'unlink impossible'}`);
        continue;
      }
      unlinked += 1;
      if (!object.should_delete) continue;

      let removed = false;
      if (object.provider === 'r2') {
        if (!isR2Configured()) {
          errors.push(`${assetId}: R2 non configuré`);
          continue;
        }
        removed = (await deleteR2Object(object.object_key)).ok;
      } else {
        const result = await auth.supabase.storage.from(object.bucket).remove([object.object_key]);
        removed = !result.error;
      }
      if (removed) {
        await auth.supabase.rpc('server_mark_media_deleted', { p_asset_id: assetId });
        deleted += 1;
      } else {
        errors.push(`${assetId}: suppression physique en attente`);
      }
    }
    if (errors.length) console.warn('[storage delete] échecs:', errors.slice(0, 5).join(' | '));
    return NextResponse.json({ ok: errors.length === 0, deleted, unlinked, failed: errors.length }, { headers });
  } catch (err: any) {
    console.error('[storage delete]', err?.message ?? err);
    return NextResponse.json({ error: 'Suppression impossible' }, { status: 500, headers });
  }
}
