import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, AppState } from 'react-native';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn(
    '[Supabase] EXPO_PUBLIC_SUPABASE_URL ou EXPO_PUBLIC_SUPABASE_KEY non défini. ' +
    "L'application ne fonctionnera pas sans Supabase configuré."
  );
}

const SsrSafeStorage = {
  getItem: (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return Promise.resolve(null);
      return Promise.resolve(window.localStorage?.getItem(key) ?? null);
    }
    return AsyncStorage.getItem(key);
  },
  setItem: (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return Promise.resolve();
      window.localStorage?.setItem(key, value);
      return Promise.resolve();
    }
    return AsyncStorage.setItem(key, value);
  },
  removeItem: (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return Promise.resolve();
      window.localStorage?.removeItem(key);
      return Promise.resolve();
    }
    return AsyncStorage.removeItem(key);
  },
};

type SupabaseClientType = ReturnType<typeof createClient>;

const isValidUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export const isSupabaseConfigured = isValidUrl(SUPABASE_URL) && Boolean(SUPABASE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Verrou auth tolérant — fix critique React Native
//
// Par défaut, supabase-js v2 utilise un verrou interne (`processLock`) pour
// sérialiser les opérations auth (refreshSession, getSession, etc.). Sur React
// Native, quand l'app passe en arrière-plan pendant qu'un refresh est en cours,
// l'exécution JS est gelée. Au réveil, le verrou reste tenu par une promesse
// fantôme qui ne se résoudra jamais → tous les appels auth suivants attendent
// le verrou à l'infini, ce qui bloque AUSSI toutes les requêtes Supabase
// (storage, DB) qui ont besoin de récupérer le token.
//
// Notre verrou maison applique un délai d'attente strict (`acquireTimeout`).
// Si on n'arrive pas à acquérir dans ce délai, on libère de force et on
// poursuit. Pire scénario : deux refresh concurrents (sans gravité, le second
// utilise simplement le résultat du premier via le cache de session).
let lockChain: Promise<unknown> = Promise.resolve();
function safeLock<R>(_name: string, acquireTimeoutMs: number, fn: () => Promise<R>): Promise<R> {
  const previous = lockChain;
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  lockChain = next;

  const wait = new Promise<void>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      console.warn(`[supabase-lock] acquire timeout (${acquireTimeoutMs}ms), forcing release`);
      resolve();
    }, Math.max(50, acquireTimeoutMs));
    previous.finally(() => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    });
  });

  return wait.then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
}

export const supabase: SupabaseClientType = isSupabaseConfigured
  ? createClient(SUPABASE_URL!, SUPABASE_KEY!, {
      auth: {
        storage: SsrSafeStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        lock: Platform.OS === 'web' ? undefined : safeLock,
      } as any,
    })
  : (null as unknown as SupabaseClientType);

// ─────────────────────────────────────────────────────────────────────────────
// Démarrage / arrêt du auto-refresh selon l'état de l'app (React Native)
//
// Recommandation officielle Supabase pour React Native :
// https://supabase.com/docs/reference/javascript/initializing#react-native-options
//
// Sans ces appels, le timer interne d'auto-refresh continue à essayer de
// fonctionner alors que JS est gelé en arrière-plan. Au réveil, on se retrouve
// avec des refresh en retard, des verrous tenus, et des requêtes qui pendent.
//
// Avec ces appels :
//   - Au passage en arrière-plan : on stoppe le timer (plus de refresh fantôme)
//   - Au retour au premier plan  : on relance le timer ; supabase-js déclenche
//     immédiatement un refresh si le token est expiré ou proche de l'être.
//
// Enregistré une seule fois ici (au chargement du module), donc indépendant
// des providers React qui peuvent monter/démonter.
if (isSupabaseConfigured && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    try {
      if (state === 'active') {
        (supabase as any).auth?.startAutoRefresh?.();
      } else {
        (supabase as any).auth?.stopAutoRefresh?.();
      }
    } catch (err) {
      console.warn('[supabase] auto-refresh toggle failed:', (err as any)?.message ?? err);
    }
  });
  // L'app démarre en état "active" mais l'event ne se déclenche pas pour
  // l'état initial → on lance manuellement.
  try { (supabase as any).auth?.startAutoRefresh?.(); } catch {}
}
