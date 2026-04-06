import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Channel, Message, Profile } from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import NewDMModal from '@/components/NewDMModal';
import NewGroupModal from '@/components/NewGroupModal';

// ─── Types locaux ────────────────────────────────────────────────────────────

interface OrgSummary {
  id: string;
  name: string;
  slug?: string;
}

interface OrgChannel {
  id: string;
  name: string;
  description: string;
  type: 'general' | 'building' | 'company' | 'custom' | 'group' | 'dm';
  icon: string;
  color: string;
  organization_id: string;
  members?: string[];
}

type Tab = 'mine' | 'orgs' | 'announce';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const TYPE_ICONS: Record<string, { icon: string; color: string; label: string }> = {
  general:  { icon: 'megaphone',        color: '#003082', label: 'Général' },
  building: { icon: 'business',         color: '#059669', label: 'Bâtiment' },
  company:  { icon: 'briefcase',        color: '#D97706', label: 'Entreprise' },
  custom:   { icon: 'bookmark',         color: '#7C3AED', label: 'Personnalisé' },
  group:    { icon: 'people',           color: '#0891B2', label: 'Groupe' },
  dm:       { icon: 'person-circle',    color: '#DB2777', label: 'DM' },
};

// ─── Mini composants ─────────────────────────────────────────────────────────

function ChannelAvatar({ channel, size = 46 }: { channel: Channel | OrgChannel; size?: number }) {
  const isDM = channel.type === 'dm';
  const isGroup = channel.type === 'group';
  const radius = size / 2;

  if (isDM) {
    const color = getAvatarColor(channel.name);
    return (
      <View style={[styles.dmAvatar, { backgroundColor: color + '25', width: size, height: size, borderRadius: radius }]}>
        <Text style={[styles.dmAvatarText, { color, fontSize: size * 0.43 }]}>{channel.name.charAt(0).toUpperCase()}</Text>
      </View>
    );
  }
  if (isGroup) {
    const members: string[] = channel.members ?? [];
    const firstTwo = members.slice(0, 2);
    return (
      <View style={[styles.groupAvatar, { backgroundColor: channel.color + '18', width: size, height: size, borderRadius: size * 0.3 }]}>
        <View style={[styles.groupAvatarStack, { width: size * 0.78, height: size * 0.57 }]}>
          {firstTwo.map((m, i) => {
            const c = getAvatarColor(m);
            return (
              <View key={i} style={[styles.groupMiniAvatar, { backgroundColor: c + '30', borderColor: channel.color + '15', left: i * (size * 0.31) }]}>
                <Text style={[styles.groupMiniAvatarText, { color: c }]}>{m.charAt(0).toUpperCase()}</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  }
  const meta = TYPE_ICONS[channel.type] ?? TYPE_ICONS.custom;
  return (
    <View style={[styles.channelIcon, { backgroundColor: (channel.color ?? meta.color) + '20', width: size, height: size, borderRadius: radius }]}>
      <Ionicons name={(channel.icon ?? meta.icon) as any} size={size * 0.48} color={channel.color ?? meta.color} />
    </View>
  );
}

function ChannelRow({
  channel, lastMsg, unread, readOnly, onPress,
}: {
  channel: Channel | OrgChannel;
  lastMsg?: Message | null;
  unread?: number;
  readOnly?: boolean;
  onPress: () => void;
}) {
  const hasUnread = (unread ?? 0) > 0;
  const color = channel.color ?? C.primary;
  const displayName = channel.type === 'custom' ? `# ${channel.name}` : channel.name;

  const previewText = () => {
    if (!lastMsg) return readOnly ? 'Canal organisationnel — lecture seule' : 'Aucun message';
    if (lastMsg.type === 'notification' || lastMsg.type === 'system') return `📢 ${lastMsg.content}`;
    if (lastMsg.attachmentUri) return `📷 ${lastMsg.content || 'Photo'}`;
    const prefix = lastMsg.isMe ? 'Vous : ' : `${lastMsg.sender.split(' ')[0]} : `;
    return prefix + lastMsg.content;
  };

  return (
    <TouchableOpacity
      style={[styles.channelItem, hasUnread && styles.channelItemUnread]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={{ position: 'relative' }}>
        <ChannelAvatar channel={channel} />
        {hasUnread && <View style={styles.unreadDot} />}
        {readOnly && (
          <View style={[styles.pinBadge, { backgroundColor: C.textMuted }]}>
            <Ionicons name="eye" size={7} color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.channelBody}>
        <View style={styles.channelTop}>
          <Text style={[styles.channelName, hasUnread && styles.channelNameUnread]} numberOfLines={1}>
            {displayName}
          </Text>
          {lastMsg && (
            <Text style={[styles.channelTime, hasUnread && { color }]}>
              {formatChannelTime(lastMsg.timestamp)}
            </Text>
          )}
        </View>
        <View style={styles.channelBottom}>
          <Text style={[styles.channelPreview, hasUnread && styles.channelPreviewUnread, readOnly && { color: C.textMuted, fontStyle: 'italic' }]} numberOfLines={1}>
            {previewText()}
          </Text>
          {hasUnread ? (
            <View style={[styles.unreadBadge, { backgroundColor: color }]}>
              <Text style={styles.unreadBadgeText}>{unread! > 99 ? '99+' : unread}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {readOnly && (
        <Ionicons name="eye-outline" size={14} color={C.textMuted} style={{ marginLeft: 4 }} />
      )}
    </TouchableOpacity>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function SuperAdminMessagingHub() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    channels, messages, unreadByChannel, profiles,
    getOrCreateDMChannel, addGroupChannel,
  } = useApp();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>('mine');
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [orgChannels, setOrgChannels] = useState<Record<string, OrgChannel[]>>({});
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [search, setSearch] = useState('');

  // Annonce
  const [announceOrgId, setAnnounceOrgId] = useState<string | null>(null);
  const [announceChannelId, setAnnounceChannelId] = useState<string | null>(null);
  const [announceText, setAnnounceText] = useState('');
  const [sending, setSending] = useState(false);

  // Modales
  const [showNewDM, setShowNewDM] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);

  // ── Chargement des orgs et canaux ────────────────────────────────────────

  const loadOrgsAndChannels = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoadingOrgs(true);
    try {
      const [{ data: orgsData }, { data: chData }] = await Promise.all([
        supabase.from('organizations').select('id, name, slug').order('name'),
        supabase.from('channels')
          .select('id, name, description, type, icon, color, organization_id, members, created_by')
          .in('type', ['general', 'building', 'company', 'custom'])
          .not('organization_id', 'is', null)
          .order('type')
          .order('name'),
      ]);

      const orgList: OrgSummary[] = (orgsData ?? []).map((o: any) => ({
        id: o.id, name: o.name, slug: o.slug,
      }));
      setOrgs(orgList);

      const grouped: Record<string, OrgChannel[]> = {};
      for (const ch of (chData ?? []) as any[]) {
        const oid: string = ch.organization_id;
        if (!grouped[oid]) grouped[oid] = [];
        grouped[oid].push({
          id: ch.id,
          name: ch.name,
          description: ch.description ?? '',
          type: ch.type,
          icon: ch.icon ?? TYPE_ICONS[ch.type]?.icon ?? 'bookmark',
          color: ch.color ?? TYPE_ICONS[ch.type]?.color ?? C.primary,
          organization_id: oid,
          members: ch.members ? (Array.isArray(ch.members) ? ch.members : Object.values(ch.members)) : [],
        });
      }
      setOrgChannels(grouped);

      if (orgList.length > 0 && expandedOrgs.size === 0) {
        setExpandedOrgs(new Set([orgList[0].id]));
      }
    } catch (e: any) {
      console.warn('[SuperAdminHub] Erreur chargement orgs:', e?.message);
    } finally {
      setLoadingOrgs(false);
    }
  }, []);

  useEffect(() => {
    loadOrgsAndChannels();
  }, []);

  // ── Navigation vers un canal ─────────────────────────────────────────────

  function goToChannel(ch: Channel | OrgChannel, readOnly = false) {
    router.push({
      pathname: '/channel/[id]',
      params: {
        id: ch.id,
        name: ch.name,
        color: ch.color,
        icon: ch.icon,
        isDM: ch.type === 'dm' ? '1' : '0',
        isGroup: ch.type === 'group' ? '1' : '0',
        members: (ch.members ?? []).join(','),
        readOnly: readOnly ? '1' : '0',
      },
    } as any);
  }

  function handleStartDM(profile: Profile) {
    const ch = getOrCreateDMChannel(profile.name);
    goToChannel(ch, false);
  }

  function handleCreateGroup(name: string, members: string[], color: string) {
    const ch = addGroupChannel(name, members, color);
    goToChannel(ch, false);
  }

  // ── Données onglet "Mes échanges" ────────────────────────────────────────

  const lastMessageByChannel = useMemo(() => {
    const map: Record<string, Message | null> = {};
    for (const ch of channels) {
      const chMsgs = messages.filter(m => m.channelId === ch.id);
      map[ch.id] = chMsgs.length > 0 ? chMsgs[chMsgs.length - 1] : null;
    }
    return map;
  }, [channels, messages]);

  // Le super admin ne voit que ses propres DMs et groupes (ceux où il est membre)
  const myName = user?.name ?? '';

  const myDMs = useMemo(
    () => channels.filter(c =>
      c.type === 'dm' &&
      (c.members?.includes(myName) || c.dmParticipants?.includes(myName))
    ),
    [channels, myName],
  );
  const myGroups = useMemo(
    () => channels.filter(c =>
      c.type === 'group' &&
      (c.members?.includes(myName) || c.createdBy === myName)
    ),
    [channels, myName],
  );
  const myCustom = useMemo(
    () => channels.filter(c => c.type === 'custom'),
    [channels],
  );

  const filteredMine = useMemo(() => {
    if (!search.trim()) return { dms: myDMs, groups: myGroups, custom: myCustom };
    const q = search.toLowerCase();
    const f = (arr: Channel[]) => arr.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (lastMessageByChannel[c.id]?.content ?? '').toLowerCase().includes(q)
    );
    return { dms: f(myDMs), groups: f(myGroups), custom: f(myCustom) };
  }, [search, myDMs, myGroups, myCustom, lastMessageByChannel]);

  // Compteur non-lus : uniquement pour les échanges du super admin
  const myChannelIds = useMemo(() => {
    const ids = new Set<string>();
    myDMs.forEach(c => ids.add(c.id));
    myGroups.forEach(c => ids.add(c.id));
    return ids;
  }, [myDMs, myGroups]);

  const totalUnread = useMemo(
    () => Array.from(myChannelIds).reduce((acc, id) => acc + (unreadByChannel[id] ?? 0), 0),
    [myChannelIds, unreadByChannel],
  );

  // ── Annonce globale ──────────────────────────────────────────────────────

  const announceChannels = useMemo(() => {
    if (!announceOrgId) return [];
    return (orgChannels[announceOrgId] ?? []).filter(c =>
      c.type === 'general' || c.type === 'building' || c.type === 'company'
    );
  }, [announceOrgId, orgChannels]);

  async function sendAnnouncement() {
    if (!announceChannelId || !announceText.trim()) {
      Alert.alert('Champs manquants', 'Sélectionnez un canal et rédigez votre annonce.');
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.rpc('send_announcement_message', {
        p_channel_id: announceChannelId,
        p_content: announceText.trim(),
      });
      if (error) throw error;
      Alert.alert('Annonce envoyée', 'Votre message a été diffusé avec succès.');
      setAnnounceText('');
      setAnnounceChannelId(null);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? "Impossible d'envoyer l'annonce.");
    } finally {
      setSending(false);
    }
  }

  // ── Section helpers ──────────────────────────────────────────────────────

  function renderMineSection(title: string, items: Channel[], onAdd?: () => void, addLabel?: string) {
    if (items.length === 0 && !onAdd) return null;
    return (
      <View style={{ marginBottom: 20 }}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>{title}</Text>
          {onAdd && (
            <TouchableOpacity style={styles.sectionAction} onPress={onAdd}>
              <Ionicons name="add" size={16} color={C.primary} />
              <Text style={styles.sectionActionText}>{addLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
        {items.length > 0 ? (
          <View style={styles.channelGroup}>
            {items.map((ch, i) => (
              <View key={ch.id}>
                {i > 0 && <View style={styles.divider} />}
                <ChannelRow
                  channel={ch}
                  lastMsg={lastMessageByChannel[ch.id]}
                  unread={unreadByChannel[ch.id] ?? 0}
                  readOnly={false}
                  onPress={() => goToChannel(ch, false)}
                />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionText}>
              {title === 'Messages directs'
                ? 'Aucun DM — commencez une conversation !'
                : title === 'Groupes'
                ? 'Aucun groupe — créez-en un !'
                : 'Aucun canal personnalisé'}
            </Text>
          </View>
        )}
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── En-tête ── */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Messages</Text>
            <Text style={styles.subtitle}>Vue Super Administrateur</Text>
          </View>
          {activeTab === 'mine' && (
            <>
              <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNewDM(true)}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={C.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNewGroup(true)}>
                <Ionicons name="people-outline" size={20} color={C.primary} />
              </TouchableOpacity>
            </>
          )}
          {activeTab === 'orgs' && (
            <TouchableOpacity style={styles.headerBtn} onPress={loadOrgsAndChannels}>
              <Ionicons name="refresh-outline" size={20} color={C.primary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Barre de recherche — onglets mine + orgs */}
        {activeTab !== 'announce' && (
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={C.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder={activeTab === 'mine' ? 'Rechercher mes échanges…' : 'Rechercher une org ou un canal…'}
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
        )}

        {/* Badge non-lus + total orgs */}
        <View style={styles.statsRow}>
          {totalUnread > 0 && (
            <View style={styles.statBadge}>
              <Ionicons name="mail-unread" size={12} color={C.primary} />
              <Text style={styles.statBadgeText}>{totalUnread} non lu{totalUnread > 1 ? 's' : ''}</Text>
            </View>
          )}
          <View style={styles.statBadge}>
            <Ionicons name="business-outline" size={12} color={C.textMuted} />
            <Text style={[styles.statBadgeText, { color: C.textMuted }]}>{orgs.length > 0 ? `${orgs.length} org${orgs.length > 1 ? 's' : ''}` : 'Chargement…'}</Text>
          </View>
        </View>
      </View>

      {/* ── Onglets ── */}
      <View style={styles.tabBar}>
        {([
          { key: 'mine',    label: 'Mes échanges', icon: 'chatbubbles' },
          { key: 'orgs',    label: 'Organisations', icon: 'layers' },
          { key: 'announce', label: 'Annonce',      icon: 'megaphone' },
        ] as { key: Tab; label: string; icon: string }[]).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => { setSearch(''); setActiveTab(tab.key); }}
            activeOpacity={0.75}
          >
            <Ionicons
              name={(activeTab === tab.key ? tab.icon : tab.icon + '-outline') as any}
              size={16}
              color={activeTab === tab.key ? C.primary : C.textMuted}
            />
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Contenu ── */}

      {/* ── Tab : Mes échanges ── */}
      {activeTab === 'mine' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {(filteredMine.dms.length + filteredMine.groups.length + filteredMine.custom.length) === 0 && search.trim() ? (
            <View style={styles.emptyFull}>
              <Ionicons name="search-outline" size={40} color={C.textMuted} />
              <Text style={styles.emptyFullText}>Aucun résultat pour "{search}"</Text>
            </View>
          ) : (
            <>
              {renderMineSection('Messages directs', filteredMine.dms, () => setShowNewDM(true), 'Nouveau DM')}
              {renderMineSection('Groupes', filteredMine.groups, () => setShowNewGroup(true), 'Nouveau groupe')}
              {renderMineSection('Canaux personnalisés', filteredMine.custom)}
              {(filteredMine.dms.length + filteredMine.groups.length + filteredMine.custom.length) === 0 && (
                <View style={styles.emptyFull}>
                  <Ionicons name="chatbubbles-outline" size={48} color={C.textMuted} />
                  <Text style={styles.emptyFullText}>Aucun échange personnel</Text>
                  <Text style={styles.emptyFullSub}>Commencez un DM ou rejoignez un groupe</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* ── Tab : Organisations ── */}
      {activeTab === 'orgs' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {loadingOrgs ? (
            <View style={styles.emptyFull}>
              <ActivityIndicator size="large" color={C.primary} />
              <Text style={styles.emptyFullSub}>Chargement des organisations…</Text>
            </View>
          ) : orgs.length === 0 ? (
            <View style={styles.emptyFull}>
              <Ionicons name="business-outline" size={48} color={C.textMuted} />
              <Text style={styles.emptyFullText}>Aucune organisation trouvée</Text>
              <Text style={styles.emptyFullSub}>Vérifiez la connexion Supabase</Text>
            </View>
          ) : (
            orgs
              .filter(org =>
                !search.trim() ||
                org.name.toLowerCase().includes(search.toLowerCase()) ||
                (orgChannels[org.id] ?? []).some(c =>
                  c.name.toLowerCase().includes(search.toLowerCase())
                )
              )
              .map(org => {
                const chans = (orgChannels[org.id] ?? []).filter(c =>
                  !search.trim() || c.name.toLowerCase().includes(search.toLowerCase())
                );
                const isExpanded = expandedOrgs.has(org.id);

                return (
                  <View key={org.id} style={styles.orgCard}>
                    <TouchableOpacity
                      style={styles.orgHeader}
                      onPress={() => {
                        setExpandedOrgs(prev => {
                          const next = new Set(prev);
                          if (next.has(org.id)) next.delete(org.id); else next.add(org.id);
                          return next;
                        });
                      }}
                      activeOpacity={0.75}
                    >
                      <View style={styles.orgIconWrap}>
                        <Ionicons name="business" size={18} color={C.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.orgName}>{org.name}</Text>
                        <Text style={styles.orgSub}>{chans.length} canal{chans.length !== 1 ? 'ux' : ''}</Text>
                      </View>
                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={C.textMuted}
                      />
                    </TouchableOpacity>

                    {isExpanded && (
                      <View style={styles.orgChannelList}>
                        {chans.length === 0 ? (
                          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                            <Text style={[styles.emptySectionText, { textAlign: 'left' }]}>
                              Aucun canal pour cette organisation
                            </Text>
                          </View>
                        ) : (
                          chans.map((ch, i) => {
                            const meta = TYPE_ICONS[ch.type] ?? TYPE_ICONS.custom;
                            return (
                              <View key={ch.id}>
                                {i > 0 && <View style={styles.divider} />}
                                <ChannelRow
                                  channel={ch}
                                  readOnly={true}
                                  onPress={() => goToChannel(ch, true)}
                                />
                              </View>
                            );
                          })
                        )}
                      </View>
                    )}
                  </View>
                );
              })
          )}
        </ScrollView>
      )}

      {/* ── Tab : Annonce globale ── */}
      {activeTab === 'announce' && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: 60 }]} showsVerticalScrollIndicator={false}>

            <View style={styles.announceIntro}>
              <View style={styles.announceIconWrap}>
                <Ionicons name="megaphone" size={28} color={C.primary} />
              </View>
              <Text style={styles.announceTitle}>Annonce globale</Text>
              <Text style={styles.announceSub}>
                Envoyez un message officiel dans n'importe quel canal organisationnel.
                Il apparaîtra comme une notification système.
              </Text>
            </View>

            {loadingOrgs ? (
              <ActivityIndicator size="small" color={C.primary} style={{ marginVertical: 20 }} />
            ) : (
              <>
                {/* Sélection organisation */}
                <Text style={styles.fieldLabel}>Organisation cible</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  <View style={styles.chipRow}>
                    {orgs.map(org => (
                      <TouchableOpacity
                        key={org.id}
                        style={[styles.chip, announceOrgId === org.id && styles.chipActive]}
                        onPress={() => { setAnnounceOrgId(org.id); setAnnounceChannelId(null); }}
                        activeOpacity={0.75}
                      >
                        <Ionicons
                          name="business"
                          size={12}
                          color={announceOrgId === org.id ? C.surface : C.primary}
                        />
                        <Text style={[styles.chipText, announceOrgId === org.id && styles.chipTextActive]}>
                          {org.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                {/* Sélection canal */}
                {announceOrgId && (
                  <>
                    <Text style={styles.fieldLabel}>Canal de diffusion</Text>
                    {announceChannels.length === 0 ? (
                      <Text style={styles.emptySectionText}>Aucun canal disponible pour cette org.</Text>
                    ) : (
                      <View style={[styles.channelGroup, { marginBottom: 16 }]}>
                        {announceChannels.map((ch, i) => {
                          const meta = TYPE_ICONS[ch.type] ?? TYPE_ICONS.custom;
                          const selected = announceChannelId === ch.id;
                          return (
                            <View key={ch.id}>
                              {i > 0 && <View style={styles.divider} />}
                              <TouchableOpacity
                                style={[styles.channelItem, selected && { backgroundColor: C.primaryBg }]}
                                onPress={() => setAnnounceChannelId(ch.id)}
                                activeOpacity={0.75}
                              >
                                <View style={[styles.channelIcon, { backgroundColor: ch.color + '20', width: 40, height: 40, borderRadius: 20 }]}>
                                  <Ionicons name={ch.icon as any} size={20} color={ch.color} />
                                </View>
                                <View style={styles.channelBody}>
                                  <Text style={[styles.channelName, selected && { color: C.primary }]}>{ch.name}</Text>
                                  <Text style={styles.channelPreview}>{meta.label}</Text>
                                </View>
                                {selected && (
                                  <Ionicons name="checkmark-circle" size={20} color={C.primary} />
                                )}
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </>
                )}

                {/* Rédaction */}
                <Text style={styles.fieldLabel}>Message d'annonce</Text>
                <View style={styles.announceTextArea}>
                  <TextInput
                    style={styles.announceInput}
                    placeholder="Rédigez votre annonce officielle…"
                    placeholderTextColor={C.textMuted}
                    value={announceText}
                    onChangeText={setAnnounceText}
                    multiline
                    numberOfLines={5}
                    textAlignVertical="top"
                  />
                </View>
                <Text style={styles.announceHint}>
                  Ce message sera affiché comme une notification système dans le canal sélectionné.
                </Text>

                {/* Bouton envoi */}
                <TouchableOpacity
                  style={[
                    styles.sendBtn,
                    (!announceChannelId || !announceText.trim() || sending) && styles.sendBtnDisabled,
                  ]}
                  onPress={sendAnnouncement}
                  disabled={!announceChannelId || !announceText.trim() || sending}
                  activeOpacity={0.8}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="send" size={18} color="#fff" />
                      <Text style={styles.sendBtnText}>Diffuser l'annonce</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ── Modales ── */}
      <NewDMModal
        visible={showNewDM}
        onClose={() => setShowNewDM(false)}
        onSelect={handleStartDM}
        currentUserName={user?.name ?? ''}
        profiles={profiles}
      />
      <NewGroupModal
        visible={showNewGroup}
        onClose={() => setShowNewGroup(false)}
        onCreate={handleCreateGroup}
        currentUserName={user?.name ?? ''}
        profiles={profiles}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Header
  header: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.primary, marginTop: 1 },
  headerBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface2, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.border,
    marginHorizontal: 16, marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 4 },
  statBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primaryBg, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  statBadgeText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.primary },

  // Tab bar
  tabBar: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: C.primary },
  tabLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textMuted },
  tabLabelActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },

  // Content
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },

  // Section
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

  // Channel list
  channelGroup: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1,
    borderColor: C.border, overflow: 'hidden',
  },
  channelItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  channelItemUnread: { backgroundColor: C.primaryBg + '60' },
  channelIcon: { alignItems: 'center', justifyContent: 'center' },
  dmAvatar: { alignItems: 'center', justifyContent: 'center' },
  dmAvatarText: { fontFamily: 'Inter_700Bold' },
  groupAvatar: { alignItems: 'center', justifyContent: 'center' },
  groupAvatarStack: { position: 'relative' },
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
    borderWidth: 2, borderColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  channelBody: { flex: 1 },
  channelTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  channelName: { fontSize: 15, fontFamily: 'Inter_500Medium', color: C.text, flex: 1 },
  channelNameUnread: { fontFamily: 'Inter_700Bold' },
  channelTime: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginLeft: 8 },
  channelBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  channelPreview: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  channelPreviewUnread: { fontFamily: 'Inter_500Medium', color: C.text },
  unreadBadge: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, minWidth: 20, alignItems: 'center' },
  unreadBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  divider: { height: 1, backgroundColor: C.border, marginHorizontal: 14 },

  // Empty
  emptySection: {
    paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
  },
  emptySectionText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
  emptyFull: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyFullText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  emptyFullSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', paddingHorizontal: 24 },

  // Org cards
  orgCard: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1,
    borderColor: C.border, marginBottom: 14, overflow: 'hidden',
  },
  orgHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, backgroundColor: C.surface,
  },
  orgIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  orgName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  orgSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  orgChannelList: { borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg + '80' },

  // Annonce
  announceIntro: { alignItems: 'center', paddingVertical: 20, gap: 8, marginBottom: 8 },
  announceIconWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  announceTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text },
  announceSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', paddingHorizontal: 16, lineHeight: 20 },

  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  chipRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: C.surface, borderRadius: 20,
    borderWidth: 1.5, borderColor: C.border,
  },
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },
  chipTextActive: { color: C.surface },

  announceTextArea: {
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, marginBottom: 8, minHeight: 120,
  },
  announceInput: {
    padding: 14, fontSize: 14, fontFamily: 'Inter_400Regular',
    color: C.text, minHeight: 120,
  },
  announceHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 20, lineHeight: 18 },

  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: C.primary, borderRadius: 14,
    paddingVertical: 15, paddingHorizontal: 24,
  },
  sendBtnDisabled: { backgroundColor: C.textMuted, opacity: 0.5 },
  sendBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
});
