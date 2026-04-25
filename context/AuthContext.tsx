import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { User, UserRole, UserPermissions, PermissionsOverride } from '@/constants/types';
import { ROLE_LABELS } from '@/constants/roles';
import { debugLog, debugLogOk, debugLogWarn, debugLogError } from '@/lib/debugLog';
import { sendWelcomeEmail, sendInvitationAcceptedEmail, sendAccessRevokedEmail } from '@/lib/email/client';

/**
 * Module-level flag shared with AppContext so it can ignore auth events
 * fired by the demo-user seeding process (sign-in / sign-out per user).
 * Using a plain object so mutations are immediately visible across modules
 * without triggering a React re-render.
 */
export const globalSeedingRef: { current: boolean } = { current: false };
export const registerInProgressRef: { current: boolean } = { current: false };
export const loginInProgressRef: { current: boolean } = { current: false };

export const ROLE_PERMISSIONS: Record<UserRole, UserPermissions> = {
  super_admin:    { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: true,  canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: true  },
  admin:          { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: true,  canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: true  },
  conducteur:     { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: false, canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: true  },
  chef_equipe:    { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: false, canExport: false, canManageTeams: false, canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: false },
  observateur:    { canCreate: false, canEdit: false, canEditOwn: false, canDelete: false, canExport: true,  canManageTeams: false, canViewTeams: true,  canUpdateAttendance: false, canMovePins: false, canEditChantier: false },
  sous_traitant:  { canCreate: false, canEdit: false, canEditOwn: true,  canDelete: false, canExport: false, canManageTeams: false, canViewTeams: false, canUpdateAttendance: false, canMovePins: false, canEditChantier: false },
};

export function resolvePermissions(role: UserRole, override?: PermissionsOverride): UserPermissions {
  // Fallback to observateur if role is unknown/undefined to ensure all keys are present
  const base: UserPermissions = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.observateur;
  // Always create a fresh object (never return ROLE_PERMISSIONS reference directly)
  // so that Hermes hidden-class optimisation always sees the same property shape.
  // canMovePins is explicitly set first so it is always an own property of the result.
  const canMovePinsDefault = role === 'super_admin' || role === 'admin' || role === 'conducteur' || role === 'chef_equipe';
  const merged: UserPermissions = {
    canCreate:            base.canCreate            ?? false,
    canEdit:              base.canEdit              ?? false,
    canEditOwn:           base.canEditOwn           ?? false,
    canDelete:            base.canDelete            ?? false,
    canExport:            base.canExport            ?? false,
    canManageTeams:       base.canManageTeams       ?? false,
    canViewTeams:         base.canViewTeams         ?? false,
    canUpdateAttendance:  base.canUpdateAttendance  ?? false,
    canMovePins:          base.canMovePins          ?? canMovePinsDefault,
    canEditChantier:      base.canEditChantier      ?? false,
  };
  // Super admin is never overridable
  if (role === 'super_admin') return merged;
  // Apply per-user overrides
  if (override) {
    for (const k of Object.keys(override) as (keyof PermissionsOverride)[]) {
      if (override[k] !== undefined) (merged as any)[k] = override[k];
    }
  }
  return merged;
}

const DEMO_SEED_PASS = process.env.EXPO_PUBLIC_DEMO_SEED_PASS || '';

const DEMO_USERS = [
  { email: 'superadmin@buildtrack.fr', name: 'Super Admin BuildTrack', role: 'super_admin', roleLabel: 'Super Administrateur', companyId: undefined as string | undefined },
  { email: 'admin@buildtrack.fr',     name: 'Admin Système',  role: 'admin',        roleLabel: 'Administrateur',          companyId: undefined as string | undefined },
  { email: 'j.dupont@buildtrack.fr',  name: 'Jean Dupont',    role: 'conducteur',   roleLabel: 'Conducteur de travaux',    companyId: undefined as string | undefined },
  { email: 'm.martin@buildtrack.fr',  name: 'Marie Martin',   role: 'chef_equipe',  roleLabel: "Chef d'équipe",            companyId: undefined as string | undefined },
  { email: 'p.lambert@buildtrack.fr', name: 'Pierre Lambert', role: 'observateur',  roleLabel: 'Observateur',              companyId: undefined as string | undefined },
  { email: 'st.martin@buildtrack.fr', name: 'Stéphane Martin (ST)', role: 'sous_traitant', roleLabel: 'Sous-traitant', companyId: 'co2' as string | undefined },
];

const DEMO_EMAILS = new Set(DEMO_USERS.map(u => u.email));
const CACHED_PROFILE_KEY = 'buildtrack_cached_profile_v1';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOfflineSession: boolean;
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
  updateUserPermissions: (userId: string, override: PermissionsOverride) => Promise<void>;
  deleteUserProfile: (userId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function addUserToGeneralChannel(orgId: string, userName: string) {
  try {
    const { data } = await (supabase as any)
      .from('channels')
      .select('id, members')
      .eq('organization_id', orgId)
      .eq('type', 'general')
      .single();
    if (!data) return;
    const current: string[] = data.members ?? [];
    if (!current.includes(userName)) {
      await (supabase as any)
        .from('channels')
        .update({ members: [...current, userName] })
        .eq('id', data.id);
    }
  } catch {}
}

async function notifyAdminOfAcceptedInvitation(params: {
  invitedById: string;
  organizationId: string;
  role: string;
  inviteeEmail: string;
  inviteeName?: string;
}): Promise<void> {
  try {
    const [adminResult, orgResult] = await Promise.all([
      (supabase as any).from('profiles').select('name, email').eq('id', params.invitedById).single(),
      (supabase as any).from('organizations').select('name').eq('id', params.organizationId).single(),
    ]);
    if (adminResult.data?.email && orgResult.data?.name) {
      sendInvitationAcceptedEmail({
        adminEmail: adminResult.data.email,
        adminName: adminResult.data.name ?? 'Admin',
        inviteeName: params.inviteeName ?? params.inviteeEmail,
        inviteeEmail: params.inviteeEmail,
        organizationName: orgResult.data.name,
        role: params.role,
      });
    }
  } catch {}
}

async function linkPendingInvitation(userId: string, email: string, inviteeName?: string): Promise<string | undefined> {
  try {
    const { data: inv } = await (supabase as any)
      .from('invitations')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!inv) return undefined;

    await (supabase as any).from('profiles').update({
      organization_id: inv.organization_id,
      role: inv.role,
      role_label: ROLE_LABELS[inv.role as UserRole] ?? inv.role,
      ...(inv.company_id ? { company_id: inv.company_id } : {}),
    }).eq('id', userId);

    await (supabase as any).from('invitations').update({ status: 'accepted' }).eq('id', inv.id);

    // Notify the admin who sent the invitation (fire-and-forget)
    notifyAdminOfAcceptedInvitation({
      invitedById: inv.invited_by,
      organizationId: inv.organization_id,
      role: inv.role,
      inviteeEmail: email,
      inviteeName,
    });

    return inv.organization_id;
  } catch {
    return undefined;
  }
}

async function fetchProfile(userId: string, skipInvitationLink = false): Promise<User | null> {
  try {
    // ── Lancer direct query + RPC en parallèle pour gagner du temps ────
    // La requête directe est rapide si RLS est OK ; le RPC est le fallback
    // si RLS récursif. En les lançant en parallèle, on évite 1 RTT inutile.
    let profileData: Record<string, unknown> | null = null;

    const directPromise = (supabase as any)
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    const rpcPromise = (supabase as any).rpc('get_profile_for_current_user');

    // Attendre la direct query en premier — si elle réussit, on ignore le RPC
    const { data: directData, error: directError } = await directPromise;

    if (!directError && directData) {
      profileData = directData as Record<string, unknown>;
    } else {
      // La politique RLS peut être récursive et provoquer
      // "infinite recursion detected in policy for relation profiles".
      // Le RPC est déjà en vol — on attend son résultat.
      console.warn(
        '[fetchProfile] Requête directe échouée (probablement RLS récursif) :',
        directError.code, directError.message,
        '— Tentative via RPC get_profile_for_current_user…'
      );

      try {
        const { data: rpcRows, error: rpcError } = await rpcPromise;
        if (!rpcError && rpcRows && (rpcRows as unknown[]).length > 0) {
          profileData = (rpcRows as Record<string, unknown>[])[0];
          console.log('[fetchProfile] Profil récupéré via RPC (fallback RLS) ✓');
        } else {
          console.warn(
            '[fetchProfile] RPC également échoué :',
            rpcError?.code, rpcError?.message,
            '— userId:', userId
          );
          return null;
        }
      } catch (rpcErr) {
        console.warn('[fetchProfile] RPC exception:', rpcErr);
        return null;
      }
    }

    if (!profileData) {
      console.warn('[fetchProfile] Aucun profil trouvé pour userId:', userId);
      return null;
    }

    let orgId: string | undefined = (profileData.organization_id as string) ?? undefined;
    let role: UserRole = (profileData.role as UserRole);
    let roleLabel: string = (profileData.role_label as string) ?? ROLE_LABELS[role] ?? role;
    let companyId: string | undefined = (profileData.company_id as string) ?? undefined;

    if (!orgId && role !== 'super_admin') {
      if (skipInvitationLink) {
        // Pendant le login, on ne bloque pas pour lier l'invitation —
        // on le fait en arrière-plan après avoir rendu la main à l'utilisateur.
        const email = profileData.email as string;
        const name = profileData.name as string;
        linkPendingInvitation(userId, email, name).then(linkedOrgId => {
          if (linkedOrgId) {
            (supabase as any).from('profiles').select('*').eq('id', userId).single().then(({ data: refreshed }: { data: any }) => {
              if (refreshed) {
                // Mettre à jour le user en arrière-plan — le prochain render prendra les nouvelles valeurs
                console.log('[fetchProfile] Invitation liée en arrière-plan ✓');
              }
            }).catch(() => {});
            addUserToGeneralChannel(linkedOrgId, name).catch(() => {});
          }
        }).catch(() => {});
      } else {
        const linkedOrgId = await linkPendingInvitation(userId, profileData.email as string, profileData.name as string);
        if (linkedOrgId) {
          const { data: refreshed } = await (supabase as any).from('profiles').select('*').eq('id', userId).single();
          if (refreshed) {
            orgId = (refreshed as Record<string, unknown>).organization_id as string ?? undefined;
            role = (refreshed as Record<string, unknown>).role as UserRole;
            roleLabel = ((refreshed as Record<string, unknown>).role_label as string) ?? ROLE_LABELS[role] ?? role;
            companyId = (refreshed as Record<string, unknown>).company_id as string ?? undefined;
          }
          await addUserToGeneralChannel(linkedOrgId, profileData.name as string);
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

  const orgId = (u.role === 'super_admin') ? undefined : '00000000-0000-0000-0000-000000000001';

  const { error: upsertErr } = await (supabase as any).from('profiles').upsert({
    id: authUserId,
    name: u.name,
    role: u.role,
    role_label: u.roleLabel,
    email: u.email,
    organization_id: orgId ?? null,
  }, { onConflict: 'id' });
  if (upsertErr) {
    console.error('[Supabase] seedOneUser profile upsert failed:', upsertErr.code, upsertErr.message, '— Vérifiez que la politique INSERT est bien ajoutée sur public.profiles dans Supabase.');
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
        const { data: seeded } = await supabase.rpc('demo_profiles_seeded');
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
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  const [seedStatus, setSeedStatus] = useState<'idle' | 'seeding' | 'done' | 'error'>('idle');
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const usersLoadedRef = useRef(false);
  const isSeedingRef = useRef(false);
  const abortSeedingRef = useRef(false);
  const isRegisteringRef = useRef(false);

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
        name: 'Admin Système',
        role: 'admin',
        roleLabel: 'Administrateur',
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
      return;
    }

    // Safety valve: if auth init hangs for any reason, unblock the UI after 10s
    const AUTH_TIMEOUT_MS = 10_000;
    let loadingResolved = false;
    const resolveLoading = () => {
      if (!loadingResolved) {
        loadingResolved = true;
        setIsLoading(false);
      }
    };
    const safetyTimer = setTimeout(resolveLoading, AUTH_TIMEOUT_MS);

    debugLog('[AuthContext] getSession() → appel initial');
    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
      try {
        if (session?.user) {
          debugLogOk(`[AuthContext] Session trouvée → user=${session.user.email}`);
          debugLog('[AuthContext] fetchProfile() → début');
          const profile = await fetchProfile(session.user.id);
          if (profile) {
            debugLogOk(`[AuthContext] fetchProfile() → OK (role=${profile.role}, org=${profile.organizationId ?? 'aucune'})`);
            setUser(profile);
            setIsOfflineSession(false);
            cacheProfile(profile);
          } else {
            // fetchProfile returned null — likely network error (offline)
            // Use cached profile as fallback instead of signing out
            const cached = await readCachedProfile();
            if (cached) {
              debugLogWarn('[AuthContext] fetchProfile() → null (hors ligne?) → profil en cache restauré');
              setUser(cached);
              setIsOfflineSession(true);
            } else {
              debugLogError('[AuthContext] fetchProfile() → null → signOut() déclenché');
              supabase.auth.signOut().catch(() => {});
              setUser(null);
            }
          }
        } else {
          // No Supabase session — try cached profile for offline access
          const cached = await readCachedProfile();
          if (cached) {
            debugLogWarn('[AuthContext] getSession() → pas de session active → profil en cache restauré (hors ligne)');
            setUser(cached);
            setIsOfflineSession(true);
          } else {
            debugLogWarn('[AuthContext] getSession() → pas de session active');
          }
        }
      } catch (err: any) {
        debugLogError(`[AuthContext] getSession().then exception: ${err?.message ?? err}`);
        // On exception, try cached profile before giving up
        const cached = await readCachedProfile();
        if (cached) {
          setUser(cached);
          setIsOfflineSession(true);
        } else {
          setUser(null);
        }
      } finally {
        clearTimeout(safetyTimer);
        resolveLoading();
        debugLog('[AuthContext] isLoading → false (initial)');
      }
    }).catch(async (err: any) => {
      debugLogError(`[AuthContext] getSession() rejeté: ${err?.message ?? err}`);
      // getSession() itself failed (network) — try cached profile
      const cached = await readCachedProfile();
      if (cached) {
        debugLogWarn('[AuthContext] getSession() rejeté → profil en cache restauré (hors ligne)');
        setUser(cached);
        setIsOfflineSession(true);
      }
      clearTimeout(safetyTimer);
      resolveLoading();
    });

    const fetchingProfileRef = { current: false };
    // Reset stuck guard after 8s so returning to the app always works
    let fetchingProfileTimer: ReturnType<typeof setTimeout> | null = null;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event: any, session: any) => {
      debugLog(`[AuthContext] onAuthStateChange → event=${_event} session=${session ? session.user?.email : 'null'}`);
      if (isSeedingRef.current) { debugLogWarn('[AuthContext] onAuthStateChange ignoré (seeding en cours)'); return; }
      if (isRegisteringRef.current) { debugLogWarn('[AuthContext] onAuthStateChange ignoré (register en cours)'); return; }
      if (fetchingProfileRef.current) { debugLogWarn('[AuthContext] onAuthStateChange ignoré (fetchProfile déjà en cours)'); return; }
      // login() manages setUser() directly and calls fetchProfile() itself.
      // Skipping here avoids a concurrent duplicate fetchProfile() and the
      // fire-and-forget signOut() that could clear queries after login succeeds.
      if (loginInProgressRef.current) { debugLogWarn('[AuthContext] onAuthStateChange ignoré (login en cours)'); return; }
      if (session?.user) {
        fetchingProfileRef.current = true;
        if (fetchingProfileTimer) clearTimeout(fetchingProfileTimer);
        fetchingProfileTimer = setTimeout(() => {
          fetchingProfileRef.current = false;
        }, 8_000);
        try {
          debugLog(`[AuthContext] onAuthStateChange → fetchProfile() pour ${session.user.email}`);
          const profile = await fetchProfile(session.user.id);
          if (profile) {
            debugLogOk(`[AuthContext] onAuthStateChange → fetchProfile OK (role=${profile.role})`);
            setUser(profile);
            setIsOfflineSession(false);
            cacheProfile(profile);
          } else {
            // fetchProfile null — likely offline, use cached profile
            const cached = await readCachedProfile();
            if (cached) {
              debugLogWarn('[AuthContext] onAuthStateChange → fetchProfile null (hors ligne?) → profil en cache restauré');
              setUser(cached);
              setIsOfflineSession(true);
            } else {
              debugLogError('[AuthContext] onAuthStateChange → fetchProfile null → signOut()');
              supabase.auth.signOut().catch(() => {});
              setUser(null);
            }
          }
        } finally {
          if (fetchingProfileTimer) clearTimeout(fetchingProfileTimer);
          fetchingProfileRef.current = false;
        }
      } else {
        // Session null — likely TOKEN_REFRESH_FAILED while offline
        // Use cached profile instead of disconnecting the user
        const cached = await readCachedProfile();
        if (cached) {
          debugLogWarn('[AuthContext] onAuthStateChange → session null (hors ligne?) → profil en cache restauré');
          setUser(cached);
          setIsOfflineSession(true);
        } else {
          debugLogWarn('[AuthContext] onAuthStateChange → session null → user = null');
          setUser(null);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(safetyTimer);
      if (fetchingProfileTimer) clearTimeout(fetchingProfileTimer);
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
      permissionsOverride: (p.permissions_override && Object.keys(p.permissions_override).length > 0)
        ? p.permissions_override as PermissionsOverride
        : undefined,
    });

    // Essai 1 : RPC SECURITY DEFINER get_org_users() — contourne RLS,
    // évite la récursion infinie dans la politique profiles SELECT.
    (supabase as any).rpc('get_org_users').then(({ data: rpcData, error: rpcErr }: { data: any; error: any }) => {
      if (!rpcErr && rpcData && rpcData.length > 0) {
        setUsers(rpcData.map(mapProfile));
        setUsersLoaded(true);
        return;
      }
      if (rpcErr) {
        console.warn('[AuthContext] get_org_users RPC error (RLS fix SQL pas encore appliqué?):', rpcErr.code, rpcErr.message);
      }

      // Essai 2 : requête directe sur profiles (peut échouer si RLS récursif)
      (supabase as any).from('profiles')
        .select('id, name, role, role_label, email, organization_id, company_id, permissions_override')
        .then(({ data, error }: { data: any; error: any }) => {
          if (!error && data && data.length > 0) {
            setUsers(data.map(mapProfile));
            setUsersLoaded(true);
            return;
          }
          if (error) {
            console.warn('[AuthContext] profiles.select error (récursion RLS?):', error.code, error.message,
              '— Appliquez supabase/migrations/20260422_fix_rls_infinite_recursion.sql dans le SQL Editor Supabase.');
          }

          // Essai 3 : requête minimale sans permissions_override
          (supabase as any).from('profiles')
            .select('id, name, role, role_label, email, organization_id')
            .then(({ data: d3, error: e3 }: { data: any; error: any }) => {
              if (e3) {
                console.warn('[AuthContext] profiles minimal select error:', e3.code, e3.message);
                usersLoadedRef.current = false;
                return;
              }
              if (d3 && d3.length > 0) {
                setUsers(d3.map((p: any) => ({
                  id: p.id, name: p.name, role: p.role as UserRole,
                  roleLabel: p.role_label ?? ROLE_LABELS[p.role as UserRole] ?? p.role,
                  email: p.email, organizationId: p.organization_id ?? undefined,
                  companyId: undefined, permissionsOverride: undefined,
                })));
                setUsersLoaded(true);
              } else {
                usersLoadedRef.current = false;
              }
            }).catch(() => { usersLoadedRef.current = false; });
        }).catch((err: any) => {
          console.warn('[AuthContext] profiles.select exception:', err);
          usersLoadedRef.current = false;
        });
    }).catch((err: any) => {
      console.warn('[AuthContext] get_org_users RPC exception:', err);
      usersLoadedRef.current = false;
    });
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
      return { success: false, error: 'La création de compte nécessite une connexion au serveur.' };
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
        resolve({ success: false, error: 'La création du compte a pris trop longtemps. Vérifiez votre connexion et réessayez.' });
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
            return { success: false, error: signUpErr?.message ?? "Impossible de créer le compte." };
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
            return { success: false, error: 'Un compte existe déjà avec cet email.' };
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
              error: "Cet email est lié à un ancien compte désactivé. Utilisez « Mot de passe oublié » depuis l'écran de connexion pour récupérer l'accès.",
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
              return { success: false, error: "Un email de confirmation a été envoyé à votre adresse. Confirmez votre email puis connectez-vous." };
            }
            return { success: false, error: "Compte créé. Connectez-vous avec vos identifiants." };
          }
          signInSession = signInData.session;
          signInUserId = signInData.user.id;
        }

        if (!signInUserId) {
          cleanup();
          return { success: false, error: "Compte créé. Connectez-vous pour continuer." };
        }

        // ── Étape 2 : créer le profil maintenant qu'on a une session ────────
        // Tentative d'INSERT côté client (chemin rapide). Si elle échoue
        // pour une raison quelconque (RLS, timing, conflit), pas grave :
        // l'étape 3 (RPC link_invitation_for_current_user) fait un UPSERT
        // côté serveur en SECURITY DEFINER — le profil sera créé là.
        const { error: profileInsertErr } = await (supabase as any).from('profiles').insert({
          id: signInUserId,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: 'observateur',
          role_label: ROLE_LABELS['observateur'],
          organization_id: null,
        });

        if (profileInsertErr && profileInsertErr.code !== '23505') {
          // 23505 = duplicate key (profile already exists from a previous attempt) → OK
          console.warn('[register] profiles.insert (invitation) error:', profileInsertErr.code, profileInsertErr.message,
            '— Le RPC link_invitation_for_current_user prendra le relais via UPSERT.');
        }

        // Link the invitation to the newly created profile.
        // Step 1 — Try the SECURITY DEFINER RPC (bypasses RLS, preferred path).
        // Step 2 — If RPC fails or isn't deployed, fall back to direct client-side
        //          queries using the RLS policies that allow a user to read/accept
        //          invitations sent to their own email.
        let rpcLinked = false;
        let rpcLinkedOrgId: string | undefined;
        let rpcLinkedRole: string | undefined;
        try {
          // On passe p_name pour que le RPC puisse créer le profil via UPSERT
          // si l'INSERT côté client a été bloqué par RLS (cas où la session
          // n'était pas encore propagée dans les headers du client supabase-js).
          const { data: rpcData, error: rpcErr } = await supabase.rpc(
            'link_invitation_for_current_user',
            { p_name: name.trim() }
          );
          if (rpcErr) {
            console.warn('[register] link_invitation_for_current_user RPC error:', rpcErr.code, rpcErr.message);
          } else {
            rpcLinked = !!(rpcData as any)?.linked;
            rpcLinkedOrgId = (rpcData as any)?.organization_id;
            rpcLinkedRole = (rpcData as any)?.role;
          }
        } catch (rpcEx) {
          console.warn('[register] link_invitation_for_current_user RPC exception:', rpcEx);
        }

        // Notify the admin who sent the invitation when the RPC linked it.
        // The fallback path uses linkPendingInvitation() which already notifies.
        if (rpcLinked && rpcLinkedOrgId) {
          try {
            const emailLower = email.trim().toLowerCase();
            const { data: acceptedInv } = await (supabase as any)
              .from('invitations')
              .select('invited_by, role')
              .eq('email', emailLower)
              .eq('organization_id', rpcLinkedOrgId)
              .eq('status', 'accepted')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (acceptedInv?.invited_by) {
              notifyAdminOfAcceptedInvitation({
                invitedById: acceptedInv.invited_by,
                organizationId: rpcLinkedOrgId,
                role: acceptedInv.role ?? rpcLinkedRole ?? 'observateur',
                inviteeEmail: emailLower,
                inviteeName: name.trim(),
              });
            }
          } catch (notifyEx) {
            console.warn('[register] admin notification (RPC path) failed:', notifyEx);
          }
        }

        // Client-side fallback: query invitations directly (requires the RLS policy
        // "Utilisateur peut voir ses propres invitations" to be deployed on Supabase).
        if (!rpcLinked && signInUserId) {
          try {
            const emailLower = email.trim().toLowerCase();
            const { data: inv } = await (supabase as any)
              .from('invitations')
              .select('*')
              .eq('email', emailLower)
              .eq('status', 'pending')
              .gt('expires_at', new Date().toISOString())
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (inv?.organization_id) {
              await (supabase as any).from('profiles').update({
                organization_id: inv.organization_id,
                role: inv.role,
                role_label: ROLE_LABELS[inv.role as UserRole] ?? inv.role,
                ...(inv.company_id ? { company_id: inv.company_id } : {}),
              }).eq('id', signInUserId);

              await (supabase as any).from('invitations')
                .update({ status: 'accepted' })
                .eq('id', inv.id);

              // Notify the admin who sent the invitation (fire-and-forget)
              notifyAdminOfAcceptedInvitation({
                invitedById: inv.invited_by,
                organizationId: inv.organization_id,
                role: inv.role,
                inviteeEmail: emailLower,
                inviteeName: name.trim(),
              });

              console.log('[register] invitation linked via client-side fallback for org:', inv.organization_id);
            }
          } catch (fallbackEx) {
            console.warn('[register] client-side invitation link fallback failed:', fallbackEx);
          }
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
          }).catch(() => {});
          return { success: true };
        }

        cleanup();
        return { success: false, error: "Compte créé. Connectez-vous pour continuer." };
      } catch (err: any) {
        cleanup();
        console.warn('[register] Exception:', err?.message ?? err);
        return { success: false, error: 'Erreur réseau. Vérifiez votre connexion.' };
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
              resolve({ success: true });
              return;
            }
          }
        } catch {}
        resolve({ success: false, error: 'La connexion a pris trop longtemps. Vérifiez votre réseau et réessayez.' });
      }, LOGIN_TIMEOUT_MS);
    });

    if (!isSupabaseConfigured) {
      const demoUser = DEMO_USERS.find(u => u.email === email);
      const match = demoUser && DEMO_SEED_PASS && DEMO_SEED_PASS === password ? demoUser : null;
      if (!match) {
        loginInProgressRef.current = false;
        return { success: false, error: 'Email ou mot de passe incorrect.' };
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
            error: "Email non confirmé. Désactivez « Confirm email » dans Supabase → Authentication → Providers → Email, puis relancez l'app.",
          };
        }
        return { success: false, error: 'Email ou mot de passe incorrect.' };
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
          error: "Email non confirmé. Désactivez « Confirm email » dans Supabase → Authentication → Providers → Email, puis relancez l'app.",
        };
      }

      if (authUser && authSession) {
        // Passer skipInvitationLink=true pour ne pas bloquer le login
        // avec linkPendingInvitation (3-4 appels réseau supplémentaires)
        let profile = await fetchProfile(authUser.id, true);

        if (!profile) {
          // One retry after a short pause — the seeding's signOut may have fired
          // in the tiny window before signInWithPassword completed.
          console.warn('[login] fetchProfile returned null — 1 retry...');
          await new Promise(r => setTimeout(r, 400));
          profile = await fetchProfile(authUser.id, true);
        }

        // Recovery : si le profil est toujours manquant et que l'utilisateur
        // a une invitation en attente (cas d'une inscription précédente où
        // l'INSERT profiles avait échoué silencieusement à cause de la RLS),
        // on appelle le RPC qui fait un UPSERT du profil + lie l'invitation.
        if (!profile) {
          console.warn('[login] profil manquant — tentative de récupération via link_invitation_for_current_user...');
          try {
            const { data: rpcData, error: rpcErr } = await supabase.rpc(
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
        error:
          'Profil introuvable. Votre compte existe mais le profil est manquant ou inaccessible.\n\n' +
          'Appliquez la migration SQL « 20260406_fix_profiles_rls_recursion.sql » dans Supabase ' +
          '(Éditeur SQL), puis réessayez.',
      };
    } catch {
      abortSeedingRef.current = false;
      loginInProgressRef.current = false;
      if (timeoutId) clearTimeout(timeoutId);
      return { success: false, error: 'Impossible de se connecter. Vérifiez votre réseau.' };
    }
  }

  async function logout() {
    try {
      if (isSupabaseConfigured) await supabase.auth.signOut();
    } catch {
      // ignore
    }
    setUser(null);
    setIsOfflineSession(false);
    clearCachedProfile();
  }

  async function updateUserRole(userId: string, newRole: UserRole): Promise<void> {
    const newLabel = ROLE_LABELS[newRole];
    if (isSupabaseConfigured) {
      const { error } = await (supabase as any).from('profiles').update({
        role: newRole,
        role_label: newLabel,
      }).eq('id', userId);
      if (error) {
        Alert.alert('Erreur', "Le rôle n'a pas pu être modifié. Vérifiez vos permissions.");
        return;
      }
    }
    setUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, role: newRole, roleLabel: newLabel } : u
    ));
  }

  async function updateUserCompany(userId: string, companyId: string | null): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await (supabase as any).from('profiles').update({
        company_id: companyId,
      }).eq('id', userId);
      if (error) {
        Alert.alert('Erreur', "L'entreprise n'a pas pu être mise à jour. Vérifiez vos permissions.");
        return;
      }
    }
    setUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, companyId: companyId ?? undefined } : u
    ));
  }

  async function deleteUserProfile(userId: string): Promise<void> {
    const targetUser = users.find(u => u.id === userId);

    if (isSupabaseConfigured) {
      const { error } = await (supabase as any).from('profiles').delete().eq('id', userId);
      if (error) {
        Alert.alert('Erreur', "Le profil n'a pas pu être supprimé. Vérifiez vos permissions.");
        return;
      }
    }

    // Send revocation email (fire-and-forget)
    if (targetUser?.email && targetUser?.name) {
      try {
        let orgName = 'votre organisation';
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
        });
      } catch {}
    }

    setUsers(prev => prev.filter(u => u.id !== userId));
  }

  async function updateUserPermissions(userId: string, override: PermissionsOverride): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await (supabase as any).from('profiles').update({
        permissions_override: override,
      }).eq('id', userId);
      if (error) {
        Alert.alert('Erreur', "Les permissions n'ont pas pu être mises à jour. Vérifiez vos accès.");
        return;
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
      isOfflineSession,
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
