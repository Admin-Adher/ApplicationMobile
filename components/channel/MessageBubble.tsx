import { View, Text, StyleSheet, TouchableOpacity, Image, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { Message } from '@/constants/types';
import { getLinkedItemIcon, getLinkedItemLabel, getLinkedItemColor } from './AttachItemModal';

const AVATAR_COLORS = [C.primary, '#059669', '#D97706', '#7C3AED', '#DB2777', '#EA580C', '#0891B2', '#65A30D'];

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function detectMentions(text: string, name: string): boolean {
  return text.toLowerCase().includes(`@${name.toLowerCase().split(' ')[0]}`);
}

function MessageTextRender({ text, isMe }: { text: string; isMe: boolean }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const combined = /(https?:\/\/[^\s]+)|(@\w+)/g;
  let match;
  let idx = 0;
  while ((match = combined.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<Text key={`t${idx++}`} style={[styles.msgText, isMe && styles.msgTextMe]}>{text.slice(lastIndex, match.index)}</Text>);
    }
    if (match[0].startsWith('http')) {
      const url = match[0];
      parts.push(
        <Text key={`u${idx++}`} style={[styles.msgText, styles.msgLink, isMe && { color: '#93C5FD' }]} onPress={() => Linking.openURL(url).catch(() => {})}>{url}</Text>
      );
    } else {
      parts.push(<Text key={`m${idx++}`} style={[styles.msgText, styles.msgMention, isMe && { backgroundColor: 'rgba(255,255,255,0.2)' }]}>{match[0]}</Text>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<Text key={`t${idx++}`} style={[styles.msgText, isMe && styles.msgTextMe]}>{text.slice(lastIndex)}</Text>);
  }
  return <Text>{parts}</Text>;
}

interface Props {
  msg: Message;
  color: string;
  userName: string;
  onLongPress: () => void;
  onNotifPress: (msg: Message) => void;
  onLinkedItemPress?: (msg: Message) => void;
  onReactInline: (emoji: string, msg: Message) => void;
  onOpenReactPicker: (msg: Message) => void;
}

export default function MessageBubble({ msg, color, userName, onLongPress, onNotifPress, onLinkedItemPress, onReactInline, onOpenReactPicker }: Props) {
  if (msg.type === 'notification' || msg.type === 'system') {
    return (
      <TouchableOpacity style={styles.notifWrap} onPress={() => onNotifPress(msg)} activeOpacity={msg.reserveId ? 0.7 : 1}>
        <View style={[styles.notifBubble, msg.reserveId && { borderColor: C.primary + '40', borderWidth: 1 }]}>
          <Ionicons name={msg.reserveId ? 'alert-circle-outline' : 'notifications'} size={12} color={C.inProgress} />
          <Text style={styles.notifText}>{msg.content}</Text>
          {msg.reserveId && <Ionicons name="chevron-forward" size={11} color={C.primary} />}
        </View>
        <Text style={styles.notifTime}>{msg.timestamp.split(' ')[1]}</Text>
      </TouchableOpacity>
    );
  }

  const avatarColor = getAvatarColor(msg.sender);
  const isMentioned = detectMentions(msg.content, userName);
  const readCount = msg.readBy.filter(n => n !== userName).length;

  const linkedType = msg.linkedItemType;
  const linkedId = msg.linkedItemId;
  const linkedTitle = msg.linkedItemTitle;
  const hasLinkedItem = !!(linkedType && linkedId);
  const itemColor = hasLinkedItem ? getLinkedItemColor(linkedType) : C.primary;
  const itemIcon = hasLinkedItem ? getLinkedItemIcon(linkedType) : 'link-outline';
  const itemLabel = hasLinkedItem ? getLinkedItemLabel(linkedType) : '';

  const hasLegacyReserve = !!msg.reserveId && !hasLinkedItem;

  return (
    <TouchableOpacity
      style={[styles.bubbleWrap, msg.isMe && styles.bubbleWrapMe, isMentioned && !msg.isMe && styles.bubbleMentioned]}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.95}
    >
      {!msg.isMe && (
        <View style={[styles.avatar, { backgroundColor: avatarColor + '25' }]}>
          <Text style={[styles.avatarText, { color: avatarColor }]}>{msg.sender.charAt(0)}</Text>
        </View>
      )}
      <View style={{ maxWidth: '78%' }}>
        {!msg.isMe && <Text style={[styles.senderName, { color: avatarColor }]}>{msg.sender}</Text>}

        {msg.replyToId && (
          <View style={[styles.replyPreview, msg.isMe && styles.replyPreviewMe]}>
            <View style={[styles.replyBar, { backgroundColor: msg.isMe ? 'rgba(255,255,255,0.5)' : color }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.replyWho, { color: msg.isMe ? 'rgba(255,255,255,0.8)' : color }]}>{msg.replyToSender}</Text>
              <Text style={[styles.replyText, msg.isMe && { color: 'rgba(255,255,255,0.7)' }]} numberOfLines={1}>{msg.replyToContent}</Text>
            </View>
          </View>
        )}

        <View style={[
          styles.bubble,
          msg.isMe ? [styles.bubbleMe, { backgroundColor: color }] : styles.bubbleThem,
          msg.isPinned && styles.bubblePinned,
        ]}>
          {msg.isPinned && (
            <View style={styles.pinBadge}>
              <Ionicons name="pin" size={9} color={msg.isMe ? 'rgba(255,255,255,0.7)' : C.waiting} />
              <Text style={[styles.pinBadgeText, msg.isMe && { color: 'rgba(255,255,255,0.7)' }]}>Épinglé</Text>
            </View>
          )}
          {msg.attachmentUri && (
            <Image source={{ uri: msg.attachmentUri }} style={styles.attachment} resizeMode="cover" />
          )}
          {msg.content.length > 0 && (
            <MessageTextRender text={msg.content} isMe={msg.isMe} />
          )}

          {hasLinkedItem && (
            <TouchableOpacity
              style={[
                styles.linkedCard,
                msg.isMe ? styles.linkedCardMe : { borderColor: itemColor + '30', backgroundColor: itemColor + '08' },
              ]}
              onPress={() => (onLinkedItemPress ?? onNotifPress)(msg)}
              activeOpacity={0.75}
            >
              <View style={[
                styles.linkedCardIcon,
                msg.isMe ? styles.linkedCardIconMe : { backgroundColor: itemColor + '18' },
              ]}>
                <Ionicons name={itemIcon as any} size={14} color={msg.isMe ? '#fff' : itemColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.linkedCardLabel, msg.isMe ? { color: 'rgba(255,255,255,0.7)' } : { color: itemColor }]}>
                  {itemLabel}
                </Text>
                <Text
                  style={[styles.linkedCardTitle, msg.isMe ? { color: '#fff' } : { color: C.text }]}
                  numberOfLines={1}
                >
                  {linkedTitle ?? linkedId}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={13} color={msg.isMe ? 'rgba(255,255,255,0.7)' : itemColor} />
            </TouchableOpacity>
          )}

          {hasLegacyReserve && (
            <TouchableOpacity
              style={[styles.linkedCard, msg.isMe && styles.linkedCardMe]}
              onPress={() => onNotifPress(msg)}
              activeOpacity={0.75}
            >
              <View style={[styles.linkedCardIcon, msg.isMe ? styles.linkedCardIconMe : { backgroundColor: C.primary + '18' }]}>
                <Ionicons name="alert-circle-outline" size={14} color={msg.isMe ? '#fff' : C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.linkedCardLabel, msg.isMe ? { color: 'rgba(255,255,255,0.7)' } : { color: C.primary }]}>Réserve</Text>
                <Text style={[styles.linkedCardTitle, msg.isMe ? { color: '#fff' } : { color: C.text }]} numberOfLines={1}>{msg.reserveId}</Text>
              </View>
              <Ionicons name="chevron-forward" size={13} color={msg.isMe ? 'rgba(255,255,255,0.7)' : C.primary} />
            </TouchableOpacity>
          )}
        </View>

        {Object.keys(msg.reactions).length > 0 && (
          <View style={[styles.reactionsRow, msg.isMe && { justifyContent: 'flex-end' }]}>
            {Object.entries(msg.reactions).map(([emoji, users]) =>
              users.length > 0 ? (
                <TouchableOpacity
                  key={emoji}
                  style={[styles.reactionChip, users.includes(userName) && styles.reactionChipMine]}
                  onPress={() => onReactInline(emoji, msg)}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                  <Text style={styles.reactionCount}>{users.length}</Text>
                </TouchableOpacity>
              ) : null
            )}
            <TouchableOpacity
              style={styles.addReactionBtn}
              onPress={() => onOpenReactPicker(msg)}
            >
              <Text style={styles.addReactionText}>＋</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.metaRow, msg.isMe && { justifyContent: 'flex-end' }]}>
          <Text style={[styles.timeText, msg.isMe && styles.timeTextMe]}>
            {msg.timestamp.split(' ')[1] ?? msg.timestamp}
          </Text>
          {msg.isMe && (
            <View style={styles.readRow}>
              <Ionicons
                name={readCount > 0 ? 'checkmark-done' : 'checkmark'}
                size={11}
                color={readCount > 0 ? C.closed : C.textMuted}
              />
              {readCount > 0 && <Text style={styles.readText}>Vu par {readCount}</Text>}
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  notifWrap: { alignItems: 'center', marginVertical: 4 },
  notifBubble: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.surface2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  notifText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  notifTime: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },

  bubbleWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 8 },
  bubbleWrapMe: { flexDirection: 'row-reverse' },
  bubbleMentioned: { backgroundColor: C.accentBg, borderRadius: 12, padding: 4 },

  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  senderName: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginBottom: 3 },

  replyPreview: { flexDirection: 'row', backgroundColor: C.surface2, borderRadius: 8, padding: 6, marginBottom: 4, gap: 6 },
  replyPreviewMe: { backgroundColor: 'rgba(255,255,255,0.2)' },
  replyBar: { width: 2, borderRadius: 1 },
  replyWho: { fontSize: 10, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  replyText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },

  bubble: { borderRadius: 16, padding: 10, maxWidth: '100%' },
  bubbleMe: { borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: C.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  bubblePinned: { borderWidth: 1.5, borderColor: C.waiting + '60' },
  pinBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 4 },
  pinBadgeText: { fontSize: 9, fontFamily: 'Inter_600SemiBold', color: C.waiting, textTransform: 'uppercase' },

  attachment: { width: 200, height: 150, borderRadius: 8, marginBottom: 4 },

  linkedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 8, paddingVertical: 7, paddingHorizontal: 8,
    borderRadius: 8, borderWidth: 1, borderColor: C.border,
  },
  linkedCardMe: { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)' },
  linkedCardIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  linkedCardIconMe: { backgroundColor: 'rgba(255,255,255,0.25)' },
  linkedCardLabel: { fontSize: 9, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5 },
  linkedCardTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  msgText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20 },
  msgTextMe: { color: '#fff' },
  msgLink: { color: C.primary, textDecorationLine: 'underline' },
  msgMention: { color: C.primary, fontFamily: 'Inter_600SemiBold', backgroundColor: C.primaryBg, borderRadius: 4, paddingHorizontal: 2 },

  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.surface2, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 3, borderWidth: 1, borderColor: C.border },
  reactionChipMine: { backgroundColor: C.primaryBg, borderColor: C.primary },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  addReactionBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 3, borderWidth: 1, borderColor: C.border },
  addReactionText: { fontSize: 12, color: C.textMuted },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  timeText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },
  timeTextMe: { color: 'rgba(255,255,255,0.6)' },
  readRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  readText: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
