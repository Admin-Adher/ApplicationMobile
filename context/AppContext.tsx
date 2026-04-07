import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import {
  Reserve, Company, Task, Document, Photo, Message, Channel, Profile,
  Comment, ReserveStatus, Chantier, SitePlan, Visite, Lot, Opr,
} from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { globalSeedingRef, registerInProgressRef } from '@/context/AuthContext';
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

const ACTIVE_CHANTIER_KEY = 'buildtrack_active_chantier_v2';

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
  markMessagesRead: () => void;
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

  useRealtimeSync();

  const [activeChantierId, setActiveChantierIdState] = useState<string | null>(null);
  const [lastReadByChannel, setLastReadByChannel] = useState<Record<string, string>>({});
  const [notification, setNotification] = useState<{ msg: Message; channelName: string; channelColor: string; channelIcon: string } | null>(null);

  const currentUserNameRef = useRef<string>('');
  const activeChannelIdRef = useRef<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ACTIVE_CHANTIER_KEY)
      .then(id => { if (id) setActiveChantierIdState(id); })
      .catch(() => {});
    AsyncStorage.getItem('lastReadByChannel')
      .then(raw => { if (raw) { try { setLastReadByChannel(JSON.parse(raw)); } catch {} } })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeChantierId) return;
    const first = chantiersH.chantiers[0];
    if (!first) return;
    setActiveChantierIdState(first.id);
    AsyncStorage.setItem(ACTIVE_CHANTIER_KEY, first.id).catch(() => {});
  }, [chantiersH.chantiers, activeChantierId]);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4500);
    return () => clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    initStorageBuckets().catch(() => {});
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        if (globalSeedingRef.current) return;
        if (registerInProgressRef.current) return;

        const userMeta = session.user.user_metadata;
        const userName = userMeta?.name ?? userMeta?.full_name ?? session.user.email ?? '';
        currentUserNameRef.current = userName;

        try {
          const { data: prof } = await supabase
            .from('profiles').select('last_read_by_channel')
            .eq('id', session.user.id).single();
          if (prof?.last_read_by_channel) {
            setLastReadByChannel(prof.last_read_by_channel);
          }
        } catch {}
      }
      if (event === 'SIGNED_OUT') {
        currentUserNameRef.current = '';
        setActiveChantierIdState(null);
        setLastReadByChannel({});
        setNotification(null);
        queryClient.clear();
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const userMeta = session.user.user_metadata;
        const userName = userMeta?.name ?? userMeta?.full_name ?? session.user.email ?? '';
        currentUserNameRef.current = userName;
      }
    });

    return () => authListener.subscription.unsubscribe();
  }, [queryClient]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const globalSub = supabase
      .channel('app-ctx-messages-v3')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload: any) => {
        const msg = payload.new as any;
        const isMe = msg.sender === currentUserNameRef.current;
        if (!isMe && activeChannelIdRef.current !== msg.channel_id) {
          const allChannels = [
            ...channelsH.generalChannels,
            ...channelsH.customChannels,
            ...channelsH.groupChannels,
            ...channelsH.persistedDmChannels,
          ];
          const ch = allChannels.find(c => c.id === msg.channel_id);
          const isDM = (msg.channel_id ?? '').startsWith('dm-');
          setNotification({
            msg: {
              id: msg.id, channelId: msg.channel_id, sender: msg.sender, content: msg.content,
              timestamp: msg.timestamp ?? '', type: 'message', read: false, isMe: false,
              reactions: msg.reactions ?? {}, isPinned: false, readBy: msg.read_by ?? [], mentions: [],
            },
            channelName: isDM ? msg.sender : (ch?.name ?? msg.channel_id),
            channelColor: ch?.color ?? C.primary,
            channelIcon: isDM ? 'person-circle' : (ch?.icon ?? 'chatbubbles'),
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(globalSub); };
  }, [channelsH.generalChannels, channelsH.customChannels, channelsH.groupChannels, channelsH.persistedDmChannels]);

  const setActiveChantier = useCallback((id: string) => {
    setActiveChantierIdState(id);
    AsyncStorage.setItem(ACTIVE_CHANTIER_KEY, id).catch(() => {});
  }, []);

  const setCurrentUser = useCallback((name: string) => {
    currentUserNameRef.current = name;
  }, []);

  const setActiveChannelId = useCallback((id: string | null) => {
    activeChannelIdRef.current = id;
    if (id) setNotification(prev => (prev?.msg.channelId === id ? null : prev));
  }, []);

  const dismissNotification = useCallback(() => setNotification(null), []);

  const setChannelRead = useCallback((channelId: string) => {
    const timestamp = new Date().toISOString();
    setLastReadByChannel(prev => {
      const next = { ...prev, [channelId]: timestamp };
      AsyncStorage.setItem('lastReadByChannel', JSON.stringify(next)).catch(() => {});
      return next;
    });
    const userName = currentUserNameRef.current;
    messagesH.setChannelRead(channelId, userName);
    if (isSupabaseConfigured && userName) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user?.id) {
          const newLastRead = { ...lastReadByChannel, [channelId]: timestamp };
          supabase.from('profiles').update({ last_read_by_channel: newLastRead })
            .eq('id', session.user.id).catch(() => {});
        }
      }).catch(() => {});
    }
  }, [messagesH, lastReadByChannel]);

  const reload = useCallback(() => {
    queryClient.invalidateQueries();
    channelsH.reloadChannels();
  }, [queryClient, channelsH]);

  const addMessage = useCallback((
    channelId: string,
    content: string,
    options: Partial<Pick<Message, 'replyToId' | 'replyToContent' | 'replyToSender' | 'attachmentUri' | 'mentions' | 'reserveId' | 'linkedItemType' | 'linkedItemId' | 'linkedItemTitle'>> = {},
    sender = 'Moi'
  ) => {
    messagesH.addMessage(channelId, content, options, sender, channelsH.getDmUpsertPromise);
  }, [messagesH, channelsH]);

  const updateReserveStatusWithNotif = useCallback((id: string, status: ReserveStatus, author?: string) => {
    const actualAuthor = author ?? currentUserNameRef.current ?? 'Système';
    reservesH.updateReserveStatus(id, status, actualAuthor);

    const reserve = (queryClient.getQueryData<Reserve[]>(['reserves']) ?? []).find(r => r.id === id);
    if (!reserve) return;
    const companiesData = queryClient.getQueryData<Company[]>(['companies']) ?? [];
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
  }, [reservesH, messagesH, queryClient]);

  const addChantierWithChannel = useCallback((c: Chantier, plans: SitePlan[]) => {
    chantiersH.addChantier(c, plans, (buildingCh: Channel) => {
      channelsH.addGeneralChannel(buildingCh);
    });
  }, [chantiersH, channelsH]);

  const allChannels = useMemo(() => {
    const companies = companiesH.companies;
    const companyChannels: Channel[] = companies.map(c => ({
      id: `company-${c.id}`,
      name: c.name,
      description: `Canal entreprise ${c.name}`,
      icon: 'business',
      color: c.color ?? '#10B981',
      type: 'company' as any,
      members: [],
    }));
    return [
      ...channelsH.generalChannels,
      ...channelsH.customChannels,
      ...channelsH.groupChannels,
      ...channelsH.persistedDmChannels,
      ...companyChannels,
    ];
  }, [
    channelsH.generalChannels, channelsH.customChannels,
    channelsH.groupChannels, channelsH.persistedDmChannels,
    companiesH.companies,
  ]);

  const unreadByChannel = useMemo(() => {
    const result: Record<string, number> = {};
    for (const msg of messagesH.messages) {
      if (!msg.isMe && !msg.read) {
        const lastRead = lastReadByChannel[msg.channelId];
        const msgTime = msg.dbCreatedAt ? new Date(msg.dbCreatedAt).getTime() : 0;
        const lastReadTime = lastRead ? new Date(lastRead).getTime() : 0;
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
  }, [reservesH.reserves, companiesH.companies]);

  const activeChantier = useMemo(
    () => chantiersH.chantiers.find(c => c.id === activeChantierId) ?? null,
    [chantiersH.chantiers, activeChantierId]
  );

  const isLoading = chantiersH.isLoadingChantiers || reservesH.isLoadingReserves;

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
    deleteChantier: chantiersH.deleteChantier,
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
    addChantierWithChannel, chantiersH.updateChantier, chantiersH.deleteChantier,
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
