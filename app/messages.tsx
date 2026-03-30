import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { Channel, Message } from '@/constants/types';
import Header from '@/components/Header';

function getAvatarColor(name: string): string {
  const COLORS = [C.primary, '#059669', '#D97706', '#7C3AED', '#DB2777', '#EA580C', '#0891B2', '#65A30D'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
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

  const previewText = () => {
    if (!lastMsg) return 'Aucun message';
    if (lastMsg.type === 'notification' || lastMsg.type === 'system') return `📢 ${lastMsg.content}`;
    if (lastMsg.attachmentUri) return `📷 ${lastMsg.content || 'Photo'}`;
    const prefix = lastMsg.isMe ? 'Vous : ' : `${lastMsg.sender.split(' ')[0]} : `;
    return prefix + lastMsg.content;
  };

  return (
    <TouchableOpacity style={[styles.channelItem, hasUnread && styles.channelItemUnread]} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.channelIcon, { backgroundColor: channel.color + '20' }]}>
        <Ionicons name={channel.icon as any} size={22} color={channel.color} />
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

export default function MessagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { channels, messages, unreadByChannel } = useApp();
  const [search, setSearch] = useState('');
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

  function goToChannel(ch: Channel) {
    router.push({ pathname: '/channel/[id]', params: { id: ch.id, name: ch.name, color: ch.color, icon: ch.icon } } as any);
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
              <Text style={styles.subtitle}>{totalUnread} message{totalUnread > 1 ? 's' : ''} non lu{totalUnread > 1 ? 's' : ''}</Text>
            )}
          </View>
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
            {generalChannels.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Canaux chantier</Text>
                <View style={styles.channelGroup}>
                  {generalChannels.map(ch => (
                    <ChannelItem
                      key={ch.id}
                      channel={ch}
                      lastMsg={lastMessageByChannel[ch.id]}
                      unread={unreadByChannel[ch.id] ?? 0}
                      onPress={() => goToChannel(ch)}
                    />
                  ))}
                </View>
              </>
            )}
            {companyChannels.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Canaux entreprises</Text>
                <View style={styles.channelGroup}>
                  {companyChannels.map(ch => (
                    <ChannelItem
                      key={ch.id}
                      channel={ch}
                      lastMsg={lastMessageByChannel[ch.id]}
                      unread={unreadByChannel[ch.id] ?? 0}
                      onPress={() => goToChannel(ch)}
                    />
                  ))}
                </View>
              </>
            )}
            {filteredChannels.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={40} color={C.textMuted} />
                <Text style={styles.emptyText}>Aucun canal trouvé</Text>
              </View>
            )}
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={14} color={C.textSub} />
              <Text style={styles.infoText}>
                Les messages sont synchronisés en temps réel via Supabase Realtime
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, marginTop: 1 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface2, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  content: { padding: 16, paddingBottom: 40 },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  channelGroup: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, marginBottom: 20, overflow: 'hidden' },
  channelItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  channelItemUnread: { backgroundColor: C.primaryBg + '60' },
  channelIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  unreadDot: { position: 'absolute', top: 2, right: 2, width: 10, height: 10, borderRadius: 5, backgroundColor: C.open, borderWidth: 2, borderColor: C.surface },
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
  empty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },
  infoBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border },
  infoText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
});
