import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

function resolveProjectId(): string | undefined {
  return (
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId
  );
}

export async function deleteCurrentPushToken(userId?: string | null): Promise<void> {
  if (Platform.OS === 'web' || !userId || !isSupabaseConfigured) return;
  try {
    const projectId = resolveProjectId();
    if (!projectId) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await (supabase as any)
      .from('push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);
  } catch (err: any) {
    console.warn('[push] token cleanup error:', err?.message ?? err);
  }
}
