import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
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

  useEffect(() => {
    if (!user) return;
    loadAll();
  }, [user?.id]);

  async function loadAll() {
    await Promise.all([
      loadCustomChannels(),
      loadGroupChannels(),
      loadGeneralChannels(),
      loadDMChannels(),
      loadPinnedChannels(),
      loadChannelMembersOverride(),
    ]);
  }

  async function loadGeneralChannels() {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase.from('channels').select('*').in('type', ['general', 'building']);
      if (!error && data) {
        setGeneralChannels(data.map((r: any) => ({
          id: r.id, name: r.name, description: r.description ?? '',
          icon: r.icon, color: r.color, type: r.type as 'general' | 'building',
          members: r.members ?? [], createdBy: r.created_by ?? undefined,
          organizationId: r.organization_id ?? undefined,
        })));
      }
    } catch {}
  }

  async function loadCustomChannels() {
    let cached: Channel[] = [];
    try {
      const stored = await AsyncStorage.getItem(CUSTOM_CHANNELS_KEY);
      if (stored) cached = JSON.parse(stored) ?? [];
    } catch {}

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.from('channels').select('*').eq('type', 'custom');
        if (!error && data !== null) {
          const fromServer: Channel[] = data.map((r: any) => ({
            id: r.id, name: r.name, description: r.description ?? '',
            icon: r.icon, color: r.color, type: 'custom' as const,
            members: r.members ?? [], createdBy: r.created_by ?? undefined,
          }));
          const merged = [...fromServer];
          for (const local of cached) {
            if (!merged.find(c => c.id === local.id)) merged.push(local);
          }
          setCustomChannels(merged);
          AsyncStorage.setItem(CUSTOM_CHANNELS_KEY, JSON.stringify(merged)).catch(() => {});
          return;
        }
      } catch {}
    }
    if (cached.length > 0) setCustomChannels(cached);
  }

  async function loadGroupChannels() {
    let cached: Channel[] = [];
    try {
      const stored = await AsyncStorage.getItem(GROUP_CHANNELS_KEY);
      if (stored) cached = JSON.parse(stored) ?? [];
    } catch {}

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.from('channels').select('*').eq('type', 'group');
        if (!error && data !== null) {
          const fromServer: Channel[] = data.map((r: any) => ({
            id: r.id, name: r.name, description: r.description ?? '',
            icon: r.icon, color: r.color, type: 'group' as const,
            members: r.members ?? [], createdBy: r.created_by ?? undefined,
          }));
          const merged = [...fromServer];
          for (const local of cached) {
            if (!merged.find(c => c.id === local.id)) merged.push(local);
          }
          setGroupChannels(merged);
          AsyncStorage.setItem(GROUP_CHANNELS_KEY, JSON.stringify(merged)).catch(() => {});
          return;
        }
      } catch {}
    }
    if (cached.length > 0) setGroupChannels(cached);
  }

  async function loadDMChannels() {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase.from('channels').select('*').eq('type', 'dm');
      if (!error && data) {
        const myName = userNameRef.current;
        const channels: Channel[] = data.map((r: any) => {
          const participants: string[] = r.members ?? [];
          const otherName = participants.find(p => p !== myName) ?? r.name;
          return {
            id: r.id, name: otherName, description: r.description ?? '',
            icon: r.icon ?? 'person-circle', color: r.color ?? '#EC4899',
            type: 'dm' as const, members: participants,
            dmParticipants: participants, createdBy: r.created_by ?? undefined,
          };
        });
        setPersistedDmChannels(channels);
      }
    } catch {}
  }

  async function loadPinnedChannels() {
    try {
      if (isSupabaseConfigured) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data } = await supabase.from('profiles').select('pinned_channels').eq('id', session.user.id).single();
          if (data?.pinned_channels && Array.isArray(data.pinned_channels)) {
            setPinnedChannelIds(data.pinned_channels);
            AsyncStorage.setItem(PINNED_CHANNELS_KEY, JSON.stringify(data.pinned_channels)).catch(() => {});
            return;
          }
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
    let orgId = orgIdRef.current;
    if (!orgId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data: prof } = await supabase.from('profiles').select('organization_id').eq('id', session.user.id).single();
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
  }, []);

  const saveGroupChannels = useCallback(async (channels: Channel[]) => {
    try { await AsyncStorage.setItem(GROUP_CHANNELS_KEY, JSON.stringify(channels)); } catch {}
    if (!isSupabaseConfigured) return;
    let orgId = orgIdRef.current;
    for (const ch of channels) {
      await supabase.from('channels').upsert({
        id: ch.id, name: ch.name, description: ch.description ?? null,
        icon: ch.icon ?? 'people-circle', color: ch.color ?? '#10B981', type: ch.type,
        members: ch.members ?? [], created_by: ch.createdBy ?? null, organization_id: orgId ?? null,
      }).catch(() => {});
    }
  }, []);

  const savePinnedChannels = useCallback(async (ids: string[]) => {
    try { await AsyncStorage.setItem(PINNED_CHANNELS_KEY, JSON.stringify(ids)); } catch {}
    if (!isSupabaseConfigured) return;
    const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    if (session?.user?.id) {
      supabase.from('profiles').update({ pinned_channels: ids }).eq('id', session.user.id).catch(() => {});
    }
  }, []);

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
      supabase.from('channels').delete().eq('id', id).catch(() => {});
    }
  }, [saveCustomChannels]);

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
      supabase.from('channels').delete().eq('id', id).catch(() => {});
    }
  }, [saveGroupChannels]);

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
      const upsertPromise: Promise<void> = supabase.from('channels').upsert({
        id: chId, name: otherName,
        description: `Message direct avec ${otherName}`,
        icon: 'person-circle', color: '#EC4899', type: 'dm',
        members: [myName, otherName], created_by: myName, organization_id: orgId ?? null,
      }).then(() => { dmUpsertPromisesRef.current.delete(chId); })
        .catch(() => { dmUpsertPromisesRef.current.delete(chId); });
      dmUpsertPromisesRef.current.set(chId, upsertPromise);
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
