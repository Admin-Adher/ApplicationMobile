import { useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, RefreshControl, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Header from '@/components/Header';
import { InventoryEmpty, InventoryProductCard, InventorySearch } from '@/components/inventory/InventoryCards';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { fetchInventoryMovementsForExport, normalizeInventoryReference, useInventory } from '@/hooks/queries/useInventory';
import { exportInventoryCsv, exportInventoryPdf, type InventoryExportKind } from '@/lib/inventoryExport';
import { useInventoryCopy } from '@/lib/inventoryI18n';

export default function InventoryStockScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ low?: string }>();
  const copy = useInventoryCopy();
  const { activeChantier } = useApp();
  const { permissions } = useAuth();
  const inventory = useInventory(activeChantier?.id, activeChantier?.organizationId);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(params.low === '1');
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const normalized = normalizeInventoryReference(search);
    return inventory.products.filter(product => {
      if (lowOnly && !(product.minStock > 0 && product.currentStock <= product.minStock)) return false;
      if (!needle) return true;
      return product.reference.toLowerCase().includes(needle)
        || normalizeInventoryReference(product.reference).includes(normalized)
        || product.designation.toLowerCase().includes(needle)
        || product.barcode?.toLowerCase().includes(needle)
        || product.location?.toLowerCase().includes(needle);
    });
  }, [inventory.products, lowOnly, search]);

  async function runExport(kind: InventoryExportKind | 'pdf') {
    if (!activeChantier) return;
    setExportOpen(false);
    setExporting(true);
    try {
      const movements = kind === 'pdf'
        ? await fetchInventoryMovementsForExport(activeChantier.id, inventory.movements)
        : inventory.movements;
      if (kind === 'pdf') await exportInventoryPdf(inventory.products, movements, activeChantier.name);
      else await exportInventoryCsv(kind, inventory.products, movements, activeChantier.name);
    } catch (error: any) {
      Alert.alert(copy.error, error?.message ?? String(error));
    } finally {
      setExporting(false);
    }
  }

  if (!permissions.canViewInventory) {
    return <View style={styles.root}><Header title={copy.stock} showBack backFallback="/inventory" /><InventoryEmpty icon="lock-closed-outline" title={copy.restricted} /></View>;
  }

  return (
    <View style={styles.root}>
      <Header title={copy.stock} subtitle={activeChantier?.name} showBack backFallback="/inventory" rightLabel={permissions.canExportInventory ? copy.export : undefined} onRightPress={permissions.canExportInventory ? () => setExportOpen(true) : undefined} />
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <InventoryProductCard product={item} onPress={() => router.push(`/inventory/product/${item.id}` as any)} />}
        ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + (permissions.canRecordInventory ? 96 : 28) }]}
        refreshControl={<RefreshControl refreshing={inventory.isRefreshing} onRefresh={inventory.refresh} tintColor={C.primary} />}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <InventorySearch value={search} onChangeText={setSearch} />
            <TouchableOpacity style={[styles.filterButton, lowOnly && styles.filterButtonActive]} onPress={() => setLowOnly(value => !value)}>
              <Ionicons name={lowOnly ? 'warning' : 'warning-outline'} size={18} color={lowOnly ? C.open : C.textSub} />
              <Text style={[styles.filterText, lowOnly && { color: C.open }]}>{copy.onlyLow}</Text>
              <View style={[styles.countPill, lowOnly && { backgroundColor: C.open }]}><Text style={styles.countPillText}>{inventory.lowStockProducts.length}</Text></View>
            </TouchableOpacity>
            <Text style={styles.resultCount}>{filtered.length} {copy.references.toLowerCase()}</Text>
          </View>
        }
        ListEmptyComponent={inventory.isLoading ? <ActivityIndicator style={{ marginTop: 40 }} color={C.primary} /> : <InventoryEmpty title={copy.noProduct} />}
      />

      {permissions.canRecordInventory && (
        <View style={[styles.fabRow, { bottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity style={[styles.fab, { backgroundColor: C.closed }]} onPress={() => router.push('/inventory/scan?mode=in' as any)}><Ionicons name="arrow-down" size={22} color="#fff" /><Text style={styles.fabText}>{copy.entry}</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.fab, { backgroundColor: C.open }]} onPress={() => router.push('/inventory/scan?mode=out' as any)}><Ionicons name="arrow-up" size={22} color="#fff" /><Text style={styles.fabText}>{copy.exit}</Text></TouchableOpacity>
        </View>
      )}

      <Modal visible={exportOpen} transparent animationType="fade" onRequestClose={() => setExportOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setExportOpen(false)}>
          <View style={styles.exportCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.exportTitle}>{copy.export}</Text>
            {([
              ['pdf', 'document-text-outline', copy.exportPdf],
              ['stock', 'grid-outline', copy.exportStockCsv],
              ['reorder', 'warning-outline', copy.exportReorderCsv],
            ] as const).map(([kind, icon, label]) => (
              <TouchableOpacity key={kind} style={styles.exportOption} onPress={() => runExport(kind)}>
                <View style={styles.exportIcon}><Ionicons name={icon} size={20} color={C.primary} /></View><Text style={styles.exportLabel}>{label}</Text><Ionicons name="chevron-forward" size={17} color={C.textMuted} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelButton} onPress={() => setExportOpen(false)}><Text style={styles.cancelText}>{copy.cancel}</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      {exporting && <View style={styles.busy}><ActivityIndicator size="large" color="#fff" /></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  listContent: { padding: 14 }, listHeader: { gap: 10, marginBottom: 13 },
  filterButton: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 8 }, filterButtonActive: { backgroundColor: C.openBg, borderColor: `${C.open}30` }, filterText: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  countPill: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.textMuted, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, countPillText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 9 }, resultCount: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 11 },
  fabRow: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', gap: 9 }, fab: { flex: 1, height: 52, borderRadius: 15, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', shadowColor: '#001F52', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 }, fabText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,20,48,0.5)', justifyContent: 'flex-end', padding: 14 }, exportCard: { backgroundColor: C.surface, borderRadius: 20, padding: 16, gap: 8 }, exportTitle: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 4 }, exportOption: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border, borderRadius: 13, paddingHorizontal: 11 }, exportIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' }, exportLabel: { flex: 1, color: C.text, fontFamily: 'Inter_500Medium', fontSize: 13 }, cancelButton: { alignItems: 'center', paddingVertical: 12 }, cancelText: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,31,82,0.38)', alignItems: 'center', justifyContent: 'center' },
});
