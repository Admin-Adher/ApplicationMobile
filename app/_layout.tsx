import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AppProvider } from '@/context/AppContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { C } from '@/constants/colors';

SplashScreen.preventAutoHideAsync();

function SupabaseNotConfiguredScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.notConfiguredContainer, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.iconWrap}>
        <Text style={styles.iconText}>🔌</Text>
      </View>
      <Text style={styles.notConfiguredTitle}>Supabase non configuré</Text>
      <Text style={styles.notConfiguredSub}>
        Les variables d'environnement Supabase sont absentes.{'\n'}
        Veuillez définir{' '}
        <Text style={styles.mono}>EXPO_PUBLIC_SUPABASE_URL</Text>
        {' '}et{' '}
        <Text style={styles.mono}>EXPO_PUBLIC_SUPABASE_KEY</Text>
        {' '}pour démarrer l'application.
      </Text>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>EXPO_PUBLIC_SUPABASE_URL</Text>
        <Text style={styles.cardValue}>Non définie</Text>
        <View style={styles.divider} />
        <Text style={styles.cardLabel}>EXPO_PUBLIC_SUPABASE_KEY</Text>
        <Text style={styles.cardValue}>Non définie</Text>
      </View>
    </View>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === 'login';
    if (!isAuthenticated && !inAuth) {
      router.replace('/login');
    } else if (isAuthenticated && inAuth) {
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
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  if (!isSupabaseConfigured) {
    return (
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SupabaseNotConfiguredScreen />
          <StatusBar style="dark" />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    );
  }

  return (
    <AuthProvider>
      <AppProvider>
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
                  <Stack.Screen name="photos" options={{ headerShown: false }} />
                  <Stack.Screen name="rapports" options={{ headerShown: false }} />
                  <Stack.Screen name="messages" options={{ headerShown: false }} />
                  <Stack.Screen name="+not-found" />
                </Stack>
              </AuthGuard>
              <StatusBar style="dark" />
            </KeyboardProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </AppProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  notConfiguredContainer: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  iconText: {
    fontSize: 36,
  },
  notConfiguredTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  notConfiguredSub: {
    fontSize: 15,
    color: C.textSub,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: C.primary,
    backgroundColor: C.primaryBg,
  },
  card: {
    width: '100%',
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 14,
    color: C.open,
    fontWeight: '500',
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: C.border,
    marginBottom: 12,
  },
});
