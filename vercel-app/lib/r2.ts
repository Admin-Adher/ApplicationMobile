import { AwsClient } from 'aws4fetch';

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare R2 — stockage de fichiers (photos, plans, documents).
//
// Architecture « hybride » :
//   - Écriture : le client (mobile/web) demande une URL présignée PUT à
//     /api/storage/presign (auth Bearer), puis uploade directement vers
//     l'endpoint S3 de R2. Aucun octet ne transite par Vercel.
//   - Lecture : un Worker Cloudflare public (cloudflare/r2-public-worker.js)
//     sert le bucket sur *.workers.dev → R2_PUBLIC_BASE_URL. Egress gratuit.
//   - Les anciens fichiers restent servis par Supabase Storage : les URLs
//     absolues stockées en base continuent de fonctionner telles quelles.
//
// Si les variables R2_* ne sont pas configurées, isR2Configured() renvoie
// false, /api/storage/presign répond 503 et les clients retombent
// automatiquement sur le chemin Supabase historique — déployable avant
// même d'avoir créé le bucket.
//
// Variables d'environnement (Vercel) :
//   R2_ACCOUNT_ID        — id du compte Cloudflare
//   R2_ACCESS_KEY_ID     — token API R2 (Object Read & Write sur le bucket)
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET            — ex. buildtrack-files
//   R2_PUBLIC_BASE_URL   — ex. https://buildtrack-files.xxxx.workers.dev
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
    env('R2_BUCKET') &&
    env('R2_PUBLIC_BASE_URL')
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

export function r2PublicUrlForKey(key: string): string {
  return `${r2PublicBaseUrl()}/${encodeKey(key)}`;
}

// Retrouve la clé R2 à partir d'une URL publique servie par le Worker.
// Renvoie null si l'URL n'est pas sur notre hôte public R2.
export function r2KeyFromPublicUrl(url: string): string | null {
  try {
    const base = new URL(r2PublicBaseUrl());
    const parsed = new URL(String(url ?? ''));
    if (parsed.host !== base.host) return null;
    const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    return key || null;
  } catch {
    return null;
  }
}

export async function presignR2Upload(key: string): Promise<{ uploadUrl: string; publicUrl: string; expiresIn: number }> {
  const url = new URL(`${r2Endpoint()}/${env('R2_BUCKET')}/${encodeKey(key)}`);
  url.searchParams.set('X-Amz-Expires', String(PRESIGN_EXPIRES_SECONDS));
  const signed = await r2Client().sign(
    new Request(url.toString(), { method: 'PUT' }),
    { aws: { signQuery: true } }
  );
  return {
    uploadUrl: signed.url,
    publicUrl: r2PublicUrlForKey(key),
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  };
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
