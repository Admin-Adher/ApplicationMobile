import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
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

SplashScreen.preventAutoHideAsync();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const PUBLIC_SEGMENTS = ['login', 'portal', 'opr-session'];
    const inPublic = PUBLIC_SEGMENTS.includes(segments[0] as string);
    if (!isAuthenticated && !inPublic) {
      router.replace('/login');
    } else if (isAuthenticated && segments[0] === 'login') {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ionicons: require('../assets/fonts/ionicons.ttf'),
  });

  const fontsReady = fontsLoaded || !!fontError;

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return null;
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
                <KeyboardProvider>
                  <AuthGuard>
                    <Stack>
                      <Stack.Screen name="login" options={{ headerShown: false }} />
                      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
                      <Stack.Screen name="+not-found" />
                    </Stack>
                  </AuthGuard>
                  <NotificationBanner />
                  <OfflineBanner />
                  <ChantierSwitcherSheet />
                  <StatusBar style="light" />
                </KeyboardProvider>
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
