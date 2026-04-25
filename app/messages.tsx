import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Platform, Alert, Modal, TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Channel, Message } from '@/constants/types';
import NewChannelModal from '@/components/NewChannelModal';
import NewDMModal from '@/components/NewDMModal';
import NewGroupModal from '@/components/NewGroupModal';
import SuperAdminMessagingHub from '@/components/SuperAdminMessagingHub';

const STORAGE_KEY_COLLAPSED = 'messages.collapsedSections.v1';
const STORAGE_KEY_DENSITY = 'messages.density.v1';
const STORAGE_KEY_DISMISSED_PIN = 'messages.dismissedPinSuggestion.v1';
const PREVIEW_COUNT = 5;            // Combien de canaux affichés avant "Voir tout"
const ALPHA_BUCKET_THRESHOLD = 10;  // Au-delà, on regroupe par initiale dans Canaux entreprises
const PIN_SUGGESTION_MIN_UNREAD = 3;

type DensityMode = 'comfort' | 'compact';
type FilterMode = 'all' | 'unread' | 'company' | 'chantier' | 'dm-group';

const AVATAR_COLORS = [C.primary, '#059669', '#D97706', '#7C3AED', '#DB2777', '#EA580C', '#0891B2'];
function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatChannelTime(timestamp: string): string {
  if (!timestamp) return '';
  const parts = timestamp.split(' ');
  if (parts.length >= 2) return parts[1];
  return timestamp.slice(-5);
}

function getMsgSortTime(msg: Message): number {
  if (msg.dbCreatedAt) return new Date(msg.dbCreatedAt).getTime();
  if (msg.timestamp) {
    const m = msg.timestamp.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime();
  }
  return 0;
}

function ChannelAvatar({ channel }: { channel: Channel }) {
  const isDM = channel.type === 'dm';
  const isGroup = channel.type === 'group';

  if (isDM) {
    const color = getAvatarColor(channel.name);
    return (
      <View style={[styles.dmAvatar, { backgroundColor: color + '25' }]}>
        <Text style={[styles.dmAvatarText, { color }]}>{channel.name.charAt(0).toUpperCase()}</Text>
      </View>
    );
  }
  if (isGroup) {
    const members = channel.members ?? [];
    const firstTwo = members.slice(0, 2);
    return (
      <View style={[styles.groupAvatar, { backgroundColor: channel.color + '18' }]}>
        <View style={styles.groupAvatarStack}>
          {firstTwo.map((m, i) => {
            const c = getAvatarColor(m);
            return (
              <View key={i} style={[styles.groupMiniAvatar, { backgroundColor: c + '30', borderColor: channel.color + '15', left: i * 14 }]}>
                <Text style={[styles.groupMiniAvatarText, { color: c }]}>{m.charAt(0).toUpperCase()}</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.channelIcon, { backgroundColor: channel.color + '20' }]}>
      <Ionicons name={channel.icon as any} size={22} color={channel.color} />
    </View>
  );
}

function ChannelItem({ channel, lastMsg, unread, isPinned, density, onPress, onLongPress }: {
  channel: Channel;
  lastMsg: Message | null;
  unread: number;
  isPinned: boolean;
  density: DensityMode;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const hasUnread = unread > 0;
  const avatarColor = channel.type === 'dm' ? getAvatarColor(channel.name) : channel.color;
  const compact = density === 'compact';

  const previewText = () => {
    if (!lastMsg) return 'Aucun message';
    if (lastMsg.type === 'notification' || lastMsg.type === 'system') return `📢 ${lastMsg.content}`;
    if (lastMsg.attachmentUri) return `📷 ${lastMsg.content || 'Photo'}`;
    const prefix = lastMsg.isMe ? 'Vous : ' : `${lastMsg.sender.split(' ')[0]} : `;
    return prefix + lastMsg.content;
  };

  const displayName = channel.type === 'custom'
    ? `# ${channel.name}`
    : channel.name;

  return (
    <TouchableOpacity
      style={[
        compact ? styles.channelItemCompact : styles.channelItem,
        hasUnread && styles.channelItemUnread,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.75}
    >
      <View style={[{ position: 'relative' }, compact && { transform: [{ scale: 0.78 }] }]}>
        <ChannelAvatar channel={channel} />
        {hasUnread && <View style={styles.unreadDot} />}
        {isPinned && (
          <View style={styles.pinBadge}>
            <Ionicons name="pin" size={8} color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.channelBody}>
        <View style={styles.channelTop}>
          <Text
            style={[
              compact ? styles.channelNameCompact : styles.channelName,
              hasUnread && styles.channelNameUnread,
            ]}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          {lastMsg && (
            <Text style={[styles.channelTime, hasUnread && { color: avatarColor }]}>
              {formatChannelTime(lastMsg.timestamp)}
            </Text>
          )}
        </View>
        {compact ? (
          hasUnread ? (
            <View style={styles.compactUnreadRow}>
              <Text style={[styles.channelPreview, styles.channelPreviewUnread]} numberOfLines={1}>
                {previewText()}
              </Text>
              <View style={[styles.unreadBadge, { backgroundColor: avatarColor }]}>
                <Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            </View>
          ) : null
        ) : (
          <View style={styles.channelBottom}>
            <Text style={[styles.channelPreview, hasUnread && styles.channelPreviewUnread]} numberOfLines={1}>
              {previewText()}
            </Text>
            {hasUnread ? (
              <View style={[styles.unreadBadge, { backgroundColor: avatarColor }]}>
                <Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function MessagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    channels, messages, unreadByChannel, profiles,
    addCustomChannel, addGroupChannel, getOrCreateDMChannel,
    pinnedChannelIds, pinChannel, unpinChannel, maxPinnedChannels,
    setChannelRead,
  } = useApp();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showNewDM, setShowNewDM] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [actionSheet, setActionSheet] = useState<Channel | null>(null);

  // [Idée 4] Filtre rapide actif
  const [filter, setFilter] = useState<FilterMode>('all');
  // [Idée 1] Sections repliées (titre -> bool)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // [Idée 3] Sections où l'utilisateur a cliqué "Voir tout"
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  // [Idée 6] Densité d'affichage
  const [density, setDensity] = useState<DensityMode>('comfort');
  // [Idée 7] Suggestion d'épinglage déjà rejetée
  const [dismissedPinId, setDismissedPinId] = useState<string | null>(null);

  const topPad = insets.top;

  // Charge les préférences persistées
  useEffect(() => {
    (async () => {
      try {
        const [c, d, p] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_COLLAPSED),
          AsyncStorage.getItem(STORAGE_KEY_DENSITY),
          AsyncStorage.getItem(STORAGE_KEY_DISMISSED_PIN),
        ]);
        if (c) setCollapsed(JSON.parse(c));
        if (d === 'compact' || d === 'comfort') setDensity(d);
        if (p) setDismissedPinId(p);
      } catch {}
    })();
  }, []);

  const toggleCollapsed = useCallback((title: string) => {
    setCollapsed(prev => {
      const next = { ...prev, [title]: !prev[title] };
      AsyncStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const toggleDensity = useCallback(() => {
    setDensity(prev => {
      const next: DensityMode = prev === 'comfort' ? 'compact' : 'comfort';
      AsyncStorage.setItem(STORAGE_KEY_DENSITY, next).catch(() => {});
      return next;
    });
  }, []);

  const toggleExpandedSection = useCallback((title: string) => {
    setExpandedSections(prev => ({ ...prev, [title]: !prev[title] }));
  }, []);

  const totalUnread = Object.values(unreadByChannel).reduce((a, b) => a + b, 0);

  const lastMessageByChannel = useMemo(() => {
    const map: Record<string, Message | null> = {};
    const mapTime: Record<string, number> = {};
    for (const ch of channels) map[ch.id] = null;
    for (const msg of messages) {
      if (!msg.channelId) continue;
      const msgTime = getMsgSortTime(msg);
      if (!map[msg.channelId] || msgTime > (mapTime[msg.channelId] ?? 0)) {
        map[msg.channelId] = msg;
        mapTime[msg.channelId] = msgTime;
      }
    }
    return map;
  }, [channels, messages]);

  const filteredChannels = useMemo(() => {
    if (!search.trim()) return channels;
    const q = search.toLowerCase();
    return channels.filter(ch =>
      ch.name.toLowerCase().includes(q) ||
      ch.description.toLowerCase().includes(q) ||
      (lastMessageByChannel[ch.id]?.content ?? '').toLowerCase().includes(q)
    );
  }, [channels, search, lastMessageByChannel]);

  const pinnedChannels = useMemo(
    () => pinnedChannelIds.map(id => channels.find(c => c.id === id)).filter(Boolean) as Channel[],
    [pinnedChannelIds, channels]
  );

  const isSuperAdmin = user?.role === 'super_admin';

  if (isSuperAdmin) {
    return <SuperAdminMessagingHub />;
  }

  // [Idée 2] Tri intelligent : non-lus → récents → silencieux (alphabétique)
  const sortChannels = useCallback((items: Channel[]): Channel[] => {
    return [...items].sort((a, b) => {
      const ua = unreadByChannel[a.id] ?? 0;
      const ub = unreadByChannel[b.id] ?? 0;
      if (ua !== ub) return ub - ua;
      const ma = lastMessageByChannel[a.id];
      const mb = lastMessageByChannel[b.id];
      const ta = ma ? getMsgSortTime(ma) : 0;
      const tb = mb ? getMsgSortTime(mb) : 0;
      if (ta !== tb) return tb - ta;
      return a.name.localeCompare(b.name, 'fr');
    });
  }, [unreadByChannel, lastMessageByChannel]);

  const generalChannels = useMemo(
    () => sortChannels(filteredChannels.filter(ch => ch.type === 'general' || ch.type === 'building')),
    [filteredChannels, sortChannels]
  );
  const companyChannels = useMemo(
    () => sortChannels(filteredChannels.filter(ch => ch.type === 'company')),
    [filteredChannels, sortChannels]
  );
  const customChannels = useMemo(
    () => sortChannels(filteredChannels.filter(ch => ch.type === 'custom')),
    [filteredChannels, sortChannels]
  );
  const groupChannels = useMemo(
    () => sortChannels(filteredChannels.filter(ch => ch.type === 'group')),
    [filteredChannels, sortChannels]
  );
  const dmChannels = useMemo(
    () => sortChannels(filteredChannels.filter(ch => ch.type === 'dm')),
    [filteredChannels, sortChannels]
  );

  // [Idée 4] Compteurs pour les chips
  const unreadChannels = useMemo(
    () => sortChannels(filteredChannels.filter(ch => (unreadByChannel[ch.id] ?? 0) > 0)),
    [filteredChannels, unreadByChannel, sortChannels]
  );

  // [Idée 7] Suggestion d'épinglage : canal le plus actif non-épinglé
  const pinSuggestion = useMemo(() => {
    if (pinnedChannels.length >= maxPinnedChannels) return null;
    const candidates = channels
      .filter(ch => !pinnedChannelIds.includes(ch.id))
      .filter(ch => (unreadByChannel[ch.id] ?? 0) >= PIN_SUGGESTION_MIN_UNREAD)
      .filter(ch => ch.id !== dismissedPinId);
    if (candidates.length === 0) return null;
    return candidates.sort(
      (a, b) => (unreadByChannel[b.id] ?? 0) - (unreadByChannel[a.id] ?? 0)
    )[0];
  }, [channels, pinnedChannelIds, pinnedChannels, maxPinnedChannels, unreadByChannel, dismissedPinId]);

  function dismissPinSuggestion(id: string) {
    setDismissedPinId(id);
    AsyncStorage.setItem(STORAGE_KEY_DISMISSED_PIN, id).catch(() => {});
  }

  // Marquer toute une section comme lue
  function markSectionRead(title: string, items: Channel[]) {
    const unreadItems = items.filter(ch => (unreadByChannel[ch.id] ?? 0) > 0);
    if (unreadItems.length === 0) {
      Alert.alert('Tout est déjà lu', `Aucun message non lu dans « ${title} ».`);
      return;
    }
    const total = unreadItems.reduce((acc, ch) => acc + (unreadByChannel[ch.id] ?? 0), 0);
    Alert.alert(
      'Marquer comme lus',
      `Marquer ${total} message${total > 1 ? 's' : ''} non lu${total > 1 ? 's' : ''} dans « ${title} » comme lu${total > 1 ? 's' : ''} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          style: 'default',
          onPress: () => {
            for (const ch of unreadItems) setChannelRead(ch.id);
          },
        },
      ]
    );
  }

  function goToChannel(ch: Channel) {
    router.push({
      pathname: '/channel/[id]',
      params: {
        id: ch.id,
        name: ch.name,
        color: ch.color,
        icon: ch.icon,
        isDM: ch.type === 'dm' ? '1' : '0',
        isGroup: ch.type === 'group' ? '1' : '0',
        members: ch.members ? ch.members.join(',') : '',
      },
    } as any);
  }

  function handleCreateChannel(name: string, description: string, icon: string, color: string) {
    const ch = addCustomChannel(name, description, icon, color);
    goToChannel(ch);
  }

  function handleCreateGroup(name: string, members: string[], color: string) {
    const ch = addGroupChannel(name, members, color);
    goToChannel(ch);
  }

  function handleStartDM(profile: { name: string }) {
    const ch = getOrCreateDMChannel(profile.name);
    goToChannel(ch);
  }

  function handlePinAction(ch: Channel) {
    setActionSheet(null);
    const isPinned = pinnedChannelIds.includes(ch.id);
    if (isPinned) {
      unpinChannel(ch.id);
    } else {
      const result = pinChannel(ch.id);
      if (!result.success && result.reason === 'limit_reached') {
        Alert.alert(
          'Limite atteinte',
          `Vous pouvez épingler au maximum ${maxPinnedChannels} conversations. Désépinglez-en une pour continuer.`,
          [{ text: 'OK' }]
        );
      }
    }
  }

  const currentUserName = user?.name ?? '';

  const EMPTY_LABELS: Record<string, string> = {
    'Messages directs': 'Aucun message direct — commencez une conversation !',
    'Groupes': 'Aucun groupe — créez un groupe pour discuter à plusieurs !',
    'Canaux personnalisés': 'Aucun canal personnalisé',
  };

  function renderChannelRow(ch: Channel, i: number) {
    return (
      <View key={ch.id}>
        {i > 0 && <View style={styles.divider} />}
        <ChannelItem
          channel={ch}
          lastMsg={lastMessageByChannel[ch.id]}
          unread={unreadByChannel[ch.id] ?? 0}
          isPinned={pinnedChannelIds.includes(ch.id)}
          density={density}
          onPress={() => goToChannel(ch)}
          onLongPress={() => setActionSheet(ch)}
        />
      </View>
    );
  }

  // [Idée 5] Regroupement alphabétique pour la section Entreprises quand >= seuil
  function renderAlphaBuckets(items: Channel[]) {
    const buckets: Record<string, Channel[]> = {};
    for (const ch of items) {
      const letter = (ch.name.charAt(0) || '#').toUpperCase();
      const key = /[A-Z]/.test(letter) ? letter : '#';
      (buckets[key] = buckets[key] ?? []).push(ch);
    }
    const keys = Object.keys(buckets).sort();
    return (
      <View style={styles.channelGroup}>
        {keys.map((k, idx) => (
          <View key={k}>
            {idx > 0 && <View style={styles.divider} />}
            <View style={styles.alphaHeader}>
              <Text style={styles.alphaHeaderText}>{k}</Text>
              <Text style={styles.alphaHeaderCount}>{buckets[k].length}</Text>
            </View>
            {buckets[k].map((ch, i) => (
              <View key={ch.id}>
                {i > 0 && <View style={styles.divider} />}
                <ChannelItem
                  channel={ch}
                  lastMsg={lastMessageByChannel[ch.id]}
                  unread={unreadByChannel[ch.id] ?? 0}
                  isPinned={pinnedChannelIds.includes(ch.id)}
                  density={density}
                  onPress={() => goToChannel(ch)}
                  onLongPress={() => setActionSheet(ch)}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }

  function renderSection(
    title: string,
    items: Channel[],
    opts?: {
      onAction?: () => void;
      actionLabel?: string;
      alphaBuckets?: boolean;       // [Idée 5]
      hideEmpty?: boolean;
      forceFullList?: boolean;      // ignore le limit "Voir tout" (utile en mode filtre)
    }
  ) {
    const { onAction, actionLabel, alphaBuckets, hideEmpty, forceFullList } = opts ?? {};
    if (items.length === 0 && (!onAction || hideEmpty)) return null;

    const isCollapsed = !!collapsed[title];
    const isExpanded = !!expandedSections[title];
    const useAlpha = alphaBuckets && items.length >= ALPHA_BUCKET_THRESHOLD;

    // [Idée 3] Limit à 5 si beaucoup de canaux (sauf alpha buckets ou forceFullList)
    const shouldLimit = !useAlpha && !forceFullList && items.length > PREVIEW_COUNT && !isExpanded;
    const visibleItems = shouldLimit ? items.slice(0, PREVIEW_COUNT) : items;
    const hiddenCount = items.length - visibleItems.length;

    // Compteur de non-lus dans cette section
    const sectionUnread = items.reduce((acc, ch) => acc + (unreadByChannel[ch.id] ?? 0), 0);

    return (
      <>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => toggleCollapsed(title)}
          onLongPress={() => markSectionRead(title, items)}
          delayLongPress={500}
          activeOpacity={0.7}
        >
          <View style={styles.sectionTitleRow}>
            <Ionicons
              name={isCollapsed ? 'chevron-forward' : 'chevron-down'}
              size={14}
              color={C.textMuted}
            />
            <Text style={styles.sectionLabel}>{title}</Text>
            <View style={styles.sectionCountPill}>
              <Text style={styles.sectionCountText}>{items.length}</Text>
            </View>
            {sectionUnread > 0 && (
              <TouchableOpacity
                style={styles.sectionUnreadDot}
                onPress={() => markSectionRead(title, items)}
                accessibilityLabel={`Marquer ${sectionUnread} messages comme lus`}
              >
                <Text style={styles.sectionUnreadDotText}>{sectionUnread > 99 ? '99+' : sectionUnread}</Text>
              </TouchableOpacity>
            )}
          </View>
          {onAction && (
            <TouchableOpacity
              style={styles.sectionAction}
              onPress={(e) => { e.stopPropagation?.(); onAction(); }}
            >
              <Ionicons name="add" size={16} color={C.primary} />
              <Text style={styles.sectionActionText}>{actionLabel}</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
        {!isCollapsed && (
          items.length > 0 ? (
            useAlpha ? (
              renderAlphaBuckets(items)
            ) : (
              <View style={styles.channelGroup}>
                {visibleItems.map((ch, i) => renderChannelRow(ch, i))}
                {hiddenCount > 0 && (
                  <>
                    <View style={styles.divider} />
                    <TouchableOpacity
                      style={styles.showMoreBtn}
                      onPress={() => toggleExpandedSection(title)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.showMoreText}>
                        Voir les {hiddenCount} autre{hiddenCount > 1 ? 's' : ''}
                      </Text>
                      <Ionicons name="chevron-down" size={14} color={C.primary} />
                    </TouchableOpacity>
                  </>
                )}
                {isExpanded && items.length > PREVIEW_COUNT && (
                  <>
                    <View style={styles.divider} />
                    <TouchableOpacity
                      style={styles.showMoreBtn}
                      onPress={() => toggleExpandedSection(title)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.showMoreText}>Réduire</Text>
                      <Ionicons name="chevron-up" size={14} color={C.primary} />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )
          ) : (
            <View style={styles.emptySection}>
              <Text style={styles.emptySectionText}>
                {EMPTY_LABELS[title] ?? 'Aucun élément'}
              </Text>
            </View>
          )
        )}
      </>
    );
  }

  const showPinned = pinnedChannels.length > 0 && !search.trim() && filter === 'all';

  // [Idée 4] Définition des chips
  const chips: { id: FilterMode; label: string; badge?: number; icon?: string }[] = [
    { id: 'all', label: 'Tous' },
    { id: 'unread', label: 'Non lus', badge: unreadChannels.length, icon: 'mail-unread-outline' },
    { id: 'company', label: 'Entreprises', icon: 'business-outline' },
    { id: 'chantier', label: 'Chantier', icon: 'construct-outline' },
    { id: 'dm-group', label: 'DM & Groupes', icon: 'chatbubbles-outline' },
  ];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Messages</Text>
            {totalUnread > 0 && (
              <Text style={styles.subtitle}>{totalUnread} non lu{totalUnread > 1 ? 's' : ''}</Text>
            )}
          </View>
          {/* [Idée 6] Toggle densité */}
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={toggleDensity}
            accessibilityLabel={density === 'comfort' ? 'Passer en mode compact' : 'Passer en mode confort'}
          >
            <Ionicons
              name={density === 'comfort' ? 'reorder-three-outline' : 'reorder-four-outline'}
              size={20}
              color={C.primary}
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNewDM(true)}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={C.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNewGroup(true)}>
            <Ionicons name="people-outline" size={20} color={C.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNewChannel(true)}>
            <Ionicons name="add-circle-outline" size={22} color={C.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un canal ou un message..."
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        {/* [Idée 4] Chips de filtre rapide */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {chips.map(chip => {
            const active = filter === chip.id;
            return (
              <TouchableOpacity
                key={chip.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(chip.id)}
                activeOpacity={0.7}
              >
                {chip.icon && (
                  <Ionicons
                    name={chip.icon as any}
                    size={13}
                    color={active ? '#fff' : C.textSub}
                  />
                )}
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {chip.label}
                </Text>
                {!!chip.badge && chip.badge > 0 && (
                  <View style={[styles.chipBadge, active && styles.chipBadgeActive]}>
                    <Text style={[styles.chipBadgeText, active && styles.chipBadgeTextActive]}>
                      {chip.badge > 99 ? '99+' : chip.badge}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          {/* [Idée 7] Suggestion d'épinglage */}
          {pinSuggestion && filter === 'all' && !search.trim() && (
            <View style={styles.pinSuggestion}>
              <View style={[styles.pinSuggestionIcon, { backgroundColor: C.waiting + '20' }]}>
                <Ionicons name="pin" size={16} color={C.waiting} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pinSuggestionTitle} numberOfLines={1}>
                  Épingler « {pinSuggestion.name} » ?
                </Text>
                <Text style={styles.pinSuggestionSub}>
                  {unreadByChannel[pinSuggestion.id]} messages non lus — accédez-y plus vite.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.pinSuggestionBtn}
                onPress={() => {
                  const r = pinChannel(pinSuggestion.id);
                  if (!r.success && r.reason === 'limit_reached') {
                    Alert.alert(
                      'Limite atteinte',
                      `Vous pouvez épingler au maximum ${maxPinnedChannels} conversations.`,
                      [{ text: 'OK' }]
                    );
                  }
                }}
              >
                <Text style={styles.pinSuggestionBtnText}>Épingler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.pinSuggestionDismiss}
                onPress={() => dismissPinSuggestion(pinSuggestion.id)}
                accessibilityLabel="Ignorer la suggestion"
              >
                <Ionicons name="close" size={16} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          )}

          {showPinned && (
            <>
              <View style={styles.sectionHeader}>
                <View style={styles.pinnedSectionTitle}>
                  <Ionicons name="pin" size={12} color={C.waiting} />
                  <Text style={[styles.sectionLabel, { color: C.waiting }]}>ÉPINGLÉES</Text>
                  <Text style={styles.pinnedCount}>{pinnedChannels.length}/{maxPinnedChannels}</Text>
                </View>
              </View>
              <View style={styles.channelGroup}>
                {pinnedChannels.map((ch, i) => (
                  <View key={ch.id}>
                    {i > 0 && <View style={styles.divider} />}
                    <ChannelItem
                      channel={ch}
                      lastMsg={lastMessageByChannel[ch.id]}
                      unread={unreadByChannel[ch.id] ?? 0}
                      isPinned={true}
                      density={density}
                      onPress={() => goToChannel(ch)}
                      onLongPress={() => setActionSheet(ch)}
                    />
                  </View>
                ))}
              </View>
            </>
          )}

          {/* [Idée 4] Application des filtres aux sections affichées */}
          {filter === 'unread' && (
            unreadChannels.length > 0
              ? renderSection('Non lus', unreadChannels, { forceFullList: true })
              : (
                <View style={styles.empty}>
                  <Ionicons name="checkmark-done-circle-outline" size={40} color={C.textMuted} />
                  <Text style={styles.emptyText}>Tout est lu — bravo !</Text>
                </View>
              )
          )}
          {(filter === 'all' || filter === 'chantier') &&
            renderSection('Canaux chantier', generalChannels)}
          {(filter === 'all' || filter === 'company') &&
            renderSection('Canaux entreprises', companyChannels, { alphaBuckets: true })}
          {filter === 'all' &&
            renderSection('Canaux personnalisés', customChannels, {
              onAction: () => setShowNewChannel(true),
              actionLabel: 'Nouveau',
            })}
          {(filter === 'all' || filter === 'dm-group') &&
            renderSection('Groupes', groupChannels, {
              onAction: () => setShowNewGroup(true),
              actionLabel: 'Nouveau',
            })}
          {(filter === 'all' || filter === 'dm-group') &&
            renderSection('Messages directs', dmChannels, {
              onAction: () => setShowNewDM(true),
              actionLabel: 'Nouveau DM',
            })}

          {filteredChannels.length === 0 && filter === 'all' && (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={40} color={C.textMuted} />
              <Text style={styles.emptyText}>Aucun résultat</Text>
            </View>
          )}

          <View style={styles.quickActions}>
            <TouchableOpacity style={styles.quickBtn} onPress={() => setShowNewChannel(true)}>
              <View style={[styles.quickBtnIcon, { backgroundColor: C.primary + '20' }]}>
                <Ionicons name="add-circle" size={22} color={C.primary} />
              </View>
              <Text style={styles.quickBtnText}>Créer un canal</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.quickBtn} onPress={() => setShowNewGroup(true)}>
              <View style={[styles.quickBtnIcon, { backgroundColor: '#7C3AED' + '20' }]}>
                <Ionicons name="people-circle" size={22} color="#7C3AED" />
              </View>
              <Text style={styles.quickBtnText}>Créer un groupe</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.quickBtn} onPress={() => setShowNewDM(true)}>
              <View style={[styles.quickBtnIcon, { backgroundColor: '#EC4899' + '20' }]}>
                <Ionicons name="chatbubble-ellipses" size={22} color="#EC4899" />
              </View>
              <Text style={styles.quickBtnText}>Message direct</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <NewChannelModal
        visible={showNewChannel}
        onClose={() => setShowNewChannel(false)}
        onCreate={handleCreateChannel}
      />
      <NewGroupModal
        visible={showNewGroup}
        onClose={() => setShowNewGroup(false)}
        profiles={profiles}
        currentUserName={currentUserName}
        onCreate={handleCreateGroup}
      />
      <NewDMModal
        visible={showNewDM}
        onClose={() => setShowNewDM(false)}
        profiles={profiles}
        currentUserName={currentUserName}
        onSelect={handleStartDM}
      />

      {/* Action sheet pour épingler/désépingler */}
      <Modal
        visible={!!actionSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setActionSheet(null)}
      >
        <TouchableWithoutFeedback onPress={() => setActionSheet(null)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.sheet}>
                {actionSheet && (
                  <>
                    <View style={styles.sheetHeader}>
                      <ChannelAvatar channel={actionSheet} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sheetTitle} numberOfLines={1}>{actionSheet.name}</Text>
                        <Text style={styles.sheetSub}>
                          {actionSheet.type === 'dm' ? 'Message direct' : actionSheet.type === 'group' ? 'Groupe' : 'Canal'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.sheetDivider} />
                    <TouchableOpacity
                      style={styles.sheetBtn}
                      onPress={() => handlePinAction(actionSheet)}
                      activeOpacity={0.75}
                    >
                      {pinnedChannelIds.includes(actionSheet.id) ? (
                        <>
                          <View style={[styles.sheetBtnIcon, { backgroundColor: C.waiting + '15' }]}>
                            <Ionicons name="pin-outline" size={20} color={C.waiting} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.sheetBtnLabel, { color: C.waiting }]}>Désépingler la conversation</Text>
                            <Text style={styles.sheetBtnSub}>Retire de la section Épinglées</Text>
                          </View>
                        </>
                      ) : (
                        <>
                          <View style={[styles.sheetBtnIcon, { backgroundColor: C.primary + '15' }]}>
                            <Ionicons name="pin" size={20} color={C.primary} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.sheetBtnLabel}>Épingler la conversation</Text>
                            <Text style={styles.sheetBtnSub}>
                              {pinnedChannelIds.length}/{maxPinnedChannels} emplacements utilisés
                            </Text>
                          </View>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.sheetBtn}
                      onPress={() => { setActionSheet(null); goToChannel(actionSheet); }}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.sheetBtnIcon, { backgroundColor: C.surface2 }]}>
                        <Ionicons name="chatbubble-outline" size={20} color={C.textSub} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sheetBtnLabel}>Ouvrir la conversation</Text>
                        <Text style={styles.sheetBtnSub}>Aller directement aux messages</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.sheetCancelBtn} onPress={() => setActionSheet(null)}>
                      <Text style={styles.sheetCancelText}>Annuler</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, marginTop: 1 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface2, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  content: { padding: 16, paddingBottom: 40 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8, marginTop: 4,
  },
  pinnedSectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pinnedCount: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted, marginLeft: 2 },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sectionActionText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  channelGroup: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1,
    borderColor: C.border, marginBottom: 20, overflow: 'hidden',
  },
  channelItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  channelItemUnread: { backgroundColor: C.primaryBg + '60' },
  channelIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  dmAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  dmAvatarText: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  groupAvatar: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  groupAvatarStack: { width: 36, height: 26, position: 'relative' },
  groupMiniAvatar: {
    position: 'absolute', width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
  },
  groupMiniAvatarText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  unreadDot: {
    position: 'absolute', top: 2, right: 2,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: C.open, borderWidth: 2, borderColor: C.surface,
  },
  pinBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: C.waiting, borderWidth: 2, borderColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  channelBody: { flex: 1 },
  channelTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  channelName: { fontSize: 15, fontFamily: 'Inter_500Medium', color: C.text, flex: 1 },
  channelNameUnread: { fontFamily: 'Inter_700Bold' },
  channelTime: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  channelBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  channelPreview: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  channelPreviewUnread: { color: C.text, fontFamily: 'Inter_500Medium' },
  unreadBadge: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, minWidth: 20, alignItems: 'center' },
  unreadBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  divider: { height: 1, backgroundColor: C.borderLight, marginHorizontal: 14 },
  emptySection: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1,
    borderColor: C.border, marginBottom: 20, padding: 20, alignItems: 'center',
  },
  emptySectionText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },
  quickActions: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1,
    borderColor: C.border, overflow: 'hidden', marginTop: 8,
  },
  quickBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  quickBtnIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  quickBtnText: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: C.text },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 34, paddingTop: 8,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 16,
  },
  sheetTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  sheetSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  sheetDivider: { height: 1, backgroundColor: C.border, marginBottom: 8 },
  sheetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  sheetBtnIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetBtnLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 2 },
  sheetBtnSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  sheetCancelBtn: {
    marginHorizontal: 16, marginTop: 8, paddingVertical: 14,
    backgroundColor: C.surface2, borderRadius: 14, alignItems: 'center',
  },
  sheetCancelText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.textSub },

  // [Idée 1] Headers de section pliables
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  sectionCountPill: {
    backgroundColor: C.surface2, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1,
    minWidth: 20, alignItems: 'center',
  },
  sectionCountText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.textSub },
  sectionUnreadDot: {
    backgroundColor: C.open, borderRadius: 9, paddingHorizontal: 6, paddingVertical: 1,
    minWidth: 18, alignItems: 'center',
  },
  sectionUnreadDotText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },

  // [Idée 3] Bouton "Voir tout"
  showMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 12, backgroundColor: C.surface,
  },
  showMoreText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },

  // [Idée 4] Chips de filtre
  chipsRow: { gap: 6, paddingTop: 10, paddingRight: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: C.surface2, borderRadius: 18,
    borderWidth: 1, borderColor: C.border,
  },
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  chipTextActive: { color: '#fff' },
  chipBadge: {
    backgroundColor: C.open, borderRadius: 8, paddingHorizontal: 5, minWidth: 16,
    alignItems: 'center',
  },
  chipBadgeActive: { backgroundColor: '#fff' },
  chipBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  chipBadgeTextActive: { color: C.primary },

  // [Idée 5] Headers alphabétiques
  alphaHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 6, backgroundColor: C.surface2,
  },
  alphaHeaderText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.textSub, letterSpacing: 0.5 },
  alphaHeaderCount: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted },

  // [Idée 6] Mode compact
  channelItemCompact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  channelNameCompact: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text, flex: 1 },
  compactUnreadRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  // [Idée 7] Bannière suggestion d'épinglage
  pinSuggestion: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.waiting + '40',
    padding: 10, marginBottom: 14,
  },
  pinSuggestionIcon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  pinSuggestionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  pinSuggestionSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  pinSuggestionBtn: {
    backgroundColor: C.waiting, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
  },
  pinSuggestionBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  pinSuggestionDismiss: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface2,
  },
});
