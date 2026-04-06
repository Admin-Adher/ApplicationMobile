import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { User, UserRole } from '@/constants/types';
import { ROLE_LABELS } from '@/constants/roles';

const ROLE_PERMISSIONS: Record<UserRole, {
  canCreate: boolean; canEdit: boolean; canEditOwn: boolean; canDelete: boolean;
  canExport: boolean; canManageTeams: boolean;
  canViewTeams: boolean; canUpdateAttendance: boolean;
}> = {
  super_admin:    { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: true,  canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true  },
  admin:          { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: true,  canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true  },
  conducteur:     { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: false, canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true  },
  chef_equipe:    { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: false, canExport: false, canManageTeams: false, canViewTeams: true,  canUpdateAttendance: true  },
  observateur:    { canCreate: false, canEdit: false, canEditOwn: false, canDelete: false, canExport: true,  canManageTeams: false, canViewTeams: true,  canUpdateAttendance: false },
  sous_traitant:  { canCreate: false, canEdit: false, canEditOwn: true,  canDelete: false, canExport: false, canManageTeams: false, canViewTeams: false, canUpdateAttendance: false },
};

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

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (params: {
    name: string;
    email: string;
    password: string;
    organizationName?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  permissions: {
    canCreate: boolean; canEdit: boolean; canEditOwn: boolean; canDelete: boolean;
    canExport: boolean; canManageTeams: boolean;
    canViewTeams: boolean; canUpdateAttendance: boolean;
  };
  users: User[];
  seedStatus: 'idle' | 'seeding' | 'done' | 'error';
  updateUserRole: (userId: string, newRole: UserRole) => Promise<void>;
  updateUserCompany: (userId: string, companyId: string | null) => Promise<void>;
  deleteUserProfile: (userId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function linkPendingInvitation(userId: string, email: string): Promise<string | undefined> {
  try {
    const { data: inv } = await supabase
      .from('invitations')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!inv) return undefined;

    await supabase.from('profiles').update({
      organization_id: inv.organization_id,
      role: inv.role,
      role_label: ROLE_LABELS[inv.role as UserRole] ?? inv.role,
      ...(inv.company_id ? { company_id: inv.company_id } : {}),
    }).eq('id', userId);

    await supabase.from('invitations').update({ status: 'accepted' }).eq('id', inv.id);

    return inv.organization_id;
  } catch {
    return undefined;
  }
}

async function fetchProfile(userId: string): Promise<User | null> {
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error || !data) return null;

    let orgId: string | undefined = data.organization_id ?? undefined;
    let role: UserRole = data.role as UserRole;
    let roleLabel: string = data.role_label ?? ROLE_LABELS[role] ?? role;

    let companyId: string | undefined = data.company_id ?? undefined;

    if (!orgId && role !== 'super_admin') {
      const linkedOrgId = await linkPendingInvitation(userId, data.email);
      if (linkedOrgId) {
        const { data: refreshed } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if (refreshed) {
          orgId = refreshed.organization_id ?? undefined;
          role = refreshed.role as UserRole;
          roleLabel = refreshed.role_label ?? ROLE_LABELS[role] ?? role;
          companyId = refreshed.company_id ?? undefined;
        }
      }
    }

    return {
      id: data.id,
      name: data.name,
      role,
      roleLabel,
      email: data.email,
      organizationId: orgId,
      companyId,
    };
  } catch {
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
    await supabase.auth.signOut();
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

  const { error: upsertErr } = await supabase.from('profiles').upsert({
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
  await supabase.auth.signOut();
}

async function seedDemoUsers(shouldAbort: () => boolean): Promise<'done' | 'error'> {
  const SEED_TIMEOUT_MS = 30_000;

  const doSeed = async (): Promise<'done' | 'error'> => {
    try {
      for (const u of DEMO_USERS) {
        if (shouldAbort()) break;
        await seedOneUser(u, shouldAbort).catch(() => {});
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
  const [seedStatus, setSeedStatus] = useState<'idle' | 'seeding' | 'done' | 'error'>('idle');
  const [users, setUsers] = useState<User[]>([]);
  const isSeedingRef = useRef(false);
  const abortSeedingRef = useRef(false);
  const isRegisteringRef = useRef(false);

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

    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
      try {
        if (session?.user) {
          const profile = await fetchProfile(session.user.id);
          if (profile) {
            setUser(profile);
          } else {
            supabase.auth.signOut().catch(() => {});
            setUser(null);
          }
        }
      } catch {
        setUser(null);
      } finally {
        clearTimeout(safetyTimer);
        resolveLoading();
      }
    }).catch(() => {
      clearTimeout(safetyTimer);
      resolveLoading();
    });

    const fetchingProfileRef = { current: false };
    // Reset stuck guard after 8s so returning to the app always works
    let fetchingProfileTimer: ReturnType<typeof setTimeout> | null = null;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event: any, session: any) => {
      if (isSeedingRef.current) return;
      if (isRegisteringRef.current) return;
      if (fetchingProfileRef.current) return;
      if (session?.user) {
        fetchingProfileRef.current = true;
        if (fetchingProfileTimer) clearTimeout(fetchingProfileTimer);
        fetchingProfileTimer = setTimeout(() => {
          fetchingProfileRef.current = false;
        }, 8_000);
        try {
          const profile = await fetchProfile(session.user.id);
          if (profile) {
            setUser(profile);
          } else {
            supabase.auth.signOut().catch(() => {});
            setUser(null);
          }
        } finally {
          if (fetchingProfileTimer) clearTimeout(fetchingProfileTimer);
          fetchingProfileRef.current = false;
        }
      } else {
        setUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(safetyTimer);
      if (fetchingProfileTimer) clearTimeout(fetchingProfileTimer);
      loadingResolved = true; // prevent stale setState after unmount
    };
  }, []);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    supabase.from('profiles').select('id, name, role, role_label, email, organization_id, company_id').then(({ data }: { data: any }) => {
      if (data && data.length > 0) {
        setUsers(data.map((p: any) => ({
          id: p.id,
          name: p.name,
          role: p.role as UserRole,
          roleLabel: p.role_label ?? ROLE_LABELS[p.role as UserRole] ?? p.role,
          email: p.email,
          organizationId: p.organization_id ?? undefined,
          companyId: p.company_id ?? undefined,
        })));
      }
    }).catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!isLoading && !user && seedStatus === 'idle') {
      setSeedStatus('seeding');
      isSeedingRef.current = true;
      abortSeedingRef.current = false;
      seedDemoUsers(() => abortSeedingRef.current).then(result => {
        isSeedingRef.current = false;
        setSeedStatus(result);
      });
    }
  }, [isLoading, user, seedStatus]);

  async function register({
    name,
    email,
    password,
    organizationName,
  }: {
    name: string;
    email: string;
    password: string;
    organizationName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'La création de compte nécessite une connexion au serveur.' };
    }

    abortSeedingRef.current = true;
    isRegisteringRef.current = true;

    try {
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signUpErr || !signUpData?.user?.id) {
        if (signUpErr?.message?.toLowerCase().includes('already registered') ||
            signUpErr?.message?.toLowerCase().includes('already been registered') ||
            signUpErr?.message?.toLowerCase().includes('user_already_exists')) {
          return { success: false, error: 'Un compte existe déjà avec cet email.' };
        }
        return { success: false, error: signUpErr?.message ?? "Impossible de créer le compte." };
      }

      const userId = signUpData.user.id;

      if (organizationName?.trim()) {
        const slug = organizationName.trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');

        const uniqueSlug = slug + '-' + Date.now().toString(36);

        const { data: orgData, error: orgErr } = await supabase
          .from('organizations')
          .insert({ name: organizationName.trim(), slug: uniqueSlug })
          .select()
          .single();

        if (orgErr || !orgData) {
          return { success: false, error: "Impossible de créer l'organisation. Réessayez." };
        }

        const orgId: string = orgData.id;

        await supabase.from('channels').insert({
          id: `general-${orgId}`,
          name: 'Général',
          type: 'general',
          organization_id: orgId,
          created_by: name.trim(),
          members: [],
        });

        const { data: enterprisePlan } = await supabase
          .from('plans')
          .select('id')
          .order('created_at', { ascending: true })
          .limit(1)
          .single();

        if (enterprisePlan?.id) {
          await supabase.from('subscriptions').insert({
            organization_id: orgId,
            plan_id: enterprisePlan.id,
            status: 'active',
          });
        }

        await supabase.from('profiles').insert({
          id: userId,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: 'admin',
          role_label: ROLE_LABELS['admin'],
          organization_id: orgId,
        });
      } else {
        await supabase.from('profiles').insert({
          id: userId,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: 'observateur',
          role_label: ROLE_LABELS['observateur'],
          organization_id: null,
        });
      }

      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInErr || !signInData?.user?.id) {
        isRegisteringRef.current = false;
        return { success: false, error: "Compte créé. Connectez-vous avec vos identifiants." };
      }

      const profile = await fetchProfile(signInData.user.id);
      if (profile) {
        setUser(profile);
        isSeedingRef.current = false;
        setSeedStatus('done');
        isRegisteringRef.current = false;
        return { success: true };
      }

      isRegisteringRef.current = false;
      return { success: false, error: "Compte créé. Connectez-vous pour continuer." };
    } catch {
      isRegisteringRef.current = false;
      return { success: false, error: 'Erreur réseau. Vérifiez votre connexion.' };
    }
  }

  async function login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    // Abort any in-progress seeding so its signOut calls don't kick us out
    abortSeedingRef.current = true;

    if (!isSupabaseConfigured) {
      const demoUser = DEMO_USERS.find(u => u.email === email);
      const match = demoUser && DEMO_SEED_PASS && DEMO_SEED_PASS === password ? demoUser : null;
      if (!match) return { success: false, error: 'Email ou mot de passe incorrect.' };
      setUser({
        id: `demo-${DEMO_USERS.indexOf(match)}`,
        name: match.name,
        role: match.role as UserRole,
        roleLabel: match.roleLabel,
        email: match.email,
        organizationId: match.role === 'super_admin' ? undefined : 'demo-org',
        companyId: match.companyId,
      });
      return { success: true };
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        abortSeedingRef.current = false;
        if (error.message?.toLowerCase().includes('email not confirmed') ||
            error.message?.toLowerCase().includes('email_not_confirmed')) {
          return {
            success: false,
            error: "Email non confirmé. Désactivez « Confirm email » dans Supabase → Authentication → Providers → Email, puis relancez l'app.",
          };
        }
        return { success: false, error: 'Email ou mot de passe incorrect.' };
      }

      // Set the user directly here so we don't depend on onAuthStateChange,
      // which may still receive stale signOut events from the seeding process.
      const authUser = data?.user;
      if (authUser) {
        const profile = await fetchProfile(authUser.id);
        if (profile) {
          setUser(profile);
          isSeedingRef.current = false;
          setSeedStatus('done');
          return { success: true };
        }
      }

      // Profile missing — sign out cleanly
      await supabase.auth.signOut();
      isSeedingRef.current = false;
      return { success: false, error: 'Profil introuvable. Contactez un administrateur.' };
    } catch {
      abortSeedingRef.current = false;
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
  }

  async function updateUserRole(userId: string, newRole: UserRole): Promise<void> {
    const newLabel = ROLE_LABELS[newRole];
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('profiles').update({
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
      const { error } = await supabase.from('profiles').update({
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
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('profiles').delete().eq('id', userId);
      if (error) {
        Alert.alert('Erreur', "Le profil n'a pas pu être supprimé. Vérifiez vos permissions.");
        return;
      }
    }
    setUsers(prev => prev.filter(u => u.id !== userId));
  }

  const permissions = user ? ROLE_PERMISSIONS[user.role] : ROLE_PERMISSIONS.observateur;

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      register,
      logout,
      permissions,
      users,
      seedStatus,
      updateUserRole,
      updateUserCompany,
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
