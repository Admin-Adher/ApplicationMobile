import { QueryClient, focusManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

// ─────────────────────────────────────────────────────────────────────────────
// React Query focusManager — React Native AppState bridge
//
// By default React Query's `refetchOnWindowFocus` only reacts to browser
// visibility events. On React Native it does nothing because there is no
// window focus concept. We wire it up to AppState so that every time the
// user brings the app to the foreground, React Query triggers a refetch on
// all stale queries — exactly like a browser tab refocus would.
//
// This is essential for the "app resumes after a long background sleep" case:
// without this, screens that were displaying cached data never refresh even
// though the network is back and the auth token has been renewed.
// ─────────────────────────────────────────────────────────────────────────────
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener('change', (state) => {
      handleFocus(state === 'active');
    });
    return () => subscription.remove();
  });
}

// Supabase est la source de vérité quand on a Internet. Le cache local
// n'est qu'un buffer pour l'affichage instantané (et pour l'offline) :
// - staleTime: 0          → toute remontée d'écran déclenche un refetch
// - refetchOnMount: 'always' → idem côté navigation
// - refetchOnWindowFocus  → web/RN : refetch quand on revient dans l'app
// - refetchOnReconnect    → quand le réseau revient, on rafraîchit tout
// - gcTime: 24h           → on garde quand même 24h en cache pour le mode hors-ligne
//
// Important : les queryFn (useReserves, usePhotos, …) lisent d'abord le
// cache AsyncStorage pour un rendu instantané, puis fetchent Supabase pour
// remplacer les données. Donc même avec staleTime: 0 l'UI ne clignote pas.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnMount: 'always',
      refetchOnReconnect: true,
    },
  },
});
