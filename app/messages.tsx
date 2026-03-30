import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Channel, Message } from '@/constants/types';
import NewChannelModal from '@/components/NewChannelModal';
import NewDMModal from '@/components/NewDMModal';
import NewGroupModal from '@/components/NewGroupModal';

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

function ChannelItem({ channel, lastMsg, unread, onPress }: {
  channel: Channel;
  lastMsg: Message | null;
  unread: number;
  onPress: () => void;
}) {
  const hasUnread = unread > 0;
  const isDM = channel.type === 'dm';
  const isGroup = channel.type === 'group';

  const previewText = () => {
    if (!lastMsg) return 'Aucun message';
    if (lastMsg.type === 'notification' || lastMsg.type === 'system') return `📢 ${lastMsg.content}`;
    if (lastMsg.attachmentUri) return `📷 ${lastMsg.content || 'Photo'}`;
    const prefix = lastMsg.isMe ? 'Vous : ' : `${lastMsg.sender.split(' ')[0]} : `;
    return prefix + lastMsg.content;
  };

  if (isDM) {
    const avatarColor = getAvatarColor(channel.name);
    return (
      <TouchableOpacity style={[styles.channelItem, hasUnread && styles.channelItemUnread]} onPress={onPress} activeOpacity={0.75}>
        <View style={[styles.dmAvatar, { backgroundColor: avatarColor + '25' }]}>
          <Text style={[styles.dmAvatarText, { color: avatarColor }]}>{channel.name.charAt(0).toUpperCase()}</Text>
          {hasUnread && <View style={styles.unreadDot} />}
        </View>
        <View style={styles.channelBody}>
          <View style={styles.channelTop}>
            <Text style={[styles.channelName, hasUnread && styles.channelNameUnread]} numberOfLines={1}>
              {channel.name}
            </Text>
            {lastMsg && (
              <Text style={[styles.channelTime, hasUnread && { color: avatarColor }]}>
                {formatChannelTime(lastMsg.timestamp)}
              </Text>
            )}
          </View>
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
        </View>
      </TouchableOpacity>
    );
  }

  if (isGroup) {
    const members = channel.members ?? [];
    const firstTwo = members.slice(0, 2);
    return (
      <TouchableOpacity style={[styles.channelItem, hasUnread && styles.channelItemUnread]} onPress={onPress} activeOpacity={0.75}>
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
          {hasUnread && <View style={styles.unreadDot} />}
        </View>
        <View style={styles.channelBody}>
          <View style={styles.channelTop}>
            <Text style={[styles.channelName, hasUnread && styles.channelNameUnread]} numberOfLines={1}>
              {channel.name}
            </Text>
            {lastMsg && (
              <Text style={[styles.channelTime, hasUnread && { color: channel.color }]}>
                {formatChannelTime(lastMsg.timestamp)}
              </Text>
            )}
          </View>
          <View style={styles.channelBottom}>
            <Text style={[styles.channelPreview, hasUnread && styles.channelPreviewUnread]} numberOfLines={1}>
              {previewText()}
            </Text>
            {hasUnread ? (
              <View style={[styles.unreadBadge, { backgroundColor: channel.color }]}>
                <Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={[styles.channelItem, hasUnread && styles.channelItemUnread]} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.channelIcon, { backgroundColor: channel.color + '20' }]}>
        <Ionicons name={channel.icon as any} size={22} color={channel.color} />
        {hasUnread && <View style={styles.unreadDot} />}
      </View>
      <View style={styles.channelBody}>
        <View style={styles.channelTop}>
          <Text style={[styles.channelName, hasUnread && styles.channelNameUnread]} numberOfLines={1}>
            {channel.type === 'custom' ? `# ${channel.name}` : channel.name}
          </Text>
          {lastMsg && (
            <Text style={[styles.channelTime, hasUnread && { color: channel.color }]}>
              {formatChannelTime(lastMsg.timestamp)}
            </Text>
          )}
        </View>
        <View style={styles.channelBottom}>
          <Text style={[styles.channelPreview, hasUnread && styles.channelPreviewUnread]} numberOfLines={1}>
            {previewText()}
          </Text>
          {hasUnread ? (
            <View style={[styles.unreadBadge, { backgroundColor: channel.color }]}>
              <Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function MessagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { channels, messages, unreadByChannel, profiles, addCustomChannel, addGroupChannel, getOrCreateDMChannel } = useApp();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showNewDM, setShowNewDM] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const totalUnread = Object.values(unreadByChannel).reduce((a, b) => a + b, 0);

  const lastMessageByChannel = useMemo(() => {
    const map: Record<string, Message | null> = {};
    for (const ch of channels) {
      const chMsgs = messages.filter(m => m.channelId === ch.id);
      map[ch.id] = chMsgs.length > 0 ? chMsgs[chMsgs.length - 1] : null;
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

  const generalChannels = filteredChannels.filter(ch => ch.type === 'general' || ch.type === 'building');
  const companyChannels = filteredChannels.filter(ch => ch.type === 'company');
  const customChannels = filteredChannels.filter(ch => ch.type === 'custom');
  const groupChannels = filteredChannels.filter(ch => ch.type === 'group');
  const dmChannels = filteredChannels.filter(ch => ch.type === 'dm');

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

  const currentUserName = user?.name ?? '';

  const EMPTY_LABELS: Record<string, string> = {
    'Messages directs': 'Aucun message direct — commencez une conversation !',
    'Groupes': 'Aucun groupe — créez un groupe pour discuter à plusieurs !',
    'Canaux personnalisés': 'Aucun canal personnalisé',
  };

  function renderSection(title: string, items: Channel[], icon?: string, onAction?: () => void, actionLabel?: string) {
    if (items.length === 0 && !onAction) return null;
    return (
      <>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>{title}</Text>
          {onAction && (
            <TouchableOpacity style={styles.sectionAction} onPress={onAction}>
              <Ionicons name="add" size={16} color={C.primary} />
              <Text style={styles.sectionActionText}>{actionLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
        {items.length > 0 ? (
          <View style={styles.channelGroup}>
            {items.map((ch, i) => (
              <View key={ch.id}>
                {i > 0 && <View style={styles.divider} />}
                <ChannelItem
                  channel={ch}
                  lastMsg={lastMessageByChannel[ch.id]}
                  unread={unreadByChannel[ch.id] ?? 0}
                  onPress={() => goToChannel(ch)}
                />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionText}>
              {EMPTY_LABELS[title] ?? 'Aucun élément'}
            </Text>
          </View>
        )}
      </>
    );
  }

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
      </View>

      <FlatList
        data={[]}
        keyExtractor={() => ''}
        renderItem={null}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View style={styles.content}>
            {renderSection('Canaux chantier', generalChannels)}
            {renderSection('Canaux entreprises', companyChannels)}
            {renderSection('Canaux personnalisés', customChannels, undefined, () => setShowNewChannel(true), 'Nouveau')}
            {renderSection('Groupes', groupChannels, undefined, () => setShowNewGroup(true), 'Nouveau')}
            {renderSection('Messages directs', dmChannels, undefined, () => setShowNewDM(true), 'Nouveau DM')}

            {filteredChannels.length === 0 && (
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
        )}
      />

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
  channelIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dmAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dmAvatarText: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  groupAvatar: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', position: 'relative' },
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
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14,
  },
  quickBtnIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  quickBtnText: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: C.text },
});
