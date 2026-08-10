import type { AuthenticatedRequest } from '@/lib/server-auth';
import { createUserScopedClient } from '@/lib/server-auth';
import { presignR2Read } from '@/lib/r2';

const RESOURCE_TABLES = new Set([
  'photos',
  'documents',
  'site_plans',
  'regulatory_docs',
  'incidents',
  'inventory_products',
  'visites',
  'messages',
  'reserves',
]);

export type ResolvedPrivateMedia = {
  ref: string;
  assetId: string;
  url: string;
  expiresAt: number;
};

export function isRegistryBackedMediaRef(value: unknown): value is string {
  const ref = String(value ?? '').trim();
  return /^btmedia:\/\/[0-9a-f-]{36}$/i.test(ref)
    || /\/storage\/v1\/object\/public\/(photos|documents)\//i.test(ref)
    || /buildtrack-files\.[^/]*workers\.dev/i.test(ref);
}

export async function resolveAuthorizedMediaRefs(
  auth: AuthenticatedRequest,
  inputRefs: string[],
  expiresIn = 600,
): Promise<ResolvedPrivateMedia[]> {
  const refs = Array.from(new Set(
    inputRefs.map(value => String(value ?? '').trim()).filter(Boolean),
  )).slice(0, 100);
  if (refs.length === 0) return [];

  const { data, error } = await auth.supabase.rpc('server_get_media_candidates', {
    p_user_id: auth.authority.userId,
    p_refs: refs,
  });
  if (error) throw error;
  const candidates = Array.isArray(data) ? data : [];
  const userClient = createUserScopedClient(auth.token);
  if (!userClient) throw new Error('Configuration serveur manquante');

  const visibleLinks = new Set<string>();
  const linksByTable = new Map<string, Set<string>>();
  for (const row of candidates) {
    const table = String(row.resource_type ?? '');
    const id = String(row.resource_id ?? '');
    if (!RESOURCE_TABLES.has(table) || !id) continue;
    const ids = linksByTable.get(table) ?? new Set<string>();
    ids.add(id);
    linksByTable.set(table, ids);
  }
  await Promise.all(Array.from(linksByTable.entries()).map(async ([table, ids]) => {
    const { data: visible, error: visibilityError } = await userClient
      .from(table)
      .select('id')
      .in('id', Array.from(ids));
    if (visibilityError) return;
    for (const row of visible ?? []) visibleLinks.add(`${table}:${String(row.id)}`);
  }));

  const byAsset = new Map<string, any[]>();
  for (const row of candidates) {
    if (row.status !== 'ready' && row.status !== 'legacy') continue;
    const rows = byAsset.get(row.asset_id) ?? [];
    rows.push(row);
    byAsset.set(row.asset_id, rows);
  }

  const assets = await Promise.all(Array.from(byAsset.values()).map(async rows => {
    const asset = rows[0];
    if (!rows.some(row => visibleLinks.has(`${row.resource_type}:${row.resource_id}`))) return null;
    let url = '';
    if (asset.provider === 'r2') {
      url = (await presignR2Read(asset.object_key, expiresIn)).url;
    } else {
      const { data: signed, error: signError } = await auth.supabase.storage
        .from(asset.bucket)
        .createSignedUrl(asset.object_key, expiresIn);
      if (signError) return null;
      url = signed?.signedUrl ?? '';
    }
    if (!url) return null;
    const requestedRef = refs.find(ref =>
      ref === `btmedia://${asset.asset_id}`
      || ref.split('?')[0] === asset.legacy_url
      || ref.replace(/^\/?(photos|documents)\//i, '').split('?')[0] === asset.object_key,
    ) ?? `btmedia://${asset.asset_id}`;
    return {
      ref: requestedRef,
      assetId: String(asset.asset_id),
      url,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }));
  return assets.filter((asset): asset is ResolvedPrivateMedia => Boolean(asset));
}

export function collectRegistryMediaRefs(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (isRegistryBackedMediaRef(value)) output.add(value.trim());
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectRegistryMediaRefs(item, output));
    return output;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(item => collectRegistryMediaRefs(item, output));
  }
  return output;
}

export function replaceResolvedMediaRefs(value: unknown, urls: Map<string, string>): unknown {
  if (typeof value === 'string') return urls.get(value) ?? value;
  if (Array.isArray(value)) return value.map(item => replaceResolvedMediaRefs(item, urls));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, replaceResolvedMediaRefs(item, urls)]),
    );
  }
  return value;
}
