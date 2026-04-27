import { QueryClient } from '@tanstack/react-query';

// Supabase est la source de vérité quand on a Internet. Le cache local
// n'est qu'un buffer pour l'affichage instantané (et pour l'offline) :
// - staleTime: 0          → toute remontée d'écran déclenche un refetch
// - refetchOnMount: 'always' → idem côté navigation
// - refetchOnWindowFocus  → web : refetch quand on revient dans l'onglet
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
