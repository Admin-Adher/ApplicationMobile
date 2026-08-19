import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Header from '@/components/Header';
import ExportLanguageSelector from '@/components/ExportLanguageSelector';
import { InventoryEmpty, InventoryMovementCard, InventorySearch } from '@/components/inventory/InventoryCards';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { fetchInventoryMovementsForExport, useInventory } from '@/hooks/queries/useInventory';
import { exportInventoryPdf, exportInventoryXlsx, type InventoryExportKind } from '@/lib/inventoryExport';
import { useInventoryCopy } from '@/lib/inventoryI18n';

type MovementFilter = 'all' | 'in' | 'out';

export default function InventoryHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const copy = useInventoryCopy();
  const { activeChantier } = useApp();
  const { permissions } = useAuth();
  const { exportLanguage, setExportLanguage } = useLanguage();
  const inventory = useInventory(activeChantier?.id, activeChantier?.organizationId);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MovementFilter>('all');
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inventory.movements.filter(movement => {
      if (filter !== 'all' && movement.movementType !== filter) return false;
      if (!needle) return true;
      return movement.reference.toLowerCase().includes(needle)
        || movement.designation.toLowerCase().includes(needle)
        || movement.userName.toLowerCase().includes(needle)
        || movement.buildingName?.toLowerCase().includes(needle)
        || movement.zoneName?.toLowerCase().includes(needle)
        || movement.companyName?.toLowerCase().includes(needle)
        || movement.location?.toLowerCase().includes(needle)
        || movement.comment?.toLowerCase().includes(needle);
    });
  }, [filter, inventory.movements, search]);

  async function runExport(kind: InventoryExportKind | 'pdf') {
    if (!activeChantier) return;
    setExportOpen(false);
    setExporting(true);
    try {
      const movements = await fetchInventoryMovementsForExport(activeChantier.id, inventory.movements);
      if (kind === 'pdf') await exportInventoryPdf(inventory.products, movements, activeChantier.name, exportLanguage);
      else await exportInventoryXlsx(kind, inventory.products, movements, activeChantier.name, exportLanguage);
    } catch (error: any) {
      Alert.alert(copy.error, error?.message ?? String(error));
    } finally {
      setExporting(false);
    }
  }

  if (!permissions.canViewInventory) {
    return <View style={styles.root}><Header title={copy.history} showBack backFallback="/inventory" /><InventoryEmpty icon="lock-closed-outline" title={copy.restricted} /></View>;
  }

  const filterOptions: { value: MovementFilter; label: string; color: string }[] = [
    { value: 'all', label: copy.filterAll, color: C.primary },
    { value: 'in', label: copy.filterEntries, color: C.closed },
    { value: 'out', label: copy.filterExits, color: C.open },
  ];

  return (
    <View style={styles.root}>
      <Header title={copy.history} subtitle={activeChantier?.name} showBack backFallback="/inventory" rightLabel={permissions.canExportInventory ? copy.export : undefined} onRightPress={permissions.canExportInventory ? () => setExportOpen(true) : undefined} />
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <InventoryMovementCard movement={item} onPress={() => router.push(`/inventory/product/${item.productId}` as any)} />}
        ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 28 }]}
        refreshControl={<RefreshControl refreshing={inventory.isRefreshing} onRefresh={inventory.refresh} tintColor={C.primary} />}
        ListHeaderComponent={<View style={styles.listHeader}>
          <InventorySearch value={search} onChangeText={setSearch} placeholder={copy.searchReference} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {filterOptions.map(option => {
              const selected = filter === option.value;
              return <TouchableOpacity key={option.value} style={[styles.filter, selected && { backgroundColor: `${option.color}15`, borderColor: `${option.color}55` }]} onPress={() => setFilter(option.value)}><Text style={[styles.filterText, selected && { color: option.color }]}>{option.label}</Text></TouchableOpacity>;
            })}
          </ScrollView>
          <Text style={styles.resultCount}>{filtered.length} mouvement(s)</Text>
        </View>}
        ListEmptyComponent={inventory.isLoading ? <ActivityIndicator style={{ marginTop: 40 }} color={C.primary} /> : <InventoryEmpty title={copy.noMovement} />}
      />

      <Modal visible={exportOpen} transparent animationType="fade" onRequestClose={() => setExportOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setExportOpen(false)}>
          <View style={styles.exportCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.exportTitle}>{copy.export}</Text>
            <View style={styles.exportLanguage}><ExportLanguageSelector value={exportLanguage} onChange={setExportLanguage} /></View>
            <ScrollView style={{ maxHeight: 430 }} contentContainerStyle={{ gap: 7 }}>
              {([
                ['pdf', 'document-text-outline', copy.exportPdf],
                ['entries', 'arrow-down-outline', copy.exportEntriesCsv],
                ['exits', 'arrow-up-outline', copy.exportExitsCsv],
                ['by_building', 'business-outline', copy.exportBuildingCsv],
                ['by_company', 'people-outline', copy.exportCompanyCsv],
                ['stock', 'grid-outline', copy.exportStockCsv],
                ['reorder', 'warning-outline', copy.exportReorderCsv],
              ] as const).map(([kind, icon, label]) => (
                <TouchableOpacity key={kind} style={styles.exportOption} onPress={() => runExport(kind)}>
                  <View style={styles.exportIcon}><Ionicons name={icon} size={20} color={C.primary} /></View><Text style={styles.exportLabel}>{label}</Text><Ionicons name="chevron-forward" size={17} color={C.textMuted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setExportOpen(false)}><Text style={styles.cancelText}>{copy.cancel}</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      {exporting && <View style={styles.busy}><ActivityIndicator size="large" color="#fff" /></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg }, listContent: { padding: 14 }, listHeader: { gap: 10, marginBottom: 13 },
  filters: { gap: 7 }, filter: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface }, filterText: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 11 }, resultCount: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 11 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,20,48,0.5)', justifyContent: 'flex-end', padding: 14 }, exportCard: { backgroundColor: C.surface, borderRadius: 20, padding: 16, gap: 8 }, exportTitle: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 4 }, exportOption: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border, borderRadius: 13, paddingHorizontal: 11 }, exportIcon: { width: 35, height: 35, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' }, exportLabel: { flex: 1, color: C.text, fontFamily: 'Inter_500Medium', fontSize: 13 }, cancelButton: { alignItems: 'center', paddingVertical: 12 }, cancelText: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 13 }, busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,31,82,0.38)', alignItems: 'center', justifyContent: 'center' },
  exportLanguage: { padding: 12, borderWidth: 1, borderColor: C.borderLight, borderRadius: 14, backgroundColor: C.bg, marginBottom: 2 },
});
