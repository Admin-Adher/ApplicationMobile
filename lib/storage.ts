import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { supabase, isSupabaseConfigured } from './supabase';

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

// Délai max pour tout l'upload (lecture + envoi + réponse Supabase).
// 30 s couvre les réseaux mobiles lents (chantier, zones rurales). Si le délai
// est dépassé, on renvoie null et l'appelant bascule sur la file de sync.
const PHOTO_UPLOAD_TIMEOUT_MS = 30_000;

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

async function localFileMissing(uri: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!uri.startsWith('file://')) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return !info?.exists;
  } catch {
    return false;
  }
}

export async function uploadPhoto(uri: string, filename: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  if (await localFileMissing(uri)) {
    console.warn('[uploadPhoto] local file missing, dropping:', uri);
    return MISSING_LOCAL_FILE;
  }
  try {
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
    const contentType =
      ext === 'png'
        ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : 'image/jpeg';
    const path = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    // Read as Blob — reliable on both web and native (Supabase Storage SDK
    // handles Blob correctly; Uint8Array was unreliable on React Native/Hermes).
    const { data: fileData } = await readFileAsBlob(uri);

    const { data, error } = await withTimeout(
      supabase.storage
        .from('photos')
        .upload(path, fileData, { contentType, upsert: false }),
      PHOTO_UPLOAD_TIMEOUT_MS,
      'upload photo',
    );
    if (error) {
      console.warn('uploadPhoto Supabase error:', error.message);
      return null;
    }
    const { data: urlData } = supabase.storage.from('photos').getPublicUrl(data.path);
    return urlData.publicUrl;
  } catch (e) {
    console.warn('uploadPhoto failed:', e);
    return null;
  }
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
  if (!isSupabaseConfigured)
    return {
      url: null,
      error:
        'Supabase non configuré (variables EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY manquantes).',
    };
  try {
    const { data: fileData, mimeType: detectedMime } = await readFileAsBlob(uri);
    const contentType = mimeType || detectedMime || 'application/octet-stream';
    const path = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('documents')
      .upload(path, fileData, { contentType, upsert: false });
    if (error) {
      console.warn('uploadDocument Supabase error:', error.message);
      return { url: null, error: error.message };
    }
    const { data: urlData } = supabase.storage.from('documents').getPublicUrl(data.path);
    return { url: urlData.publicUrl, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('uploadDocument failed:', msg);
    return { url: null, error: msg };
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
 * Walks a payload destined for Supabase and uploads any local photo URIs
 * (file://, content://, ph://, data:) to Supabase Storage, replacing them
 * with public URLs in-place.
 *
 * Returns:
 *   - data    : a NEW payload object with remote URLs (do not mutate the input)
 *   - allOk   : true only if every local URI we found was uploaded successfully
 *               (also true when there were no local URIs at all)
 *   - hadLocal: true if at least one field still pointed to a local URI when
 *               we were called (useful for callers to know "did this row need
 *               photo work")
 */
export async function uploadLocalPhotosInPayload(
  table: string,
  payload: Record<string, any> | null | undefined,
): Promise<{ data: Record<string, any> | null | undefined; allOk: boolean; hadLocal: boolean }> {
  if (!payload || !isSupabaseConfigured) {
    return { data: payload, allOk: true, hadLocal: false };
  }
  const data = { ...payload };
  let allOk = true;
  let hadLocal = false;

  if (table === 'reserves') {
    if (typeof data.photo_uri === 'string' && isLocalUri(data.photo_uri)) {
      hadLocal = true;
      const remote = await uploadPhoto(data.photo_uri, `reserve_${Date.now()}.jpg`);
      if (remote === MISSING_LOCAL_FILE) data.photo_uri = null;
      else if (remote) data.photo_uri = remote;
      else allOk = false;
    }
    if (Array.isArray(data.photos)) {
      const newPhotos: any[] = [];
      for (let i = 0; i < data.photos.length; i++) {
        const p = data.photos[i];
        if (p && typeof p.uri === 'string' && isLocalUri(p.uri)) {
          hadLocal = true;
          const remote = await uploadPhoto(p.uri, `reserve_photo_${Date.now()}_${i}.jpg`);
          if (remote === MISSING_LOCAL_FILE) {
            continue;
          }
          if (remote) newPhotos.push({ ...p, uri: remote });
          else { newPhotos.push(p); allOk = false; }
        } else {
          newPhotos.push(p);
        }
      }
      data.photos = newPhotos;
    }
  } else if (table === 'photos') {
    if (typeof data.uri === 'string' && isLocalUri(data.uri)) {
      hadLocal = true;
      const remote = await uploadPhoto(data.uri, `photo_${Date.now()}.jpg`);
      if (remote === MISSING_LOCAL_FILE) {
        return { data: null, allOk: true, hadLocal: true };
      }
      if (remote) data.uri = remote;
      else allOk = false;
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
      const { url } = await uploadDocumentDetailed(data.uri, filename, mime);
      if (url) data.uri = url;
      else allOk = false;
    }
  }

  return { data, allOk, hadLocal };
}
