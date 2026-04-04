import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, LogBox, ActivityIndicator, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ErrorBoundary as AppErrorBoundary } from '@/components/ErrorBoundary';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AppProvider } from '@/context/AppContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { IncidentsProvider } from '@/context/IncidentsContext';
import { PointageProvider } from '@/context/PointageContext';
import { ReglementaireProvider } from '@/context/ReglementaireContext';
import { SubscriptionProvider } from '@/context/SubscriptionContext';
import { NetworkProvider } from '@/context/NetworkContext';
import { NotificationsProvider } from '@/context/NotificationsContext';
import NotificationBanner from '@/components/NotificationBanner';
import OfflineBanner from '@/components/OfflineBanner';
import ChantierSwitcherSheet from '@/components/ChantierSwitcherSheet';

function reloadApp() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.reload();
}

if (Platform.OS === 'web') {
  LogBox.ignoreLogs([
    "Couldn't find real values for `KeyboardContext`",
    'useNativeDriver is not supported',
    '"shadow*" style props are deprecated',
  ]);
}

SplashScreen.preventAutoHideAsync();

function SafeKeyboardProvider({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'web') {
    return <>{children}</>;
  }
  try {
    return <KeyboardProvider>{children}</KeyboardProvider>;
  } catch {
    return <>{children}</>;
  }
}

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const handleRestart = () => {
    if (Platform.OS !== 'web') {
      retry();
    } else {
      reloadApp();
    }
  };
  return (
    <View style={eb.container}>
      <Text style={eb.title}>Une erreur est survenue</Text>
      <Text style={eb.message}>{error?.message ?? 'Erreur inconnue au démarrage.'}</Text>
      <TouchableOpacity style={eb.button} onPress={handleRestart}>
        <Text style={eb.buttonText}>Redémarrer</Text>
      </TouchableOpacity>
    </View>
  );
}

const eb = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F1117', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  message: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
  button: { backgroundColor: '#1D4ED8', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12, marginTop: 8 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});

const LAST_TAB_KEY = 'buildtrack_last_tab';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const hasRestoredTab = useRef(false);

  // Sauvegarde l'onglet actif à chaque changement de navigation
  useEffect(() => {
    if (!isAuthenticated || isLoading) return;
    const seg0 = segments[0] as string;
    const seg1 = segments[1] as string | undefined;
    if (seg0 === '(tabs)') {
      const tab = seg1 ? `/(tabs)/${seg1}` : '/(tabs)';
      AsyncStorage.setItem(LAST_TAB_KEY, tab).catch(() => {});
    }
  }, [segments, isAuthenticated, isLoading]);

  // Restaure le dernier onglet visité au démarrage de l'app
  useEffect(() => {
    if (isLoading || !isAuthenticated || hasRestoredTab.current) return;
    hasRestoredTab.current = true;
    AsyncStorage.getItem(LAST_TAB_KEY).then((savedTab) => {
      if (savedTab && savedTab !== '/(tabs)' && savedTab !== '/(tabs)/index') {
        router.replace(savedTab as any);
      }
    }).catch(() => {});
  }, [isLoading, isAuthenticated]);

  useEffect(() => {
    if (isLoading) return;
    const PUBLIC_SEGMENTS = ['login', 'register', 'portal', 'opr-session', 'pending-invite'];
    const seg0 = segments.length > 0 ? (segments[0] as string) : undefined;
    const inPublic = seg0 ? PUBLIC_SEGMENTS.includes(seg0) : true;

    if (!isAuthenticated && !inPublic) {
      router.replace('/login');
    } else if (isAuthenticated && seg0 === 'login') {
      router.replace('/(tabs)');
    } else if (
      isAuthenticated &&
      user &&
      !user.organizationId &&
      user.role !== 'super_admin' &&
      seg0 !== 'pending-invite'
    ) {
      router.replace('/pending-invite');
    } else if (isAuthenticated && seg0 === 'pending-invite' && user?.organizationId) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments, user?.organizationId, user?.role]);

  // Block any content from showing while the auth state is being determined.
  // Without this, there is a flash of unauthenticated UI between the moment
  // fonts finish loading and the moment getSession() resolves.
  if (isLoading) {
    return (
      <View style={authGuardStyles.container}>
        <Image
          source={require('../assets/images/icon.png')}
          style={authGuardStyles.logoMark}
          resizeMode="contain"
        />
        <Text style={authGuardStyles.brand}>BuildTrack</Text>
        <ActivityIndicator
          size="small"
          color="rgba(255,255,255,0.5)"
          style={{ marginTop: 32 }}
        />
      </View>
    );
  }

  return <>{children}</>;
}

const authGuardStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#003082',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: 4,
  },
  brand: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ionicons: require('../assets/fonts/ionicons.ttf'),
  });
  const [timedOut, setTimedOut] = useState(false);

  const fontsReady = fontsLoaded || !!fontError || timedOut;

  useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOut(true);
      SplashScreen.hideAsync().catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0F1117', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#6B7280', fontSize: 12, fontFamily: undefined }}>
          Chargement…
        </Text>
      </View>
    );
  }

  return (
    <AuthProvider>
      <SubscriptionProvider>
      <NetworkProvider>
      <AppProvider>
        <SettingsProvider>
          <IncidentsProvider>
          <PointageProvider>
          <ReglementaireProvider>
          <NotificationsProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <SafeAreaProvider>
                <SafeKeyboardProvider>
                  <AuthGuard>
                    <AppErrorBoundary>
                    <Stack>
                      <Stack.Screen name="login" options={{ headerShown: false }} />
                      <Stack.Screen name="register" options={{ headerShown: false }} />
                      <Stack.Screen name="pending-invite" options={{ headerShown: false }} />
                      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                      <Stack.Screen name="incident/new" options={{ headerShown: false }} />
                      <Stack.Screen name="incident/[id]" options={{ headerShown: false }} />
                      <Stack.Screen name="reserve/[id]" options={{ headerShown: false }} />
                      <Stack.Screen name="reserve/new" options={{ headerShown: false }} />
                      <Stack.Screen name="documents" options={{ headerShown: false }} />
                      <Stack.Screen name="planning" options={{ headerShown: false }} />
                      <Stack.Screen name="task/new" options={{ headerShown: false }} />
                      <Stack.Screen name="task/[id]" options={{ headerShown: false }} />
                      <Stack.Screen name="photos" options={{ headerShown: false }} />
                      <Stack.Screen name="rapports" options={{ headerShown: false }} />
                      <Stack.Screen name="messages" options={{ headerShown: false }} />
                      <Stack.Screen name="channel/[id]" options={{ headerShown: false }} />
                      <Stack.Screen name="incidents" options={{ headerShown: false }} />
                      <Stack.Screen name="search" options={{ headerShown: false }} />
                      <Stack.Screen name="settings" options={{ headerShown: false }} />
                      <Stack.Screen name="pointage" options={{ headerShown: false }} />
                      <Stack.Screen name="reglementaire" options={{ headerShown: false }} />
                      <Stack.Screen name="subscription" options={{ headerShown: false }} />
                      <Stack.Screen name="superadmin" options={{ headerShown: false }} />
                      <Stack.Screen name="checklist" options={{ headerShown: false, title: 'Checklists' }} />
                      <Stack.Screen name="journal" options={{ headerShown: false, title: 'Journal de chantier' }} />
                      <Stack.Screen name="meeting-report" options={{ headerShown: false, title: 'CR Réunions' }} />
                      <Stack.Screen name="notifications" options={{ headerShown: false, title: 'Notifications' }} />
                      <Stack.Screen name="portal/[companyId]" options={{ headerShown: false }} />
                      <Stack.Screen name="opr-session/[id]" options={{ headerShown: false }} />
                      <Stack.Screen name="analytics" options={{ headerShown: false }} />
                      <Stack.Screen name="chantier/manage" options={{ headerShown: false }} />
                      <Stack.Screen name="chantier/new" options={{ headerShown: false }} />
                      <Stack.Screen name="integrations" options={{ headerShown: false }} />
                      <Stack.Screen name="lots" options={{ headerShown: false }} />
                      <Stack.Screen name="opr" options={{ headerShown: false }} />
                      <Stack.Screen name="sous-traitant" options={{ headerShown: false }} />
                      <Stack.Screen name="visites" options={{ headerShown: false }} />
                      <Stack.Screen name="visite/new" options={{ headerShown: false }} />
                      <Stack.Screen name="visite/[id]" options={{ headerShown: false }} />
                      <Stack.Screen name="+not-found" />
                    </Stack>
                    </AppErrorBoundary>
                  </AuthGuard>
                  <NotificationBanner />
                  <OfflineBanner />
                  <ChantierSwitcherSheet />
                  <StatusBar style="light" />
                </SafeKeyboardProvider>
              </SafeAreaProvider>
            </GestureHandlerRootView>
          </NotificationsProvider>
          </ReglementaireProvider>
          </PointageProvider>
          </IncidentsProvider>
        </SettingsProvider>
      </AppProvider>
      </NetworkProvider>
      </SubscriptionProvider>
    </AuthProvider>
  );
}
