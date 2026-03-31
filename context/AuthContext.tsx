import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { User, UserRole } from '@/constants/types';

const ROLE_PERMISSIONS: Record<UserRole, {
  canCreate: boolean; canEdit: boolean; canDelete: boolean;
  canExport: boolean; canManageTeams: boolean;
  canViewTeams: boolean; canUpdateAttendance: boolean;
}> = {
  admin:       { canCreate: true,  canEdit: true,  canDelete: true,  canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true  },
  conducteur:  { canCreate: true,  canEdit: true,  canDelete: false, canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true  },
  chef_equipe: { canCreate: true,  canEdit: true,  canDelete: false, canExport: false, canManageTeams: false, canViewTeams: true,  canUpdateAttendance: true  },
  observateur: { canCreate: false, canEdit: false, canDelete: false, canExport: true,  canManageTeams: false, canViewTeams: false, canUpdateAttendance: false },
};

const DEMO_USERS = [
  { email: 'admin@buildtrack.fr',     password: 'admin123', name: 'Admin Système',  role: 'admin',       roleLabel: 'Administrateur' },
  { email: 'j.dupont@buildtrack.fr',  password: 'pass123',  name: 'Jean Dupont',    role: 'conducteur',  roleLabel: 'Conducteur de travaux' },
  { email: 'm.martin@buildtrack.fr',  password: 'pass123',  name: 'Marie Martin',   role: 'chef_equipe', roleLabel: "Chef d'équipe" },
  { email: 'p.lambert@buildtrack.fr', password: 'pass123',  name: 'Pierre Lambert', role: 'observateur', roleLabel: 'Observateur' },
];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrateur',
  conducteur: 'Conducteur de travaux',
  chef_equipe: "Chef d'équipe",
  observateur: 'Observateur',
};

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  permissions: {
    canCreate: boolean; canEdit: boolean; canDelete: boolean;
    canExport: boolean; canManageTeams: boolean;
    canViewTeams: boolean; canUpdateAttendance: boolean;
  };
  users: User[];
  seedStatus: 'idle' | 'seeding' | 'done' | 'error';
  updateUserRole: (userId: string, newRole: UserRole) => Promise<void>;
  deleteUserProfile: (userId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<User | null> {
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error || !data) return null;
    return {
      id: data.id,
      name: data.name,
      role: data.role as UserRole,
      roleLabel: data.role_label,
      email: data.email,
    };
  } catch {
    return null;
  }
}

async function seedDemoUsers(): Promise<'done' | 'error'> {
  try {
    for (const u of DEMO_USERS) {
      let authUserId: string | undefined;

      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: u.email,
        password: u.password,
      });

      if (!signInErr && signInData?.user?.id) {
        authUserId = signInData.user.id;
      } else {
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email: u.email,
          password: u.password,
        });
        if (signUpErr || !signUpData?.user?.id) continue;
        authUserId = signUpData.user.id;
        await supabase.auth.signOut();
        const { data: reSign } = await supabase.auth.signInWithPassword({
          email: u.email,
          password: u.password,
        });
        if (reSign?.user?.id) authUserId = reSign.user.id;
      }

      if (!authUserId) continue;

      await supabase.from('profiles').upsert({
        id: authUserId,
        name: u.name,
        role: u.role,
        role_label: u.roleLabel,
        email: u.email,
      }, { onConflict: 'id' });

      await supabase.auth.signOut();
    }
    return 'done';
  } catch {
    return 'error';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [seedStatus, setSeedStatus] = useState<'idle' | 'seeding' | 'done' | 'error'>('idle');
  const [users, setUsers] = useState<User[]>([]);
  const isSeedingRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const offlineUser: User = {
        id: 'offline-admin',
        name: 'Admin Système',
        role: 'admin',
        roleLabel: 'Administrateur',
        email: 'admin@buildtrack.fr',
      };
      setUser(offlineUser);
      setUsers(DEMO_USERS.map((u, i) => ({
        id: `demo-${i}`,
        name: u.name,
        role: u.role as UserRole,
        roleLabel: u.roleLabel,
        email: u.email,
      })));
      setIsLoading(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const profile = await fetchProfile(session.user.id);
        if (profile) {
          setUser(profile);
        } else {
          await supabase.auth.signOut();
          setUser(null);
        }
      }
      setIsLoading(false);
    }).catch(() => {
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (isSeedingRef.current) return;
      if (session?.user) {
        const profile = await fetchProfile(session.user.id);
        if (profile) {
          setUser(profile);
        } else {
          await supabase.auth.signOut();
          setUser(null);
        }
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    supabase.from('profiles').select('id, name, role, role_label, email').then(({ data }) => {
      if (data && data.length > 0) {
        setUsers(data.map((p: any) => ({
          id: p.id,
          name: p.name,
          role: p.role as UserRole,
          roleLabel: p.role_label,
          email: p.email,
        })));
      }
    }).catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!isLoading && !user && seedStatus === 'idle') {
      setSeedStatus('seeding');
      isSeedingRef.current = true;
      seedDemoUsers().then(result => {
        isSeedingRef.current = false;
        setSeedStatus(result);
      });
    }
  }, [isLoading, user, seedStatus]);

  async function login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured) {
      const match = DEMO_USERS.find(u => u.email === email && u.password === password);
      if (!match) return { success: false, error: 'Email ou mot de passe incorrect.' };
      setUser({
        id: `demo-${DEMO_USERS.indexOf(match)}`,
        name: match.name,
        role: match.role as UserRole,
        roleLabel: match.roleLabel,
        email: match.email,
      });
      return { success: true };
    }
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        return { success: false, error: 'Email ou mot de passe incorrect.' };
      }
      return { success: true };
    } catch {
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
      await supabase.from('profiles').update({
        role: newRole,
        role_label: newLabel,
      }).eq('id', userId);
    }
    setUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, role: newRole, roleLabel: newLabel } : u
    ));
  }

  async function deleteUserProfile(userId: string): Promise<void> {
    if (isSupabaseConfigured) {
      await supabase.from('profiles').delete().eq('id', userId);
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
      logout,
      permissions,
      users,
      seedStatus,
      updateUserRole,
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
