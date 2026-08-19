import { useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Header from '@/components/Header';
import { InventoryLocationScanModal } from '@/components/inventory/InventoryLocationScanModal';
import { InventoryEmpty, InventoryMovementCard } from '@/components/inventory/InventoryCards';
import { C } from '@/constants/colors';
import { MediaImage } from '@/components/MediaImage';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useInventory } from '@/hooks/queries/useInventory';
import { persistLocalPhoto } from '@/lib/storage';
import { useInventoryCopy } from '@/lib/inventoryI18n';

function InfoRow({ icon, label, value }: { icon: string; label: string; value?: string }) {
  if (!value) return null;
  return <View style={styles.infoRow}><Ionicons name={icon as any} size={18} color={C.textMuted} /><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue} numberOfLines={2}>{value}</Text></View>;
}

export default function InventoryProductScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const copy = useInventoryCopy();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeChantier } = useApp();
  const { permissions } = useAuth();
  const inventory = useInventory(activeChantier?.id, activeChantier?.organizationId);
  const product = inventory.products.find(item => item.id === id);
  const history = useMemo(() => inventory.movements.filter(movement => movement.productId === id), [id, inventory.movements]);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reference, setReference] = useState('');
  const [designation, setDesignation] = useState('');
  const [barcode, setBarcode] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const [minStock, setMinStock] = useState('0');
  const [location, setLocation] = useState('');
  const [supplier, setSupplier] = useState('');
  const [locationScanOpen, setLocationScanOpen] = useState(false);

  function openEditor() {
    if (!product) return;
    setReference(product.reference);
    setDesignation(product.designation);
    setBarcode(product.barcode ?? '');
    setPhotoUrl(product.photoUrl);
    setMinStock(String(product.minStock));
    setLocation(product.location ?? '');
    setSupplier(product.supplier ?? '');
    setEditOpen(true);
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(copy.error, copy.cameraPermission);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]?.uri) setPhotoUrl(await persistLocalPhoto(result.assets[0].uri));
  }

  async function saveProduct() {
    if (!product || !reference.trim() || !designation.trim()) return;
    setSaving(true);
    try {
      const result = await inventory.updateProduct(product.id, {
        reference: reference.trim(),
        designation: designation.trim(),
        barcode: barcode.trim() || null,
        photoUrl: photoUrl ?? null,
        minStock: Number(minStock.replace(',', '.')) || 0,
        location: location.trim() || null,
        supplier: supplier.trim() || null,
      });
      setEditOpen(false);
      if (result.queued) Alert.alert(copy.movementSaved, copy.queued);
    } catch (error: any) {
      Alert.alert(copy.error, error?.message ?? String(error));
    } finally {
      setSaving(false);
    }
  }

  function openMovement(mode: 'in' | 'out') {
    if (!product) return;
    router.push({ pathname: '/inventory/movement', params: { mode, productId: product.id, code: product.barcode ?? product.reference } } as any);
  }

  if (!permissions.canViewInventory) {
    return <View style={styles.root}><Header title={copy.productSheet} showBack backFallback="/inventory/stock" /><InventoryEmpty icon="lock-closed-outline" title={copy.restricted} /></View>;
  }
  if (!product) {
    return <View style={styles.root}><Header title={copy.productSheet} showBack backFallback="/inventory/stock" />{inventory.isLoading ? <ActivityIndicator style={{ marginTop: 60 }} color={C.primary} /> : <InventoryEmpty title={copy.noProduct} />}</View>;
  }

  const low = product.minStock > 0 && product.currentStock <= product.minStock;

  return (
    <View style={styles.root}>
      <Header title={copy.productSheet} subtitle={product.reference} showBack backFallback="/inventory/stock" rightIcon={permissions.canManageInventoryProducts ? 'create-outline' : undefined} onRightPress={permissions.canManageInventoryProducts ? openEditor : undefined} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 34 }]}>
        <View style={styles.heroCard}>
          {product.photoUrl ? <MediaImage source={{ uri: product.photoUrl }} style={styles.heroPhoto} /> : <View style={[styles.heroPhoto, styles.heroPlaceholder]}><Ionicons name="cube-outline" size={44} color={C.textMuted} /></View>}
          <View style={styles.heroBody}>
            <View style={styles.referenceLine}><Text style={styles.reference}>{product.reference}</Text>{product.pendingSync && <Ionicons name="cloud-upload-outline" size={17} color={C.waiting} />}</View>
            <Text style={styles.designation}>{product.designation}</Text>
            {!!product.barcode && <Text style={styles.barcode}>{product.barcode}</Text>}
          </View>
        </View>

        <View style={styles.stockCard}>
          <View><Text style={styles.stockLabel}>{copy.available}</Text><Text style={[styles.stockValue, low && { color: C.open }]}>{product.currentStock}</Text></View>
          <View style={styles.stockDivider} />
          <View><Text style={styles.stockLabel}>{copy.minimumStock}</Text><Text style={styles.minimumValue}>{product.minStock}</Text></View>
          {low && <View style={styles.lowPill}><Ionicons name="warning" size={15} color={C.open} /><Text style={styles.lowPillText}>{copy.orderRequired}</Text></View>}
        </View>

        {permissions.canRecordInventory && <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actionButton, { backgroundColor: C.closed }]} onPress={() => openMovement('in')}><Ionicons name="arrow-down" size={21} color="#fff" /><Text style={styles.actionText}>{copy.entry}</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, { backgroundColor: C.open }]} onPress={() => openMovement('out')}><Ionicons name="arrow-up" size={21} color="#fff" /><Text style={styles.actionText}>{copy.exit}</Text></TouchableOpacity>
        </View>}

        <View style={styles.statsRow}>
          <View style={styles.stat}><Text style={[styles.statValue, { color: C.closed }]}>{product.totalEntries}</Text><Text style={styles.statLabel}>{copy.entries}</Text></View>
          <View style={styles.stat}><Text style={[styles.statValue, { color: C.open }]}>{product.totalExits}</Text><Text style={styles.statLabel}>{copy.exits}</Text></View>
          <View style={styles.stat}><Text style={[styles.statValue, { color: C.primary }]}>{product.version}</Text><Text style={styles.statLabel}>Version</Text></View>
        </View>

        <View style={styles.infoCard}>
          <InfoRow icon="location-outline" label={copy.location} value={product.location || copy.pickLocationMissing} />
          <InfoRow icon="truck-outline" label={copy.supplier} value={product.supplier} />
          <InfoRow icon="barcode-outline" label={copy.barcode} value={product.barcode} />
          {!product.location && !product.supplier && !product.barcode && <Text style={styles.emptyInfo}>{copy.optional}</Text>}
        </View>

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{copy.movementHistory}</Text><Text style={styles.historyCount}>{history.length}</Text></View>
        <View style={styles.historyList}>
          {history.slice(0, 50).map(movement => <InventoryMovementCard key={movement.id} movement={movement} />)}
          {!history.length && <InventoryEmpty title={copy.noHistory} />}
        </View>
      </ScrollView>

      <Modal visible={editOpen} animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Header title={copy.editProduct} onBack={() => setEditOpen(false)} rightLabel={copy.save} onRightPress={saveProduct} />
          <ScrollView contentContainerStyle={[styles.editContent, { paddingBottom: insets.bottom + 30 }]} keyboardShouldPersistTaps="handled">
            <TouchableOpacity style={styles.editPhotoButton} onPress={takePhoto}>
              {photoUrl ? <MediaImage source={{ uri: photoUrl }} style={styles.editPhoto} /> : <View style={[styles.editPhoto, styles.heroPlaceholder]}><Ionicons name="camera-outline" size={34} color={C.primary} /></View>}
              <Text style={styles.editPhotoText}>{photoUrl ? copy.changePhoto : copy.addPhoto}</Text>
            </TouchableOpacity>
            <EditField label={copy.reference} value={reference} onChangeText={setReference} />
            <EditField label={copy.designation} value={designation} onChangeText={setDesignation} />
            <EditField label={copy.barcode} value={barcode} onChangeText={setBarcode} />
            <EditField label={copy.minimumStock} value={minStock} onChangeText={setMinStock} keyboardType="decimal-pad" />
            <View style={styles.editField}>
              <Text style={styles.editLabel}>{copy.location}</Text>
              <View style={styles.locationEditRow}>
                <TextInput style={[styles.editInput, { flex: 1 }]} value={location} onChangeText={setLocation} placeholderTextColor={C.textMuted} autoCapitalize="characters" />
                <TouchableOpacity style={styles.scanShelfButton} onPress={() => setLocationScanOpen(true)}>
                  <Ionicons name="scan-outline" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
            <EditField label={copy.supplier} value={supplier} onChangeText={setSupplier} />
            <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={saveProduct} disabled={saving}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>{copy.save}</Text>}</TouchableOpacity>
          </ScrollView>
          <InventoryLocationScanModal
            visible={locationScanOpen}
            title={copy.scanLocation}
            hint={copy.scanLocationHint}
            torchLabel={copy.torch}
            cancelLabel={copy.cancel}
            cameraPermission={copy.cameraPermission}
            allowCamera={copy.allowCamera}
            cameraUnavailable={copy.cameraUnavailable}
            retryLabel={copy.retryCamera}
            readyTitle={copy.scanReady}
            readyHint={copy.scanReadyHintShelf}
            readyAction={copy.scanReadyAction}
            onClose={() => setLocationScanOpen(false)}
            onDetected={code => { setLocation(code); setLocationScanOpen(false); }}
          />
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function EditField({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return <View style={styles.editField}><Text style={styles.editLabel}>{label}</Text><TextInput {...props} style={styles.editInput} placeholderTextColor={C.textMuted} /></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg }, content: { padding: 14, gap: 12 },
  heroCard: { flexDirection: 'row', gap: 14, padding: 14, backgroundColor: C.surface, borderRadius: 17, borderWidth: 1, borderColor: C.border }, heroPhoto: { width: 92, height: 92, borderRadius: 14, backgroundColor: C.surface2 }, heroPlaceholder: { alignItems: 'center', justifyContent: 'center' }, heroBody: { flex: 1, justifyContent: 'center' }, referenceLine: { flexDirection: 'row', alignItems: 'center', gap: 6 }, reference: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 19, flexShrink: 1 }, designation: { color: C.text, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19, marginTop: 5 }, barcode: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 7 },
  stockCard: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, backgroundColor: C.surface, borderRadius: 17, borderWidth: 1, borderColor: C.border }, stockLabel: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 9, textTransform: 'uppercase' }, stockValue: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 32 }, minimumValue: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 23, marginTop: 3 }, stockDivider: { width: 1, height: 45, backgroundColor: C.border }, lowPill: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.openBg, borderRadius: 11, paddingHorizontal: 9, paddingVertical: 7 }, lowPillText: { color: C.open, fontFamily: 'Inter_700Bold', fontSize: 9, textTransform: 'uppercase' },
  actionRow: { flexDirection: 'row', gap: 9 }, actionButton: { flex: 1, height: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, actionText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 12 },
  statsRow: { flexDirection: 'row', gap: 8 }, stat: { flex: 1, alignItems: 'center', paddingVertical: 13, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border }, statValue: { fontFamily: 'Inter_700Bold', fontSize: 19 }, statLabel: { color: C.textSub, fontFamily: 'Inter_500Medium', fontSize: 9, textTransform: 'uppercase', marginTop: 2 },
  infoCard: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14 }, infoRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border }, infoLabel: { color: C.textSub, fontFamily: 'Inter_500Medium', fontSize: 11, width: 92 }, infoValue: { flex: 1, color: C.text, fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'right' }, emptyInfo: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', padding: 18 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 5 }, sectionTitle: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 16 }, historyCount: { color: C.primary, backgroundColor: C.primaryBg, fontFamily: 'Inter_700Bold', fontSize: 10, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }, historyList: { gap: 8 },
  modalRoot: { flex: 1, backgroundColor: C.bg }, editContent: { padding: 16, gap: 13 }, editPhotoButton: { alignItems: 'center', gap: 8, marginBottom: 4 }, editPhoto: { width: 110, height: 110, borderRadius: 18, backgroundColor: C.surface2 }, editPhotoText: { color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 }, editField: { gap: 6 }, editLabel: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase' }, editInput: { minHeight: 48, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 13, color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14 }, locationEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, scanShelfButton: { width: 48, height: 48, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }, saveButton: { height: 52, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginTop: 5 }, saveButtonText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 14 },
});
