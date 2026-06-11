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
// Bug critique identifié :
//   Supabase-js v2 passe acquireTimeoutMs = Infinity à notre safeLock.
//   Math.max(50, Infinity) = Infinity → le setTimeout ne se déclenche JAMAIS.
//   Quand l'app est mise en veille pendant un refresh en cours, le verrou
//   reste tenu par une promesse fantôme (JS gelé). Au réveil, TOUS les appels
//   getSession() / refreshSession() attendent ce verrou à l'infini :
//     → diagnostic bloqué sur "Vérification en cours..."
//     → query hooks bloqués → écrans vides à l'infini
//
// Fix : plafonnement strict du timeout à LOCK_MAX_MS (5 s).
//   Si on n'acquiert pas le verrou en 5 s on force la libération et on
//   continue. Pire scénario : deux refresh concurrents (bénin — le second
//   réutilise le token du premier depuis le cache de session).
//
// Fix complémentaire : au retour en premier plan (AppState → 'active'),
//   on réinitialise lockChain à une promesse déjà résolue, ce qui libère
//   instantanément tout appel en attente, avant de relancer startAutoRefresh.
// ─────────────────────────────────────────────────────────────────────────────

const LOCK_MAX_MS = 5_000;

// ─────────────────────────────────────────────────────────────────────────────
// Fetch avec timeout — cause racine des "sync serveur aléatoires"
//
// Sur Android, après une mise en veille / un changement de réseau, le pool de
// connexions HTTP (OkHttp) peut conserver un socket TCP mort vers l'hôte
// Supabase. Toute requête réutilisant ce socket pend indéfiniment : React
// Native n'applique aucun read-timeout, et supabase-js n'en définit aucun.
// Le reste du réseau répond normalement (autres hôtes = autres sockets), d'où
// le symptôme "réseau local OK mais serveur Supabase muet > 15 s" que seul un
// redémarrage complet de l'app (nouveau pool) corrigeait.
//
// Pire : au démarrage, GoTrueClient lance _recoverAndRefresh() et TOUS les
// appels auth.* attendent initializePromise AVANT d'acquérir le verrou — le
// plafonnement du verrou (safeLock ci-dessous) ne protège donc pas ce chemin.
// Si ce refresh initial pend, getSession()/refreshSession() pendent pour
// toujours, quel que soit l'état du verrou.
//
// Fix : on injecte ce fetch dans createClient (global.fetch). Chaque requête
// est bornée par un AbortController. L'abandon ferme le socket mort (OkHttp
// l'évince du pool) et :
//   • auth-js convertit le reject en AuthRetryableFetchError → son retry
//     interne (backoff 200 ms × 2^n, fenêtre 30 s) repart sur un socket neuf ;
//   • pour les GET idempotents (PostgREST, /auth/v1/user), on retente nous-
//     mêmes une fois immédiatement — le second essai aboutit en ~1 s ;
//   • les mutations (POST/PATCH/DELETE) ne sont jamais rejouées ici : la file
//     offline (NetworkContext) gère déjà leur reprise sans doublon.
// ─────────────────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_AUTH_MS = 12_000;     // /auth/v1/* — petits payloads, retry interne auth-js
const FETCH_TIMEOUT_REST_MS = 15_000;     // /rest/v1/* — requêtes JSON, + 1 retry si GET
const FETCH_TIMEOUT_STORAGE_MS = 120_000; // /storage/v1/* — uploads de photos sur réseau lent

function timeoutForUrl(url: string): number {
  if (url.includes('/auth/v1/')) return FETCH_TIMEOUT_AUTH_MS;
  if (url.includes('/storage/v1/')) return FETCH_TIMEOUT_STORAGE_MS;
  return FETCH_TIMEOUT_REST_MS;
}

function fetchWithTimeout(input: any, init?: any): Promise<Response> {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input));
  const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
  const timeoutMs = timeoutForUrl(url);
  const upstream: AbortSignal | undefined = init?.signal;

  const attempt = (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (upstream) {
      if (upstream.aborted) controller.abort();
      else upstream.addEventListener('abort', () => controller.abort(), { once: true } as any);
    }
    return fetch(input, { ...(init ?? {}), signal: controller.signal })
      .finally(() => clearTimeout(timer));
  };

  return attempt().catch((err: any) => {
    const timedOut = err?.name === 'AbortError' && !upstream?.aborted;
    const idempotent = method === 'GET' || method === 'HEAD';
    if (timedOut && idempotent) {
      console.warn(`[supabase-fetch] timeout ${timeoutMs}ms (socket mort probable) — retry sur connexion neuve: ${method} ${url.split('?')[0]}`);
      return attempt();
    }
    throw err;
  });
}

let lockChain: Promise<unknown> = Promise.resolve();

export function resetAuthLock() {
  lockChain = Promise.resolve();
  console.warn('[supabase-lock] lock chain reset (app resumed from background)');
}

function safeLock<R>(_name: string, acquireTimeoutMs: number, fn: () => Promise<R>): Promise<R> {
  const previous = lockChain;
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  lockChain = next;

  // CRITICAL FIX: cap acquireTimeoutMs to LOCK_MAX_MS regardless of what
  // supabase-js passes (it can pass Infinity, making the timer never fire).
  const effectiveTimeout = Math.min(Math.max(50, acquireTimeoutMs), LOCK_MAX_MS);

  const wait = new Promise<void>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      console.warn(`[supabase-lock] acquire timeout after ${effectiveTimeout}ms (was ${acquireTimeoutMs}ms), forcing release`);
      resolve();
    }, effectiveTimeout);
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
      global: {
        // Borne TOUTES les requêtes du client (auth, PostgREST, storage) —
        // sans cela une connexion morte du pool OkHttp pend indéfiniment.
        fetch: fetchWithTimeout,
      },
    })
  : (null as unknown as SupabaseClientType);

// ─────────────────────────────────────────────────────────────────────────────
// Démarrage / arrêt du auto-refresh selon l'état de l'app (React Native)
//
// Fix renforcé : au retour en premier plan on réinitialise d'abord le verrou
// AVANT de relancer startAutoRefresh(), de sorte que le refresh qui suit ne
// soit jamais bloqué derrière une promesse fantôme de la session précédente.
// ─────────────────────────────────────────────────────────────────────────────
if (isSupabaseConfigured && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    try {
      if (state === 'active') {
        // 1. Libère le verrou AVANT le refresh pour éviter tout blocage
        resetAuthLock();
        // 2. Relance le timer de refresh (déclenche un refresh immédiat si expiré)
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
