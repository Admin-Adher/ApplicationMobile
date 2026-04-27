import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { supabase, isSupabaseConfigured } from './supabase';

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function readFileAsArrayBuffer(uri: string): Promise<{ data: Uint8Array; mimeType: string }> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Impossible de lire le fichier source.');
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    return { data: new Uint8Array(arrayBuffer), mimeType: blob.type || 'application/octet-stream' };
  }
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return { data: base64ToUint8Array(base64), mimeType: 'application/octet-stream' };
}

export async function uploadPhoto(uri: string, filename: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data: fileData } = await readFileAsArrayBuffer(uri);
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
    const contentType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/jpeg';
    const path = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('photos')
      .upload(path, fileData, { contentType, upsert: false });
    if (error) {
      console.warn('uploadPhoto Supabase error:', error.message);
      return null;
    }
    const { data: urlData } = supabase.storage.from('photos').getPublicUrl(data.path);
    return urlData.publicUrl;
  } catch (e) {
    console.warn('uploadPhoto failed, using local URI:', e);
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
  if (!isSupabaseConfigured) return { url: null, error: 'Supabase non configuré (variables EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY manquantes).' };
  try {
    const { data: fileData, mimeType: detectedMime } = await readFileAsArrayBuffer(uri);
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
  return uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('ph://') || uri.startsWith('data:');
}

/**
 * Copy a photo from a temporary location (camera cache, gallery temp) to the
 * app's persistent documentDirectory so it survives app restarts.
 * Returns the persistent local URI, or the original URI on web / if already persistent.
 */
export async function persistLocalPhoto(uri: string): Promise<string> {
  if (Platform.OS === 'web') return uri;
  if (!isLocalUri(uri)) return uri; // already a remote URL
  if (uri.startsWith(FileSystem.documentDirectory ?? '\0')) return uri; // already persistent

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
    return uri; // fallback: use original (may break after restart, but better than losing the photo entirely)
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
 * Why : even when the app is online, an individual photo upload can fail
 * (transient network blip, RLS hiccup, bucket quota, expired session). When
 * that happens, the local URI used to leak into Supabase as text — meaning
 * the row was synced but the photo only existed on the device that took it.
 * This helper lets the calling code detect that case and re-queue the
 * operation for a later sync attempt instead of pushing a broken row.
 *
 * Returns:
 *   - data    : a NEW payload object with remote URLs (do not mutate the input)
 *   - allOk   : true only if every local URI we found was uploaded successfully
 *               (also true when there were no local URIs at all)
 *   - hadLocal: true if at least one field still pointed to a local URI when
 *               we were called (useful for callers to know "did this row need
 *               photo work")
 *
 * Currently handles fields used by the `reserves` and `photos` tables:
 *   - reserves : photo_uri (string), photos[].uri (array of objects)
 *   - photos   : uri (string)
 * Extending this helper to other tables (visites, oprs, …) is a one-line job.
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
      if (remote) data.photo_uri = remote;
      else allOk = false;
    }
    if (Array.isArray(data.photos)) {
      const newPhotos = [...data.photos];
      for (let i = 0; i < newPhotos.length; i++) {
        const p = newPhotos[i];
        if (p && typeof p.uri === 'string' && isLocalUri(p.uri)) {
          hadLocal = true;
          const remote = await uploadPhoto(p.uri, `reserve_photo_${Date.now()}_${i}.jpg`);
          if (remote) newPhotos[i] = { ...p, uri: remote };
          else allOk = false;
        }
      }
      data.photos = newPhotos;
    }
  } else if (table === 'photos') {
    if (typeof data.uri === 'string' && isLocalUri(data.uri)) {
      hadLocal = true;
      const remote = await uploadPhoto(data.uri, `photo_${Date.now()}.jpg`);
      if (remote) data.uri = remote;
      else allOk = false;
    }
  } else if (table === 'site_plans') {
    // Site plans can be PDF, image or DXF — use the generic document uploader
    // (the `documents` Storage bucket) instead of the photo bucket.
    if (typeof data.uri === 'string' && isLocalUri(data.uri)) {
      hadLocal = true;
      const ext = (() => {
        const m = data.uri.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
        return m ? m[1].toLowerCase() : (data.file_type === 'pdf' ? 'pdf' : data.file_type === 'dxf' ? 'dxf' : 'jpg');
      })();
      const safeName = (typeof data.name === 'string' ? data.name : 'plan').replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = `plan_${Date.now()}_${safeName}.${ext}`;
      const mime =
        data.file_type === 'pdf' ? 'application/pdf' :
        data.file_type === 'dxf' ? 'application/octet-stream' :
        undefined;
      const { url } = await uploadDocumentDetailed(data.uri, filename, mime);
      if (url) data.uri = url;
      else allOk = false;
    }
  }

  return { data, allOk, hadLocal };
}
