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

function isAdmin(profile: Profile | null) {
  return profile?.role === 'super_admin' || profile?.role === 'admin';
}

function canEdit(profile: Profile | null) {
  return ['super_admin', 'admin', 'conducteur', 'chef_equipe'].includes(String(profile?.role ?? ''));
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

function reserveCompanies(reserve: any): string[] {
  if (Array.isArray(reserve.companies) && reserve.companies.length) return reserve.companies;
  return reserve.company ? [reserve.company] : [];
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
              />
            )}
            {activeTab === 'visites' && (
              <VisitesView visites={projectScoped.visites} reserves={projectScoped.reserves} companies={data.companies} />
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
            {activeTab === 'admin' && (
              <AdminView data={data} profile={profile} />
            )}
          </>
        )}
      </section>
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
  editable: boolean;
  saving: boolean;
}) {
  const { reserves, selectedReserve } = props;
  return (
    <div className={styles.twoCols}>
      <section className={styles.panel}>
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
            {props.editable && (
              <div className={styles.actionBar}>
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

function PlansView({ plans, reserves, selectedPlan, setSelectedPlanId, setSelectedReserveId, setTab }: any) {
  const planReserves = selectedPlan ? reserves.filter((r: any) => r.plan_id === selectedPlan.id) : [];
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
              {selectedPlan.uri ? <a className={styles.linkButton} href={selectedPlan.uri} target="_blank">Ouvrir le fichier</a> : null}
            </div>
            <div className={styles.planCanvas}>
              {selectedPlan.uri && selectedPlan.file_type === 'image' ? (
                <img src={selectedPlan.uri} alt={selectedPlan.name} />
              ) : selectedPlan.uri && selectedPlan.file_type === 'pdf' ? (
                <iframe src={selectedPlan.uri} title={selectedPlan.name} />
              ) : (
                <div className={styles.planPlaceholder}>Aperçu web disponible dès que le fichier est accessible.</div>
              )}
              {planReserves.filter((r: any) => r.plan_x != null && r.plan_y != null).map((reserve: any, idx: number) => (
                <button
                  key={reserve.id}
                  className={styles.pin}
                  style={{ left: `${Math.max(2, Math.min(98, Number(reserve.plan_x) * 100))}%`, top: `${Math.max(2, Math.min(98, Number(reserve.plan_y) * 100))}%` }}
                  title={reserve.title}
                  onClick={() => {
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

function VisitesView({ visites, reserves, companies }: any) {
  return (
    <section className={styles.panel}>
      <div className={styles.dataTable}>
        <div className={styles.tableHead}><span>Visite</span><span>Date</span><span>Périmètre</span><span>Réserves</span><span>Entreprises</span></div>
        {visites.map((visit: any) => {
          const visitReserves = reserves.filter((r: any) => r.visite_id === visit.id || (visit.reserve_ids ?? []).includes(r.id));
          const companyNames = (visit.concerned_company_ids ?? [])
            .map((id: string) => companies.find((c: any) => c.id === id)?.name)
            .filter(Boolean);
          return (
            <div key={visit.id} className={styles.tableRow}>
              <strong>{visit.title}</strong>
              <span>{prettyDate(visit.date)}</span>
              <span>{[visit.building, visit.level, visit.zone].filter(Boolean).join(' · ') || 'Multi-bâtiments'}</span>
              <span>{visitReserves.length}</span>
              <span>{companyNames.join(', ') || '—'}</span>
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
