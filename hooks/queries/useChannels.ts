import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { Channel } from '@/constants/types';
import { genId } from '@/lib/utils';

const CUSTOM_CHANNELS_KEY = 'customChannels_v1';
const GROUP_CHANNELS_KEY = 'groupChannels_v1';
const PINNED_CHANNELS_KEY = 'pinnedChannels_v1';
const CHANNEL_MEMBERS_OVERRIDE_KEY = 'channelMembersOverride_v1';
const PENDING_DM_KEY = 'buildtrack_pending_dm_channels_v1';
const MAX_PINNED = 5;

export function dmChannelId(nameA: string, nameB: string): string {
  return 'dm-' + [nameA, nameB].sort().join('__');
}

export function useChannels() {
  const { user } = useAuth();
  const { isOnline, enqueueOperation } = useNetwork();
  const [generalChannels, setGeneralChannels] = useState<Channel[]>([]);
  const [customChannels, setCustomChannels] = useState<Channel[]>([]);
  const [groupChannels, setGroupChannels] = useState<Channel[]>([]);
  const [persistedDmChannels, setPersistedDmChannels] = useState<Channel[]>([]);
  const [pinnedChannelIds, setPinnedChannelIds] = useState<string[]>([]);
  const [channelMembersOverride, setChannelMembersOverride] = useState<Record<string, string[]>>({});
  const [pendingDmChannelIds, setPendingDmChannelIds] = useState<Set<string>>(new Set());
  const dmUpsertPromisesRef = useRef<Map<string, Promise<void>>>(new Map());

  const orgIdRef = useRef<string | null>(user?.organizationId ?? null);
  useEffect(() => { orgIdRef.current = user?.organizationId ?? null; }, [user?.organizationId]);

  const userNameRef = useRef<string>(user?.name ?? '');
  useEffect(() => { userNameRef.current = user?.name ?? ''; }, [user?.name]);

  const userIdRef = useRef<string | undefined>(user?.id);
  useEffect(() => { userIdRef.current = user?.id; }, [user?.id]);

  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  useEffect(() => {
    if (!user) return;
    loadAll();
  }, [user?.id]);

  async function loadAll() {
    await Promise.all([
      _loadChannelsFromSupabase(),
      loadPinnedChannels(),
      loadChannelMembersOverride(),
    ]);
  }

  async function _loadChannelsFromSupabase() {
    const [customCached, groupCached] = await Promise.all([
      AsyncStorage.getItem(CUSTOM_CHANNELS_KEY)
        .then(s => s ? JSON.parse(s) as Channel[] : [] as Channel[])
        .catch(() => [] as Channel[]),
      AsyncStorage.getItem(GROUP_CHANNELS_KEY)
        .then(s => s ? JSON.parse(s) as Channel[] : [] as Channel[])
        .catch(() => [] as Channel[]),
    ]);

    if (!isSupabaseConfigured) {
      if (customCached.length > 0) setCustomChannels(customCached);
      if (groupCached.length > 0) setGroupChannels(groupCached);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .in('type', ['general', 'building', 'custom', 'group', 'dm']);

      if (error) {
        console.warn('[useChannels] _loadChannelsFromSupabase error:', error.code, error.message);
        if (customCached.length) setCustomChannels(customCached);
        if (groupCached.length) setGroupChannels(groupCached);
        return;
      }
      if (!data) {
        console.warn('[useChannels] _loadChannelsFromSupabase: no data returned');
        if (customCached.length) setCustomChannels(customCached);
        if (groupCached.length) setGroupChannels(groupCached);
        return;
      }
      console.log('[useChannels] _loadChannelsFromSupabase: loaded', data.length, 'channels');

      const myName = userNameRef.current;
      const general: Channel[] = [];
      const custom: Channel[] = [];
      const group: Channel[] = [];
      const dm: Channel[] = [];

      for (const r of data) {
        if (r.type === 'general' || r.type === 'building') {
          general.push({
            id: r.id, name: r.name, description: r.description ?? '',
            icon: r.icon, color: r.color, type: r.type as 'general' | 'building',
            members: r.members ?? [], createdBy: r.created_by ?? undefined,
            organizationId: r.organization_id ?? undefined,
          });
        } else if (r.type === 'custom') {
          custom.push({
            id: r.id, name: r.name, description: r.description ?? '',
            icon: r.icon, color: r.color, type: 'custom' as const,
            members: r.members ?? [], createdBy: r.created_by ?? undefined,
          });
        } else if (r.type === 'group') {
          group.push({
            id: r.id, name: r.name, description: r.description ?? '',
            icon: r.icon, color: r.color, type: 'group' as const,
            members: r.members ?? [], createdBy: r.created_by ?? undefined,
          });
        } else if (r.type === 'dm') {
          const participants: string[] = r.members ?? [];
          const otherName = participants.find(p => p !== myName) ?? r.name;
          dm.push({
            id: r.id, name: otherName, description: r.description ?? '',
            icon: r.icon ?? 'person-circle', color: r.color ?? '#EC4899',
            type: 'dm' as const, members: participants,
            dmParticipants: participants, createdBy: r.created_by ?? undefined,
          });
        }
      }

      const mergedCustom = [...custom];
      for (const local of customCached) {
        if (!mergedCustom.find(c => c.id === local.id)) mergedCustom.push(local);
      }
      const mergedGroup = [...group];
      for (const local of groupCached) {
        if (!mergedGroup.find(c => c.id === local.id)) mergedGroup.push(local);
      }

      setGeneralChannels(general);
      setCustomChannels(mergedCustom);
      setGroupChannels(mergedGroup);
      setPersistedDmChannels(dm);

      AsyncStorage.setItem(CUSTOM_CHANNELS_KEY, JSON.stringify(mergedCustom)).catch(() => {});
      AsyncStorage.setItem(GROUP_CHANNELS_KEY, JSON.stringify(mergedGroup)).catch(() => {});
    } catch {
      if (customCached.length) setCustomChannels(customCached);
      if (groupCached.length) setGroupChannels(groupCached);
    }
  }

  async function loadPinnedChannels() {
    try {
      const userId = userIdRef.current;
      if (userId && isSupabaseConfigured) {
        const { data } = await supabase
          .from('profiles')
          .select('pinned_channels')
          .eq('id', userId)
          .single();
        if (data?.pinned_channels && Array.isArray(data.pinned_channels)) {
          setPinnedChannelIds(data.pinned_channels);
          AsyncStorage.setItem(PINNED_CHANNELS_KEY, JSON.stringify(data.pinned_channels)).catch(() => {});
          return;
        }
      }
      const stored = await AsyncStorage.getItem(PINNED_CHANNELS_KEY);
      if (stored) setPinnedChannelIds(JSON.parse(stored));
    } catch {}
  }

  async function loadChannelMembersOverride() {
    try {
      const stored = await AsyncStorage.getItem(CHANNEL_MEMBERS_OVERRIDE_KEY);
      if (stored) setChannelMembersOverride(JSON.parse(stored));
    } catch {}
  }

  const saveCustomChannels = useCallback(async (channels: Channel[]) => {
    try { await AsyncStorage.setItem(CUSTOM_CHANNELS_KEY, JSON.stringify(channels)); } catch {}
    if (!isSupabaseConfigured) return;
    if (!isOnlineRef.current) {
      for (const ch of channels) {
        enqueueOperation({ table: 'channels', op: 'upsert' as any, data: {
          id: ch.id, name: ch.name, description: ch.description ?? null,
          icon: ch.icon ?? 'chatbubbles', color: ch.color ?? '#10B981', type: ch.type,
          members: ch.members ?? [], created_by: ch.createdBy ?? null, organization_id: orgIdRef.current ?? null,
        }});
      }
      return;
    }
    let orgId = orgIdRef.current;
    if (!orgId) {
      try {
        const userId = userIdRef.current;
        if (userId) {
          const { data: prof } = await supabase.from('profiles').select('organization_id').eq('id', userId).single();
          orgId = prof?.organization_id ?? null;
          if (orgId) orgIdRef.current = orgId;
        }
      } catch {}
    }
    for (const ch of channels) {
      await supabase.from('channels').upsert({
        id: ch.id, name: ch.name, description: ch.description ?? null,
        icon: ch.icon ?? 'chatbubbles', color: ch.color ?? '#10B981', type: ch.type,
        members: ch.members ?? [], created_by: ch.createdBy ?? null, organization_id: orgId ?? null,
      }).catch(() => {});
    }
  }, [enqueueOperation]);

  const saveGroupChannels = useCallback(async (channels: Channel[]) => {
    try { await AsyncStorage.setItem(GROUP_CHANNELS_KEY, JSON.stringify(channels)); } catch {}
    if (!isSupabaseConfigured) return;
    if (!isOnlineRef.current) {
      for (const ch of channels) {
        enqueueOperation({ table: 'channels', op: 'upsert' as any, data: {
          id: ch.id, name: ch.name, description: ch.description ?? null,
          icon: ch.icon ?? 'people-circle', color: ch.color ?? '#10B981', type: ch.type,
          members: ch.members ?? [], created_by: ch.createdBy ?? null, organization_id: orgIdRef.current ?? null,
        }});
      }
      return;
    }
    const orgId = orgIdRef.current;
    for (const ch of channels) {
      await supabase.from('channels').upsert({
        id: ch.id, name: ch.name, description: ch.description ?? null,
        icon: ch.icon ?? 'people-circle', color: ch.color ?? '#10B981', type: ch.type,
        members: ch.members ?? [], created_by: ch.createdBy ?? null, organization_id: orgId ?? null,
      }).catch(() => {});
    }
  }, [enqueueOperation]);

  const savePinnedChannels = useCallback(async (ids: string[]) => {
    try { await AsyncStorage.setItem(PINNED_CHANNELS_KEY, JSON.stringify(ids)); } catch {}
    if (!isSupabaseConfigured) return;
    const userId = userIdRef.current;
    if (!userId) return;
    if (!isOnlineRef.current) {
      enqueueOperation({ table: 'profiles', op: 'update', filter: { column: 'id', value: userId }, data: { pinned_channels: ids } });
      return;
    }
    supabase.from('profiles').update({ pinned_channels: ids }).eq('id', userId).catch(() => {});
  }, [enqueueOperation]);

  const addCustomChannel = useCallback((name: string, description: string, icon: string, color: string): Channel => {
    const creator = userNameRef.current;
    const newCh: Channel = {
      id: 'custom-' + genId(), name, description, icon, color, type: 'custom',
      createdBy: creator, members: creator ? [creator] : [],
    };
    setCustomChannels(prev => {
      const updated = [...prev, newCh];
      saveCustomChannels(updated);
      return updated;
    });
    return newCh;
  }, [saveCustomChannels]);

  const removeCustomChannel = useCallback((id: string) => {
    setCustomChannels(prev => {
      const updated = prev.filter(c => c.id !== id);
      saveCustomChannels(updated);
      return updated;
    });
    if (isSupabaseConfigured) {
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'channels', op: 'delete', filter: { column: 'id', value: id } });
        return;
      }
      supabase.from('channels').delete().eq('id', id).catch(() => {});
    }
  }, [saveCustomChannels, enqueueOperation]);

  const addGroupChannel = useCallback((name: string, members: string[], color: string): Channel => {
    const creator = userNameRef.current;
    const allMembers = creator && !members.includes(creator) ? [creator, ...members] : members;
    const newCh: Channel = {
      id: 'group-' + genId(), name,
      description: `Groupe : ${allMembers.join(', ')}`,
      icon: 'people-circle', color, type: 'group',
      members: allMembers, createdBy: creator,
    };
    setGroupChannels(prev => {
      const updated = [...prev, newCh];
      saveGroupChannels(updated);
      return updated;
    });
    return newCh;
  }, [saveGroupChannels]);

  const removeGroupChannel = useCallback((id: string) => {
    setGroupChannels(prev => {
      const updated = prev.filter(c => c.id !== id);
      saveGroupChannels(updated);
      return updated;
    });
    if (isSupabaseConfigured) {
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'channels', op: 'delete', filter: { column: 'id', value: id } });
        return;
      }
      supabase.from('channels').delete().eq('id', id).catch(() => {});
    }
  }, [saveGroupChannels, enqueueOperation]);

  const _updateAndPersistChannel = useCallback((updatedCh: Channel) => {
    if (updatedCh.type === 'custom') {
      setCustomChannels(prev => {
        const updated = prev.map(c => c.id === updatedCh.id ? updatedCh : c);
        saveCustomChannels(updated);
        return updated;
      });
    } else if (updatedCh.type === 'group') {
      setGroupChannels(prev => {
        const updated = prev.map(c => c.id === updatedCh.id ? updatedCh : c);
        saveGroupChannels(updated);
        return updated;
      });
    }
  }, [saveCustomChannels, saveGroupChannels]);

  const updateCustomChannel = useCallback((id: string, updates: Partial<Pick<Channel, 'name' | 'description' | 'icon' | 'color'>>) => {
    const ch = [...customChannels, ...groupChannels].find(c => c.id === id);
    if (ch) _updateAndPersistChannel({ ...ch, ...updates });
  }, [customChannels, groupChannels, _updateAndPersistChannel]);

  const renameChannel = useCallback((id: string, newName: string) => {
    const ch = [...customChannels, ...groupChannels].find(c => c.id === id);
    if (ch) { _updateAndPersistChannel({ ...ch, name: newName }); return; }
  }, [customChannels, groupChannels, _updateAndPersistChannel]);

  const addChannelMember = useCallback((id: string, memberName: string) => {
    const ch = [...customChannels, ...groupChannels].find(c => c.id === id);
    if (ch) {
      const members = [...(ch.members ?? [])];
      if (members.includes(memberName)) return;
      members.push(memberName);
      _updateAndPersistChannel({
        ...ch, members,
        description: ch.type === 'group' ? `Groupe : ${members.join(', ')}` : ch.description,
      });
    } else {
      setChannelMembersOverride(prev => {
        const current = prev[id] ?? [];
        if (current.includes(memberName)) return prev;
        const updated = { ...prev, [id]: [...current, memberName] };
        AsyncStorage.setItem(CHANNEL_MEMBERS_OVERRIDE_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    }
  }, [customChannels, groupChannels, _updateAndPersistChannel]);

  const removeChannelMember = useCallback((id: string, memberName: string) => {
    const ch = [...customChannels, ...groupChannels].find(c => c.id === id);
    if (ch) {
      const members = (ch.members ?? []).filter(m => m !== memberName);
      _updateAndPersistChannel({
        ...ch, members,
        description: ch.type === 'group' ? `Groupe : ${members.join(', ')}` : ch.description,
      });
    } else {
      setChannelMembersOverride(prev => {
        const updated = { ...prev, [id]: (prev[id] ?? []).filter(m => m !== memberName) };
        AsyncStorage.setItem(CHANNEL_MEMBERS_OVERRIDE_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    }
  }, [customChannels, groupChannels, _updateAndPersistChannel]);

  const pinChannel = useCallback((id: string): { success: boolean; reason?: string } => {
    if (pinnedChannelIds.includes(id)) return { success: false, reason: 'already_pinned' };
    if (pinnedChannelIds.length >= MAX_PINNED) return { success: false, reason: 'limit_reached' };
    const updated = [...pinnedChannelIds, id];
    setPinnedChannelIds(updated);
    savePinnedChannels(updated);
    return { success: true };
  }, [pinnedChannelIds, savePinnedChannels]);

  const unpinChannel = useCallback((id: string) => {
    const updated = pinnedChannelIds.filter(pid => pid !== id);
    setPinnedChannelIds(updated);
    savePinnedChannels(updated);
  }, [pinnedChannelIds, savePinnedChannels]);

  const addGeneralChannel = useCallback((ch: Channel) => {
    setGeneralChannels(prev => {
      if (prev.some(c => c.id === ch.id)) return prev;
      return [...prev, ch];
    });
  }, []);

  const removeGeneralChannel = useCallback((id: string) => {
    setGeneralChannels(prev => prev.filter(c => c.id !== id));
  }, []);

  const getOrCreateDMChannel = useCallback((otherName: string): Channel => {
    const myName = userNameRef.current;
    const chId = dmChannelId(myName, otherName);
    const existing = persistedDmChannels.find(c => c.id === chId);
    if (existing) return existing;

    const newChannel: Channel = {
      id: chId, name: otherName,
      description: `Message direct avec ${otherName}`,
      icon: 'person-circle', color: '#EC4899', type: 'dm',
      dmParticipants: [myName, otherName],
    };

    if (isSupabaseConfigured) {
      const orgId = orgIdRef.current;
      const channelData = {
        id: chId, name: otherName,
        description: `Message direct avec ${otherName}`,
        icon: 'person-circle', color: '#EC4899', type: 'dm',
        members: [myName, otherName], created_by: myName, organization_id: orgId ?? null,
      };
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'channels', op: 'upsert' as any, data: channelData });
      } else {
        const upsertPromise: Promise<void> = supabase.from('channels').upsert(channelData)
          .then(() => { dmUpsertPromisesRef.current.delete(chId); })
          .catch(() => { dmUpsertPromisesRef.current.delete(chId); });
        dmUpsertPromisesRef.current.set(chId, upsertPromise);
      }
    }

    const newPending = new Set(pendingDmChannelIds).add(chId);
    setPendingDmChannelIds(newPending);
    AsyncStorage.setItem(PENDING_DM_KEY, JSON.stringify([...newPending])).catch(() => {});

    return newChannel;
  }, [persistedDmChannels, pendingDmChannelIds]);

  const getDmUpsertPromise = useCallback((channelId: string) => {
    return dmUpsertPromisesRef.current.get(channelId);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const channelSub = supabase
      .channel('channels-realtime-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channels' }, (payload: any) => {
        const r = payload.new;
        const ch: Channel = {
          id: r.id, name: r.name, description: r.description ?? '',
          icon: r.icon, color: r.color, type: r.type,
          members: r.members ?? [], createdBy: r.created_by ?? undefined,
        };
        if (r.type === 'custom') {
          setCustomChannels(prev => prev.some(c => c.id === ch.id) ? prev : [...prev, ch]);
        } else if (r.type === 'group') {
          setGroupChannels(prev => prev.some(c => c.id === ch.id) ? prev : [...prev, ch]);
        } else if (r.type === 'dm') {
          const myName = userNameRef.current;
          const participants: string[] = r.members ?? [];
          if (!myName || participants.includes(myName)) {
            const otherName = participants.find(p => p !== myName) ?? r.name;
            setPersistedDmChannels(prev =>
              prev.some(c => c.id === ch.id) ? prev
                : [...prev, { ...ch, name: otherName, dmParticipants: participants }]
            );
          }
        } else if (r.type === 'general' || r.type === 'building') {
          setGeneralChannels(prev => prev.some(c => c.id === ch.id) ? prev : [...prev, ch]);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'channels' }, (payload: any) => {
        const r = payload.new;
        const participants: string[] = r.members ?? [];
        const myName = userNameRef.current;
        const displayName = r.type === 'dm'
          ? (participants.find((p: string) => p !== myName) ?? r.name) : r.name;
        const ch: Channel = {
          id: r.id, name: displayName, description: r.description ?? '',
          icon: r.icon, color: r.color, type: r.type,
          members: participants, createdBy: r.created_by ?? undefined,
          ...(r.type === 'dm' ? { dmParticipants: participants } : {}),
        };
        if (r.type === 'custom') setCustomChannels(prev => prev.map(c => c.id === ch.id ? ch : c));
        else if (r.type === 'group') setGroupChannels(prev => prev.map(c => c.id === ch.id ? ch : c));
        else if (r.type === 'dm') setPersistedDmChannels(prev => prev.map(c => c.id === ch.id ? ch : c));
        else setGeneralChannels(prev => prev.map(c => c.id === ch.id ? ch : c));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'channels' }, (payload: any) => {
        const r = payload.old;
        if (r.type === 'custom') setCustomChannels(prev => prev.filter(c => c.id !== r.id));
        else if (r.type === 'group') setGroupChannels(prev => prev.filter(c => c.id !== r.id));
        else if (r.type === 'dm') setPersistedDmChannels(prev => prev.filter(c => c.id !== r.id));
        else if (r.type === 'building' || r.type === 'general') setGeneralChannels(prev => prev.filter(c => c.id !== r.id));
      })
      .subscribe();

    return () => { supabase.removeChannel(channelSub); };
  }, []);

  return {
    generalChannels,
    customChannels,
    groupChannels,
    persistedDmChannels,
    pinnedChannelIds,
    channelMembersOverride,
    pendingDmChannelIds,
    addCustomChannel,
    removeCustomChannel,
    addGroupChannel,
    removeGroupChannel,
    updateCustomChannel,
    renameChannel,
    addChannelMember,
    removeChannelMember,
    pinChannel,
    unpinChannel,
    getOrCreateDMChannel,
    getDmUpsertPromise,
    addGeneralChannel,
    removeGeneralChannel,
    maxPinnedChannels: MAX_PINNED,
    reloadChannels: loadAll,
  };
}
