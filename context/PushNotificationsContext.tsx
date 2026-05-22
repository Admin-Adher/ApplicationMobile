import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNotificationPreferences } from '@/context/NotificationPreferencesContext';

type PushPermissionStatus = 'unsupported' | 'undetermined' | 'granted' | 'denied';

interface PushNotificationsContextValue {
  expoPushToken: string | null;
  permissionStatus: PushPermissionStatus;
  lastError: string | null;
  retryRegistration: () => void;
}

const PushNotificationsContext = createContext<PushNotificationsContextValue>({
  expoPushToken: null,
  permissionStatus: 'undetermined',
  lastError: null,
  retryRegistration: () => {},
});

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

function resolveProjectId(): string | undefined {
  return (
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId
  );
}

function normalizePermission(status?: Notifications.PermissionStatus | null): PushPermissionStatus {
  if (!status) return 'undetermined';
  if (status === Notifications.PermissionStatus.GRANTED) return 'granted';
  if (status === Notifications.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

function routeNotification(router: ReturnType<typeof useRouter>, data: Record<string, unknown> | undefined) {
  if (!data) return;
  const pathname = typeof data.pathname === 'string' ? data.pathname : undefined;
  const id = typeof data.id === 'string' ? data.id : undefined;

  if (pathname === '/channel/[id]' && id) {
    router.push({ pathname, params: { id } } as any);
    return;
  }
  if (pathname === '/reserve/[id]' && id) {
    router.push({ pathname, params: { id } } as any);
    return;
  }
  const path = typeof data.path === 'string' ? data.path : undefined;
  if (path?.startsWith('/')) router.push(path as any);
}

function friendlyPushError(message: string): string {
  if (/push_tokens|schema cache|Could not find the table/i.test(message)) {
    return "Migration Supabase manquante : la table public.push_tokens n'existe pas encore. Appliquez la migration 20260520143000_add_push_notifications.sql puis relancez l'application.";
  }
  if (/FirebaseApp is not initialized|fcm-credentials|google-services/i.test(message)) {
    return "Configuration Android FCM incomplète : ajoutez le fichier google-services.json dans l'app et la clé FCM V1 dans Expo/EAS, puis rebuild l'APK.";
  }
  if (/Project ID Expo/i.test(message)) {
    return message;
  }
  return message || 'Impossible de configurer les notifications push.';
}

export function PushNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { preferences } = useNotificationPreferences();
  const router = useRouter();
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<PushPermissionStatus>(
    Platform.OS === 'web' ? 'unsupported' : 'undetermined',
  );
  const [lastError, setLastError] = useState<string | null>(null);
  const [registrationNonce, setRegistrationNonce] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      routeNotification(router, response.notification.request.content.data as Record<string, unknown> | undefined);
    });

    Notifications.getLastNotificationResponseAsync()
      .then(response => {
        if (response) {
          routeNotification(router, response.notification.request.content.data as Record<string, unknown> | undefined);
        }
      })
      .catch(() => {});

    return () => responseSubscription.remove();
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function register() {
      if (Platform.OS === 'web') {
        setPermissionStatus('unsupported');
        return;
      }
      if (!user?.id || !isSupabaseConfigured) return;
      if (!preferences.pushEnabled) {
        setExpoPushToken(null);
        setLastError(null);
        return;
      }

      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('buildtrack', {
            name: 'BuildTrack',
            importance: Notifications.AndroidImportance.DEFAULT,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#003082',
          });
        }

        const existing = await Notifications.getPermissionsAsync();
        let finalStatus = existing.status;
        if (existing.status !== Notifications.PermissionStatus.GRANTED) {
          const requested = await Notifications.requestPermissionsAsync();
          finalStatus = requested.status;
        }
        if (cancelled) return;

        const normalized = normalizePermission(finalStatus);
        setPermissionStatus(normalized);
        if (normalized !== 'granted') return;

        const projectId = resolveProjectId();
        if (!projectId) {
          setLastError(friendlyPushError('Project ID Expo introuvable pour les notifications push.'));
          return;
        }

        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (cancelled) return;
        setExpoPushToken(token);
        setLastError(null);

        const { error } = await (supabase as any).from('push_tokens').upsert({
          token,
          user_id: user.id,
          organization_id: user.organizationId ?? null,
          platform: Platform.OS,
          enabled: true,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'token' });

        if (error && !cancelled) {
          console.warn('[push] token upsert error:', error.message);
          setLastError(error.message);
        }
      } catch (err: any) {
        if (!cancelled) {
          const message = err?.message ?? 'Impossible de configurer les notifications push.';
          console.warn('[push] registration error:', message);
          setLastError(friendlyPushError(message));
        }
      }
    }

    void register();
    return () => { cancelled = true; };
  }, [user?.id, user?.organizationId, preferences.pushEnabled, registrationNonce]);

  const value = useMemo<PushNotificationsContextValue>(() => ({
    expoPushToken,
    permissionStatus,
    lastError,
    retryRegistration: () => setRegistrationNonce(n => n + 1),
  }), [expoPushToken, permissionStatus, lastError]);

  return (
    <PushNotificationsContext.Provider value={value}>
      {children}
    </PushNotificationsContext.Provider>
  );
}

export function usePushNotifications() {
  return useContext(PushNotificationsContext);
}
