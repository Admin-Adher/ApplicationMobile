import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  Reserve, Company, Task, Document, Photo, Message, Channel, Profile,
  Comment, ReserveStatus, Chantier, SitePlan, Visite, Lot, Opr,
} from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { consumeIntentionalLogout } from '@/lib/authIntent';
import { useAuth, globalSeedingRef, registerInProgressRef, loginInProgressRef } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { useNotificationPreferences } from '@/context/NotificationPreferencesContext';
import { initStorageBuckets } from '@/lib/storage';
import { clearPersistedRqCache } from '@/lib/queryPersister';
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
import { useChannels, getDmDisplayName, getDmParticipants } from '@/hooks/queries/useChannels';
import { useMessages } from '@/hooks/queries/useMessages';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { notifyReserveStatusChanged } from '@/lib/email/notifyReserveCreated';
import { triggerReserveStatusPush } from '@/lib/push/client';
import { isSameUserName } from '@/lib/mappers';
import { visibleReservesForUser } from '@/lib/reserveVisibility';

export { STANDARD_LOTS } from '@/hooks/queries/useLots';
export const STATIC_CHANNELS: Channel[] = [];

const ACTIVE_CHANTIER_PREFIX = 'buildtrack_active_chantier_v3_';
const SERVER_REFRESH_MAX_WAIT_MS = 8_000;
const FOREGROUND_REFRESH_MIN_SLEEP_MS = 5_000;
const STARTUP_BLOCKING_QUERY_KEYS = [
  queryKeys.chantiers(),
  queryKeys.sitePlans(),
  queryKeys.reserves(),
  queryKeys.companies(),
  queryKeys.tasks(),
  queryKeys.profiles(),
] as const;
const STARTUP_BLOCKING_QUERY_KEY_IDS = new Set(
  STARTUP_BLOCKING_QUERY_KEYS.map(key => JSON.stringify(key)),
);

function isStartupBlockingQueryKey(queryKey: readonly unknown[]): boolean {
  return STARTUP_BLOCKING_QUERY_KEY_IDS.has(JSON.stringify(queryKey));
}

function getMessageTimeMs(msg: Message): number {
  if (msg.dbCreatedAt) return new Date(msg.dbCreatedAt).getTime();
  const m = msg.timestamp?.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime();
  return 0;
}

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
  hiddenDmChannelIds: Record<string, string>;
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
  archiveReserve: (id: string, author?: string) => void;
  unarchiveReserve: (id: string, author?: string) => void;
  addComment: (reserveId: string, content: string, author?: string) => void;
  updateComment: (reserveId: string, commentId: string, newContent: string) => void;
  deleteComment: (reserveId: string, commentId: string) => void;
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
  updateTaskComment: (taskId: string, commentId: string, newContent: string) => void;
  deleteTaskComment: (taskId: string, commentId: string) => void;
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
  hideDmChannel: (id: string) => void;
  unhideDmChannel: (id: string) => void;
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
  attachReservesToVisite: (visiteId: string, reserveIds: string[]) => Promise<{ success: boolean; queued?: boolean; movedCount?: number; error?: string }>;
  unlinkReservesFromVisite: (visiteId: string, reserveIds: string[]) => Promise<{ success: boolean; queued?: boolean; updatedCount?: number; error?: string }>;
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
  const { isOnline, enqueueOperation, queueLoaded } = useNetwork();
  const { preferences: notificationPreferences } = useNotificationPreferences();

  useRealtimeSync();

  const [activeChantierId, setActiveChantierIdState] = useState<string | null>(null);
  const [lastReadByChannel, setLastReadByChannel] = useState<Record<string, string>>({});
  const [notification, setNotification] = useState<{ msg: Message; channelName: string; channelColor: string; channelIcon: string } | null>(null);
  const [serverRefreshToken, setServerRefreshToken] = useState(0);
  const [serverRefreshInProgress, setServerRefreshInProgress] = useState(false);

  const currentUserNameRef = useRef<string>('');
  const [currentUserName, setCurrentUserName] = useState('');
  const activeChannelIdRef = useRef<string | null>(null);
  const chantierInitializedRef = useRef(false);
  const refreshedServerKeyRef = useRef<string | null>(null);
  const reloadChannelsRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const reloadMessagesRef = useRef<(() => Promise<void>) | undefined>(undefined);
  // Fix 1: ref to always have latest lastReadByChannel without stale closure
  const lastReadByChannelRef = useRef<Record<string, string>>({});
  // Fix 4: ref to track if we have a cached profile (offline session), avoids async AsyncStorage in event handler
  const hasCachedProfileRef = useRef(false);
  reloadChannelsRef.current = channelsH.reloadChannels;
  reloadMessagesRef.current = messagesH.reloadMessages;

  const needsServerFreshness = Boolean(
    authH.user?.id &&
      isSupabaseConfigured &&
      isOnline &&
      !authH.isOfflineSession
  );
  const serverFreshnessKey = needsServerFreshness
    ? `${authH.user!.id}:${serverRefreshToken}`
    : null;
  const sessionValidationBlocking = Boolean(
    authH.user?.id &&
      isSupabaseConfigured &&
      isOnline &&
      authH.isSessionValidationPending
  );
  const serverRefreshBlocking = sessionValidationBlocking || (needsServerFreshness && (
    !queueLoaded ||
      serverRefreshInProgress ||
      refreshedServerKeyRef.current !== serverFreshnessKey
  ));

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!authH.user?.id) return;

    let backgroundAt = 0;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        const sleptMs = backgroundAt > 0 ? Date.now() - backgroundAt : 0;
        if (sleptMs > FOREGROUND_REFRESH_MIN_SLEEP_MS) {
          setServerRefreshToken(token => token + 1);
        }
        backgroundAt = 0;
        return;
      }

      if (state === 'background' || state === 'inactive') {
        backgroundAt = Date.now();
      }
    });

    return () => sub.remove();
  }, [authH.user?.id]);

  useEffect(() => {
    if (!needsServerFreshness) {
      refreshedServerKeyRef.current = null;
      setServerRefreshInProgress(false);
      return;
    }
    if (!queueLoaded || !serverFreshnessKey) return;
    if (refreshedServerKeyRef.current === serverFreshnessKey) return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    setServerRefreshInProgress(true);

    const timeoutPromise = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, SERVER_REFRESH_MAX_WAIT_MS);
    });
    const blockingRefetchPromise = Promise.all(
      STARTUP_BLOCKING_QUERY_KEYS.map(queryKey =>
        queryClient.refetchQueries(
          { queryKey, exact: true },
          { cancelRefetch: false },
        )
      )
    ).then(() => undefined).catch((err) => {
      if (!cancelled) {
        console.warn('[AppContext] server freshness refresh failed:', (err as any)?.message ?? err);
      }
    });

    Promise.race([blockingRefetchPromise, timeoutPromise]).finally(() => {
      if (timeout) clearTimeout(timeout);
      if (cancelled) return;
      refreshedServerKeyRef.current = serverFreshnessKey;
      setServerRefreshInProgress(false);

      void queryClient.refetchQueries(
        {
          type: 'active',
          predicate: query => !isStartupBlockingQueryKey(query.queryKey),
        },
        { cancelRefetch: false },
      ).catch((err) => {
        console.warn('[AppContext] background refresh failed:', (err as any)?.message ?? err);
      });
      void (reloadChannelsRef.current?.() ?? Promise.resolve()).catch((err) => {
        console.warn('[AppContext] background channels refresh failed:', (err as any)?.message ?? err);
      });
      void (reloadMessagesRef.current?.() ?? Promise.resolve()).catch((err) => {
        console.warn('[AppContext] background messages refresh failed:', (err as any)?.message ?? err);
      });
    });

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [needsServerFreshness, queueLoaded, queryClient, serverFreshnessKey]);

  // Fix 14: namespace lastReadByChannel by userId so different accounts don't share state
  const lastReadStorageKey = useMemo(() => `lastReadByChannel_${authH.user?.id ?? 'anon'}`, [authH.user?.id]);

  // Keep current user name consistent across the app.
  // Messages/readBy are keyed by profile.name, so using session metadata (email/full_name)
  // can cause false unread badges after restart.
  useEffect(() => {
    const name = authH.user?.name ?? '';
    if (!name) return;
    if (currentUserNameRef.current === name) return;
    currentUserNameRef.current = name;
    setCurrentUserName(name);
  }, [authH.user?.name]);

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
      // INITIAL_SESSION fires on app restart with existing session — must also
      // load lastReadByChannel from Supabase so unread state is correct.
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
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
          const { data: prof } = await (supabase as any)
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
        // Distinguish an intentional logout (the user tapped "Logout") from
        // an automatic SIGNED_OUT fired by supabase-js when a token refresh
        // fails or the session is invalidated. Only the intentional one
        // should wipe the per-user offline caches — automatic ones leave
        // them intact so the user keeps seeing their data while AuthContext
        // either recovers a fresh session or falls back to the cached profile.
        const intentional = consumeIntentionalLogout();
        currentUserNameRef.current = '';
        setCurrentUserName('');
        setActiveChantierIdState(null);
        chantierInitializedRef.current = false;
        setLastReadByChannel({});
        lastReadByChannelRef.current = {};
        setNotification(null);
        if (intentional) {
          // Clear both in-memory and persisted query cache so the next
          // user never sees stale data from a previous session. We clear
          // both the legacy global key and the per-user namespaced key
          // (introduced in queryPersister.ts) for the just-logged-out user.
          queryClient.clear();
          AsyncStorage.removeItem('buildtrack_rq_cache_v1').catch(() => {});
          const justSignedOutId = session?.user?.id ?? null;
          clearPersistedRqCache(justSignedOutId).catch(() => {});
          clearPersistedRqCache(null).catch(() => {});
          hasCachedProfileRef.current = false;
        }
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
    ...companiesH.companies.map(c => ({
      id: `company-${c.id}`,
      name: c.name,
      description: `Canal entreprise ${c.name}`,
      icon: 'business',
      color: c.color ?? '#10B981',
      type: 'company' as const,
      members: [],
    })),
  ];

  // Bug 4: Use incomingMessageHandler from useMessages instead of duplicate realtime subscription
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    messagesH.registerIncomingMessageHandler((msg: Message, raw: any) => {
      if (!notificationPreferences.inAppEnabled || !notificationPreferences.messagesInApp) return;
      if (msg.isMe) return;
      if (activeChannelIdRef.current === msg.channelId) return;
      const ch = channelsRef.current.find(c => c.id === msg.channelId);
      const isDM = (msg.channelId ?? '').startsWith('dm-');
      // Bug 9: for DM notifications, use channel name (interlocutor) not sender name
      const channelName = isDM
        ? getDmDisplayName(
            { id: msg.channelId ?? '', name: ch?.name ?? msg.sender, members: ch?.members, dmParticipants: ch?.dmParticipants },
            currentUserNameRef.current,
          )
        : (ch?.name ?? msg.channelId ?? '');
      setNotification({
        msg,
        channelName,
        channelColor: ch?.color ?? C.primary,
        channelIcon: isDM ? 'person-circle' : (ch?.icon ?? 'chatbubbles'),
      });
    });
    return () => { messagesH.registerIncomingMessageHandler(null); };
  }, [messagesH.registerIncomingMessageHandler, notificationPreferences.inAppEnabled, notificationPreferences.messagesInApp]);

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
  const markChannelMessagesRead = messagesH.setChannelRead;
  const sendMessageToStore = messagesH.addMessage;
  const addNotificationMessageToStore = messagesH.addNotificationMessage;
  const unhideDmChannel = channelsH.unhideDmChannel;
  const getDmUpsertPromise = channelsH.getDmUpsertPromise;

  const setChannelRead = useCallback((channelId: string) => {
    const timestamp = new Date().toISOString();
    const newLastRead = { ...lastReadByChannelRef.current, [channelId]: timestamp };
    lastReadByChannelRef.current = newLastRead;
    setLastReadByChannel(newLastRead);
    AsyncStorage.setItem(lastReadStorageKey, JSON.stringify(newLastRead)).catch(() => {});
    const userName = currentUserNameRef.current;
    markChannelMessagesRead(channelId, userName);
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
      void (async () => {
        try {
          const { error } = await (supabase as any).from('profiles').update({ last_read_by_channel: newLastRead }).eq('id', userId);
          if (error) {
            enqueueOperation({
              table: 'profiles',
              op: 'update',
              filter: { column: 'id', value: userId },
              data: { last_read_by_channel: newLastRead },
            });
          }
        } catch {
          enqueueOperation({
            table: 'profiles',
            op: 'update',
            filter: { column: 'id', value: userId },
            data: { last_read_by_channel: newLastRead },
          });
        }
      })();
    }
  }, [markChannelMessagesRead, lastReadStorageKey, authH.user?.id, isOnline, enqueueOperation]);

  const reload = useCallback(() => {
    queryClient.invalidateQueries();
    channelsH.reloadChannels();
  }, [queryClient, channelsH]);

  // When the authenticated user changes, force all queries to refetch.
  // Without this, stale persisted data from a previous session can be
  // displayed because refetchOnMount is false and staleTime is 5 min.
  useEffect(() => {
    if (authH.user?.id) {
      queryClient.invalidateQueries();
    }
  }, [authH.user?.id, queryClient]);

  // Fix 9: addMessage uses currentUserNameRef as default sender instead of hardcoded 'Moi'
  const addMessage = useCallback((
    channelId: string,
    content: string,
    options: Partial<Pick<Message, 'replyToId' | 'replyToContent' | 'replyToSender' | 'attachmentUri' | 'mentions' | 'reserveId' | 'linkedItemType' | 'linkedItemId' | 'linkedItemTitle'>> = {},
    sender?: string
  ) => {
    const actualSender = sender ?? (currentUserNameRef.current || 'Moi');
    if (channelId.startsWith('dm-')) {
      unhideDmChannel(channelId);
    }
    sendMessageToStore(channelId, content, options, actualSender, getDmUpsertPromise);
    // Auto-mark channel as read when sending — updates lastReadByChannel timestamp
    // so the channel doesn't appear unread after app restart
    setChannelRead(channelId);
  }, [sendMessageToStore, unhideDmChannel, getDmUpsertPromise, setChannelRead]);

  // Fix 8: updateReserveStatusWithNotif uses reservesH.reserves and companiesH.companies instead of queryClient.getQueryData
  const updateReserveStatusWithNotif = useCallback((id: string, status: ReserveStatus, author?: string) => {
    const actualAuthor = author ?? currentUserNameRef.current ?? 'Système';
    const previousReserve = reservesH.reserves.find(r => r.id === id);
    const previousStatus = previousReserve?.status;
    reservesH.updateReserveStatus(id, status, actualAuthor);

    const reserve = reservesH.reserves.find(r => r.id === id);
    if (!reserve) return;

    if (previousStatus !== status) {
      notifyReserveStatusChanged({
        reserve: { ...reserve, status },
        newStatus: status,
        previousStatus,
        companies: companiesH.companies,
        profiles: profilesH.profiles,
        chantiers: chantiersH.chantiers,
        changedByName: actualAuthor,
      });
      triggerReserveStatusPush(id, status, previousStatus);
    }
    const companiesData = companiesH.companies;
    const reserveCompanyNames = reserve.companies ?? (reserve.company ? [reserve.company] : []);
    const notifiedCompanies = companiesData.filter(c =>
      reserveCompanyNames.some(name => isSameUserName(name, c.name))
    );
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
      addNotificationMessageToStore(notifMsg);
    }
  }, [reservesH, reservesH.reserves, companiesH.companies, addNotificationMessageToStore, profilesH.profiles, chantiersH.chantiers]);

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

  const messageStateByChannel = useMemo(() => {
    const state = new Map<string, { count: number; latestTime: number }>();
    for (const msg of messagesH.messages) {
      if (!msg.channelId) continue;
      const current = state.get(msg.channelId) ?? { count: 0, latestTime: 0 };
      current.count += 1;
      current.latestTime = Math.max(current.latestTime, getMessageTimeMs(msg));
      state.set(msg.channelId, current);
    }
    return state;
  }, [messagesH.messages]);

  const allChannels = useMemo(() => {
    // Fix DM names: always show the interlocutor's name, not the current user's name
    const myName = currentUserName;
    const fixedDmChannels = channelsH.persistedDmChannels.flatMap(ch => {
      if (ch.type !== 'dm') return ch;
      const channelMessageState = messageStateByChannel.get(ch.id);
      const hasAnyMessage =
        (channelMessageState?.count ?? 0) > 0 ||
        channelsH.dmChannelIdsWithMessages.has(ch.id);
      if (!hasAnyMessage) return [];
      const hiddenAt = channelsH.hiddenDmChannelIds[ch.id];
      if (hiddenAt) {
        const hiddenAtMs = new Date(hiddenAt).getTime();
        const hasMessageAfterHidden = (channelMessageState?.latestTime ?? 0) > hiddenAtMs;
        if (!hasMessageAfterHidden) return [];
      }
      const participants = getDmParticipants(ch.id, ch.members, ch.dmParticipants);
      const otherName = getDmDisplayName(
        { id: ch.id, name: ch.name, members: participants, dmParticipants: participants },
        myName,
      );
      if (
        otherName === ch.name &&
        JSON.stringify(ch.members ?? []) === JSON.stringify(participants) &&
        JSON.stringify(ch.dmParticipants ?? []) === JSON.stringify(participants)
      ) {
        return [ch];
      }
      return [{
        ...ch,
        name: otherName,
        description: `Message direct avec ${otherName}`,
        members: participants,
        dmParticipants: participants,
      }];
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
    channelsH.dmChannelIdsWithMessages, channelsH.hiddenDmChannelIds,
    messageStateByChannel, companyChannels, currentUserName,
  ]);

  // Fix 7: unreadByChannel uses lastReadByChannelRef to avoid stale closure issues
  // A message is unread if: it's from someone else AND current user is NOT in readBy
  // AND the message arrived after we last read the channel.
  const unreadByChannel = useMemo(() => {
    const result: Record<string, number> = {};
    const lastRead = lastReadByChannelRef.current;
    const myName = currentUserNameRef.current;
    const visibleChannelIds = new Set(allChannels.map(ch => ch.id));
    for (const msg of messagesH.messages) {
      if (!msg.channelId) continue;
      if (!visibleChannelIds.has(msg.channelId)) continue;
      if (myName && isSameUserName(msg.sender, myName)) continue;
      if (msg.isMe) continue;
      // Check readBy directly (more reliable than msg.read which can be stale)
      const iReadIt = myName && msg.readBy.some((u: string) => isSameUserName(u, myName));
      if (iReadIt) continue;
      const msgTime = getMessageTimeMs(msg);
      const hiddenAt = channelsH.hiddenDmChannelIds[msg.channelId];
      if (hiddenAt && msgTime <= new Date(hiddenAt).getTime()) continue;
      const lastReadTime = lastRead[msg.channelId] ? new Date(lastRead[msg.channelId]).getTime() : 0;
      if (msgTime > lastReadTime) {
        result[msg.channelId] = (result[msg.channelId] ?? 0) + 1;
      }
    }
    return result;
  }, [messagesH.messages, lastReadByChannel, channelsH.hiddenDmChannelIds, allChannels]);

  const unreadCount = useMemo(
    () => Object.values(unreadByChannel).reduce((a, b) => a + b, 0),
    [unreadByChannel]
  );

  const visibleReserves = useMemo(
    () => visibleReservesForUser(reservesH.reserves, authH.user, companiesH.companies),
    [reservesH.reserves, authH.user, companiesH.companies],
  );

  const visiblePhotos = useMemo(() => {
    if (authH.user?.role !== 'sous_traitant') return photosH.photos;
    const visibleReserveIds = new Set(visibleReserves.map(reserve => reserve.id));
    return photosH.photos.filter(photo => Boolean(photo.reserveId && visibleReserveIds.has(photo.reserveId)));
  }, [authH.user?.role, photosH.photos, visibleReserves]);

  // Fix 15: stats computed from pre-aggregated counts to reduce re-renders
  const stats = useMemo(() => {
    const r = visibleReserves;
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
  }, [visibleReserves, companiesH.companies]);

  const activeChantier = useMemo(
    () => chantiersH.chantiers.find(c => c.id === activeChantierId) ?? null,
    [chantiersH.chantiers, activeChantierId]
  );

  // Startup blocks only on the data needed by the first screens. Heavier
  // secondary modules refresh in the background or show their own screen-level
  // loading state, which keeps Supabase sync from holding the whole app.
  const isLoading = serverRefreshBlocking || chantiersH.isLoadingChantiers || reservesH.isLoadingReserves
    || tasksH.isLoadingTasks || profilesH.isLoadingProfiles
    || chantiersH.isLoadingSitePlans || companiesH.isLoadingCompanies;

  const migrateReservesToPlan = useCallback((fromPlanId: string, toPlanId: string): number => {
    const result = chantiersH.migrateReservesToPlan(fromPlanId, toPlanId);
    return typeof result === 'number' ? result : 0;
  }, [chantiersH]);

  const value = useMemo<AppContextValue>(() => ({
    reserves: visibleReserves,
    companies: companiesH.companies,
    tasks: tasksH.tasks,
    documents: documentsH.documents,
    photos: visiblePhotos,
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
    hiddenDmChannelIds: channelsH.hiddenDmChannelIds,
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
    archiveReserve: reservesH.archiveReserve,
    unarchiveReserve: reservesH.unarchiveReserve,
    addComment: reservesH.addComment,
    updateComment: reservesH.updateComment,
    deleteComment: reservesH.deleteComment,
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
    updateTaskComment: tasksH.updateTaskComment,
    deleteTaskComment: tasksH.deleteTaskComment,
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
    hideDmChannel: channelsH.hideDmChannel,
    unhideDmChannel: channelsH.unhideDmChannel,
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
    attachReservesToVisite: visitesH.attachReservesToVisite,
    unlinkReservesFromVisite: visitesH.unlinkReservesFromVisite,
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
    visibleReserves, companiesH.companies, tasksH.tasks,
    documentsH.documents, visiblePhotos, messagesH.messages,
    lastReadByChannel, isLoading, profilesH.profiles,
    channelsH.generalChannels, channelsH.customChannels,
    channelsH.groupChannels, channelsH.persistedDmChannels,
    channelsH.pinnedChannelIds, channelsH.channelMembersOverride,
    channelsH.hiddenDmChannelIds,
    chantiersH.chantiers, chantiersH.sitePlans,
    activeChantierId, visitesH.visites, lotsH.lots, oprsH.oprs,
    allChannels, unreadByChannel, notification, activeChantier,
    addChantierWithChannel, deleteChantierWithChannel, chantiersH.updateChantier,
    setActiveChantier, chantiersH.addSitePlan, chantiersH.updateSitePlan,
    chantiersH.deleteSitePlan, reservesH.addReserve, reservesH.updateReserve,
    reservesH.updateReserveFields, reservesH.deleteReserve,
    updateReserveStatusWithNotif, reservesH.archiveReserve, reservesH.unarchiveReserve, reservesH.addComment, reservesH.updateComment, reservesH.deleteComment,
    companiesH.addCompany, companiesH.updateCompanyWorkers,
    companiesH.updateCompanyFull, companiesH.deleteCompany,
    companiesH.updateCompanyHours, reload, setCurrentUser,
    addMessage, messagesH.addNotificationMessage,
    messagesH.deleteMessage, messagesH.updateMessage,
    messagesH.toggleReaction, messagesH.markMessagesRead,
    setChannelRead, setActiveChannelId, dismissNotification,
    tasksH.addTask, tasksH.updateTask, tasksH.deleteTask,
    tasksH.addTaskComment, tasksH.updateTaskComment, tasksH.deleteTaskComment,
    photosH.addPhoto, photosH.deletePhoto,
    documentsH.addDocument, documentsH.deleteDocument,
    channelsH.addCustomChannel, channelsH.removeCustomChannel,
    channelsH.addGroupChannel, channelsH.removeGroupChannel,
    channelsH.renameChannel, channelsH.updateCustomChannel,
    channelsH.addChannelMember, channelsH.removeChannelMember,
    channelsH.pinChannel, channelsH.unpinChannel,
    channelsH.hideDmChannel, channelsH.unhideDmChannel,
    channelsH.maxPinnedChannels, channelsH.getOrCreateDMChannel,
    messagesH.fetchOlderMessages, messagesH.fetchChannelMessages,
    messagesH.refreshChannelMessages, unreadCount, stats,
    visitesH.addVisite, visitesH.updateVisite, visitesH.deleteVisite,
    visitesH.attachReservesToVisite, visitesH.unlinkReservesFromVisite, visitesH.linkReserveToVisite, lotsH.addLot, lotsH.updateLot,
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
