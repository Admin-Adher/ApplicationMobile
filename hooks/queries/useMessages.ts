import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Message } from '@/constants/types';
import { genId, nowTimestampFR } from '@/lib/utils';
import { toMessage, fromMessage } from '@/lib/mappers';

const MOCK_MESSAGES_KEY = 'buildtrack_mock_messages_v2';

export function useMessages() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const userNameRef = useRef<string>(user?.name ?? '');
  useEffect(() => { userNameRef.current = user?.name ?? ''; }, [user?.name]);

  const loadedChannelIdsRef = useRef<Set<string>>(new Set());
  const dmUpsertPromisesRef = useRef<Map<string, Promise<void>>>(new Map());

  useEffect(() => {
    if (!user) return;
    if (!isSupabaseConfigured) {
      AsyncStorage.getItem(MOCK_MESSAGES_KEY).then(raw => {
        if (raw) {
          try { setMessages(JSON.parse(raw)); } catch {}
        }
      }).catch(() => {});
      return;
    }
    loadedChannelIdsRef.current.clear();
    loadRecentMessages();
  }, [user?.id]);

  async function loadRecentMessages() {
    if (!isSupabaseConfigured) return;
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
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
      }
    } catch {}
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const timer = setTimeout(() => {
        AsyncStorage.setItem(MOCK_MESSAGES_KEY, JSON.stringify(messages)).catch(() => {});
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [messages]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const globalSub = supabase
      .channel('messages-realtime-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload: any) => {
        const userName = userNameRef.current;
        const msg = toMessage(payload.new, userName);
        setMessages(prev => {
          if (prev.find(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
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
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => { supabase.removeChannel(globalSub); };
  }, []);

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
      reactions: {}, isPinned: false, readBy: [], mentions: options.mentions ?? [],
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
      const pendingUpsert = channelId.startsWith('dm-') && getDmUpsertPromise
        ? getDmUpsertPromise(channelId)
        : undefined;
      const doInsert = () => {
        supabase.from('messages').insert(fromMessage(msg)).then(({ error }: { error: any }) => {
          if (error) console.warn('[sync] addMessage error:', error.message);
        });
      };
      if (pendingUpsert) {
        pendingUpsert.then(doInsert).catch(doInsert);
      } else {
        doInsert();
      }
    }
  }, []);

  const deleteMessage = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
    if (isSupabaseConfigured) {
      supabase.from('messages').delete().eq('id', id).catch(() => {});
    }
  }, []);

  const updateMessage = useCallback((msg: Message) => {
    setMessages(prev => prev.map(m => m.id === msg.id ? msg : m));
    if (isSupabaseConfigured) {
      supabase.from('messages').update(fromMessage(msg)).eq('id', msg.id).catch(() => {});
    }
  }, []);

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
      supabase.rpc('toggle_message_reaction', {
        p_message_id: msg.id, p_emoji: emoji, p_user_name: userName,
      }).then(({ error }: { error: any }) => {
        if (error) {
          setMessages(prev => prev.map(m => m.id === msg.id ? msg : m));
        }
      });
    }
  }, []);

  const markMessagesRead = useCallback(() => {
    setMessages(prev => prev.map(m => ({ ...m, read: true })));
  }, []);

  const setChannelRead = useCallback((channelId: string, userName: string) => {
    setMessages(prev => prev.map(m => {
      if (m.channelId !== channelId || m.isMe) return m;
      if (m.readBy.includes(userName)) return m;
      return { ...m, readBy: [...m.readBy, userName] };
    }));
    if (isSupabaseConfigured && userName) {
      const unreadIds = messages
        .filter(m => m.channelId === channelId && !m.isMe && !m.readBy.includes(userName))
        .map(m => m.id);
      const BATCH_SIZE = 100;
      for (let i = 0; i < unreadIds.length; i += BATCH_SIZE) {
        const batch = unreadIds.slice(i, i + BATCH_SIZE);
        supabase.rpc('mark_messages_read_by', {
          p_message_ids: batch, p_user_name: userName,
        }).catch(() => {});
      }
    }
  }, [messages]);

  const addNotificationMessage = useCallback((msg: Message) => {
    setMessages(prev => {
      if (prev.find(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
    if (isSupabaseConfigured) {
      supabase.from('messages').insert(fromMessage(msg)).catch(() => {});
    }
  }, []);

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
    setLastRead: (map: Record<string, string>) => {},
  };
}
