import { View, Text, StyleSheet, TouchableOpacity, Modal, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { Channel, Profile, User } from '@/constants/types';
import { getAvatarColor } from './MessageBubble';

interface Props {
  visible: boolean;
  onClose: () => void;
  channelId: string;
  channelObj: Channel | undefined;
  liveChannelName: string;
  liveMembers: string[];
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
  removeChannelMember: (id: string, name: string) => void;
  removeCustomChannel: (id: string) => void;
  removeGroupChannel: (id: string) => void;
}

export default function MembersModal({
  visible, onClose, channelId, channelObj, liveChannelName, liveMembers,
  color, isDMChannel, isGroupChannel, isEditable, canDelete = false, isCreator, channelIcon,
  user, knownSenders, profiles, onRenamePress, onAddMemberPress,
  removeChannelMember, removeCustomChannel, removeGroupChannel,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isCompanyChannel = channelObj?.type === 'company';

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
                {isDMChannel ? 'Message direct' : isGroupChannel ? 'Groupe' : channelObj?.type === 'company' ? 'Canal entreprise' : isEditable ? 'Canal personnalisé' : 'Canal chantier'}
              </Text>
            </View>
            {isEditable && !isCompanyChannel && (
              <TouchableOpacity style={styles.renameBtn} onPress={onRenamePress}>
                <Ionicons name="pencil-outline" size={16} color={C.primary} />
                <Text style={styles.renameBtnText}>Renommer</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.divider} />

          <ScrollView showsVerticalScrollIndicator={false}>
            {isCompanyChannel ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionLabel}>MEMBRES DE L'ENTREPRISE</Text>
                </View>
                <View style={styles.companyInfoBanner}>
                  <Ionicons name="sync-outline" size={14} color={C.primary} />
                  <Text style={styles.companyInfoText}>
                    Les membres sont synchronisés automatiquement avec le personnel de l'entreprise.
                  </Text>
                </View>
                {knownSenders.filter((v, i, a) => a.indexOf(v) === i).map(name => (
                  <View key={name} style={styles.memberItem}>
                    <View style={[styles.memberAvatar, { backgroundColor: getAvatarColor(name) + '25' }]}>
                      <Text style={[styles.memberAvatarText, { color: getAvatarColor(name) }]}>{name.charAt(0)}</Text>
                    </View>
                    <Text style={styles.memberName}>{name}</Text>
                    {name === user?.name && <View style={styles.meBadge}><Text style={styles.meBadgeText}>Vous</Text></View>}
                  </View>
                ))}
              </>
            ) : isEditable || isDMChannel || isGroupChannel ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionLabel}>
                    {isEditable ? (isGroupChannel ? 'MEMBRES DU GROUPE' : 'MEMBRES DU CANAL') : isDMChannel ? 'PARTICIPANTS' : 'MEMBRES DU GROUPE'}
                  </Text>
                  {(isEditable || isGroupChannel) && (
                    <TouchableOpacity style={styles.addBtn} onPress={() => { onClose(); onAddMemberPress(); }}>
                      <Ionicons name="person-add-outline" size={14} color={C.primary} />
                      <Text style={styles.addBtnText}>Ajouter</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {liveMembers.length > 0 ? liveMembers.map(name => (
                  <View key={name} style={styles.memberItem}>
                    <View style={[styles.memberAvatar, { backgroundColor: getAvatarColor(name) + '25' }]}>
                      <Text style={[styles.memberAvatarText, { color: getAvatarColor(name) }]}>{name.charAt(0)}</Text>
                    </View>
                    <Text style={styles.memberName}>{name}</Text>
                    {name === user?.name && <View style={styles.meBadge}><Text style={styles.meBadgeText}>Vous</Text></View>}
                    {channelObj?.createdBy === name && name !== user?.name && (
                      <View style={[styles.meBadge, { backgroundColor: C.primary + '15' }]}>
                        <Text style={[styles.meBadgeText, { color: C.primary }]}>Créateur</Text>
                      </View>
                    )}
                    {(isEditable || isGroupChannel) && name !== channelObj?.createdBy && name !== user?.name && (
                      <TouchableOpacity
                        style={styles.removeBtn}
                        onPress={() => {
                          Alert.alert(
                            'Retirer ce membre ?',
                            `${name} sera retiré(e) du ${isGroupChannel ? 'groupe' : 'canal'}.`,
                            [
                              { text: 'Annuler', style: 'cancel' },
                              { text: 'Retirer', style: 'destructive', onPress: () => removeChannelMember(channelId, name) },
                            ]
                          );
                        }}
                      >
                        <Ionicons name="remove-circle-outline" size={20} color={C.open} />
                      </TouchableOpacity>
                    )}
                  </View>
                )) : (
                  <View style={{ padding: 16, alignItems: 'center' }}>
                    <Text style={styles.sub}>Aucun membre enregistré</Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.sectionLabel}>MEMBRES ACTIFS</Text>
                {[user?.name ?? 'Moi', ...knownSenders].filter((v, i, a) => a.indexOf(v) === i).map(name => (
                  <View key={name} style={styles.memberItem}>
                    <View style={[styles.memberAvatar, { backgroundColor: getAvatarColor(name) + '25' }]}>
                      <Text style={[styles.memberAvatarText, { color: getAvatarColor(name) }]}>{name.charAt(0)}</Text>
                    </View>
                    <Text style={styles.memberName}>{name}</Text>
                    {name === user?.name && <View style={styles.meBadge}><Text style={styles.meBadgeText}>Vous</Text></View>}
                  </View>
                ))}
              </>
            )}

            {isEditable && canDelete && (
              <>
                <View style={styles.divider} />
                {!isCreator && (
                  <TouchableOpacity
                    style={styles.dangerBtn}
                    onPress={() => {
                      Alert.alert(
                        `Quitter ce ${isGroupChannel ? 'groupe' : 'canal'} ?`,
                        `Vous ne ferez plus partie de ce ${isGroupChannel ? 'groupe' : 'canal'}.`,
                        [
                          { text: 'Annuler', style: 'cancel' },
                          {
                            text: 'Quitter', style: 'destructive',
                            onPress: () => {
                              onClose();
                              removeChannelMember(channelId, user?.name ?? '');
                              router.back();
                            },
                          },
                        ]
                      );
                    }}
                  >
                    <Ionicons name="exit-outline" size={18} color={C.waiting} />
                    <Text style={[styles.dangerBtnText, { color: C.waiting }]}>
                      Quitter {isGroupChannel ? 'le groupe' : 'le canal'}
                    </Text>
                  </TouchableOpacity>
                )}
                {isCreator && (
                  <TouchableOpacity
                    style={styles.dangerBtn}
                    onPress={() => {
                      Alert.alert(
                        `Supprimer ce ${isGroupChannel ? 'groupe' : 'canal'} ?`,
                        'Tous les messages seront perdus. Cette action est irréversible.',
                        [
                          { text: 'Annuler', style: 'cancel' },
                          {
                            text: 'Supprimer', style: 'destructive',
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
                      Supprimer {isGroupChannel ? 'le groupe' : 'le canal'}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Fermer</Text>
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
  memberName: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
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
