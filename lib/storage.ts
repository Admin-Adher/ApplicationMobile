import { supabase, isSupabaseConfigured } from './supabase';

async function uriToBlob(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return response.blob();
}

export async function uploadPhoto(uri: string, filename: string): Promise<string | null> {
  try {
    const blob = await uriToBlob(uri);
    const path = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('photos')
      .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    if (error) {
      console.warn('Photo upload error:', error.message);
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
  try {
    const blob = await uriToBlob(uri);
    const path = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('documents')
      .upload(path, blob, { contentType: mimeType || blob.type || 'application/octet-stream', upsert: false });
    if (error) {
      console.warn('Document upload error:', error.message);
      return null;
    }
    const { data: urlData } = supabase.storage.from('documents').getPublicUrl(data.path);
    return urlData.publicUrl;
  } catch (e) {
    console.warn('uploadDocument failed:', e);
    return null;
  }
}

export async function initStorageBuckets(): Promise<void> {
  // Les buckets doivent être créés via Supabase SQL Editor (voir lib/migration_subscription.sql).
  // La création programmatique via la clé anon est bloquée par RLS.
}
