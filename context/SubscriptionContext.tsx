import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Organization, Plan, Subscription, Invitation, UserRole, User } from '@/constants/types';

export interface OrgSummary {
  org: Organization;
  planName: string;
  planId: string;
  status: 'trial' | 'active' | 'suspended' | 'expired';
  seatMax: number;
}

const DEMO_PLANS: Plan[] = [
  { id: 'plan-starter', name: 'Starter', maxUsers: 5, priceMonthly: 49, features: ['Gestion des réserves', "Jusqu'à 5 utilisateurs", 'Support email'] },
  { id: 'plan-pro', name: 'Pro', maxUsers: 20, priceMonthly: 149, features: ['Gestion des réserves', 'Rapports PDF/Excel', "Jusqu'à 20 utilisateurs", 'Support prioritaire', 'Pointage & présences'] },
  { id: 'plan-entreprise', name: 'Entreprise', maxUsers: -1, priceMonthly: 399, features: ['Toutes les fonctionnalités', 'Utilisateurs illimités', 'Support dédié', 'API access', 'SSO'] },
];

const DEMO_ORG: Organization = {
  id: 'demo-org',
  name: 'BuildTrack Demo',
  slug: 'buildtrack-demo',
  createdAt: new Date().toISOString(),
};

const DEMO_SUBSCRIPTION: Subscription = {
  id: 'sub-demo',
  organizationId: 'demo-org',
  planId: 'plan-pro',
  status: 'trial',
  startedAt: new Date().toISOString(),
  trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
};

interface SubscriptionContextValue {
  organization: Organization | null;
  plan: Plan | null;
  subscription: Subscription | null;
  orgUsers: User[];
  seatUsed: number;
  seatMax: number;
  canInvite: boolean;
  isLoading: boolean;
  pendingInvitations: Invitation[];
  allOrganizations: Organization[];
  allPlans: Plan[];
  orgSummaries: OrgSummary[];
  inviteUser: (email: string, role: UserRole) => Promise<{ success: boolean; error?: string; token?: string }>;
  cancelInvitation: (id: string) => Promise<void>;
  refreshSubscription: () => void;
  updateOrgPlan: (orgId: string, planId: string) => Promise<{ success: boolean; error?: string }>;
  updateOrgStatus: (orgId: string, status: 'trial' | 'active' | 'suspended' | 'expired') => Promise<{ success: boolean; error?: string }>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, users } = useAuth();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<Invitation[]>([]);
  const [allOrganizations, setAllOrganizations] = useState<Organization[]>([]);
  const [allPlans, setAllPlans] = useState<Plan[]>(DEMO_PLANS);
  const [orgSummaries, setOrgSummaries] = useState<OrgSummary[]>([]);
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
      setPlan(DEMO_PLANS[1]);
      setSubscription(DEMO_SUBSCRIPTION);
      setAllOrganizations([DEMO_ORG]);
      setAllPlans(DEMO_PLANS);
      setOrgSummaries([{ org: DEMO_ORG, planName: 'Pro', planId: 'plan-pro', status: 'trial', seatMax: 20 }]);
      setIsLoading(false);
      return;
    }

    loadSubscriptionData();
  }, [user?.id, refreshKey]);

  async function loadSubscriptionData() {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data: plansData } = await supabase
        .from('plans')
        .select('*')
        .order('price_monthly', { ascending: true });

      if (plansData && plansData.length > 0) {
        setAllPlans(plansData.map((p: any) => ({
          id: p.id,
          name: p.name,
          maxUsers: p.max_users,
          priceMonthly: p.price_monthly,
          features: Array.isArray(p.features) ? p.features : JSON.parse(p.features ?? '[]'),
        })));
      }

      if (user.role === 'super_admin') {
        const { data: orgs } = await supabase
          .from('organizations')
          .select('*')
          .order('created_at', { ascending: false });

        const { data: subs } = await supabase
          .from('subscriptions')
          .select('*, plans(*)');

        if (orgs) {
          const orgList: Organization[] = orgs.map((o: any) => ({
            id: o.id,
            name: o.name,
            slug: o.slug,
            createdAt: o.created_at,
          }));
          setAllOrganizations(orgList);

          const summaries: OrgSummary[] = orgList.map(org => {
            const sub = subs?.find((s: any) => s.organization_id === org.id);
            return {
              org,
              planName: sub?.plans?.name ?? '—',
              planId: sub?.plan_id ?? '',
              status: (sub?.status ?? 'trial') as OrgSummary['status'],
              seatMax: sub?.plans?.max_users ?? 5,
            };
          });
          setOrgSummaries(summaries);
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
        let resolvedStatus: Subscription['status'] = subData.status;
        if (
          resolvedStatus === 'trial' &&
          subData.trial_ends_at &&
          new Date(subData.trial_ends_at) < new Date()
        ) {
          resolvedStatus = 'expired';
          supabase
            .from('subscriptions')
            .update({ status: 'expired' })
            .eq('id', subData.id)
            .then(({ error }) => {
              if (error) console.warn('Erreur mise à jour statut abonnement expiré:', error.message);
            });
        } else if (
          resolvedStatus === 'active' &&
          subData.expires_at &&
          new Date(subData.expires_at) < new Date()
        ) {
          resolvedStatus = 'expired';
          supabase
            .from('subscriptions')
            .update({ status: 'expired' })
            .eq('id', subData.id)
            .then(({ error }) => {
              if (error) console.warn('Erreur mise à jour statut abonnement expiré:', error.message);
            });
        }
        setSubscription({
          id: subData.id,
          organizationId: subData.organization_id,
          planId: subData.plan_id,
          status: resolvedStatus,
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
        // Note: invitations are filtered client-side by expires_at > now() to exclude expired ones.
        // Expired rows keep status='pending' in the DB (no auto-transition to 'expired').
        // A Supabase Edge Function (cron) would be required to automate that transition.
        const { data: invData } = await supabase
          .from('invitations')
          .select('*')
          .eq('organization_id', user.organizationId)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
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

  const orgUsers = organization
    ? users.filter(u => u.organizationId === organization.id)
    : [];

  const seatUsed = orgUsers.length;
  const seatMax = plan?.maxUsers ?? (user?.role === 'super_admin' ? -1 : 5);
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

    const alreadyMember = orgUsers.find(u => u.email.toLowerCase() === emailLower);
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

    const now = new Date();
    const existingInv = pendingInvitations.find(
      i =>
        i.email.toLowerCase() === emailLower &&
        i.status === 'pending' &&
        new Date(i.expiresAt) > now
    );
    if (existingInv) {
      return { success: false, error: 'Une invitation est déjà en attente pour cet email.' };
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

  async function updateOrgPlan(orgId: string, planId: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured) {
      const plan = allPlans.find(p => p.id === planId);
      setOrgSummaries(prev => prev.map(s =>
        s.org.id === orgId
          ? { ...s, planName: plan?.name ?? s.planName, planId, status: 'active' }
          : s
      ));
      return { success: true };
    }
    try {
      const { error } = await supabase
        .from('subscriptions')
        .update({ plan_id: planId, status: 'active' })
        .eq('organization_id', orgId);

      if (error) return { success: false, error: error.message };
      refreshSubscription();
      return { success: true };
    } catch {
      return { success: false, error: 'Erreur réseau.' };
    }
  }

  async function updateOrgStatus(
    orgId: string,
    status: 'trial' | 'active' | 'suspended' | 'expired'
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured) {
      setOrgSummaries(prev => prev.map(s =>
        s.org.id === orgId ? { ...s, status } : s
      ));
      return { success: true };
    }
    try {
      const { error } = await supabase
        .from('subscriptions')
        .update({ status })
        .eq('organization_id', orgId);

      if (error) return { success: false, error: error.message };
      refreshSubscription();
      return { success: true };
    } catch {
      return { success: false, error: 'Erreur réseau.' };
    }
  }

  return (
    <SubscriptionContext.Provider
      value={{
        organization,
        plan,
        subscription,
        orgUsers,
        seatUsed,
        seatMax,
        canInvite,
        isLoading,
        pendingInvitations,
        allOrganizations,
        allPlans,
        orgSummaries,
        inviteUser,
        cancelInvitation,
        refreshSubscription,
        updateOrgPlan,
        updateOrgStatus,
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
