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

export async function initStorageBuckets(): Promise<void> {
  // Les buckets doivent être créés via Supabase SQL Editor (voir lib/schema.sql).
  // La création programmatique via la clé anon est bloquée par RLS.
}
