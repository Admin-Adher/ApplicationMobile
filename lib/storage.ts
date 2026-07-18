import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { supabase, isSupabaseConfigured, SUPABASE_URL, SUPABASE_KEY } from './supabase';
import i18n from '@/lib/i18n';

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
// Cloudflare R2 — chemin d'upload prioritaire (bascule hybride)
//
// Le plan gratuit Supabase est limité à 1 Go de storage et ~10 Go d'egress/mois
// (partagé avec la base). R2 offre 10 Go + egress illimité gratuit. Stratégie :
//   1. On demande une URL présignée PUT à /api/storage/presign (auth Bearer).
//   2. On uploade DIRECTEMENT vers R2 (PUT simple, sans header d'auth — encore
//      plus fiable que le chemin Supabase sur Android/Hermes).
//   3. On stocke l'URL publique R2 (Worker *.workers.dev) en base.
// Si le presign échoue (R2 non configuré → 503, vieille app, hors-ligne,
// session invalide), on retombe sur le chemin Supabase historique : les deux
// hôtes cohabitent, les lecteurs consomment des URLs absolues et ne voient
// aucune différence.
// ─────────────────────────────────────────────────────────────────────────────

const PRESIGN_TIMEOUT_MS = 10_000;

type PresignedUpload = { uploadUrl: string; publicUrl: string; key: string };

function storageApiBaseUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_APP_URL || '';
}

async function requestPresignedUpload(
  kind: 'photo' | 'document',
  filename: string,
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
        body: JSON.stringify({ kind, filename }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 503) {
      // R2 non configuré côté serveur — silencieux, fallback Supabase.
      return null;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`${tag} presign R2 refusé (HTTP ${response.status}): ${body.slice(0, 160)}`);
      return null;
    }
    const data = await response.json().catch(() => null);
    if (!data?.uploadUrl || !data?.publicUrl) return null;
    return { uploadUrl: data.uploadUrl, publicUrl: data.publicUrl, key: data.key ?? '' };
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

/**
 * Supprime côté serveur les fichiers R2 correspondant aux URLs fournies
 * (les URLs non-R2 sont ignorées par l'API — les fichiers Supabase restent
 * gérés par storage.remove côté client, comme avant). Best-effort.
 */
export async function removeRemoteFilesViaApi(urls: string[]): Promise<void> {
  const list = (urls ?? []).filter(u => typeof u === 'string' && /^https?:\/\//.test(u));
  if (!list.length) return;
  try {
    const base = storageApiBaseUrl();
    const url = base ? `${base}/api/storage/delete` : '/api/storage/delete';
    const accessToken = await resolveStorageAccessToken('[removeRemoteFiles]');
    if (!accessToken || accessToken === SUPABASE_KEY) return;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ urls: list.slice(0, 100) }),
    });
  } catch (err: any) {
    console.warn('[removeRemoteFiles] suppression R2 échouée:', err?.message ?? err);
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
    const path = `${Date.now()}_${nextUploadSeq()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    // ── Chemin prioritaire : Cloudflare R2 (presign + PUT direct) ─────────────
    const presigned = await requestPresignedUpload('photo', filename, '[uploadPhoto]');
    if (presigned) {
      const ok = await putFileToR2(presigned, uri, contentType, timeoutMs, '[uploadPhoto]');
      if (ok) {
        return { url: presigned.publicUrl, error: null };
      }
      console.warn('[uploadPhoto] R2 échoué — repli sur Supabase Storage');
    }

    let publicUrl: string;

    if (Platform.OS !== 'web' && SUPABASE_URL && SUPABASE_KEY) {
      // ── Native path: FileSystem.uploadAsync (native HTTP, no Blob) ───────────
      // Avoid the "Network request failed" caused by Blob bodies in RN's fetch.
      const accessToken = await resolveStorageAccessToken('[uploadPhoto]');

      const uploadUrl = `${SUPABASE_URL}/storage/v1/object/photos/${path}`;
      const result = await withTimeout(
        FileSystem.uploadAsync(uploadUrl, uri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: SUPABASE_KEY,
            'Content-Type': contentType,
          },
        }),
        timeoutMs,
        'upload photo native',
      );

      if (result.status < 200 || result.status >= 300) {
        let detail = result.body ?? '';
        try { detail = JSON.parse(result.body ?? '')?.message ?? result.body ?? ''; } catch {}
        const msg = `[HTTP ${result.status}] ${detail}`;
        console.warn('[uploadPhoto] native upload error:', msg);
        return { url: null, error: msg };
      }

      const { data: urlData } = supabase.storage.from('photos').getPublicUrl(path);
      publicUrl = urlData.publicUrl;
    } else {
      // ── Web path: Blob via Supabase JS SDK ───────────────────────────────────
      const { data: fileData } = await readFileAsBlob(uri);
      const { data, error } = await withTimeout(
        supabase.storage
          .from('photos')
          .upload(path, fileData, { contentType, upsert: false }),
        timeoutMs,
        'upload photo web',
      );
      if (error) {
        const msg = `[${error.message}]${error.statusCode ? ` HTTP ${error.statusCode}` : ''}`;
        console.warn('[uploadPhoto] Supabase SDK error:', msg);
        return { url: null, error: msg };
      }
      const { data: urlData } = supabase.storage.from('photos').getPublicUrl(data.path);
      publicUrl = urlData.publicUrl;
    }

    // NOTE: the local documentDirectory/photos/ copy is intentionally NOT
    // deleted here. A successful upload does not mean the photo is safe: the
    // database write that references it (RPC create_reserve_with_photos, row
    // update…) can still fail afterwards — e.g. `42501` while the session is
    // expired — and the app cache then keeps pointing at the local URI. Deleting
    // the file at this point turned those photos into permanently blank/white
    // images. purgeOrphanedPhotoFiles() reclaims unreferenced files after a
    // clean sync pass (with a 7-day age guard), so device storage is still
    // bounded without risking the only remaining copy of the user's photo.
    return { url: publicUrl, error: null };
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

  try {
    const contentType = mimeType ?? 'application/octet-stream';
    const path = `${Date.now()}_${nextUploadSeq()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    console.log(`${tag} contentType : ${contentType}`);
    console.log(`${tag} storage path: documents/${path}`);

    // ── Chemin prioritaire : Cloudflare R2 (presign + PUT direct) ─────────────
    // Bonus : pas de limite de 50 Mo par fichier (plans PDF lourds OK).
    const presigned = await requestPresignedUpload('document', filename, tag);
    if (presigned) {
      console.log(`${tag} chemin : R2 (PUT présigné)`);
      const ok = await putFileToR2(presigned, uri, contentType, DOCUMENT_UPLOAD_TIMEOUT_MS, tag);
      if (ok) {
        console.log(`${tag} SUCCÈS R2 — url publique: ${presigned.publicUrl}`);
        return { url: presigned.publicUrl, error: null };
      }
      console.warn(`${tag} R2 échoué — repli sur Supabase Storage`);
    }

    if (Platform.OS !== 'web' && SUPABASE_URL && SUPABASE_KEY) {
      // ── Native path: FileSystem.uploadAsync (native HTTP, no Blob) ────────
      // CRITICAL: supabase.storage.upload() uses fetch() + Blob body which
      // always fails on Android/Hermes with "Network request failed" — even
      // when the rest of Supabase (auth, DB) works fine.  FileSystem.uploadAsync
      // bypasses JS fetch and uses the platform's native HTTP stack.
      console.log(`${tag} chemin : NATIF (FileSystem.uploadAsync)`);

      // ── 2. Récupérer le token d'accès ──────────────────────────────────────
      // Strategy (most robust to least):
      // A) supabase.auth.getSession() with 8s timeout (lock may take up to 5s)
      // B) getSessionFromStorage() — read cached JWT directly, no lock
      // C) forceRefreshSession() — raw HTTP refresh bypassing the lock, if B is expired
      // D) SUPABASE_KEY (anon key) — last resort, will fail RLS-protected buckets
      let accessToken: string = SUPABASE_KEY;
      let tokenSource = 'anon_key (fallback)';
      try {
        const TOKEN_TIMEOUT_MS = 8_000;
        const sessionRace = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('getSession timeout')), TOKEN_TIMEOUT_MS)
          ),
        ]) as Awaited<ReturnType<typeof supabase.auth.getSession>>;

        if (sessionRace.error) {
          console.warn(`${tag} getSession erreur: ${sessionRace.error.message}`);
        } else if (sessionRace.data?.session?.access_token) {
          const s = sessionRace.data.session;
          const nowSec = Math.floor(Date.now() / 1000);
          if (typeof s.expires_at === 'number' && s.expires_at < nowSec) {
            console.warn(`${tag} JWT expiré depuis ${nowSec - s.expires_at}s — forceRefresh`);
            throw new Error('jwt-expired');
          }
          accessToken = s.access_token;
          tokenSource = `JWT supabase-js (expire: ${s.expires_at
            ? new Date(s.expires_at * 1000).toISOString()
            : 'inconnu'})`;
        } else {
          console.warn(`${tag} getSession: pas de session active`);
          throw new Error('no-session');
        }
      } catch (sessEx: any) {
        console.warn(`${tag} getSession indisponible (${sessEx?.message ?? sessEx}) — essai AsyncStorage fallback`);
        // B) Read directly from AsyncStorage (no lock involved)
        const { getSessionFromStorage, forceRefreshSession } = await import('./offlineCache');
        const cached = await getSessionFromStorage();
        if (cached?.access_token && typeof cached.expires_at === 'number') {
          const nowSec = Math.floor(Date.now() / 1000);
          if (cached.expires_at - 10 > nowSec) {
            accessToken = cached.access_token;
            tokenSource = `JWT AsyncStorage (expire: ${new Date(cached.expires_at * 1000).toISOString()})`;
            console.log(`${tag} token depuis AsyncStorage OK`);
          } else {
            // C) JWT expired — force-refresh via raw HTTP
            console.warn(`${tag} JWT AsyncStorage expiré — forceRefreshSession()`);
            const newToken = await forceRefreshSession();
            if (newToken) {
              accessToken = newToken;
              tokenSource = 'JWT forceRefresh (bypass lock)';
              console.log(`${tag} token renouvelé par forceRefresh ✓`);
            } else {
              console.warn(`${tag} forceRefresh échoué — fallback clé anon (RLS bloquera probablement)`);
            }
          }
        } else {
          console.warn(`${tag} AsyncStorage vide — fallback clé anon`);
        }
      }
      console.log(`${tag} token source: ${tokenSource}`);

      // ── 3. Lancer l'upload ─────────────────────────────────────────────────
      const uploadUrl = `${SUPABASE_URL}/storage/v1/object/documents/${path}`;
      console.log(`${tag} uploadUrl: ${uploadUrl}`);
      console.log(`${tag} timeout: ${DOCUMENT_UPLOAD_TIMEOUT_MS / 1000}s`);
      console.log(`${tag} ── lancement FileSystem.uploadAsync…`);

      let result: { status: number; body: string };
      try {
        result = await withTimeout(
          FileSystem.uploadAsync(uploadUrl, uri, {
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: SUPABASE_KEY,
              'Content-Type': contentType,
            },
          }),
          DOCUMENT_UPLOAD_TIMEOUT_MS,
          'upload document native',
        );
      } catch (uploadEx: any) {
        const msg = uploadEx?.message ?? String(uploadEx);
        console.error(`${tag} ECHEC uploadAsync exception: ${msg}`);
        return { url: null, error: `uploadAsync exception: ${msg}` };
      }

      console.log(`${tag} réponse HTTP status: ${result.status}`);
      console.log(`${tag} réponse HTTP body  : ${(result.body ?? '').slice(0, 300)}`);

      if (result.status < 200 || result.status >= 300) {
        let detail = result.body ?? '';
        try {
          const parsed = JSON.parse(result.body ?? '');
          detail = parsed?.message ?? parsed?.error ?? result.body ?? '';
        } catch {}
        const statusLabel =
          result.status === 401 ? i18n.t('storageErrors.jwtInvalid') :
          result.status === 403 ? i18n.t('storageErrors.permissionDenied') :
          result.status === 413 ? i18n.t('storageErrors.fileTooLarge') :
          result.status === 0   ? i18n.t('storageErrors.noNetworkResponse') :
          `HTTP ${result.status}`;
        const msg = `${statusLabel}: ${detail}`.trim();
        console.error(`${tag} ECHEC upload — ${msg}`);
        return { url: null, error: msg };
      }

      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);
      console.log(`${tag} SUCCÈS — url publique: ${urlData.publicUrl}`);
      return { url: urlData.publicUrl, error: null };
    }

    // ── Web path: Blob via Supabase JS SDK ──────────────────────────────────
    console.log(`${tag} chemin : WEB (Blob SDK)`);
    const { data: fileData, mimeType: detectedMime } = await readFileAsBlob(uri);
    const resolvedContentType = mimeType || detectedMime || 'application/octet-stream';
    console.log(`${tag} blob size: ${fileData?.size ?? 'inconnu'} octets`);
    const { data, error } = await withTimeout(
      supabase.storage
        .from('documents')
        .upload(path, fileData, { contentType: resolvedContentType, upsert: false }),
      DOCUMENT_UPLOAD_TIMEOUT_MS,
      'upload document web',
    );
    if (error) {
      console.error(`${tag} ECHEC SDK web: ${error.message}`);
      return { url: null, error: error.message };
    }
    const { data: urlData } = supabase.storage.from('documents').getPublicUrl(data.path);
    console.log(`${tag} SUCCÈS web — url: ${urlData.publicUrl}`);
    return { url: urlData.publicUrl, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${tag} ECHEC exception inattendue: ${msg}`);
    return { url: null, error: `Exception inattendue: ${msg}` };
  }
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
): Promise<{ data: Record<string, any> | null | undefined; allOk: boolean; hadLocal: boolean; uploadErrors: string[] }> {
  if (!payload || !isSupabaseConfigured) {
    return { data: payload, allOk: true, hadLocal: false, uploadErrors: [] };
  }
  const data = { ...payload };
  let allOk = true;
  let hadLocal = false;
  const uploadErrors: string[] = [];

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
    }
    if (Array.isArray(data.photos)) {
      const newPhotos: any[] = [];
      for (let i = 0; i < data.photos.length; i++) {
        const p = data.photos[i];
        if (p && typeof p.uri === 'string' && isLocalUri(p.uri)) {
          hadLocal = true;
          const { url: remote, error: uploadErr } = await uploadReservePhotoOnce(p.uri, `reserve_photo_${Date.now()}_${nextUploadSeq()}_${i}.jpg`);
          if (remote === (MISSING_LOCAL_FILE as any)) {
            continue;
          }
          if (remote) newPhotos.push({ ...p, uri: remote });
          else { newPhotos.push(p); allOk = false; if (uploadErr) uploadErrors.push(`photos[${i}]: ${uploadErr}`); }
        } else {
          newPhotos.push(p);
        }
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
