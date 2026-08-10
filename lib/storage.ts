import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase, isSupabaseConfigured, SUPABASE_URL, SUPABASE_KEY } from './supabase';
import i18n from '@/lib/i18n';
import { canonicalApiBaseUrl } from './apiBase';

// ── File reading ──────────────────────────────────────────────────────────────
// On native, we use fetch(uri) to obtain a proper Blob that the Supabase
// Storage SDK can handle reliably.  On older Android where fetch may refuse
// a content:// URI we fall back to FileSystem base64 + manual Uint8Array.
// On web, we use fetch + blob as well (works for blob:, data: and http URIs).

async function readFileAsBlob(uri: string): Promise<{ data: Blob; mimeType: string }> {
  try {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`fetch ${uri} → HTTP ${response.status}`);
    const blob = await response.blob();
    return { data: blob, mimeType: blob.type || 'application/octet-stream' };
  } catch (fetchErr) {
    if (Platform.OS === 'web') throw fetchErr;
    // Fallback for content:// URIs on older Android that fetch cannot access.
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    return { data: blob, mimeType: 'application/octet-stream' };
  }
}

// Délai max pour tout l'upload (lecture + envoi + réponse Supabase). Si le
// délai est dépassé, on renvoie null et l'appelant bascule sur la file de sync.
// 30 s ne suffisait pas sur les connexions de chantier (uplink lent) : chaque
// photo un peu lourde expirait avec « Délai dépassé (upload photo native > 30s) »
// à CHAQUE passe de sync, et la file ne convergeait jamais. 120 s laisse une
// vraie chance à l'upload tout en restant sous le plafond par opération de la
// passe de sync (UPLOAD_STEP_TIMEOUT_MS = 150 s dans NetworkContext).
const PHOTO_UPLOAD_TIMEOUT_MS = 120_000;

// Pour les uploads INTERACTIFS (l'utilisateur attend derrière un spinner :
// galerie photos, pièce jointe de message, photo de levée…) on garde un délai
// court : en cas d'échec, l'appelant bascule immédiatement sur le stockage
// local + file de sync, qui elle bénéficie du délai long ci-dessus.
export const INTERACTIVE_UPLOAD_TIMEOUT_MS = 30_000;

// Documents (PDFs, DXF) peuvent être beaucoup plus lourds que des photos —
// on alloue 120 s pour couvrir les connexions chantier vraiment lentes.
const DOCUMENT_UPLOAD_TIMEOUT_MS = 120_000;

// Borne pour les appels FileSystem.getInfoAsync (stat d'un fichier local).
// Sur certains appareils Android, stat-er un fichier (content provider
// instable, stockage externe/SD lent) peut se bloquer indéfiniment. Sans
// borne, cet await ne se résout jamais : toute la passe d'upload — et donc la
// file de synchronisation — gèle (opérations « en attente » bloquées pendant
// des jours). On borne donc systématiquement ce stat.
const FILE_STAT_TIMEOUT_MS = 8_000;

// Module-level upload counter so that filenames are unique even when several
// photos are uploaded within the same millisecond (e.g. bulk offline sync).
let _uploadSeq = 0;
function nextUploadSeq(): number { return ++_uploadSeq; }

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Délai dépassé (${label} > ${Math.round(ms / 1000)}s)`)),
      ms,
    );
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Sentinel returned by uploadPhoto / uploadDocumentDetailed when the local
 * source file no longer exists on disk (OS-level cleanup, app data wipe, etc.).
 * Callers can detect this case and drop the photo from the payload instead of
 * re-queuing the operation forever.
 */
export const MISSING_LOCAL_FILE = '__BUILDTRACK_MISSING_LOCAL_FILE__';

// ─────────────────────────────────────────────────────────────────────────────
// Registre média privé — chemin canonique mobile et web Expo.
//
//   1. L'API authentifiée réserve un objet rattaché au tenant et retourne une
//      référence opaque btmedia://<uuid> ainsi qu'une destination d'upload.
//   2. Le client envoie directement les octets vers R2 ou Supabase privé.
//   3. L'API vérifie l'objet, puis la ressource métier persiste uniquement la
//      référence opaque. Les lectures passent par /api/storage/resolve après
//      vérification RLS de la ressource liée.
//
// Une indisponibilité du serveur conserve le fichier dans la file hors-ligne :
// aucun nouvel upload ne retombe sur une URL publique non enregistrée.
// ─────────────────────────────────────────────────────────────────────────────

const PRESIGN_TIMEOUT_MS = 10_000;

type PresignedUpload = {
  provider: 'r2' | 'supabase';
  assetId: string;
  mediaRef: string;
  bucket: 'photos' | 'documents';
  objectKey: string;
  uploadUrl?: string;
};

function storageApiBaseUrl(): string {
  return canonicalApiBaseUrl();
}

async function requestPresignedUpload(
  kind: 'photo' | 'document',
  filename: string,
  contentType: string,
  size: number,
  tag: string,
): Promise<PresignedUpload | null> {
  try {
    const base = storageApiBaseUrl();
    const url = base ? `${base}/api/storage/presign` : '/api/storage/presign';
    const accessToken = await resolveStorageAccessToken(tag);
    if (!accessToken || accessToken === SUPABASE_KEY) {
      // Pas de session utilisateur exploitable → le presign répondrait 401.
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PRESIGN_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ kind, filename, contentType, size }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`${tag} presign R2 refusé (HTTP ${response.status}): ${body.slice(0, 160)}`);
      return null;
    }
    const data = await response.json().catch(() => null);
    if (!data?.assetId || !data?.mediaRef || !data?.bucket || !data?.objectKey) return null;
    if (data.provider === 'r2' && !data.uploadUrl) return null;
    return {
      provider: data.provider,
      assetId: data.assetId,
      mediaRef: data.mediaRef,
      bucket: data.bucket,
      objectKey: data.objectKey,
      uploadUrl: data.uploadUrl,
    };
  } catch (err: any) {
    console.warn(`${tag} presign R2 indisponible:`, err?.message ?? err);
    return null;
  }
}

// PUT du fichier vers R2. Natif : FileSystem.uploadAsync (HTTP natif, pas de
// Blob fetch — même contrainte Android/Hermes que pour Supabase). Web : fetch.
async function putFileToR2(
  presigned: PresignedUpload,
  uri: string,
  contentType: string,
  timeoutMs: number,
  tag: string,
): Promise<boolean> {
  try {
    if (!presigned.uploadUrl) return false;
    if (Platform.OS !== 'web') {
      const result = await withTimeout(
        FileSystem.uploadAsync(presigned.uploadUrl, uri, {
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: { 'Content-Type': contentType },
        }),
        timeoutMs,
        'upload R2 natif',
      );
      if (result.status < 200 || result.status >= 300) {
        console.warn(`${tag} PUT R2 natif HTTP ${result.status}: ${(result.body ?? '').slice(0, 160)}`);
        return false;
      }
      return true;
    }
    const { data: blob } = await readFileAsBlob(uri);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': contentType },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      console.warn(`${tag} PUT R2 web HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn(`${tag} PUT R2 échoué:`, err?.message ?? err);
    return false;
  }
}

async function fileSize(uri: string): Promise<number> {
  if (Platform.OS !== 'web') {
    const info = await withTimeout(FileSystem.getInfoAsync(uri), FILE_STAT_TIMEOUT_MS, 'taille fichier');
    const nativeSize = Number((info as any)?.size ?? 0);
    if ((info as any)?.exists && nativeSize > 0) return nativeSize;
  }
  const { data } = await readFileAsBlob(uri);
  return data.size;
}

async function putFileToSupabase(
  reservation: PresignedUpload,
  uri: string,
  contentType: string,
  timeoutMs: number,
  tag: string,
): Promise<boolean> {
  if (Platform.OS !== 'web' && SUPABASE_URL && SUPABASE_KEY) {
    const accessToken = await resolveStorageAccessToken(tag);
    if (!accessToken || accessToken === SUPABASE_KEY) return false;
    const encodedKey = reservation.objectKey.split('/').map(encodeURIComponent).join('/');
    const result = await withTimeout(
      FileSystem.uploadAsync(
        `${SUPABASE_URL}/storage/v1/object/${reservation.bucket}/${encodedKey}`,
        uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: SUPABASE_KEY,
            'Content-Type': contentType,
          },
        },
      ),
      timeoutMs,
      'upload Supabase privé',
    );
    return result.status >= 200 && result.status < 300;
  }

  const { data } = await readFileAsBlob(uri);
  const result = await withTimeout(
    supabase.storage.from(reservation.bucket).upload(reservation.objectKey, data, {
      contentType,
      upsert: false,
    }),
    timeoutMs,
    'upload Supabase privé web',
  );
  return !result.error;
}

async function completeRegisteredUpload(reservation: PresignedUpload, tag: string): Promise<boolean> {
  const base = storageApiBaseUrl();
  const accessToken = await resolveStorageAccessToken(tag);
  if (!accessToken || accessToken === SUPABASE_KEY) return false;
  const response = await fetch(base ? `${base}/api/storage/complete` : '/api/storage/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ assetId: reservation.assetId }),
  });
  return response.ok;
}

async function uploadRegisteredMedia(
  kind: 'photo' | 'document',
  uri: string,
  filename: string,
  contentType: string,
  timeoutMs: number,
  tag: string,
): Promise<{ url: string | null; error: string | null }> {
  try {
    const size = await fileSize(uri);
    if (!Number.isFinite(size) || size <= 0) return { url: null, error: 'Taille de fichier invalide' };
    const reservation = await requestPresignedUpload(kind, filename, contentType, size, tag);
    if (!reservation) return { url: null, error: 'Réservation média indisponible' };
    const uploaded = reservation.provider === 'r2'
      ? await putFileToR2(reservation, uri, contentType, timeoutMs, tag)
      : await putFileToSupabase(reservation, uri, contentType, timeoutMs, tag);
    if (!uploaded) return { url: null, error: 'Upload privé impossible' };
    if (!await completeRegisteredUpload(reservation, tag)) {
      return { url: null, error: 'Validation serveur du média impossible' };
    }
    return { url: reservation.mediaRef, error: null };
  } catch (error: any) {
    return { url: null, error: error?.message ?? String(error) };
  }
}

async function localFileMissing(uri: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!uri.startsWith('file://')) return false;
  try {
    // Borné : si le stat se bloque (cf. FILE_STAT_TIMEOUT_MS), on suppose le
    // fichier présent et on laisse l'upload (lui-même borné) trancher, plutôt
    // que de figer toute la file de synchronisation sur un await éternel.
    const info = await withTimeout(
      FileSystem.getInfoAsync(uri),
      FILE_STAT_TIMEOUT_MS,
      'stat fichier local',
    );
    return !info?.exists;
  } catch {
    return false;
  }
}

async function resolveStorageAccessToken(tag: string): Promise<string> {
  if (!SUPABASE_KEY) return '';
  try {
    const sessionRace = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('getSession timeout')), 8_000)),
    ]) as Awaited<ReturnType<typeof supabase.auth.getSession>>;

    const session = sessionRace.data?.session;
    if (sessionRace.error) throw sessionRace.error;
    if (!session?.access_token) throw new Error('no-session');
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof session.expires_at === 'number' && session.expires_at - 10 <= nowSec) {
      throw new Error('jwt-expired');
    }
    return session.access_token;
  } catch (sessionError: any) {
    console.warn(`${tag} getSession unavailable (${sessionError?.message ?? sessionError}), using cache fallback`);
    try {
      const { getSessionFromStorage, forceRefreshSession } = await import('./offlineCache');
      const cached = await getSessionFromStorage();
      const nowSec = Math.floor(Date.now() / 1000);
      if (cached?.access_token && typeof cached.expires_at === 'number' && cached.expires_at - 10 > nowSec) {
        return cached.access_token;
      }
      const refreshed = await forceRefreshSession();
      return refreshed ?? SUPABASE_KEY;
    } catch (fallbackError: any) {
      console.warn(`${tag} cache token fallback failed:`, fallbackError?.message ?? fallbackError);
      return SUPABASE_KEY;
    }
  }
}

/**
 * Internal helper: upload a photo and return both the URL and the error message.
 * This allows callers to surface the actual failure reason instead of a generic message.
 *
 * ── Why FileSystem.uploadAsync instead of supabase.storage.upload ─────────────
 * The Supabase JS SDK uploads files via fetch() + Blob body. On Android/React
 * Native (Hermes engine), Blob bodies in fetch() consistently fail with the
 * opaque error "Network request failed" — even when Supabase API calls and
 * realtime connections work perfectly. This is a long-standing React Native
 * limitation: the native network layer does not support Blob request bodies.
 *
 * FileSystem.uploadAsync() bypasses JS fetch entirely. It reads the file
 * natively from disk and sends it through the platform's HTTP stack, which
 * correctly handles file:// URIs and binary payloads on both iOS and Android.
 */
async function _uploadPhotoWithError(
  uri: string,
  filename: string,
  timeoutMs: number = PHOTO_UPLOAD_TIMEOUT_MS,
): Promise<{ url: string | null; error: string | null }> {
  if (!isSupabaseConfigured) return { url: null, error: 'Supabase non configuré' };
  const startedAt = Date.now();
  const remainingBudgetMs = () => Math.max(0, timeoutMs - (Date.now() - startedAt));
  const timeoutMessage = () => `Délai dépassé (upload photo complet > ${Math.round(timeoutMs / 1000)}s)`;
  if (await localFileMissing(uri)) {
    console.warn('[uploadPhoto] local file missing, dropping:', uri);
    return { url: MISSING_LOCAL_FILE as any, error: null };
  }
  try {
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
    const contentType =
      ext === 'png' ? 'image/png' :
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      'image/jpeg';
    const remaining = remainingBudgetMs();
    if (remaining <= 0) return { url: null, error: timeoutMessage() };
    return await uploadRegisteredMedia(
      'photo', uri, filename, contentType, remaining, '[uploadPhoto]',
    );

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[uploadPhoto] failed:', msg);
    return { url: null, error: msg };
  }
}

export async function uploadPhoto(
  uri: string,
  filename: string,
  timeoutMs?: number,
): Promise<string | null> {
  const { url } = await _uploadPhotoWithError(uri, filename, timeoutMs);
  // La sentinelle « fichier local disparu » ne doit jamais fuiter comme une
  // URL vers les appelants directs : ils la stockeraient telle quelle dans un
  // enregistrement (URI de photo inutilisable). Seul uploadLocalPhotosInPayload
  // la consomme, via _uploadPhotoWithError.
  return url === (MISSING_LOCAL_FILE as any) ? null : url;
}

export async function uploadDocument(
  uri: string,
  filename: string,
  mimeType?: string
): Promise<string | null> {
  const { url } = await uploadDocumentDetailed(uri, filename, mimeType);
  return url;
}

export async function uploadDocumentDetailed(
  uri: string,
  filename: string,
  mimeType?: string
): Promise<{ url: string | null; error: string | null }> {
  const tag = '[DOC_UPLOAD]';
  const shortUri = uri.length > 80 ? uri.slice(0, 80) + '…' : uri;
  console.log(`${tag} ── début ──────────────────────────────────`);
  console.log(`${tag} uri      : ${shortUri}`);
  console.log(`${tag} filename : ${filename}`);
  console.log(`${tag} mimeType : ${mimeType ?? '(auto)'}`);
  console.log(`${tag} platform : ${Platform.OS}`);
  console.log(`${tag} supabase : ${isSupabaseConfigured ? 'configuré' : 'NON CONFIGURÉ'}`);

  if (!isSupabaseConfigured) {
    const err = 'Supabase non configuré (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY manquantes).';
    console.error(`${tag} ECHEC — ${err}`);
    return { url: null, error: err };
  }

  // ── 1. Vérifier que le fichier local existe encore ─────────────────────────
  let missing = false;
  try {
    missing = await localFileMissing(uri);
  } catch (checkErr) {
    console.warn(`${tag} Erreur vérification existence fichier:`, checkErr);
  }
  console.log(`${tag} fichier local présent : ${missing ? 'NON (supprimé par l\'OS)' : 'OUI'}`);
  if (missing) {
    console.warn(`${tag} ABANDON — fichier local introuvable sur disque : ${shortUri}`);
    return { url: MISSING_LOCAL_FILE as any, error: null };
  }

  const contentType = mimeType ?? 'application/octet-stream';
  const registered = await uploadRegisteredMedia(
    'document', uri, filename, contentType, DOCUMENT_UPLOAD_TIMEOUT_MS, tag,
  );
  return registered;

}

/**
 * Check if a URI points to a local file (not a remote URL).
 */
export function isLocalUri(uri: string): boolean {
  return (
    uri.startsWith('file://') ||
    uri.startsWith('content://') ||
    uri.startsWith('ph://') ||
    uri.startsWith('data:')
  );
}

/**
 * Copy a photo from a temporary location (camera cache, gallery temp) to the
 * app's persistent documentDirectory so it survives app restarts.
 * Returns the persistent local URI, or the original URI on web / if already persistent.
 */
export async function persistLocalPhoto(uri: string): Promise<string> {
  if (Platform.OS === 'web') return uri;
  if (!isLocalUri(uri)) return uri;
  if (uri.startsWith(FileSystem.documentDirectory ?? '\0')) return uri;

  try {
    const dir = `${FileSystem.documentDirectory}photos/`;
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    const ext = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
    const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
    const destUri = `${dir}reserve_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${safeExt}`;
    await FileSystem.copyAsync({ from: uri, to: destUri });
    return destUri;
  } catch (e) {
    console.warn('[persistLocalPhoto] failed to copy, using original URI:', e);
    return uri;
  }
}

export async function initStorageBuckets(): Promise<void> {
  // Les buckets doivent être créés via Supabase SQL Editor (voir lib/schema.sql).
  // La création programmatique via la clé anon est bloquée par RLS.
}

/**
 * Purge local photo files from documentDirectory/photos/ that are no longer
 * referenced by any pending offline operation.
 *
 * Call this after a successful sync pass (no failed ops) to reclaim device
 * storage. Files referenced in `referencedUris` are kept; everything else in
 * the photos folder that is older than `maxAgeMs` (default 7 days) is deleted.
 *
 * The age guard prevents accidentally deleting photos taken offline within the
 * current sync window (in case they weren't enqueued yet).
 */
export async function purgeOrphanedPhotoFiles(
  referencedUris: Set<string>,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const dir = `${FileSystem.documentDirectory ?? ''}photos/`;
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) return;

    const files = await FileSystem.readDirectoryAsync(dir);
    const now = Date.now();
    let deleted = 0;

    for (const filename of files) {
      const fullPath = `${dir}${filename}`;
      if (referencedUris.has(fullPath)) continue; // still needed by a queued op
      try {
        const info = await FileSystem.getInfoAsync(fullPath, { md5: false });
        if (!info.exists) continue;
        // modificationTime is seconds since epoch on iOS/Android. If the
        // platform does not report it, KEEP the file: deleting a photo whose
        // age we cannot prove risks destroying the only copy of user data.
        const mtime = (info as any).modificationTime;
        if (typeof mtime !== 'number') continue;
        const ageMs = now - mtime * 1000;
        if (ageMs < maxAgeMs) continue; // too recent — keep
        await FileSystem.deleteAsync(fullPath, { idempotent: true });
        deleted += 1;
      } catch {}
    }

    if (deleted > 0) {
      console.log(`[storage] purged ${deleted} orphaned local photo file(s)`);
    }
  } catch {}
}

/**
 * Walks a payload destined for Supabase and uploads any local photo URIs
 * (file://, content://, ph://, data:) to Supabase Storage, replacing them
 * with public URLs in-place.
 *
 * Returns:
 *   - data        : a NEW payload object with remote URLs (do not mutate the input)
 *   - allOk       : true only if every local URI we found was uploaded successfully
 *                   (also true when there were no local URIs at all)
 *   - hadLocal    : true if at least one field still pointed to a local URI when
 *                   we were called (useful for callers to know "did this row need
 *                   photo work")
 *   - uploadErrors: list of actual error messages from failed uploads (for display/logging)
 */
export async function uploadLocalPhotosInPayload(
  table: string,
  payload: Record<string, any> | null | undefined,
  options?: {
    onProgress?: (data: Record<string, any>) => void | Promise<void>;
  },
): Promise<{ data: Record<string, any> | null | undefined; allOk: boolean; hadLocal: boolean; uploadErrors: string[] }> {
  if (!payload || !isSupabaseConfigured) {
    return { data: payload, allOk: true, hadLocal: false, uploadErrors: [] };
  }
  const data = { ...payload };
  let allOk = true;
  let hadLocal = false;
  const uploadErrors: string[] = [];
  const reportProgress = async (progressData: Record<string, any>) => {
    try {
      await options?.onProgress?.(progressData);
    } catch (err) {
      console.warn('[upload] impossible de persister la progression:', (err as any)?.message ?? err);
    }
  };

  if (table === 'reserves') {
    const uploadedLocalUris = new Map<string, Awaited<ReturnType<typeof _uploadPhotoWithError>>>();
    const uploadReservePhotoOnce = async (uri: string, filename: string) => {
      const cached = uploadedLocalUris.get(uri);
      if (cached) return cached;
      const result = await _uploadPhotoWithError(uri, filename);
      uploadedLocalUris.set(uri, result);
      return result;
    };

    if (typeof data.photo_uri === 'string' && isLocalUri(data.photo_uri)) {
      hadLocal = true;
      const { url: remote, error: uploadErr } = await uploadReservePhotoOnce(data.photo_uri, `reserve_${Date.now()}_${nextUploadSeq()}.jpg`);
      if (remote === (MISSING_LOCAL_FILE as any)) data.photo_uri = null;
      else if (remote) data.photo_uri = remote;
      else { allOk = false; if (uploadErr) uploadErrors.push(`photo_uri: ${uploadErr}`); }
      await reportProgress({ ...data });
    }
    if (Array.isArray(data.photos)) {
      const sourcePhotos = data.photos;
      const newPhotos: any[] = [];
      for (let i = 0; i < sourcePhotos.length; i++) {
        const p = sourcePhotos[i];
        if (p && typeof p.uri === 'string' && isLocalUri(p.uri)) {
          hadLocal = true;
          const { url: remote, error: uploadErr } = await uploadReservePhotoOnce(p.uri, `reserve_photo_${Date.now()}_${nextUploadSeq()}_${i}.jpg`);
          if (remote === (MISSING_LOCAL_FILE as any)) {
            await reportProgress({
              ...data,
              photos: [...newPhotos, ...sourcePhotos.slice(i + 1)],
            });
            continue;
          }
          if (remote) newPhotos.push({ ...p, uri: remote });
          else { newPhotos.push(p); allOk = false; if (uploadErr) uploadErrors.push(`photos[${i}]: ${uploadErr}`); }
        } else {
          newPhotos.push(p);
        }
        await reportProgress({
          ...data,
          photos: [...newPhotos, ...sourcePhotos.slice(i + 1)],
        });
      }
      data.photos = newPhotos;
    }
  } else if (table === 'incidents') {
    if (typeof data.photo_uri === 'string' && isLocalUri(data.photo_uri)) {
      hadLocal = true;
      const { url: remote, error: uploadErr } = await _uploadPhotoWithError(data.photo_uri, `incident_${Date.now()}_${nextUploadSeq()}.jpg`);
      if (remote === (MISSING_LOCAL_FILE as any)) data.photo_uri = null;
      else if (remote) data.photo_uri = remote;
      else { allOk = false; if (uploadErr) uploadErrors.push(`photo_uri: ${uploadErr}`); }
    }
  } else if (table === 'visites') {
    if (typeof data.cover_photo_uri === 'string' && isLocalUri(data.cover_photo_uri)) {
      hadLocal = true;
      const { url: remote, error: uploadErr } = await _uploadPhotoWithError(
        data.cover_photo_uri,
        `visite_${String(data.id ?? Date.now()).replace(/[^a-zA-Z0-9._-]/g, '_')}_${nextUploadSeq()}.jpg`,
      );
      if (remote === (MISSING_LOCAL_FILE as any)) data.cover_photo_uri = null;
      else if (remote) data.cover_photo_uri = remote;
      else { allOk = false; if (uploadErr) uploadErrors.push(`cover_photo_uri: ${uploadErr}`); }
    }
  } else if (table === 'inventory_products') {
    if (typeof data.photo_url === 'string' && isLocalUri(data.photo_url)) {
      hadLocal = true;
      const reference = String(data.reference ?? 'produit').replace(/[^a-zA-Z0-9._-]/g, '_');
      const { url: remote, error: uploadErr } = await _uploadPhotoWithError(
        data.photo_url,
        `stock_${reference}_${Date.now()}_${nextUploadSeq()}.jpg`,
      );
      if (remote === (MISSING_LOCAL_FILE as any)) data.photo_url = null;
      else if (remote) data.photo_url = remote;
      else { allOk = false; if (uploadErr) uploadErrors.push(`photo_url: ${uploadErr}`); }
    }
  } else if (table === 'photos') {
    if (typeof data.uri === 'string' && isLocalUri(data.uri)) {
      hadLocal = true;
      const { url: remote, error: uploadErr } = await _uploadPhotoWithError(data.uri, `photo_${Date.now()}.jpg`);
      if (remote === (MISSING_LOCAL_FILE as any)) {
        return { data: null, allOk: true, hadLocal: true, uploadErrors: [] };
      }
      if (remote) data.uri = remote;
      else { allOk = false; if (uploadErr) uploadErrors.push(uploadErr); }
    }
  } else if (table === 'messages') {
    if (typeof data.attachment_uri === 'string' && isLocalUri(data.attachment_uri)) {
      hadLocal = true;
      const { url: remote, error: uploadErr } = await _uploadPhotoWithError(
        data.attachment_uri,
        `message_${Date.now()}_${nextUploadSeq()}.jpg`,
      );
      if (remote === (MISSING_LOCAL_FILE as any)) data.attachment_uri = null;
      else if (remote) data.attachment_uri = remote;
      else { allOk = false; if (uploadErr) uploadErrors.push(`attachment_uri: ${uploadErr}`); }
    }
  } else if (table === 'site_plans') {
    if (typeof data.uri === 'string' && isLocalUri(data.uri)) {
      hadLocal = true;
      const ext = (() => {
        const m = data.uri.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
        return m
          ? m[1].toLowerCase()
          : data.file_type === 'pdf'
          ? 'pdf'
          : data.file_type === 'dxf'
          ? 'dxf'
          : 'jpg';
      })();
      const safeName = (typeof data.name === 'string' ? data.name : 'plan').replace(
        /[^a-zA-Z0-9._-]/g,
        '_',
      );
      const filename = `plan_${Date.now()}_${safeName}.${ext}`;
      const mime =
        data.file_type === 'pdf'
          ? 'application/pdf'
          : data.file_type === 'dxf'
          ? 'application/octet-stream'
          : undefined;
      const { url, error: uploadErr } = await uploadDocumentDetailed(data.uri, filename, mime);
      // Local file was deleted by the OS — drop the URI but keep the row data
      if (url === (MISSING_LOCAL_FILE as any)) {
        data.uri = null;
      } else if (url) {
        data.uri = url;
      } else {
        allOk = false;
        if (uploadErr) uploadErrors.push(uploadErr);
      }
    }
  } else if (table === 'documents' || table === 'regulatory_docs') {
    if (typeof data.uri === 'string' && isLocalUri(data.uri)) {
      hadLocal = true;
      const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'document';
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = `document_${Date.now()}_${nextUploadSeq()}_${safeName}`;
      const { url, error: uploadErr } = await uploadDocumentDetailed(data.uri, filename);
      if (url === (MISSING_LOCAL_FILE as any)) {
        data.uri = null;
      } else if (url) {
        data.uri = url;
      } else {
        allOk = false;
        if (uploadErr) uploadErrors.push(uploadErr);
      }
    }
  }

  return { data, allOk, hadLocal, uploadErrors };
}
