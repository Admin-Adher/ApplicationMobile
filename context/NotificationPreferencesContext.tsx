import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotificationPreferences } from '@/constants/types';
import { useAuth } from '@/context/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  fromNotificationPreferences,
  toNotificationPreferences,
  withDefaultNotificationPreferences,
} from '@/lib/notificationPreferences';

const CACHE_PREFIX = 'buildtrack_notification_preferences_v1_';

interface NotificationPreferencesContextValue {
  preferences: NotificationPreferences;
  isLoading: boolean;
  lastError: string | null;
  updatePreferences: (patch: Partial<NotificationPreferences>) => Promise<void>;
  refreshPreferences: () => Promise<void>;
}

const NotificationPreferencesContext = createContext<NotificationPreferencesContextValue>({
  preferences: DEFAULT_NOTIFICATION_PREFERENCES,
  isLoading: false,
  lastError: null,
  updatePreferences: async () => {},
  refreshPreferences: async () => {},
});

function cacheKey(userId?: string | null) {
  return `${CACHE_PREFIX}${userId ?? 'anon'}`;
}

async function writeCache(userId: string | undefined, prefs: NotificationPreferences) {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(prefs));
  } catch {}
}

function friendlyPreferencesError(message: string): string {
  if (/notification_preferences|schema cache|Could not find the table/i.test(message)) {
    return "Migration Supabase manquante : la table public.notification_preferences n'existe pas encore. Appliquez la migration 20260520183000_add_notification_preferences.sql.";
  }
  return message || 'Impossible de charger les préférences de notifications.';
}

export function NotificationPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const organizationId = user?.organizationId ?? null;
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [isLoading, setIsLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const refreshPreferences = useCallback(async () => {
    if (!userId) {
      setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
      return;
    }

    setIsLoading(true);
    try {
      const raw = await AsyncStorage.getItem(cacheKey(userId));
      if (raw) {
        try {
          setPreferences(withDefaultNotificationPreferences(JSON.parse(raw)));
        } catch {}
      }

      if (!isSupabaseConfigured) {
        setLastError(null);
        return;
      }

      const { data, error } = await (supabase as any)
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const fresh = toNotificationPreferences(data);
        setPreferences(fresh);
        await writeCache(userId, fresh);
        setLastError(null);
        return;
      }

      const defaults = withDefaultNotificationPreferences({ userId, organizationId });
      setPreferences(defaults);
      await writeCache(userId, defaults);
      const { error: upsertError } = await (supabase as any)
        .from('notification_preferences')
        .upsert(fromNotificationPreferences(defaults), { onConflict: 'user_id' });
      if (upsertError) throw upsertError;
      setLastError(null);
    } catch (err: any) {
      const message = err?.message ?? 'Impossible de charger les preferences de notifications.';
      console.warn('[notification preferences] load error:', message);
      setLastError(friendlyPreferencesError(message));
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, userId]);

  useEffect(() => {
    void refreshPreferences();
  }, [refreshPreferences]);

  const updatePreferences = useCallback(async (patch: Partial<NotificationPreferences>) => {
    if (!userId) return;
    const next = withDefaultNotificationPreferences({
      ...preferences,
      ...patch,
      userId,
      organizationId,
    });

    setPreferences(next);
    await writeCache(userId, next);

    if (!isSupabaseConfigured) return;

    try {
      const { error } = await (supabase as any)
        .from('notification_preferences')
        .upsert(fromNotificationPreferences(next), { onConflict: 'user_id' });
      if (error) throw error;

      if (typeof patch.pushEnabled === 'boolean') {
        await (supabase as any)
          .from('push_tokens')
          .update({ enabled: patch.pushEnabled, updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      }
      setLastError(null);
    } catch (err: any) {
      const message = err?.message ?? 'Impossible d enregistrer les preferences.';
      console.warn('[notification preferences] save error:', message);
      setLastError(friendlyPreferencesError(message));
    }
  }, [organizationId, preferences, userId]);

  const value = useMemo<NotificationPreferencesContextValue>(() => ({
    preferences,
    isLoading,
    lastError,
    updatePreferences,
    refreshPreferences,
  }), [isLoading, lastError, preferences, refreshPreferences, updatePreferences]);

  return (
    <NotificationPreferencesContext.Provider value={value}>
      {children}
    </NotificationPreferencesContext.Provider>
  );
}

export function useNotificationPreferences() {
  return useContext(NotificationPreferencesContext);
}
