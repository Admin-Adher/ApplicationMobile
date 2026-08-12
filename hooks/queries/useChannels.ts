import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { Channel, ChannelMemberIdentity } from '@/constants/types';
import { genId } from '@/lib/utils';
import { isSupabaseSessionValid } from '@/lib/offlineCache';

const CUSTOM_CHANNELS_PREFIX = 'customChannels_v2_';
const GROUP_CHANNELS_PREFIX = 'groupChannels_v2_';
const GENERAL_CHANNELS_PREFIX = 'generalChannels_v2_';
const DM_CHANNELS_PREFIX = 'dmChannels_v2_';
const PINNED_CHANNELS_PREFIX = 'pinnedChannels_v2_';
const CHANNEL_MEMBERS_OVERRIDE_PREFIX = 'channelMembersOverride_v2_';
const PENDING_DM_PREFIX = 'buildtrack_pending_dm_channels_v2_';
const HIDDEN_DM_PREFIX = 'buildtrack_hidden_dm_channels_v1_';
const MAX_PINNED = 5;

export function dmChannelId(nameA: string, nameB: string): string {
  return 'dm-' + [nameA, nameB].sort().join('__');
}

export function dmChannelIdByUserIds(userIdA: string, userIdB: string): string {
  return 'dm-' + [userIdA, userIdB].sort().join('__');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getDmParticipants(
  channelId: string,
  members?: string[],
  dmParticipants?: string[],
): string[] {
  const encodedParticipants = channelId.startsWith('dm-')
    ? channelId.slice(3).split('__')
    : [];
  const fromId = encodedParticipants.length === 2 && encodedParticipants.every(value => UUID_PATTERN.test(value))
    ? []
    : encodedParticipants;
  const all = [...(dmParticipants ?? []), ...(members ?? []), ...fromId]
    .map(name => String(name).trim())
    .filter(Boolean);
  return Array.from(new Set(all));
}

export function getDmDisplayName(
  channel: Pick<Channel, 'id' | 'name'> & Partial<Pick<Channel, 'members' | 'dmParticipants'>>,
  currentUserName: string,
  preferredOtherName?: string,
): string {
  if (preferredOtherName && preferredOtherName !== currentUserName) return preferredOtherName;
  const participants = getDmParticipants(channel.id, channel.members, channel.dmParticipants);
  const otherName = currentUserName
    ? participants.find(name => name !== currentUserName)
    : undefined;
  if (otherName) return otherName;
  if (channel.name && channel.name !== currentUserName) return channel.name;
  return preferredOtherName || channel.name || 'Message direct';
}

export function useChannels() {
  const { user } = useAuth();
  const { isOnline, enqueueOperation } = useNetwork();
  const [generalChannels, setGeneralChannels] = useState<Channel[]>([]);
  const [customChannels, setCustomChannels] = useState<Channel[]>([]);
  const [groupChannels, setGroupChannels] = useState<Channel[]>([]);
  const [persistedDmChannels, setPersistedDmChannels] = useState<Channel[]>([]);
  const [dmChannelIdsWithMessages, setDmChannelIdsWithMessages] = useState<Set<string>>(new Set());
  const [pinnedChannelIds, setPinnedChannelIds] = useState<string[]>([]);
  const [channelMembersOverride, setChannelMembersOverride] = useState<Record<string, string[]>>({});
  const [pendingDmChannelIds, setPendingDmChannelIds] = useState<Set<string>>(new Set());
  const [hiddenDmChannelIds, setHiddenDmChannelIds] = useState<Record<string, string>>({});
  const [reconnectSeq, setReconnectSeq] = useState(0);
  const dmUpsertPromisesRef = useRef<Map<string, Promise<void>>>(new Map());

  const orgIdRef = useRef<string | null>(user?.organizationId ?? null);
  useEffect(() => { orgIdRef.current = user?.organizationId ?? null; }, [user?.organizationId]);

  const userNameRef = useRef<string>(user?.name ?? '');
  useEffect(() => { userNameRef.current = user?.name ?? ''; }, [user?.name]);

  const userIdRef = useRef<string | undefined>(user?.id);
  useEffect(() => { userIdRef.current = user?.id; }, [user?.id]);

  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  // Namespace cache keys by user ID to prevent cross-account contamination
  const uid = user?.id ?? 'anon';
  const CUSTOM_CHANNELS_KEY = CUSTOM_CHANNELS_PREFIX + uid;
  const GROUP_CHANNELS_KEY = GROUP_CHANNELS_PREFIX + uid;
  const GENERAL_CHANNELS_KEY = GENERAL_CHANNELS_PREFIX + uid;
  const DM_CHANNELS_KEY = DM_CHANNELS_PREFIX + uid;
  const PINNED_CHANNELS_KEY = PINNED_CHANNELS_PREFIX + uid;
  const CHANNEL_MEMBERS_OVERRIDE_KEY = CHANNEL_MEMBERS_OVERRIDE_PREFIX + uid;
  const PENDING_DM_KEY = PENDING_DM_PREFIX + uid;
  const HIDDEN_DM_KEY = HIDDEN_DM_PREFIX + uid;

  useEffect(() => {
    if (!user) return;
    // Clear channel state from previous account before loading
    setGeneralChannels([]);
    setCustomChannels([]);
    setGroupChannels([]);
    setPersistedDmChannels([]);
    setDmChannelIdsWithMessages(new Set());
    setPinnedChannelIds([]);
    setChannelMembersOverride({});
    setPendingDmChannelIds(new Set());
    setHiddenDmChannelIds({});
    if (user.role === 'magasinier') return;
    loadAll();
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!user) return;
    AsyncStorage.setItem(GENERAL_CHANNELS_KEY, JSON.stringify(generalChannels)).catch(() => {});
  }, [generalChannels, GENERAL_CHANNELS_KEY]);

  useEffect(() => {
    if (!user) return;
    AsyncStorage.setItem(DM_CHANNELS_KEY, JSON.stringify(persistedDmChannels)).catch(() => {});
  }, [persistedDmChannels, DM_CHANNELS_KEY]);

  function normalizeMembers(value: any): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) return [];
      if (s.startsWith('[')) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) return parsed.filter(Boolean);
        } catch {}
      }
      return s.split(',').map(x => x.trim()).filter(Boolean);
    }
    return [];
  }

  async function loadAll() {
    if (user?.role === 'magasinier') return;
    await Promise.all([
      _loadChannelsFromSupabase(),
      loadPinnedChannels(),
      loadChannelMembersOverride(),
    ]);
  }

  useEffect(() => {
    if (!isSupabaseConfigured || Platform.OS === 'web' || !user || user.role === 'magasinier') return;
    let backgroundAt = 0;
    let lastReconnectAt = 0;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        const sleptMs = backgroundAt > 0 ? Date.now() - backgroundAt : 0;
        if (sleptMs > 5000 && Date.now() - lastReconnectAt > 2000) {
          lastReconnectAt = Date.now();
          setReconnectSeq(seq => seq + 1);
          void loadAll();
        }
      } else if (state === 'background' || state === 'inactive') {
        backgroundAt = Date.now();
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  async function _loadChannelsFromSupabase() {
    if (user?.role === 'magasinier') return;
    const [customCached, groupCached, generalCached, dmCached, pendingDmCached, hiddenDmCached] = await Promise.all([
      AsyncStorage.getItem(CUSTOM_CHANNELS_KEY)
        .then(s => s ? JSON.parse(s) as Channel[] : [] as Channel[])
        .catch(() => [] as Channel[]),
      AsyncStorage.getItem(GROUP_CHANNELS_KEY)
        .then(s => s ? JSON.parse(s) as Channel[] : [] as Channel[])
        .catch(() => [] as Channel[]),
      AsyncStorage.getItem(GENERAL_CHANNELS_KEY)
        .then(s => s ? JSON.parse(s) as Channel[] : [] as Channel[])
        .catch(() => [] as Channel[]),
      AsyncStorage.getItem(DM_CHANNELS_KEY)
        .then(s => s ? JSON.parse(s) as Channel[] : [] as Channel[])
        .catch(() => [] as Channel[]),
      AsyncStorage.getItem(PENDING_DM_KEY)
        .then(s => s ? (JSON.parse(s) as string[]) : [] as string[])
        .catch(() => [] as string[]),
      AsyncStorage.getItem(HIDDEN_DM_KEY)
        .then(s => s ? JSON.parse(s) as Record<string, string> : {} as Record<string, string>)
        .catch(() => ({} as Record<string, string>)),
    ]);

    if (pendingDmCached.length) {
      setPendingDmChannelIds(new Set(pendingDmCached));
    }
    if (Object.keys(hiddenDmCached).length) {
      setHiddenDmChannelIds(hiddenDmCached);
    }

    // ── Show cached data IMMEDIATELY so the UI is responsive while we wait
    // for the Supabase response. This is the same pattern as useReserves:
    // cache-first display, then background refresh with fresh server data.
    if (generalCached.length > 0) setGeneralChannels(generalCached);
    if (customCached.length > 0) setCustomChannels(customCached);
    if (groupCached.length > 0) setGroupChannels(groupCached);
    if (dmCached.length > 0) setPersistedDmChannels(dmCached);

    if (!isSupabaseConfigured) return;

    // Don't query Supabase without a usable JWT — RLS would return [] and the
    // empty array would overwrite all the cached channels (typical symptom
    // after a cold start following an APK auto-update).
    if (!(await isSupabaseSessionValid())) return;

    try {
      let chQ = (supabase as any)
        .from('channels')
        .select('*')
        .in('type', ['general', 'building', 'custom', 'group', 'dm']);
      if (user?.role !== 'super_admin' && user?.organizationId) {
        chQ = chQ.eq('organization_id', user.organizationId);
      }
      const { data, error } = await chQ;

      if (error) {
        console.warn('[useChannels] _loadChannelsFromSupabase error:', error.code, error.message);
        return; // cached data already showing
      }
      if (!data) {
        console.warn('[useChannels] _loadChannelsFromSupabase: no data returned');
        return; // cached data already showing
      }
      console.log('[useChannels] _loadChannelsFromSupabase: loaded', data.length, 'channels');

      const privateChannelIds = data
        .filter((row: any) => row.type === 'group' || row.type === 'dm')
        .map((row: any) => String(row.id));
      const memberUserIdsByChannel = new Map<string, string[]>();
      if (privateChannelIds.length > 0) {
        const { data: memberRows, error: memberError } = await (supabase as any)
          .from('channel_members')
          .select('channel_id,user_id,status')
          .in('channel_id', privateChannelIds)
          .eq('status', 'active')
          .order('user_id', { ascending: true });
        if (memberError) {
          console.warn('[useChannels] channel_members load error:', memberError.code, memberError.message);
        } else {
          for (const row of memberRows ?? []) {
            const channelId = String(row.channel_id);
            const current = memberUserIdsByChannel.get(channelId) ?? [];
            const memberId = String(row.user_id);
            if (!current.includes(memberId)) current.push(memberId);
            memberUserIdsByChannel.set(channelId, current);
          }
        }
      }

      const myName = userNameRef.current;
      const general: Channel[] = [];
      const custom: Channel[] = [];
      const group: Channel[] = [];
      const dm: Channel[] = [];

      for (const r of data) {
        const members = normalizeMembers(r.members);
        if (r.type === 'general' || r.type === 'building') {
          general.push({
            id: r.id, name: r.name, description: r.description ?? '',
            icon: r.icon, color: r.color, type: r.type as 'general' | 'building',
            members, createdBy: r.created_by ?? undefined,
            createdByUserId: r.created_by_user_id ?? undefined,
            organizationId: r.organization_id ?? undefined,
          });
        } else if (r.type === 'custom') {
          custom.push({
            id: r.id, name: r.name, description: r.description ?? '',
            icon: r.icon, color: r.color, type: 'custom' as const,
            members, createdBy: r.created_by ?? undefined,
            createdByUserId: r.created_by_user_id ?? undefined,
            organizationId: r.organization_id ?? undefined,
          });
        } else if (r.type === 'group') {
          group.push({
            id: r.id, name: r.name, description: r.description ?? '',
            icon: r.icon, color: r.color, type: 'group' as const,
            members, memberUserIds: memberUserIdsByChannel.get(String(r.id)) ?? [],
            createdBy: r.created_by ?? undefined,
            createdByUserId: r.created_by_user_id ?? undefined,
            organizationId: r.organization_id ?? undefined,
          });
        } else if (r.type === 'dm') {
          const participants = members;
          const otherName = getDmDisplayName(
            { id: r.id, name: r.name, members: participants, dmParticipants: participants },
            myName,
          );
          dm.push({
            id: r.id, name: otherName, description: r.description ?? '',
            icon: r.icon ?? 'person-circle', color: r.color ?? '#EC4899',
            type: 'dm' as const, members: participants,
            memberUserIds: memberUserIdsByChannel.get(String(r.id)) ?? [],
            dmParticipants: participants, createdBy: r.created_by ?? undefined,
            createdByUserId: r.created_by_user_id ?? undefined,
            organizationId: r.organization_id ?? undefined,
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
      setPersistedDmChannels(prev => {
        const mergedDm = [...dm];
        for (const local of [...dmCached, ...prev]) {
          if (!mergedDm.find(c => c.id === local.id)) mergedDm.push(local);
        }
        return mergedDm;
      });
      void refreshDmMessagePresence(dm.map(c => c.id));

      AsyncStorage.setItem(GENERAL_CHANNELS_KEY, JSON.stringify(general)).catch(() => {});
      AsyncStorage.setItem(CUSTOM_CHANNELS_KEY, JSON.stringify(mergedCustom)).catch(() => {});
      AsyncStorage.setItem(GROUP_CHANNELS_KEY, JSON.stringify(mergedGroup)).catch(() => {});
    } catch {
      if (generalCached.length) setGeneralChannels(generalCached);
      if (customCached.length) setCustomChannels(customCached);
      if (groupCached.length) setGroupChannels(groupCached);
      if (dmCached.length) setPersistedDmChannels(dmCached);
    }
  }

  async function refreshDmMessagePresence(dmIds: string[]) {
    if (!isSupabaseConfigured || dmIds.length === 0) return;
    try {
      let query = (supabase as any)
        .from('messages')
        .select('channel_id')
        .in('channel_id', dmIds)
        .limit(10000);
      const orgId = orgIdRef.current;
      if (orgId) query = query.eq('organization_id', orgId);
      const { data, error } = await query;
      if (error || !data) return;
      const idsWithMessages = new Set<string>(
        (data as Array<{ channel_id?: string }>)
          .map(row => row.channel_id)
          .filter(Boolean) as string[]
      );
      setDmChannelIdsWithMessages(idsWithMessages);
    } catch {}
  }

  async function loadPinnedChannels() {
    try {
      // Show cached pinned channels immediately, then refresh from Supabase.
      const stored = await AsyncStorage.getItem(PINNED_CHANNELS_KEY);
      if (stored) setPinnedChannelIds(JSON.parse(stored));

      const userId = userIdRef.current;
      if (!userId || !isSupabaseConfigured) return;
      if (!(await isSupabaseSessionValid())) return;

      const { data } = await (supabase as any)
        .from('profiles')
        .select('pinned_channels')
        .eq('id', userId)
        .single();
      if (data?.pinned_channels && Array.isArray(data.pinned_channels)) {
        setPinnedChannelIds(data.pinned_channels);
        AsyncStorage.setItem(PINNED_CHANNELS_KEY, JSON.stringify(data.pinned_channels)).catch(() => {});
      }
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
        enqueueOperation({ table: 'channels', op: 'upsert', data: {
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
          const { data: prof } = await (supabase as any).from('profiles').select('organization_id').eq('id', userId).single();
          orgId = prof?.organization_id ?? null;
          if (orgId) orgIdRef.current = orgId;
        }
      } catch {}
    }
    for (const ch of channels) {
      const data = {
        id: ch.id, name: ch.name, description: ch.description ?? null,
        icon: ch.icon ?? 'chatbubbles', color: ch.color ?? '#10B981', type: ch.type,
        members: ch.members ?? [], created_by: ch.createdBy ?? null, organization_id: orgId ?? null,
      };
      try {
        const { error } = await (supabase as any).from('channels').upsert(data);
        if (error) enqueueOperation({ table: 'channels', op: 'upsert', data });
      } catch {
        enqueueOperation({ table: 'channels', op: 'upsert', data });
      }
    }
  }, [enqueueOperation, CUSTOM_CHANNELS_KEY]);

  const privateChannelRpc = useCallback((ch: Channel) => {
    const memberUserIds = Array.from(new Set(ch.memberUserIds ?? [])).filter(Boolean).sort();
    const args = {
      p_channel_id: ch.id,
      p_type: ch.type,
      p_name: ch.name,
      p_description: ch.description ?? '',
      p_icon: ch.icon ?? (ch.type === 'dm' ? 'person-circle' : 'people-circle'),
      p_color: ch.color ?? (ch.type === 'dm' ? '#EC4899' : '#7C3AED'),
      p_member_user_ids: memberUserIds,
      p_organization_id: ch.organizationId ?? orgIdRef.current ?? null,
    };
    return {
      args,
      operation: {
        table: 'channels',
        op: 'rpc' as const,
        data: {
          id: ch.id,
          type: ch.type,
          name: ch.name,
          members: ch.members ?? [],
          member_user_ids: memberUserIds,
        },
        rpc: { fn: 'upsert_private_channel', args },
      },
    };
  }, []);

  const persistPrivateChannel = useCallback(async (ch: Channel): Promise<void> => {
    const { operation } = privateChannelRpc(ch);
    if (!isOnlineRef.current) {
      enqueueOperation(operation);
      return;
    }
    try {
      const { error } = await (supabase as any).rpc(operation.rpc.fn, operation.rpc.args);
      if (error) enqueueOperation(operation);
    } catch {
      enqueueOperation(operation);
    }
  }, [enqueueOperation, privateChannelRpc]);

  const saveGroupChannels = useCallback(async (channels: Channel[]) => {
    try { await AsyncStorage.setItem(GROUP_CHANNELS_KEY, JSON.stringify(channels)); } catch {}
    if (!isSupabaseConfigured) return;
    const orgId = orgIdRef.current;
    for (const ch of channels) {
      if (ch.type === 'group' && (ch.memberUserIds?.length ?? 0) >= 2) {
        await persistPrivateChannel({ ...ch, organizationId: ch.organizationId ?? orgId ?? undefined });
        continue;
      }

      // Transitional fallback for a cached group created by an older APK.
      // The database compatibility trigger accepts it only if every display
      // name resolves uniquely; UUID-capable channels never use this path.
      const data = {
        id: ch.id, name: ch.name, description: ch.description ?? null,
        icon: ch.icon ?? 'people-circle', color: ch.color ?? '#10B981', type: ch.type,
        members: ch.members ?? [], created_by: ch.createdBy ?? null, organization_id: orgId ?? null,
      };
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'channels', op: 'upsert', data });
        continue;
      }
      try {
        const { error } = await (supabase as any).from('channels').upsert(data);
        if (error) enqueueOperation({ table: 'channels', op: 'upsert', data });
      } catch {
        enqueueOperation({ table: 'channels', op: 'upsert', data });
      }
    }
  }, [enqueueOperation, GROUP_CHANNELS_KEY, persistPrivateChannel]);

  const savePinnedChannels = useCallback(async (ids: string[]) => {
    try { await AsyncStorage.setItem(PINNED_CHANNELS_KEY, JSON.stringify(ids)); } catch {}
    if (!isSupabaseConfigured) return;
    const userId = userIdRef.current;
    if (!userId) return;
    if (!isOnlineRef.current) {
      enqueueOperation({ table: 'profiles', op: 'update', filter: { column: 'id', value: userId }, data: { pinned_channels: ids } });
      return;
    }
    void (async () => {
      try {
        const { error } = await (supabase as any).from('profiles').update({ pinned_channels: ids }).eq('id', userId);
        if (error) enqueueOperation({ table: 'profiles', op: 'update', filter: { column: 'id', value: userId }, data: { pinned_channels: ids } });
      } catch {
        enqueueOperation({ table: 'profiles', op: 'update', filter: { column: 'id', value: userId }, data: { pinned_channels: ids } });
      }
    })();
  }, [enqueueOperation, PINNED_CHANNELS_KEY]);

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
      void (async () => {
        try {
          const { error } = await (supabase as any).from('channels').delete().eq('id', id);
          if (error) enqueueOperation({ table: 'channels', op: 'delete', filter: { column: 'id', value: id } });
        } catch {
          enqueueOperation({ table: 'channels', op: 'delete', filter: { column: 'id', value: id } });
        }
      })();
    }
  }, [saveCustomChannels, enqueueOperation]);

  const addGroupChannel = useCallback((name: string, members: ChannelMemberIdentity[], color: string): Channel => {
    const creator = userNameRef.current;
    const creatorId = userIdRef.current ?? '';
    const uniqueMembers = members.filter((member, index, all) =>
      !!member.id && all.findIndex(candidate => candidate.id === member.id) === index
    );
    const allMemberIdentities = creatorId && !uniqueMembers.some(member => member.id === creatorId)
      ? [{ id: creatorId, name: creator }, ...uniqueMembers]
      : uniqueMembers;
    const allMembers = allMemberIdentities.map(member => member.name);
    const newCh: Channel = {
      id: 'group-' + genId(), name,
      description: `Groupe : ${allMembers.join(', ')}`,
      icon: 'people-circle', color, type: 'group',
      members: allMembers,
      memberUserIds: allMemberIdentities.map(member => member.id),
      createdBy: creator,
      createdByUserId: creatorId || undefined,
      organizationId: orgIdRef.current ?? undefined,
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
      void (async () => {
        try {
          const { error } = await (supabase as any).from('channels').delete().eq('id', id);
          if (error) enqueueOperation({ table: 'channels', op: 'delete', filter: { column: 'id', value: id } });
        } catch {
          enqueueOperation({ table: 'channels', op: 'delete', filter: { column: 'id', value: id } });
        }
      })();
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

  const addChannelMember = useCallback((id: string, member: ChannelMemberIdentity) => {
    const ch = [...customChannels, ...groupChannels].find(c => c.id === id);
    if (ch) {
      const members = [...(ch.members ?? [])];
      if (ch.type !== 'group') {
        if (members.includes(member.name)) return;
        members.push(member.name);
        _updateAndPersistChannel({ ...ch, members });
        return;
      }
      const memberUserIds = [...(ch.memberUserIds ?? [])];
      if (memberUserIds.includes(member.id)) return;
      members.push(member.name);
      memberUserIds.push(member.id);
      _updateAndPersistChannel({
        ...ch, members, memberUserIds,
        description: ch.type === 'group' ? `Groupe : ${members.join(', ')}` : ch.description,
      });
    } else {
      setChannelMembersOverride(prev => {
        const current = prev[id] ?? [];
        if (current.includes(member.name)) return prev;
        const updated = { ...prev, [id]: [...current, member.name] };
        AsyncStorage.setItem(CHANNEL_MEMBERS_OVERRIDE_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    }
  }, [customChannels, groupChannels, _updateAndPersistChannel, CHANNEL_MEMBERS_OVERRIDE_KEY]);

  const removeChannelMember = useCallback((id: string, member: ChannelMemberIdentity) => {
    const ch = [...customChannels, ...groupChannels].find(c => c.id === id);
    if (ch) {
      if (ch.type !== 'group') {
        const members = (ch.members ?? []).filter(name => name !== member.name);
        _updateAndPersistChannel({ ...ch, members });
        return;
      }
      const memberIndex = (ch.memberUserIds ?? []).findIndex(userId => userId === member.id);
      const memberUserIds = (ch.memberUserIds ?? []).filter(userId => userId !== member.id);
      const members = (ch.members ?? []).filter((name, index) =>
        memberIndex >= 0 ? index !== memberIndex : name !== member.name
      );
      const updatedChannel = {
        ...ch, members, memberUserIds,
        description: ch.type === 'group' ? `Groupe : ${members.join(', ')}` : ch.description,
      };
      const currentUserId = userIdRef.current;
      const isSelfLeave = !!currentUserId
        && member.id === currentUserId
        && (ch.createdByUserId ? ch.createdByUserId !== currentUserId : ch.createdBy !== userNameRef.current);
      if (isSelfLeave) {
        setGroupChannels(prev => {
          const next = prev.filter(channel => channel.id !== id);
          AsyncStorage.setItem(GROUP_CHANNELS_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
        void persistPrivateChannel(updatedChannel);
        return;
      }
      _updateAndPersistChannel(updatedChannel);
    } else {
      setChannelMembersOverride(prev => {
        const updated = { ...prev, [id]: (prev[id] ?? []).filter(name => name !== member.name) };
        AsyncStorage.setItem(CHANNEL_MEMBERS_OVERRIDE_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    }
  }, [customChannels, groupChannels, _updateAndPersistChannel, CHANNEL_MEMBERS_OVERRIDE_KEY, GROUP_CHANNELS_KEY, persistPrivateChannel]);

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

  // Bug 10: use refs for persistedDmChannels and pendingDmChannelIds to keep useCallback stable
  const persistedDmChannelsRef = useRef(persistedDmChannels);
  useEffect(() => { persistedDmChannelsRef.current = persistedDmChannels; }, [persistedDmChannels]);
  const pendingDmChannelIdsRef = useRef(pendingDmChannelIds);
  useEffect(() => { pendingDmChannelIdsRef.current = pendingDmChannelIds; }, [pendingDmChannelIds]);
  const hiddenDmChannelIdsRef = useRef(hiddenDmChannelIds);
  useEffect(() => { hiddenDmChannelIdsRef.current = hiddenDmChannelIds; }, [hiddenDmChannelIds]);

  const saveHiddenDmChannels = useCallback((next: Record<string, string>) => {
    setHiddenDmChannelIds(next);
    hiddenDmChannelIdsRef.current = next;
    AsyncStorage.setItem(HIDDEN_DM_KEY, JSON.stringify(next)).catch(() => {});
  }, [HIDDEN_DM_KEY]);

  const hideDmChannel = useCallback((id: string) => {
    saveHiddenDmChannels({ ...hiddenDmChannelIdsRef.current, [id]: new Date().toISOString() });
  }, [saveHiddenDmChannels]);

  const unhideDmChannel = useCallback((id: string) => {
    if (!hiddenDmChannelIdsRef.current[id]) return;
    const next = { ...hiddenDmChannelIdsRef.current };
    delete next[id];
    saveHiddenDmChannels(next);
  }, [saveHiddenDmChannels]);

  const getOrCreateDMChannel = useCallback((other: ChannelMemberIdentity): Channel => {
    const myName = userNameRef.current;
    const myId = userIdRef.current ?? '';
    const expectedMemberIds = [myId, other.id].filter(Boolean).sort();
    const uuidChannelId = myId && other.id
      ? dmChannelIdByUserIds(myId, other.id)
      : dmChannelId(myName, other.name);
    const existing = persistedDmChannelsRef.current.find(channel => {
      const currentIds = [...(channel.memberUserIds ?? [])].filter(Boolean).sort();
      return (
        currentIds.length === expectedMemberIds.length
        && currentIds.every((value, index) => value === expectedMemberIds[index])
      ) || channel.id === uuidChannelId;
    });
    const chId = existing?.id ?? uuidChannelId;
    if (existing) {
      const participants = getDmParticipants(chId, existing.members, existing.dmParticipants);
      const normalizedParticipants = [myName, other.name, ...participants]
        .map(name => String(name).trim())
        .filter(Boolean)
        .filter((name, index, arr) => arr.indexOf(name) === index);
      const displayName = getDmDisplayName(
        { ...existing, members: normalizedParticipants, dmParticipants: normalizedParticipants },
        myName,
        other.name,
      );
      const fixedExisting: Channel = {
        ...existing,
        name: displayName,
        description: `Message direct avec ${displayName}`,
        members: normalizedParticipants,
        memberUserIds: expectedMemberIds,
        dmParticipants: normalizedParticipants,
        organizationId: existing.organizationId ?? orgIdRef.current ?? undefined,
      };
      if (
        existing.name !== fixedExisting.name ||
        JSON.stringify(existing.members ?? []) !== JSON.stringify(fixedExisting.members ?? []) ||
        JSON.stringify([...(existing.memberUserIds ?? [])].sort()) !== JSON.stringify(expectedMemberIds) ||
        JSON.stringify(existing.dmParticipants ?? []) !== JSON.stringify(fixedExisting.dmParticipants ?? [])
      ) {
        setPersistedDmChannels(prev => prev.map(c => c.id === chId ? fixedExisting : c));
        if (isSupabaseConfigured && expectedMemberIds.length === 2) {
          const repairPromise = persistPrivateChannel(fixedExisting)
            .finally(() => dmUpsertPromisesRef.current.delete(chId));
          dmUpsertPromisesRef.current.set(chId, repairPromise);
        }
      }
      return fixedExisting;
    }

    const participants = [myName, other.name].filter(Boolean);
    const displayName = getDmDisplayName({ id: chId, name: other.name, members: participants }, myName, other.name);
    const newChannel: Channel = {
      id: chId, name: displayName,
      description: `Message direct avec ${displayName}`,
      icon: 'person-circle', color: '#EC4899', type: 'dm',
      members: participants,
      memberUserIds: expectedMemberIds,
      dmParticipants: participants,
      createdBy: myName,
      createdByUserId: myId || undefined,
      organizationId: orgIdRef.current ?? undefined,
    };

    if (isSupabaseConfigured && expectedMemberIds.length === 2) {
      const upsertPromise = persistPrivateChannel(newChannel)
        .finally(() => dmUpsertPromisesRef.current.delete(chId));
      dmUpsertPromisesRef.current.set(chId, upsertPromise);
    }

    const newPending = new Set(pendingDmChannelIdsRef.current).add(chId);
    setPendingDmChannelIds(newPending);
    AsyncStorage.setItem(PENDING_DM_KEY, JSON.stringify([...newPending])).catch(() => {});

    // Add immediately to persistedDmChannels so it shows up in allChannels without waiting for realtime
    setPersistedDmChannels(prev => prev.some(c => c.id === chId) ? prev : [...prev, newChannel]);

    return newChannel;
  }, [persistPrivateChannel, PENDING_DM_KEY]);

  const getDmUpsertPromise = useCallback((channelId: string) => {
    return dmUpsertPromisesRef.current.get(channelId);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !user) return;

    const channelSub = supabase
      .channel(`channels-realtime-v2-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channels' }, (payload: any) => {
        const r = payload.new;
        const ch: Channel = {
          id: r.id, name: r.name, description: r.description ?? '',
          icon: r.icon, color: r.color, type: r.type,
          members: r.members ?? [], createdBy: r.created_by ?? undefined,
          createdByUserId: r.created_by_user_id ?? undefined,
          organizationId: r.organization_id ?? undefined,
        };
        if (r.type === 'custom') {
          setCustomChannels(prev => prev.some(c => c.id === ch.id) ? prev : [...prev, ch]);
        } else if (r.type === 'group') {
          setGroupChannels(prev => prev.some(c => c.id === ch.id) ? prev : [...prev, ch]);
        } else if (r.type === 'dm') {
          const myName = userNameRef.current;
          const participants = getDmParticipants(r.id, normalizeMembers(r.members));
          if (!myName || participants.includes(myName)) {
            const otherName = getDmDisplayName(
              { id: r.id, name: r.name, members: participants, dmParticipants: participants },
              myName,
            );
            setPersistedDmChannels(prev =>
              prev.some(c => c.id === ch.id) ? prev
                : [...prev, { ...ch, name: otherName, members: participants, dmParticipants: participants }]
            );
          }
        } else if (r.type === 'general' || r.type === 'building') {
          setGeneralChannels(prev => prev.some(c => c.id === ch.id) ? prev : [...prev, ch]);
        }
        if (r.type === 'group' || r.type === 'dm') void loadAll();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'channels' }, (payload: any) => {
        const r = payload.new;
        const participants = getDmParticipants(r.id, normalizeMembers(r.members));
        const myName = userNameRef.current;
        const displayName = r.type === 'dm'
          ? getDmDisplayName({ id: r.id, name: r.name, members: participants, dmParticipants: participants }, myName)
          : r.name;
        const ch: Channel = {
          id: r.id, name: displayName, description: r.description ?? '',
          icon: r.icon, color: r.color, type: r.type,
          members: participants, createdBy: r.created_by ?? undefined,
          createdByUserId: r.created_by_user_id ?? undefined,
          organizationId: r.organization_id ?? undefined,
          ...(r.type === 'dm' ? { dmParticipants: participants } : {}),
        };
        if (r.type === 'custom') setCustomChannels(prev => prev.map(c => c.id === ch.id ? ch : c));
        else if (r.type === 'group') setGroupChannels(prev => prev.map(c => c.id === ch.id ? ch : c));
        else if (r.type === 'dm') setPersistedDmChannels(prev => prev.map(c => c.id === ch.id ? ch : c));
        else setGeneralChannels(prev => prev.map(c => c.id === ch.id ? ch : c));
        if (r.type === 'group' || r.type === 'dm') void loadAll();
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
  }, [user?.id, reconnectSeq]);

  return {
    generalChannels,
    customChannels,
    groupChannels,
    persistedDmChannels,
    dmChannelIdsWithMessages,
    pinnedChannelIds,
    channelMembersOverride,
    pendingDmChannelIds,
    hiddenDmChannelIds,
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
    hideDmChannel,
    unhideDmChannel,
    getOrCreateDMChannel,
    getDmUpsertPromise,
    addGeneralChannel,
    removeGeneralChannel,
    maxPinnedChannels: MAX_PINNED,
    reloadChannels: loadAll,
  };
}
