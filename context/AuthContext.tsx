import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  supabase,
  isSupabaseConfigured,
  resetAuthLock,
  clearSupabaseStoredAuthCache,
  primeSupabaseSessionReadCache,
} from '@/lib/supabase';
import { User, UserRole, UserPermissions, PermissionsOverride } from '@/constants/types';
import type { AppLanguage } from '@/constants/language';
import { ROLE_LABELS } from '@/constants/roles';
import { debugLog, debugLogOk, debugLogWarn, debugLogError } from '@/lib/debugLog';
import { sendWelcomeEmail, sendAccessRevokedEmail } from '@/lib/email/client';
import { markIntentionalLogout } from '@/lib/authIntent';
import { setPersisterUserId } from '@/lib/queryPersister';
import { deleteCurrentPushToken } from '@/lib/push/deviceRegistration';
import { subscribeSessionExpiry, isSessionExpired, notifySessionRecovered } from '@/lib/sessionExpiry';
import { clearSupabaseRestTokenCache } from '@/lib/supabaseRest';
import i18n from '@/lib/i18n';
import { ROLE_PERMISSIONS, resolvePermissions } from '@/lib/permissions';
import { clearMediaDiskCache, setMediaCacheUserId } from '@/lib/media';
import { clearPlanCache } from '@/lib/planCache';
import { transitionPrivateCacheOwner } from '@/lib/planDisplay';

export { ROLE_PERMISSIONS, resolvePermissions } from '@/lib/permissions';

/**
 * Module-level flag shared with AppContext so it can ignore auth events
 * fired by the demo-user seeding process (sign-in / sign-out per user).
 * Using a plain object so mutations are immediately visible across modules
 * without triggering a React re-render.
 */
export const globalSeedingRef: { current: boolean } = { current: false };
export const registerInProgressRef: { current: boolean } = { current: false };
export const loginInProgressRef: { current: boolean } = { current: false };

const DEMO_SEED_PASS = process.env.EXPO_PUBLIC_DEMO_SEED_PASS || '';
const DEMO_SEED_ENABLED = __DEV__
  && process.env.EXPO_PUBLIC_ENABLE_DEMO_SEED === 'true'
  && Boolean(DEMO_SEED_PASS);

const DEMO_USERS = [
  { email: 'superadmin@buildtrack.fr', name: 'Super Admin BuildTrack', role: 'super_admin', roleLabel: ROLE_LABELS.super_admin, companyId: undefined as string | undefined },
  { email: 'admin@buildtrack.fr',     name: 'System Admin',   role: 'admin',        roleLabel: ROLE_LABELS.admin,          companyId: undefined as string | undefined },
  { email: 'j.dupont@buildtrack.fr',  name: 'Jean Dupont',    role: 'conducteur',   roleLabel: ROLE_LABELS.conducteur,    companyId: undefined as string | undefined },
  { email: 'm.martin@buildtrack.fr',  name: 'Marie Martin',   role: 'chef_equipe',  roleLabel: ROLE_LABELS.chef_equipe,   companyId: undefined as string | undefined },
  { email: 'p.lambert@buildtrack.fr', name: 'Pierre Lambert', role: 'observateur',  roleLabel: ROLE_LABELS.observateur,   companyId: undefined as string | undefined },
  { email: 'st.martin@buildtrack.fr', name: 'Stephen Martin (ST)', role: 'sous_traitant', roleLabel: ROLE_LABELS.sous_traitant, companyId: 'co2' as string | undefined },
];

const DEMO_EMAILS = new Set(DEMO_USERS.map(u => u.email));
const CACHED_PROFILE_KEY = 'buildtrack_cached_profile_v1';
const PROFILE_MUTATION_TIMEOUT_MS = 12_000;

function withProfileMutationTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(i18n.t('auth.profileMutationTimeout', { label }))),
      PROFILE_MUTATION_TIMEOUT_MS,
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isSessionValidationPending: boolean;
  isOfflineSession: boolean;
  /**
   * True once the Supabase refresh token has been terminally rejected by the
   * auth server (revoked/expired). While true, every server write silently
   * falls back to the read-only anon key, so the UI must prompt a fresh login
   * instead of letting the offline queue pile up unsyncable operations.
   */
  sessionExpired: boolean;
  /**
   * Clean re-authentication entry point for the "session expired" prompt:
   * signs out (preserving the offline mutation queue) so AuthGuard routes to
   * the login screen, where a fresh token restores write access and drains the
   * queue.
   */
  reconnectExpiredSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (params: {
    name: string;
    email: string;
    password: string;
  }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  permissions: UserPermissions;
  users: User[];
  usersLoaded: boolean;
  loadAllUsers: () => void;
  seedStatus: 'idle' | 'seeding' | 'done' | 'error';
  updateUserRole: (userId: string, newRole: UserRole) => Promise<void>;
  updateUserCompany: (userId: string, companyId: string | null) => Promise<void>;
  updateUserPreferredLanguage: (language: AppLanguage | null) => Promise<void>;
  updateUserPermissions: (userId: string, override: PermissionsOverride) => Promise<void>;
  deleteUserProfile: (userId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

type InvitationLinkResult = {
  linked?: boolean;
  organization_id?: string;
  role?: string;
  reason?: string;
};

async function linkInvitationForCurrentUser(inviteeName?: string): Promise<InvitationLinkResult | null> {
  try {
    const { data, error } = await (supabase as any).rpc(
      'link_invitation_for_current_user',
      { p_name: inviteeName?.trim() || null }
    );
    if (error) {
      console.warn('[linkInvitationForCurrentUser] RPC error:', error.code, error.message);
      return null;
    }
    return (data ?? null) as InvitationLinkResult | null;
  } catch (err) {
    console.warn('[linkInvitationForCurrentUser] RPC exception:', err);
    return null;
  }
}

async function fetchProfile(userId: string, skipInvitationLink = false): Promise<User | null> {
  try {
    const readAuthority = async (): Promise<Record<string, unknown> | null> => {
      const { data, error } = await (supabase as any).rpc('get_profile_for_current_user');
      if (error) throw error;
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      return (rows[0] as Record<string, unknown> | undefined) ?? null;
    };

    let profileData = await readAuthority();
    if (!profileData) {
      const { error } = await (supabase as any).rpc('ensure_current_user_profile', { p_name: null });
      if (error) throw error;
      profileData = await readAuthority();
    }

    if (!profileData) {
      console.warn('[fetchProfile] No profile projection for authenticated user:', userId);
      return null;
    }

    let orgId: string | undefined = (profileData.organization_id as string) ?? undefined;
    let role: UserRole = (profileData.role as UserRole);
    let roleLabel: string = (profileData.role_label as string) ?? ROLE_LABELS[role] ?? role;
    let companyId: string | undefined = (profileData.company_id as string) ?? undefined;

    if (!orgId && role !== 'super_admin') {
      if (skipInvitationLink) {
        // The caller will link explicitly after login; authority is never
        // reconstructed from the compatibility columns in profiles.
      } else {
        const rpcLink = await linkInvitationForCurrentUser(profileData.name as string);
        if (rpcLink?.linked) {
          const refreshed = await readAuthority();
          if (refreshed) {
            profileData = refreshed;
            orgId = (refreshed.organization_id as string) ?? undefined;
            role = refreshed.role as UserRole;
            roleLabel = (refreshed.role_label as string) ?? ROLE_LABELS[role] ?? role;
            companyId = (refreshed.company_id as string) ?? undefined;
          }
        }
      }
    }

    return {
      id: profileData.id as string,
      name: profileData.name as string,
      role,
      roleLabel,
      email: profileData.email as string,
      organizationId: orgId,
      companyId,
      preferredLanguage: (profileData.preferred_language as AppLanguage | null) ?? undefined,
      permissionsOverride: (
        profileData.permissions_override &&
        typeof profileData.permissions_override === 'object' &&
        Object.keys(profileData.permissions_override).length > 0
      )
        ? profileData.permissions_override as PermissionsOverride
        : undefined,
    };
  } catch (err) {
    console.error('[fetchProfile] Exception inattendue:', err);
    return null;
  }
}

async function seedOneUser(u: typeof DEMO_USERS[number], shouldAbort: () => boolean): Promise<void> {
  if (shouldAbort()) return;
  let authUserId: string | undefined;

  const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
    email: u.email,
    password: DEMO_SEED_PASS,
  });

  if (shouldAbort()) {
    // A real user logged in during this seed — don't sign them out
    return;
  }

  if (!signInErr && signInData?.user?.id) {
    authUserId = signInData.user.id;
  } else {
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email: u.email,
      password: DEMO_SEED_PASS,
    });
    if (signUpErr || !signUpData?.user?.id) return;
    authUserId = signUpData.user.id;

    if (shouldAbort()) return;
    // Guard: only sign out if we still own the session (avoid interrupting real user logins).
    // The second shouldAbort() check is after the await — login() can set abortSeedingRef
    // in that async window, so we re-check to avoid signing out the real user's session.
    {
      const { data: { session: curSess } } = await supabase.auth.getSession();
      if (!shouldAbort() && curSess?.user?.email === u.email) await supabase.auth.signOut();
    }
    if (shouldAbort()) return;

    const { data: reSign, error: reSignErr } = await supabase.auth.signInWithPassword({
      email: u.email,
      password: DEMO_SEED_PASS,
    });

    if (shouldAbort()) return;
    if (reSignErr) {
      return;
    }
    if (reSign?.user?.id) authUserId = reSign.user.id;
  }

  if (!authUserId) return;
  if (shouldAbort()) return;

  const { error: ensureError } = await (supabase as any).rpc(
    'ensure_current_user_profile',
    { p_name: u.name },
  );
  if (ensureError) {
    console.error('[Supabase] seedOneUser profile bootstrap failed:', ensureError.code, ensureError.message);
  }

  if (shouldAbort()) return;
  // Guard: only sign out the demo user — never a real user who signed in concurrently.
  // The second shouldAbort() check is after the await — login() can set abortSeedingRef
  // in that async window, so we re-check to avoid signing out the real user's session.
  {
    const { data: { session: curSess } } = await supabase.auth.getSession();
    if (!shouldAbort() && curSess?.user?.email === u.email) await supabase.auth.signOut();
  }
}

const SEED_DONE_KEY = 'buildtrack_demo_seed_done_v1';

async function seedDemoUsers(shouldAbort: () => boolean): Promise<'done' | 'error'> {
  const SEED_TIMEOUT_MS = 30_000;

  const doSeed = async (): Promise<'done' | 'error'> => {
    try {
      // ── Pre-flight check (AsyncStorage) ──────────────────────────────────────
      // If seeding already completed on this device, skip entirely — no signIn/
      // signOut calls, zero race-condition window on every subsequent cold start.
      const alreadyDone = await AsyncStorage.getItem(SEED_DONE_KEY).catch(() => null);
      if (alreadyDone === 'true') return 'done';

      // Check server-side: if all 6 demo profiles already exist in DB (e.g. seeded
      // via the SQL one-shot migration), skip client-side seeding entirely and
      // persist the flag so future cold starts skip the RPC call too.
      try {
        const { data: seeded } = await (supabase as any).rpc('demo_profiles_seeded');
        if (seeded === true) {
          await AsyncStorage.setItem(SEED_DONE_KEY, 'true').catch(() => {});
          return 'done';
        }
      } catch { /* network error or RPC not deployed yet — fall through to client seeding */ }

      if (shouldAbort()) return 'done';

      let completedAll = true;
      for (const u of DEMO_USERS) {
        if (shouldAbort()) { completedAll = false; break; }
        await seedOneUser(u, shouldAbort).catch(() => {});
      }

      // Only persist the flag if we seeded all users without being interrupted.
      // If a real user logged in mid-seeding (shouldAbort triggered), we'll
      // retry on the next cold start where no user is logged in.
      if (completedAll) {
        await AsyncStorage.setItem(SEED_DONE_KEY, 'true').catch(() => {});
      }
      return 'done';
    } catch {
      return 'error';
    }
  };

  const timeout = new Promise<'done'>((resolve) =>
    setTimeout(() => resolve('done'), SEED_TIMEOUT_MS)
  );

  return Promise.race([doSeed(), timeout]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSessionValidationPending, setIsSessionValidationPending] = useState(isSupabaseConfigured);
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [seedStatus, setSeedStatus] = useState<'idle' | 'seeding' | 'done' | 'error'>('idle');
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const usersLoadedRef = useRef(false);
  const isSeedingRef = useRef(false);
  const abortSeedingRef = useRef(false);
  const isRegisteringRef = useRef(false);
  // Remember the last real owner across the transient `user = null` bootstrap
  // state. A cold restore of the same account must not look like an account
  // switch and erase files that were intentionally kept for offline work.
  const privateCacheOwnerRef = useRef<string | null>(null);

  // Keep the React Query persister namespaced by the active user so that the
  // hydrated cache can never bleed across accounts (User A logs out, User B
  // logs in → User B should never see User A's reserves, even briefly).
  useEffect(() => {
    setPersisterUserId(user?.id ?? null);
  }, [user?.id]);

  // Keep offline media usable across restarts for the same account, but purge
  // every private file when the device changes account or signs out.
  useEffect(() => {
    const nextOwner = user?.id ?? null;
    setMediaCacheUserId(nextOwner);

    // Explicit logout already clears both stores in logout(). Keeping the last
    // non-null owner here also protects a transient session loss: A -> null -> A
    // preserves offline plans, while A -> null -> B still purges A's files.
    const transition = transitionPrivateCacheOwner(privateCacheOwnerRef.current, nextOwner);
    privateCacheOwnerRef.current = transition.rememberedOwnerId;
    if (!transition.shouldClear) return;
    void Promise.allSettled([clearMediaDiskCache(), clearPlanCache()]);
  }, [user?.id]);

  // ── Terminal session-expiry → prompt a clean re-login ──────────────────────
  // When the Supabase refresh token is rejected server-side, lib/sessionExpiry
  // fires this signal. We surface it (SessionExpiredModal) instead of letting
  // every write silently degrade to the anon key (RLS rejects → stuck queue).
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    // A signal may have latched before this listener attached (cold start).
    if (isSessionExpired()) setSessionExpired(true);
    const unsubscribe = subscribeSessionExpiry(() => setSessionExpired(true));
    return unsubscribe;
  }, []);

  // Persist profile to AsyncStorage for offline session restoration
  const cacheProfile = useCallback((profile: User) => {
    AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile)).catch(() => {});
  }, []);
  const clearCachedProfile = useCallback(() => {
    AsyncStorage.removeItem(CACHED_PROFILE_KEY).catch(() => {});
  }, []);
  const readCachedProfile = useCallback(async (): Promise<User | null> => {
    try {
      const raw = await AsyncStorage.getItem(CACHED_PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);
  // loginInProgressRef is now a module-level export (shared with AppContext)
  // so that onAuthStateChange in both AuthContext and AppContext skip their
  // SIGNED_IN handlers while login() manages the session directly.

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const offlineUser: User = {
        id: 'offline-admin',
        name: 'System Admin',
        role: 'admin',
        roleLabel: ROLE_LABELS.admin,
        email: 'admin@buildtrack.fr',
        organizationId: 'demo-org',
      };
      setUser(offlineUser);
      setUsers(DEMO_USERS.map((u, i) => ({
        id: `demo-${i}`,
        name: u.name,
        role: u.role as UserRole,
        roleLabel: u.roleLabel,
        email: u.email,
        organizationId: u.role === 'super_admin' ? undefined : 'demo-org',
        companyId: u.companyId,
      })));
      setIsLoading(false);
      setIsSessionValidationPending(false);
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Instant-restore pattern (cold-start optimization)
    // ─────────────────────────────────────────────────────────────────────────
    // 1. Lire IMMÉDIATEMENT le profil en cache (AsyncStorage, ~50ms) et libérer
    //    l'UI tout de suite si on en trouve un. L'utilisateur voit l'app sans
    //    attendre le réseau (DNS froid + TLS handshake + refresh token Supabase
    //    peut prendre 3-10s à la 1ère ouverture du jour).
    // 2. En arrière-plan, valider la session via Supabase et mettre à jour le
    //    profil silencieusement si différent — ou signOut si session invalide.
    // ─────────────────────────────────────────────────────────────────────────

    // Safety valve: if auth init hangs for any reason, unblock the UI after 3s
    // (réduit de 10s à 3s grâce au cached profile en fallback immédiat)
    const AUTH_TIMEOUT_MS = 3_000;
    const SESSION_VALIDATION_MAX_WAIT_MS = 8_000;
    let loadingResolved = false;
    const resolveLoading = () => {
      if (!loadingResolved) {
        loadingResolved = true;
        setIsLoading(false);
      }
    };
    const safetyTimer = setTimeout(resolveLoading, AUTH_TIMEOUT_MS);
    const validationTimer = setTimeout(() => {
      setIsSessionValidationPending(false);
      resolveLoading();
    }, SESSION_VALIDATION_MAX_WAIT_MS);

    // Étape 1 — Cached profile en priorité absolue
    debugLog('[AuthContext] readCachedProfile() → instant-restore');
    // Keep auth loading active after restoring the cached profile. This
    // prevents screens from briefly rendering stale persisted data before the
    // first Supabase refresh can show the loading screen.
    setIsSessionValidationPending(true);

    readCachedProfile().then((cached) => {
      if (cached) {
        debugLogOk(`[AuthContext] Profil restauré depuis cache (instant-restore) → ${cached.email}`);
        setUser(cached);
        setIsOfflineSession(true); // sera repassé à false si getSession() valide
        // Libère l'UI immédiatement : l'app affiche les données en cache
        // pendant que getSession()/fetchProfile() valident en arrière-plan.
        // Sans cela, chaque démarrage à froid restait sur l'écran de
        // chargement jusqu'au retour réseau (ou 3 s de garde-fou).
        resolveLoading();
      }
    }).catch(() => {});

    // Étape 2 — Validation Supabase en arrière-plan (n'attend PAS le résultat
    // pour libérer l'UI ; setUser silencieux si profil change)
    debugLog('[AuthContext] getSession() → validation arrière-plan');
    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
      try {
        if (session?.user) {
          debugLogOk(`[AuthContext] Session trouvée → user=${session.user.email}`);
          const profile = await fetchProfile(session.user.id);
          if (profile) {
            debugLogOk(`[AuthContext] fetchProfile() → OK (role=${profile.role}, org=${profile.organizationId ?? 'aucune'})`);
            setUser(profile);
            setIsOfflineSession(false);
            cacheProfile(profile);
          } else {
            // fetchProfile null — likely network error → garder le cached profile
            // (déjà setUser via instant-restore) en mode offline
            const cached = await readCachedProfile();
            if (cached) {
              debugLogWarn('[AuthContext] fetchProfile() → null (hors ligne?) → cached profile conservé');
              setUser(cached);
              setIsOfflineSession(true);
            } else {
              debugLogError('[AuthContext] fetchProfile() → null + pas de cache → signOut()');
              supabase.auth.signOut().catch(() => {});
              setUser(null);
            }
          }
        } else {
          // Pas de session Supabase → si on avait restauré un cached profile,
          // le garder en mode offline (pas de signOut intempestif)
          const cached = await readCachedProfile();
          if (cached) {
            debugLogWarn('[AuthContext] getSession() → null → cached profile conservé (hors ligne)');
            setUser(cached);
            setIsOfflineSession(true);
          } else {
            debugLogWarn('[AuthContext] getSession() → pas de session active');
            setUser(null);
          }
        }
      } catch (err: any) {
        debugLogError(`[AuthContext] getSession().then exception: ${err?.message ?? err}`);
      } finally {
        setIsSessionValidationPending(false);
        clearTimeout(safetyTimer);
        clearTimeout(validationTimer);
        resolveLoading();
        debugLog('[AuthContext] isLoading → false (background sync done)');
      }
    }).catch(async (err: any) => {
      debugLogError(`[AuthContext] getSession() rejeté: ${err?.message ?? err}`);
      // getSession() rejeté (réseau) — le cached profile est déjà en place via
      // l'instant-restore, on libère juste isLoading
      setIsSessionValidationPending(false);
      clearTimeout(safetyTimer);
      clearTimeout(validationTimer);
      resolveLoading();
    });

    let authListenerDisposed = false;
    let authEventGeneration = 0;
    let activeProfileRefresh: Promise<void> | null = null;
    let pendingProfileRefresh: { event: any; session: any; generation: number } | null = null;
    const deferredAuthTimers = new Set<ReturnType<typeof setTimeout>>();

    const isCurrentAuthEvent = (generation: number) => (
      !authListenerDisposed && generation === authEventGeneration
    );

    const deferAuthWork = (work: () => void | Promise<void>) => {
      const timer = setTimeout(() => {
        deferredAuthTimers.delete(timer);
        if (authListenerDisposed) return;
        void Promise.resolve(work()).catch((err: any) => {
          debugLogError(`[AuthContext] travail auth differe rejete: ${err?.message ?? err}`);
        });
      }, 0);
      deferredAuthTimers.add(timer);
    };

    const processAuthStateChange = async (_event: any, session: any, generation: number): Promise<void> => {
      if (!isCurrentAuthEvent(generation)) return;
      if (isSeedingRef.current) { debugLogWarn('[AuthContext] onAuthStateChange ignoré (seeding en cours)'); return; }
      if (isRegisteringRef.current) { debugLogWarn('[AuthContext] onAuthStateChange ignoré (register en cours)'); return; }
      // login() manages setUser() directly and calls fetchProfile() itself.
      // Skipping here avoids a concurrent duplicate fetchProfile() and the
      // fire-and-forget signOut() that could clear queries after login succeeds.
      if (loginInProgressRef.current) { debugLogWarn('[AuthContext] onAuthStateChange ignoré (login en cours)'); return; }

      if (session?.user) {
        if (activeProfileRefresh) {
          // Coalesce rapid SIGNED_IN / TOKEN_REFRESHED events. Once the active
          // read finishes, only the newest session is allowed to update state.
          pendingProfileRefresh = { event: _event, session, generation };
          return;
        }

        activeProfileRefresh = (async () => {
          debugLog(`[AuthContext] onAuthStateChange → fetchProfile() pour ${session.user.email}`);
          const profile = await fetchProfile(session.user.id);
          if (!isCurrentAuthEvent(generation)) return;
          if (profile) {
            debugLogOk(`[AuthContext] onAuthStateChange → fetchProfile OK (role=${profile.role})`);
            setUser(profile);
            setIsOfflineSession(false);
            cacheProfile(profile);
          } else {
            // fetchProfile null — likely offline, use cached profile
            const cached = await readCachedProfile();
            if (!isCurrentAuthEvent(generation)) return;
            if (cached) {
              debugLogWarn('[AuthContext] onAuthStateChange → fetchProfile null (hors ligne?) → profil en cache restauré');
              setUser(cached);
              setIsOfflineSession(true);
            } else {
              debugLogError('[AuthContext] onAuthStateChange → fetchProfile null → signOut()');
              supabase.auth.signOut().catch(() => {});
              if (isCurrentAuthEvent(generation)) setUser(null);
            }
          }
        })().finally(() => {
          activeProfileRefresh = null;
          const pending = pendingProfileRefresh;
          pendingProfileRefresh = null;
          if (pending && isCurrentAuthEvent(pending.generation)) {
            deferAuthWork(() => processAuthStateChange(
              pending.event,
              pending.session,
              pending.generation,
            ));
          }
        });

        await activeProfileRefresh;
        return;
      }

      pendingProfileRefresh = null;
      // Session null — likely TOKEN_REFRESH_FAILED while offline
      // Use cached profile instead of disconnecting the user
      const cached = await readCachedProfile();
      if (!isCurrentAuthEvent(generation)) return;
      if (cached) {
        debugLogWarn('[AuthContext] onAuthStateChange → session null (hors ligne?) → profil en cache restauré');
        setUser(cached);
        setIsOfflineSession(true);
      } else {
        debugLogWarn('[AuthContext] onAuthStateChange → session null → user = null');
        setUser(null);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      // Never reuse a REST bearer token across logout/login, token refresh, or
      // account-switch events.
      clearSupabaseRestTokenCache();
      clearSupabaseStoredAuthCache();
      primeSupabaseSessionReadCache(session ?? null);
      debugLog(`[AuthContext] onAuthStateChange → event=${_event} session=${session ? session.user?.email : 'null'}`);
      const generation = ++authEventGeneration;
      // Supabase awaits auth callbacks while holding its session lock. Defer
      // profile reads so the callback returns before any Supabase request.
      deferAuthWork(() => processAuthStateChange(_event, session, generation));
    });

    return () => {
      authListenerDisposed = true;
      authEventGeneration += 1;
      pendingProfileRefresh = null;
      deferredAuthTimers.forEach(timer => clearTimeout(timer));
      deferredAuthTimers.clear();
      subscription.unsubscribe();
      clearTimeout(safetyTimer);
      clearTimeout(validationTimer);
      loadingResolved = true; // prevent stale setState after unmount
    };
  }, []);

  const loadAllUsers = useCallback(() => {
    if (!user || !isSupabaseConfigured) return;
    if (usersLoadedRef.current) return;
    usersLoadedRef.current = true;

    const mapProfile = (p: any): User => ({
      id: p.id,
      name: p.name,
      role: p.role as UserRole,
      roleLabel: p.role_label ?? ROLE_LABELS[p.role as UserRole] ?? p.role,
      email: p.email,
      organizationId: p.organization_id ?? undefined,
      companyId: p.company_id ?? undefined,
      preferredLanguage: p.preferred_language ?? undefined,
      permissionsOverride: (p.permissions_override && Object.keys(p.permissions_override).length > 0)
        ? p.permissions_override as PermissionsOverride
        : undefined,
    });

    void (async () => {
      try {
        const { data, error } = await (supabase as any).rpc('get_org_users');
        if (error) throw error;
        setUsers((Array.isArray(data) ? data : []).map(mapProfile));
        setUsersLoaded(true);
      } catch (error: any) {
        console.warn('[AuthContext] get_org_users RPC failed:', error?.code, error?.message);
        usersLoadedRef.current = false;
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) {
      usersLoadedRef.current = false;
      setUsersLoaded(false);
      return;
    }
    const timer = setTimeout(loadAllUsers, 3000);
    return () => clearTimeout(timer);
  }, [user?.id]);

  // Synchronisation temps réel : rechargement automatique quand un profil change
  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    const channel = (supabase as any)
      .channel('realtime-profiles')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        (_payload: any) => {
          usersLoadedRef.current = false;
          loadAllUsers();
        }
      )
      .subscribe();
    return () => {
      (supabase as any).removeChannel(channel);
    };
  }, [user?.id, loadAllUsers]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!DEMO_SEED_ENABLED) {
      setSeedStatus('done');
      return;
    }
    if (!isLoading && !user && seedStatus === 'idle') {
      // Synchronous guard: set 'seeding' immediately to prevent double-entry
      // if this effect fires again before the AsyncStorage read resolves.
      setSeedStatus('seeding');

      // Fast-path: if seeding already completed on this device, mark done
      // immediately without touching isSeedingRef/globalSeedingRef at all —
      // zero signIn/signOut calls, zero race-condition window.
      AsyncStorage.getItem(SEED_DONE_KEY).catch(() => null).then(alreadyDone => {
        if (alreadyDone === 'true') {
          setSeedStatus('done');
          return;
        }
        isSeedingRef.current = true;
        globalSeedingRef.current = true;
        abortSeedingRef.current = false;
        seedDemoUsers(() => abortSeedingRef.current).then(result => {
          isSeedingRef.current = false;
          globalSeedingRef.current = false;
          setSeedStatus(result);
        });
      });
    }
  }, [isLoading, user, seedStatus]);

  async function register({
    name,
    email,
    password,
  }: {
    name: string;
    email: string;
    password: string;
  }): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured) {
      return { success: false, error: i18n.t('auth.registerRequiresServer') };
    }

    abortSeedingRef.current = true;
    isRegisteringRef.current = true;
    // Block AppContext's SIGNED_IN handler until profile + org are ready in DB.
    // Cleared (and setSession re-emitted) just before returning { success: true }.
    registerInProgressRef.current = true;

    const cleanup = () => {
      registerInProgressRef.current = false;
      isRegisteringRef.current = false;
    };

    // Safety timeout: if any Supabase call hangs indefinitely, unblock the UI.
    // Invitation mode can involve multiple round-trips (signUp → profile insert →
    // signIn → RPC → fetchProfile), so we give 90 s on slow mobile connections.
    const REGISTER_TIMEOUT_MS = 90_000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
      timeoutId = setTimeout(async () => {
        cleanup();
        // If the user is already authenticated at the timeout boundary, the auth
        // account was created successfully (the slow part was profile linking or
        // network latency). Resolve with success so no false error is shown —
        // AppContext will handle the state via auth events.
        // Retry up to 4 times with 2 s gaps to handle the race condition where the
        // session is being established just as the timeout fires (common on 4G).
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData?.session?.user?.id) {
              resolve({ success: true });
              return;
            }
          } catch { /* ignore */ }
          if (attempt < 3) {
            await new Promise<void>(r => setTimeout(r, 2_000));
          }
        }
        resolve({ success: false, error: i18n.t('auth.registerTimeout') });
      }, REGISTER_TIMEOUT_MS);
    });

    const doRegister = async (): Promise<{ success: boolean; error?: string }> => {
      try {
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
        });

        let userId: string;
        let signUpSession: (typeof signUpData)['session'];

        if (signUpErr || !signUpData?.user?.id) {
          const isAlreadyRegistered =
            signUpErr?.message?.toLowerCase().includes('already registered') ||
            signUpErr?.message?.toLowerCase().includes('already been registered') ||
            signUpErr?.message?.toLowerCase().includes('user_already_exists');

          if (!isAlreadyRegistered) {
            cleanup();
            return { success: false, error: signUpErr?.message ?? i18n.t('auth.createAccountFailed') };
          }

          // Check if a real profile exists for this email in public.profiles.
          // It's possible that a previous account was deleted from public.profiles
          // but NOT from auth.users (Supabase Authentication), leaving a dangling
          // auth record that blocks re-registration.
          const emailLower = email.trim().toLowerCase();
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', emailLower)
            .maybeSingle();

          if (existingProfile) {
            // A real, active profile exists → genuine duplicate.
            cleanup();
            return { success: false, error: i18n.t('auth.accountAlreadyExists') };
          }

          // No profile found → dangling auth account (deleted from profiles but not from
          // auth.users). Try to reclaim it by signing in with the provided password.
          const { data: reclaimData, error: reclaimErr } = await supabase.auth.signInWithPassword({
            email: emailLower,
            password,
          });

          if (reclaimErr || !reclaimData?.user?.id) {
            // Wrong password or unconfirmed email → can't reclaim automatically.
            cleanup();
            return {
              success: false,
              error: i18n.t('auth.disabledAccountRecovery'),
            };
          }

          // Reclaim succeeded — reuse the existing auth account with a fresh profile & org.
          userId = reclaimData.user!.id;
          signUpSession = reclaimData.session;
        } else {
          userId = signUpData.user.id;
          // signUp may return a session immediately (email confirmation disabled)
          // or null (email confirmation enabled). Use it directly to avoid a
          // redundant signIn call when possible.
          signUpSession = signUpData.session;
        }

        // ── Étape 1 : garantir une session active AVANT toute écriture DB ───
        // signUp() peut retourner { session: null } si "Confirm email" est
        // activé sur Supabase, ou si la propagation du JWT côté client est
        // ralentie (réseau lent). Sans session, auth.uid() est NULL et
        // toute INSERT sur profiles est bloquée par la policy RLS
        // "Profil créable par son propriétaire" (auth.uid() = id).
        // → On force un signInWithPassword si signUp ne nous a rien donné,
        //   pour être SÛR d'avoir une session avant de toucher à profiles.
        let signInSession = signUpSession;
        let signInUserId = signUpSession ? userId : undefined;

        if (!signUpSession) {
          const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
          });

          if (signInErr || !signInData?.user?.id) {
            cleanup();
            if (signInErr?.message?.toLowerCase().includes('email not confirmed') ||
                signInErr?.message?.toLowerCase().includes('email_not_confirmed')) {
              return { success: false, error: i18n.t('auth.confirmationEmailSent') };
            }
            return { success: false, error: i18n.t('auth.accountCreatedLogin') };
          }
          signInSession = signInData.session;
          signInUserId = signInData.user.id;
        }

        if (!signInUserId) {
          cleanup();
          return { success: false, error: i18n.t('auth.accountCreatedContinue') };
        }

        // ── Étape 2 : créer le profil maintenant qu'on a une session ────────
        // Tentative d'INSERT côté client (chemin rapide). Si elle échoue
        // pour une raison quelconque (RLS, timing, conflit), pas grave :
        // l'étape 3 (RPC link_invitation_for_current_user) fait un UPSERT
        // côté serveur en SECURITY DEFINER — le profil sera créé là.
        const { error: ensureProfileError } = await (supabase as any).rpc(
          'ensure_current_user_profile',
          { p_name: name.trim() },
        );
        if (ensureProfileError) {
          cleanup();
          return { success: false, error: ensureProfileError.message };
        }

        // Link the invitation to the newly created profile.
        // Step 1 — Try the SECURITY DEFINER RPC (bypasses RLS, preferred path).
        // Step 2 — If RPC fails or isn't deployed, fall back to direct client-side
        //          queries using the RLS policies that allow a user to read/accept
        //          invitations sent to their own email.
        const { data: linkData, error: linkError } = await (supabase as any).rpc(
          'link_invitation_for_current_user',
          { p_name: name.trim() },
        );
        if (linkError || !(linkData as InvitationLinkResult | null)?.linked) {
          await supabase.auth.signOut().catch(() => {});
          cleanup();
          return { success: false, error: linkError?.message ?? i18n.t('auth.noInvitationMessage') };
        }

        const profile = await fetchProfile(signInUserId);
        if (profile) {
          setUser(profile);
          isSeedingRef.current = false;
          globalSeedingRef.current = false;
          setSeedStatus('done');
          cleanup();
          // Unblock AppContext's Guard 4, then re-emit SIGNED_IN so loadAll() fires
          // now that profile + org are committed to DB.
          if (signInSession) {
            // Fire-and-forget: we just need to re-emit the SIGNED_IN event so
            // AppContext's loadAll() picks up the newly committed data.
            // Not awaited to avoid blocking the return of register().
            supabase.auth.setSession({
              access_token: signInSession.access_token,
              refresh_token: signInSession.refresh_token,
            }).catch(() => {});
          }
          let orgName: string | undefined;
          if (profile.organizationId) {
            try {
              const { data: orgData } = await (supabase as any)
                .from('organizations')
                .select('name')
                .eq('id', profile.organizationId)
                .single();
              if (orgData?.name) orgName = orgData.name;
            } catch {}
          }
          sendWelcomeEmail({
            email: email.trim().toLowerCase(),
            name: name.trim(),
            organizationName: orgName,
            language: profile.preferredLanguage,
          }).catch(() => {});
          return { success: true };
        }

        cleanup();
        return { success: false, error: i18n.t('auth.accountCreatedContinue') };
      } catch (err: any) {
        cleanup();
        console.warn('[register] Exception:', err?.message ?? err);
        return { success: false, error: i18n.t('auth.networkCheckConnection') };
      }
    };

    const result = await Promise.race([doRegister(), timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    return result;
  }

  async function login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    // Abort any in-progress seeding so its signOut calls don't kick us out
    abortSeedingRef.current = true;
    // Clear the seeding flag NOW, before signInWithPassword(), so that AppContext's
    // SIGNED_IN handler (Guard 2: globalSeedingRef.current) does not block the
    // loadAll() triggered by our sign-in. The seeding's own email-guard already
    // prevents it from signing out a real-user session.
    isSeedingRef.current = false;
    globalSeedingRef.current = false;
    // Raise the login guard so onAuthStateChange skips its fetchProfile() calls
    // while we are managing the session ourselves. This eliminates:
    //   • The duplicate fetchProfile() that signInWithPassword's SIGNED_IN event
    //     would trigger concurrently with our own direct call below.
    //   • The fire-and-forget signOut() that could clear React Query's cache
    //     after login() already returned { success: true }.
    loginInProgressRef.current = true;

    // Safety timeout: if signInWithPassword or fetchProfile hangs, unblock after 15s
    const LOGIN_TIMEOUT_MS = 15_000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
      timeoutId = setTimeout(async () => {
        loginInProgressRef.current = false;
        // Check if session was actually established despite the timeout
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            const profile = await fetchProfile(session.user.id, true);
            if (profile) {
              setUser(profile);
              notifySessionRecovered();
              setSessionExpired(false);
              resolve({ success: true });
              return;
            }
          }
        } catch {}
        resolve({ success: false, error: i18n.t('auth.loginTimeout') });
      }, LOGIN_TIMEOUT_MS);
    });

    if (!isSupabaseConfigured) {
      const demoUser = DEMO_USERS.find(u => u.email === email);
      const match = demoUser && DEMO_SEED_PASS && DEMO_SEED_PASS === password ? demoUser : null;
      if (!match) {
        loginInProgressRef.current = false;
        return { success: false, error: i18n.t('auth.emailOrPasswordIncorrect') };
      }
      setUser({
        id: `demo-${DEMO_USERS.indexOf(match)}`,
        name: match.name,
        role: match.role as UserRole,
        roleLabel: match.roleLabel,
        email: match.email,
        organizationId: match.role === 'super_admin' ? undefined : 'demo-org',
        companyId: match.companyId,
      });
      loginInProgressRef.current = false;
      if (timeoutId) clearTimeout(timeoutId);
      return { success: true };
    }
    try {
      // signInWithPassword establishes the session internally. We do NOT call
      // setSession() afterwards — that would fire a redundant SIGNED_IN event
      // which triggers another fetchProfile() + profiles query in every listener,
      // adding 3–4 unnecessary HTTP round-trips and blocking login() longer.
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        abortSeedingRef.current = false;
        loginInProgressRef.current = false;
        if (timeoutId) clearTimeout(timeoutId);
        if (error.message?.toLowerCase().includes('email not confirmed') ||
            error.message?.toLowerCase().includes('email_not_confirmed')) {
          return {
            success: false,
            error: i18n.t('auth.emailNotConfirmedSupabase'),
          };
        }
        return { success: false, error: i18n.t('auth.emailOrPasswordIncorrect') };
      }

      const authUser = data?.user;
      const authSession = data?.session;

      // When Supabase has email confirmation enabled it can return { user, session: null, error: null }.
      // There is no valid JWT in this state — RLS would block every DB read.
      if (authUser && !authSession) {
        loginInProgressRef.current = false;
        if (timeoutId) clearTimeout(timeoutId);
        return {
          success: false,
          error: i18n.t('auth.emailNotConfirmedSupabase'),
        };
      }

      if (authUser && authSession) {
        // Let login own the invitation-link step after the authority read.
        let profile = await fetchProfile(authUser.id, true);

        if (!profile) {
          // One retry after a short pause — the seeding's signOut may have fired
          // in the tiny window before signInWithPassword completed.
          console.warn('[login] fetchProfile returned null — 1 retry...');
          await new Promise(r => setTimeout(r, 400));
          profile = await fetchProfile(authUser.id, true);
        }

        if (profile && !profile.organizationId && profile.role !== 'super_admin') {
          console.warn('[login] profil sans organisation - tentative de liaison invitation...');
          const linked = await linkInvitationForCurrentUser(profile.name || authUser.email?.split('@')[0] || '');
          if (linked?.linked) {
            profile = await fetchProfile(authUser.id, true);
          }
        }

        // Recovery : si le profil est toujours manquant et que l'utilisateur
        // a une invitation en attente (cas d'une inscription précédente où
        // l'INSERT profiles avait échoué silencieusement à cause de la RLS),
        // on appelle le RPC qui fait un UPSERT du profil + lie l'invitation.
        if (!profile) {
          console.warn('[login] profil manquant — tentative de récupération via link_invitation_for_current_user...');
          try {
            const { data: rpcData, error: rpcErr } = await (supabase as any).rpc(
              'link_invitation_for_current_user',
              { p_name: authUser.email?.split('@')[0] ?? '' }
            );
            if (!rpcErr && (rpcData as any)?.linked) {
              console.log('[login] profil créé via RPC ✓ — re-fetch...');
              profile = await fetchProfile(authUser.id, true);
            } else if (rpcErr) {
              console.warn('[login] RPC recovery failed:', rpcErr.code, rpcErr.message);
            }
          } catch (rpcEx) {
            console.warn('[login] RPC recovery exception:', rpcEx);
          }
        }

        if (profile) {
          setUser(profile);
          setIsOfflineSession(false);
          cacheProfile(profile);
          setSeedStatus('done');
          notifySessionRecovered();
          setSessionExpired(false);
          loginInProgressRef.current = false;
          if (timeoutId) clearTimeout(timeoutId);
          return { success: true };
        }
      }

      // Profile missing — sign out cleanly
      loginInProgressRef.current = false;
      if (timeoutId) clearTimeout(timeoutId);
      await supabase.auth.signOut();
      return {
        success: false,
        error: i18n.t('auth.missingProfile'),
      };
    } catch {
      abortSeedingRef.current = false;
      loginInProgressRef.current = false;
      if (timeoutId) clearTimeout(timeoutId);
      return { success: false, error: i18n.t('auth.loginNetworkFailed') };
    }
  }

  async function logout() {
    // Mark the upcoming SIGNED_OUT event as intentional so AppContext knows
    // to wipe the offline cache. Without this flag, AppContext can't tell an
    // intentional logout apart from a transient auto-signout fired by
    // supabase-js when a token refresh fails — and it would wipe data the
    // user still wants to see offline.
    markIntentionalLogout();
    clearSupabaseRestTokenCache();
    clearSupabaseStoredAuthCache();
    const currentUserId = user?.id;
    try {
      await deleteCurrentPushToken(currentUserId);
      if (isSupabaseConfigured) await supabase.auth.signOut();
    } catch {
      // ignore
    }
    setUser(null);
    setIsOfflineSession(false);
    clearCachedProfile();
    await Promise.allSettled([clearMediaDiskCache(), clearPlanCache()]);
  }

  // Clean re-authentication after a terminal session expiry. We funnel through
  // the proven logout() path (which clears the cached profile so the auth-state
  // listener can't re-restore the dead session) → AuthGuard routes to /login.
  // The offline mutation queue is NOT cleared by logout(), so unsynced reserves
  // survive and sync once the fresh token lands.
  async function reconnectExpiredSession(): Promise<void> {
    notifySessionRecovered();
    setSessionExpired(false);
    await logout();
  }

  async function updateUserRole(userId: string, newRole: UserRole): Promise<void> {
    const newLabel = ROLE_LABELS[newRole];
    if (isSupabaseConfigured) {
      resetAuthLock();
      const target = users.find(item => item.id === userId);
      const { data, error } = await withProfileMutationTimeout<any>((supabase as any).rpc(
        'admin_update_membership',
        {
          p_user_id: userId,
          p_role: newRole,
          p_company_id: target?.companyId ?? null,
          p_permissions_override: target?.permissionsOverride ?? {},
        },
      ), i18n.t('auth.mutationLabels.role'));
      if (error || !data?.user_id) {
        throw new Error(error?.message ?? i18n.t('auth.roleUpdateFailed'));
      }
    }
    setUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, role: newRole, roleLabel: newLabel } : u
    ));
  }

  async function updateUserCompany(userId: string, companyId: string | null): Promise<void> {
    if (isSupabaseConfigured) {
      resetAuthLock();
      const target = users.find(item => item.id === userId);
      const { data, error } = await withProfileMutationTimeout<any>((supabase as any).rpc(
        'admin_update_membership',
        {
          p_user_id: userId,
          p_role: target?.role ?? 'observateur',
          p_company_id: companyId,
          p_permissions_override: target?.permissionsOverride ?? {},
        },
      ), i18n.t('auth.mutationLabels.company'));
      if (error || !data?.user_id) {
        throw new Error(error?.message ?? i18n.t('auth.companyUpdateFailed'));
      }
    }
    setUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, companyId: companyId ?? undefined } : u
    ));
  }

  async function updateUserPreferredLanguage(language: AppLanguage | null): Promise<void> {
    if (!user?.id) return;
    if (isSupabaseConfigured) {
      resetAuthLock();
      const { data, error } = await withProfileMutationTimeout<any>((supabase as any).from('profiles').update({
        preferred_language: language,
      }).eq('id', user.id).select('id, preferred_language').maybeSingle(), i18n.t('auth.mutationLabels.language'));
      if (error || !data?.id) {
        throw new Error(error?.message ?? i18n.t('auth.languageSyncFailed'));
      }
    }
    setUser(prev => prev ? { ...prev, preferredLanguage: language ?? undefined } : prev);
    setUsers(prev => prev.map(u =>
      u.id === user.id ? { ...u, preferredLanguage: language ?? undefined } : u
    ));
  }

  async function deleteUserProfile(userId: string): Promise<void> {
    const targetUser = users.find(u => u.id === userId);

    if (isSupabaseConfigured) {
      const { data, error } = await (supabase as any).rpc('admin_revoke_membership', {
        p_user_id: userId,
      });
      if (error || !data?.user_id) {
        Alert.alert(i18n.t('common.error'), i18n.t('syncAlerts.profileDeleteFailed'));
        return;
      }
    }

    // Send revocation email (fire-and-forget)
    if (targetUser?.email && targetUser?.name) {
      try {
        let orgName = i18n.t('auth.defaultOrganizationName');
        if (targetUser.organizationId && isSupabaseConfigured) {
          const { data: org } = await (supabase as any)
            .from('organizations')
            .select('name')
            .eq('id', targetUser.organizationId)
            .single();
          if (org?.name) orgName = org.name;
        }
        sendAccessRevokedEmail({
          email: targetUser.email,
          name: targetUser.name,
          organizationName: orgName,
          language: targetUser.preferredLanguage,
        });
      } catch {}
    }

    setUsers(prev => prev.filter(u => u.id !== userId));
  }

  async function updateUserPermissions(userId: string, override: PermissionsOverride): Promise<void> {
    if (isSupabaseConfigured) {
      resetAuthLock();
      const target = users.find(item => item.id === userId);
      const { data, error } = await withProfileMutationTimeout<any>((supabase as any).rpc(
        'admin_update_membership',
        {
          p_user_id: userId,
          p_role: target?.role ?? 'observateur',
          p_company_id: target?.companyId ?? null,
          p_permissions_override: override,
        },
      ), i18n.t('auth.mutationLabels.permissions'));
      if (error || !data?.user_id) {
        throw new Error(error?.message ?? i18n.t('auth.permissionsUpdateFailed'));
      }
    }
    setUsers(prev => prev.map(u =>
      u.id === userId
        ? { ...u, permissionsOverride: Object.keys(override).length > 0 ? override : undefined }
        : u
    ));
    if (user?.id === userId) {
      setUser(prev => prev ? { ...prev, permissionsOverride: Object.keys(override).length > 0 ? override : undefined } : prev);
    }
  }

  const permissions = user
    ? resolvePermissions(user.role, user.permissionsOverride)
    : ROLE_PERMISSIONS.observateur;

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      isSessionValidationPending,
      isOfflineSession,
      sessionExpired,
      reconnectExpiredSession,
      login,
      register,
      logout,
      permissions,
      users,
      usersLoaded,
      loadAllUsers,
      seedStatus,
      updateUserRole,
      updateUserCompany,
      updateUserPreferredLanguage,
      updateUserPermissions,
      deleteUserProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
