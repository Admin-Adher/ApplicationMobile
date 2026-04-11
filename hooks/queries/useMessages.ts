import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { Message } from '@/constants/types';
import { genId, nowTimestampFR } from '@/lib/utils';
import { toMessage, fromMessage } from '@/lib/mappers';

const MOCK_MESSAGES_KEY = 'buildtrack_mock_messages_v2';
const MESSAGES_CACHE_PREFIX = 'buildtrack_messages_cache_v1_';

export function useMessages() {
  const { user } = useAuth();
  const { isOnline, enqueueOperation, registerReloadHandler } = useNetwork();
  const [messages, setMessages] = useState<Message[]>([]);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const userNameRef = useRef<string>(user?.name ?? '');
  useEffect(() => { userNameRef.current = user?.name ?? ''; }, [user?.name]);
  // Bug 7: track orgId for filtering messages by organization
  const orgIdRef = useRef<string | null>(user?.organizationId ?? null);
  useEffect(() => { orgIdRef.current = user?.organizationId ?? null; }, [user?.organizationId]);

  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  const loadedChannelIdsRef = useRef<Set<string>>(new Set());
  const dmUpsertPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const realtimeWasConnectedRef = useRef(false);
  // Bug 4: callback ref for AppContext to receive incoming messages without duplicate realtime subscription
  const incomingMessageHandlerRef = useRef<((msg: Message, raw: any) => void) | null>(null);

  useEffect(() => {
    if (!user) return;
    // Clear stale messages from previous account immediately
    setMessages([]);
    loadedChannelIdsRef.current.clear();
    // Bug 6: namespace cache by userId so different accounts don't share cached messages
    const cacheKey = isSupabaseConfigured ? MESSAGES_CACHE_PREFIX + user.id : MOCK_MESSAGES_KEY;
    AsyncStorage.getItem(cacheKey).then(raw => {
      if (raw) {
        try {
          const cached: Message[] = JSON.parse(raw);
          // Bug 3 (already fixed): recalculate isMe based on current user
          // Bug 13: also recalculate readBy — remove current user from readBy of other people's messages
          const currentUserName = userNameRef.current;
          const fixed = cached.map(m => ({
            ...m,
            isMe: currentUserName ? m.sender === currentUserName : m.isMe,
            readBy: currentUserName && !m.isMe
              ? m.readBy.filter((u: string) => u !== currentUserName)
              : m.readBy,
          }));
          setMessages(fixed);
        } catch {}
      }
    }).catch(() => {});
    if (!isSupabaseConfigured) return;
    loadedChannelIdsRef.current.clear();
    loadRecentMessages();
  }, [user?.id]);

  async function loadRecentMessages() {
    if (!isSupabaseConfigured) return;
    try {
      // Bug 7: filter by organization_id when available to avoid cross-org messages
      let query = supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      const orgId = orgIdRef.current;
      if (orgId) query = query.eq('organization_id', orgId);
      const { data, error } = await query;
      if (error) {
        console.warn('[useMessages] loadRecentMessages error:', error.code, error.message);
        return;
      }
      if (data && data.length > 0) {
        const userName = userNameRef.current;
        const msgs = data.map((r: any) => toMessage(r, userName));
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newOnes = msgs.filter(m => !existingIds.has(m.id));
          if (newOnes.length === 0) return prev;
          const merged = [...newOnes, ...prev];
          merged.sort((a, b) => {
            const ta = a.dbCreatedAt ? new Date(a.dbCreatedAt).getTime() : 0;
            const tb = b.dbCreatedAt ? new Date(b.dbCreatedAt).getTime() : 0;
            return ta - tb;
          });
          return merged;
        });
      } else {
        console.warn('[useMessages] loadRecentMessages returned empty. data:', data);
      }
    } catch (err) {
      console.warn('[useMessages] loadRecentMessages exception:', err);
    }
  }

  // Persistance locale : mock mode ET cache Supabase (pour fonctionnement hors ligne)
  // Bug 6: namespace cache by userId
  useEffect(() => {
    const timer = setTimeout(() => {
      const userId = user?.id;
      if (!userId) return;
      const key = isSupabaseConfigured ? MESSAGES_CACHE_PREFIX + userId : MOCK_MESSAGES_KEY;
      AsyncStorage.setItem(key, JSON.stringify(messages)).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [messages, user?.id]);

  // Garde une ref vers loadRecentMessages pour l'appeler depuis le callback de reconnexion
  const loadRecentMessagesRef = useRef<() => void>(() => {});
  loadRecentMessagesRef.current = () => { loadRecentMessages(); };

  useEffect(() => {
    if (!isSupabaseConfigured || !user) return;

    const channelName = `messages-realtime-v2-${user.id}`;
    const globalSub = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload: any) => {
        const userName = userNameRef.current;
        const msg = toMessage(payload.new, userName);
        // Filter: only accept messages for channels we should see
        // (RLS already filters server-side, but this is a safety net)
        const orgId = orgIdRef.current;
        const incomingOrgId = payload.new.organization_id;
        if (orgId && incomingOrgId && incomingOrgId !== orgId) return;
        setMessages(prev => {
          if (prev.find(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        // Bug 4: notify AppContext of incoming message (replaces duplicate realtime subscription)
        if (incomingMessageHandlerRef.current) {
          incomingMessageHandlerRef.current(msg, payload.new);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload: any) => {
        const userName = userNameRef.current;
        const incoming = toMessage(payload.new, userName);
        if (incoming.isMe) {
          setMessages(prev => {
            const current = prev.find(m => m.id === incoming.id);
            if (current) {
              const reactionsChanged = JSON.stringify(incoming.reactions) !== JSON.stringify(current.reactions);
              const readByChanged = (incoming.readBy?.length ?? 0) !== (current.readBy?.length ?? 0);
              if (!reactionsChanged && !readByChanged) return prev;
            }
            return prev.map(m => m.id === incoming.id ? incoming : m);
          });
        } else {
          setMessages(prev => prev.map(m => m.id === incoming.id ? incoming : m));
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload: any) => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id));
      })
      .subscribe((status: string) => {
        const isNowConnected = status === 'SUBSCRIBED';
        setRealtimeConnected(isNowConnected);
        // Reconnexion : recharger les messages manqués pendant la déconnexion
        if (isNowConnected && realtimeWasConnectedRef.current) {
          console.log('[useMessages] Realtime reconnected — reloading recent messages');
          loadRecentMessagesRef.current();
        }
        if (isNowConnected) {
          realtimeWasConnectedRef.current = true;
        }
      });

    return () => { supabase.removeChannel(globalSub); };
  }, [user?.id]);

  const addMessage = useCallback((
    channelId: string,
    content: string,
    options: Partial<Pick<Message, 'replyToId' | 'replyToContent' | 'replyToSender' | 'attachmentUri' | 'mentions' | 'reserveId' | 'linkedItemType' | 'linkedItemId' | 'linkedItemTitle'>> = {},
    sender = 'Moi',
    getDmUpsertPromise?: (id: string) => Promise<void> | undefined,
  ) => {
    const ts = nowTimestampFR();
    const actualSender = userNameRef.current || sender;
    const msg: Message = {
      id: genId(), channelId, sender: actualSender, content, timestamp: ts,
      type: 'message', read: true, isMe: true,
      reactions: {}, isPinned: false, readBy: [actualSender], mentions: options.mentions ?? [],
      replyToId: options.replyToId, replyToContent: options.replyToContent,
      replyToSender: options.replyToSender, attachmentUri: options.attachmentUri,
      reserveId: options.reserveId,
      linkedItemType: options.linkedItemType,
      linkedItemId: options.linkedItemId,
      linkedItemTitle: options.linkedItemTitle,
      dbCreatedAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, msg]);
    if (isSupabaseConfigured) {
      // Bug 7: include organization_id in insert data
      const insertData = { ...fromMessage(msg), organization_id: orgIdRef.current ?? null };
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'messages', op: 'insert', data: insertData });
        return;
      }
      const pendingUpsert = channelId.startsWith('dm-') && getDmUpsertPromise
        ? getDmUpsertPromise(channelId)
        : undefined;
      const doInsert = () => {
        supabase.from('messages').insert(insertData).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] addMessage error:', error.code, error.message, error.details);
          }
        });
      };
      if (pendingUpsert) {
        pendingUpsert.then(doInsert).catch(doInsert);
      } else {
        doInsert();
      }
    }
  }, [enqueueOperation]);

  const deleteMessage = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
    if (isSupabaseConfigured) {
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'messages', op: 'delete', filter: { column: 'id', value: id } });
        return;
      }
      supabase.from('messages').delete().eq('id', id).catch(() => {});
    }
  }, [enqueueOperation]);

  const updateMessage = useCallback((msg: Message) => {
    setMessages(prev => prev.map(m => m.id === msg.id ? msg : m));
    if (isSupabaseConfigured) {
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'messages', op: 'update', filter: { column: 'id', value: msg.id }, data: fromMessage(msg) });
        return;
      }
      supabase.from('messages').update(fromMessage(msg)).eq('id', msg.id).catch(() => {});
    }
  }, [enqueueOperation]);

  const toggleReaction = useCallback((emoji: string, msg: Message, userName: string) => {
    const current = msg.reactions[emoji] ?? [];
    const updated = current.includes(userName)
      ? current.filter((u: string) => u !== userName)
      : [...current, userName];
    const newReactions = { ...msg.reactions, [emoji]: updated };
    if (updated.length === 0) delete newReactions[emoji];
    const optimistic = { ...msg, reactions: newReactions };
    setMessages(prev => prev.map(m => m.id === msg.id ? optimistic : m));
    if (isSupabaseConfigured) {
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'messages', op: 'update', filter: { column: 'id', value: msg.id }, data: { reactions: newReactions } });
        return;
      }
      supabase.rpc('toggle_message_reaction', {
        p_message_id: msg.id, p_emoji: emoji, p_user_name: userName,
      }).then(({ error }: { error: any }) => {
        if (error) {
          setMessages(prev => prev.map(m => m.id === msg.id ? msg : m));
        }
      });
    }
  }, [enqueueOperation]);

  // Bug 11: markMessagesRead now takes optional channelId to only mark that channel's messages
  const markMessagesRead = useCallback((channelId?: string) => {
    setMessages(prev => prev.map(m => {
      if (channelId && m.channelId !== channelId) return m;
      return { ...m, read: true };
    }));
  }, []);

  const setChannelRead = useCallback((channelId: string, userName: string) => {
    // Bug 8: collect unread IDs from the setMessages callback to avoid stale messagesRef
    let unreadIds: string[] = [];
    setMessages(prev => {
      const updated = prev.map(m => {
        if (m.channelId !== channelId || m.isMe) return m;
        if (m.readBy.includes(userName)) return m;
        unreadIds.push(m.id);
        return { ...m, readBy: [...m.readBy, userName] };
      });
      return updated;
    });
    if (isSupabaseConfigured && userName && unreadIds.length > 0) {
      if (!isOnlineRef.current) {
        // Offline: enqueue per-message read_by updates so they sync when network returns
        for (const msgId of unreadIds) {
          enqueueOperation({
            table: 'messages',
            op: 'update',
            filter: { column: 'id', value: msgId },
            data: { read_by: [userName] },
          });
        }
        return;
      }
      const BATCH_SIZE = 100;
      for (let i = 0; i < unreadIds.length; i += BATCH_SIZE) {
        const batch = unreadIds.slice(i, i + BATCH_SIZE);
        supabase.rpc('mark_messages_read_by', {
          p_message_ids: batch, p_user_name: userName,
        }).catch(() => {});
      }
    }
  }, [enqueueOperation]);

  const addNotificationMessage = useCallback((msg: Message) => {
    setMessages(prev => {
      if (prev.find(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
    if (isSupabaseConfigured) {
      const insertData = { ...fromMessage(msg), organization_id: orgIdRef.current ?? null };
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'messages', op: 'insert', data: insertData });
        return;
      }
      supabase.from('messages').insert(insertData).catch(() => {});
    }
  }, [enqueueOperation]);

  const fetchOlderMessages = useCallback(async (channelId: string, beforeCreatedAt: string): Promise<boolean> => {
    if (!isSupabaseConfigured) return false;
    try {
      const { data, error } = await supabase
        .from('messages').select('*')
        .eq('channel_id', channelId)
        .lt('created_at', beforeCreatedAt)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error || !data?.length) return false;
      const userName = userNameRef.current;
      const older = (data as any[]).map(r => toMessage(r, userName)).reverse();
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newOnes = older.filter(m => !existingIds.has(m.id));
        if (newOnes.length === 0) return prev;
        return [...newOnes, ...prev];
      });
      return data.length === 50;
    } catch { return false; }
  }, []);

  const fetchChannelMessages = useCallback(async (channelId: string): Promise<void> => {
    if (!isSupabaseConfigured) return;
    if (loadedChannelIdsRef.current.has(channelId)) return;
    loadedChannelIdsRef.current.add(channelId);
    try {
      const { data, error } = await supabase
        .from('messages').select('*')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) { loadedChannelIdsRef.current.delete(channelId); return; }
      const userName = userNameRef.current;
      const msgs = (data ?? []).map((r: any) => toMessage(r, userName)).reverse();
      setMessages(prev => {
        const otherChannel = prev.filter(m => m.channelId !== channelId);
        const newIds = new Set(msgs.map(m => m.id));
        const realtimeExtras = prev.filter(m => m.channelId === channelId && !newIds.has(m.id));
        return [...otherChannel, ...msgs, ...realtimeExtras];
      });
    } catch { loadedChannelIdsRef.current.delete(channelId); }
  }, []);

  const refreshChannelMessages = useCallback(async (channelId: string): Promise<void> => {
    loadedChannelIdsRef.current.delete(channelId);
    await fetchChannelMessages(channelId);
  }, [fetchChannelMessages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    loadedChannelIdsRef.current.clear();
  }, []);

  // Recharger les messages quand l'app revient en premier plan
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        loadRecentMessagesRef.current();
      }
    });
    return () => subscription.remove();
  }, []);

  // Enregistrer le handler de rechargement auprès du NetworkContext
  // pour recharger les messages après la synchronisation de la file offline
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    registerReloadHandler(() => { loadRecentMessagesRef.current(); });
  }, [registerReloadHandler]);

  return {
    messages,
    realtimeConnected,
    addMessage,
    deleteMessage,
    updateMessage,
    toggleReaction,
    markMessagesRead,
    setChannelRead,
    addNotificationMessage,
    fetchOlderMessages,
    fetchChannelMessages,
    refreshChannelMessages,
    clearMessages,
    // Bug 4: expose handler registration so AppContext can receive incoming messages
    registerIncomingMessageHandler: useCallback((handler: ((msg: Message, raw: any) => void) | null) => {
      incomingMessageHandlerRef.current = handler;
    }, []),
    // Bug 12: setLastRead now actually persists the map
    setLastRead: useCallback((map: Record<string, string>) => {
      AsyncStorage.setItem('lastReadByChannel', JSON.stringify(map)).catch(() => {});
    }, []),
  };
}
