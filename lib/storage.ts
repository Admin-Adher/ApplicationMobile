import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';

async function uriToBlob(uri: string): Promise<Blob> {
  if (Platform.OS !== 'web' && uri.startsWith('file://')) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.response as Blob);
      xhr.onerror = () => reject(new Error('XHR: impossible de lire le fichier local.'));
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send();
    });
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Impossible de lire le fichier source.');
  return response.blob();
}

export async function uploadPhoto(uri: string, filename: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const blob = await uriToBlob(uri);
    const path = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('photos')
      .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
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
  if (!isSupabaseConfigured) return null;
  try {
    const blob = await uriToBlob(uri);
    const path = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('documents')
      .upload(path, blob, { contentType: mimeType || blob.type || 'application/octet-stream', upsert: false });
    if (error) {
      console.warn('uploadDocument Supabase error:', error.message);
      return null;
    }
    const { data: urlData } = supabase.storage.from('documents').getPublicUrl(data.path);
    return urlData.publicUrl;
  } catch (e) {
    console.warn('uploadDocument failed, using local URI:', e);
    return null;
  }
}

export async function initStorageBuckets(): Promise<void> {
  // Les buckets doivent être créés via Supabase SQL Editor (voir lib/schema.sql).
  // La création programmatique via la clé anon est bloquée par RLS.
}
