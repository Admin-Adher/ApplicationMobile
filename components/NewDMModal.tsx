import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, FlatList, Platform } from 'react-native';
import { useState, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '@/constants/colors';
import { Profile } from '@/constants/types';
import { ROLE_LABELS } from '@/constants/roles';

const AVATAR_COLORS = [C.primary, '#059669', '#D97706', '#7C3AED', '#DB2777', '#EA580C', '#0891B2'];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  profiles: Profile[];
  currentUserName: string;
  onSelect: (profile: Profile) => void;
}

export default function NewDMModal({ visible, onClose, profiles, currentUserName, onSelect }: Props) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const others = profiles.filter(p => p.name !== currentUserName);
    if (!search.trim()) return others;
    const q = search.toLowerCase();
    return others.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q) ||
      (ROLE_LABELS[p.role] ?? '').toLowerCase().includes(q)
    );
  }, [profiles, currentUserName, search]);

  function handleSelect(p: Profile) {
    onSelect(p);
    setSearch('');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={[styles.header, Platform.OS === 'android' && { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Message direct</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un utilisateur..."
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
            return (
              <TouchableOpacity style={styles.userRow} onPress={() => handleSelect(item)} activeOpacity={0.75}>
                <View style={[styles.avatar, { backgroundColor: color + '25' }]}>
                  <Text style={[styles.avatarLetter, { color }]}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userName}>{item.name}</Text>
                  <Text style={styles.userRole}>{ROLE_LABELS[item.role] ?? item.role}</Text>
                  <Text style={styles.userEmail}>{item.email}</Text>
                </View>
                <View style={styles.dmBtn}>
                  <Ionicons name="chatbubble-ellipses" size={18} color={C.primary} />
                </View>
              </TouchableOpacity>
            );
          }}
        />
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
  userRole: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, marginBottom: 2 },
  userEmail: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  dmBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
});
