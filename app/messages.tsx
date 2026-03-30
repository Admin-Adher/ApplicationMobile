import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  Platform, Alert, Modal, TouchableWithoutFeedback,
} from 'react-native';
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

function ChannelItem({ channel, lastMsg, unread, isPinned, onPress, onLongPress }: {
  channel: Channel;
  lastMsg: Message | null;
  unread: number;
  isPinned: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const hasUnread = unread > 0;
  const avatarColor = channel.type === 'dm' ? getAvatarColor(channel.name) : channel.color;

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
      style={[styles.channelItem, hasUnread && styles.channelItemUnread]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.75}
    >
      <View style={{ position: 'relative' }}>
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
          <Text style={[styles.channelName, hasUnread && styles.channelNameUnread]} numberOfLines={1}>
            {displayName}
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

export default function MessagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    channels, messages, unreadByChannel, profiles,
    addCustomChannel, addGroupChannel, getOrCreateDMChannel,
    pinnedChannelIds, pinChannel, unpinChannel, maxPinnedChannels,
  } = useApp();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showNewDM, setShowNewDM] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [actionSheet, setActionSheet] = useState<Channel | null>(null);
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

  const pinnedChannels = useMemo(
    () => pinnedChannelIds.map(id => channels.find(c => c.id === id)).filter(Boolean) as Channel[],
    [pinnedChannelIds, channels]
  );

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

  function renderSection(title: string, items: Channel[], onAction?: () => void, actionLabel?: string) {
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
                  isPinned={pinnedChannelIds.includes(ch.id)}
                  onPress={() => goToChannel(ch)}
                  onLongPress={() => setActionSheet(ch)}
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

  const showPinned = pinnedChannels.length > 0 && !search.trim();

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
                        onPress={() => goToChannel(ch)}
                        onLongPress={() => setActionSheet(ch)}
                      />
                    </View>
                  ))}
                </View>
              </>
            )}

            {renderSection('Canaux chantier', generalChannels)}
            {renderSection('Canaux entreprises', companyChannels)}
            {renderSection('Canaux personnalisés', customChannels, () => setShowNewChannel(true), 'Nouveau')}
            {renderSection('Groupes', groupChannels, () => setShowNewGroup(true), 'Nouveau')}
            {renderSection('Messages directs', dmChannels, () => setShowNewDM(true), 'Nouveau DM')}

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
});
