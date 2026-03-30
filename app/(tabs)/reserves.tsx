import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Platform, ScrollView, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, useMemo } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { ReserveStatus, ReservePriority } from '@/constants/types';
import ReserveCard from '@/components/ReserveCard';

const STATUS_FILTERS: { key: 'all' | ReserveStatus; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'open', label: 'Ouvert' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'waiting', label: 'En attente' },
  { key: 'verification', label: 'Vérification' },
  { key: 'closed', label: 'Clôturé' },
];

type SortKey = 'date_desc' | 'date_asc' | 'priority' | 'deadline' | 'status';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'date_desc', label: 'Plus récente' },
  { key: 'date_asc', label: 'Plus ancienne' },
  { key: 'priority', label: 'Priorité' },
  { key: 'deadline', label: 'Échéance' },
  { key: 'status', label: 'Statut' },
];

const PRIORITY_ORDER: Record<ReservePriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER_MAP: Record<ReserveStatus, number> = { open: 0, in_progress: 1, waiting: 2, verification: 3, closed: 4 };

function isOverdue(deadline: string, status: ReserveStatus): boolean {
  if (status === 'closed' || deadline === '—' || !deadline) return false;
  const parts = deadline.split('/');
  if (parts.length === 3) {
    const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    return d < new Date() && !isNaN(d.getTime());
  }
  const d = new Date(deadline);
  return d < new Date() && !isNaN(d.getTime());
}

export default function ReservesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reserves, companies } = useApp();
  const [statusFilter, setStatusFilter] = useState<'all' | ReserveStatus>('all');
  const [buildingFilter, setBuildingFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | ReservePriority>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date_desc');
  const [search, setSearch] = useState('');
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const buildings = useMemo(() => {
    const b = new Set(reserves.map(r => r.building));
    return Array.from(b).sort();
  }, [reserves]);

  const activeFilterCount = [
    buildingFilter !== 'all' ? 1 : 0,
    priorityFilter !== 'all' ? 1 : 0,
    companyFilter !== 'all' ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const overdueCount = useMemo(() =>
    reserves.filter(r => isOverdue(r.deadline, r.status)).length,
    [reserves]
  );

  const filtered = useMemo(() => {
    let list = reserves.filter(r => {
      const matchStatus = statusFilter === 'all' || r.status === statusFilter;
      const matchBuilding = buildingFilter === 'all' || r.building === buildingFilter;
      const matchPriority = priorityFilter === 'all' || r.priority === priorityFilter;
      const matchCompany = companyFilter === 'all' || r.company === companyFilter;
      const q = search.toLowerCase();
      const matchSearch = search === '' ||
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.company.toLowerCase().includes(q) ||
        r.building.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.zone.toLowerCase().includes(q);
      return matchStatus && matchBuilding && matchPriority && matchCompany && matchSearch;
    });

    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'date_desc': return b.createdAt.localeCompare(a.createdAt);
        case 'date_asc': return a.createdAt.localeCompare(b.createdAt);
        case 'priority': return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        case 'deadline': {
          const toDate = (s: string) => {
            if (!s || s === '—') return '9999-99-99';
            const p = s.split('/');
            return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : s;
          };
          return toDate(a.deadline).localeCompare(toDate(b.deadline));
        }
        case 'status': return STATUS_ORDER_MAP[a.status] - STATUS_ORDER_MAP[b.status];
        default: return 0;
      }
    });
    return list;
  }, [reserves, statusFilter, buildingFilter, priorityFilter, companyFilter, sortKey, search]);

  const currentSortLabel = SORT_OPTIONS.find(s => s.key === sortKey)?.label ?? 'Tri';

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Réserves</Text>
            <Text style={styles.subtitle}>
              {filtered.length} réserve{filtered.length !== 1 ? 's' : ''}
              {overdueCount > 0 && ` · ${overdueCount} en retard`}
            </Text>
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={() => router.push('/reserve/new' as any)}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Titre, bâtiment, entreprise, description..."
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

        <View style={styles.toolRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            {STATUS_FILTERS.map(f => (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterChip, statusFilter === f.key && styles.filterChipActive]}
                onPress={() => setStatusFilter(f.key)}
              >
                <Text style={[styles.filterText, statusFilter === f.key && styles.filterTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={[styles.toolBtn, activeFilterCount > 0 && styles.toolBtnActive]}
            onPress={() => setFilterModalVisible(true)}
          >
            <Ionicons name="options-outline" size={15} color={activeFilterCount > 0 ? C.primary : C.textSub} />
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{activeFilterCount}</Text></View>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.toolBtn} onPress={() => setSortModalVisible(true)}>
            <Ionicons name="swap-vertical-outline" size={15} color={C.textSub} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <ReserveCard reserve={item} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="checkmark-circle-outline" size={40} color={C.primary} />
            </View>
            <Text style={styles.emptyText}>Aucune réserve trouvée</Text>
            <Text style={styles.emptyHint}>Modifiez vos filtres ou créez une nouvelle réserve</Text>
          </View>
        )}
      />

      {/* Modal tri */}
      <Modal visible={sortModalVisible} transparent animationType="slide" onRequestClose={() => setSortModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSortModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Trier par</Text>
            {SORT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.sheetItem, sortKey === opt.key && styles.sheetItemActive]}
                onPress={() => { setSortKey(opt.key); setSortModalVisible(false); }}
              >
                <Text style={[styles.sheetItemText, sortKey === opt.key && styles.sheetItemTextActive]}>{opt.label}</Text>
                {sortKey === opt.key && <Ionicons name="checkmark" size={16} color={C.primary} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setSortModalVisible(false)}>
              <Text style={styles.cancelText}>Fermer</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Modal filtres avancés */}
      <Modal visible={filterModalVisible} transparent animationType="slide" onRequestClose={() => setFilterModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFilterModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>Filtres avancés</Text>
              {activeFilterCount > 0 && (
                <TouchableOpacity onPress={() => { setBuildingFilter('all'); setPriorityFilter('all'); setCompanyFilter('all'); }}>
                  <Text style={styles.resetText}>Réinitialiser</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.sheetSectionLabel}>BÂTIMENT</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <View style={styles.chipRowInline}>
                {['all', ...buildings].map(b => (
                  <TouchableOpacity
                    key={b}
                    style={[styles.chip, buildingFilter === b && styles.chipActive]}
                    onPress={() => setBuildingFilter(b)}
                  >
                    <Text style={[styles.chipText, buildingFilter === b && styles.chipTextActive]}>
                      {b === 'all' ? 'Tous' : `Bât. ${b}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.sheetSectionLabel}>PRIORITÉ</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <View style={styles.chipRowInline}>
                {([
                  { key: 'all', label: 'Toutes', color: C.textSub },
                  { key: 'critical', label: 'Critique', color: C.critical },
                  { key: 'high', label: 'Haute', color: C.high },
                  { key: 'medium', label: 'Moyenne', color: C.medium },
                  { key: 'low', label: 'Basse', color: C.low },
                ] as const).map(p => (
                  <TouchableOpacity
                    key={p.key}
                    style={[styles.chip, priorityFilter === p.key && { backgroundColor: p.color + '20', borderColor: p.color }]}
                    onPress={() => setPriorityFilter(p.key as 'all' | ReservePriority)}
                  >
                    <Text style={[styles.chipText, priorityFilter === p.key && { color: p.color }]}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.sheetSectionLabel}>ENTREPRISE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <View style={styles.chipRowInline}>
                <TouchableOpacity
                  style={[styles.chip, companyFilter === 'all' && styles.chipActive]}
                  onPress={() => setCompanyFilter('all')}
                >
                  <Text style={[styles.chipText, companyFilter === 'all' && styles.chipTextActive]}>Toutes</Text>
                </TouchableOpacity>
                {companies.map(co => (
                  <TouchableOpacity
                    key={co.id}
                    style={[styles.chip, companyFilter === co.name && { backgroundColor: co.color + '20', borderColor: co.color }]}
                    onPress={() => setCompanyFilter(co.name)}
                  >
                    <View style={[styles.dot, { backgroundColor: co.color }]} />
                    <Text style={[styles.chipText, companyFilter === co.name && { color: co.color }]}>{co.shortName}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity style={styles.applyBtn} onPress={() => setFilterModalVisible(false)}>
              <Text style={styles.applyBtnText}>Appliquer</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
    backgroundColor: C.surface,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  addBtn: {
    backgroundColor: C.primary,
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 10, marginBottom: 10, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.surface2, marginRight: 8, borderWidth: 1, borderColor: C.border,
  },
  filterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  filterTextActive: { color: '#fff' },
  toolBtn: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border,
  },
  toolBtnActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  filterBadge: {
    position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: 7,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  filterBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  list: { padding: 16, paddingBottom: 80 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  bottomSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12, maxHeight: '75%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  resetText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.open },
  sheetItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetItemActive: {},
  sheetItemText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text },
  sheetItemTextActive: { fontFamily: 'Inter_600SemiBold', color: C.primary },
  cancelBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 14, backgroundColor: C.surface2, borderRadius: 12 },
  cancelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  sheetSectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 8 },
  chipScroll: { marginBottom: 4 },
  chipRowInline: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2, flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  chipTextActive: { color: C.primary },
  dot: { width: 7, height: 7, borderRadius: 4 },
  applyBtn: { marginTop: 20, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  applyBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
