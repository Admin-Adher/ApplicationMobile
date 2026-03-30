import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, UserRole } from '@/constants/types';

const MOCK_USERS: User[] = [
  { id: 'u1', name: 'Admin Système', role: 'admin', roleLabel: 'Administrateur', email: 'admin@buildtrack.fr', password: 'admin123' },
  { id: 'u2', name: 'Jean Dupont', role: 'conducteur', roleLabel: 'Conducteur de travaux', email: 'j.dupont@buildtrack.fr', password: 'pass123' },
  { id: 'u3', name: 'Marie Martin', role: 'chef_equipe', roleLabel: "Chef d'équipe", email: 'm.martin@buildtrack.fr', password: 'pass123' },
  { id: 'u4', name: 'Pierre Lambert', role: 'observateur', roleLabel: 'Observateur', email: 'p.lambert@buildtrack.fr', password: 'pass123' },
];

const ROLE_PERMISSIONS: Record<UserRole, { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean }> = {
  admin: { canCreate: true, canEdit: true, canDelete: true, canExport: true },
  conducteur: { canCreate: true, canEdit: true, canDelete: false, canExport: true },
  chef_equipe: { canCreate: true, canEdit: true, canDelete: false, canExport: false },
  observateur: { canCreate: false, canEdit: false, canDelete: false, canExport: true },
};

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  permissions: { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean };
  users: User[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('CURRENT_USER').then(raw => {
      if (raw) {
        try { setUser(JSON.parse(raw)); } catch {}
      }
      setIsLoading(false);
    });
  }, []);

  async function login(email: string, password: string) {
    const found = MOCK_USERS.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    if (!found) return { success: false, error: 'Email ou mot de passe incorrect.' };
    setUser(found);
    await AsyncStorage.setItem('CURRENT_USER', JSON.stringify(found));
    return { success: true };
  }

  async function logout() {
    setUser(null);
    await AsyncStorage.removeItem('CURRENT_USER');
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
      users: MOCK_USERS,
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
