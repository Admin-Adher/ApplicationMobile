import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, FlatList, Platform } from 'react-native';
import { useState, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '@/constants/colors';
import { Profile } from '@/constants/types';

const AVATAR_COLORS = [C.primary, '#059669', '#D97706', '#7C3AED', '#DB2777', '#EA580C', '#0891B2'];
const GROUP_COLORS = ['#7C3AED', '#059669', '#D97706', '#0A84FF', '#EC4899', '#EA580C', '#0891B2', '#65A30D', '#DC2626', '#6366F1'];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  conducteur: 'Conducteur de travaux',
  chef_equipe: "Chef d'équipe",
  observateur: 'Observateur',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  profiles: Profile[];
  currentUserName: string;
  onCreate: (name: string, members: string[], color: string) => void;
}

export default function NewGroupModal({ visible, onClose, profiles, currentUserName, onCreate }: Props) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Profile[]>([]);
  const [groupName, setGroupName] = useState('');
  const [selectedColor, setSelectedColor] = useState('#7C3AED');
  const [step, setStep] = useState<'members' | 'name'>('members');

  const filtered = useMemo(() => {
    const others = profiles.filter(p => p.name !== currentUserName);
    if (!search.trim()) return others;
    const q = search.toLowerCase();
    return others.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (ROLE_LABELS[p.role] ?? '').toLowerCase().includes(q)
    );
  }, [profiles, currentUserName, search]);

  function toggleSelect(p: Profile) {
    setSelected(prev =>
      prev.find(x => x.id === p.id)
        ? prev.filter(x => x.id !== p.id)
        : [...prev, p]
    );
  }

  function handleNext() {
    if (selected.length < 2) return;
    const defaultName = selected.map(p => p.name.split(' ')[0]).join(', ');
    setGroupName(defaultName);
    setStep('name');
  }

  function handleCreate() {
    const name = groupName.trim() || selected.map(p => p.name.split(' ')[0]).join(', ');
    const members = [currentUserName, ...selected.map(p => p.name)];
    onCreate(name, members, selectedColor);
    handleClose();
  }

  function handleClose() {
    setSearch('');
    setSelected([]);
    setGroupName('');
    setSelectedColor('#7C3AED');
    setStep('members');
    onClose();
  }

  const isSelected = (p: Profile) => !!selected.find(x => x.id === p.id);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.container}>
        <View style={[styles.header, Platform.OS === 'android' && { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity onPress={step === 'name' ? () => setStep('members') : handleClose} style={styles.closeBtn}>
            <Ionicons name={step === 'name' ? 'chevron-back' : 'close'} size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.title}>{step === 'members' ? 'Nouveau groupe' : 'Nom du groupe'}</Text>
          {step === 'members' ? (
            <TouchableOpacity
              onPress={handleNext}
              style={[styles.nextBtn, selected.length < 2 && styles.nextBtnDisabled]}
              disabled={selected.length < 2}
            >
              <Text style={[styles.nextBtnText, selected.length < 2 && { opacity: 0.4 }]}>Suivant</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleCreate} style={[styles.nextBtn, { backgroundColor: selectedColor }]}>
              <Text style={styles.nextBtnText}>Créer</Text>
            </TouchableOpacity>
          )}
        </View>

        {step === 'members' ? (
          <>
            {selected.length > 0 && (
              <View style={styles.selectedBar}>
                {selected.map(p => {
                  const color = getAvatarColor(p.name);
                  return (
                    <TouchableOpacity key={p.id} style={styles.selectedChip} onPress={() => toggleSelect(p)}>
                      <View style={[styles.chipAvatar, { backgroundColor: color + '25' }]}>
                        <Text style={[styles.chipAvatarText, { color }]}>{p.name.charAt(0).toUpperCase()}</Text>
                      </View>
                      <Text style={styles.chipName} numberOfLines={1}>{p.name.split(' ')[0]}</Text>
                      <Ionicons name="close-circle" size={14} color={C.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <View style={styles.info}>
              <Ionicons name="information-circle-outline" size={14} color={C.textMuted} />
              <Text style={styles.infoText}>Sélectionnez au moins 2 membres pour créer un groupe</Text>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color={C.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Rechercher un membre..."
                placeholderTextColor={C.textMuted}
                value={search}
                onChangeText={setSearch}
                autoFocus
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={16} color={C.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <FlatList
              data={filtered}
              keyExtractor={p => p.id}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={() => (
                <View style={styles.empty}>
                  <Ionicons name="people-outline" size={36} color={C.textMuted} />
                  <Text style={styles.emptyText}>Aucun utilisateur trouvé</Text>
                </View>
              )}
              renderItem={({ item }) => {
                const color = getAvatarColor(item.name);
                const sel = isSelected(item);
                return (
                  <TouchableOpacity
                    style={[styles.userRow, sel && { borderColor: selectedColor, borderWidth: 1.5, backgroundColor: selectedColor + '08' }]}
                    onPress={() => toggleSelect(item)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.avatar, { backgroundColor: color + '25' }]}>
                      <Text style={[styles.avatarLetter, { color }]}>{item.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.userInfo}>
                      <Text style={styles.userName}>{item.name}</Text>
                      <Text style={styles.userRole}>{ROLE_LABELS[item.role] ?? item.role}</Text>
                    </View>
                    <View style={[styles.checkCircle, sel && { backgroundColor: selectedColor, borderColor: selectedColor }]}>
                      {sel && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </>
        ) : (
          <View style={styles.nameStep}>
            <View style={[styles.groupPreview, { backgroundColor: selectedColor + '15', borderColor: selectedColor + '40' }]}>
              <View style={[styles.groupIcon, { backgroundColor: selectedColor + '25' }]}>
                <Ionicons name="people-circle" size={34} color={selectedColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.groupPreviewName, { color: selectedColor }]} numberOfLines={1}>
                  {groupName || 'Nom du groupe'}
                </Text>
                <Text style={styles.groupPreviewSub}>{selected.length + 1} membres</Text>
              </View>
            </View>

            <Text style={styles.label}>Nom du groupe</Text>
            <TextInput
              style={styles.input}
              placeholder="ex: Équipe Bâtiment A"
              placeholderTextColor={C.textMuted}
              value={groupName}
              onChangeText={setGroupName}
              autoFocus
              maxLength={40}
            />

            <Text style={styles.label}>Couleur</Text>
            <View style={styles.colorRow}>
              {GROUP_COLORS.map(col => (
                <TouchableOpacity
                  key={col}
                  style={[styles.colorDot, { backgroundColor: col }, selectedColor === col && styles.colorDotSelected]}
                  onPress={() => setSelectedColor(col)}
                  activeOpacity={0.8}
                >
                  {selectedColor === col && <Ionicons name="checkmark" size={14} color="#fff" />}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Membres ({selected.length + 1})</Text>
            <View style={styles.membersPreview}>
              <View style={styles.memberRow}>
                <View style={[styles.memberAvatar, { backgroundColor: C.primary + '25' }]}>
                  <Text style={[styles.memberAvatarText, { color: C.primary }]}>{currentUserName.charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={styles.memberName}>{currentUserName}</Text>
                <Text style={styles.youBadge}>Vous</Text>
              </View>
              {selected.map(p => {
                const color = getAvatarColor(p.name);
                return (
                  <View key={p.id} style={styles.memberRow}>
                    <View style={[styles.memberAvatar, { backgroundColor: color + '25' }]}>
                      <Text style={[styles.memberAvatarText, { color }]}>{p.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.memberName}>{p.name}</Text>
                    <Text style={styles.memberRoleLabel}>{ROLE_LABELS[p.role] ?? p.role}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  nextBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: C.primary },
  nextBtnDisabled: { backgroundColor: C.border },
  nextBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  selectedBar: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
  },
  selectedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
  },
  chipAvatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  chipAvatarText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  chipName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text, maxWidth: 70 },
  info: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2,
  },
  infoText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, flex: 1 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    margin: 16, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted },
  userRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: C.border,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 2 },
  userRole: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary },
  checkCircle: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface2,
  },
  nameStep: { padding: 20, paddingBottom: 40 },
  groupPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 16, borderWidth: 1,
    marginBottom: 24,
  },
  groupIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  groupPreviewName: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  groupPreviewSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  label: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, marginTop: 4,
  },
  input: {
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular',
    color: C.text, marginBottom: 20,
  },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  colorDot: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'transparent',
  },
  colorDotSelected: { borderColor: C.text },
  membersPreview: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1,
    borderColor: C.border, overflow: 'hidden',
  },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.borderLight,
  },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  memberName: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  youBadge: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary, backgroundColor: C.primaryBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  memberRoleLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
