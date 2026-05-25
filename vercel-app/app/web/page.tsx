'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
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
  buildingId: string;
  level: string;
  levelId: string;
  zone: string;
  priority: string;
  status: string;
  deadline: string;
  planId: string;
  planX?: number | null;
  planY?: number | null;
  lotId: string;
  visiteId: string;
  companies: string[];
  placePinAfterCreate: boolean;
};

type ReservePinDraft = {
  planId?: string;
  x: number;
  y: number;
};

type PlanPin = {
  reserve: any;
  number: number;
  x: number;
  y: number;
};

type PinPlacementPreview = {
  id: string;
  planId: string;
  x: number;
  y: number;
  label: string;
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
  defaultPlanId: string;
  visitedLocations: Array<{
    buildingId?: string;
    buildingName: string;
    defaultPlanId?: string;
  }>;
  reserveDeadlineDate: string;
  notes: string;
  checklistItems: Array<{ id: string; label: string; checked: boolean }>;
  companyIds: string[];
  participants: Array<{ id: string; name: string; role?: string; company?: string; companyId?: string }>;
  tags: string[];
  recurrence: 'none' | 'weekly' | 'bimonthly';
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

const PDFJS_VERSION = '5.7.284';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'reserves', label: 'Réserves', icon: '⚠' },
  { id: 'plans', label: 'Plans', icon: '▤' },
  { id: 'visites', label: 'Visites', icon: '☑' },
  { id: 'planning', label: 'Planning', icon: '◷' },
  { id: 'messages', label: 'Messages', icon: '○' },
  { id: 'terrain', label: 'Terrain', icon: '⌁' },
  { id: 'media', label: 'Médias', icon: '▧' },
  { id: 'rapports', label: 'Rapports', icon: '▤' },
  { id: 'equipes', label: 'Équipes', icon: '◎' },
  { id: 'settings', label: 'Réglages', icon: '☰' },
  { id: 'admin', label: 'Admin', icon: '⚙' },
] as const;

type TabId = typeof TABS[number]['id'];

const NAV_GROUPS: { label: string; items: TabId[] }[] = [
  { label: 'Pilotage', items: ['dashboard', 'reserves', 'plans', 'visites', 'planning'] },
  { label: 'Collaboration', items: ['messages', 'terrain', 'media', 'rapports'] },
  { label: 'Administration', items: ['equipes', 'settings', 'admin'] },
];

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
const RESERVE_FILTER_OPTIONS = [
  { key: 'all', label: 'Tous' },
  ...STATUS_OPTIONS.map(([key, label]) => ({ key, label })),
  { key: 'overdue', label: 'En retard' },
  { key: 'archived', label: 'Archivées' },
] as const;

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  conducteur: 'Conducteur de travaux',
  chef_equipe: "Chef d'équipe",
  sous_traitant: 'Sous-traitant',
  observateur: 'Observateur',
};

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

const VISIT_TYPE_OPTIONS: Array<{ value: VisitDraft['visitType']; label: string; icon: string; color: string }> = [
  { value: 'controle', label: 'Contrôle', icon: '☑', color: '#6366f1' },
  { value: 'opr', label: 'OPR', icon: '▤', color: '#f59e0b' },
  { value: 'securite', label: 'Sécurité', icon: '◇', color: '#ef4444' },
  { value: 'reception', label: 'Réception', icon: '✓', color: '#10b981' },
  { value: 'synthese', label: 'Synthèse', icon: '◎', color: '#3b82f6' },
  { value: 'autre', label: 'Autre', icon: '…', color: '#64748b' },
];

const VISIT_DEADLINE_SUGGESTIONS = [
  { label: '7 j', days: 7 },
  { label: '15 j', days: 15 },
  { label: '30 j', days: 30 },
  { label: '60 j', days: 60 },
] as const;

const VISIT_RECURRENCE_OPTIONS: Array<{ value: VisitDraft['recurrence']; label: string; desc: string }> = [
  { value: 'none', label: 'Unique', desc: 'Créer uniquement cette visite.' },
  { value: 'weekly', label: 'Hebdomadaire', desc: 'Créer 4 visites sur 4 semaines.' },
  { value: 'bimonthly', label: 'Bi-mensuelle', desc: 'Créer 4 visites espacées de 2 semaines.' },
];

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

function addDaysISO(value: string, days: number) {
  const base = value ? new Date(`${value}T12:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return todayISO();
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function isoWeekFromISO(value: string) {
  const source = value ? new Date(`${value}T12:00:00`) : new Date();
  const date = new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()));
  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function autoVisitTitle(type: VisitDraft['visitType'], date: string) {
  return `${VISIT_TYPE_LABELS[type]} — S${isoWeekFromISO(date)}`;
}

function makeVisitChecklist(type: VisitDraft['visitType']) {
  return (VISIT_CHECKLIST_TEMPLATES[type] ?? []).map(label => ({
    id: crypto.randomUUID(),
    label,
    checked: false,
  }));
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

function isReserveArchived(reserve: any) {
  return Boolean(reserve?.archived_at ?? reserve?.archivedAt);
}

function isReserveOverdue(reserve: any) {
  if (!reserve?.deadline || ['closed', 'verification'].includes(String(reserve?.status ?? ''))) return false;
  const deadline = new Date(reserve.deadline);
  return !Number.isNaN(deadline.getTime()) && deadline < new Date();
}

function sameName(a?: string | null, b?: string | null) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function getChantierId(item: any) {
  return item?.chantier_id ?? item?.chantierId ?? '';
}

function normalizeSearchText(value: any) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function getPlanBuildingName(plan: any) {
  return String(plan?.building_name ?? plan?.building ?? plan?.batiment ?? '').trim() || 'Sans bâtiment';
}

function getPlanBuildingKey(plan: any) {
  const id = plan?.building_id ?? plan?.buildingId;
  if (id) return `id:${id}`;
  const name = getPlanBuildingName(plan);
  return name === 'Sans bâtiment' ? '__none__' : `name:${normalizeSearchText(name)}`;
}

function getPlanLevelName(plan: any) {
  return String(plan?.level_name ?? plan?.level ?? plan?.niveau ?? '').trim();
}

function projectBuildings(project?: any | null): any[] {
  return Array.isArray(project?.buildings) ? project.buildings : [];
}

function getPlanBuildingId(plan: any) {
  return String(plan?.building_id ?? plan?.buildingId ?? '').trim();
}

function getPlanLevelId(plan: any) {
  return String(plan?.level_id ?? plan?.levelId ?? '').trim();
}

function getBuildingNameById(project: any, buildingId?: string | null) {
  if (!buildingId) return '';
  return projectBuildings(project).find((building: any) => building.id === buildingId)?.name ?? '';
}

function getLevelNameById(project: any, buildingId?: string | null, levelId?: string | null) {
  if (!buildingId || !levelId) return '';
  const building = projectBuildings(project).find((item: any) => item.id === buildingId);
  return (building?.levels ?? []).find((level: any) => level.id === levelId)?.name ?? '';
}

function getPlanDisplayLocation(plan: any, project?: any | null) {
  const buildingId = getPlanBuildingId(plan);
  const levelId = getPlanLevelId(plan);
  const building = getBuildingNameById(project, buildingId) || getPlanBuildingName(plan);
  const level = getLevelNameById(project, buildingId, levelId) || getPlanLevelName(plan);
  return { building, buildingId, level, levelId };
}

function getVisitCompanyIds(visit: any): string[] {
  return Array.isArray(visit?.concerned_company_ids)
    ? visit.concerned_company_ids
    : Array.isArray(visit?.concernedCompanyIds)
      ? visit.concernedCompanyIds
      : [];
}

function getVisitLocations(visit: any): any[] {
  return Array.isArray(visit?.visited_locations)
    ? visit.visited_locations
    : Array.isArray(visit?.visitedLocations)
      ? visit.visitedLocations
      : [];
}

function getVisitDefaultPlanId(visit: any) {
  return String(visit?.default_plan_id ?? visit?.defaultPlanId ?? '').trim();
}

function getVisitReserveDeadline(visit: any) {
  return String(visit?.reserve_deadline_date ?? visit?.reserveDeadlineDate ?? '').trim();
}

function getReserveBuildingKey(reserve: any) {
  const id = reserve?.building_id ?? reserve?.buildingId;
  if (id) return `id:${id}`;
  const name = String(reserve?.building_name ?? reserve?.building ?? reserve?.batiment ?? '').trim();
  return name ? `name:${normalizeSearchText(name)}` : '__none__';
}

function parseBuildingFamily(name: string) {
  const trimmed = name.trim();
  const match = trimmed.match(/^([^\d]*?[^\d\s])[\s\-_.#]*(\d+.*)$/);
  if (!match) return null;
  const label = match[1].trim().replace(/[\s\-_.#]+$/, '');
  if (!label) return null;
  return { key: normalizeSearchText(label).replace(/\s+/g, ' '), label };
}

function assetUrl(item: any) {
  return item?.uri ?? item?.url ?? item?.file_url ?? item?.public_url ?? item?.signed_url ?? item?.photo_uri ?? '';
}

function clampPercent(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizePlanPercent(value?: any) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(clampPercent(num));
}

function planCoordinateToPercent(value: any, ratioMode = false) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return clampPercent(ratioMode ? num * 100 : num, 2, 98);
}

function toBase64Download(pdfBase64: string, filename: string) {
  if (typeof window === 'undefined') return;
  const byteChars = atob(pdfBase64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i += 1) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function createReserveDraft(projectId: string, plan?: any | null, visit?: any | null, pin?: ReservePinDraft | null): ReserveDraft {
  const firstVisitLocation = getVisitLocations(visit)[0] ?? null;
  const planId = pin?.planId ?? firstVisitLocation?.defaultPlanId ?? firstVisitLocation?.default_plan_id ?? getVisitDefaultPlanId(visit) ?? plan?.id ?? '';
  const planX = normalizePlanPercent(pin?.x);
  const planY = normalizePlanPercent(pin?.y);
  return {
    kind: 'reserve',
    title: '',
    description: '',
    chantierId: getChantierId(visit) || getChantierId(plan) || projectId,
    building: firstVisitLocation?.buildingName ?? firstVisitLocation?.building_name ?? visit?.building ?? plan?.building ?? '',
    buildingId: firstVisitLocation?.buildingId ?? firstVisitLocation?.building_id ?? getPlanBuildingId(plan) ?? '',
    level: visit?.level ?? plan?.level ?? '',
    levelId: getPlanLevelId(plan) ?? '',
    zone: visit?.zone ?? '',
    priority: 'medium',
    status: 'open',
    deadline: getVisitReserveDeadline(visit),
    planId,
    planX,
    planY,
    lotId: '',
    visiteId: visit?.id ?? '',
    companies: [],
    placePinAfterCreate: Boolean(planId) && (planX == null || planY == null),
  };
}

function reserveToDraft(reserve: any): ReserveDraft {
  return {
    kind: reserve.kind ?? 'reserve',
    title: reserve.title ?? '',
    description: reserve.description ?? '',
    chantierId: reserve.chantier_id ?? '',
    building: reserve.building ?? '',
    buildingId: reserve.building_id ?? reserve.buildingId ?? '',
    level: reserve.level ?? '',
    levelId: reserve.level_id ?? reserve.levelId ?? '',
    zone: reserve.zone ?? '',
    priority: reserve.priority ?? 'medium',
    status: reserve.status ?? 'open',
    deadline: reserve.deadline ?? '',
    planId: reserve.plan_id ?? '',
    planX: normalizePlanPercent(reserve.plan_x),
    planY: normalizePlanPercent(reserve.plan_y),
    lotId: reserve.lot_id ?? '',
    visiteId: reserve.visite_id ?? '',
    companies: reserveCompanies(reserve),
    placePinAfterCreate: false,
  };
}

function createVisitDraft(projectId: string, conducteur: string): VisitDraft {
  const date = todayISO();
  const visitType: VisitDraft['visitType'] = 'controle';
  return {
    title: autoVisitTitle(visitType, date),
    chantierId: projectId,
    date,
    startTime: '08:00',
    endTime: '10:00',
    conducteur,
    status: 'planned',
    visitType,
    building: '',
    level: '',
    zone: '',
    defaultPlanId: '',
    visitedLocations: [],
    reserveDeadlineDate: '',
    notes: '',
    checklistItems: makeVisitChecklist(visitType),
    companyIds: [],
    participants: [],
    tags: [],
    recurrence: 'none',
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
  const [reportLanguage, setReportLanguage] = useState<'fr' | 'en' | 'es'>('fr');
  const [generatingReport, setGeneratingReport] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('buildtrack-web-sidebar-collapsed') === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('buildtrack-web-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

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
    if (!canEdit(profile) || !reserveId) return;
    const payload = {
      plan_id: planId,
      plan_x: clampPercent(x),
      plan_y: clampPercent(y),
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

  function openReserveCreate(prefill?: { plan?: any; visit?: any; pin?: ReservePinDraft }) {
    setError('');
    setEditingReserveId(null);
    const prefillPlan = prefill?.plan ?? (prefill?.pin?.planId ? data.sitePlans.find(plan => plan.id === prefill.pin?.planId) : null);
    const baseDraft = createReserveDraft(currentProjectId(), prefillPlan, prefill?.visit, prefill?.pin);
    const project = data.chantiers.find(item => item.id === baseDraft.chantierId);
    const selectedPlan = prefillPlan ?? data.sitePlans.find(plan => plan.id === baseDraft.planId);
    const planLocation = selectedPlan ? getPlanDisplayLocation(selectedPlan, project) : null;
    const visitCompanyNames = getVisitCompanyIds(prefill?.visit)
      .map(companyId => data.companies.find(company => company.id === companyId)?.name)
      .filter((name): name is string => !!name);
    setReserveDraft({
      ...baseDraft,
      building: planLocation?.building || baseDraft.building,
      buildingId: planLocation?.buildingId || baseDraft.buildingId,
      level: planLocation?.level || baseDraft.level,
      levelId: planLocation?.levelId || baseDraft.levelId,
      companies: visitCompanyNames,
      placePinAfterCreate: Boolean(baseDraft.planId) && (baseDraft.planX == null || baseDraft.planY == null),
    });
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
    if (!reserveDraft.companies.length) {
      setError('Sélectionnez au moins une entreprise responsable.');
      return;
    }
    if (!reserveDraft.building.trim()) {
      setError('Le bâtiment est obligatoire.');
      return;
    }
    if (!reserveDraft.level.trim()) {
      setError('Le niveau est obligatoire.');
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
      building_id: reserveDraft.buildingId || null,
      zone: reserveDraft.zone.trim(),
      level: reserveDraft.level.trim(),
      level_id: reserveDraft.levelId || null,
      company: companies[0] ?? '',
      companies,
      priority: reserveDraft.priority,
      status: reserveDraft.status,
      deadline: reserveDraft.deadline || null,
      comments: existing?.comments ?? [],
      history,
      plan_id: reserveDraft.planId || null,
      plan_x: reserveDraft.planId ? normalizePlanPercent(reserveDraft.planX) : null,
      plan_y: reserveDraft.planId ? normalizePlanPercent(reserveDraft.planY) : null,
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
        const createdWithPin = basePayload.plan_x != null && basePayload.plan_y != null;
        if (reserveDraft.planId && (reserveDraft.placePinAfterCreate || createdWithPin)) {
          setSelectedPlanId(reserveDraft.planId);
          setActiveTab('plans');
          setPinModeReserveId(createdWithPin ? null : id);
        }
        closeReserveModal();
      }
    }
    setSaving(false);
  }

  async function submitVisit(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !canEdit(profile)) return;
    const title = visitDraft.title.trim();
    const project = data.chantiers.find(item => item.id === visitDraft.chantierId);
    const hasBuildingHierarchy = projectBuildings(project).length > 0;
    if (!title) {
      setError('Le titre de la visite est obligatoire.');
      return;
    }
    if (!visitDraft.date) {
      setError('La date de visite est obligatoire.');
      return;
    }
    if (hasBuildingHierarchy && visitDraft.visitedLocations.length === 0) {
      setError('Sélectionnez au moins un bâtiment dans le périmètre de visite.');
      return;
    }
    if (visitDraft.startTime && visitDraft.endTime && visitDraft.endTime <= visitDraft.startTime) {
      setError("L'heure de fin doit être après l'heure de début.");
      return;
    }
    setSaving(true);
    setError('');

    const recurrenceOffsets =
      visitDraft.recurrence === 'weekly' ? [0, 7, 14, 21] :
      visitDraft.recurrence === 'bimonthly' ? [0, 14, 28, 42] :
      [0];
    const singleLocation = hasBuildingHierarchy && visitDraft.visitedLocations.length === 1
      ? visitDraft.visitedLocations[0]
      : null;
    const basePayload = {
      chantier_id: visitDraft.chantierId || null,
      start_time: visitDraft.startTime || null,
      end_time: visitDraft.endTime || null,
      conducteur: visitDraft.conducteur.trim() || userLabel(profile, authUser),
      status: visitDraft.status,
      visit_type: visitDraft.visitType,
      concerned_company_ids: visitDraft.companyIds.length ? visitDraft.companyIds : null,
      visited_locations: hasBuildingHierarchy && visitDraft.visitedLocations.length ? visitDraft.visitedLocations : null,
      building: hasBuildingHierarchy ? (singleLocation?.buildingName ?? null) : (visitDraft.building.trim() || null),
      level: hasBuildingHierarchy ? null : (visitDraft.level.trim() || null),
      zone: visitDraft.zone.trim() || null,
      notes: visitDraft.notes.trim() || null,
      tags: visitDraft.tags.length ? visitDraft.tags : null,
      default_plan_id: hasBuildingHierarchy ? (singleLocation?.defaultPlanId ?? null) : (visitDraft.defaultPlanId || null),
      reserve_deadline_date: visitDraft.reserveDeadlineDate || null,
      checklist_items: visitDraft.checklistItems.length
        ? visitDraft.checklistItems.map(item => ({ ...item, checked: false }))
        : null,
      reserve_ids: [],
      participants: visitDraft.participants.length ? visitDraft.participants : null,
      created_at: new Date().toISOString(),
      organization_id: profile.organization_id ?? null,
    };
    const payloads = recurrenceOffsets.map((offset, index) => ({
      ...basePayload,
      id: `VIS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      title: recurrenceOffsets.length > 1 ? `${title} — S${index + 1}` : title,
      date: addDaysISO(visitDraft.date, offset),
      status: index === 0 ? visitDraft.status : 'planned',
    }));

    const { data: inserted, error: insertError } = await supabaseBrowser
      .from('visites')
      .insert(payloads)
      .select();
    if (insertError) {
      setError(insertError.message);
    } else {
      setData(prev => ({ ...prev, visites: [...(inserted ?? payloads), ...prev.visites] }));
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

  async function updateTaskQuick(task: any, patch: Record<string, any>) {
    if (!canEdit(profile)) return;
    const payload = {
      ...patch,
      progress: patch.progress ?? task.progress ?? 0,
    };
    setData(prev => ({
      ...prev,
      tasks: prev.tasks.map(item => item.id === task.id ? { ...item, ...payload } : item),
    }));
    const { error: taskError } = await supabaseBrowser
      .from('tasks')
      .update(payload)
      .eq('id', task.id);
    if (taskError) setError(taskError.message);
  }

  async function updateProfileField(userId: string, patch: Partial<Profile>) {
    if (!isAdmin(profile)) return;
    setData(prev => ({
      ...prev,
      profiles: prev.profiles.map(user => user.id === userId ? { ...user, ...patch } : user),
    }));
    const { error: profileError } = await supabaseBrowser
      .from('profiles')
      .update(patch)
      .eq('id', userId);
    if (profileError) setError(profileError.message);
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

  function projectName() {
    if (selectedProjectId === 'all') return 'Tous les chantiers';
    return data.chantiers.find(project => project.id === selectedProjectId)?.name ?? 'Chantier';
  }

  async function generateWebReport(type: 'global_reserves' | 'plans' | 'individual_reserve' | 'visit_report', options?: { visit?: any }) {
    const selectedProjectName = projectName();
    const reportKey = `${type}-${reportLanguage}`;
    setGeneratingReport(reportKey);
    setError('');
    try {
      const payload = type === 'individual_reserve'
        ? {
            type,
            chantierName: selectedProjectName,
            reserve: selectedReserve,
            language: reportLanguage,
            generatedAt: new Date().toISOString(),
          }
        : type === 'visit_report'
          ? {
              type,
              chantierName: selectedProjectName,
              visit: options?.visit,
              reserves: projectScoped.reserves.filter((reserve: any) => {
                const visitReserveIds = options?.visit?.reserve_ids ?? [];
                return reserve.visite_id === options?.visit?.id || visitReserveIds.includes(reserve.id);
              }),
              companies: data.companies,
              language: reportLanguage,
              generatedAt: new Date().toISOString(),
            }
        : {
            type,
            chantierName: selectedProjectName,
            reserves: filteredReserves,
            plans: projectScoped.plans,
            companyFilter: null,
            language: reportLanguage,
            generatedAt: new Date().toISOString(),
          };
      if (type === 'individual_reserve' && !selectedReserve) {
        setError('Sélectionnez une réserve avant de générer sa fiche.');
        return;
      }
      if (type === 'visit_report' && !options?.visit) {
        setError('Selectionnez une visite avant de generer son compte rendu.');
        return;
      }
      const response = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? 'Génération PDF impossible.');
      }
      const filePart = selectedProjectName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'BuildTrack';
      const typePart = type === 'global_reserves' ? 'reserves' : type === 'plans' ? 'plans' : type === 'visit_report' ? 'visite' : 'reserve';
      toBase64Download(result.pdfBase64, `BuildTrack_${typePart}_${filePart}_${reportLanguage}.pdf`);
    } catch (err: any) {
      setError(err?.message ?? 'Génération PDF impossible.');
    } finally {
      setGeneratingReport(null);
    }
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
      if (statusFilter === 'archived') {
        if (!isReserveArchived(r)) return false;
      } else {
        if (isReserveArchived(r)) return false;
        if (statusFilter === 'overdue') {
          if (!isReserveOverdue(r)) return false;
        } else if (statusFilter !== 'all' && r.status !== statusFilter) {
          return false;
        }
      }
      if (!q) return true;
      const haystack = [
        r.id,
        r.title,
        r.description,
        r.building,
        r.level,
        r.zone,
        STATUS_LABELS[r.status] ?? r.status,
        PRIORITY_LABELS[r.priority] ?? r.priority,
        ...(reserveCompanies(r)),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [projectScoped.reserves, search, statusFilter]);

  const selectedReserve = data.reserves.find(r => r.id === selectedReserveId) ?? filteredReserves[0] ?? null;
  const selectedFilteredReserve = filteredReserves.find(r => r.id === selectedReserveId) ?? filteredReserves[0] ?? null;
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
    <main className={`${styles.appShell} ${sidebarCollapsed ? styles.appShellCollapsed : ''}`}>
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}>
        <div className={styles.sidebarBrandRow}>
          <div className={styles.sidebarBrand}>
            <span className={styles.brandMarkSmall}>B</span>
            <div>
              <strong>BuildTrack</strong>
              <span>Web</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          className={`${styles.sidebarToggle} ${sidebarCollapsed ? styles.sidebarToggleCollapsed : ''}`}
          onClick={() => setSidebarCollapsed(value => !value)}
          aria-label={sidebarCollapsed ? 'Déplier le menu principal' : 'Plier le menu principal'}
          title={sidebarCollapsed ? 'Déplier le menu' : 'Plier le menu'}
        >
          <span className={styles.sidebarToggleChevron} aria-hidden="true" />
        </button>
        <nav className={styles.navList} aria-label="Menu principal">
          {NAV_GROUPS.map(group => (
            <div key={group.label} className={styles.navSection}>
              <span className={styles.navSectionLabel}>{group.label}</span>
              <div className={styles.navSectionItems}>
                {group.items.map(tabId => {
                  const tab = TABS.find(item => item.id === tabId)!;
                  return (
                    <button
                      key={tab.id}
                      className={activeTab === tab.id ? styles.navActive : ''}
                      onClick={() => setActiveTab(tab.id)}
                      title={sidebarCollapsed ? tab.label : undefined}
                      aria-label={tab.label}
                    >
                      <span className={styles.navIcon}>{tab.icon}</span>
                      <span className={styles.navLabel}>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className={styles.userBox}>
          <strong>{profile?.name ?? authUser.email}</strong>
          <span>{profile?.role_label ?? profile?.role ?? 'Utilisateur'}</span>
          <button onClick={() => supabaseBrowser.auth.signOut()} title="Déconnexion">
            <span className={styles.logoutIcon}>⎋</span>
            <span className={styles.logoutLabel}>Déconnexion</span>
          </button>
        </div>
      </aside>

      <section className={`${styles.workspace} ${activeTab === 'plans' ? styles.workspacePlans : ''} ${activeTab === 'reserves' ? styles.workspaceReserves : ''}`}>
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
                allReserves={projectScoped.reserves}
                reserves={filteredReserves}
                selectedReserve={selectedFilteredReserve}
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
                onCreateReserveAtPin={(plan: any, pin: ReservePinDraft) => openReserveCreate({ plan, pin })}
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
            {activeTab === 'planning' && (
              <PlanningView
                tasks={projectScoped.tasks}
                visites={projectScoped.visites}
                reserves={projectScoped.reserves}
                companies={data.companies}
                editable={canEdit(profile)}
                onUpdateTask={updateTaskQuick}
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
            {activeTab === 'media' && (
              <MediaView photos={projectScoped.photos} documents={projectScoped.documents} />
            )}
            {activeTab === 'rapports' && (
              <RapportsView
                stats={stats}
                reserves={filteredReserves}
                plans={projectScoped.plans}
                visites={projectScoped.visites}
                incidents={projectScoped.incidents}
                tasks={projectScoped.tasks}
                selectedReserve={selectedReserve}
                language={reportLanguage}
                setLanguage={setReportLanguage}
                generatingReport={generatingReport}
                onGenerate={generateWebReport}
              />
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
              <AdminView data={data} profile={profile} onUpdateProfile={updateProfileField} />
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
  allReserves: any[];
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
  const { allReserves, reserves, selectedReserve } = props;
  const [commentText, setCommentText] = useState('');
  const activeReserves = allReserves.filter(reserve => !isReserveArchived(reserve));
  const filterCounts = RESERVE_FILTER_OPTIONS.reduce<Record<string, number>>((acc, option) => {
    acc[option.key] =
      option.key === 'all'
        ? activeReserves.length
        : option.key === 'archived'
          ? allReserves.filter(isReserveArchived).length
          : option.key === 'overdue'
            ? activeReserves.filter(isReserveOverdue).length
            : activeReserves.filter(reserve => reserve.status === option.key).length;
    return acc;
  }, {});

  return (
    <div className={styles.reservesLayout}>
      <section className={`${styles.panel} ${styles.reservesListPanel}`}>
        <div className={styles.reservePanelHeader}>
          <div>
            <p className={styles.eyebrow}>Suivi chantier</p>
            <h2>Réserves</h2>
          </div>
          {props.editable && <button type="button" onClick={props.onCreate}>Créer</button>}
        </div>
        <div className={styles.reserveFilterRail}>
          {RESERVE_FILTER_OPTIONS.map(option => {
            const active = props.statusFilter === option.key;
            return (
              <button
                key={option.key}
                type="button"
                className={active ? styles.reserveFilterChipActive : ''}
                onClick={() => props.setStatusFilter(option.key)}
              >
                <span>{option.label}</span>
                <em>{filterCounts[option.key] ?? 0}</em>
              </button>
            );
          })}
        </div>
        <div className={styles.reserveSearchRow}>
          <span>⌕</span>
          <input placeholder="Titre, bâtiment, entreprise, lot..." value={props.search} onChange={e => props.setSearch(e.target.value)} />
          {props.search.trim() && (
            <button type="button" onClick={() => props.setSearch('')} aria-label="Effacer la recherche">×</button>
          )}
        </div>
        <div className={styles.reserveListMeta}>
          <span>{reserves.length} affichée{reserves.length > 1 ? 's' : ''}</span>
          <span>{activeReserves.length} active{activeReserves.length > 1 ? 's' : ''}</span>
        </div>
        <div className={styles.reserveList}>
          {reserves.map(reserve => (
            <button
              key={reserve.id}
              className={`${styles.reserveRow} ${selectedReserve?.id === reserve.id ? styles.reserveRowActive : ''}`}
              onClick={() => props.setSelectedReserveId(reserve.id)}
            >
              <div>
                <span className={`${styles.dot} ${styles[`priority_${reserve.priority}`] ?? ''}`} />
                <strong>{reserve.id}</strong>
              </div>
              <div>
                <strong>{reserve.title}</strong>
                <small>{[reserve.building, reserve.level, reserve.zone].filter(Boolean).join(' · ') || 'Sans localisation'}</small>
                <span>{reserveCompanies(reserve).join(', ') || 'Sans entreprise'}</span>
              </div>
              <em className={isReserveOverdue(reserve) ? styles.reserveStatusOverdue : ''}>
                {isReserveArchived(reserve) ? 'Archivée' : isReserveOverdue(reserve) ? 'En retard' : STATUS_LABELS[reserve.status] ?? reserve.status}
              </em>
            </button>
          ))}
          {!reserves.length && <p className={styles.empty}>Aucune réserve avec ces filtres.</p>}
        </div>
      </section>

      <section className={`${styles.panel} ${styles.reservesDetailPanel}`}>
        {selectedReserve ? (
          <>
            <div className={styles.reserveDetailHeader}>
              <div>
                <p className={styles.eyebrow}>{selectedReserve.id}</p>
                <h2>{selectedReserve.title}</h2>
                <span>{[selectedReserve.building, selectedReserve.level, selectedReserve.zone].filter(Boolean).join(' · ') || 'Sans localisation'}</span>
              </div>
              <span className={styles.badge}>{PRIORITY_LABELS[selectedReserve.priority] ?? selectedReserve.priority}</span>
            </div>
            <div className={styles.reserveDetailBody}>
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
                  <button type="button" key={value} disabled={props.saving || selectedReserve.status === value} onClick={() => props.onStatus(selectedReserve.id, value)}>
                    {label}
                  </button>
                ))}
                <button type="button" onClick={() => props.onArchive(selectedReserve)}>{selectedReserve.archived_at ? 'Désarchiver' : 'Archiver'}</button>
              </div>
            )}
            <HistoryBlock title="Commentaires" rows={selectedReserve.comments ?? []} />
            <HistoryBlock title="Historique" rows={selectedReserve.history ?? []} />
            </div>
          </>
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

function WebPdfPlan({
  uri,
  name,
  pins,
  focusedReserveId,
  pinModeReserveId,
  canCreate,
  placementPreview,
  onAssignPin,
  onCreateReserveAtPin,
  onPinClick,
}: {
  uri: string;
  name: string;
  pins: PlanPin[];
  focusedReserveId?: string | null;
  pinModeReserveId?: string | null;
  canCreate?: boolean;
  placementPreview?: PinPlacementPreview | null;
  onAssignPin: (x: number, y: number) => void;
  onCreateReserveAtPin?: (x: number, y: number) => void;
  onPinClick: (reserveId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const lastFocusZoomRef = useRef('');
  const [scale, setScale] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setScale(0);
    setPageSize({ width: 0, height: 0 });
    setError('');
    lastFocusZoomRef.current = '';
  }, [uri]);

  useEffect(() => {
    if (!focusedReserveId || !scale) return;
    const key = `${uri}:${focusedReserveId}`;
    if (lastFocusZoomRef.current === key) return;
    lastFocusZoomRef.current = key;
    setScale(value => {
      const current = value || scale || 1;
      return Math.min(3, Number((current * 1.8).toFixed(2)));
    });
  }, [focusedReserveId, scale, uri]);

  useEffect(() => {
    if (!focusedReserveId || !pageSize.width || !pageSize.height || !viewportRef.current) return;
    const pin = pins.find(item => item.reserve.id === focusedReserveId);
    if (!pin) return;
    const viewport = viewportRef.current;
    const left = (pin.x / 100) * pageSize.width;
    const top = (pin.y / 100) * pageSize.height;
    viewport.scrollTo({
      left: Math.max(0, left - viewport.clientWidth / 2),
      top: Math.max(0, top - viewport.clientHeight / 2),
      behavior: 'smooth',
    });
  }, [focusedReserveId, pageSize.height, pageSize.width, pins]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: any = null;

    async function renderPdfPage() {
      setLoading(true);
      setError('');
      try {
        const pdfjs: any = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc ||= `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
        loadingTask = pdfjs.getDocument({ url: uri });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        if (!scale) {
          const availableWidth = Math.max((viewportRef.current?.clientWidth ?? 900) - 32, 320);
          const fitScale = Math.min(1.2, Math.max(0.22, (availableWidth / baseViewport.width) * 1.18));
          setScale(Number(fitScale.toFixed(2)));
          return;
        }

        const viewport = page.getViewport({ scale });
        if (cancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas PDF indisponible');

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        setPageSize({ width: viewport.width, height: viewport.height });

        renderTaskRef.current?.cancel?.();
        const renderContext: any = {
          canvasContext: context,
          viewport,
        };
        if (outputScale !== 1) {
          renderContext.transform = [outputScale, 0, 0, outputScale, 0, 0];
        }
        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (!cancelled) setLoading(false);
      } catch (pdfError: any) {
        if (cancelled || pdfError?.name === 'RenderingCancelledException') return;
        setError(pdfError?.message ?? 'Impossible de charger le PDF');
        setLoading(false);
      }
    }

    renderPdfPage();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
      loadingTask?.destroy?.();
    };
  }, [uri, scale]);

  function handlePageClick(event: MouseEvent<HTMLDivElement>) {
    if (!pinModeReserveId && !canCreate) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clampPercent(((event.clientX - rect.left) / rect.width) * 100);
    const y = clampPercent(((event.clientY - rect.top) / rect.height) * 100);
    if (pinModeReserveId) {
      onAssignPin(x, y);
      return;
    }
    onCreateReserveAtPin?.(x, y);
  }

  return (
    <div className={styles.webPdfShell}>
      <div className={styles.webPdfToolbar}>
        <div className={styles.webPdfZoomControls}>
          <button type="button" onClick={() => setScale(value => Math.max(0.08, Number(((value || 1) - 0.1).toFixed(2))))}>−</button>
          <strong>{scale ? Math.round(scale * 100) : '…'}%</strong>
          <button type="button" onClick={() => setScale(value => Math.min(3, Number(((value || 1) + 0.1).toFixed(2))))}>+</button>
        </div>
        <button type="button" onClick={() => setScale(0)}>Adapter</button>
        <a href={uri} target="_blank" rel="noreferrer">Ouvrir le PDF</a>
      </div>
      <div ref={viewportRef} className={styles.webPdfViewport}>
        <div
          className={styles.webPdfPage}
          style={pageSize.width && pageSize.height ? { width: pageSize.width, height: pageSize.height } : undefined}
          onClick={handlePageClick}
          aria-label={name}
        >
          <canvas ref={canvasRef} className={styles.webPdfCanvas} />
          {loading && <div className={styles.webPdfLoading}>Chargement du plan…</div>}
          {error && (
            <div className={styles.webPdfError}>
              <strong>Plan PDF indisponible</strong>
              <span>{error}</span>
            </div>
          )}
          {pinModeReserveId && (
            <div className={styles.pdfPinHint}>
              Cliquez sur le PDF pour placer l’épingle
            </div>
          )}
          {placementPreview && (
            <div
              key={placementPreview.id}
              className={styles.pinPlacementPreview}
              style={{ left: `${placementPreview.x}%`, top: `${placementPreview.y}%` }}
            >
              <span>{placementPreview.label}</span>
            </div>
          )}
          {pins.map((pin) => (
            <button
              key={pin.reserve.id}
              className={`${styles.pin} ${focusedReserveId === pin.reserve.id ? styles.pinFocused : ''}`}
              style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
              title={pin.reserve.title}
              onClick={event => {
                event.stopPropagation();
                onPinClick(pin.reserve.id);
              }}
            >
              {pin.number}
            </button>
          ))}
        </div>
      </div>
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
  onCreateReserveAtPin,
  onAssignPin,
  pinModeReserveId,
  setPinModeReserveId,
  editable,
}: any) {
  const [buildingQuery, setBuildingQuery] = useState('');
  const [selectedBuildingKey, setSelectedBuildingKey] = useState('all');
  const [activeFamilyKey, setActiveFamilyKey] = useState('all');
  const [selectedPlanReserveId, setSelectedPlanReserveId] = useState<string | null>(null);
  const [focusedPlanReserveId, setFocusedPlanReserveId] = useState<string | null>(null);
  const [pinPlacementPreview, setPinPlacementPreview] = useState<PinPlacementPreview | null>(null);
  const pinPlacementTimerRef = useRef<number | null>(null);
  const planReserves = selectedPlan ? reserves.filter((r: any) => r.plan_id === selectedPlan.id) : [];
  const selectedPlanReserve = planReserves.find((reserve: any) => reserve.id === selectedPlanReserveId) ?? null;
  const pinTarget = reserves.find((reserve: any) => reserve.id === pinModeReserveId);
  const selectedPlanBuildingKey = selectedPlan ? getPlanBuildingKey(selectedPlan) : 'all';
  const buildingGroups = useMemo(() => {
    const map = new Map<string, {
      key: string;
      name: string;
      plans: any[];
      planIds: Set<string>;
      levels: Set<string>;
      reserveCount: number;
    }>();

    for (const plan of plans) {
      const key = getPlanBuildingKey(plan);
      const group = map.get(key) ?? {
        key,
        name: getPlanBuildingName(plan),
        plans: [],
        planIds: new Set<string>(),
        levels: new Set<string>(),
        reserveCount: 0,
      };
      group.plans.push(plan);
      group.planIds.add(plan.id);
      const level = getPlanLevelName(plan);
      if (level) group.levels.add(level);
      map.set(key, group);
    }

    const reserveIdsByBuilding = new Map<string, Set<string>>();
    for (const reserve of reserves) {
      if (reserve.archived_at || reserve.archivedAt) continue;
      const keys = new Set<string>();
      if (reserve.plan_id) {
        const planGroup = [...map.values()].find(group => group.planIds.has(reserve.plan_id));
        if (planGroup) keys.add(planGroup.key);
      }
      keys.add(getReserveBuildingKey(reserve));
      keys.forEach(key => {
        if (!map.has(key)) return;
        const ids = reserveIdsByBuilding.get(key) ?? new Set<string>();
        ids.add(reserve.id);
        reserveIdsByBuilding.set(key, ids);
      });
    }

    return [...map.values()]
      .map(group => ({
        ...group,
        reserveCount: reserveIdsByBuilding.get(group.key)?.size ?? 0,
        levels: [...group.levels].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })),
        plans: group.plans.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'fr', { numeric: true, sensitivity: 'base' })),
      }))
      .sort((a, b) => {
        if (a.key === '__none__') return 1;
        if (b.key === '__none__') return -1;
        return a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
      });
  }, [plans, reserves]);
  const buildingFamilies = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; groups: typeof buildingGroups }>();
    const others: typeof buildingGroups = [];

    for (const group of buildingGroups) {
      const family = group.key === '__none__' ? null : parseBuildingFamily(group.name);
      if (!family) {
        others.push(group);
        continue;
      }
      const bucket = buckets.get(family.key) ?? { key: family.key, label: family.label, groups: [] as typeof buildingGroups };
      bucket.groups.push(group);
      buckets.set(family.key, bucket);
    }

    const realFamilies = [...buckets.values()]
      .filter(family => family.groups.length >= 2)
      .sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true, sensitivity: 'base' }));
    const groupedKeys = new Set(realFamilies.flatMap(family => family.groups.map(group => group.key)));
    const ungrouped = [
      ...others,
      ...[...buckets.values()].flatMap(family => family.groups.filter(group => !groupedKeys.has(group.key))),
    ].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
    const useGrouping = realFamilies.length >= 2 && buildingGroups.length >= 8;
    return {
      useGrouping,
      families: useGrouping
        ? [
            ...realFamilies,
            ...(ungrouped.length ? [{ key: '__others__', label: 'Autres', groups: ungrouped }] : []),
          ]
        : [],
      familyOf: new Map(realFamilies.flatMap(family => family.groups.map(group => [group.key, family.key] as const))),
    };
  }, [buildingGroups]);
  useEffect(() => {
    if (!buildingFamilies.useGrouping && activeFamilyKey !== 'all') setActiveFamilyKey('all');
    if (buildingFamilies.useGrouping && activeFamilyKey !== 'all' && !buildingFamilies.families.some(family => family.key === activeFamilyKey)) {
      setActiveFamilyKey('all');
    }
  }, [activeFamilyKey, buildingFamilies]);
  const filteredBuildingGroups = useMemo(() => {
    const query = normalizeSearchText(buildingQuery);
    const familyFiltered = !query && buildingFamilies.useGrouping && activeFamilyKey !== 'all'
      ? buildingGroups.filter(group => (buildingFamilies.familyOf.get(group.key) ?? '__others__') === activeFamilyKey)
      : buildingGroups;
    if (!query) {
      return familyFiltered.map(group => ({ ...group, displayPlans: group.plans }));
    }
    return familyFiltered
      .map(group => {
        const groupMatches = normalizeSearchText(group.name).includes(query);
        const displayPlans = groupMatches
          ? group.plans
          : group.plans.filter(plan => normalizeSearchText([
              plan.name,
              getPlanBuildingName(plan),
              getPlanLevelName(plan),
              plan.revision_code,
              plan.file_type,
            ].filter(Boolean).join(' ')).includes(query));
        return { ...group, displayPlans };
      })
      .filter(group => group.displayPlans.length > 0);
  }, [activeFamilyKey, buildingFamilies, buildingGroups, buildingQuery]);
  const totalReserveCount = buildingGroups.reduce((sum, group) => sum + group.reserveCount, 0);
  useEffect(() => {
    setSelectedPlanReserveId(null);
    setFocusedPlanReserveId(null);
    setPinPlacementPreview(null);
  }, [selectedPlan?.id]);
  useEffect(() => {
    if (!focusedPlanReserveId) return;
    const timer = window.setTimeout(() => setFocusedPlanReserveId(null), 7000);
    return () => window.clearTimeout(timer);
  }, [focusedPlanReserveId]);
  useEffect(() => {
    return () => {
      if (pinPlacementTimerRef.current) window.clearTimeout(pinPlacementTimerRef.current);
    };
  }, []);
  const handleSelectBuildingGroup = (group: { key: string; plans: any[] }) => {
    setSelectedBuildingKey(group.key);
    if (!group.plans.some(plan => plan.id === selectedPlan?.id) && group.plans[0]) {
      setSelectedPlanId(group.plans[0].id);
    }
  };
  const assignOrCreatePinAt = (x: number, y: number) => {
    if (!selectedPlan) return;
    const nextX = Math.round(clampPercent(x));
    const nextY = Math.round(clampPercent(y));
    const preview: PinPlacementPreview = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      planId: selectedPlan.id,
      x: nextX,
      y: nextY,
      label: pinModeReserveId ? 'Épingle déplacée' : 'Nouvelle épingle',
    };
    setPinPlacementPreview(preview);
    if (pinPlacementTimerRef.current) window.clearTimeout(pinPlacementTimerRef.current);
    if (pinModeReserveId) {
      onAssignPin(pinModeReserveId, selectedPlan.id, nextX, nextY);
      pinPlacementTimerRef.current = window.setTimeout(() => setPinPlacementPreview(null), 900);
      return;
    }
    if (!editable) return;
    pinPlacementTimerRef.current = window.setTimeout(() => {
      setPinPlacementPreview(null);
      onCreateReserveAtPin(selectedPlan, { planId: selectedPlan.id, x: nextX, y: nextY });
    }, 520);
  };
  const planPins = planReserves
    .map((reserve: any, idx: number) => {
      const rawX = Number(reserve.plan_x);
      const rawY = Number(reserve.plan_y);
      // Historical web pins could be saved as 0..1. Mobile pins are 0..100.
      const ratioMode = Number.isFinite(rawX) && Number.isFinite(rawY) && Math.abs(rawX) <= 1 && Math.abs(rawY) <= 1;
      return {
        reserve,
        number: idx + 1,
        x: planCoordinateToPercent(reserve.plan_x, ratioMode),
        y: planCoordinateToPercent(reserve.plan_y, ratioMode),
      };
    })
    .filter((pin: any) => pin.x != null && pin.y != null) as PlanPin[];
  return (
    <div className={`${styles.twoCols} ${styles.plansLayout}`}>
      <section className={`${styles.panel} ${styles.plansListPanel}`}>
        <div className={styles.buildingRailHeaderWeb}>
          <div>
            <span>Bâtiments</span>
            <strong>{buildingGroups.length}</strong>
          </div>
          <small>Recherche, familles et plans regroupés.</small>
        </div>
        <label className={styles.buildingRailSearchWeb}>
          <span>⌕</span>
          <input
            value={buildingQuery}
            onChange={event => setBuildingQuery(event.target.value)}
            placeholder="Rechercher bâtiment, niveau, plan..."
          />
          {buildingQuery && (
            <button type="button" onClick={() => setBuildingQuery('')} aria-label="Effacer la recherche">×</button>
          )}
        </label>
        {buildingFamilies.useGrouping && !buildingQuery && (
          <div className={styles.buildingFamilyRowWeb}>
            <button
              type="button"
              className={activeFamilyKey === 'all' ? styles.buildingFamilyActiveWeb : ''}
              onClick={() => setActiveFamilyKey('all')}
            >
              Tous <em>{buildingGroups.length}</em>
            </button>
            {buildingFamilies.families.map(family => (
              <button
                key={family.key}
                type="button"
                className={activeFamilyKey === family.key ? styles.buildingFamilyActiveWeb : ''}
                onClick={() => setActiveFamilyKey(family.key)}
              >
                {family.label} <em>{family.groups.length}</em>
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={`${styles.buildingAllRowWeb} ${selectedBuildingKey === 'all' ? styles.buildingGroupActiveWeb : ''}`}
          onClick={() => setSelectedBuildingKey('all')}
        >
          <span>▦</span>
          <strong>Tous les bâtiments</strong>
          <small>{plans.length} plans · {totalReserveCount} réserves</small>
        </button>
        <div className={`${styles.list} ${styles.plansList}`}>
          {filteredBuildingGroups.map((group: any) => {
            const isSelectedGroup = selectedBuildingKey === group.key || (selectedBuildingKey === 'all' && selectedPlanBuildingKey === group.key);
            const isExpanded = Boolean(buildingQuery) || isSelectedGroup;
            return (
              <article key={group.key} className={`${styles.buildingGroupWeb} ${isSelectedGroup ? styles.buildingGroupActiveWeb : ''}`}>
                <button type="button" className={styles.buildingGroupButtonWeb} onClick={() => handleSelectBuildingGroup(group)}>
                  <span className={styles.buildingGroupIconWeb}>{group.key === '__none__' ? '◇' : '▥'}</span>
                  <div>
                    <strong>{group.name}</strong>
                    <small>
                      {group.plans.length} plans
                      {group.levels.length ? ` · ${group.levels.slice(0, 3).join(', ')}${group.levels.length > 3 ? '…' : ''}` : ''}
                    </small>
                  </div>
                  <em>{group.reserveCount}</em>
                </button>
                {isExpanded && (
                  <div className={styles.buildingPlanListWeb}>
                    {group.displayPlans.map((plan: any) => {
                      const planReserveCount = reserves.filter((reserve: any) => reserve.plan_id === plan.id && !reserve.archived_at && !reserve.archivedAt).length;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          className={`${styles.buildingPlanRowWeb} ${selectedPlan?.id === plan.id ? styles.selectedRow : ''}`}
                          onClick={() => {
                            setSelectedBuildingKey(group.key);
                            setSelectedPlanId(plan.id);
                          }}
                        >
                          <span>▤</span>
                          <div>
                            <strong>{plan.name}</strong>
                            <small>{[getPlanLevelName(plan), plan.revision_code].filter(Boolean).join(' · ') || 'Plan'}</small>
                          </div>
                          <em>{planReserveCount}</em>
                        </button>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
          {filteredBuildingGroups.length === 0 && (
            <p className={styles.empty}>Aucun bâtiment ou plan ne correspond à cette recherche.</p>
          )}
          {!plans.length && <p className={styles.empty}>Aucun plan dans ce périmètre.</p>}
        </div>
      </section>
      <section className={`${styles.panel} ${styles.plansPreviewPanel}`}>
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
                  <span>{pinTarget ? `Cliquez sur le plan pour placer : ${pinTarget.title}` : 'Choisissez une réserve à déplacer, ou cliquez sur le plan pour créer une réserve à cet endroit.'}</span>
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
            <div className={styles.planWorkArea}>
              <div className={styles.planCanvas}>
                {selectedPlan.uri && selectedPlan.file_type === 'image' ? (
                  <img src={selectedPlan.uri} alt={selectedPlan.name} />
                ) : selectedPlan.uri && selectedPlan.file_type === 'pdf' ? (
                  <WebPdfPlan
                    uri={selectedPlan.uri}
                    name={selectedPlan.name}
                    pins={planPins}
                    focusedReserveId={focusedPlanReserveId}
                    pinModeReserveId={pinModeReserveId}
                    canCreate={editable}
                    placementPreview={pinPlacementPreview?.planId === selectedPlan.id ? pinPlacementPreview : null}
                    onAssignPin={assignOrCreatePinAt}
                    onCreateReserveAtPin={assignOrCreatePinAt}
                    onPinClick={(reserveId) => {
                      setSelectedPlanReserveId(reserveId);
                      setFocusedPlanReserveId(reserveId);
                    }}
                  />
                ) : (
                  <div className={styles.planPlaceholder}>Aperçu web disponible dès que le fichier est accessible.</div>
                )}
                {selectedPlan.file_type !== 'pdf' && (pinModeReserveId || editable) && (
                  <button
                    type="button"
                    className={`${styles.pinClickLayer} ${!pinModeReserveId ? styles.pinCreateLayer : ''}`}
                    aria-label={pinModeReserveId ? 'Cliquer pour placer l’épingle' : 'Cliquer pour créer une réserve à cet endroit'}
                    onClick={event => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      assignOrCreatePinAt(
                        ((event.clientX - rect.left) / rect.width) * 100,
                        ((event.clientY - rect.top) / rect.height) * 100,
                      );
                    }}
                  >
                    {pinModeReserveId ? <span>Cliquer pour placer l’épingle</span> : null}
                  </button>
                )}
                {selectedPlan.file_type !== 'pdf' && planPins.map((pin) => (
                    <button
                      key={pin.reserve.id}
                      className={styles.pin}
                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                      title={pin.reserve.title}
                      onClick={event => {
                        event.stopPropagation();
                        setSelectedReserveId(pin.reserve.id);
                        setTab('reserves');
                      }}
                    >
                      {pin.number}
                    </button>
                  ))}
                {selectedPlan.file_type !== 'pdf' && pinPlacementPreview?.planId === selectedPlan.id && (
                  <div
                    key={pinPlacementPreview.id}
                    className={styles.pinPlacementPreview}
                    style={{ left: `${pinPlacementPreview.x}%`, top: `${pinPlacementPreview.y}%` }}
                  >
                    <span>{pinPlacementPreview.label}</span>
                  </div>
                )}
              </div>
              <aside className={styles.planReservePanel}>
                <div className={styles.planReserveHeader}>
                  <div>
                    <h3>Réserves</h3>
                    <span>{planReserves.length} sur ce plan</span>
                  </div>
                  <strong>{planPins.length} épinglées</strong>
                </div>
                <div className={styles.planReserveList}>
                  {planReserves.map((reserve: any, idx: number) => (
                    <button
                      key={reserve.id}
                      className={`${styles.planReserveRow} ${selectedPlanReserveId === reserve.id ? styles.planReserveRowActive : ''}`}
                      onClick={() => setSelectedPlanReserveId(reserve.id)}
                    >
                      <span className={styles.planReserveNumber}>{idx + 1}</span>
                      <span>
                        <strong>{reserve.title}</strong>
                        <small>{[STATUS_LABELS[reserve.status] ?? reserve.status, reserve.company_name, reserve.zone].filter(Boolean).join(' · ')}</small>
                      </span>
                    </button>
                  ))}
                  {!planReserves.length && (
                    <div className={styles.planReserveEmpty}>
                      <strong>Aucune réserve</strong>
                      <span>Les réserves épinglées sur ce plan apparaîtront ici.</span>
                    </div>
                  )}
                </div>
                {selectedPlanReserve && (
                  <div className={styles.planReserveQuickCard}>
                    <div className={styles.planReserveQuickHeader}>
                      <span className={styles.planReserveNumber}>
                        {planReserves.findIndex((reserve: any) => reserve.id === selectedPlanReserve.id) + 1}
                      </span>
                      <div>
                        <strong>{selectedPlanReserve.title}</strong>
                        <small>{[STATUS_LABELS[selectedPlanReserve.status] ?? selectedPlanReserve.status, selectedPlanReserve.company_name, selectedPlanReserve.level].filter(Boolean).join(' · ')}</small>
                      </div>
                      <button type="button" onClick={() => setSelectedPlanReserveId(null)} aria-label="Fermer">×</button>
                    </div>
                    {selectedPlanReserve.description && (
                      <p>{selectedPlanReserve.description}</p>
                    )}
                    <div className={styles.planReserveQuickActions}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReserveId(selectedPlanReserve.id);
                          setTab('reserves');
                        }}
                      >
                        Voir la réserve
                      </button>
                      <button
                        type="button"
                        disabled={selectedPlanReserve.plan_x == null || selectedPlanReserve.plan_y == null}
                        onClick={() => setFocusedPlanReserveId(selectedPlanReserve.id)}
                      >
                        {selectedPlanReserve.plan_x == null || selectedPlanReserve.plan_y == null ? 'Pas d’épingle' : 'Voir sur le plan'}
                      </button>
                    </div>
                  </div>
                )}
              </aside>
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

function PlanningView({ tasks, visites, reserves, companies, editable, onUpdateTask }: any) {
  const [mode, setMode] = useState<'week' | 'company' | 'late'>('week');
  const now = new Date();
  const sortedTasks = [...tasks].sort((a: any, b: any) => new Date(a.deadline ?? a.created_at ?? 0).getTime() - new Date(b.deadline ?? b.created_at ?? 0).getTime());
  const visibleTasks = sortedTasks.filter((task: any) => {
    if (mode === 'late') return task.deadline && new Date(task.deadline) < now && task.status !== 'done';
    return true;
  });
  const upcomingVisits = [...visites]
    .sort((a: any, b: any) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime())
    .slice(0, 8);
  const reserveDeadlines = [...reserves]
    .filter((reserve: any) => reserve.deadline && reserve.status !== 'closed')
    .sort((a: any, b: any) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
    .slice(0, 10);

  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Tâches" value={tasks.length} hint="Actions planifiées" />
        <Kpi title="En retard" value={tasks.filter((task: any) => task.deadline && new Date(task.deadline) < now && task.status !== 'done').length} hint="À reprendre vite" tone="red" />
        <Kpi title="Visites à venir" value={upcomingVisits.length} hint="Planning chantier" tone="green" />
        <Kpi title="Échéances réserves" value={reserveDeadlines.length} hint="Réserves actives" tone="amber" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Planning opérationnel</h2>
            <p>Vue web des tâches, visites et échéances de réserves.</p>
          </div>
          <div className={styles.segmented}>
            <button type="button" className={mode === 'week' ? styles.segmentedActive : ''} onClick={() => setMode('week')}>Semaine</button>
            <button type="button" className={mode === 'company' ? styles.segmentedActive : ''} onClick={() => setMode('company')}>Entreprise</button>
            <button type="button" className={mode === 'late' ? styles.segmentedActive : ''} onClick={() => setMode('late')}>Retard</button>
          </div>
        </div>
        <div className={styles.timelineGrid}>
          <div>
            <h3>Tâches</h3>
            <div className={styles.timelineList}>
              {visibleTasks.slice(0, 18).map((task: any) => {
                const company = companies.find((item: any) => item.id === task.company || item.name === task.company);
                return (
                  <article key={task.id} className={styles.timelineCard}>
                    <span className={`${styles.statusDot} ${task.status === 'done' ? styles.dotDone : task.status === 'delayed' ? styles.dotLate : ''}`} />
                    <div>
                      <strong>{task.title ?? 'Tâche'}</strong>
                    <small>{company?.name ?? task.company ?? 'Sans entreprise'} · {prettyDate(task.deadline)}</small>
                    <div className={styles.progressMini}><span style={{ width: `${Math.max(0, Math.min(100, Number(task.progress ?? 0)))}%` }} /></div>
                    {editable && (
                      <div className={styles.quickTaskActions}>
                        <button type="button" disabled={task.status === 'todo'} onClick={() => onUpdateTask(task, { status: 'todo', progress: Math.min(Number(task.progress ?? 0), 10) })}>À faire</button>
                        <button type="button" disabled={task.status === 'in_progress'} onClick={() => onUpdateTask(task, { status: 'in_progress', progress: Math.max(Number(task.progress ?? 0), 25) })}>En cours</button>
                        <button type="button" disabled={task.status === 'done'} onClick={() => onUpdateTask(task, { status: 'done', progress: 100 })}>Terminée</button>
                      </div>
                    )}
                  </div>
                    <em>{task.progress ?? 0}%</em>
                  </article>
                );
              })}
              {!visibleTasks.length && <p className={styles.empty}>Aucune tâche dans cette vue.</p>}
            </div>
          </div>
          <div>
            <h3>Visites et échéances</h3>
            <div className={styles.timelineList}>
              {upcomingVisits.map((visit: any) => (
                <article key={visit.id} className={styles.timelineCard}>
                  <span className={styles.statusDot} />
                  <div>
                    <strong>{visit.title}</strong>
                    <small>{prettyDate(visit.date)} · {[visit.building, visit.level].filter(Boolean).join(' · ') || 'Périmètre chantier'}</small>
                  </div>
                  <em>{VISIT_STATUS_LABELS[visit.status as VisitDraft['status']] ?? visit.status}</em>
                </article>
              ))}
              {reserveDeadlines.map((reserve: any) => (
                <article key={reserve.id} className={styles.timelineCard}>
                  <span className={`${styles.statusDot} ${styles.dotLate}`} />
                  <div>
                    <strong>{reserve.title}</strong>
                    <small>Échéance réserve · {prettyDate(reserve.deadline)}</small>
                  </div>
                  <em>{STATUS_LABELS[reserve.status] ?? reserve.status}</em>
                </article>
              ))}
              {!upcomingVisits.length && !reserveDeadlines.length && <p className={styles.empty}>Aucune échéance proche.</p>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MediaView({ photos, documents }: { photos: any[]; documents: any[] }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filteredPhotos = photos.filter(photo => !q || [photo.title, photo.name, photo.comment, photo.location, photo.taken_by, photo.takenBy].join(' ').toLowerCase().includes(q));
  const filteredDocuments = documents.filter(document => !q || [document.title, document.name, document.file_name, document.category].join(' ').toLowerCase().includes(q));
  return (
    <div className={styles.stack}>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Médias chantier</h2>
            <p>Photos, documents et pièces jointes synchronisés depuis le terrain.</p>
          </div>
          <input className={styles.compactSearch} value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher média, zone, auteur..." />
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Photos</h2>
        <div className={styles.mediaGrid}>
          {filteredPhotos.map((photo: any) => {
            const url = assetUrl(photo);
            return (
              <a key={photo.id ?? url} className={styles.mediaCard} href={url || undefined} target={url ? '_blank' : undefined} aria-disabled={!url}>
                {url ? <img src={url} alt={photo.comment ?? photo.title ?? 'Photo chantier'} /> : <span>Photo</span>}
                <strong>{photo.comment ?? photo.title ?? photo.name ?? 'Photo chantier'}</strong>
                <small>{photo.location ?? photo.building ?? 'Sans localisation'} · {prettyDate(photo.taken_at ?? photo.takenAt ?? photo.created_at, true)}</small>
              </a>
            );
          })}
          {!filteredPhotos.length && <p className={styles.empty}>Aucune photo trouvée.</p>}
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Documents</h2>
        <div className={styles.documentList}>
          {filteredDocuments.map((document: any) => {
            const url = assetUrl(document);
            return (
              <a key={document.id ?? url} className={styles.documentRow} href={url || undefined} target={url ? '_blank' : undefined} aria-disabled={!url}>
                <span>{String(document.file_type ?? document.type ?? 'DOC').slice(0, 4).toUpperCase()}</span>
                <div>
                  <strong>{document.title ?? document.name ?? document.file_name ?? 'Document'}</strong>
                  <small>{document.category ?? 'GED'} · {prettyDate(document.uploaded_at ?? document.created_at, true)}</small>
                </div>
              </a>
            );
          })}
          {!filteredDocuments.length && <p className={styles.empty}>Aucun document trouvé.</p>}
        </div>
      </section>
    </div>
  );
}

function RapportsView({
  stats,
  reserves,
  plans,
  visites,
  incidents,
  tasks,
  selectedReserve,
  language,
  setLanguage,
  generatingReport,
  onGenerate,
}: any) {
  const disabled = Boolean(generatingReport);
  const [selectedVisitId, setSelectedVisitId] = useState('');
  const selectedVisit = visites.find((visit: any) => visit.id === selectedVisitId) ?? visites[0] ?? null;
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Réserves exportables" value={reserves.length} hint={`${stats.closed} clôturées`} />
        <Kpi title="Plans" value={plans.length} hint="Avec réserves et épingles" tone="green" />
        <Kpi title="Visites" value={visites.length} hint="Comptes rendus" tone="amber" />
        <Kpi title="Incidents" value={incidents.length} hint="Suivi sécurité" tone="red" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Exports et rapports</h2>
            <p>Générez les PDF depuis le web avec les mêmes données Supabase que l’application mobile.</p>
          </div>
          <div className={styles.segmented}>
            {(['fr', 'en', 'es'] as const).map(lang => (
              <button key={lang} type="button" className={language === lang ? styles.segmentedActive : ''} onClick={() => setLanguage(lang)}>
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.reportGrid}>
          <ReportCard
            title="Rapport réserves"
            text="Liste détaillée, synthèse par statut et par entreprise."
            meta={`${reserves.length} réserves`}
            disabled={disabled}
            loading={generatingReport === `global_reserves-${language}`}
            onClick={() => onGenerate('global_reserves')}
          />
          <ReportCard
            title="Rapport plans"
            text="Plans, épingles et réserves associées."
            meta={`${plans.length} plans`}
            disabled={disabled}
            loading={generatingReport === `plans-${language}`}
            onClick={() => onGenerate('plans')}
          />
          <ReportCard
            title="Fiche réserve"
            text="Export individuel de la réserve sélectionnée."
            meta={selectedReserve ? selectedReserve.id : 'Aucune réserve sélectionnée'}
            disabled={disabled || !selectedReserve}
            loading={generatingReport === `individual_reserve-${language}`}
            onClick={() => onGenerate('individual_reserve')}
          />
          <article className={styles.reportCard}>
            <strong>Compte rendu de visite</strong>
            <p>Export structure avec informations de visite, checklist, notes et reserves rattachees.</p>
            <select value={selectedVisit?.id ?? ''} onChange={event => setSelectedVisitId(event.target.value)}>
              {visites.map((visit: any) => (
                <option key={visit.id} value={visit.id}>{visit.title}</option>
              ))}
            </select>
            <small>{visites.length} visites · {tasks.length} taches · {incidents.length} incidents</small>
            <button
              type="button"
              disabled={disabled || !selectedVisit}
              onClick={() => onGenerate('visit_report', { visit: selectedVisit })}
            >
              {generatingReport === `visit_report-${language}` ? 'Generation...' : 'Telecharger PDF'}
            </button>
          </article>
        </div>
      </section>
    </div>
  );
}

function ReportCard({ title, text, meta, disabled, loading, onClick }: any) {
  return (
    <article className={styles.reportCard}>
      <strong>{title}</strong>
      <p>{text}</p>
      <small>{meta}</small>
      <button type="button" disabled={disabled} onClick={onClick}>{loading ? 'Génération...' : 'Télécharger PDF'}</button>
    </article>
  );
}

function MessagesView({ channels, companies, selectedChannel, setSelectedChannelId, messages, draft, setDraft, onSend, saving }: any) {
  return (
    <div className={styles.twoCols}>
      <section className={styles.panel}>
        <div className={styles.list}>
          {channels.map((channel: any) => (
            <button key={channel.id} className={`${styles.listRow} ${selectedChannel?.id === channel.id ? styles.selectedRow : ''}`} onClick={() => setSelectedChannelId(channel.id)}>
              <span>○</span>
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
  const project = data.chantiers.find(item => item.id === projectId) ?? null;
  const plans = data.sitePlans.filter(plan => getChantierId(plan) === projectId);
  const visits = data.visites.filter(visit => getChantierId(visit) === projectId);
  const lots = data.lots.filter(lot => {
    const lotProjectId = getChantierId(lot);
    return !lotProjectId || lotProjectId === projectId;
  });
  const selectedVisit = visits.find(visit => visit.id === draft.visiteId) ?? null;
  const visitLocations = getVisitLocations(selectedVisit);
  const visitScopedBuildingIds = new Set(visitLocations.map(location => location.buildingId ?? location.building_id).filter(Boolean));
  const visitScopedBuildingNames = new Set(visitLocations.map(location => location.buildingName ?? location.building_name).filter(Boolean));
  const buildings = projectBuildings(project);
  const buildingOptions = visitLocations.length
    ? buildings.filter(building => visitScopedBuildingIds.has(building.id) || visitScopedBuildingNames.has(building.name))
    : buildings;
  const selectedBuilding = buildingOptions.find(building =>
    (draft.buildingId && building.id === draft.buildingId) || sameName(building.name, draft.building)
  ) ?? null;
  const visitLocationForBuilding = visitLocations.find(location =>
    (selectedBuilding?.id && (location.buildingId === selectedBuilding.id || location.building_id === selectedBuilding.id)) ||
    sameName(location.buildingName ?? location.building_name, selectedBuilding?.name ?? draft.building)
  );
  const allowedLevelIds = new Set((visitLocationForBuilding?.levelIds ?? visitLocationForBuilding?.level_ids ?? []).filter(Boolean));
  const levelOptions = selectedBuilding?.levels
    ? selectedBuilding.levels.filter((level: any) => allowedLevelIds.size === 0 || allowedLevelIds.has(level.id))
    : [];
  const selectedLot = lots.find(lot => lot.id === draft.lotId) ?? null;
  const selectedPlan = plans.find(plan => plan.id === draft.planId) ?? null;
  const filteredPlans = plans.filter(plan => {
    const location = getPlanDisplayLocation(plan, project);
    if (visitLocations.length > 0 && location.building) {
      const inScope = (location.buildingId && visitScopedBuildingIds.has(location.buildingId)) || visitScopedBuildingNames.has(location.building);
      if (!inScope) return false;
    }
    if (!draft.building && !draft.level) return true;
    const matchesBuilding = !location.building || !draft.building
      ? true
      : location.buildingId && draft.buildingId
        ? location.buildingId === draft.buildingId
        : sameName(location.building, draft.building);
    const matchesLevel = !location.level || !draft.level
      ? true
      : location.levelId && draft.levelId
        ? location.levelId === draft.levelId
        : sameName(location.level, draft.level);
    return matchesBuilding && matchesLevel;
  });
  const previewId = mode === 'edit'
    ? draft.title ? 'Réserve existante' : 'Modification'
    : generateReserveId(data.reserves, data.lots, draft.lotId);
  const selectedCompanyCount = draft.companies.length;
  const hasCapturedPin = Boolean(draft.planId && draft.planX != null && draft.planY != null);

  function updateTitle(value: string) {
    setDraft(prev => {
      const shouldMirrorDescription = !prev.description.trim() || prev.description === prev.title;
      return { ...prev, title: value, description: shouldMirrorDescription ? value : prev.description };
    });
  }

  function reuseTitleAsDescription() {
    setDraft(prev => ({ ...prev, description: prev.title.trim() }));
  }

  function applyBuilding(buildingId: string) {
    const building = buildingOptions.find(item => item.id === buildingId);
    setDraft(prev => ({
      ...prev,
      buildingId,
      building: building?.name ?? '',
      level: '',
      levelId: '',
      planId: '',
      planX: null,
      planY: null,
      placePinAfterCreate: false,
    }));
  }

  function applyLevel(levelId: string) {
    const level = levelOptions.find((item: any) => item.id === levelId);
    setDraft(prev => ({
      ...prev,
      levelId,
      level: level?.name ?? '',
      planId: '',
      planX: null,
      planY: null,
      placePinAfterCreate: false,
    }));
  }

  function applyPlan(planId: string) {
    const plan = plans.find(item => item.id === planId);
    const location = plan ? getPlanDisplayLocation(plan, project) : null;
    setDraft(prev => ({
      ...prev,
      planId,
      building: location?.building || prev.building,
      buildingId: location?.buildingId || prev.buildingId,
      level: location?.level || prev.level,
      levelId: location?.levelId || prev.levelId,
      planX: prev.planId === planId ? prev.planX : null,
      planY: prev.planId === planId ? prev.planY : null,
      placePinAfterCreate: !planId
        ? false
        : mode === 'create' && prev.planId !== planId
          ? true
          : prev.placePinAfterCreate,
    }));
  }

  function applyVisit(visitId: string) {
    const visit = visits.find(item => item.id === visitId);
    if (!visit) {
      setDraft(prev => ({ ...prev, visiteId: '', deadline: '', planId: '', planX: null, planY: null, placePinAfterCreate: false }));
      return;
    }
    const visitCompanyNames = getVisitCompanyIds(visit)
      .map(companyId => data.companies.find(company => company.id === companyId)?.name)
      .filter((name): name is string => !!name);
    const locations = getVisitLocations(visit);
    const singleLocation = locations.length === 1 ? locations[0] : null;
    const buildingId = singleLocation?.buildingId ?? singleLocation?.building_id ?? '';
    const buildingName = singleLocation?.buildingName ?? singleLocation?.building_name ?? visit.building ?? '';
    const defaultPlanId = singleLocation?.defaultPlanId ?? singleLocation?.default_plan_id ?? getVisitDefaultPlanId(visit);
    const defaultPlan = plans.find(plan => plan.id === defaultPlanId);
    const defaultLocation = defaultPlan ? getPlanDisplayLocation(defaultPlan, project) : null;
    setDraft(prev => ({
      ...prev,
      visiteId: visit.id,
      deadline: getVisitReserveDeadline(visit) || prev.deadline,
      companies: visitCompanyNames.length ? visitCompanyNames : prev.companies,
      building: defaultLocation?.building || buildingName || (locations.length > 1 ? '' : visit.building || prev.building),
      buildingId: defaultLocation?.buildingId || buildingId || (locations.length > 1 ? '' : prev.buildingId),
      level: defaultLocation?.level || (locations.length > 1 ? '' : visit.level || prev.level),
      levelId: defaultLocation?.levelId || (locations.length > 1 ? '' : prev.levelId),
      zone: visit.zone ?? prev.zone,
      planId: defaultPlanId || prev.planId,
      planX: null,
      planY: null,
      placePinAfterCreate: mode === 'create' && Boolean(defaultPlanId),
    }));
  }

  function applyLot(lotId: string) {
    const lot = lots.find(item => item.id === lotId);
    const companyId = lot?.company_id ?? lot?.companyId;
    const companyName = companyId ? data.companies.find(company => company.id === companyId)?.name : '';
    setDraft(prev => ({
      ...prev,
      lotId,
      companies: companyName ? [companyName] : prev.companies,
    }));
  }

  function applyDeadlinePreset(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    setDraft(prev => ({ ...prev, deadline: date.toISOString().slice(0, 10) }));
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <form className={`${styles.modalPanel} ${styles.reserveModalPanel}`} onSubmit={onSubmit}>
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.eyebrow}>{mode === 'edit' ? 'Modification' : 'Création'}</p>
            <h2>{mode === 'edit' ? 'Modifier la réserve' : 'Nouvelle réserve'}</h2>
            <span>{project?.name ?? 'Chantier'} · {previewId}</span>
          </div>
          <button type="button" onClick={onClose}>Fermer</button>
        </div>
        <div className={styles.reserveModalBody}>
          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Constat</strong>
                <span>Titre, description et type de saisie.</span>
              </div>
              <div className={styles.segmented}>
                {[
                  ['reserve', 'Réserve'],
                  ['observation', 'Observation'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={draft.kind === value ? styles.segmentedActive : ''}
                    onClick={() => setDraft(prev => ({ ...prev, kind: value as ReserveDraft['kind'] }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.reserveModalGrid}>
              <label className={styles.formWide}>
                Titre *
                <input value={draft.title} onChange={event => updateTitle(event.target.value)} placeholder="Ex: Finition mur à reprendre" required />
              </label>
              <label className={styles.formWide}>
                <span className={styles.reserveLabelRow}>
                  Description
                  {draft.title.trim() && draft.description.trim() !== draft.title.trim() ? (
                    <button type="button" onClick={reuseTitleAsDescription}>Copier le titre</button>
                  ) : null}
                </span>
                <textarea value={draft.description} onChange={event => setDraft(prev => ({ ...prev, description: event.target.value }))} rows={4} />
              </label>
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Contexte chantier</strong>
                <span>La visite peut limiter les bâtiments et reprendre l’échéance.</span>
              </div>
            </div>
            <div className={styles.reserveModalGrid}>
              <label>
                Chantier
                <select value={projectId} onChange={event => setDraft(prev => ({ ...prev, chantierId: event.target.value, building: '', buildingId: '', level: '', levelId: '', planId: '', planX: null, planY: null, visiteId: '', placePinAfterCreate: false }))}>
                  {data.chantiers.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label>
                Visite associée
                <select value={draft.visiteId} onChange={event => applyVisit(event.target.value)}>
                  <option value="">Aucune visite</option>
                  {visits.map(visit => <option key={visit.id} value={visit.id}>{visit.title}</option>)}
                </select>
              </label>
              {visitLocations.length > 0 ? (
                <div className={styles.formWide}>
                  <div className={styles.reserveNotice}>
                    <strong>Périmètre de visite</strong>
                    <span>{visitLocations.length} bâtiment{visitLocations.length > 1 ? 's' : ''} autorisé{visitLocations.length > 1 ? 's' : ''}. Les autres bâtiments sont masqués, comme sur mobile.</span>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Localisation et plan</strong>
                <span>Le plan est filtré selon le bâtiment et le niveau sélectionnés.</span>
              </div>
            </div>
            <div className={styles.reserveModalGrid}>
              {buildingOptions.length ? (
                <label>
                  Bâtiment *
                  <select value={draft.buildingId || selectedBuilding?.id || ''} onChange={event => applyBuilding(event.target.value)}>
                    <option value="">Sélectionner...</option>
                    {buildingOptions.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
                  </select>
                </label>
              ) : (
                <label>
                  Bâtiment *
                  <input value={draft.building} onChange={event => setDraft(prev => ({ ...prev, building: event.target.value, buildingId: '' }))} />
                </label>
              )}
              {levelOptions.length ? (
                <label>
                  Niveau *
                  <select value={draft.levelId || ''} onChange={event => applyLevel(event.target.value)}>
                    <option value="">Sélectionner...</option>
                    {levelOptions.map((level: any) => <option key={level.id} value={level.id}>{level.name}</option>)}
                  </select>
                </label>
              ) : (
                <label>
                  Niveau *
                  <input value={draft.level} onChange={event => setDraft(prev => ({ ...prev, level: event.target.value, levelId: '' }))} />
                </label>
              )}
              <label>
                Zone
                <input value={draft.zone} onChange={event => setDraft(prev => ({ ...prev, zone: event.target.value }))} placeholder="Ex: couloir, local, façade..." />
              </label>
              <label>
                Plan associé
                <select value={draft.planId} onChange={event => applyPlan(event.target.value)}>
                  <option value="">Aucun plan</option>
                  {filteredPlans.map(plan => {
                    const location = getPlanDisplayLocation(plan, project);
                    return (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}{location.building ? ` · ${location.building}${location.level ? ` / ${location.level}` : ''}` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              {draft.planId && hasCapturedPin ? (
                <div className={`${styles.formWide} ${styles.reservePinCaptured}`}>
                  <div>
                    <strong>Épingle capturée sur le plan</strong>
                    <small>
                      La réserve sera créée directement à cette position
                      {draft.planX != null && draft.planY != null ? ` (${Math.round(draft.planX)} %, ${Math.round(draft.planY)} %).` : '.'}
                    </small>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft(prev => ({
                      ...prev,
                      planX: null,
                      planY: null,
                      placePinAfterCreate: mode === 'create' && !!prev.planId,
                    }))}
                  >
                    Retirer
                  </button>
                </div>
              ) : draft.planId ? (
                <label className={`${styles.formWide} ${styles.reservePinFollowUp}`}>
                  <input
                    type="checkbox"
                    checked={mode === 'create' && draft.placePinAfterCreate}
                    disabled={mode === 'edit'}
                    onChange={event => setDraft(prev => ({ ...prev, placePinAfterCreate: event.target.checked }))}
                  />
                  <span>
                    <strong>Positionner l’épingle après création</strong>
                    <small>{selectedPlan?.name ?? 'Le plan associé'} s’ouvrira directement avec cette réserve sélectionnée.</small>
                  </span>
                </label>
              ) : (
                <div className={styles.formWide}>
                  <div className={styles.reserveNoticeWarning}>
                    Sans plan associé, la réserve sera créée hors plan et pourra être épinglée plus tard.
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Responsables et suivi</strong>
                <span>Entreprise, lot, priorité et délai cible.</span>
              </div>
              <span className={styles.reserveCountPill}>{selectedCompanyCount} sélectionnée{selectedCompanyCount > 1 ? 's' : ''}</span>
            </div>
            <div className={styles.reserveModalGrid}>
              <label>
                Lot
                <select value={draft.lotId} onChange={event => applyLot(event.target.value)}>
                  <option value="">Aucun lot</option>
                  {lots.map(lot => <option key={lot.id} value={lot.id}>{lot.code ? `${lot.code} · ${lot.name}` : lot.name}</option>)}
                </select>
              </label>
              <label>
                Échéance
                <input type="date" value={draft.deadline} onChange={event => setDraft(prev => ({ ...prev, deadline: event.target.value }))} />
              </label>
              <div className={styles.formWide}>
                <span className={styles.fieldLabel}>Priorité</span>
                <div className={styles.chipGrid}>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={draft.priority === value ? styles.chipActive : styles.chip}
                      onClick={() => setDraft(prev => ({ ...prev, priority: value }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.formWide}>
                <span className={styles.fieldLabel}>Délai rapide</span>
                <div className={styles.chipGrid}>
                  {[7, 15, 30, 60].map(days => (
                    <button key={days} type="button" className={styles.chip} onClick={() => applyDeadlinePreset(days)}>
                      {days} j
                    </button>
                  ))}
                </div>
              </div>
              {mode === 'edit' ? (
                <label>
                  Statut
                  <select value={draft.status} onChange={event => setDraft(prev => ({ ...prev, status: event.target.value }))}>
                    {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              ) : null}
              <div className={styles.formWide}>
                <span className={styles.fieldLabel}>Entreprises responsables *</span>
                <div className={styles.reserveCompanyGrid}>
                  {data.companies.map(company => (
                    <button
                      key={company.id}
                      type="button"
                      className={draft.companies.includes(company.name) ? styles.reserveCompanyChipActive : styles.reserveCompanyChip}
                      onClick={() => onToggleCompany(company.name)}
                    >
                      <span style={{ background: company.color ?? '#94a3b8' }} />
                      <strong>{company.short_name ?? company.shortName ?? company.name}</strong>
                      <small>{company.name}</small>
                    </button>
                  ))}
                </div>
                {!data.companies.length ? <p className={styles.empty}>Aucune entreprise configurée.</p> : null}
              </div>
            </div>
          </section>
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
  const [buildingQuery, setBuildingQuery] = useState('');
  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [participantRole, setParticipantRole] = useState('');
  const [participantCompanyId, setParticipantCompanyId] = useState('');
  const [newTag, setNewTag] = useState('');
  const projectId = draft.chantierId || (selectedProjectId !== 'all' ? selectedProjectId : data.chantiers[0]?.id ?? '');
  const project = data.chantiers.find(item => item.id === projectId);
  const buildings = projectBuildings(project);
  const plans = data.sitePlans.filter(plan => getChantierId(plan) === projectId);
  const hasBuildingHierarchy = buildings.length > 0;
  const selectedBuildingIds = new Set(draft.visitedLocations.map(location => location.buildingId).filter(Boolean));
  const filteredBuildings = buildings.filter((building: any) => {
    const q = normalizeSearchText(buildingQuery);
    if (!q) return true;
    return normalizeSearchText(building.name).includes(q) ||
      (building.levels ?? []).some((level: any) => normalizeSearchText(level.name).includes(q));
  });
  const selectedLocations = draft.visitedLocations.slice(0, 8);
  const hiddenSelectedCount = Math.max(0, draft.visitedLocations.length - selectedLocations.length);
  const companyById = new Map(data.companies.map(company => [company.id, company]));
  const selectedCompanyCount = draft.companyIds.length;
  const checklistDone = draft.checklistItems.filter(item => item.checked).length;
  const suggestedTitle = autoVisitTitle(draft.visitType, draft.date || todayISO());
  const canUseSuggestedTitle = draft.title.trim() !== suggestedTitle;

  function updateProject(nextProjectId: string) {
    setDraft(prev => ({
      ...prev,
      chantierId: nextProjectId,
      building: '',
      level: '',
      zone: '',
      defaultPlanId: '',
      visitedLocations: [],
    }));
  }

  function updateVisitType(type: VisitDraft['visitType']) {
    setDraft(prev => {
      const previousAutoTitle = autoVisitTitle(prev.visitType, prev.date || todayISO());
      const shouldRefreshTitle = !prev.title.trim() || prev.title.trim() === previousAutoTitle;
      return {
        ...prev,
        visitType: type,
        title: shouldRefreshTitle ? autoVisitTitle(type, prev.date || todayISO()) : prev.title,
        checklistItems: makeVisitChecklist(type),
      };
    });
  }

  function updateVisitDate(date: string) {
    setDraft(prev => {
      const previousAutoTitle = autoVisitTitle(prev.visitType, prev.date || todayISO());
      const shouldRefreshTitle = !prev.title.trim() || prev.title.trim() === previousAutoTitle;
      return {
        ...prev,
        date,
        title: shouldRefreshTitle ? autoVisitTitle(prev.visitType, date || todayISO()) : prev.title,
      };
    });
  }

  function plansForBuilding(building: any) {
    return plans.filter(plan =>
      getPlanBuildingId(plan) === building.id ||
      (!getPlanBuildingId(plan) && getPlanBuildingName(plan) === building.name)
    );
  }

  function toggleVisitedBuilding(building: any) {
    setDraft(prev => {
      const exists = prev.visitedLocations.some(location => location.buildingId === building.id);
      return {
        ...prev,
        visitedLocations: exists
          ? prev.visitedLocations.filter(location => location.buildingId !== building.id)
          : [...prev.visitedLocations, { buildingId: building.id, buildingName: building.name }],
      };
    });
  }

  function updateLocationPlan(buildingId: string, planId: string) {
    setDraft(prev => ({
      ...prev,
      visitedLocations: prev.visitedLocations.map(location =>
        location.buildingId === buildingId
          ? { ...location, defaultPlanId: planId || undefined }
          : location
      ),
    }));
  }

  function addChecklistItem() {
    const label = newChecklistLabel.trim();
    if (!label) return;
    setDraft(prev => ({
      ...prev,
      checklistItems: [...prev.checklistItems, { id: crypto.randomUUID(), label, checked: false }],
    }));
    setNewChecklistLabel('');
  }

  function addParticipant() {
    const name = participantName.trim();
    if (!name) return;
    const company = participantCompanyId ? companyById.get(participantCompanyId) : null;
    setDraft(prev => ({
      ...prev,
      participants: [
        ...prev.participants,
        {
          id: crypto.randomUUID(),
          name,
          role: participantRole.trim() || undefined,
          companyId: participantCompanyId || undefined,
          company: company?.name,
        },
      ],
    }));
    setParticipantName('');
    setParticipantRole('');
    setParticipantCompanyId('');
  }

  function addTag() {
    const tag = newTag.trim();
    if (!tag || draft.tags.includes(tag)) return;
    setDraft(prev => ({ ...prev, tags: [...prev.tags, tag] }));
    setNewTag('');
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <form className={`${styles.modalPanel} ${styles.reserveModalPanel}`} onSubmit={onSubmit}>
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.eyebrow}>Visite chantier</p>
            <h2>Nouvelle visite</h2>
            <span>Préparez le périmètre, les entreprises et le modèle de contrôle comme sur mobile.</span>
          </div>
          <button type="button" onClick={onClose}>Fermer</button>
        </div>
        <div className={styles.reserveModalBody}>
          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Type de visite</strong>
                <span>Le type charge automatiquement un modèle de checklist adapté.</span>
              </div>
            </div>
            <div className={styles.visitTypeGrid}>
              {VISIT_TYPE_OPTIONS.map(option => {
                const active = draft.visitType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={active ? styles.visitTypeCardActive : styles.visitTypeCard}
                    style={active ? { borderColor: option.color, background: `${option.color}15`, color: option.color } : undefined}
                    onClick={() => updateVisitType(option.value)}
                  >
                    <span>{option.icon}</span>
                    <strong>{option.label}</strong>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Informations générales</strong>
                <span>Titre, conducteur, date et statut initial de la visite.</span>
              </div>
            </div>
            <div className={styles.reserveModalGrid}>
              <label>
                Chantier
                <select value={projectId} onChange={event => updateProject(event.target.value)}>
                  {data.chantiers.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label>
                Conducteur
                <input value={draft.conducteur} onChange={event => setDraft(prev => ({ ...prev, conducteur: event.target.value }))} />
              </label>
              <label className={styles.formWide}>
                <span className={styles.reserveLabelRow}>
                  Titre de la visite *
                  {canUseSuggestedTitle ? (
                    <button type="button" onClick={() => setDraft(prev => ({ ...prev, title: suggestedTitle }))}>Utiliser la suggestion</button>
                  ) : null}
                </span>
                <input value={draft.title} onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))} placeholder={suggestedTitle} required />
              </label>
              <label>
                Date
                <input type="date" value={draft.date} onChange={event => updateVisitDate(event.target.value)} />
              </label>
              <label>
                Statut initial
                <select value={draft.status} onChange={event => setDraft(prev => ({ ...prev, status: event.target.value as VisitDraft['status'] }))}>
                  {Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                Début
                <input type="time" value={draft.startTime} onChange={event => setDraft(prev => ({ ...prev, startTime: event.target.value }))} />
              </label>
              <label>
                Fin
                <input type="time" value={draft.endTime} onChange={event => setDraft(prev => ({ ...prev, endTime: event.target.value }))} />
              </label>
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Périmètre de visite</strong>
                <span>Les réserves créées depuis cette visite seront limitées aux bâtiments sélectionnés.</span>
              </div>
              {hasBuildingHierarchy ? <span className={styles.reserveCountPill}>{draft.visitedLocations.length} / {buildings.length}</span> : null}
            </div>
            {hasBuildingHierarchy ? (
              <>
                <div className={styles.visitBuildingToolbar}>
                  <div className={styles.visitSearch}>
                    <span>⌕</span>
                    <input value={buildingQuery} onChange={event => setBuildingQuery(event.target.value)} placeholder="Rechercher bâtiment ou niveau..." />
                  </div>
                  <button type="button" onClick={() => setDraft(prev => ({ ...prev, visitedLocations: buildings.map((building: any) => ({ buildingId: building.id, buildingName: building.name })) }))}>
                    Tout sélectionner
                  </button>
                  <button type="button" onClick={() => setDraft(prev => ({ ...prev, visitedLocations: [] }))} disabled={!draft.visitedLocations.length}>
                    Effacer
                  </button>
                </div>
                {draft.visitedLocations.length ? (
                  <div className={styles.visitSelectedLocations}>
                    {selectedLocations.map(location => (
                      <span key={location.buildingId ?? location.buildingName}>{location.buildingName}</span>
                    ))}
                    {hiddenSelectedCount ? <span>+{hiddenSelectedCount}</span> : null}
                  </div>
                ) : null}
                <div className={styles.visitBuildingGrid}>
                  {filteredBuildings.map((building: any) => {
                    const active = selectedBuildingIds.has(building.id);
                    return (
                      <button
                        key={building.id}
                        type="button"
                        className={active ? styles.visitBuildingCardActive : styles.visitBuildingCard}
                        onClick={() => toggleVisitedBuilding(building)}
                      >
                        <span className={styles.visitBuildingIcon}>{active ? '✓' : '▦'}</span>
                        <strong>{building.name}</strong>
                        <small>{(building.levels ?? []).length} niveaux</small>
                      </button>
                    );
                  })}
                  {!filteredBuildings.length ? <p className={styles.empty}>Aucun bâtiment trouvé.</p> : null}
                </div>
                {draft.visitedLocations.length ? (
                  <div className={styles.visitLocationPreview}>
                    {draft.visitedLocations.map(location => {
                      const building = buildings.find((item: any) => item.id === location.buildingId || item.name === location.buildingName);
                      const buildingPlans = building ? plansForBuilding(building) : [];
                      return (
                        <div key={location.buildingId ?? location.buildingName} className={styles.visitSelectedLocationCard}>
                          <div>
                            <strong>{location.buildingName}</strong>
                            <small>{buildingPlans.length} plan{buildingPlans.length > 1 ? 's' : ''} disponible{buildingPlans.length > 1 ? 's' : ''}</small>
                          </div>
                          <select
                            value={location.defaultPlanId ?? ''}
                            onChange={event => location.buildingId && updateLocationPlan(location.buildingId, event.target.value)}
                            className={styles.visitPlanSelect}
                          >
                            <option value="">Aucun plan par défaut</option>
                            {buildingPlans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : (
              <div className={styles.reserveModalGrid}>
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
                  Plan de référence
                  <select value={draft.defaultPlanId} onChange={event => setDraft(prev => ({ ...prev, defaultPlanId: event.target.value }))}>
                    <option value="">Aucun plan</option>
                    {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                  </select>
                </label>
              </div>
            )}
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Entreprises concernées</strong>
                <span>Entreprises inspectées pendant cette visite.</span>
              </div>
              <span className={styles.reserveCountPill}>{selectedCompanyCount} sélectionnée{selectedCompanyCount > 1 ? 's' : ''}</span>
            </div>
            <div className={styles.reserveCompanyGrid}>
              {data.companies.map(company => (
                <button
                  key={company.id}
                  type="button"
                  className={draft.companyIds.includes(company.id) ? styles.reserveCompanyChipActive : styles.reserveCompanyChip}
                  onClick={() => onToggleCompany(company.id)}
                >
                  <span style={{ background: company.color ?? '#94a3b8' }} />
                  <strong>{company.short_name ?? company.shortName ?? company.name}</strong>
                  <small>{company.name}</small>
                </button>
              ))}
            </div>
            {!data.companies.length ? <p className={styles.empty}>Aucune entreprise configurée.</p> : null}
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Checklist de contrôle</strong>
                <span>{draft.checklistItems.length ? `${checklistDone}/${draft.checklistItems.length} points validés.` : 'Choisissez un type ou ajoutez vos propres points.'}</span>
              </div>
              <button type="button" className={styles.secondaryBtn} onClick={() => setDraft(prev => ({ ...prev, checklistItems: makeVisitChecklist(prev.visitType) }))}>
                Recharger le modèle
              </button>
            </div>
            <div className={styles.visitChecklistList}>
              {draft.checklistItems.map(item => (
                <div key={item.id} className={styles.visitChecklistRow}>
                  <button
                    type="button"
                    className={item.checked ? styles.visitCheckboxChecked : styles.visitCheckbox}
                    onClick={() => setDraft(prev => ({ ...prev, checklistItems: prev.checklistItems.map(row => row.id === item.id ? { ...row, checked: !row.checked } : row) }))}
                  >
                    {item.checked ? '✓' : ''}
                  </button>
                  <input
                    value={item.label}
                    onChange={event => setDraft(prev => ({ ...prev, checklistItems: prev.checklistItems.map(row => row.id === item.id ? { ...row, label: event.target.value } : row) }))}
                  />
                  <button
                    type="button"
                    onClick={() => setDraft(prev => ({ ...prev, checklistItems: prev.checklistItems.filter(row => row.id !== item.id) }))}
                    aria-label="Retirer ce point"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.visitInlineAdd}>
              <input
                value={newChecklistLabel}
                onChange={event => setNewChecklistLabel(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addChecklistItem();
                  }
                }}
                placeholder="Ajouter un point de contrôle..."
              />
              <button type="button" onClick={addChecklistItem} disabled={!newChecklistLabel.trim()}>Ajouter</button>
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Délai de levée des réserves</strong>
                <span>Date limite appliquée par défaut aux réserves créées depuis cette visite.</span>
              </div>
            </div>
            <div className={styles.visitDeadlineRow}>
              {VISIT_DEADLINE_SUGGESTIONS.map(suggestion => {
                const value = addDaysISO(todayISO(), suggestion.days);
                return (
                  <button
                    key={suggestion.days}
                    type="button"
                    className={draft.reserveDeadlineDate === value ? styles.chipActive : styles.chip}
                    onClick={() => setDraft(prev => ({ ...prev, reserveDeadlineDate: value }))}
                  >
                    {suggestion.label}
                  </button>
                );
              })}
              <input type="date" value={draft.reserveDeadlineDate} onChange={event => setDraft(prev => ({ ...prev, reserveDeadlineDate: event.target.value }))} />
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Participants, notes et diffusion</strong>
                <span>Ajoutez les présents, les tags de recherche et les objectifs de visite.</span>
              </div>
            </div>
            {draft.participants.length ? (
              <div className={styles.visitParticipantList}>
                {draft.participants.map(participant => (
                  <div key={participant.id} className={styles.visitParticipantRow}>
                    <strong>{participant.name}</strong>
                    <span>{[participant.role, participant.company].filter(Boolean).join(' · ') || 'Participant'}</span>
                    <button type="button" onClick={() => setDraft(prev => ({ ...prev, participants: prev.participants.filter(item => item.id !== participant.id) }))}>×</button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className={styles.reserveModalGrid}>
              <label>
                Nom participant
                <input value={participantName} onChange={event => setParticipantName(event.target.value)} placeholder="Nom" />
              </label>
              <label>
                Rôle
                <input value={participantRole} onChange={event => setParticipantRole(event.target.value)} placeholder="Conducteur, chef d'équipe..." />
              </label>
              <label>
                Entreprise
                <select value={participantCompanyId} onChange={event => setParticipantCompanyId(event.target.value)}>
                  <option value="">Aucune / interne</option>
                  {data.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
                </select>
              </label>
              <div className={styles.visitInlineAdd}>
                <button type="button" onClick={addParticipant} disabled={!participantName.trim()}>Ajouter le participant</button>
              </div>
              <label className={styles.formWide}>
                Notes et objectifs
                <textarea value={draft.notes} onChange={event => setDraft(prev => ({ ...prev, notes: event.target.value }))} rows={4} placeholder="Objectif de la visite, points à contrôler, consignes..." />
              </label>
            </div>
            <div className={styles.visitTagRow}>
              {draft.tags.map(tag => (
                <button key={tag} type="button" onClick={() => setDraft(prev => ({ ...prev, tags: prev.tags.filter(item => item !== tag) }))}>
                  {tag} ×
                </button>
              ))}
              <input
                value={newTag}
                onChange={event => setNewTag(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Ajouter un tag..."
              />
              <button type="button" onClick={addTag} disabled={!newTag.trim()}>Ajouter</button>
            </div>
          </section>

          <section className={styles.reserveFormSection}>
            <div className={styles.reserveFormSectionHeader}>
              <div>
                <strong>Récurrence</strong>
                <span>Créez une visite unique ou une petite série planifiée.</span>
              </div>
            </div>
            <div className={styles.visitTypeGrid}>
              {VISIT_RECURRENCE_OPTIONS.map(option => {
                const active = draft.recurrence === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={active ? styles.visitTypeCardActive : styles.visitTypeCard}
                    onClick={() => setDraft(prev => ({ ...prev, recurrence: option.value }))}
                  >
                    <strong>{option.label}</strong>
                    <small>{option.desc}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.visitSummary}>
            <strong>Résumé</strong>
            <span>{draft.title || suggestedTitle}</span>
            <small>
              {VISIT_TYPE_LABELS[draft.visitType]} · {prettyDate(draft.date)} · {draft.visitedLocations.length || (draft.building ? 1 : 0)} bâtiment(s) · {selectedCompanyCount} entreprise(s)
            </small>
          </section>
        </div>
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={saving}>{saving ? 'Création...' : draft.recurrence === 'none' ? 'Créer la visite' : 'Créer la série'}</button>
        </div>
      </form>
    </div>
  );
}

function AdminView({ data, profile, onUpdateProfile }: { data: WebState; profile: Profile | null; onUpdateProfile: (userId: string, patch: Partial<Profile>) => void }) {
  const [query, setQuery] = useState('');
  if (!isAdmin(profile)) {
    return <section className={styles.panel}><p className={styles.empty}>Accès réservé aux admins et super admins.</p></section>;
  }
  const q = query.trim().toLowerCase();
  const users = data.profiles.filter(user => !q || [user.name, user.email, user.role, user.role_label].join(' ').toLowerCase().includes(q));
  return (
    <div className={styles.stack}>
      <div className={styles.kpiGrid}>
        <Kpi title="Utilisateurs" value={data.profiles.length} hint="Profils Supabase" />
        <Kpi title="Entreprises" value={data.companies.length} hint="Sous-traitants" tone="green" />
        <Kpi title="Préférences notif." value={data.notificationPreferences.length} hint="App / push / email" tone="amber" />
        <Kpi title="Chantiers" value={data.chantiers.length} hint="Périmètre org." />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeaderCompact}>
          <div>
            <h2>Utilisateurs</h2>
            <p>Gestion web des rôles et entreprises rattachées.</p>
          </div>
          <input className={styles.compactSearch} value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher utilisateur..." />
        </div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.adminTableHead}`}><span>Utilisateur</span><span>Rôle</span><span>Entreprise</span><span>Email</span></div>
          {users.map(user => {
            return (
              <div key={user.id} className={`${styles.tableRow} ${styles.adminTableRow}`}>
                <strong>{user.name}</strong>
                <select value={user.role ?? ''} onChange={event => onUpdateProfile(user.id, { role: event.target.value })}>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={user.company_id ?? ''} onChange={event => onUpdateProfile(user.id, { company_id: event.target.value || null })}>
                  <option value="">Aucune</option>
                  {data.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <span>{user.email}</span>
              </div>
            );
          })}
          {!users.length && <p className={styles.empty}>Aucun utilisateur trouvé.</p>}
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

