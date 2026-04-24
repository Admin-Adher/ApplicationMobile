import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Organization, Plan, Subscription, Invitation, UserRole, User } from '@/constants/types';
import { sendInvitationEmail } from '@/lib/email/client';

export interface OrgSummary {
  org: Organization;
  planName: string;
  planId: string;
  status: 'trial' | 'active' | 'suspended' | 'expired';
  seatMax: number;
}

export function generateOrgSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const FREE_ROLES: UserRole[] = ['observateur', 'sous_traitant'];

const ENTERPRISE_PLAN: Plan = {
  id: 'plan-entreprise',
  name: 'Entreprise',
  maxUsers: -1,
  priceMonthly: 0,
  features: [
    'Utilisateurs illimités',
    'Sous-traitants & observateurs inclus',
    'Réserves, plans, OPR, visites',
    'Rapports PDF/Excel',
    'Pointage & présences',
    'Support dédié',
    'API & intégrations BTP',
  ],
};

const DEMO_PLANS: Plan[] = [ENTERPRISE_PLAN];

const DEMO_ORG: Organization = {
  id: 'demo-org',
  name: 'Organisation',
  slug: 'organisation-demo',
  createdAt: new Date().toISOString(),
};

const DEMO_SUBSCRIPTION: Subscription = {
  id: 'sub-demo',
  organizationId: 'demo-org',
  planId: 'plan-entreprise',
  status: 'active',
  startedAt: new Date().toISOString(),
};

interface SubscriptionContextValue {
  organization: Organization | null;
  plan: Plan | null;
  subscription: Subscription | null;
  orgUsers: User[];
  activeOrgUsers: User[];
  freeOrgUsers: User[];
  seatUsed: number;
  seatMax: number;
  canInvite: boolean;
  isLoading: boolean;
  pendingInvitations: Invitation[];
  allOrganizations: Organization[];
  allPlans: Plan[];
  orgSummaries: OrgSummary[];
  inviteUser: (email: string, role: UserRole, companyId?: string) => Promise<{ success: boolean; error?: string; token?: string }>;
  cancelInvitation: (id: string) => Promise<void>;
  refreshSubscription: () => void;
  updateOrgPlan: (orgId: string, planId: string) => Promise<{ success: boolean; error?: string }>;
  updateOrgStatus: (orgId: string, status: 'trial' | 'active' | 'suspended' | 'expired') => Promise<{ success: boolean; error?: string }>;
  updateOrganization: (orgId: string, name: string, slug?: string) => Promise<{ success: boolean; error?: string }>;
  createOrganization: (name: string, adminEmail?: string) => Promise<{ success: boolean; error?: string }>;
  deleteOrganization: (orgId: string) => Promise<{ success: boolean; error?: string }>;
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
  const loadGenRef = useRef(0);

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
      setPlan(DEMO_PLANS[0]);
      setSubscription(DEMO_SUBSCRIPTION);
      setAllOrganizations([DEMO_ORG]);
      setAllPlans(DEMO_PLANS);
      setOrgSummaries([{ org: DEMO_ORG, planName: 'Entreprise', planId: 'plan-entreprise', status: 'active', seatMax: -1 }]);
      setIsLoading(false);
      return;
    }

    loadSubscriptionData();
  }, [user?.id, user?.role, refreshKey]);

  async function loadSubscriptionData() {
    if (!user) return;
    const gen = ++loadGenRef.current;
    setIsLoading(true);

    // Soupape de sécurité : si le chargement dépasse 10 s (ex: requête Supabase bloquée
    // à cause d'une récursion RLS), on force isLoading à false pour débloquer l'UI.
    // On vérifie que c'est bien l'appel le plus récent (gen) pour ne pas interférer
    // avec un appel concurrent plus récent.
    let safetyResolved = false;
    const resolveSafety = () => {
      if (!safetyResolved && gen === loadGenRef.current) {
        safetyResolved = true;
        setIsLoading(false);
      }
    };
    const safetyTimer = setTimeout(resolveSafety, 10_000);

    try {
      const { data: plansData } = await (supabase.from('plans') as any)
        .select('*')
        .order('price_monthly', { ascending: true });

      if (gen !== loadGenRef.current) return;
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
        const { data: orgs } = await (supabase.from('organizations') as any)
          .select('*')
          .order('created_at', { ascending: false });

        const { data: subs } = await (supabase.from('subscriptions') as any)
          .select('*, plans(*)');

        if (gen !== loadGenRef.current) return;
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
              // Unlimited seats for all organizations.
              seatMax: -1,
            };
          });
          setOrgSummaries(summaries);
        }
      }

      if (!user.organizationId) {
        setIsLoading(false);
        return;
      }

      const { data: orgData } = await (supabase.from('organizations') as any)
        .select('*')
        .eq('id', user.organizationId)
        .single();

      if (gen !== loadGenRef.current) return;
      if (orgData) {
        setOrganization({
          id: orgData.id,
          name: orgData.name,
          slug: orgData.slug,
          createdAt: orgData.created_at,
        });
      }

      const { data: subData } = await (supabase.from('subscriptions') as any)
        .select('*, plans(*)')
        .eq('organization_id', user.organizationId)
        .single();

      if (gen !== loadGenRef.current) return;
      if (subData) {
        let resolvedStatus: Subscription['status'] = subData.status;
        if (
          resolvedStatus === 'trial' &&
          subData.trial_ends_at &&
          new Date(subData.trial_ends_at) < new Date()
        ) {
          resolvedStatus = 'expired';
          (supabase.from('subscriptions') as any)
            .update({ status: 'expired' })
            .eq('id', subData.id)
            .then(({ error }: { error: any }) => {
              if (error) console.warn('Erreur mise à jour statut abonnement expiré:', error.message);
            });
        } else if (
          resolvedStatus === 'active' &&
          subData.expires_at &&
          new Date(subData.expires_at) < new Date()
        ) {
          resolvedStatus = 'expired';
          (supabase.from('subscriptions') as any)
            .update({ status: 'expired' })
            .eq('id', subData.id)
            .then(({ error }: { error: any }) => {
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
        const { data: invData } = await (supabase.from('invitations') as any)
          .select('*')
          .eq('organization_id', user.organizationId)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false });

        if (gen !== loadGenRef.current) return;
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
              companyId: i.company_id ?? undefined,
            }))
          );
        }
      }
    } catch {
    } finally {
      clearTimeout(safetyTimer);
      safetyResolved = true;
      // Seulement l'appel le plus récent (même gen) met fin au chargement.
      // Un appel obsolète (gen < loadGenRef.current) ne doit pas interrompre
      // le chargement d'un appel plus récent encore en cours.
      if (gen === loadGenRef.current) {
        setIsLoading(false);
      }
    }
  }

  const orgId = organization?.id ?? (user?.role !== 'super_admin' ? user?.organizationId : undefined);
  const orgUsers = user?.role === 'super_admin'
    ? users
    : orgId
      ? users.filter(u => u.organizationId === orgId)
      : [];

  const activeOrgUsers = orgUsers.filter(u => !FREE_ROLES.includes(u.role as UserRole));
  const freeOrgUsers = orgUsers.filter(u => FREE_ROLES.includes(u.role as UserRole));

  const seatUsed = activeOrgUsers.length;
  // All organizations have unlimited seats.
  const seatMax = -1;
  const subscriptionActive = !subscription || subscription.status === 'active' || subscription.status === 'trial';
  const canInvite = subscriptionActive;

  async function inviteUser(
    email: string,
    role: UserRole,
    companyId?: string
  ): Promise<{ success: boolean; error?: string; token?: string }> {
    if (!user) return { success: false, error: 'Non connecté.' };
    const isFreeRole = FREE_ROLES.includes(role);
    if (!isFreeRole) {
      if (!subscriptionActive) {
        return {
          success: false,
          error: "Votre abonnement est suspendu ou expiré. Contactez le support pour réactiver votre compte.",
        };
      }
      if (!canInvite) {
        return {
          success: false,
          error: `Limite de sièges atteinte (${seatMax} utilisateurs actifs). Passez à un plan supérieur.`,
        };
      }
    }

    const emailLower = email.trim().toLowerCase();
    if (!emailLower.includes('@')) {
      return { success: false, error: 'Adresse email invalide.' };
    }

    const alreadyMember = orgUsers.find(u => u.email.toLowerCase() === emailLower);
    if (alreadyMember) {
      return { success: false, error: 'Cet utilisateur fait déjà partie de votre organisation.' };
    }

    if (!user.organizationId && user.role !== 'super_admin') {
      return { success: false, error: "Vous n'êtes pas associé à une organisation." };
    }

    if (!isSupabaseConfigured) {
      const orgId = user.organizationId ?? 'demo-org';
      const mockToken = Math.random().toString(36).substring(2, 18);
      const mockInv: Invitation = {
        id: 'inv-' + Date.now(),
        organizationId: orgId,
        email: emailLower,
        role,
        invitedBy: user.id,
        token: mockToken,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        companyId: companyId ?? undefined,
      };
      setPendingInvitations(prev => [mockInv, ...prev]);
      return { success: true, token: mockToken };
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
      const { data, error } = await (supabase.from('invitations') as any)
        .insert({
          organization_id: user.organizationId,
          email: emailLower,
          role,
          invited_by: user.id,
          ...(companyId ? { company_id: companyId } : {}),
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
        companyId: data.company_id ?? undefined,
      };

      setPendingInvitations(prev => [newInv, ...prev]);

      sendInvitationEmail({
        email: emailLower,
        invitedByName: user.name,
        organizationName: organization?.name ?? 'votre organisation',
        role,
        token: data.token,
        expiresAt: data.expires_at,
      }).catch(() => {});

      return { success: true, token: data.token };
    } catch {
      return { success: false, error: 'Erreur réseau.' };
    }
  }

  async function cancelInvitation(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await (supabase.from('invitations') as any).delete().eq('id', id);
      if (error) {
        Alert.alert('Erreur', "L'invitation n'a pas pu être annulée. Veuillez réessayer.");
        return;
      }
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
      const { error } = await (supabase.from('subscriptions') as any)
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
      const { data, error } = await (supabase.from('subscriptions') as any)
        .update({ status })
        .eq('organization_id', orgId)
        .select('id');

      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Aucune ligne modifiée — vérifiez les droits Supabase (RLS) sur la table subscriptions.' };
      }
      // Mise à jour locale immédiate + synchronisation complète
      setOrgSummaries(prev => prev.map(s =>
        s.org.id === orgId ? { ...s, status } : s
      ));
      refreshSubscription();
      return { success: true };
    } catch {
      return { success: false, error: 'Erreur réseau.' };
    }
  }

  async function updateOrganization(
    orgId: string,
    name: string,
    slug?: string
  ): Promise<{ success: boolean; error?: string }> {
    const trimmed = name.trim();
    if (!trimmed) return { success: false, error: 'Le nom ne peut pas être vide.' };

    const newSlug = slug?.trim() || undefined;

    if (!isSupabaseConfigured) {
      setAllOrganizations(prev => prev.map(o =>
        o.id === orgId ? { ...o, name: trimmed, ...(newSlug ? { slug: newSlug } : {}) } : o
      ));
      setOrgSummaries(prev => prev.map(s =>
        s.org.id === orgId ? { ...s, org: { ...s.org, name: trimmed, ...(newSlug ? { slug: newSlug } : {}) } } : s
      ));
      return { success: true };
    }
    try {
      const patch: Record<string, string> = { name: trimmed };
      if (newSlug) patch.slug = newSlug;

      const { data, error } = await (supabase.from('organizations') as any)
        .update(patch)
        .eq('id', orgId)
        .select('id, slug');

      if (error) {
        if (error.code === '23505') {
          return { success: false, error: 'Cet identifiant est déjà utilisé par une autre organisation. Essayez un nom légèrement différent.' };
        }
        return { success: false, error: error.message };
      }
      if (!data || data.length === 0) {
        return { success: false, error: 'Aucune ligne modifiée — vérifiez les droits Supabase (RLS) sur la table organizations.' };
      }
      const savedSlug: string = (data[0] as any).slug;
      // Mise à jour locale immédiate + synchronisation complète
      setAllOrganizations(prev => prev.map(o =>
        o.id === orgId ? { ...o, name: trimmed, slug: savedSlug } : o
      ));
      setOrgSummaries(prev => prev.map(s =>
        s.org.id === orgId ? { ...s, org: { ...s.org, name: trimmed, slug: savedSlug } } : s
      ));
      refreshSubscription();
      return { success: true };
    } catch {
      return { success: false, error: 'Erreur réseau.' };
    }
  }

  async function createOrganization(
    name: string,
    adminEmail?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!user) return { success: false, error: 'Non connecté.' };

    const slug = name
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + Date.now().toString(36);

    if (!isSupabaseConfigured) {
      const mockOrg: Organization = {
        id: 'org-' + Date.now(),
        name,
        slug,
        createdAt: new Date().toISOString(),
      };
      const enterprisePlan = allPlans.find(p => p.name === 'Entreprise') ?? allPlans[0];
      setAllOrganizations(prev => [mockOrg, ...prev]);
      setOrgSummaries(prev => [{
        org: mockOrg,
        planName: enterprisePlan?.name ?? 'Entreprise',
        planId: enterprisePlan?.id ?? 'plan-entreprise',
        status: 'active',
        seatMax: -1,
      }, ...prev]);
      return { success: true };
    }

    try {
      const { data: org, error: orgErr } = await (supabase.from('organizations') as any)
        .insert({ name, slug })
        .select()
        .single();

      if (orgErr || !org) {
        return { success: false, error: orgErr?.message ?? "Impossible de créer l'organisation." };
      }

      // Update local state immediately so the new org appears in the UI without waiting for refresh.
      const newOrg: Organization = {
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.created_at,
      };
      setAllOrganizations(prev => [newOrg, ...prev]);
      setOrgSummaries(prev => [{
        org: newOrg,
        planName: enterprisePlan?.name ?? 'Entreprise',
        planId: enterprisePlan?.id ?? 'plan-entreprise',
        status: 'active',
        seatMax: -1,
      }, ...prev]);

      const enterprisePlan = allPlans.find(p => p.name === 'Entreprise') ?? allPlans[allPlans.length - 1];
      await (supabase.from('subscriptions') as any).insert({
        organization_id: org.id,
        plan_id: enterprisePlan?.id ?? allPlans[0]?.id,
        status: 'active',
        started_at: new Date().toISOString(),
      });

      await (supabase.from('channels') as any).insert({
        id: `general-${org.id}`,
        name: 'Général',
        type: 'general',
        organization_id: org.id,
        created_by: user.id,
        members: [],
      });

      if (adminEmail) {
        const emailLower = adminEmail.trim().toLowerCase();
        const { data: invData, error: invError } = await (supabase.from('invitations') as any)
          .insert({
            organization_id: org.id,
            email: emailLower,
            role: 'admin',
            invited_by: user.id,
          })
          .select()
          .single();

        if (invError) {
          console.warn('[createOrganization] Invitation insert failed:', invError.message, invError.code);
        }

        if (invData?.token) {
          sendInvitationEmail({
            email: emailLower,
            invitedByName: user.name,
            organizationName: org.name,
            role: 'admin',
            token: invData.token,
            expiresAt: invData.expires_at,
          }).catch((err) => {
            console.warn('[createOrganization] Email send failed:', err?.message ?? err);
          });
        } else {
          console.warn('[createOrganization] No token returned — email not sent. invData:', JSON.stringify(invData));
        }
      }

      refreshSubscription();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Erreur réseau.' };
    }
  }

  async function deleteOrganization(orgId: string): Promise<{ success: boolean; error?: string }> {
    if (!user || user.role !== 'super_admin') {
      return { success: false, error: 'Action réservée au super administrateur.' };
    }

    if (!isSupabaseConfigured) {
      setAllOrganizations(prev => prev.filter(o => o.id !== orgId));
      setOrgSummaries(prev => prev.filter(o => o.org.id !== orgId));
      return { success: true };
    }

    try {
      const extractPath = (uri: string, bucket: string): string | null => {
        const marker = `/storage/v1/object/public/${bucket}/`;
        const idx = uri.indexOf(marker);
        if (idx === -1) return null;
        return decodeURIComponent(uri.slice(idx + marker.length));
      };

      // ── Collect reserve IDs (needed for photo deletion: photos use reserve_id not org_id) ──
      const { data: reservesData } = await (supabase.from('reserves') as any)
        .select('id')
        .eq('organization_id', orgId);
      const reserveIds = (reservesData ?? []).map((r: any) => r.id as string);

      // ── Collect Storage URIs before deletion (best-effort) ──
      const { data: photoData } = reserveIds.length > 0
        ? await (supabase.from('photos') as any).select('uri').in('reserve_id', reserveIds)
        : { data: [] };
      const { data: docData } = await (supabase.from('documents') as any)
        .select('uri')
        .eq('organization_id', orgId);

      // ── Delete in FK order (super_admin RLS allows all deletes) ──
      await (supabase.from('messages') as any).delete().eq('organization_id', orgId);

      if (reserveIds.length > 0) {
        await (supabase.from('photos') as any).delete().in('reserve_id', reserveIds);
      }

      await (supabase.from('time_entries') as any).delete().eq('organization_id', orgId);
      await (supabase.from('tasks') as any).delete().eq('organization_id', orgId);
      await (supabase.from('reserves') as any).delete().eq('organization_id', orgId);
      await (supabase.from('site_plans') as any).delete().eq('organization_id', orgId);
      await (supabase.from('oprs') as any).delete().eq('organization_id', orgId);
      await (supabase.from('lots') as any).delete().eq('organization_id', orgId);
      await (supabase.from('visites') as any).delete().eq('organization_id', orgId);
      await (supabase.from('incidents') as any).delete().eq('organization_id', orgId);
      await (supabase.from('regulatory_docs') as any).delete().eq('organization_id', orgId);
      await (supabase.from('documents') as any).delete().eq('organization_id', orgId);
      await (supabase.from('chantiers') as any).delete().eq('organization_id', orgId);
      await (supabase.from('channels') as any).delete().eq('organization_id', orgId);
      await (supabase.from('companies') as any).delete().eq('organization_id', orgId);
      await (supabase.from('subscriptions') as any).delete().eq('organization_id', orgId);
      await (supabase.from('invitations') as any).delete().eq('organization_id', orgId);
      await (supabase.from('profiles') as any).delete().eq('organization_id', orgId).neq('id', user.id);
      await (supabase.from('organizations') as any).delete().eq('id', orgId);

      // ── Clean up Storage files (best-effort — does not block on failure) ──
      const photoPaths = (photoData ?? [])
        .map((p: any) => extractPath(p.uri ?? '', 'photos'))
        .filter((p: any): p is string => !!p);
      const docPaths = (docData ?? [])
        .map((d: any) => extractPath(d.uri ?? '', 'documents'))
        .filter((p: any): p is string => !!p);

      if (photoPaths.length > 0) {
        await supabase.storage.from('photos').remove(photoPaths).catch(() => {});
      }
      if (docPaths.length > 0) {
        await supabase.storage.from('documents').remove(docPaths).catch(() => {});
      }

      // ── Update local state ──
      setAllOrganizations(prev => prev.filter(o => o.id !== orgId));
      setOrgSummaries(prev => prev.filter(o => o.org.id !== orgId));

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Erreur lors de la suppression.' };
    }
  }

  return (
    <SubscriptionContext.Provider
      value={{
        organization,
        plan,
        subscription,
        orgUsers,
        activeOrgUsers,
        freeOrgUsers,
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
        updateOrganization,
        createOrganization,
        deleteOrganization,
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
