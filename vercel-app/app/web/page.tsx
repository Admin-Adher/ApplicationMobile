'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase-browser';
import styles from './web.module.css';

type Role = 'super_admin' | 'admin' | 'conducteur' | 'chef_equipe' | 'sous_traitant' | 'observateur' | string;

type Profile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  role_label?: string | null;
  organization_id?: string | null;
  company_id?: string | null;
  preferred_language?: 'fr' | 'en' | 'es' | null;
};

type WebState = {
  chantiers: any[];
  reserves: any[];
  sitePlans: any[];
  companies: any[];
  visites: any[];
  messages: any[];
  channels: any[];
  profiles: Profile[];
  lots: any[];
  tasks: any[];
  incidents: any[];
  documents: any[];
  photos: any[];
  oprs: any[];
  notificationPreferences: any[];
};

type ReserveDraft = {
  kind: 'reserve' | 'observation';
  title: string;
  description: string;
  chantierId: string;
  building: string;
  level: string;
  zone: string;
  priority: string;
  status: string;
  deadline: string;
  planId: string;
  lotId: string;
  visiteId: string;
  companies: string[];
};

type VisitDraft = {
  title: string;
  chantierId: string;
  date: string;
  startTime: string;
  endTime: string;
  conducteur: string;
  status: 'planned' | 'in_progress' | 'completed';
  visitType: 'controle' | 'opr' | 'securite' | 'reception' | 'synthese' | 'autre';
  building: string;
  level: string;
  zone: string;
  reserveDeadlineDate: string;
  notes: string;
  companyIds: string[];
};

const EMPTY_DATA: WebState = {
  chantiers: [],
  reserves: [],
  sitePlans: [],
  companies: [],
  visites: [],
  messages: [],
  channels: [],
  profiles: [],
  lots: [],
  tasks: [],
  incidents: [],
  documents: [],
  photos: [],
  oprs: [],
  notificationPreferences: [],
};

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'reserves', label: 'Réserves', icon: '⚠' },
  { id: 'plans', label: 'Plans', icon: '▤' },
  { id: 'visites', label: 'Visites', icon: '☑' },
  { id: 'messages', label: 'Messages', icon: '◌' },
  { id: 'terrain', label: 'Terrain', icon: '⌁' },
  { id: 'equipes', label: 'Équipes', icon: '◎' },
  { id: 'settings', label: 'Réglages', icon: '☰' },
  { id: 'admin', label: 'Admin', icon: '⚙' },
] as const;

type TabId = typeof TABS[number]['id'];

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert',
  in_progress: 'En cours',
  waiting: 'En attente',
  verification: 'Vérification',
  closed: 'Clôturé',
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critique',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS);

const VISIT_TYPE_LABELS: Record<VisitDraft['visitType'], string> = {
  controle: 'Contrôle',
  opr: 'OPR',
  securite: 'Sécurité',
  reception: 'Réception',
  synthese: 'Synthèse',
  autre: 'Autre',
};

const VISIT_STATUS_LABELS: Record<VisitDraft['status'], string> = {
  planned: 'Planifiée',
  in_progress: 'En cours',
  completed: 'Terminée',
};

const VISIT_CHECKLIST_TEMPLATES: Record<VisitDraft['visitType'], string[]> = {
  controle: ['Avancement des travaux', 'Matériaux et stockages', 'Coordination entreprises', 'Réserves précédentes', 'Sécurité et propreté'],
  opr: ['Nettoyage final', 'Essais techniques', 'Finitions', 'Plans d’exécution', 'DOE / documents'],
  securite: ['EPI', 'Signalisation', 'Propreté chantier', 'Installations électriques provisoires', 'Accès et circulations'],
  reception: ['Nettoyage', 'Mise en service', 'Essais fonctionnels', 'Plans d’exécution', 'Notices et DOE'],
  synthese: ['Participants', 'Avancement', 'Points bloquants', 'Planning', 'Questions diverses'],
  autre: ['État constaté', 'Actions à mener', 'Prochaine étape'],
};

function isAdmin(profile: Profile | null) {
  return profile?.role === 'super_admin' || profile?.role === 'admin';
}

function canEdit(profile: Profile | null) {
  return ['super_admin', 'admin', 'conducteur', 'chef_equipe'].includes(String(profile?.role ?? ''));
}

function userLabel(profile: Profile | null, authUser?: SupabaseUser | null) {
  return profile?.name || profile?.email || authUser?.email || 'BuildTrack Web';
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function nowFR() {
  return new Date().toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function prettyDate(value?: string | null, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function sameName(a?: string | null, b?: string | null) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function getChantierId(item: any) {
  return item?.chantier_id ?? item?.chantierId ?? '';
}

function assetUrl(item: any) {
  return item?.uri ?? item?.url ?? item?.file_url ?? item?.public_url ?? item?.signed_url ?? item?.photo_uri ?? '';
}

function reserveCompanies(reserve: any): string[] {
  if (Array.isArray(reserve.companies) && reserve.companies.length) return reserve.companies;
  return reserve.company ? [reserve.company] : [];
}

function makeHistory(action: string, author: string, oldValue?: string, newValue?: string) {
  return {
    id: crypto.randomUUID(),
    action,
    author,
    createdAt: nowFR(),
    ...(oldValue !== undefined ? { oldValue } : {}),
    ...(newValue !== undefined ? { newValue } : {}),
  };
}

function generateReserveId(reserves: any[], lots: any[], lotId?: string) {
  const lot = lots.find(item => item.id === lotId);
  const suffix = () => Math.random().toString(36).slice(2, 5).toUpperCase();
  const existing = new Set(reserves.map(r => String(r.id)));
  const prefix = lot?.code
    ? String(lot.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
    : 'RSV';
  let max = 0;
  for (const reserve of reserves) {
    const match = String(reserve.id).match(new RegExp(`^${prefix}-(\\d+)`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  let next = max + 1;
  let candidate = `${prefix}-${String(next).padStart(3, '0')}-${suffix()}`;
  while (existing.has(candidate)) {
    next += 1;
    candidate = `${prefix}-${String(next).padStart(3, '0')}-${suffix()}`;
  }
  return candidate;
}

function createReserveDraft(projectId: string, plan?: any | null, visit?: any | null): ReserveDraft {
  return {
    kind: 'reserve',
    title: '',
    description: '',
    chantierId: visit?.chantier_id ?? plan?.chantier_id ?? projectId,
    building: visit?.building ?? plan?.building ?? '',
    level: visit?.level ?? plan?.level ?? '',
    zone: visit?.zone ?? '',
    priority: 'medium',
    status: 'open',
    deadline: visit?.reserve_deadline_date ?? '',
    planId: visit?.default_plan_id ?? plan?.id ?? '',
    lotId: '',
    visiteId: visit?.id ?? '',
    companies: [],
  };
}

function reserveToDraft(reserve: any): ReserveDraft {
  return {
    kind: reserve.kind ?? 'reserve',
    title: reserve.title ?? '',
    description: reserve.description ?? '',
    chantierId: reserve.chantier_id ?? '',
    building: reserve.building ?? '',
    level: reserve.level ?? '',
    zone: reserve.zone ?? '',
    priority: reserve.priority ?? 'medium',
    status: reserve.status ?? 'open',
    deadline: reserve.deadline ?? '',
    planId: reserve.plan_id ?? '',
    lotId: reserve.lot_id ?? '',
    visiteId: reserve.visite_id ?? '',
    companies: reserveCompanies(reserve),
  };
}

function createVisitDraft(projectId: string, conducteur: string): VisitDraft {
  return {
    title: '',
    chantierId: projectId,
    date: todayISO(),
    startTime: '08:00',
    endTime: '10:00',
    conducteur,
    status: 'planned',
    visitType: 'controle',
    building: '',
    level: '',
    zone: '',
    reserveDeadlineDate: '',
    notes: '',
    companyIds: [],
  };
}

function channelLabel(channel: any, companies: any[]) {
  if (channel?.type === 'company' && String(channel.id ?? '').startsWith('company-')) {
    const company = companies.find(c => c.id === String(channel.id).replace('company-', ''));
    return company?.name ?? channel.name;
  }
  return channel?.name ?? channel?.id ?? 'Canal';
}

async function fetchScopedTable<T = any>(
  table: string,
  profile: Profile,
  options: { order?: string; ascending?: boolean; limit?: number; scoped?: boolean } = {},
): Promise<T[]> {
  try {
    let query = supabaseBrowser.from(table).select('*');
    if (options.scoped !== false && profile.role !== 'super_admin' && profile.organization_id) {
      query = query.eq('organization_id', profile.organization_id);
    }
    if (options.order) query = query.order(options.order, { ascending: options.ascending ?? false });
    if (options.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error) {
      console.warn(`[web] ${table}`, error.message);
      return [];
    }
    return (data ?? []) as T[];
  } catch (error) {
    console.warn(`[web] ${table}`, error);
    return [];
  }
}

export default function BuildTrackWebPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<WebState>(EMPTY_DATA);
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [selectedReserveId, setSelectedReserveId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [reserveModalMode, setReserveModalMode] = useState<'create' | 'edit' | null>(null);
  const [reserveDraft, setReserveDraft] = useState<ReserveDraft>(() => createReserveDraft(''));
  const [editingReserveId, setEditingReserveId] = useState<string | null>(null);
  const [visitModalOpen, setVisitModalOpen] = useState(false);
  const [visitDraft, setVisitDraft] = useState<VisitDraft>(() => createVisitDraft('', ''));
  const [pinModeReserveId, setPinModeReserveId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    supabaseBrowser.auth.getSession().then(({ data: authData }) => {
      if (!alive) return;
      setSession(authData.session ?? null);
      setAuthUser(authData.session?.user ?? null);
    });
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthUser(nextSession?.user ?? null);
      if (!nextSession) {
        setProfile(null);
        setData(EMPTY_DATA);
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setLoading(false);
      return;
    }
    loadEverything(session.user);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function loadEverything(user: SupabaseUser) {
    setLoading(true);
    setError('');
    try {
      const { data: profileRows, error: profileError } = await supabaseBrowser
        .from('profiles')
        .select('*')
        .or(`id.eq.${user.id},email.eq.${user.email ?? ''}`)
        .limit(1);
      if (profileError) throw profileError;
      const loadedProfile = (profileRows?.[0] ?? null) as Profile | null;
      if (!loadedProfile) {
        setError("Profil introuvable. Vérifiez que l'invitation a bien été acceptée.");
        setLoading(false);
        return;
      }

      setProfile(loadedProfile);
      const [
        chantiers,
        reserves,
        sitePlans,
        companies,
        visites,
        messages,
        channels,
        profiles,
        lots,
        tasks,
        incidents,
        documents,
        photos,
        oprs,
        notificationPreferences,
      ] = await Promise.all([
        fetchScopedTable('chantiers', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('reserves', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('site_plans', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('companies', loadedProfile, { order: 'name', ascending: true }),
        fetchScopedTable('visites', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('messages', loadedProfile, { order: 'created_at', ascending: false, limit: 800 }),
        fetchScopedTable('channels', loadedProfile, { order: 'created_at' }),
        fetchScopedTable<Profile>('profiles', loadedProfile, { order: 'name', ascending: true }),
        fetchScopedTable('lots', loadedProfile, { order: 'name', ascending: true }),
        fetchScopedTable('tasks', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('incidents', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('documents', loadedProfile, { order: 'uploaded_at' }),
        fetchScopedTable('photos', loadedProfile, { order: 'taken_at' }),
        fetchScopedTable('oprs', loadedProfile, { order: 'created_at' }),
        fetchScopedTable('notification_preferences', loadedProfile, { scoped: false }),
      ]);

      const nextData = {
        chantiers,
        reserves,
        sitePlans,
        companies,
        visites,
        messages,
        channels,
        profiles,
        lots,
        tasks,
        incidents,
        documents,
        photos,
        oprs,
        notificationPreferences,
      };
      setData(nextData);
      setSelectedProjectId(prev => prev !== 'all' && chantiers.some((c: any) => c.id === prev) ? prev : chantiers[0]?.id ?? 'all');
      setSelectedReserveId(prev => prev && reserves.some((r: any) => r.id === prev) ? prev : reserves[0]?.id ?? null);
      setSelectedPlanId(prev => prev && sitePlans.some((p: any) => p.id === prev) ? prev : sitePlans[0]?.id ?? null);
      setSelectedChannelId(prev => prev && channels.some((c: any) => c.id === prev) ? prev : channels[0]?.id ?? null);
    } catch (err: any) {
      setError(err?.message ?? 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const { error: loginError } = await supabaseBrowser.auth.signInWithPassword({ email, password });
    if (loginError) setError(loginError.message);
    setSaving(false);
  }

  async function updateReserveStatus(reserveId: string, status: string) {
    if (!canEdit(profile)) return;
    setSaving(true);
    const { error: updateError } = await supabaseBrowser
      .from('reserves')
      .update({ status })
      .eq('id', reserveId);
    if (updateError) setError(updateError.message);
    else setData(prev => ({ ...prev, reserves: prev.reserves.map(r => r.id === reserveId ? { ...r, status } : r) }));
    setSaving(false);
  }

  async function toggleArchive(reserve: any) {
    if (!canEdit(profile)) return;
    setSaving(true);
    const next = reserve.archived_at
      ? { archived_at: null, archived_by: null }
      : { archived_at: new Date().toISOString(), archived_by: profile?.name ?? profile?.email ?? 'Web' };
    const { error: archiveError } = await supabaseBrowser.from('reserves').update(next).eq('id', reserve.id);
    if (archiveError) setError(archiveError.message);
    else setData(prev => ({ ...prev, reserves: prev.reserves.map(r => r.id === reserve.id ? { ...r, ...next } : r) }));
    setSaving(false);
  }

  async function addReserveComment(reserve: any, content: string) {
    if (!profile || !content.trim()) return;
    const nextComment = {
      id: crypto.randomUUID(),
      author: userLabel(profile, authUser),
      content: content.trim(),
      createdAt: nowFR(),
    };
    const comments = [...(reserve.comments ?? []), nextComment];
    const history = [
      ...(reserve.history ?? []),
      makeHistory('Commentaire ajouté depuis le web', userLabel(profile, authUser)),
    ];
    setData(prev => ({
      ...prev,
      reserves: prev.reserves.map(item => item.id === reserve.id ? { ...item, comments, history } : item),
    }));
    const { error: commentError } = await supabaseBrowser
      .from('reserves')
      .update({ comments, history })
      .eq('id', reserve.id);
    if (commentError) setError(commentError.message);
  }

  async function assignReservePin(reserveId: string, planId: string, x: number, y: number) {
    if (!canEdit(profile)) return;
    const payload = {
      plan_id: planId,
      plan_x: Math.max(0, Math.min(1, x)),
      plan_y: Math.max(0, Math.min(1, y)),
    };
    setData(prev => ({
      ...prev,
      reserves: prev.reserves.map(reserve => reserve.id === reserveId ? { ...reserve, ...payload } : reserve),
    }));
    setPinModeReserveId(null);
    const { error: pinError } = await supabaseBrowser
      .from('reserves')
      .update(payload)
      .eq('id', reserveId);
    if (pinError) setError(pinError.message);
  }

  function currentProjectId() {
    return selectedProjectId !== 'all' ? selectedProjectId : data.chantiers[0]?.id ?? '';
  }

  function openReserveCreate(prefill?: { plan?: any; visit?: any }) {
    setError('');
    setEditingReserveId(null);
    setReserveDraft(createReserveDraft(currentProjectId(), prefill?.plan, prefill?.visit));
    setReserveModalMode('create');
  }

  function openReserveEdit(reserve: any) {
    setError('');
    setEditingReserveId(reserve.id);
    setReserveDraft(reserveToDraft(reserve));
    setReserveModalMode('edit');
  }

  function closeReserveModal() {
    setReserveModalMode(null);
    setEditingReserveId(null);
  }

  function openVisitCreate() {
    setError('');
    setVisitDraft(createVisitDraft(currentProjectId(), userLabel(profile, authUser)));
    setVisitModalOpen(true);
  }

  function toggleReserveCompany(companyName: string) {
    setReserveDraft(prev => ({
      ...prev,
      companies: prev.companies.includes(companyName)
        ? prev.companies.filter(name => name !== companyName)
        : [...prev.companies, companyName],
    }));
  }

  function toggleVisitCompany(companyId: string) {
    setVisitDraft(prev => ({
      ...prev,
      companyIds: prev.companyIds.includes(companyId)
        ? prev.companyIds.filter(id => id !== companyId)
        : [...prev.companyIds, companyId],
    }));
  }

  async function syncVisitReserveLink(reserveId: string, nextVisitId?: string | null, previousVisitId?: string | null) {
    const updates: Array<PromiseLike<any>> = [];
    const nextVisites = data.visites.map(visit => {
      if (previousVisitId && visit.id === previousVisitId && previousVisitId !== nextVisitId) {
        const reserveIds = (visit.reserve_ids ?? []).filter((id: string) => id !== reserveId);
        updates.push(supabaseBrowser.from('visites').update({ reserve_ids: reserveIds }).eq('id', visit.id));
        return { ...visit, reserve_ids: reserveIds };
      }
      if (nextVisitId && visit.id === nextVisitId) {
        const reserveIds = Array.from(new Set([...(visit.reserve_ids ?? []), reserveId]));
        updates.push(supabaseBrowser.from('visites').update({ reserve_ids: reserveIds }).eq('id', visit.id));
        return { ...visit, reserve_ids: reserveIds };
      }
      return visit;
    });
    if (updates.length) {
      await Promise.all(updates);
      setData(prev => ({ ...prev, visites: nextVisites }));
    }
  }

  async function submitReserve(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !canEdit(profile)) return;
    const title = reserveDraft.title.trim();
    if (!title) {
      setError('Le titre de la réserve est obligatoire.');
      return;
    }
    setSaving(true);
    setError('');
    const existing = editingReserveId ? data.reserves.find(r => r.id === editingReserveId) : null;
    const companies = reserveDraft.companies;
    const history = [
      ...(existing?.history ?? []),
      reserveModalMode === 'edit'
        ? makeHistory('Modifiée depuis le web', userLabel(profile, authUser))
        : makeHistory(reserveDraft.kind === 'observation' ? 'Observation créée depuis le web' : 'Réserve créée depuis le web', userLabel(profile, authUser)),
    ];
    const basePayload = {
      kind: reserveDraft.kind,
      title,
      description: reserveDraft.description.trim() || title,
      building: reserveDraft.building.trim(),
      zone: reserveDraft.zone.trim(),
      level: reserveDraft.level.trim(),
      company: companies[0] ?? '',
      companies,
      priority: reserveDraft.priority,
      status: reserveDraft.status,
      deadline: reserveDraft.deadline || null,
      comments: existing?.comments ?? [],
      history,
      plan_id: reserveDraft.planId || null,
      lot_id: reserveDraft.lotId || null,
      visite_id: reserveDraft.visiteId || null,
      chantier_id: reserveDraft.chantierId || null,
      organization_id: profile.organization_id ?? null,
      closed_at: reserveDraft.status === 'closed' ? (existing?.closed_at ?? todayISO()) : null,
      closed_by: reserveDraft.status === 'closed' ? userLabel(profile, authUser) : null,
    };

    if (reserveModalMode === 'edit' && editingReserveId) {
      const { data: updated, error: updateError } = await supabaseBrowser
        .from('reserves')
        .update(basePayload)
        .eq('id', editingReserveId)
        .select()
        .single();
      if (updateError) {
        setError(updateError.message);
      } else {
        setData(prev => ({
          ...prev,
          reserves: prev.reserves.map(r => r.id === editingReserveId ? (updated ?? { ...r, ...basePayload }) : r),
        }));
        await syncVisitReserveLink(editingReserveId, reserveDraft.visiteId || null, existing?.visite_id ?? null);
        closeReserveModal();
      }
    } else {
      const id = generateReserveId(data.reserves, data.lots, reserveDraft.lotId);
      const insertPayload = {
        ...basePayload,
        id,
        created_at: todayISO(),
        plan_x: null,
        plan_y: null,
        photo_uri: null,
        photos: null,
        photo_annotations: null,
      };
      const { data: inserted, error: insertError } = await supabaseBrowser
        .from('reserves')
        .insert(insertPayload)
        .select()
        .single();
      if (insertError) {
        setError(insertError.message);
      } else {
        setData(prev => ({ ...prev, reserves: [inserted ?? insertPayload, ...prev.reserves] }));
        await syncVisitReserveLink(id, reserveDraft.visiteId || null, null);
        setSelectedReserveId(id);
        closeReserveModal();
      }
    }
    setSaving(false);
  }

  async function submitVisit(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !canEdit(profile)) return;
    const title = visitDraft.title.trim();
    if (!title) {
      setError('Le titre de la visite est obligatoire.');
      return;
    }
    setSaving(true);
    setError('');
    const id = `VIS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const checklistItems = VISIT_CHECKLIST_TEMPLATES[visitDraft.visitType].map(label => ({
      id: crypto.randomUUID(),
      label,
      checked: false,
    }));
    const payload = {
      id,
      chantier_id: visitDraft.chantierId || null,
      title,
      date: visitDraft.date || todayISO(),
      start_time: visitDraft.startTime || null,
      end_time: visitDraft.endTime || null,
      conducteur: visitDraft.conducteur.trim() || userLabel(profile, authUser),
      status: visitDraft.status,
      visit_type: visitDraft.visitType,
      concerned_company_ids: visitDraft.companyIds.length ? visitDraft.companyIds : null,
      building: visitDraft.building.trim() || null,
      level: visitDraft.level.trim() || null,
      zone: visitDraft.zone.trim() || null,
      notes: visitDraft.notes.trim() || null,
      reserve_deadline_date: visitDraft.reserveDeadlineDate || null,
      checklist_items: checklistItems,
      reserve_ids: [],
      participants: null,
      created_at: new Date().toISOString(),
      organization_id: profile.organization_id ?? null,
    };
    const { data: inserted, error: insertError } = await supabaseBrowser
      .from('visites')
      .insert(payload)
      .select()
      .single();
    if (insertError) {
      setError(insertError.message);
    } else {
      setData(prev => ({ ...prev, visites: [inserted ?? payload, ...prev.visites] }));
      setVisitModalOpen(false);
      setActiveTab('visites');
    }
    setSaving(false);
  }

  async function updateCompanyField(companyId: string, field: 'planned_workers' | 'actual_workers' | 'hours_worked', value: number) {
    if (!canEdit(profile)) return;
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    setData(prev => ({
      ...prev,
      companies: prev.companies.map(company => company.id === companyId ? { ...company, [field]: safeValue } : company),
    }));
    const { error: companyError } = await supabaseBrowser
      .from('companies')
      .update({ [field]: safeValue })
      .eq('id', companyId);
    if (companyError) setError(companyError.message);
  }

  async function updateNotificationField(field: string, value: boolean | string) {
    if (!authUser || !profile) return;
    const existing = data.notificationPreferences.find(row => row.user_id === authUser.id);
    const payload = {
      ...(existing ?? {}),
      user_id: authUser.id,
      organization_id: profile.organization_id ?? null,
      [field]: value,
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error: prefError } = await supabaseBrowser
      .from('notification_preferences')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();
    if (prefError) {
      setError(prefError.message);
      return;
    }
    setData(prev => ({
      ...prev,
      notificationPreferences: existing
        ? prev.notificationPreferences.map(row => row.user_id === authUser.id ? (saved ?? payload) : row)
        : [saved ?? payload, ...prev.notificationPreferences],
    }));
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedChannelId || !messageDraft.trim() || !profile) return;
    setSaving(true);
    const payload = {
      id: crypto.randomUUID(),
      channel_id: selectedChannelId,
      sender: profile.name || profile.email,
      content: messageDraft.trim(),
      timestamp: new Date().toLocaleString('fr-FR'),
      type: 'message',
      read: true,
      read_by: [profile.name || profile.email],
      reactions: {},
      is_pinned: false,
      mentions: [],
      organization_id: profile.organization_id ?? null,
    };
    const { data: inserted, error: messageError } = await supabaseBrowser
      .from('messages')
      .insert(payload)
      .select()
      .single();
    if (messageError) setError(messageError.message);
    else {
      setMessageDraft('');
      setData(prev => ({ ...prev, messages: [inserted, ...prev.messages] }));
    }
    setSaving(false);
  }

  const projectScoped = useMemo(() => {
    const byProject = (item: any) => selectedProjectId === 'all' || item.chantier_id === selectedProjectId || item.chantierId === selectedProjectId;
    return {
      reserves: data.reserves.filter(byProject),
      plans: data.sitePlans.filter(byProject),
      visites: data.visites.filter(byProject),
      tasks: data.tasks.filter(byProject),
      incidents: data.incidents.filter(byProject),
      documents: data.documents.filter(byProject),
      photos: data.photos.filter(byProject),
      oprs: data.oprs.filter(byProject),
    };
  }, [data, selectedProjectId]);

  const filteredReserves = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projectScoped.reserves.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        r.title,
        r.description,
        r.building,
        r.level,
        r.zone,
        ...(reserveCompanies(r)),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [projectScoped.reserves, search, statusFilter]);

  const selectedReserve = data.reserves.find(r => r.id === selectedReserveId) ?? filteredReserves[0] ?? null;
  const selectedPlan = data.sitePlans.find(p => p.id === selectedPlanId) ?? projectScoped.plans[0] ?? null;
  const selectedChannel = data.channels.find(c => c.id === selectedChannelId) ?? data.channels[0] ?? null;
  const selectedChannelMessages = selectedChannel
    ? data.messages
        .filter(m => m.channel_id === selectedChannel.id)
        .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
    : [];

  const stats = useMemo(() => {
    const reserves = projectScoped.reserves;
    const active = reserves.filter(r => !r.archived_at);
    const overdue = active.filter(r => r.deadline && new Date(r.deadline) < new Date() && !['closed', 'verification'].includes(r.status));
    const closed = active.filter(r => r.status === 'closed');
    const ackMissing = active.filter(r => reserveCompanies(r).length > 0 && !r.enterprise_acknowledged_at).length;
    return {
      total: active.length,
      closed: closed.length,
      open: active.filter(r => r.status === 'open').length,
      overdue: overdue.length,
      progress: active.length ? Math.round((closed.length / active.length) * 100) : 0,
      ackMissing,
    };
  }, [projectScoped.reserves]);

  if (!session || !authUser) {
    return (
      <main className={styles.loginPage}>
        <section className={styles.loginPanel}>
          <div className={styles.brandMark}>B</div>
          <p className={styles.eyebrow}>BuildTrack Web</p>
          <h1>Connectez-vous au cockpit chantier</h1>
          <p className={styles.muted}>Même base Supabase, mêmes rôles, mêmes réserves que l’application mobile.</p>
          <form className={styles.loginForm} onSubmit={handleLogin}>
            <label>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required />
            <label>Mot de passe</label>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
            {error ? <p className={styles.error}>{error}</p> : null}
            <button disabled={saving}>{saving ? 'Connexion...' : 'Se connecter'}</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <span className={styles.brandMarkSmall}>B</span>
          <div>
            <strong>BuildTrack</strong>
            <span>Web</span>
          </div>
        </div>
        <nav className={styles.navList}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? styles.navActive : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.icon}</span>{tab.label}
            </button>
          ))}
        </nav>
        <div className={styles.userBox}>
          <strong>{profile?.name ?? authUser.email}</strong>
          <span>{profile?.role_label ?? profile?.role ?? 'Utilisateur'}</span>
          <button onClick={() => supabaseBrowser.auth.signOut()}>Déconnexion</button>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Cockpit web</p>
            <h1>{TABS.find(t => t.id === activeTab)?.label}</h1>
          </div>
          <div className={styles.topbarActions}>
            <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}>
              <option value="all">Tous les chantiers</option>
              {data.chantiers.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            {canEdit(profile) && (
              <>
                <button type="button" onClick={() => openReserveCreate()}>Nouvelle réserve</button>
                <button type="button" onClick={openVisitCreate}>Nouvelle visite</button>
              </>
            )}
            <button onClick={() => session.user && loadEverything(session.user)} disabled={loading}>
              {loading ? 'Synchronisation...' : 'Synchroniser'}
            </button>
          </div>
        </header>

        {error ? <div className={styles.alert}>{error}</div> : null}

        {loading ? (
          <div className={styles.loadingBlock}>Chargement des données BuildTrack...</div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <Dashboard stats={stats} data={data} scoped={projectScoped} setTab={setActiveTab} />
            )}
            {activeTab === 'reserves' && (
              <ReservesView
                reserves={filteredReserves}
                selectedReserve={selectedReserve}
                setSelectedReserveId={setSelectedReserveId}
                search={search}
                setSearch={setSearch}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                onStatus={updateReserveStatus}
                onArchive={toggleArchive}
                onComment={addReserveComment}
                onCreate={() => openReserveCreate()}
                onEdit={openReserveEdit}
                editable={canEdit(profile)}
                saving={saving}
              />
            )}
            {activeTab === 'plans' && (
              <PlansView
                plans={projectScoped.plans}
                reserves={projectScoped.reserves}
                selectedPlan={selectedPlan}
                setSelectedPlanId={setSelectedPlanId}
                setSelectedReserveId={setSelectedReserveId}
                setTab={setActiveTab}
                onCreateReserve={(plan: any) => openReserveCreate({ plan })}
                onAssignPin={assignReservePin}
                pinModeReserveId={pinModeReserveId}
                setPinModeReserveId={setPinModeReserveId}
                editable={canEdit(profile)}
              />
            )}
            {activeTab === 'visites' && (
              <VisitesView
                visites={projectScoped.visites}
                reserves={projectScoped.reserves}
                companies={data.companies}
                onCreateVisit={openVisitCreate}
                onCreateReserveFromVisit={(visit: any) => openReserveCreate({ visit })}
              />
            )}
            {activeTab === 'messages' && (
              <MessagesView
                channels={data.channels}
                companies={data.companies}
                selectedChannel={selectedChannel}
                setSelectedChannelId={setSelectedChannelId}
                messages={selectedChannelMessages}
                draft={messageDraft}
                setDraft={setMessageDraft}
                onSend={sendMessage}
                saving={saving}
              />
            )}
            {activeTab === 'terrain' && (
              <TerrainView scoped={projectScoped} data={data} />
            )}
            {activeTab === 'equipes' && (
              <EquipesView
                companies={data.companies}
                reserves={projectScoped.reserves}
                tasks={projectScoped.tasks}
                editable={canEdit(profile)}
                onUpdateCompanyField={updateCompanyField}
              />
            )}
            {activeTab === 'settings' && (
              <SettingsView
                profile={profile}
                authUser={authUser}
                preferences={data.notificationPreferences}
                onUpdateNotificationField={updateNotificationField}
              />
            )}
            {activeTab === 'admin' && (
              <AdminView data={data} profile={profile} />
            )}
          </>
        )}
      </section>
      {reserveModalMode && (
        <ReserveModal
          mode={reserveModalMode}
          draft={reserveDraft}
          setDraft={setReserveDraft}
          data={data}
          selectedProjectId={selectedProjectId}
          saving={saving}
          onClose={closeReserveModal}
          onSubmit={submitReserve}
          onToggleCompany={toggleReserveCompany}
        />
      )}
      {visitModalOpen && (
        <VisitModal
          draft={visitDraft}
          setDraft={setVisitDraft}
          data={data}
          selectedProjectId={selectedProjectId}
          saving={saving}
          onClose={() => setVisitModalOpen(false)}
          onSubmit={submitVisit}
          onToggleCompany={toggleVisitCompany}
        />
      )}
    </main>
  );
}

function Dashboard({ stats, data, scoped, setTab }: any) {
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Réserves actives" value={stats.total} hint={`${stats.open} ouvertes`} />
        <Kpi title="Avancement" value={`${stats.progress}%`} hint={`${stats.closed} levées`} tone="green" />
        <Kpi title="En retard" value={stats.overdue} hint="Échéance dépassée" tone="red" />
        <Kpi title="AR manquants" value={stats.ackMissing} hint="Sous-traitants à relancer" tone="amber" />
      </div>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Vue d’ensemble</h2>
            <p>Supervision web de toutes les données déjà présentes dans l’application mobile.</p>
          </div>
        </div>
        <div className={styles.quickGrid}>
          <Quick label="Plans" value={scoped.plans.length} onClick={() => setTab('plans')} />
          <Quick label="Visites" value={scoped.visites.length} onClick={() => setTab('visites')} />
          <Quick label="Messages récents" value={data.messages.length} onClick={() => setTab('messages')} />
          <Quick label="Documents" value={scoped.documents.length} onClick={() => setTab('terrain')} />
        </div>
      </section>
    </div>
  );
}

function Kpi({ title, value, hint, tone = 'blue' }: { title: string; value: string | number; hint: string; tone?: string }) {
  return (
    <div className={`${styles.kpi} ${styles[`tone_${tone}`] ?? ''}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function Quick({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button className={styles.quick} onClick={onClick}>
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  );
}

function ReservesView(props: {
  reserves: any[];
  selectedReserve: any;
  setSelectedReserveId: (id: string) => void;
  search: string;
  setSearch: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  onStatus: (id: string, status: string) => void;
  onArchive: (reserve: any) => void;
  onComment: (reserve: any, content: string) => Promise<void> | void;
  onCreate: () => void;
  onEdit: (reserve: any) => void;
  editable: boolean;
  saving: boolean;
}) {
  const { reserves, selectedReserve } = props;
  const [commentText, setCommentText] = useState('');
  return (
    <div className={styles.twoCols}>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <h2>Réserves</h2>
          {props.editable && <button type="button" onClick={props.onCreate}>Créer</button>}
        </div>
        <div className={styles.toolbar}>
          <input placeholder="Titre, bâtiment, entreprise..." value={props.search} onChange={e => props.setSearch(e.target.value)} />
          <select value={props.statusFilter} onChange={e => props.setStatusFilter(e.target.value)}>
            <option value="all">Tous statuts</option>
            {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className={styles.list}>
          {reserves.map(reserve => (
            <button
              key={reserve.id}
              className={`${styles.listRow} ${selectedReserve?.id === reserve.id ? styles.selectedRow : ''}`}
              onClick={() => props.setSelectedReserveId(reserve.id)}
            >
              <span className={`${styles.dot} ${styles[`priority_${reserve.priority}`] ?? ''}`} />
              <div>
                <strong>{reserve.title}</strong>
                <small>{[reserve.building, reserve.level, reserve.zone].filter(Boolean).join(' · ') || 'Sans localisation'}</small>
              </div>
              <em>{STATUS_LABELS[reserve.status] ?? reserve.status}</em>
            </button>
          ))}
          {!reserves.length && <p className={styles.empty}>Aucune réserve avec ces filtres.</p>}
        </div>
      </section>

      <section className={styles.panel}>
        {selectedReserve ? (
          <div className={styles.detail}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.eyebrow}>{selectedReserve.id}</p>
                <h2>{selectedReserve.title}</h2>
              </div>
              <span className={styles.badge}>{PRIORITY_LABELS[selectedReserve.priority] ?? selectedReserve.priority}</span>
            </div>
            <p className={styles.description}>{selectedReserve.description || 'Aucune description.'}</p>
            <dl className={styles.metaGrid}>
              <div><dt>Statut</dt><dd>{STATUS_LABELS[selectedReserve.status] ?? selectedReserve.status}</dd></div>
              <div><dt>Entreprise</dt><dd>{reserveCompanies(selectedReserve).join(', ') || '—'}</dd></div>
              <div><dt>Échéance</dt><dd>{prettyDate(selectedReserve.deadline)}</dd></div>
              <div><dt>Plan</dt><dd>{selectedReserve.plan_id ? 'Épinglée' : 'Non épinglée'}</dd></div>
              <div><dt>Accusé réception</dt><dd>{selectedReserve.enterprise_acknowledged_at ? prettyDate(selectedReserve.enterprise_acknowledged_at, true) : 'Manquant'}</dd></div>
              <div><dt>Archive</dt><dd>{selectedReserve.archived_at ? prettyDate(selectedReserve.archived_at, true) : 'Active'}</dd></div>
            </dl>
            <form
              className={styles.commentForm}
              onSubmit={async event => {
                event.preventDefault();
                if (!commentText.trim()) return;
                await props.onComment(selectedReserve, commentText);
                setCommentText('');
              }}
            >
              <input
                value={commentText}
                onChange={event => setCommentText(event.target.value)}
                placeholder="Ajouter un commentaire de suivi..."
              />
              <button type="submit" disabled={props.saving || !commentText.trim()}>Ajouter</button>
            </form>
            {props.editable && (
              <div className={styles.actionBar}>
                <button type="button" onClick={() => props.onEdit(selectedReserve)}>Modifier</button>
                {STATUS_OPTIONS.map(([value, label]) => (
                  <button key={value} disabled={props.saving || selectedReserve.status === value} onClick={() => props.onStatus(selectedReserve.id, value)}>
                    {label}
                  </button>
                ))}
                <button onClick={() => props.onArchive(selectedReserve)}>{selectedReserve.archived_at ? 'Désarchiver' : 'Archiver'}</button>
              </div>
            )}
            <HistoryBlock title="Commentaires" rows={selectedReserve.comments ?? []} />
            <HistoryBlock title="Historique" rows={selectedReserve.history ?? []} />
          </div>
        ) : (
          <p className={styles.empty}>Sélectionnez une réserve.</p>
        )}
      </section>
    </div>
  );
}

function HistoryBlock({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className={styles.historyBlock}>
      <h3>{title}</h3>
      {rows?.length ? rows.slice(-6).map((row, idx) => (
        <div key={row.id ?? idx} className={styles.timelineItem}>
          <strong>{row.author ?? row.action ?? 'Action'}</strong>
          <span>{row.content ?? row.newValue ?? row.createdAt ?? ''}</span>
        </div>
      )) : <small>Aucun élément.</small>}
    </div>
  );
}

function PlansView({
  plans,
  reserves,
  selectedPlan,
  setSelectedPlanId,
  setSelectedReserveId,
  setTab,
  onCreateReserve,
  onAssignPin,
  pinModeReserveId,
  setPinModeReserveId,
  editable,
}: any) {
  const planReserves = selectedPlan ? reserves.filter((r: any) => r.plan_id === selectedPlan.id) : [];
  const pinTarget = reserves.find((reserve: any) => reserve.id === pinModeReserveId);
  return (
    <div className={styles.twoCols}>
      <section className={styles.panel}>
        <div className={styles.list}>
          {plans.map((plan: any) => (
            <button key={plan.id} className={`${styles.listRow} ${selectedPlan?.id === plan.id ? styles.selectedRow : ''}`} onClick={() => setSelectedPlanId(plan.id)}>
              <span>▤</span>
              <div>
                <strong>{plan.name}</strong>
                <small>{[plan.building, plan.level, plan.revision_code].filter(Boolean).join(' · ') || 'Plan'}</small>
              </div>
              <em>{reserves.filter((r: any) => r.plan_id === plan.id).length}</em>
            </button>
          ))}
          {!plans.length && <p className={styles.empty}>Aucun plan dans ce périmètre.</p>}
        </div>
      </section>
      <section className={styles.panel}>
        {selectedPlan ? (
          <>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.eyebrow}>{selectedPlan.file_type ?? 'plan'}</p>
                <h2>{selectedPlan.name}</h2>
              </div>
              <div className={styles.inlineActions}>
                <button type="button" onClick={() => onCreateReserve(selectedPlan)}>Créer une réserve</button>
                {selectedPlan.uri ? <a className={styles.linkButton} href={selectedPlan.uri} target="_blank">Ouvrir le fichier</a> : null}
              </div>
            </div>
            {editable && (
              <div className={styles.pinToolbar}>
                <div>
                  <strong>Positionner une épingle</strong>
                  <span>{pinTarget ? `Cliquez sur le plan pour placer : ${pinTarget.title}` : 'Choisissez une réserve, puis cliquez directement sur le plan.'}</span>
                </div>
                <select value={pinModeReserveId ?? ''} onChange={event => setPinModeReserveId(event.target.value || null)}>
                  <option value="">Choisir une réserve</option>
                  {reserves.filter((reserve: any) => !reserve.archived_at).map((reserve: any) => (
                    <option key={reserve.id} value={reserve.id}>{reserve.id} · {reserve.title}</option>
                  ))}
                </select>
                {pinModeReserveId && <button type="button" onClick={() => setPinModeReserveId(null)}>Annuler</button>}
              </div>
            )}
            <div className={styles.planCanvas}>
              {selectedPlan.uri && selectedPlan.file_type === 'image' ? (
                <img src={selectedPlan.uri} alt={selectedPlan.name} />
              ) : selectedPlan.uri && selectedPlan.file_type === 'pdf' ? (
                <iframe src={selectedPlan.uri} title={selectedPlan.name} />
              ) : (
                <div className={styles.planPlaceholder}>Aperçu web disponible dès que le fichier est accessible.</div>
              )}
              {pinModeReserveId && (
                <button
                  type="button"
                  className={styles.pinClickLayer}
                  onClick={event => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    onAssignPin(
                      pinModeReserveId,
                      selectedPlan.id,
                      (event.clientX - rect.left) / rect.width,
                      (event.clientY - rect.top) / rect.height,
                    );
                  }}
                >
                  <span>Cliquer pour placer l’épingle</span>
                </button>
              )}
              {planReserves.filter((r: any) => r.plan_x != null && r.plan_y != null).map((reserve: any, idx: number) => (
                <button
                  key={reserve.id}
                  className={styles.pin}
                  style={{ left: `${Math.max(2, Math.min(98, Number(reserve.plan_x) * 100))}%`, top: `${Math.max(2, Math.min(98, Number(reserve.plan_y) * 100))}%` }}
                  title={reserve.title}
                  onClick={event => {
                    event.stopPropagation();
                    setSelectedReserveId(reserve.id);
                    setTab('reserves');
                  }}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <h3>Réserves sur ce plan</h3>
            <div className={styles.compactList}>
              {planReserves.map((reserve: any) => (
                <button key={reserve.id} onClick={() => { setSelectedReserveId(reserve.id); setTab('reserves'); }}>
                  <span>{STATUS_LABELS[reserve.status] ?? reserve.status}</span>
                  <strong>{reserve.title}</strong>
                </button>
              ))}
            </div>
          </>
        ) : <p className={styles.empty}>Sélectionnez un plan.</p>}
      </section>
    </div>
  );
}

function VisitesView({ visites, reserves, companies, onCreateVisit, onCreateReserveFromVisit }: any) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeaderCompact}>
        <div>
          <h2>Visites</h2>
          <p>Préparez les visites et rattachez des réserves après coup.</p>
        </div>
        <button type="button" onClick={onCreateVisit}>Nouvelle visite</button>
      </div>
      <div className={styles.dataTable}>
        <div className={`${styles.tableHead} ${styles.visitTableHead}`}><span>Visite</span><span>Date</span><span>Périmètre</span><span>Réserves</span><span>Entreprises</span><span>Action</span></div>
        {visites.map((visit: any) => {
          const visitReserves = reserves.filter((r: any) => r.visite_id === visit.id || (visit.reserve_ids ?? []).includes(r.id));
          const companyNames = (visit.concerned_company_ids ?? [])
            .map((id: string) => companies.find((c: any) => c.id === id)?.name)
            .filter(Boolean);
          return (
            <div key={visit.id} className={`${styles.tableRow} ${styles.visitTableRow}`}>
              <strong>{visit.title}</strong>
              <span>{prettyDate(visit.date)}</span>
              <span>{[visit.building, visit.level, visit.zone].filter(Boolean).join(' · ') || 'Multi-bâtiments'}</span>
              <span>{visitReserves.length}</span>
              <span>{companyNames.join(', ') || '—'}</span>
              <button type="button" className={styles.tableActionBtn} onClick={() => onCreateReserveFromVisit(visit)}>Ajouter réserve</button>
            </div>
          );
        })}
      </div>
      {!visites.length && <p className={styles.empty}>Aucune visite dans ce périmètre.</p>}
    </section>
  );
}

function MessagesView({ channels, companies, selectedChannel, setSelectedChannelId, messages, draft, setDraft, onSend, saving }: any) {
  return (
    <div className={styles.twoCols}>
      <section className={styles.panel}>
        <div className={styles.list}>
          {channels.map((channel: any) => (
            <button key={channel.id} className={`${styles.listRow} ${selectedChannel?.id === channel.id ? styles.selectedRow : ''}`} onClick={() => setSelectedChannelId(channel.id)}>
              <span>◌</span>
              <div>
                <strong>{channelLabel(channel, companies)}</strong>
                <small>{channel.type ?? 'canal'}</small>
              </div>
            </button>
          ))}
          {!channels.length && <p className={styles.empty}>Aucun canal chargé.</p>}
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{selectedChannel?.type ?? 'canal'}</p>
            <h2>{selectedChannel ? channelLabel(selectedChannel, companies) : 'Messages'}</h2>
          </div>
        </div>
        <div className={styles.messageList}>
          {messages.map((message: any) => (
            <div key={message.id} className={styles.messageBubble}>
              <strong>{message.sender}</strong>
              <p>{message.content}</p>
              <small>{prettyDate(message.created_at, true)}</small>
            </div>
          ))}
          {!messages.length && <p className={styles.empty}>Aucun message dans ce canal.</p>}
        </div>
        <form className={styles.messageForm} onSubmit={onSend}>
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Écrire un message..." />
          <button disabled={saving || !draft.trim()}>Envoyer</button>
        </form>
      </section>
    </div>
  );
}

function TerrainView({ scoped, data }: any) {
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Incidents" value={scoped.incidents.length} hint="Sécurité / terrain" tone="red" />
        <Kpi title="Tâches" value={scoped.tasks.length} hint="Actions chantier" />
        <Kpi title="Photos" value={scoped.photos.length} hint="Médias terrain" tone="green" />
        <Kpi title="Documents" value={scoped.documents.length} hint="GED chantier" tone="amber" />
      </div>
      <section className={styles.panel}>
        <div className={styles.threeCols}>
          <SimpleColumn title="Incidents" rows={scoped.incidents} primary="title" secondary="status" />
          <SimpleColumn title="Tâches" rows={scoped.tasks} primary="title" secondary="deadline" />
          <SimpleColumn title="OPR" rows={scoped.oprs} primary="title" secondary="status" />
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Photos et documents</h2>
            <p>Accès web rapide aux médias terrain et pièces GED déjà synchronisés.</p>
          </div>
        </div>
        <div className={styles.mediaGrid}>
          {scoped.photos.slice(0, 12).map((photo: any) => {
            const url = assetUrl(photo);
            return (
              <a
                key={photo.id ?? url}
                className={styles.mediaCard}
                href={url || undefined}
                target={url ? '_blank' : undefined}
                aria-disabled={!url}
              >
                {url ? <img src={url} alt={photo.title ?? photo.name ?? 'Photo chantier'} /> : <span>Photo</span>}
                <strong>{photo.title ?? photo.name ?? 'Photo chantier'}</strong>
                <small>{prettyDate(photo.taken_at ?? photo.created_at, true)}</small>
              </a>
            );
          })}
          {scoped.documents.slice(0, 12).map((document: any) => {
            const url = assetUrl(document);
            return (
              <a
                key={document.id ?? url}
                className={styles.mediaCard}
                href={url || undefined}
                target={url ? '_blank' : undefined}
                aria-disabled={!url}
              >
                <span>{String(document.file_type ?? document.type ?? 'DOC').slice(0, 4).toUpperCase()}</span>
                <strong>{document.title ?? document.name ?? document.file_name ?? 'Document'}</strong>
                <small>{prettyDate(document.uploaded_at ?? document.created_at, true)}</small>
              </a>
            );
          })}
          {!scoped.photos.length && !scoped.documents.length && <p className={styles.empty}>Aucun média terrain dans ce périmètre.</p>}
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Lots et entreprises</h2>
        <div className={styles.compactList}>
          {data.lots.slice(0, 40).map((lot: any) => (
            <button key={lot.id}><span>{lot.code}</span><strong>{lot.name}</strong></button>
          ))}
        </div>
      </section>
    </div>
  );
}

function EquipesView({ companies, reserves, tasks, editable, onUpdateCompanyField }: any) {
  const totalActual = companies.reduce((sum: number, company: any) => sum + Number(company.actual_workers ?? 0), 0);
  const totalPlanned = companies.reduce((sum: number, company: any) => sum + Number(company.planned_workers ?? 0), 0);
  const presence = totalPlanned ? Math.round((totalActual / totalPlanned) * 100) : 0;

  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Présents" value={totalActual} hint={`${totalPlanned} planifiés`} />
        <Kpi title="Présence" value={`${presence}%`} hint="Pointage global" tone="green" />
        <Kpi title="Entreprises" value={companies.length} hint="Sous-traitants" tone="amber" />
        <Kpi title="Actions actives" value={tasks.filter((task: any) => task.status !== 'done').length} hint="Tâches non terminées" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Équipes chantier</h2>
            <p>Pointage rapide, contacts et réserves ouvertes par entreprise.</p>
          </div>
        </div>
        <div className={styles.companyGrid}>
          {companies.map((company: any) => {
            const names = [company.name, company.short_name, company.shortName].filter(Boolean);
            const openReserves = reserves.filter((reserve: any) => {
              const reserveNames = reserveCompanies(reserve);
              return reserve.status !== 'closed' && reserveNames.some(name => names.some(companyName => sameName(companyName, name)));
            }).length;
            return (
              <article className={styles.companyCard} key={company.id}>
                <div className={styles.companyTop}>
                  <span className={styles.companyColor} style={{ backgroundColor: company.color ?? '#3b82f6' }} />
                  <div>
                    <strong>{company.name}</strong>
                    <small>{company.short_name ?? company.shortName ?? company.zone ?? 'Entreprise'}</small>
                  </div>
                </div>
                <div className={styles.companyStats}>
                  <label>
                    <span>Présents</span>
                    <input
                      type="number"
                      min={0}
                      value={company.actual_workers ?? 0}
                      disabled={!editable}
                      onChange={event => onUpdateCompanyField(company.id, 'actual_workers', Number(event.target.value))}
                    />
                  </label>
                  <label>
                    <span>Planifiés</span>
                    <input
                      type="number"
                      min={0}
                      value={company.planned_workers ?? 0}
                      disabled={!editable}
                      onChange={event => onUpdateCompanyField(company.id, 'planned_workers', Number(event.target.value))}
                    />
                  </label>
                </div>
                <div className={styles.companyFooter}>
                  <span>{openReserves} réserves ouvertes</span>
                  {company.email ? <a href={`mailto:${company.email}`}>Email</a> : null}
                  {company.contact ? <a href={`tel:${company.contact}`}>Appeler</a> : null}
                </div>
              </article>
            );
          })}
        </div>
        {!companies.length && <p className={styles.empty}>Aucune entreprise chargée.</p>}
      </section>
    </div>
  );
}

function prefValue(preferences: any[], authUser: SupabaseUser | null, field: string, fallback = true) {
  const row = preferences.find(item => item.user_id === authUser?.id);
  return row?.[field] ?? fallback;
}

function SettingsView({ profile, authUser, preferences, onUpdateNotificationField }: {
  profile: Profile | null;
  authUser: SupabaseUser | null;
  preferences: any[];
  onUpdateNotificationField: (field: string, value: boolean | string) => void;
}) {
  return (
    <div className={styles.twoCols}>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Compte</p>
            <h2>{profile?.name ?? authUser?.email}</h2>
            <p>{profile?.role_label ?? profile?.role} · {profile?.email ?? authUser?.email}</p>
          </div>
        </div>
        <dl className={styles.metaGrid}>
          <div><dt>ID utilisateur</dt><dd>{profile?.id ?? authUser?.id}</dd></div>
          <div><dt>Organisation</dt><dd>{profile?.organization_id ?? '—'}</dd></div>
          <div><dt>Entreprise</dt><dd>{profile?.company_id ?? '—'}</dd></div>
          <div><dt>Langue</dt><dd>{profile?.preferred_language?.toUpperCase() ?? 'Auto'}</dd></div>
        </dl>
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Notifications</p>
            <h2>Préférences personnelles</h2>
            <p>Ces réglages sont stockés dans Supabase et restent cohérents avec l’application mobile.</p>
          </div>
        </div>
        <div className={styles.toggleList}>
          <ToggleRow label="Notifications app" hint="Alertes visibles dans BuildTrack." checked={!!prefValue(preferences, authUser, 'in_app_enabled')} onChange={value => onUpdateNotificationField('in_app_enabled', value)} />
          <ToggleRow label="Notifications push" hint="Alertes natives tablette ou téléphone." checked={!!prefValue(preferences, authUser, 'push_enabled')} onChange={value => onUpdateNotificationField('push_enabled', value)} />
          <ToggleRow label="Notifications email" hint="Emails automatiques réserves et rappels." checked={!!prefValue(preferences, authUser, 'email_enabled')} onChange={value => onUpdateNotificationField('email_enabled', value)} />
          <ToggleRow label="Messages par email" hint="Recevoir les messages importants par mail." checked={!!prefValue(preferences, authUser, 'messages_email', false)} onChange={value => onUpdateNotificationField('messages_email', value)} />
          <ToggleRow label="Heures calmes" hint="Suspend les push non critiques." checked={!!prefValue(preferences, authUser, 'quiet_hours_enabled', false)} onChange={value => onUpdateNotificationField('quiet_hours_enabled', value)} />
        </div>
      </section>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={styles.toggleRow}>
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    </label>
  );
}

function ReserveModal({ mode, draft, setDraft, data, selectedProjectId, saving, onClose, onSubmit, onToggleCompany }: {
  mode: 'create' | 'edit';
  draft: ReserveDraft;
  setDraft: React.Dispatch<React.SetStateAction<ReserveDraft>>;
  data: WebState;
  selectedProjectId: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onToggleCompany: (companyName: string) => void;
}) {
  const projectId = draft.chantierId || (selectedProjectId !== 'all' ? selectedProjectId : data.chantiers[0]?.id ?? '');
  const plans = data.sitePlans.filter(plan => getChantierId(plan) === projectId);
  const visits = data.visites.filter(visit => getChantierId(visit) === projectId);
  const lots = data.lots.filter(lot => !lot.chantier_id || getChantierId(lot) === projectId);
  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <form className={styles.modalPanel} onSubmit={onSubmit}>
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.eyebrow}>{mode === 'edit' ? 'Modification' : 'Création'}</p>
            <h2>{mode === 'edit' ? 'Modifier la réserve' : 'Nouvelle réserve'}</h2>
          </div>
          <button type="button" onClick={onClose}>Fermer</button>
        </div>
        <div className={styles.formGrid}>
          <label>
            Type
            <select value={draft.kind} onChange={event => setDraft(prev => ({ ...prev, kind: event.target.value as ReserveDraft['kind'] }))}>
              <option value="reserve">Réserve</option>
              <option value="observation">Observation</option>
            </select>
          </label>
          <label>
            Chantier
            <select value={projectId} onChange={event => setDraft(prev => ({ ...prev, chantierId: event.target.value, planId: '', visiteId: '' }))}>
              {data.chantiers.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className={styles.formWide}>
            Titre
            <input
              value={draft.title}
              onChange={event => {
                const value = event.target.value;
                setDraft(prev => {
                  const shouldMirrorDescription = !prev.description.trim() || prev.description === prev.title;
                  return { ...prev, title: value, description: shouldMirrorDescription ? value : prev.description };
                });
              }}
              placeholder="Ex: Finition mur à reprendre"
              required
            />
          </label>
          <label className={styles.formWide}>
            Description
            <textarea value={draft.description} onChange={event => setDraft(prev => ({ ...prev, description: event.target.value }))} rows={4} />
          </label>
          <label>
            Bâtiment
            <input value={draft.building} onChange={event => setDraft(prev => ({ ...prev, building: event.target.value }))} />
          </label>
          <label>
            Niveau
            <input value={draft.level} onChange={event => setDraft(prev => ({ ...prev, level: event.target.value }))} />
          </label>
          <label>
            Zone
            <input value={draft.zone} onChange={event => setDraft(prev => ({ ...prev, zone: event.target.value }))} />
          </label>
          <label>
            Échéance
            <input type="date" value={draft.deadline} onChange={event => setDraft(prev => ({ ...prev, deadline: event.target.value }))} />
          </label>
          <label>
            Priorité
            <select value={draft.priority} onChange={event => setDraft(prev => ({ ...prev, priority: event.target.value }))}>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Statut
            <select value={draft.status} onChange={event => setDraft(prev => ({ ...prev, status: event.target.value }))}>
              {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Plan associé
            <select value={draft.planId} onChange={event => setDraft(prev => ({ ...prev, planId: event.target.value }))}>
              <option value="">Aucun plan</option>
              {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </label>
          <label>
            Visite associée
            <select value={draft.visiteId} onChange={event => setDraft(prev => ({ ...prev, visiteId: event.target.value }))}>
              <option value="">Aucune visite</option>
              {visits.map(visit => <option key={visit.id} value={visit.id}>{visit.title}</option>)}
            </select>
          </label>
          <label>
            Lot
            <select value={draft.lotId} onChange={event => setDraft(prev => ({ ...prev, lotId: event.target.value }))}>
              <option value="">Aucun lot</option>
              {lots.map(lot => <option key={lot.id} value={lot.id}>{lot.code ? `${lot.code} · ${lot.name}` : lot.name}</option>)}
            </select>
          </label>
          <div className={styles.formWide}>
            <span className={styles.fieldLabel}>Entreprises responsables</span>
            <div className={styles.chipGrid}>
              {data.companies.map(company => (
                <button
                  key={company.id}
                  type="button"
                  className={draft.companies.includes(company.name) ? styles.chipActive : styles.chip}
                  onClick={() => onToggleCompany(company.name)}
                >
                  {company.short_name ?? company.shortName ?? company.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={saving}>{saving ? 'Enregistrement...' : mode === 'edit' ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    </div>
  );
}

function VisitModal({ draft, setDraft, data, selectedProjectId, saving, onClose, onSubmit, onToggleCompany }: {
  draft: VisitDraft;
  setDraft: React.Dispatch<React.SetStateAction<VisitDraft>>;
  data: WebState;
  selectedProjectId: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onToggleCompany: (companyId: string) => void;
}) {
  const projectId = draft.chantierId || (selectedProjectId !== 'all' ? selectedProjectId : data.chantiers[0]?.id ?? '');
  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <form className={styles.modalPanel} onSubmit={onSubmit}>
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.eyebrow}>Visite chantier</p>
            <h2>Nouvelle visite</h2>
          </div>
          <button type="button" onClick={onClose}>Fermer</button>
        </div>
        <div className={styles.formGrid}>
          <label className={styles.formWide}>
            Titre
            <input value={draft.title} onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))} placeholder="Ex: Contrôle S21" required />
          </label>
          <label>
            Chantier
            <select value={projectId} onChange={event => setDraft(prev => ({ ...prev, chantierId: event.target.value }))}>
              {data.chantiers.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            Type
            <select value={draft.visitType} onChange={event => setDraft(prev => ({ ...prev, visitType: event.target.value as VisitDraft['visitType'] }))}>
              {Object.entries(VISIT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Date
            <input type="date" value={draft.date} onChange={event => setDraft(prev => ({ ...prev, date: event.target.value }))} />
          </label>
          <label>
            Début
            <input type="time" value={draft.startTime} onChange={event => setDraft(prev => ({ ...prev, startTime: event.target.value }))} />
          </label>
          <label>
            Fin
            <input type="time" value={draft.endTime} onChange={event => setDraft(prev => ({ ...prev, endTime: event.target.value }))} />
          </label>
          <label>
            Statut
            <select value={draft.status} onChange={event => setDraft(prev => ({ ...prev, status: event.target.value as VisitDraft['status'] }))}>
              {Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Conducteur
            <input value={draft.conducteur} onChange={event => setDraft(prev => ({ ...prev, conducteur: event.target.value }))} />
          </label>
          <label>
            Bâtiment
            <input value={draft.building} onChange={event => setDraft(prev => ({ ...prev, building: event.target.value }))} />
          </label>
          <label>
            Niveau
            <input value={draft.level} onChange={event => setDraft(prev => ({ ...prev, level: event.target.value }))} />
          </label>
          <label>
            Zone
            <input value={draft.zone} onChange={event => setDraft(prev => ({ ...prev, zone: event.target.value }))} />
          </label>
          <label>
            Délai cible réserves
            <input type="date" value={draft.reserveDeadlineDate} onChange={event => setDraft(prev => ({ ...prev, reserveDeadlineDate: event.target.value }))} />
          </label>
          <label className={styles.formWide}>
            Notes
            <textarea value={draft.notes} onChange={event => setDraft(prev => ({ ...prev, notes: event.target.value }))} rows={3} />
          </label>
          <div className={styles.formWide}>
            <span className={styles.fieldLabel}>Entreprises concernées</span>
            <div className={styles.chipGrid}>
              {data.companies.map(company => (
                <button
                  key={company.id}
                  type="button"
                  className={draft.companyIds.includes(company.id) ? styles.chipActive : styles.chip}
                  onClick={() => onToggleCompany(company.id)}
                >
                  {company.short_name ?? company.shortName ?? company.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={saving}>{saving ? 'Création...' : 'Créer la visite'}</button>
        </div>
      </form>
    </div>
  );
}

function AdminView({ data, profile }: { data: WebState; profile: Profile | null }) {
  if (!isAdmin(profile)) {
    return <section className={styles.panel}><p className={styles.empty}>Accès réservé aux admins et super admins.</p></section>;
  }
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Utilisateurs" value={data.profiles.length} hint="Profils Supabase" />
        <Kpi title="Entreprises" value={data.companies.length} hint="Sous-traitants" tone="green" />
        <Kpi title="Préférences notif." value={data.notificationPreferences.length} hint="App / push / email" tone="amber" />
        <Kpi title="Chantiers" value={data.chantiers.length} hint="Périmètre org." />
      </div>
      <section className={styles.panel}>
        <div className={styles.dataTable}>
          <div className={styles.tableHead}><span>Utilisateur</span><span>Rôle</span><span>Entreprise</span><span>Email</span></div>
          {data.profiles.map(user => {
            const company = data.companies.find(c => c.id === user.company_id);
            return (
              <div key={user.id} className={styles.tableRow}>
                <strong>{user.name}</strong>
                <span>{user.role_label ?? user.role}</span>
                <span>{company?.name ?? '—'}</span>
                <span>{user.email}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SimpleColumn({ title, rows, primary, secondary }: { title: string; rows: any[]; primary: string; secondary: string }) {
  return (
    <div>
      <h3>{title}</h3>
      <div className={styles.compactList}>
        {rows.slice(0, 8).map(row => (
          <button key={row.id}>
            <span>{row[secondary] ? prettyDate(row[secondary]) : '—'}</span>
            <strong>{row[primary] ?? row.name ?? row.id}</strong>
          </button>
        ))}
        {!rows.length && <small>Aucun élément.</small>}
      </div>
    </div>
  );
}
