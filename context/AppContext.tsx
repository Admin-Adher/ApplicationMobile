import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import {
  Reserve, Company, Task, Document, Photo, Message, Channel, Profile,
  Comment, ReserveStatus, Chantier, SitePlan, Visite, Lot, Opr,
} from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth, globalSeedingRef, registerInProgressRef, loginInProgressRef } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { initStorageBuckets } from '@/lib/storage';
import { C } from '@/constants/colors';
import { genId, nowTimestampFR } from '@/lib/utils';
import { queryKeys } from '@/lib/queryKeys';

import { useChantiers } from '@/hooks/queries/useChantiers';
import { useReserves } from '@/hooks/queries/useReserves';
import { useCompanies } from '@/hooks/queries/useCompanies';
import { useTasks } from '@/hooks/queries/useTasks';
import { useDocuments } from '@/hooks/queries/useDocuments';
import { usePhotos } from '@/hooks/queries/usePhotos';
import { useProfiles } from '@/hooks/queries/useProfiles';
import { useVisites } from '@/hooks/queries/useVisites';
import { useLots } from '@/hooks/queries/useLots';
import { useOprs } from '@/hooks/queries/useOprs';
import { useChannels, dmChannelId } from '@/hooks/queries/useChannels';
import { useMessages } from '@/hooks/queries/useMessages';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';

export { STANDARD_LOTS } from '@/hooks/queries/useLots';
export const STATIC_CHANNELS: Channel[] = [];

const ACTIVE_CHANTIER_PREFIX = 'buildtrack_active_chantier_v3_';

interface AppContextValue {
  reserves: Reserve[];
  companies: Company[];
  tasks: Task[];
  documents: Document[];
  photos: Photo[];
  messages: Message[];
  lastReadByChannel: Record<string, string>;
  isLoading: boolean;
  profiles: Profile[];
  generalChannels: Channel[];
  customChannels: Channel[];
  groupChannels: Channel[];
  persistedDmChannels: Channel[];
  pinnedChannelIds: string[];
  channelMembersOverride: Record<string, string[]>;
  chantiers: Chantier[];
  sitePlans: SitePlan[];
  activeChantierId: string | null;
  visites: Visite[];
  lots: Lot[];
  oprs: Opr[];
  channels: Channel[];
  unreadByChannel: Record<string, number>;
  notification: { msg: Message; channelName: string; channelColor: string; channelIcon: string } | null;
  activeChantier: Chantier | null;
  addChantier: (c: Chantier, plans: SitePlan[]) => void;
  updateChantier: (c: Chantier) => void;
  deleteChantier: (id: string) => void;
  setActiveChantier: (id: string) => void;
  addSitePlan: (p: SitePlan) => void;
  updateSitePlan: (p: SitePlan) => void;
  deleteSitePlan: (id: string) => void;
  addReserve: (r: Reserve) => void;
  updateReserve: (r: Reserve) => void;
  updateReserveFields: (r: Reserve) => void;
  deleteReserve: (id: string) => void;
  updateReserveStatus: (id: string, status: ReserveStatus, author?: string) => void;
  addComment: (reserveId: string, content: string, author?: string) => void;
  addCompany: (c: Company) => void;
  updateCompanyWorkers: (id: string, actual: number) => void;
  updateCompanyFull: (c: Company) => void;
  deleteCompany: (id: string) => void;
  updateCompanyHours: (id: string, hours: number) => void;
  reload: () => void;
  setCurrentUser: (name: string) => void;
  addMessage: (channelId: string, content: string, options?: Partial<Pick<Message, 'replyToId' | 'replyToContent' | 'replyToSender' | 'attachmentUri' | 'mentions' | 'reserveId' | 'linkedItemType' | 'linkedItemId' | 'linkedItemTitle'>>, sender?: string) => void;
  incomingMessage: (msg: Message) => void;
  deleteMessage: (id: string) => void;
  updateMessage: (msg: Message) => void;
  toggleReaction: (emoji: string, msg: Message, userName: string) => void;
  markMessagesRead: (channelId?: string) => void;
  setChannelRead: (channelId: string) => void;
  setActiveChannelId: (id: string | null) => void;
  dismissNotification: () => void;
  addTask: (t: Task) => void;
  updateTask: (t: Task) => void;
  deleteTask: (id: string) => void;
  addTaskComment: (taskId: string, content: string, author?: string) => void;
  addPhoto: (p: Photo) => void;
  deletePhoto: (id: string) => void;
  addDocument: (d: Document) => void;
  deleteDocument: (id: string) => void;
  addCustomChannel: (name: string, description: string, icon: string, color: string) => Channel;
  removeCustomChannel: (id: string) => void;
  addGroupChannel: (name: string, members: string[], color: string) => Channel;
  removeGroupChannel: (id: string) => void;
  renameChannel: (id: string, newName: string) => void;
  updateCustomChannel: (id: string, updates: Partial<Pick<Channel, 'name' | 'description' | 'icon' | 'color'>>) => void;
  addChannelMember: (id: string, memberName: string) => void;
  removeChannelMember: (id: string, memberName: string) => void;
  pinChannel: (id: string) => { success: boolean; reason?: string };
  unpinChannel: (id: string) => void;
  maxPinnedChannels: number;
  getOrCreateDMChannel: (otherName: string) => Channel;
  fetchOlderMessages: (channelId: string, beforeCreatedAt: string) => Promise<boolean>;
  fetchChannelMessages: (channelId: string) => Promise<void>;
  refreshChannelMessages: (channelId: string) => Promise<void>;
  unreadCount: number;
  stats: {
    total: number; open: number; inProgress: number;
    waiting: number; verification: number; closed: number;
    progress: number; totalWorkers: number; plannedWorkers: number;
  };
  addVisite: (v: Visite) => void;
  updateVisite: (v: Visite) => void;
  deleteVisite: (id: string) => void;
  linkReserveToVisite: (reserveId: string, visiteId: string) => void;
  addLot: (l: Lot) => void;
  updateLot: (l: Lot) => void;
  deleteLot: (id: string) => void;
  addOpr: (o: Opr) => void;
  updateOpr: (o: Opr) => void;
  deleteOpr: (id: string) => void;
  batchUpdateReserves: (ids: string[], updates: Partial<Pick<Reserve, 'status' | 'company' | 'companies' | 'deadline' | 'priority'>>, author?: string) => void;
  addSitePlanVersion: (parentPlanId: string, newPlan: SitePlan) => void;
  migrateReservesToPlan: (fromPlanId: string, toPlanId: string) => number;
  realtimeConnected: boolean;
  isOfflineSession: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const chantiersH = useChantiers();
  const reservesH = useReserves();
  const companiesH = useCompanies();
  const tasksH = useTasks();
  const documentsH = useDocuments();
  const photosH = usePhotos();
  const profilesH = useProfiles();
  const visitesH = useVisites();
  const lotsH = useLots();
  const oprsH = useOprs();
  const channelsH = useChannels();
  const messagesH = useMessages();
  const authH = useAuth();
  const { isOnline, enqueueOperation } = useNetwork();

  useRealtimeSync();

  const [activeChantierId, setActiveChantierIdState] = useState<string | null>(null);
  const [lastReadByChannel, setLastReadByChannel] = useState<Record<string, string>>({});
  const [notification, setNotification] = useState<{ msg: Message; channelName: string; channelColor: string; channelIcon: string } | null>(null);

  const currentUserNameRef = useRef<string>('');
  const [currentUserName, setCurrentUserName] = useState('');
  const activeChannelIdRef = useRef<string | null>(null);
  const chantierInitializedRef = useRef(false);
  // Fix 1: ref to always have latest lastReadByChannel without stale closure
  const lastReadByChannelRef = useRef<Record<string, string>>({});
  // Fix 4: ref to track if we have a cached profile (offline session), avoids async AsyncStorage in event handler
  const hasCachedProfileRef = useRef(false);

  // Fix 14: namespace lastReadByChannel by userId so different accounts don't share state
  const lastReadStorageKey = useMemo(() => `lastReadByChannel_${authH.user?.id ?? 'anon'}`, [authH.user?.id]);

  useEffect(() => {
    AsyncStorage.getItem(lastReadStorageKey)
      .then(raw => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            setLastReadByChannel(parsed);
            lastReadByChannelRef.current = parsed;
          } catch {}
        }
      })
      .catch(() => {});
  }, [lastReadStorageKey]);

  useEffect(() => {
    const chantiers = chantiersH.chantiers;
    if (!chantiers.length) return;

    if (!chantierInitializedRef.current) {
      chantierInitializedRef.current = true;
      const chKey = ACTIVE_CHANTIER_PREFIX + (authH.user?.id ?? 'anon');
      AsyncStorage.getItem(chKey).then(storedId => {
        if (storedId && chantiers.some(c => c.id === storedId)) {
          setActiveChantierIdState(storedId);
        } else {
          setActiveChantierIdState(chantiers[0].id);
          AsyncStorage.setItem(chKey, chantiers[0].id).catch(() => {});
        }
      }).catch(() => {
        setActiveChantierIdState(chantiers[0].id);
        AsyncStorage.setItem(chKey, chantiers[0].id).catch(() => {});
      });
      return;
    }

    if (activeChantierId && !chantiers.some(c => c.id === activeChantierId)) {
      setActiveChantierIdState(chantiers[0].id);
      const chKey = ACTIVE_CHANTIER_PREFIX + (authH.user?.id ?? 'anon');
      AsyncStorage.setItem(chKey, chantiers[0].id).catch(() => {});
    }
  }, [chantiersH.chantiers, activeChantierId, authH.user?.id]);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4500);
    return () => clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    initStorageBuckets().catch(() => {});
  }, []);

  // Fix 4: sync cached profile ref with AsyncStorage so SIGNED_OUT handler is synchronous
  useEffect(() => {
    AsyncStorage.getItem('buildtrack_cached_profile_v1').then(raw => {
      hasCachedProfileRef.current = !!raw;
    }).catch(() => {});
  }, [authH.user?.id]); // re-check when user changes

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        if (globalSeedingRef.current) return;
        if (registerInProgressRef.current) return;
        if (loginInProgressRef.current) return;

        const userMeta = session.user.user_metadata;
        const userName = userMeta?.name ?? userMeta?.full_name ?? session.user.email ?? '';
        currentUserNameRef.current = userName;
        setCurrentUserName(userName);
        hasCachedProfileRef.current = true; // profile exists now

        // Fix 3: try Supabase first, fallback to AsyncStorage if offline
        try {
          const { data: prof } = await supabase
            .from('profiles').select('last_read_by_channel')
            .eq('id', session.user.id).single();
          if (prof?.last_read_by_channel) {
            setLastReadByChannel(prof.last_read_by_channel);
            lastReadByChannelRef.current = prof.last_read_by_channel;
          }
        } catch {
          // Offline fallback: lastReadByChannel already loaded from AsyncStorage by the effect above
        }
      }
      if (event === 'SIGNED_OUT') {
        // Always clear state on sign-out — the per-user namespaced caches
        // will repopulate correct data when the next user signs in.
        // Skipping this was causing cross-account contamination on the same device.
        currentUserNameRef.current = '';
        setCurrentUserName('');
        setActiveChantierIdState(null);
        chantierInitializedRef.current = false;
        setLastReadByChannel({});
        lastReadByChannelRef.current = {};
        setNotification(null);
        queryClient.clear();
        hasCachedProfileRef.current = false;
      }
    });

    // Fix 2: removed duplicate getSession() call — onAuthStateChange already fires INITIAL_SESSION at mount

    return () => authListener.subscription.unsubscribe();
  }, [queryClient]);

  // Fix 11: Use refs for channel arrays so the handler registration is stable (no re-register on every channel change)
  const channelsRef = useRef<Channel[]>([]);
  channelsRef.current = [
    ...channelsH.generalChannels,
    ...channelsH.customChannels,
    ...channelsH.groupChannels,
    ...channelsH.persistedDmChannels,
  ];

  // Bug 4: Use incomingMessageHandler from useMessages instead of duplicate realtime subscription
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    messagesH.registerIncomingMessageHandler((msg: Message, raw: any) => {
      if (msg.isMe) return;
      if (activeChannelIdRef.current === msg.channelId) return;
      const ch = channelsRef.current.find(c => c.id === msg.channelId);
      const isDM = (msg.channelId ?? '').startsWith('dm-');
      // Bug 9: for DM notifications, use channel name (interlocutor) not sender name
      const channelName = isDM
        ? (ch?.name ?? msg.sender)
        : (ch?.name ?? msg.channelId ?? '');
      setNotification({
        msg,
        channelName,
        channelColor: ch?.color ?? C.primary,
        channelIcon: isDM ? 'person-circle' : (ch?.icon ?? 'chatbubbles'),
      });
    });
    return () => { messagesH.registerIncomingMessageHandler(null); };
  }, [messagesH.registerIncomingMessageHandler]);

  const setActiveChantier = useCallback((id: string) => {
    setActiveChantierIdState(id);
    const chKey = ACTIVE_CHANTIER_PREFIX + (authH.user?.id ?? 'anon');
    AsyncStorage.setItem(chKey, id).catch(() => {});
  }, [authH.user?.id]);

  const setCurrentUser = useCallback((name: string) => {
    currentUserNameRef.current = name;
    setCurrentUserName(name);
  }, []);

  const setActiveChannelId = useCallback((id: string | null) => {
    activeChannelIdRef.current = id;
    if (id) setNotification(prev => (prev?.msg.channelId === id ? null : prev));
  }, []);

  const dismissNotification = useCallback(() => setNotification(null), []);

  const setChannelRead = useCallback((channelId: string) => {
    const timestamp = new Date().toISOString();
    // Fix 1: use setLastReadByChannel callback to get latest, then update ref for Supabase call
    let newLastRead: Record<string, string> = {};
    setLastReadByChannel(prev => {
      newLastRead = { ...prev, [channelId]: timestamp };
      lastReadByChannelRef.current = newLastRead;
      AsyncStorage.setItem(lastReadStorageKey, JSON.stringify(newLastRead)).catch(() => {});
      return newLastRead;
    });
    const userName = currentUserNameRef.current;
    messagesH.setChannelRead(channelId, userName);
    if (isSupabaseConfigured && userName) {
      const userId = authH.user?.id;
      if (!userId) return;
      if (!isOnline) {
        // Offline: enqueue profile update for sync when network returns
        enqueueOperation({
          table: 'profiles',
          op: 'update',
          filter: { column: 'id', value: userId },
          data: { last_read_by_channel: newLastRead },
        });
        return;
      }
      supabase.from('profiles').update({ last_read_by_channel: newLastRead })
        .eq('id', userId).catch(() => {});
    }
  }, [messagesH, lastReadStorageKey, authH.user?.id, isOnline, enqueueOperation]);

  const reload = useCallback(() => {
    queryClient.invalidateQueries();
    channelsH.reloadChannels();
  }, [queryClient, channelsH]);

  // Fix 9: addMessage uses currentUserNameRef as default sender instead of hardcoded 'Moi'
  const addMessage = useCallback((
    channelId: string,
    content: string,
    options: Partial<Pick<Message, 'replyToId' | 'replyToContent' | 'replyToSender' | 'attachmentUri' | 'mentions' | 'reserveId' | 'linkedItemType' | 'linkedItemId' | 'linkedItemTitle'>> = {},
    sender?: string
  ) => {
    const actualSender = sender ?? (currentUserNameRef.current || 'Moi');
    messagesH.addMessage(channelId, content, options, actualSender, channelsH.getDmUpsertPromise);
  }, [messagesH, channelsH]);

  // Fix 8: updateReserveStatusWithNotif uses reservesH.reserves and companiesH.companies instead of queryClient.getQueryData
  const updateReserveStatusWithNotif = useCallback((id: string, status: ReserveStatus, author?: string) => {
    const actualAuthor = author ?? currentUserNameRef.current ?? 'Système';
    reservesH.updateReserveStatus(id, status, actualAuthor);

    const reserve = reservesH.reserves.find(r => r.id === id);
    if (!reserve) return;
    const companiesData = companiesH.companies;
    const reserveCompanyNames = reserve.companies ?? (reserve.company ? [reserve.company] : []);
    const notifiedCompanies = companiesData.filter(c => reserveCompanyNames.includes(c.name));
    const statusLabels: Record<string, string> = {
      open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente',
      verification: 'Vérification', closed: 'Clôturé',
    };
    const ts = nowTimestampFR();
    for (const company of notifiedCompanies) {
      const notifMsg: Message = {
        id: genId(), channelId: `company-${company.id}`, sender: actualAuthor,
        content: `Réserve ${reserve.id} — "${reserve.title}" : statut modifié → ${statusLabels[status] ?? status}`,
        timestamp: ts, type: 'notification', read: false, isMe: false,
        reactions: {}, isPinned: false, readBy: [], mentions: [], reserveId: reserve.id,
      };
      messagesH.addNotificationMessage(notifMsg);
    }
  }, [reservesH, reservesH.reserves, companiesH.companies, messagesH]);

  const addChantierWithChannel = useCallback((c: Chantier, plans: SitePlan[]) => {
    chantiersH.addChantier(c, plans, (buildingCh: Channel) => {
      channelsH.addGeneralChannel(buildingCh);
    });
  }, [chantiersH, channelsH]);

  const deleteChantierWithChannel = useCallback((id: string) => {
    channelsH.removeGeneralChannel(`building-${id}`);
    chantiersH.deleteChantier(id);
  }, [chantiersH, channelsH]);

  // Fix 6: company channels memo — only recalculate when company ids/names/colors change
  const companyChannels = useMemo(() => {
    return companiesH.companies.map(c => ({
      id: `company-${c.id}`,
      name: c.name,
      description: `Canal entreprise ${c.name}`,
      icon: 'business',
      color: c.color ?? '#10B981',
      type: 'company' as any,
      members: [],
    }));
  }, [companiesH.companies]);

  const allChannels = useMemo(() => {
    // Fix DM names: always show the interlocutor's name, not the current user's name
    const myName = currentUserName;
    const fixedDmChannels = channelsH.persistedDmChannels.map(ch => {
      if (ch.type !== 'dm') return ch;
      const participants = ch.dmParticipants ?? ch.members ?? [];
      const otherName = participants.find(p => p !== myName) ?? ch.name;
      if (otherName === ch.name) return ch;
      return { ...ch, name: otherName, description: `Message direct avec ${otherName}` };
    });
    return [
      ...channelsH.generalChannels,
      ...channelsH.customChannels,
      ...channelsH.groupChannels,
      ...fixedDmChannels,
      ...companyChannels,
    ];
  }, [
    channelsH.generalChannels, channelsH.customChannels,
    channelsH.groupChannels, channelsH.persistedDmChannels,
    companyChannels, currentUserName,
  ]);

  // Fix 7: unreadByChannel uses lastReadByChannelRef to avoid stale closure issues
  const unreadByChannel = useMemo(() => {
    const result: Record<string, number> = {};
    const lastRead = lastReadByChannelRef.current;
    for (const msg of messagesH.messages) {
      if (!msg.channelId) continue;
      if (!msg.isMe && !msg.read) {
        const msgTime = msg.dbCreatedAt ? new Date(msg.dbCreatedAt).getTime() : 0;
        const lastReadTime = lastRead[msg.channelId] ? new Date(lastRead[msg.channelId]).getTime() : 0;
        if (msgTime > lastReadTime) {
          result[msg.channelId] = (result[msg.channelId] ?? 0) + 1;
        }
      }
    }
    return result;
  }, [messagesH.messages, lastReadByChannel]);

  const unreadCount = useMemo(
    () => Object.values(unreadByChannel).reduce((a, b) => a + b, 0),
    [unreadByChannel]
  );

  // Fix 15: stats computed from pre-aggregated counts to reduce re-renders
  const stats = useMemo(() => {
    const r = reservesH.reserves;
    const total = r.length;
    const open = r.filter(x => x.status === 'open').length;
    const inProgress = r.filter(x => x.status === 'in_progress').length;
    const waiting = r.filter(x => x.status === 'waiting').length;
    const verification = r.filter(x => x.status === 'verification').length;
    const closed = r.filter(x => x.status === 'closed').length;
    const progress = total > 0 ? Math.round((closed / total) * 100) : 0;
    const totalWorkers = companiesH.companies.reduce((s, c) => s + (c.actualWorkers ?? 0), 0);
    const plannedWorkers = companiesH.companies.reduce((s, c) => s + (c.plannedWorkers ?? 0), 0);
    return { total, open, inProgress, waiting, verification, closed, progress, totalWorkers, plannedWorkers };
  }, [reservesH.reserves.length, reservesH.reserves, companiesH.companies]);

  const activeChantier = useMemo(
    () => chantiersH.chantiers.find(c => c.id === activeChantierId) ?? null,
    [chantiersH.chantiers, activeChantierId]
  );

  // Fix 10: isLoading aggregates all hooks, not just 2
  const isLoading = chantiersH.isLoadingChantiers || reservesH.isLoadingReserves
    || tasksH.isLoadingTasks || documentsH.isLoadingDocuments
    || photosH.isLoadingPhotos || profilesH.isLoadingProfiles
    || visitesH.isLoadingVisites || lotsH.isLoadingLots
    || oprsH.isLoadingOprs || companiesH.isLoadingCompanies;

  const migrateReservesToPlan = useCallback((fromPlanId: string, toPlanId: string): number => {
    const result = chantiersH.migrateReservesToPlan(fromPlanId, toPlanId);
    return typeof result === 'number' ? result : 0;
  }, [chantiersH]);

  const value = useMemo<AppContextValue>(() => ({
    reserves: reservesH.reserves,
    companies: companiesH.companies,
    tasks: tasksH.tasks,
    documents: documentsH.documents,
    photos: photosH.photos,
    messages: messagesH.messages,
    lastReadByChannel,
    isLoading,
    profiles: profilesH.profiles,
    generalChannels: channelsH.generalChannels,
    customChannels: channelsH.customChannels,
    groupChannels: channelsH.groupChannels,
    persistedDmChannels: channelsH.persistedDmChannels,
    pinnedChannelIds: channelsH.pinnedChannelIds,
    channelMembersOverride: channelsH.channelMembersOverride,
    chantiers: chantiersH.chantiers,
    sitePlans: chantiersH.sitePlans,
    activeChantierId,
    visites: visitesH.visites,
    lots: lotsH.lots,
    oprs: oprsH.oprs,
    channels: allChannels,
    unreadByChannel,
    notification,
    activeChantier,
    addChantier: addChantierWithChannel,
    updateChantier: chantiersH.updateChantier,
    deleteChantier: deleteChantierWithChannel,
    setActiveChantier,
    addSitePlan: chantiersH.addSitePlan,
    updateSitePlan: chantiersH.updateSitePlan,
    deleteSitePlan: chantiersH.deleteSitePlan,
    addReserve: reservesH.addReserve,
    updateReserve: reservesH.updateReserve,
    updateReserveFields: reservesH.updateReserveFields,
    deleteReserve: reservesH.deleteReserve,
    updateReserveStatus: updateReserveStatusWithNotif,
    addComment: reservesH.addComment,
    addCompany: companiesH.addCompany,
    updateCompanyWorkers: companiesH.updateCompanyWorkers,
    updateCompanyFull: companiesH.updateCompanyFull,
    deleteCompany: companiesH.deleteCompany,
    updateCompanyHours: companiesH.updateCompanyHours,
    reload,
    setCurrentUser,
    addMessage,
    incomingMessage: messagesH.addNotificationMessage,
    deleteMessage: messagesH.deleteMessage,
    updateMessage: messagesH.updateMessage,
    toggleReaction: messagesH.toggleReaction,
    markMessagesRead: messagesH.markMessagesRead,
    setChannelRead,
    setActiveChannelId,
    dismissNotification,
    addTask: tasksH.addTask,
    updateTask: tasksH.updateTask,
    deleteTask: tasksH.deleteTask,
    addTaskComment: tasksH.addTaskComment,
    addPhoto: photosH.addPhoto,
    deletePhoto: photosH.deletePhoto,
    addDocument: documentsH.addDocument,
    deleteDocument: documentsH.deleteDocument,
    addCustomChannel: channelsH.addCustomChannel,
    removeCustomChannel: channelsH.removeCustomChannel,
    addGroupChannel: channelsH.addGroupChannel,
    removeGroupChannel: channelsH.removeGroupChannel,
    renameChannel: channelsH.renameChannel,
    updateCustomChannel: channelsH.updateCustomChannel,
    addChannelMember: channelsH.addChannelMember,
    removeChannelMember: channelsH.removeChannelMember,
    pinChannel: channelsH.pinChannel,
    unpinChannel: channelsH.unpinChannel,
    maxPinnedChannels: channelsH.maxPinnedChannels,
    getOrCreateDMChannel: channelsH.getOrCreateDMChannel,
    fetchOlderMessages: messagesH.fetchOlderMessages,
    fetchChannelMessages: messagesH.fetchChannelMessages,
    refreshChannelMessages: messagesH.refreshChannelMessages,
    unreadCount,
    stats,
    addVisite: visitesH.addVisite,
    updateVisite: visitesH.updateVisite,
    deleteVisite: visitesH.deleteVisite,
    linkReserveToVisite: visitesH.linkReserveToVisite,
    addLot: lotsH.addLot,
    updateLot: lotsH.updateLot,
    deleteLot: lotsH.deleteLot,
    addOpr: oprsH.addOpr,
    updateOpr: oprsH.updateOpr,
    deleteOpr: oprsH.deleteOpr,
    batchUpdateReserves: reservesH.batchUpdateReserves,
    addSitePlanVersion: chantiersH.addSitePlanVersion,
    migrateReservesToPlan,
    realtimeConnected: messagesH.realtimeConnected,
    isOfflineSession: authH.isOfflineSession,
  }), [
    reservesH.reserves, companiesH.companies, tasksH.tasks,
    documentsH.documents, photosH.photos, messagesH.messages,
    lastReadByChannel, isLoading, profilesH.profiles,
    channelsH.generalChannels, channelsH.customChannels,
    channelsH.groupChannels, channelsH.persistedDmChannels,
    channelsH.pinnedChannelIds, channelsH.channelMembersOverride,
    chantiersH.chantiers, chantiersH.sitePlans,
    activeChantierId, visitesH.visites, lotsH.lots, oprsH.oprs,
    allChannels, unreadByChannel, notification, activeChantier,
    addChantierWithChannel, deleteChantierWithChannel, chantiersH.updateChantier,
    setActiveChantier, chantiersH.addSitePlan, chantiersH.updateSitePlan,
    chantiersH.deleteSitePlan, reservesH.addReserve, reservesH.updateReserve,
    reservesH.updateReserveFields, reservesH.deleteReserve,
    updateReserveStatusWithNotif, reservesH.addComment,
    companiesH.addCompany, companiesH.updateCompanyWorkers,
    companiesH.updateCompanyFull, companiesH.deleteCompany,
    companiesH.updateCompanyHours, reload, setCurrentUser,
    addMessage, messagesH.addNotificationMessage,
    messagesH.deleteMessage, messagesH.updateMessage,
    messagesH.toggleReaction, messagesH.markMessagesRead,
    setChannelRead, setActiveChannelId, dismissNotification,
    tasksH.addTask, tasksH.updateTask, tasksH.deleteTask,
    tasksH.addTaskComment, photosH.addPhoto, photosH.deletePhoto,
    documentsH.addDocument, documentsH.deleteDocument,
    channelsH.addCustomChannel, channelsH.removeCustomChannel,
    channelsH.addGroupChannel, channelsH.removeGroupChannel,
    channelsH.renameChannel, channelsH.updateCustomChannel,
    channelsH.addChannelMember, channelsH.removeChannelMember,
    channelsH.pinChannel, channelsH.unpinChannel,
    channelsH.maxPinnedChannels, channelsH.getOrCreateDMChannel,
    messagesH.fetchOlderMessages, messagesH.fetchChannelMessages,
    messagesH.refreshChannelMessages, unreadCount, stats,
    visitesH.addVisite, visitesH.updateVisite, visitesH.deleteVisite,
    visitesH.linkReserveToVisite, lotsH.addLot, lotsH.updateLot,
    lotsH.deleteLot, oprsH.addOpr, oprsH.updateOpr, oprsH.deleteOpr,
    reservesH.batchUpdateReserves, chantiersH.addSitePlanVersion,
    migrateReservesToPlan, messagesH.realtimeConnected,
    authH.isOfflineSession,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}

export const useApp = useAppContext;

export { AppContext };
