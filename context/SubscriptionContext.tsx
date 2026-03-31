import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Organization, Plan, Subscription, Invitation, UserRole } from '@/constants/types';

const DEMO_PLAN: Plan = {
  id: 'plan-pro-demo',
  name: 'Pro',
  maxUsers: 20,
  priceMonthly: 149,
  features: [
    'Gestion des réserves',
    'Rapports PDF/Excel',
    "Jusqu'à 20 utilisateurs",
    'Support prioritaire',
    'Pointage & présences',
  ],
};

const DEMO_ORG: Organization = {
  id: 'demo-org',
  name: 'BuildTrack Demo',
  slug: 'buildtrack-demo',
  createdAt: new Date().toISOString(),
};

const DEMO_SUBSCRIPTION: Subscription = {
  id: 'sub-demo',
  organizationId: 'demo-org',
  planId: 'plan-pro-demo',
  status: 'trial',
  startedAt: new Date().toISOString(),
  trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
};

interface SubscriptionContextValue {
  organization: Organization | null;
  plan: Plan | null;
  subscription: Subscription | null;
  seatUsed: number;
  seatMax: number;
  canInvite: boolean;
  isLoading: boolean;
  pendingInvitations: Invitation[];
  allOrganizations: Organization[];
  inviteUser: (
    email: string,
    role: UserRole
  ) => Promise<{ success: boolean; error?: string; token?: string }>;
  cancelInvitation: (id: string) => Promise<void>;
  refreshSubscription: () => void;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, users } = useAuth();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<Invitation[]>([]);
  const [allOrganizations, setAllOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  function refreshSubscription() {
    setRefreshKey(k => k + 1);
  }

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    if (!isSupabaseConfigured) {
      setOrganization(DEMO_ORG);
      setPlan(DEMO_PLAN);
      setSubscription(DEMO_SUBSCRIPTION);
      setAllOrganizations([DEMO_ORG]);
      setIsLoading(false);
      return;
    }

    loadSubscriptionData();
  }, [user?.id, refreshKey]);

  async function loadSubscriptionData() {
    if (!user) return;
    setIsLoading(true);
    try {
      if (user.role === 'super_admin') {
        const { data: orgs } = await supabase
          .from('organizations')
          .select('*')
          .order('created_at', { ascending: false });
        if (orgs) {
          setAllOrganizations(
            orgs.map((o: any) => ({
              id: o.id,
              name: o.name,
              slug: o.slug,
              createdAt: o.created_at,
            }))
          );
        }
      }

      if (!user.organizationId) {
        setIsLoading(false);
        return;
      }

      const { data: orgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', user.organizationId)
        .single();

      if (orgData) {
        setOrganization({
          id: orgData.id,
          name: orgData.name,
          slug: orgData.slug,
          createdAt: orgData.created_at,
        });
      }

      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*, plans(*)')
        .eq('organization_id', user.organizationId)
        .single();

      if (subData) {
        setSubscription({
          id: subData.id,
          organizationId: subData.organization_id,
          planId: subData.plan_id,
          status: subData.status,
          startedAt: subData.started_at,
          expiresAt: subData.expires_at ?? undefined,
          trialEndsAt: subData.trial_ends_at ?? undefined,
        });

        if (subData.plans) {
          const p = subData.plans;
          const feats = Array.isArray(p.features) ? p.features : JSON.parse(p.features ?? '[]');
          setPlan({
            id: p.id,
            name: p.name,
            maxUsers: p.max_users,
            priceMonthly: p.price_monthly,
            features: feats,
          });
        }
      }

      if (user.role === 'admin' || user.role === 'super_admin') {
        const { data: invData } = await supabase
          .from('invitations')
          .select('*')
          .eq('organization_id', user.organizationId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (invData) {
          setPendingInvitations(
            invData.map((i: any) => ({
              id: i.id,
              organizationId: i.organization_id,
              email: i.email,
              role: i.role as UserRole,
              invitedBy: i.invited_by,
              token: i.token,
              status: i.status,
              createdAt: i.created_at,
              expiresAt: i.expires_at,
            }))
          );
        }
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  }

  const seatUsed = users.length;
  const seatMax = plan?.maxUsers ?? 20;
  const canInvite = seatMax === -1 || seatUsed < seatMax;

  async function inviteUser(
    email: string,
    role: UserRole
  ): Promise<{ success: boolean; error?: string; token?: string }> {
    if (!user) return { success: false, error: 'Non connecté.' };
    if (!canInvite) {
      return {
        success: false,
        error: `Limite de sièges atteinte (${seatMax} utilisateurs). Passez à un plan supérieur.`,
      };
    }

    const emailLower = email.trim().toLowerCase();
    if (!emailLower.includes('@')) {
      return { success: false, error: 'Adresse email invalide.' };
    }

    const alreadyMember = users.find(u => u.email.toLowerCase() === emailLower);
    if (alreadyMember) {
      return { success: false, error: 'Cet utilisateur fait déjà partie de votre organisation.' };
    }

    if (!isSupabaseConfigured) {
      const mockToken = Math.random().toString(36).substring(2, 18);
      const mockInv: Invitation = {
        id: 'inv-' + Date.now(),
        organizationId: user.organizationId ?? 'demo-org',
        email: emailLower,
        role,
        invitedBy: user.id,
        token: mockToken,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      setPendingInvitations(prev => [mockInv, ...prev]);
      return { success: true, token: mockToken };
    }

    if (!user.organizationId) {
      return { success: false, error: "Vous n'êtes pas associé à une organisation." };
    }

    const existingInv = pendingInvitations.find(
      i => i.email.toLowerCase() === emailLower && i.status === 'pending'
    );
    if (existingInv) {
      return {
        success: false,
        error: 'Une invitation est déjà en attente pour cet email.',
      };
    }

    try {
      const { data, error } = await supabase
        .from('invitations')
        .insert({
          organization_id: user.organizationId,
          email: emailLower,
          role,
          invited_by: user.id,
        })
        .select()
        .single();

      if (error || !data) {
        return { success: false, error: "Impossible de créer l'invitation." };
      }

      const newInv: Invitation = {
        id: data.id,
        organizationId: data.organization_id,
        email: data.email,
        role: data.role as UserRole,
        invitedBy: data.invited_by,
        token: data.token,
        status: data.status,
        createdAt: data.created_at,
        expiresAt: data.expires_at,
      };

      setPendingInvitations(prev => [newInv, ...prev]);
      return { success: true, token: data.token };
    } catch {
      return { success: false, error: 'Erreur réseau.' };
    }
  }

  async function cancelInvitation(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      await supabase.from('invitations').delete().eq('id', id);
    }
    setPendingInvitations(prev => prev.filter(i => i.id !== id));
  }

  return (
    <SubscriptionContext.Provider
      value={{
        organization,
        plan,
        subscription,
        seatUsed,
        seatMax,
        canInvite,
        isLoading,
        pendingInvitations,
        allOrganizations,
        inviteUser,
        cancelInvitation,
        refreshSubscription,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used inside SubscriptionProvider');
  return ctx;
}
