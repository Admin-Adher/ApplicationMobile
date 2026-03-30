import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, useMemo } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { ReserveStatus } from '@/constants/types';
import ReserveCard from '@/components/ReserveCard';

const FILTERS: { key: 'all' | ReserveStatus; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'open', label: 'Ouvert' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'waiting', label: 'En attente' },
  { key: 'verification', label: 'Vérification' },
  { key: 'closed', label: 'Clôturé' },
];

export default function ReservesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reserves } = useApp();
  const [filter, setFilter] = useState<'all' | ReserveStatus>('all');
  const [search, setSearch] = useState('');
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const filtered = useMemo(() => {
    return reserves.filter(r => {
      const matchStatus = filter === 'all' || r.status === filter;
      const matchSearch = search === '' ||
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        r.id.toLowerCase().includes(search.toLowerCase()) ||
        r.company.toLowerCase().includes(search.toLowerCase()) ||
        r.building.toLowerCase().includes(search.toLowerCase());
      return matchStatus && matchSearch;
    });
  }, [reserves, filter, search]);

  return (
    <View style={[styles.container]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Réserves</Text>
            <Text style={styles.subtitle}>{filtered.length} réserves</Text>
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={() => router.push('/reserve/new' as any)}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher..."
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

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersWrap}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <ReserveCard reserve={item} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={48} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucune réserve trouvée</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.bg,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  addBtn: { backgroundColor: C.primary, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 9, marginBottom: 10, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  filtersWrap: { marginBottom: 4 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: C.surface, marginRight: 8, borderWidth: 1, borderColor: C.border,
  },
  filterChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  filterText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  filterTextActive: { color: C.primary },
  list: { padding: 16, paddingBottom: 80 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
