import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert,
  Modal, Platform, Image, KeyboardAvoidingView, Clipboard, Linking,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { C } from '@/constants/colors';
import { useApp, toMessage } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Message } from '@/constants/types';
import { supabase } from '@/lib/supabase';
import { uploadPhoto } from '@/lib/storage';

const REACTIONS = ['👍', '✅', '⚠️', '🔥', '💯', '❌'];

function getAvatarColor(name: string): string {
  const COLORS = [C.primary, '#059669', '#D97706', '#7C3AED', '#DB2777', '#EA580C', '#0891B2', '#65A30D'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function formatDate(timestamp: string): string {
  const parts = timestamp.split(' ');
  if (parts.length < 2) return timestamp;
  const datePart = parts[0];
  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (datePart === today) return "Aujourd'hui";
  if (datePart === yesterday) return 'Hier';
  return datePart;
}

function getDateFromTimestamp(timestamp: string): string {
  return timestamp.split(' ')[0] ?? timestamp;
}

function detectMentions(text: string, name: string): boolean {
  return text.toLowerCase().includes(`@${name.toLowerCase().split(' ')[0]}`);
}

function MessageTextRender({ text, isMe }: { text: string; isMe: boolean }) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const mentionRegex = /@(\w+)/g;
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

function DateSeparator({ label }: { label: string }) {
  return (
    <View style={styles.dateSepWrap}>
      <View style={styles.dateSepLine} />
      <Text style={styles.dateSepText}>{label}</Text>
      <View style={styles.dateSepLine} />
    </View>
  );
}

type ListItem = Message | { _type: 'date'; label: string; key: string };

export default function ChannelScreen() {
  const { id: channelId, name: channelName, color: channelColor, icon: channelIcon } = useLocalSearchParams<{
    id: string; name: string; color: string; icon: string;
  }>();
  const router = useRouter();
  const { messages, addMessage, deleteMessage, updateMessage, incomingMessage, setChannelRead, channels } = useApp();
  const { user } = useAuth();
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null);
  const [actionModalVisible, setActionModalVisible] = useState(false);
  const [emojiModalVisible, setEmojiModalVisible] = useState(false);
  const [pinnedModalVisible, setPinnedModalVisible] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [membersVisible, setMembersVisible] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const typingTimeouts = useRef<Record<string, NodeJS.Timeout>>({});
  const typingChannelRef = useRef<any>(null);

  const channelObj = channels.find(c => c.id === channelId);
  const color = channelColor ?? channelObj?.color ?? C.primary;

  const channelMessages = useMemo(() =>
    messages.filter(m => m.channelId === channelId),
    [messages, channelId]
  );

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return channelMessages;
    const q = searchQuery.toLowerCase();
    return channelMessages.filter(m =>
      m.content.toLowerCase().includes(q) || m.sender.toLowerCase().includes(q)
    );
  }, [channelMessages, searchQuery]);

  const pinnedMessages = useMemo(() =>
    channelMessages.filter(m => m.isPinned),
    [channelMessages]
  );

  const listItems = useMemo((): ListItem[] => {
    const items: ListItem[] = [];
    let lastDate = '';
    for (const msg of filteredMessages) {
      const msgDate = getDateFromTimestamp(msg.timestamp);
      if (msgDate !== lastDate) {
        items.push({ _type: 'date', label: formatDate(msg.timestamp), key: `date-${msgDate}` });
        lastDate = msgDate;
      }
      items.push(msg);
    }
    return items;
  }, [filteredMessages]);

  const knownSenders = useMemo(() => {
    const senders = new Set<string>();
    channelMessages.forEach(m => { if (!m.isMe) senders.add(m.sender); });
    return Array.from(senders);
  }, [channelMessages]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.toLowerCase();
    return knownSenders.filter(s => s.toLowerCase().includes(q)).slice(0, 5);
  }, [mentionQuery, knownSenders]);

  useEffect(() => {
    setChannelRead(channelId!);

    const realtimeCh = supabase
      .channel(`channel-${channelId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const msg = toMessage(payload.new);
          if (!msg.isMe) incomingMessage(msg);
        }
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => { updateMessage(toMessage(payload.new)); }
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload) => { deleteMessage(payload.old.id); }
      )
      .subscribe();

    const typingCh = supabase.channel(`typing:${channelId}`);
    typingCh.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const name = payload.userName as string;
      if (name === user?.name) return;
      setTypingUsers(prev => prev.includes(name) ? prev : [...prev, name]);
      if (typingTimeouts.current[name]) clearTimeout(typingTimeouts.current[name]);
      typingTimeouts.current[name] = setTimeout(() => {
        setTypingUsers(prev => prev.filter(u => u !== name));
      }, 3000);
    }).subscribe();
    typingChannelRef.current = typingCh;

    return () => {
      supabase.removeChannel(realtimeCh);
      supabase.removeChannel(typingCh);
    };
  }, [channelId]);

  useEffect(() => {
    if (channelMessages.length > 0 && !searchMode) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 80);
    }
  }, [channelMessages.length]);

  function handleTextChange(val: string) {
    setText(val);
    const atMatch = val.match(/@(\w*)$/);
    setMentionQuery(atMatch ? atMatch[1] : '');
    typingChannelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userName: user?.name ?? 'Utilisateur' } }).catch(() => {});
  }

  function insertMention(senderName: string) {
    const updated = text.replace(/@(\w*)$/, `@${senderName.split(' ')[0]} `);
    setText(updated);
    setMentionQuery('');
    inputRef.current?.focus();
  }

  async function handlePickPhoto() {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à la galerie est nécessaire."); return; }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setAttachmentUploading(true);
      try {
        const url = await uploadPhoto(result.assets[0].uri, `msg_${Date.now()}.jpg`);
        addMessage(channelId!, text.trim() || '', { attachmentUri: url ?? result.assets[0].uri, replyToId: replyTo?.id, replyToContent: replyTo?.content, replyToSender: replyTo?.sender }, user?.name ?? 'Moi');
        setText('');
        setReplyTo(null);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      } finally {
        setAttachmentUploading(false);
      }
    }
  }

  async function handleCamera() {
    if (Platform.OS === 'web') { Alert.alert('Info', 'La caméra est disponible sur appareil mobile.'); return; }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à la caméra est nécessaire."); return; }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setAttachmentUploading(true);
      try {
        const url = await uploadPhoto(result.assets[0].uri, `msg_${Date.now()}.jpg`);
        addMessage(channelId!, text.trim() || '', { attachmentUri: url ?? result.assets[0].uri, replyToId: replyTo?.id, replyToContent: replyTo?.content, replyToSender: replyTo?.sender }, user?.name ?? 'Moi');
        setText('');
        setReplyTo(null);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      } finally {
        setAttachmentUploading(false);
      }
    }
  }

  function handleSend() {
    if (!text.trim() && !replyTo) return;
    const mentions = (text.match(/@\w+/g) ?? []).map(m => m.slice(1));
    addMessage(channelId!, text.trim(), {
      replyToId: replyTo?.id,
      replyToContent: replyTo?.content,
      replyToSender: replyTo?.sender,
      mentions,
    }, user?.name ?? 'Moi');
    setText('');
    setReplyTo(null);
    setMentionQuery('');
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }

  function openActions(msg: Message) {
    setSelectedMsg(msg);
    setActionModalVisible(true);
  }

  function handleReply() {
    setActionModalVisible(false);
    setReplyTo(selectedMsg);
    inputRef.current?.focus();
  }

  function handleCopy() {
    setActionModalVisible(false);
    Clipboard.setString(selectedMsg?.content ?? '');
    Alert.alert('Copié', 'Message copié dans le presse-papier.');
  }

  function handleDelete() {
    setActionModalVisible(false);
    Alert.alert('Supprimer ce message ?', 'Cette action est irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => { if (selectedMsg) deleteMessage(selectedMsg.id); } },
    ]);
  }

  function handlePin() {
    setActionModalVisible(false);
    if (!selectedMsg) return;
    updateMessage({ ...selectedMsg, isPinned: !selectedMsg.isPinned });
  }

  function openReactPicker() {
    setActionModalVisible(false);
    setEmojiModalVisible(true);
  }

  function handleReact(emoji: string) {
    setEmojiModalVisible(false);
    if (!selectedMsg) return;
    const userName = user?.name ?? 'Moi';
    const current = selectedMsg.reactions[emoji] ?? [];
    const updated = current.includes(userName)
      ? current.filter(u => u !== userName)
      : [...current, userName];
    const newReactions = { ...selectedMsg.reactions, [emoji]: updated };
    if (updated.length === 0) delete newReactions[emoji];
    updateMessage({ ...selectedMsg, reactions: newReactions });
  }

  function handleNotifPress(msg: Message) {
    if (msg.reserveId) {
      router.push(`/reserve/${msg.reserveId}` as any);
    }
  }

  function renderItem({ item }: { item: ListItem }) {
    if ('_type' in item && item._type === 'date') {
      return <DateSeparator label={item.label} />;
    }
    const msg = item as Message;

    if (msg.type === 'notification' || msg.type === 'system') {
      return (
        <TouchableOpacity style={styles.notifWrap} onPress={() => handleNotifPress(msg)} activeOpacity={msg.reserveId ? 0.7 : 1}>
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
    const isMentioned = detectMentions(msg.content, user?.name ?? '');
    const readCount = msg.readBy.filter(n => n !== (user?.name ?? 'Moi')).length;

    return (
      <TouchableOpacity
        style={[styles.bubbleWrap, msg.isMe && styles.bubbleWrapMe, isMentioned && !msg.isMe && styles.bubbleMentioned]}
        onLongPress={() => openActions(msg)}
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
          </View>

          {Object.keys(msg.reactions).length > 0 && (
            <View style={[styles.reactionsRow, msg.isMe && { justifyContent: 'flex-end' }]}>
              {Object.entries(msg.reactions).map(([emoji, users]) =>
                users.length > 0 ? (
                  <TouchableOpacity
                    key={emoji}
                    style={[styles.reactionChip, users.includes(user?.name ?? '') && styles.reactionChipMine]}
                    onPress={() => { setSelectedMsg(msg); handleReact(emoji); }}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                    <Text style={styles.reactionCount}>{users.length}</Text>
                  </TouchableOpacity>
                ) : null
              )}
              <TouchableOpacity
                style={styles.addReactionBtn}
                onPress={() => { setSelectedMsg(msg); setEmojiModalVisible(true); }}
              >
                <Text style={styles.addReactionText}>＋</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.metaRow, msg.isMe && { justifyContent: 'flex-end' }]}>
            <Text style={[styles.timeText, msg.isMe && styles.timeTextMe]}>
              {msg.timestamp.split(' ')[1] ?? msg.timestamp}
            </Text>
            {msg.isMe && readCount > 0 && (
              <View style={styles.readRow}>
                <Ionicons name="checkmark-done" size={11} color={C.closed} />
                <Text style={styles.readText}>Vu par {readCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  const lastPinned = pinnedMessages[pinnedMessages.length - 1];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'web' ? 16 : 52 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </TouchableOpacity>
        <View style={[styles.headerIcon, { backgroundColor: color + '20' }]}>
          <Ionicons name={(channelIcon ?? 'chatbubbles') as any} size={18} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName} numberOfLines={1}>{channelName ?? 'Canal'}</Text>
          <Text style={styles.headerSub}>{channelMessages.length} messages</Text>
        </View>
        <View style={styles.headerActions}>
          {pinnedMessages.length > 0 && (
            <TouchableOpacity style={styles.headerBtn} onPress={() => setPinnedModalVisible(true)}>
              <Ionicons name="pin" size={16} color={C.waiting} />
              <Text style={styles.headerBtnCount}>{pinnedMessages.length}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.headerBtn} onPress={() => { setSearchMode(!searchMode); setSearchQuery(''); }}>
            <Ionicons name={searchMode ? 'close' : 'search'} size={18} color={searchMode ? C.open : C.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setMembersVisible(true)}>
            <Ionicons name="people-outline" size={18} color={C.text} />
          </TouchableOpacity>
        </View>
      </View>

      {searchMode && (
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={14} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher dans les messages..."
            placeholderTextColor={C.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={14} color={C.textMuted} />
            </TouchableOpacity>
          )}
          <Text style={styles.searchCount}>{filteredMessages.length} résultat{filteredMessages.length !== 1 ? 's' : ''}</Text>
        </View>
      )}

      {lastPinned && !searchMode && (
        <TouchableOpacity style={styles.pinnedBanner} onPress={() => setPinnedModalVisible(true)}>
          <Ionicons name="pin" size={13} color={C.waiting} />
          <View style={{ flex: 1 }}>
            <Text style={styles.pinnedBannerLabel}>Message épinglé</Text>
            <Text style={styles.pinnedBannerContent} numberOfLines={1}>{lastPinned.content || 'Photo'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={13} color={C.waiting} />
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <FlatList
          ref={flatListRef}
          data={listItems}
          keyExtractor={item => ('_type' in item ? item.key : item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => { if (!searchMode) flatListRef.current?.scrollToEnd({ animated: false }); }}
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: color + '20' }]}>
                <Ionicons name={(channelIcon ?? 'chatbubbles') as any} size={32} color={color} />
              </View>
              <Text style={styles.emptyTitle}>{channelName}</Text>
              <Text style={styles.emptyText}>Soyez le premier à envoyer un message dans ce canal.</Text>
            </View>
          )}
        />

        {typingUsers.length > 0 && (
          <View style={styles.typingRow}>
            <View style={styles.typingDots}>
              {[0, 1, 2].map(i => <View key={i} style={[styles.typingDot, { opacity: 0.4 + i * 0.2 }]} />)}
            </View>
            <Text style={styles.typingText}>
              {typingUsers.join(', ')} est en train d'écrire...
            </Text>
          </View>
        )}

        {replyTo && (
          <View style={styles.replyBar2}>
            <View style={[styles.replyAccent, { backgroundColor: color }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.replyBarWho, { color }]}>Réponse à {replyTo.sender}</Text>
              <Text style={styles.replyBarText} numberOfLines={1}>{replyTo.content || 'Photo'}</Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}>
              <Ionicons name="close" size={18} color={C.textSub} />
            </TouchableOpacity>
          </View>
        )}

        {mentionSuggestions.length > 0 && (
          <View style={styles.mentionDropdown}>
            {mentionSuggestions.map(s => (
              <TouchableOpacity key={s} style={styles.mentionItem} onPress={() => insertMention(s)}>
                <View style={[styles.mentionAvatar, { backgroundColor: getAvatarColor(s) + '25' }]}>
                  <Text style={[styles.mentionAvatarText, { color: getAvatarColor(s) }]}>{s.charAt(0)}</Text>
                </View>
                <Text style={styles.mentionName}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.attachBtn} onPress={handleCamera} disabled={attachmentUploading}>
            <Ionicons name="camera-outline" size={20} color={C.textSub} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachBtn} onPress={handlePickPhoto} disabled={attachmentUploading}>
            {attachmentUploading
              ? <ActivityIndicator size="small" color={C.primary} />
              : <Ionicons name="image-outline" size={20} color={C.textSub} />}
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={replyTo ? 'Votre réponse...' : 'Message... (@ pour mentionner)'}
            placeholderTextColor={C.textMuted}
            value={text}
            onChangeText={handleTextChange}
            multiline
            maxLength={1000}
            onSubmitEditing={Platform.OS === 'web' ? handleSend : undefined}
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: (text.trim() || replyTo) ? color : C.surface2 }]}
            onPress={handleSend}
            disabled={!text.trim() && !replyTo}
          >
            <Ionicons name="send" size={18} color={(text.trim() || replyTo) ? '#fff' : C.textMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={actionModalVisible} transparent animationType="slide" onRequestClose={() => setActionModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setActionModalVisible(false)}>
          <View style={styles.actionSheet}>
            <View style={styles.actionSheetHandle} />
            {selectedMsg && (
              <View style={styles.actionPreview}>
                <Text style={styles.actionPreviewText} numberOfLines={2}>{selectedMsg.content || 'Photo'}</Text>
              </View>
            )}
            <TouchableOpacity style={styles.actionItem} onPress={openReactPicker}>
              <Text style={styles.actionEmoji}>😀</Text>
              <Text style={styles.actionLabel}>Réagir</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionItem} onPress={handleReply}>
              <Ionicons name="return-down-back-outline" size={20} color={C.text} />
              <Text style={styles.actionLabel}>Répondre</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionItem} onPress={handlePin}>
              <Ionicons name={selectedMsg?.isPinned ? 'pin' : 'pin-outline'} size={20} color={C.waiting} />
              <Text style={[styles.actionLabel, { color: C.waiting }]}>{selectedMsg?.isPinned ? 'Désépingler' : 'Épingler'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionItem} onPress={handleCopy}>
              <Ionicons name="copy-outline" size={20} color={C.text} />
              <Text style={styles.actionLabel}>Copier le texte</Text>
            </TouchableOpacity>
            {selectedMsg?.isMe && (
              <TouchableOpacity style={styles.actionItem} onPress={handleDelete}>
                <Ionicons name="trash-outline" size={20} color={C.open} />
                <Text style={[styles.actionLabel, { color: C.open }]}>Supprimer</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.actionItem, styles.actionCancel]} onPress={() => setActionModalVisible(false)}>
              <Text style={styles.actionCancelText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={emojiModalVisible} transparent animationType="fade" onRequestClose={() => setEmojiModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setEmojiModalVisible(false)}>
          <View style={styles.emojiSheet}>
            <Text style={styles.emojiTitle}>Réagir au message</Text>
            <View style={styles.emojiRow}>
              {REACTIONS.map(emoji => (
                <TouchableOpacity key={emoji} style={styles.emojiBtn} onPress={() => handleReact(emoji)}>
                  <Text style={styles.emojiChar}>{emoji}</Text>
                  {selectedMsg?.reactions[emoji]?.length ? (
                    <Text style={styles.emojiReactCount}>{selectedMsg.reactions[emoji].length}</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={pinnedModalVisible} transparent animationType="slide" onRequestClose={() => setPinnedModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setPinnedModalVisible(false)}>
          <View style={styles.actionSheet}>
            <View style={styles.actionSheetHandle} />
            <Text style={styles.pinnedSheetTitle}>Messages épinglés ({pinnedMessages.length})</Text>
            {pinnedMessages.map(m => (
              <View key={m.id} style={styles.pinnedItem}>
                <Ionicons name="pin" size={13} color={C.waiting} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pinnedItemWho}>{m.sender}</Text>
                  <Text style={styles.pinnedItemContent} numberOfLines={2}>{m.content || 'Photo'}</Text>
                  <Text style={styles.pinnedItemTime}>{m.timestamp}</Text>
                </View>
                <TouchableOpacity onPress={() => { updateMessage({ ...m, isPinned: false }); }}>
                  <Ionicons name="close" size={16} color={C.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
            {pinnedMessages.length === 0 && <Text style={styles.emptyText}>Aucun message épinglé.</Text>}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={membersVisible} transparent animationType="slide" onRequestClose={() => setMembersVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setMembersVisible(false)}>
          <View style={styles.actionSheet}>
            <View style={styles.actionSheetHandle} />
            <Text style={styles.pinnedSheetTitle}>Membres actifs</Text>
            {[user?.name ?? 'Moi', ...knownSenders].filter((v, i, a) => a.indexOf(v) === i).map(name => (
              <View key={name} style={styles.memberItem}>
                <View style={[styles.memberAvatar, { backgroundColor: getAvatarColor(name) + '25' }]}>
                  <Text style={[styles.memberAvatarText, { color: getAvatarColor(name) }]}>{name.charAt(0)}</Text>
                </View>
                <Text style={styles.memberName}>{name}</Text>
                {name === user?.name && <View style={styles.meBadge}><Text style={styles.meBadgeText}>Vous</Text></View>}
              </View>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  headerSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 2 },
  headerBtnCount: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.waiting },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  searchCount: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  pinnedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.waitingBg, borderBottomWidth: 1, borderBottomColor: 'rgba(217,119,6,0.2)' },
  pinnedBannerLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.waiting, textTransform: 'uppercase', letterSpacing: 0.5 },
  pinnedBannerContent: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.text },
  list: { padding: 14, paddingBottom: 8 },
  dateSepWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  dateSepLine: { flex: 1, height: 1, backgroundColor: C.border },
  dateSepText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted },
  bubbleWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 12 },
  bubbleWrapMe: { justifyContent: 'flex-end' },
  bubbleMentioned: { backgroundColor: C.primaryBg, borderRadius: 12, padding: 4, marginLeft: -4 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  senderName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 3, marginLeft: 2 },
  replyPreview: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: C.surface2, borderRadius: 8, marginBottom: 4, overflow: 'hidden', maxWidth: '100%' },
  replyPreviewMe: { backgroundColor: 'rgba(255,255,255,0.2)' },
  replyBar: { width: 3 },
  replyWho: { fontSize: 11, fontFamily: 'Inter_600SemiBold', padding: 4, paddingBottom: 1 },
  replyText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, paddingHorizontal: 4, paddingBottom: 4 },
  bubble: { borderRadius: 16, padding: 10, overflow: 'hidden' },
  bubbleThem: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  bubbleMe: { borderBottomRightRadius: 4 },
  bubblePinned: { borderWidth: 1.5, borderColor: C.waiting + '60' },
  pinBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 4 },
  pinBadgeText: { fontSize: 9, fontFamily: 'Inter_600SemiBold', color: C.waiting, textTransform: 'uppercase', letterSpacing: 0.4 },
  attachment: { width: 220, height: 160, borderRadius: 10, marginBottom: 6 },
  msgText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20 },
  msgTextMe: { color: '#fff' },
  msgLink: { textDecorationLine: 'underline', color: C.primary },
  msgMention: { color: C.primary, fontFamily: 'Inter_600SemiBold', backgroundColor: C.primaryBg, borderRadius: 4, paddingHorizontal: 2 },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.border },
  reactionChipMine: { backgroundColor: C.primaryBg, borderColor: C.primary },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  addReactionBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  addReactionText: { fontSize: 13, color: C.textSub },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, marginLeft: 2 },
  timeText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },
  timeTextMe: { textAlign: 'right' },
  readRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  readText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.closed },
  notifWrap: { alignItems: 'center', marginVertical: 8 },
  notifBubble: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.inProgressBg, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  notifText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress, maxWidth: 260 },
  notifTime: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  typingDots: { flexDirection: 'row', gap: 3 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.textMuted },
  typingText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic' },
  replyBar2: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  replyAccent: { width: 3, height: '100%', borderRadius: 2, alignSelf: 'stretch' },
  replyBarWho: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  replyBarText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  mentionDropdown: { backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  mentionItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  mentionAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  mentionAvatarText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  mentionName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.surface, paddingBottom: Platform.OS === 'web' ? 32 : 10 },
  attachBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, backgroundColor: C.surface2, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14, borderWidth: 1, borderColor: C.border, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', paddingHorizontal: 32 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  actionSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: Platform.OS === 'web' ? 24 : 34, paddingHorizontal: 16, paddingTop: 12 },
  actionSheetHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  actionPreview: { backgroundColor: C.surface2, borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  actionPreviewText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, fontStyle: 'italic' },
  actionItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  actionEmoji: { fontSize: 20, width: 22, textAlign: 'center' },
  actionLabel: { fontSize: 16, fontFamily: 'Inter_400Regular', color: C.text },
  actionCancel: { justifyContent: 'center', borderBottomWidth: 0, marginTop: 4 },
  actionCancelText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.textSub, textAlign: 'center', width: '100%' },
  emojiSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 },
  emojiTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 16, textAlign: 'center' },
  emojiRow: { flexDirection: 'row', justifyContent: 'space-around' },
  emojiBtn: { alignItems: 'center', gap: 4 },
  emojiChar: { fontSize: 32 },
  emojiReactCount: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.primary },
  pinnedSheetTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 12 },
  pinnedItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  pinnedItemWho: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary, marginBottom: 2 },
  pinnedItemContent: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  pinnedItemTime: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  memberItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  memberName: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  meBadge: { backgroundColor: C.primaryBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  meBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
});
