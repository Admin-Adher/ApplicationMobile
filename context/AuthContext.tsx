import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User, UserRole } from '@/constants/types';

const ROLE_PERMISSIONS: Record<UserRole, { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean }> = {
  admin:       { canCreate: true,  canEdit: true,  canDelete: true,  canExport: true },
  conducteur:  { canCreate: true,  canEdit: true,  canDelete: false, canExport: true },
  chef_equipe: { canCreate: true,  canEdit: true,  canDelete: false, canExport: false },
  observateur: { canCreate: false, canEdit: false, canDelete: false, canExport: true },
};

const DEMO_USERS = [
  { email: 'admin@buildtrack.fr',     password: 'admin123', name: 'Admin Système',  role: 'admin',       roleLabel: 'Administrateur' },
  { email: 'j.dupont@buildtrack.fr',  password: 'pass123',  name: 'Jean Dupont',    role: 'conducteur',  roleLabel: 'Conducteur de travaux' },
  { email: 'm.martin@buildtrack.fr',  password: 'pass123',  name: 'Marie Martin',   role: 'chef_equipe', roleLabel: "Chef d'équipe" },
  { email: 'p.lambert@buildtrack.fr', password: 'pass123',  name: 'Pierre Lambert', role: 'observateur', roleLabel: 'Observateur' },
];

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  permissions: { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean };
  users: User[];
  seedStatus: 'idle' | 'seeding' | 'done' | 'error';
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<User | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error || !data) return null;
  return {
    id: data.id,
    name: data.name,
    role: data.role as UserRole,
    roleLabel: data.role_label,
    email: data.email,
    password: '',
  };
}

async function seedDemoUsers(): Promise<'done' | 'error'> {
  try {
    for (const u of DEMO_USERS) {
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: u.email,
        password: u.password,
      });

      const authUserId = signInData?.user?.id;
      if (signInErr || !authUserId) continue;

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
  const [seedStatus, setSeedStatus] = useState<'idle' | 'seeding' | 'done' | 'error'>('done');
  const isSeedingRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const profile = await fetchProfile(session.user.id);
        setUser(profile);
      }
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (isSeedingRef.current) return;
      if (session?.user) {
        const profile = await fetchProfile(session.user.id);
        setUser(profile);
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { success: false, error: 'Email ou mot de passe incorrect.' };
    }
    return { success: true };
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
  }

  const permissions = user ? ROLE_PERMISSIONS[user.role] : ROLE_PERMISSIONS.observateur;

  const staticUsers: User[] = DEMO_USERS.map((u, i) => ({
    id: `demo-${i}`,
    name: u.name,
    role: u.role as UserRole,
    roleLabel: u.roleLabel,
    email: u.email,
    password: '',
  }));

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
      permissions,
      users: staticUsers,
      seedStatus,
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
