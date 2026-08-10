import { AwsClient } from 'aws4fetch';

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare R2 — stockage de fichiers (photos, plans, documents).
//
// Architecture « hybride » :
//   - Écriture : le client (mobile/web) demande une URL présignée PUT à
//     /api/storage/presign (auth Bearer), puis uploade directement vers
//     l'endpoint S3 de R2. Aucun octet ne transite par Vercel.
//   - Lecture : l'API canonique vérifie le tenant et la ressource, puis émet
//     une URL S3 GET de courte durée. Aucune URL publique n'est persistée.
//
// Si les variables R2_* ne sont pas configurées, le registre réserve un objet
// dans un bucket Supabase privé. Aucun chemin public de repli n'est utilisé.
//
// Variables d'environnement (Vercel) :
//   R2_ACCOUNT_ID        — id du compte Cloudflare
//   R2_ACCESS_KEY_ID     — token API R2 (Object Read & Write sur le bucket)
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET            — ex. buildtrack-files
//   R2_PUBLIC_BASE_URL   — hôte historique, lecture seule pendant la migration
// ─────────────────────────────────────────────────────────────────────────────

const PRESIGN_EXPIRES_SECONDS = 600; // 10 min — large pour les connexions chantier

function env(name: string): string {
  return String(process.env[name] ?? '').trim();
}

export function isR2Configured(): boolean {
  return Boolean(
    env('R2_ACCOUNT_ID') &&
    env('R2_ACCESS_KEY_ID') &&
    env('R2_SECRET_ACCESS_KEY') &&
    env('R2_BUCKET')
  );
}

export function r2PublicBaseUrl(): string {
  return env('R2_PUBLIC_BASE_URL').replace(/\/+$/, '');
}

export function r2PublicHost(): string | null {
  try {
    return new URL(r2PublicBaseUrl()).host || null;
  } catch {
    return null;
  }
}

function r2Endpoint(): string {
  return `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
}

export function r2EndpointHost(): string | null {
  try {
    return new URL(r2Endpoint()).host || null;
  } catch {
    return null;
  }
}

function r2Client(): AwsClient {
  return new AwsClient({
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: 'auto',
  });
}

// Encode chaque segment du chemin sans toucher aux « / » (clé S3).
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

export async function presignR2Upload(
  key: string,
  contentType: string,
): Promise<{ uploadUrl: string; expiresIn: number }> {
  const url = new URL(`${r2Endpoint()}/${env('R2_BUCKET')}/${encodeKey(key)}`);
  url.searchParams.set('X-Amz-Expires', String(PRESIGN_EXPIRES_SECONDS));
  const signed = await r2Client().sign(
    new Request(url.toString(), {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    }),
    { aws: { signQuery: true } }
  );
  return {
    uploadUrl: signed.url,
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  };
}

export async function presignR2Read(
  key: string,
  expiresIn = PRESIGN_EXPIRES_SECONDS,
): Promise<{ url: string; expiresIn: number }> {
  const ttl = Math.max(60, Math.min(900, Math.trunc(expiresIn)));
  const url = new URL(`${r2Endpoint()}/${env('R2_BUCKET')}/${encodeKey(key)}`);
  url.searchParams.set('X-Amz-Expires', String(ttl));
  const signed = await r2Client().sign(
    new Request(url.toString(), { method: 'GET' }),
    { aws: { signQuery: true } },
  );
  return { url: signed.url, expiresIn: ttl };
}

export async function headR2Object(
  key: string,
): Promise<{ ok: boolean; size?: number; etag?: string; contentType?: string; error?: string }> {
  try {
    const response = await r2Client().fetch(
      `${r2Endpoint()}/${env('R2_BUCKET')}/${encodeKey(key)}`,
      { method: 'HEAD' },
    );
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const size = Number(response.headers.get('content-length') ?? '');
    return {
      ok: true,
      size: Number.isFinite(size) ? size : undefined,
      etag: response.headers.get('etag')?.replace(/^\"|\"$/g, '') || undefined,
      contentType: response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || undefined,
    };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export async function deleteR2Object(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await r2Client().fetch(
      `${r2Endpoint()}/${env('R2_BUCKET')}/${encodeKey(key)}`,
      { method: 'DELETE' }
    );
    // S3 renvoie 204 même si l'objet n'existe pas — idempotent.
    if (response.status === 204 || response.ok) return { ok: true };
    const body = await response.text().catch(() => '');
    return { ok: false, error: `HTTP ${response.status} ${body.slice(0, 200)}` };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
