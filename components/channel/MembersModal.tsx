import { View, Text, StyleSheet, TouchableOpacity, Modal, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { Channel, ChannelMemberIdentity, Profile, User } from '@/constants/types';
import { useApp } from '@/context/AppContext';
import { getAvatarColor } from './MessageBubble';

interface Props {
  visible: boolean;
  onClose: () => void;
  channelId: string;
  channelObj: Channel | undefined;
  liveChannelName: string;
  liveMemberIdentities: ChannelMemberIdentity[];
  color: string;
  isDMChannel: boolean;
  isGroupChannel: boolean;
  isEditable: boolean;
  canDelete?: boolean;
  isCreator: boolean;
  channelIcon: string;
  user: User | null;
  knownSenders: string[];
  profiles: Profile[];
  onRenamePress: () => void;
  onAddMemberPress: () => void;
  removeChannelMember: (id: string, member: ChannelMemberIdentity) => void;
  removeCustomChannel: (id: string) => void;
  removeGroupChannel: (id: string) => void;
}

export default function MembersModal({
  visible, onClose, channelId, channelObj, liveChannelName, liveMemberIdentities,
  color, isDMChannel, isGroupChannel, isEditable, canDelete = false, isCreator, channelIcon,
  user, knownSenders, profiles, onRenamePress, onAddMemberPress,
  removeChannelMember, removeCustomChannel, removeGroupChannel,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { companies } = useApp();
  const isCompanyChannel = channelObj?.type === 'company' || channelId.startsWith('company-');
  const canManageMembers = isCreator
    || user?.role === 'super_admin'
    || ((!isGroupChannel && !isDMChannel) && user?.role === 'admin');
  const companyChannelId = channelObj?.id ?? channelId;
  const companyId = isCompanyChannel && companyChannelId.startsWith('company-')
    ? companyChannelId.slice('company-'.length)
    : null;
  const companyMemberNames = companyId
    ? profiles
        .filter(p => p.companyId === companyId)
        .map(p => p.name)
        .filter((v, i, a) => a.indexOf(v) === i)
    : [];
  const visibleCompanyMembers = companyMemberNames.length > 0
    ? companyMemberNames
    : knownSenders.filter((v, i, a) => a.indexOf(v) === i);

  function CompanyPill({ name }: { name: string }) {
    const profile = profiles.find(p => p.name === name);
    if (!profile?.companyId) return null;
    const co = companies.find(c => c.id === profile.companyId);
    if (!co) return null;
    return (
      <View style={styles.companyPill}>
        <Ionicons name="business-outline" size={10} color={co.color || C.textMuted} />
        <Text style={styles.companyPillText} numberOfLines={1}>{co.name}</Text>
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.sheet, { maxHeight: '85%', paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={[styles.headerIcon, { backgroundColor: color + '20' }]}>
              {isDMChannel
                ? <Text style={[styles.headerIconText, { color }]}>{liveChannelName.charAt(0)}</Text>
                : <Ionicons name={(isGroupChannel ? 'people-circle' : channelIcon ?? 'chatbubbles') as any} size={22} color={color} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{liveChannelName}</Text>
              <Text style={styles.sub}>
                {isDMChannel
                  ? t('membersModal.directMessage')
                  : isGroupChannel
                    ? t('membersModal.group')
                    : channelObj?.type === 'company'
                      ? t('membersModal.companyChannel')
                      : isEditable
                        ? t('membersModal.customChannel')
                        : t('membersModal.siteChannel')}
              </Text>
            </View>
            {isEditable && !isCompanyChannel && canManageMembers && (
              <TouchableOpacity style={styles.renameBtn} onPress={onRenamePress}>
                <Ionicons name="pencil-outline" size={16} color={C.primary} />
                <Text style={styles.renameBtnText}>{t('membersModal.rename')}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.divider} />

          <ScrollView showsVerticalScrollIndicator={false}>
            {isCompanyChannel ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionLabel}>{t('membersModal.companyMembers')}</Text>
                </View>
                <View style={styles.companyInfoBanner}>
                  <Ionicons name="sync-outline" size={14} color={C.primary} />
                  <Text style={styles.companyInfoText}>
                    {t('membersModal.syncedCompanyMembers')}
                  </Text>
                </View>
                {visibleCompanyMembers.length > 0 ? visibleCompanyMembers.map(name => (
                  <View key={name} style={styles.memberItem}>
                    <View style={[styles.memberAvatar, { backgroundColor: getAvatarColor(name) + '25' }]}>
                      <Text style={[styles.memberAvatarText, { color: getAvatarColor(name) }]}>{name.charAt(0)}</Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
                      <CompanyPill name={name} />
                    </View>
                    {name === user?.name && <View style={styles.meBadge}><Text style={styles.meBadgeText}>{t('membersModal.you')}</Text></View>}
                  </View>
                )) : (
                  <View style={{ padding: 16, alignItems: 'center' }}>
                    <Text style={styles.sub}>{t('membersModal.noSyncedMember')}</Text>
                  </View>
                )}
              </>
            ) : isEditable || isDMChannel || isGroupChannel ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionLabel}>
                    {isEditable
                      ? (isGroupChannel ? t('membersModal.groupMembers') : t('membersModal.channelMembers'))
                      : isDMChannel ? t('membersModal.participants') : t('membersModal.groupMembers')}
                  </Text>
                  {(isEditable || isGroupChannel) && canManageMembers && (
                    <TouchableOpacity style={styles.addBtn} onPress={() => { onClose(); onAddMemberPress(); }}>
                      <Ionicons name="person-add-outline" size={14} color={C.primary} />
                      <Text style={styles.addBtnText}>{t('channel.add')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {liveMemberIdentities.length > 0 ? liveMemberIdentities.map(member => {
                  const name = member.name;
                  const isCurrentUser = member.id === user?.id || (!user?.id && name === user?.name);
                  const isChannelCreator = channelObj?.createdByUserId
                    ? member.id === channelObj.createdByUserId
                    : channelObj?.createdBy === name;
                  return (
                  <View key={member.id} style={styles.memberItem}>
                    <View style={[styles.memberAvatar, { backgroundColor: getAvatarColor(name) + '25' }]}>
                      <Text style={[styles.memberAvatarText, { color: getAvatarColor(name) }]}>{name.charAt(0)}</Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
                      <CompanyPill name={name} />
                    </View>
                    {isCurrentUser && <View style={styles.meBadge}><Text style={styles.meBadgeText}>{t('membersModal.you')}</Text></View>}
                    {isChannelCreator && !isCurrentUser && (
                      <View style={[styles.meBadge, { backgroundColor: C.primary + '15' }]}>
                        <Text style={[styles.meBadgeText, { color: C.primary }]}>{t('membersModal.creator')}</Text>
                      </View>
                    )}
                    {(isEditable || isGroupChannel) && canManageMembers && !isChannelCreator && !isCurrentUser && (
                      <TouchableOpacity
                        style={styles.removeBtn}
                        onPress={() => {
                          Alert.alert(
                            t('membersModal.removeMemberTitle'),
                            t('membersModal.removeMemberText', {
                              name,
                              target: isGroupChannel ? t('membersModal.leaveTargetGroup') : t('membersModal.leaveTargetChannel'),
                            }),
                            [
                              { text: t('common.cancel'), style: 'cancel' },
                              { text: t('membersModal.remove'), style: 'destructive', onPress: () => removeChannelMember(channelId, member) },
                            ]
                          );
                        }}
                      >
                        <Ionicons name="remove-circle-outline" size={20} color={C.open} />
                      </TouchableOpacity>
                    )}
                  </View>
                  );
                }) : (
                  <View style={{ padding: 16, alignItems: 'center' }}>
                    <Text style={styles.sub}>{t('membersModal.noMember')}</Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.sectionLabel}>{t('membersModal.activeMembers')}</Text>
                {[user?.name ?? t('membersModal.you'), ...knownSenders].filter((v, i, a) => a.indexOf(v) === i).map(name => (
                  <View key={name} style={styles.memberItem}>
                    <View style={[styles.memberAvatar, { backgroundColor: getAvatarColor(name) + '25' }]}>
                      <Text style={[styles.memberAvatarText, { color: getAvatarColor(name) }]}>{name.charAt(0)}</Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
                      <CompanyPill name={name} />
                    </View>
                    {name === user?.name && <View style={styles.meBadge}><Text style={styles.meBadgeText}>{t('membersModal.you')}</Text></View>}
                  </View>
                ))}
              </>
            )}

            {isEditable && canDelete && (
              <>
                <View style={styles.divider} />
                {!canManageMembers && (
                  <TouchableOpacity
                    style={styles.dangerBtn}
                    onPress={() => {
                      Alert.alert(
                        t('membersModal.leaveTitle', { target: isGroupChannel ? t('membersModal.leaveTargetGroup') : t('membersModal.leaveTargetChannel') }),
                        t('membersModal.leaveText', { target: isGroupChannel ? t('membersModal.leaveTargetGroup') : t('membersModal.leaveTargetChannel') }),
                        [
                          { text: t('common.cancel'), style: 'cancel' },
                          {
                            text: t('membersModal.leave'), style: 'destructive',
                            onPress: () => {
                              onClose();
                              if (user?.id) {
                                removeChannelMember(channelId, { id: user.id, name: user.name ?? '' });
                              }
                              router.back();
                            },
                          },
                        ]
                      );
                    }}
                  >
                    <Ionicons name="exit-outline" size={18} color={C.waiting} />
                    <Text style={[styles.dangerBtnText, { color: C.waiting }]}>
                      {isGroupChannel ? t('membersModal.leaveGroup') : t('membersModal.leaveChannel')}
                    </Text>
                  </TouchableOpacity>
                )}
                {canManageMembers && (
                  <TouchableOpacity
                    style={styles.dangerBtn}
                    onPress={() => {
                      Alert.alert(
                        t('membersModal.deleteTitle', { target: isGroupChannel ? t('membersModal.leaveTargetGroup') : t('membersModal.leaveTargetChannel') }),
                        t('membersModal.deleteText'),
                        [
                          { text: t('common.cancel'), style: 'cancel' },
                          {
                            text: t('channel.delete'), style: 'destructive',
                            onPress: () => {
                              onClose();
                              if (channelObj?.type === 'custom') removeCustomChannel(channelId);
                              else removeGroupChannel(channelId);
                              router.back();
                            },
                          },
                        ]
                      );
                    }}
                  >
                    <Ionicons name="trash-outline" size={18} color={C.open} />
                    <Text style={styles.dangerBtnText}>
                      {isGroupChannel ? t('membersModal.deleteGroup') : t('membersModal.deleteChannel')}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>{t('channel.close')}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  handle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  headerIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  headerIconText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  title: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  sub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  renameBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  renameBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  addBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  memberItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  memberInfo: { flex: 1, gap: 3 },
  memberName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  companyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: 200,
  },
  companyPillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#374151' },
  meBadge: { backgroundColor: C.closed + '20', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  meBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.closed },
  removeBtn: { padding: 4 },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  dangerBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.open },
  cancelBtn: { marginTop: 8, backgroundColor: C.surface2, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  companyInfoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.primaryBg, borderRadius: 10, padding: 10, marginBottom: 10 },
  companyInfoText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, lineHeight: 17 },
});
