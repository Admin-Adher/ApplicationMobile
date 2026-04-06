import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert,
  Modal, Platform, ActivityIndicator, Animated, KeyboardAvoidingView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useIncidents } from '@/context/IncidentsContext';
import { Message } from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { uploadPhoto } from '@/lib/storage';
import MessageBubble, { getAvatarColor } from '@/components/channel/MessageBubble';
import MembersModal from '@/components/channel/MembersModal';
import AttachItemModal, { LinkedItem, getLinkedItemIcon, getLinkedItemColor, getLinkedItemLabel } from '@/components/channel/AttachItemModal';

const REACTIONS = ['👍', '✅', '⚠️', '🔥', '💯', '❌'];

function formatTimestampLabel(timestamp: string): string {
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

function DateSeparator({ label }: { label: string }) {
  return (
    <View style={styles.dateSepWrap}>
      <View style={styles.dateSepLine} />
      <Text style={styles.dateSepText}>{label}</Text>
      <View style={styles.dateSepLine} />
    </View>
  );
}

function TypingIndicator({ users }: { users: string[] }) {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (users.length === 0) return;
    function animateDot(dot: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: -5, duration: 280, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 280, useNativeDriver: true }),
          Animated.delay(300),
        ])
      );
    }
    const a1 = animateDot(dot1, 0);
    const a2 = animateDot(dot2, 140);
    const a3 = animateDot(dot3, 280);
    a1.start(); a2.start(); a3.start();
    return () => {
      a1.stop(); a2.stop(); a3.stop();
      dot1.setValue(0); dot2.setValue(0); dot3.setValue(0);
    };
  }, [users.length]);

  if (users.length === 0) return null;
  const label = users.length === 1
    ? `${users[0]} est en train d'écrire`
    : `${users.join(', ')} écrivent`;

  return (
    <View style={styles.typingRow}>
      <View style={styles.typingDots}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View key={i} style={[styles.typingDot, { transform: [{ translateY: dot }] }]} />
        ))}
      </View>
      <Text style={styles.typingText}>{label}…</Text>
    </View>
  );
}

type ListItem = Message | { _type: 'date'; label: string; key: string };

export default function ChannelScreen() {
  const insets = useSafeAreaInsets();
  const {
    id: channelId, name: channelName, color: channelColor, icon: channelIcon,
    isDM, isGroup, members: membersParam,
    linkedReserveId: paramLinkedReserveId, linkedReserveTitle: paramLinkedReserveTitle,
  } = useLocalSearchParams<{
    id: string; name: string; color: string; icon: string; isDM?: string; isGroup?: string; members?: string;
    linkedReserveId?: string; linkedReserveTitle?: string;
  }>();
  const isDMChannel = isDM === '1';
  const isGroupChannel = isGroup === '1';
  const router = useRouter();
  const {
    messages, addMessage, deleteMessage, updateMessage, toggleReaction, setChannelRead, setActiveChannelId,
    channels, removeCustomChannel, removeGroupChannel, renameChannel,
    addChannelMember, removeChannelMember, profiles, channelMembersOverride,
    reserves, sitePlans, tasks, visites, oprs, fetchOlderMessages, fetchChannelMessages,
  } = useApp();
  const { incidents } = useIncidents();
  const { user } = useAuth();
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  const channelObj = channels.find(c => c.id === channelId);
  const color = channelColor ?? channelObj?.color ?? C.primary;
  const liveChannelName = channelObj?.name ?? channelName ?? 'Canal';
  const baseMembers: string[] = channelObj?.members ?? (membersParam ? membersParam.split(',').filter(Boolean) : []);
  const overrideMembers: string[] = channelId ? (channelMembersOverride[channelId] ?? []) : [];
  const liveMembers: string[] = useMemo(() => {
    const merged = [...baseMembers];
    overrideMembers.forEach(m => { if (!merged.includes(m)) merged.push(m); });
    // Le créateur doit toujours apparaître dans la liste des membres
    const creator = channelObj?.createdBy;
    if (creator && !merged.includes(creator)) merged.push(creator);
    return merged;
  }, [baseMembers.join(','), overrideMembers.join(','), channelObj?.createdBy]);
  const isCompanyChannel = channelObj?.type === 'company' || (channelId?.startsWith('company-') ?? false);
  const isEditable = channelObj?.type === 'custom' || channelObj?.type === 'group';
  const canDelete = channelObj?.type === 'custom' || channelObj?.type === 'group';
  const isCreator = !!channelObj?.createdBy && channelObj.createdBy === user?.name;

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [linkedItem, setLinkedItem] = useState<LinkedItem | null>(
    paramLinkedReserveId
      ? { type: 'reserve', id: paramLinkedReserveId, title: paramLinkedReserveTitle ?? paramLinkedReserveId }
      : null
  );
  const [attachItemVisible, setAttachItemVisible] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null);
  const [actionModalVisible, setActionModalVisible] = useState(false);
  const [emojiModalVisible, setEmojiModalVisible] = useState(false);
  const [pinnedModalVisible, setPinnedModalVisible] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [membersVisible, setMembersVisible] = useState(false);
  const [addMemberVisible, setAddMemberVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  // P16: pagination locale — affiche les N messages les plus récents
  // L'utilisateur peut charger les suivants en scrollant vers le haut
  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isFetchingOlder, setIsFetchingOlder] = useState(false);
  const [hasMoreOnServer, setHasMoreOnServer] = useState(true);
  const typingTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingBroadcastRef = useRef<number>(0);

  useEffect(() => {
    setChannelRead(channelId!);
    setActiveChannelId(channelId!);
    if (!isSupabaseConfigured) {
      return () => { setActiveChannelId(null); };
    }
    const typingCh = supabase.channel(`typing:${channelId}`);
    typingCh.on('broadcast', { event: 'typing' }, ({ payload }: { payload: Record<string, unknown> }) => {
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
      supabase.removeChannel(typingCh);
      setActiveChannelId(null);
      Object.values(typingTimeouts.current).forEach(clearTimeout);
      typingTimeouts.current = {};
    };
  }, [channelId]);

  useEffect(() => {
    if (channelId) fetchChannelMessages(channelId);
  }, [channelId]);

  // Réinitialiser la pagination quand on change de canal
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setIsFetchingOlder(false);
    setHasMoreOnServer(true);
  }, [channelId]);

  // Fix 1: ref déclaré ici, reset quand on change de canal
  const prevChannelMsgCountRef = useRef(0);
  useEffect(() => {
    prevChannelMsgCountRef.current = 0;
  }, [channelId]);

  const channelMessages = useMemo(() =>
    messages.filter(m => m.channelId === channelId),
    [messages, channelId]
  );

  // Fix 1: auto-marquer comme lu quand de nouveaux messages arrivent pendant que le canal est ouvert
  // (setChannelRead au mount seul ne couvre pas les messages entrants en temps réel)
  // Aussi déclenché au chargement initial du canal (lazy-load) pour que mark_messages_read_by
  // soit appelé avec les vrais IDs de messages.
  useEffect(() => {
    if (channelMessages.length > prevChannelMsgCountRef.current) {
      setChannelRead(channelId!);
    }
    prevChannelMsgCountRef.current = channelMessages.length;
  }, [channelMessages.length]);

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return channelMessages;
    const q = searchQuery.toLowerCase();
    return channelMessages.filter(m =>
      m.content.toLowerCase().includes(q) ||
      m.sender.toLowerCase().includes(q) ||
      (m.linkedItemTitle ?? '').toLowerCase().includes(q)
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
        items.push({ _type: 'date', label: formatTimestampLabel(msg.timestamp), key: `date-${msgDate}` });
        lastDate = msgDate;
      }
      items.push(msg);
    }
    return [...items].reverse();
  }, [filteredMessages]);

  // Fix 2 — Pagination serveur : oldest dbCreatedAt parmi les messages chargés
  const oldestDbCreatedAt = useMemo(() => {
    const withTs = channelMessages.filter(m => m.dbCreatedAt);
    if (!withTs.length) return null;
    return withTs.reduce<string>((oldest, m) =>
      m.dbCreatedAt! < oldest ? m.dbCreatedAt! : oldest,
      withTs[0].dbCreatedAt!
    );
  }, [channelMessages]);

  // P16: Pagination locale — slice les N items les plus récents
  // FlatList est inversée : index 0 = bas (le plus récent), dernier index = haut (le plus ancien)
  // Donc slice(0, visibleCount) = les N plus récents, affiché au bas
  const LOAD_MORE_SENTINEL_KEY = '__load_more__';
  const SEARCH_RESULT_CAP = 100;
  const paginatedListItems = useMemo((): (ListItem | { _type: 'load_more'; key: string })[] => {
    if (searchQuery.trim()) return listItems.slice(0, SEARCH_RESULT_CAP); // cap pendant la recherche
    const visible = listItems.slice(0, visibleCount);
    const hasMoreLocally = listItems.length > visibleCount;
    const showLoadMore = hasMoreLocally || hasMoreOnServer;
    if (showLoadMore) {
      return [...visible, { _type: 'load_more' as const, key: LOAD_MORE_SENTINEL_KEY }];
    }
    return visible;
  }, [listItems, visibleCount, searchQuery, hasMoreOnServer]);

  const knownSenders = useMemo(() => {
    const senders = new Set<string>();
    channelMessages.forEach(m => { if (!m.isMe) senders.add(m.sender); });
    return Array.from(senders);
  }, [channelMessages]);

  const allMentionNames = useMemo(() => {
    const names = new Set<string>();
    profiles.forEach(p => names.add(p.name));
    knownSenders.forEach(s => names.add(s));
    if (user?.name) names.delete(user.name);
    return Array.from(names);
  }, [profiles, knownSenders, user]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.toLowerCase();
    return allMentionNames.filter(s => s.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, allMentionNames]);

  // ── Build AttachItemModal data lists ──
  const reserveItems: LinkedItem[] = useMemo(() =>
    (reserves ?? []).map(r => ({ type: 'reserve' as const, id: r.id, title: r.title, subtitle: r.building ? `${r.building}${r.level ? ' · ' + r.level : ''}` : undefined })),
    [reserves]
  );
  const planItems: LinkedItem[] = useMemo(() =>
    (sitePlans ?? []).map(p => ({ type: 'plan' as const, id: p.id, title: p.name, subtitle: p.building ?? undefined })),
    [sitePlans]
  );
  const taskItems: LinkedItem[] = useMemo(() =>
    (tasks ?? []).map(t => ({ type: 'task' as const, id: t.id, title: t.title, subtitle: t.assignee ?? undefined })),
    [tasks]
  );
  const incidentItems: LinkedItem[] = useMemo(() =>
    (incidents ?? []).map(i => ({ type: 'incident' as const, id: i.id, title: i.title, subtitle: i.location ?? undefined })),
    [incidents]
  );
  const visiteItems: LinkedItem[] = useMemo(() =>
    (visites ?? []).map(v => ({ type: 'visite' as const, id: v.id, title: v.title, subtitle: v.date })),
    [visites]
  );
  const oprItems: LinkedItem[] = useMemo(() =>
    (oprs ?? []).map(o => ({ type: 'opr' as const, id: o.id, title: o.title, subtitle: o.date })),
    [oprs]
  );

  function handleTextChange(val: string) {
    setText(val);
    const atMatch = val.match(/@([^@\s]*)$/);
    setMentionQuery(atMatch ? atMatch[1] : '');
    const now = Date.now();
    if (now - lastTypingBroadcastRef.current >= 1000) {
      lastTypingBroadcastRef.current = now;
      typingChannelRef.current?.send({
        type: 'broadcast', event: 'typing',
        payload: { userName: user?.name ?? 'Utilisateur' },
      }).catch(() => {});
    }
  }

  function insertMention(senderName: string) {
    const updated = text.replace(/@([^@\s]*)$/, `@${senderName} `);
    setText(updated);
    setMentionQuery('');
    inputRef.current?.focus();
  }

  async function handlePickPhoto() {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à la galerie est nécessaire."); return; }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setAttachmentUploading(true);
      try {
        const url = await uploadPhoto(result.assets[0].uri, `msg_${Date.now()}.jpg`);
        if (!url) {
          Alert.alert('Erreur d\'envoi', "La photo n'a pas pu être envoyée sur le serveur. Vérifiez votre connexion et que le stockage est configuré.");
          return;
        }
        addMessage(channelId!, text.trim() || '', {
          attachmentUri: url,
          replyToId: replyTo?.id, replyToContent: replyTo?.content, replyToSender: replyTo?.sender,
        }, user?.name ?? 'Moi');
        setText(''); setReplyTo(null);
      } finally { setAttachmentUploading(false); }
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
        if (!url) {
          Alert.alert('Erreur d\'envoi', "La photo n'a pas pu être envoyée sur le serveur. Vérifiez votre connexion et que le stockage est configuré.");
          return;
        }
        addMessage(channelId!, text.trim() || '', {
          attachmentUri: url,
          replyToId: replyTo?.id, replyToContent: replyTo?.content, replyToSender: replyTo?.sender,
        }, user?.name ?? 'Moi');
        setText(''); setReplyTo(null);
      } finally { setAttachmentUploading(false); }
    }
  }

  function handleSend() {
    if (!text.trim() && !linkedItem) return;
    // P1: utiliser [^\s@]+ pour capturer les noms accentués et composés (ex. @Jean-Paul)
    const mentions = (text.match(/@[^\s@]+/g) ?? []).map(m => m.slice(1));
    addMessage(channelId!, text.trim(), {
      replyToId: replyTo?.id, replyToContent: replyTo?.content,
      replyToSender: replyTo?.sender, mentions,
      reserveId: linkedItem?.type === 'reserve' ? linkedItem.id : undefined,
      linkedItemType: linkedItem?.type,
      linkedItemId: linkedItem?.id,
      linkedItemTitle: linkedItem?.title,
    }, user?.name ?? 'Moi');
    setText(''); setReplyTo(null); setMentionQuery(''); setLinkedItem(null);
  }

  // P13: useCallback avec [] car n'utilise que des setters stables
  const openActions = useCallback((msg: Message) => {
    setSelectedMsg(msg);
    setActionModalVisible(true);
  }, []);

  function handleReply() {
    setActionModalVisible(false);
    setReplyTo(selectedMsg);
    inputRef.current?.focus();
  }

  async function handleCopy() {
    setActionModalVisible(false);
    await Clipboard.setStringAsync(selectedMsg?.content ?? '');
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

  function handleCreateReserveFromMsg() {
    setActionModalVisible(false);
    if (!selectedMsg) return;
    router.push({
      pathname: '/reserve/new',
      params: {
        prefill_description: selectedMsg.content,
        prefill_source: `Message de ${selectedMsg.sender} dans ${liveChannelName}`,
      },
    } as any);
  }

  function openReactPicker() {
    setActionModalVisible(false);
    setEmojiModalVisible(true);
  }

  function handleReact(emoji: string) {
    setEmojiModalVisible(false);
    if (!selectedMsg) return;
    applyReact(emoji, selectedMsg);
  }

  function applyReact(emoji: string, msg: Message) {
    const userName = user?.name ?? 'Moi';
    toggleReaction(emoji, msg, userName);
  }

  // P13: useCallback stable (router est stable dans expo-router)
  const handleNotifPress = useCallback((msg: Message) => {
    if (msg.reserveId) {
      router.push(`/reserve/${msg.reserveId}` as any);
    }
  }, [router]);

  const handleLinkedItemPress = useCallback((msg: Message) => {
    const type = msg.linkedItemType;
    const id = msg.linkedItemId;
    if (!type || !id) {
      handleNotifPress(msg);
      return;
    }
    switch (type) {
      case 'reserve': router.push(`/reserve/${id}` as any); break;
      case 'plan': {
        const plan = sitePlans.find(p => p.id === id);
        if (plan?.chantierId) router.push({ pathname: '/chantier/[id]', params: { id: plan.chantierId, tab: 'plans' } } as any);
        break;
      }
      case 'task': router.push(`/task/${id}` as any); break;
      case 'incident': router.push(`/incident/${id}` as any); break;
      case 'visite': router.push(`/visite/${id}` as any); break;
      case 'opr': router.push(`/opr/${id}` as any); break;
      default: break;
    }
  }, [router, handleNotifPress, sitePlans]);

  // P13: ref trick — applyReact est mis à jour chaque render dans le ref
  // pour que renderItem utilise toujours la version la plus récente
  const applyReactRef = useRef(applyReact);
  applyReactRef.current = applyReact;

  // Fix 2 — Pagination serveur : refs stables pour éviter les closures stale dans renderItem
  const isFetchingOlderRef = useRef(isFetchingOlder);
  isFetchingOlderRef.current = isFetchingOlder;
  const hasMoreOnServerStateRef = useRef(hasMoreOnServer);
  hasMoreOnServerStateRef.current = hasMoreOnServer;
  const oldestDbCreatedAtRef = useRef(oldestDbCreatedAt);
  oldestDbCreatedAtRef.current = oldestDbCreatedAt;
  const listItemsRef = useRef(listItems);
  listItemsRef.current = listItems;
  const visibleCountRef = useRef(visibleCount);
  visibleCountRef.current = visibleCount;
  const fetchOlderMessagesRef = useRef(fetchOlderMessages);
  fetchOlderMessagesRef.current = fetchOlderMessages;

  const handleLoadMoreRef = useRef<() => Promise<void>>(async () => {});
  handleLoadMoreRef.current = async () => {
    const hasMoreLocally = listItemsRef.current.length > visibleCountRef.current;
    if (hasMoreLocally) {
      setVisibleCount(prev => prev + PAGE_SIZE);
      return;
    }
    if (!hasMoreOnServerStateRef.current || isFetchingOlderRef.current || !oldestDbCreatedAtRef.current) return;
    setIsFetchingOlder(true);
    try {
      const hasMore = await fetchOlderMessagesRef.current(channelId!, oldestDbCreatedAtRef.current);
      setHasMoreOnServer(hasMore);
      setVisibleCount(prev => prev + PAGE_SIZE);
    } finally {
      setIsFetchingOlder(false);
    }
  };

  const renderItem = useCallback(({ item }: { item: ListItem | { _type: 'load_more'; key: string } }) => {
    if ('_type' in item && item._type === 'date') {
      return <DateSeparator label={(item as any).label} />;
    }
    // P16: bouton "Charger les messages précédents" au sommet de la FlatList inversée
    if ('_type' in item && item._type === 'load_more') {
      return (
        <View style={{ transform: [{ scaleX: -1 }, { scaleY: -1 }], alignItems: 'center', paddingVertical: 12 }}>
          <TouchableOpacity
            onPress={() => handleLoadMoreRef.current()}
            disabled={isFetchingOlderRef.current}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, opacity: isFetchingOlderRef.current ? 0.5 : 1 }}
          >
            <Ionicons name={isFetchingOlderRef.current ? 'hourglass-outline' : 'arrow-up-circle-outline'} size={16} color={C.textMuted} />
            <Text style={{ fontSize: 13, color: C.textMuted }}>
              {isFetchingOlderRef.current ? 'Chargement…' : 'Voir les messages précédents'}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    const msg = item as Message;
    return (
      <MessageBubble
        msg={msg}
        color={color}
        userName={user?.name ?? ''}
        onLongPress={() => openActions(msg)}
        onNotifPress={handleNotifPress}
        onLinkedItemPress={handleLinkedItemPress}
        onReactInline={(emoji, m) => applyReactRef.current(emoji, m)}
        onOpenReactPicker={(m) => { setSelectedMsg(m); setEmojiModalVisible(true); }}
      />
    );
    // P13: openActions, handleNotifPress, handleLinkedItemPress sont stables (useCallback [])
    // applyReact passe par applyReactRef pour éviter les closures stale
  }, [color, user?.name, channelId, sitePlans, openActions, handleNotifPress, handleLinkedItemPress]);

  const lastPinned = pinnedMessages[pinnedMessages.length - 1];

  const itemColor = linkedItem ? getLinkedItemColor(linkedItem.type) : C.primary;
  const itemIcon = linkedItem ? getLinkedItemIcon(linkedItem.type) : 'link-outline';
  const itemLabel = linkedItem ? getLinkedItemLabel(linkedItem.type) : '';

  return (
    <View style={styles.container}>
      {/* ── HEADER ── */}
      <View style={[styles.header, { paddingTop: Platform.OS === 'web' ? 16 : insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </TouchableOpacity>
        {isDMChannel ? (
          <View style={[styles.headerIcon, { backgroundColor: color + '20' }]}>
            <Text style={[styles.headerIconText, { color }]}>{(channelName ?? '?').charAt(0).toUpperCase()}</Text>
          </View>
        ) : isGroupChannel ? (
          <View style={[styles.headerIcon, { backgroundColor: color + '20', overflow: 'hidden' }]}>
            <Ionicons name="people-circle" size={22} color={color} />
          </View>
        ) : (
          <View style={[styles.headerIcon, { backgroundColor: color + '20' }]}>
            <Ionicons name={(channelIcon ?? 'chatbubbles') as any} size={18} color={color} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName} numberOfLines={1}>{liveChannelName}</Text>
          {(isDMChannel || isGroupChannel) && liveMembers.length > 0 ? (
            <Text style={styles.headerSub} numberOfLines={1}>{liveMembers.length} membre{liveMembers.length !== 1 ? 's' : ''}</Text>
          ) : isCompanyChannel ? (
            // P11: Afficher le nombre de participants actifs pour les canaux entreprise
            <Text style={styles.headerSub} numberOfLines={1}>
              {knownSenders.length > 0
                ? `${knownSenders.length + 1} participant${knownSenders.length > 0 ? 's' : ''}`
                : 'Canal entreprise'}
            </Text>
          ) : (
            <Text style={styles.headerSub}>{channelMessages.length} message{channelMessages.length !== 1 ? 's' : ''}</Text>
          )}
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
            <Text style={styles.pinnedBannerContent} numberOfLines={1}>
              {lastPinned.content || lastPinned.linkedItemTitle || 'Photo'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={13} color={C.waiting} />
        </TouchableOpacity>
      )}

      {/* P12: 'padding' sur les deux plateformes.
           'height' sur Android rétrécit la vue et peut cacher la barre de saisie
           quand le clavier apparaît avec une FlatList inversée. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 8 : 0}
      >
        {/* P16: utiliser paginatedListItems pour limiter le nombre de messages rendus */}
        <FlatList
          ref={flatListRef}
          data={paginatedListItems}
          keyExtractor={item => ('_type' in item ? item.key : item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          inverted
          ListEmptyComponent={() => (
            <View style={[styles.empty, { transform: [{ scaleX: -1 }, { scaleY: -1 }] }]}>
              <View style={[styles.emptyIcon, { backgroundColor: color + '20' }]}>
                <Ionicons name={(channelIcon ?? 'chatbubbles') as any} size={32} color={color} />
              </View>
              <Text style={styles.emptyTitle}>{liveChannelName}</Text>
              <Text style={styles.emptyText}>Soyez le premier à envoyer un message dans ce canal.</Text>
            </View>
          )}
        />

        <TypingIndicator users={typingUsers} />

        {linkedItem && (
          <View style={[styles.replyBar2, { borderLeftWidth: 3, borderLeftColor: itemColor }]}>
            <Ionicons name={itemIcon as any} size={14} color={itemColor} style={{ marginRight: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.replyBarWho, { color: itemColor }]}>{itemLabel} lié(e)</Text>
              <Text style={styles.replyBarText} numberOfLines={1}>{linkedItem.title}</Text>
            </View>
            <TouchableOpacity onPress={() => setLinkedItem(null)} hitSlop={8}>
              <Ionicons name="close" size={18} color={C.textSub} />
            </TouchableOpacity>
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

        <View style={[styles.inputRow, { paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity style={styles.attachBtn} onPress={handleCamera} disabled={attachmentUploading}>
            <Ionicons name="camera-outline" size={20} color={C.textSub} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachBtn} onPress={handlePickPhoto} disabled={attachmentUploading}>
            {attachmentUploading
              ? <ActivityIndicator size="small" color={C.primary} />
              : <Ionicons name="image-outline" size={20} color={C.textSub} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.attachBtn, linkedItem && { backgroundColor: itemColor + '18', borderRadius: 18 }]}
            onPress={() => setAttachItemVisible(true)}
          >
            <Ionicons name="link-outline" size={20} color={linkedItem ? itemColor : C.textSub} />
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={replyTo ? 'Votre réponse...' : 'Message… (@ pour mentionner)'}
            placeholderTextColor={C.textMuted}
            value={text}
            onChangeText={handleTextChange}
            multiline
            maxLength={1000}
            onSubmitEditing={Platform.OS === 'web' ? handleSend : undefined}
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: (text.trim() || linkedItem) ? color : C.surface2 }]}
            onPress={handleSend}
            disabled={!text.trim() && !linkedItem}
          >
            <Ionicons name="send" size={18} color={(text.trim() || linkedItem) ? '#fff' : C.textMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── MODAL ATTACHER UN ÉLÉMENT ── */}
      <AttachItemModal
        visible={attachItemVisible}
        onClose={() => setAttachItemVisible(false)}
        onSelect={(item) => { setLinkedItem(item); inputRef.current?.focus(); }}
        reserves={reserveItems}
        plans={planItems}
        tasks={taskItems}
        incidents={incidentItems}
        visites={visiteItems}
        oprs={oprItems}
      />

      {/* ── MODAL ACTIONS ── */}
      <Modal visible={actionModalVisible} transparent animationType="slide" onRequestClose={() => setActionModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setActionModalVisible(false)}>
          <View style={[styles.actionSheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.actionSheetHandle} />
            {selectedMsg && (
              <View style={styles.actionPreview}>
                <Text style={styles.actionPreviewText} numberOfLines={2}>
                  {selectedMsg.content || selectedMsg.linkedItemTitle || 'Photo'}
                </Text>
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
            {(selectedMsg?.linkedItemType || selectedMsg?.reserveId) && (
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => { setActionModalVisible(false); if (selectedMsg) handleLinkedItemPress(selectedMsg); }}
              >
                <Ionicons
                  name={getLinkedItemIcon(selectedMsg?.linkedItemType ?? (selectedMsg?.reserveId ? 'reserve' : null)) as any}
                  size={20}
                  color={getLinkedItemColor(selectedMsg?.linkedItemType ?? (selectedMsg?.reserveId ? 'reserve' : null))}
                />
                <Text style={[styles.actionLabel, { color: getLinkedItemColor(selectedMsg?.linkedItemType ?? (selectedMsg?.reserveId ? 'reserve' : null)) }]}>
                  Voir {getLinkedItemLabel(selectedMsg?.linkedItemType ?? (selectedMsg?.reserveId ? 'reserve' : null))}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionItem} onPress={handlePin}>
              <Ionicons name={selectedMsg?.isPinned ? 'pin' : 'pin-outline'} size={20} color={C.waiting} />
              <Text style={[styles.actionLabel, { color: C.waiting }]}>{selectedMsg?.isPinned ? 'Désépingler' : 'Épingler'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionItem} onPress={handleCopy}>
              <Ionicons name="copy-outline" size={20} color={C.text} />
              <Text style={styles.actionLabel}>Copier le texte</Text>
            </TouchableOpacity>
            {/* P9: Créer réserve uniquement pour les messages texte (pas notifications/photos) */}
            {(!selectedMsg?.type || selectedMsg?.type === 'message') && (
              <TouchableOpacity style={styles.actionItem} onPress={handleCreateReserveFromMsg}>
                <Ionicons name="alert-circle-outline" size={20} color={C.waiting} />
                <Text style={[styles.actionLabel, { color: C.waiting }]}>Créer une réserve</Text>
              </TouchableOpacity>
            )}
            {/* P10: Suppression autorisée pour l'expéditeur OU les administrateurs */}
            {(selectedMsg?.isMe || user?.role === 'admin' || user?.role === 'super_admin') && (
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

      {/* ── MODAL EMOJI ── */}
      <Modal visible={emojiModalVisible} transparent animationType="fade" onRequestClose={() => setEmojiModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setEmojiModalVisible(false)}>
          <View style={[styles.emojiSheet, { paddingBottom: insets.bottom + 8 }]}>
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

      {/* ── MODAL ÉPINGLÉS ── */}
      <Modal visible={pinnedModalVisible} transparent animationType="slide" onRequestClose={() => setPinnedModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setPinnedModalVisible(false)}>
          <View style={[styles.actionSheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.actionSheetHandle} />
            <Text style={styles.pinnedSheetTitle}>Messages épinglés ({pinnedMessages.length})</Text>
            {pinnedMessages.map(m => (
              <View key={m.id} style={styles.pinnedItem}>
                <Ionicons name="pin" size={13} color={C.waiting} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pinnedItemWho}>{m.sender}</Text>
                  <Text style={styles.pinnedItemContent} numberOfLines={2}>
                    {m.content || m.linkedItemTitle || 'Photo'}
                  </Text>
                  <Text style={styles.pinnedItemTime}>{m.timestamp}</Text>
                </View>
                <TouchableOpacity onPress={() => updateMessage({ ...m, isPinned: false })}>
                  <Ionicons name="close" size={16} color={C.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
            {pinnedMessages.length === 0 && <Text style={styles.emptyText}>Aucun message épinglé.</Text>}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── MODAL MEMBRES (composant externe) ── */}
      <MembersModal
        visible={membersVisible}
        onClose={() => setMembersVisible(false)}
        channelId={channelId!}
        channelObj={channelObj}
        liveChannelName={liveChannelName}
        liveMembers={liveMembers}
        color={color}
        isDMChannel={isDMChannel}
        isGroupChannel={isGroupChannel}
        isEditable={isEditable}
        canDelete={canDelete}
        isCreator={isCreator}
        channelIcon={channelIcon ?? 'chatbubbles'}
        user={user}
        knownSenders={knownSenders}
        profiles={profiles}
        onRenamePress={() => { setRenameText(liveChannelName); setMembersVisible(false); setRenameVisible(true); }}
        onAddMemberPress={() => { if (!isCompanyChannel) setAddMemberVisible(true); }}
        removeChannelMember={removeChannelMember}
        removeCustomChannel={removeCustomChannel}
        removeGroupChannel={removeGroupChannel}
      />

      {/* ── MODAL RENOMMER ── */}
      <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => setRenameVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setRenameVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.renameSheet}>
            <Text style={styles.renameTitle}>
              Renommer {isGroupChannel ? 'le groupe' : 'le canal'}
            </Text>
            <TextInput
              style={styles.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="Nouveau nom..."
              placeholderTextColor={C.textMuted}
              autoFocus
              maxLength={50}
            />
            <View style={styles.renameBtns}>
              <TouchableOpacity style={styles.renameCancelBtn} onPress={() => setRenameVisible(false)}>
                <Text style={styles.renameCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.renameConfirmBtn, { backgroundColor: renameText.trim() ? color : C.surface2 }]}
                onPress={() => {
                  if (!renameText.trim()) return;
                  renameChannel(channelId!, renameText.trim());
                  setRenameVisible(false);
                }}
                disabled={!renameText.trim()}
              >
                <Text style={[styles.renameConfirmText, { color: renameText.trim() ? '#fff' : C.textMuted }]}>
                  Enregistrer
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── MODAL AJOUTER MEMBRE ── */}
      <Modal visible={addMemberVisible} transparent animationType="slide" onRequestClose={() => setAddMemberVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAddMemberVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.actionSheet, { maxHeight: '75%', paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.actionSheetHandle} />
            <Text style={styles.pinnedSheetTitle}>Ajouter un membre</Text>
            {profiles.filter(p => p.name !== user?.name && !liveMembers.includes(p.name)).length === 0 ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={styles.emptyText}>Tous les utilisateurs sont déjà membres</Text>
              </View>
            ) : profiles.filter(p => p.name !== user?.name && !liveMembers.includes(p.name)).map(p => (
              <TouchableOpacity
                key={p.id}
                style={styles.memberItem}
                onPress={() => { addChannelMember(channelId!, p.name); setAddMemberVisible(false); }}
              >
                <View style={[styles.memberAvatar, { backgroundColor: getAvatarColor(p.name) + '25' }]}>
                  <Text style={[styles.memberAvatarText, { color: getAvatarColor(p.name) }]}>{p.name.charAt(0)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{p.name}</Text>
                  <Text style={styles.memberSub}>{p.role}</Text>
                </View>
                <View style={[styles.addBadge, { backgroundColor: C.primary + '15' }]}>
                  <Ionicons name="add" size={12} color={C.primary} />
                  <Text style={[styles.addBadgeText, { color: C.primary }]}>Ajouter</Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.sheetCancelBtn} onPress={() => setAddMemberVisible(false)}>
              <Text style={styles.sheetCancelText}>Annuler</Text>
            </TouchableOpacity>
          </TouchableOpacity>
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
  headerIconText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
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
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  typingDots: { flexDirection: 'row', gap: 3 },
  typingDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.textMuted },
  typingText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic' },
  replyBar2: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  replyAccent: { width: 3, height: '100%', borderRadius: 2 },
  replyBarWho: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  replyBarText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  mentionDropdown: { backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, maxHeight: 180 },
  mentionItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  mentionAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  mentionAvatarText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  mentionName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.surface },
  attachBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, maxHeight: 100, backgroundColor: C.surface2, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', paddingHorizontal: 24 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', alignItems: 'center' },
  actionSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, width: '100%', maxWidth: 640 },
  actionSheetHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  actionPreview: { backgroundColor: C.surface2, borderRadius: 10, padding: 10, marginBottom: 12 },
  actionPreviewText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  actionItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  actionEmoji: { fontSize: 20, width: 24, textAlign: 'center' },
  actionLabel: { fontSize: 15, fontFamily: 'Inter_500Medium', color: C.text },
  actionCancel: { borderBottomWidth: 0, justifyContent: 'center' },
  actionCancelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.textSub, textAlign: 'center', flex: 1 },
  emojiSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, width: '100%', maxWidth: 640 },
  emojiTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 16, textAlign: 'center' },
  emojiRow: { flexDirection: 'row', justifyContent: 'space-around' },
  emojiBtn: { alignItems: 'center', gap: 4 },
  emojiChar: { fontSize: 28 },
  emojiReactCount: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  pinnedSheetTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 14 },
  pinnedItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  pinnedItemWho: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary, marginBottom: 2 },
  pinnedItemContent: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  pinnedItemTime: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  renameSheet: { backgroundColor: C.surface, borderRadius: 20, padding: 20, margin: 20, maxWidth: 480, alignSelf: 'center', width: '90%' },
  renameTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 14 },
  renameInput: { backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 16 },
  renameBtns: { flexDirection: 'row', gap: 10 },
  renameCancelBtn: { flex: 1, backgroundColor: C.surface2, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  renameCancelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  renameConfirmBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  renameConfirmText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  memberItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  memberName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  memberSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  addBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  addBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  sheetCancelBtn: { marginTop: 10, backgroundColor: C.surface2, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  sheetCancelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.textSub },
});
