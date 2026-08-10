import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Header from '@/components/Header';
import { InventoryEmpty, InventoryMovementCard, InventoryProductCard, InventorySearch } from '@/components/inventory/InventoryCards';
import { openChantierSwitcher } from '@/components/ChantierSwitcherSheet';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useInventory, normalizeInventoryReference, fetchInventoryMovementsForExport } from '@/hooks/queries/useInventory';
import { exportInventoryPdf } from '@/lib/inventoryExport';
import { useInventoryCopy } from '@/lib/inventoryI18n';
import { isWarehouseRole } from '@/lib/roleNavigation';

export default function InventoryHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const copy = useInventoryCopy();
  const { activeChantier } = useApp();
  const { permissions, user } = useAuth();
  const isWarehouseUser = isWarehouseRole(user?.role);
  const inventory = useInventory(activeChantier?.id, activeChantier?.organizationId);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const normalized = normalizeInventoryReference(search);
    if (!needle) return [];
    return inventory.products.filter(product =>
      product.reference.toLowerCase().includes(needle)
      || normalizeInventoryReference(product.reference).includes(normalized)
      || product.designation.toLowerCase().includes(needle)
      || product.barcode?.toLowerCase().includes(needle),
    ).slice(0, 6);
  }, [inventory.products, search]);

  if (!permissions.canViewInventory) {
    return (
      <View style={styles.root}>
        <Header title={copy.module} showBack={!isWarehouseUser} backFallback="/(tabs)/more" />
        <InventoryEmpty icon="lock-closed-outline" title={copy.restricted} />
      </View>
    );
  }

  if (!activeChantier) {
    return (
      <View style={styles.root}>
        <Header
          title={copy.module}
          showBack={!isWarehouseUser}
          backFallback="/(tabs)/more"
          rightIcon={isWarehouseUser ? 'settings-outline' : undefined}
          onRightPress={isWarehouseUser ? () => router.push('/settings' as any) : undefined}
        />
        <InventoryEmpty icon="business-outline" title={copy.noSite} />
        <TouchableOpacity style={styles.primaryButton} onPress={openChantierSwitcher}>
          <Text style={styles.primaryButtonText}>{copy.chooseSite}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function handlePdfExport() {
    if (!permissions.canExportInventory || !activeChantier) return;
    setExporting(true);
    try {
      const movements = await fetchInventoryMovementsForExport(activeChantier.id, inventory.movements);
      await exportInventoryPdf(inventory.products, movements, activeChantier.name);
    } catch (error: any) {
      Alert.alert(copy.error, error?.message ?? String(error));
    } finally {
      setExporting(false);
    }
  }

  const actions = [
    { label: copy.entry, icon: 'arrow-down-circle', color: C.closed, bg: C.closedBg, route: '/inventory/scan?mode=in' },
    { label: copy.exit, icon: 'arrow-up-circle', color: C.open, bg: C.openBg, route: '/inventory/scan?mode=out' },
    { label: copy.stock, icon: 'cube', color: C.primary, bg: C.primaryBg, route: '/inventory/stock' },
    { label: copy.history, icon: 'time', color: C.verification, bg: C.verificationBg, route: '/inventory/history' },
  ] as const;

  return (
    <View style={styles.root}>
      <Header
        title={copy.module}
        subtitle={activeChantier.name}
        showBack={!isWarehouseUser}
        backFallback="/(tabs)/more"
        rightActions={isWarehouseUser ? (
          <View style={styles.headerActions}>
            {permissions.canExportInventory && (
              <TouchableOpacity style={styles.headerAction} onPress={handlePdfExport} accessibilityLabel={copy.exportPdf}>
                <Ionicons name="download-outline" size={21} color={C.primary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.headerAction} onPress={() => router.push('/settings' as any)} accessibilityLabel="Paramètres">
              <Ionicons name="settings-outline" size={21} color={C.primary} />
            </TouchableOpacity>
          </View>
        ) : undefined}
        rightIcon={!isWarehouseUser && permissions.canExportInventory ? 'download-outline' : undefined}
        onRightPress={!isWarehouseUser && permissions.canExportInventory ? handlePdfExport : undefined}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={undefined}
      >
        {isWarehouseUser && (
          <TouchableOpacity style={styles.siteButton} onPress={openChantierSwitcher}>
            <Ionicons name="business-outline" size={17} color={C.primary} />
            <Text style={styles.siteButtonText}>{activeChantier.name}</Text>
            <Ionicons name="chevron-down" size={16} color={C.textSub} />
          </TouchableOpacity>
        )}
        <InventorySearch value={search} onChangeText={setSearch} />
        {!!search && (
          <View style={styles.searchResults}>
            {results.map(product => (
              <InventoryProductCard
                key={product.id}
                compact
                product={product}
                onPress={() => router.push(`/inventory/product/${product.id}` as any)}
              />
            ))}
            {!results.length && <InventoryEmpty title={copy.noProduct} />}
          </View>
        )}

        <View style={styles.actionGrid}>
          {actions.map(action => (
            <TouchableOpacity
              key={action.label}
              style={[styles.actionCard, { backgroundColor: action.bg, borderColor: `${action.color}28` }]}
              onPress={() => router.push(action.route as any)}
              activeOpacity={0.78}
            >
              <Ionicons name={action.icon} size={34} color={action.color} />
              <Text style={[styles.actionLabel, { color: action.color }]}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}><Text style={styles.kpiValue}>{inventory.products.length}</Text><Text style={styles.kpiLabel}>{copy.references}</Text></View>
          <View style={styles.kpiCard}><Text style={styles.kpiValue}>{inventory.products.reduce((sum, product) => sum + product.currentStock, 0)}</Text><Text style={styles.kpiLabel}>{copy.units}</Text></View>
          <TouchableOpacity style={[styles.kpiCard, inventory.lowStockProducts.length > 0 && styles.kpiAlert]} onPress={() => router.push('/inventory/stock?low=1' as any)}>
            <Text style={[styles.kpiValue, inventory.lowStockProducts.length > 0 && styles.kpiAlertValue]}>{inventory.lowStockProducts.length}</Text>
            <Text style={[styles.kpiLabel, inventory.lowStockProducts.length > 0 && styles.kpiAlertValue]}>{copy.lowStock}</Text>
          </TouchableOpacity>
        </View>

        {inventory.lowStockProducts.length > 0 && (
          <TouchableOpacity style={styles.alertCard} onPress={() => router.push('/inventory/stock?low=1' as any)}>
            <Ionicons name="warning" size={24} color={C.open} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>{copy.lowStock.toUpperCase()}</Text>
              <Text style={styles.alertText}>{inventory.lowStockProducts.length} · {copy.orderRequired}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.open} />
          </TouchableOpacity>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{copy.recentMovements}</Text>
          <TouchableOpacity onPress={() => router.push('/inventory/history' as any)}><Text style={styles.link}>{copy.seeAll}</Text></TouchableOpacity>
        </View>
        <View style={styles.list}>
          {inventory.isLoading && !inventory.movements.length ? <ActivityIndicator color={C.primary} /> : inventory.movements.slice(0, 5).map(movement => (
            <InventoryMovementCard key={movement.id} movement={movement} onPress={() => router.push(`/inventory/product/${movement.productId}` as any)} />
          ))}
          {!inventory.isLoading && !inventory.movements.length && <InventoryEmpty title={copy.noMovement} />}
        </View>
      </ScrollView>
      {exporting && <View style={styles.busy}><ActivityIndicator size="large" color="#fff" /></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 16 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerAction: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primaryBg },
  siteButton: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 13, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  siteButtonText: { flex: 1, color: C.text, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  primaryButton: { alignSelf: 'center', backgroundColor: C.primary, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 13 },
  primaryButtonText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  searchResults: { gap: 8 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCard: { width: '48.5%', minHeight: 112, borderRadius: 18, borderWidth: 1, padding: 17, justifyContent: 'space-between' },
  actionLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, letterSpacing: 0.3 },
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpiCard: { flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  kpiValue: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 20 },
  kpiLabel: { color: C.textSub, fontFamily: 'Inter_500Medium', fontSize: 9, textAlign: 'center', textTransform: 'uppercase', marginTop: 2 },
  kpiAlert: { backgroundColor: C.openBg, borderColor: `${C.open}30` },
  kpiAlertValue: { color: C.open },
  alertCard: { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 15, padding: 14, backgroundColor: C.openBg, borderWidth: 1, borderColor: `${C.open}30` },
  alertTitle: { color: C.open, fontFamily: 'Inter_700Bold', fontSize: 13 },
  alertText: { color: C.open, fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 },
  sectionTitle: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 16 },
  link: { color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  list: { gap: 9 },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,31,82,0.38)', alignItems: 'center', justifyContent: 'center' },
});
