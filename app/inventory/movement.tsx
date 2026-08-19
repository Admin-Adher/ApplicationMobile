import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Header from '@/components/Header';
import { InventoryLocationScanModal } from '@/components/inventory/InventoryLocationScanModal';
import { InventoryProductCard } from '@/components/inventory/InventoryCards';
import { C } from '@/constants/colors';
import { MediaImage } from '@/components/MediaImage';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { useInventory, normalizeInventoryReference } from '@/hooks/queries/useInventory';
import { shouldBlockInventoryMovementForInsufficientStock } from '@/lib/inventoryMovementOutcome';
import { persistLocalPhoto } from '@/lib/storage';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useInventoryCopy } from '@/lib/inventoryI18n';
import {
  inventoryBarcodeWebSearchUrl,
  lookupInventoryBarcode,
  type InventoryBarcodeMatch,
} from '@/lib/inventoryBarcodeLookup';
import { canonicalizeGtin, normalizeBarcodeLookupCode } from '@/lib/inventoryBarcodeCore';
import { resolveInventoryStorageLocation } from '@/lib/inventoryLocationScan';
import { collectInventoryLabels, preferInventoryLabel } from '@/lib/inventoryScanMemory';
import {
  EMPTY_INVENTORY_DESTINATION,
  createInventoryDestinationCatalog,
  inventoryDestinationPolicy,
  inventoryDestinationZones,
  toInventoryMovementDestination,
  transitionInventoryDestination,
} from '@/lib/inventoryDestinationModel';

const DEFAULT_COMPANIES = ['INICA', 'Grupo Eléctrico', 'Symantel', 'Acabados'];

type BarcodeLookupState =
  | { status: 'idle' | 'searching' | 'not-found' }
  | { status: 'found'; match: InventoryBarcodeMatch };

function Field({ label, optional, required, children }: { label: string; optional?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}{required ? ' *' : ''}</Text>
        {!!optional && !required && <Text style={styles.optional}>{optional}</Text>}
      </View>
      {children}
    </View>
  );
}

function Chip({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function InventoryMovementScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const copy = useInventoryCopy();
  const { i18n } = useTranslation();
  const params = useLocalSearchParams<{
    mode?: string;
    code?: string;
    codeType?: string;
    photoUri?: string;
    productId?: string;
    ocrReference?: string;
    ocrDesignation?: string;
    location?: string;
  }>();
  const mode = params.mode === 'out' ? 'out' : 'in';
  const destinationPolicy = inventoryDestinationPolicy(mode);
  const { activeChantier, companies } = useApp();
  const { permissions } = useAuth();
  const { isOnline } = useNetwork();
  const inventory = useInventory(activeChantier?.id, activeChantier?.organizationId);
  const initialApplied = useRef(false);
  const normalizedInitialCode = normalizeBarcodeLookupCode(params.code ?? '');
  const designationEdited = useRef(Boolean(params.ocrDesignation?.trim()));
  const supplierEdited = useRef(false);
  const locationEdited = useRef(Boolean(params.location?.trim()));

  const [productId, setProductId] = useState<string | undefined>(params.productId);
  const [reference, setReference] = useState(params.ocrReference ?? normalizedInitialCode);
  const [barcode, setBarcode] = useState(normalizedInitialCode);
  const [designation, setDesignation] = useState(params.ocrDesignation ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(params.photoUri);
  const [quantity, setQuantity] = useState('1');
  const [supplier, setSupplier] = useState('');
  const [lastSupplier, setLastSupplier] = useState('');
  const [lastLocation, setLastLocation] = useState('');
  const [location, setLocation] = useState(params.location ?? '');
  const [locationScanOpen, setLocationScanOpen] = useState(false);
  const [minStock, setMinStock] = useState('0');
  const [destination, setDestination] = useState({ ...EMPTY_INVENTORY_DESTINATION });
  const [companyId, setCompanyId] = useState<string | undefined>();
  const [companyName, setCompanyName] = useState('');
  const [personName, setPersonName] = useState('');
  const [comment, setComment] = useState('');
  const [allowNegative, setAllowNegative] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ before: number; after: number; queued: boolean } | null>(null);
  const [barcodeLookup, setBarcodeLookup] = useState<BarcodeLookupState>({ status: 'idle' });

  const selectedProduct = useMemo(() => {
    if (productId) return inventory.products.find(product => product.id === productId);
    const normalized = normalizeInventoryReference(reference);
    const canonicalBarcode = canonicalizeGtin(barcode || reference);
    if (!normalized && !barcode && !canonicalBarcode) return undefined;
    return inventory.products.find(product =>
      (!!normalized && normalizeInventoryReference(product.reference) === normalized)
      || (!!barcode && product.barcode === barcode)
      || (!!canonicalBarcode && canonicalizeGtin(product.barcode ?? product.reference) === canonicalBarcode),
    );
  }, [barcode, inventory.products, productId, reference]);

  useEffect(() => {
    if (initialApplied.current || !inventory.products.length) return;
    const initial = params.productId
      ? inventory.products.find(product => product.id === params.productId)
      : params.code
        ? inventory.findProduct(params.code)
        : undefined;
    if (!initial) return;
    initialApplied.current = true;
    selectProduct(initial);
  }, [inventory.products, params.code, params.productId]);

  const lookupCode = useMemo(
    () => normalizeBarcodeLookupCode(barcode || params.code || ''),
    [barcode, params.code],
  );

  useEffect(() => {
    if (selectedProduct || lookupCode.length < 4) {
      if (selectedProduct || lookupCode.length < 4) setBarcodeLookup({ status: 'idle' });
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      const applyLookupMatch = (match: InventoryBarcodeMatch) => {
        if (!active) return;
        setBarcodeLookup({ status: 'found', match });
        setDesignation(current => designationEdited.current ? current : match.designation);
        if (match.brand) {
          setSupplier(current => supplierEdited.current ? current : match.brand ?? current);
        }
        if (match.photoUrl) {
          setPhotoUrl(current => current ?? match.photoUrl);
        }
      };

      setBarcodeLookup({ status: 'searching' });
      void lookupInventoryBarcode(lookupCode, {
        language: i18n.resolvedLanguage ?? i18n.language ?? 'fr',
        onPartialMatch: applyLookupMatch,
      }).then(match => {
        if (!active) return;
        if (!match) {
          setBarcodeLookup({ status: 'not-found' });
          return;
        }
        applyLookupMatch(match);
      }).catch(() => {
        if (active) setBarcodeLookup({ status: 'not-found' });
      });
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [i18n.language, i18n.resolvedLanguage, lookupCode, selectedProduct]);

  const suggestions = useMemo(() => {
    const needle = reference.trim().toLowerCase();
    if (!needle || selectedProduct) return [];
    const normalized = normalizeInventoryReference(reference);
    return inventory.products.filter(product =>
      product.reference.toLowerCase().includes(needle)
      || normalizeInventoryReference(product.reference).includes(normalized)
      || product.designation.toLowerCase().includes(needle)
      || product.barcode?.includes(reference.trim()),
    ).slice(0, 4);
  }, [inventory.products, reference, selectedProduct]);

  const destinationCatalog = useMemo(
    () => createInventoryDestinationCatalog(activeChantier?.buildings),
    [activeChantier?.buildings],
  );
  const buildings = destinationCatalog.buildings;
  const { buildingId, buildingName, zoneId, zoneName } = destination;
  const zones = useMemo(
    () => inventoryDestinationZones(destinationCatalog, buildingId),
    [buildingId, destinationCatalog],
  );

  const knownSuppliers = useMemo(
    () => collectInventoryLabels([lastSupplier, ...inventory.products.map(product => product.supplier)], supplier),
    [inventory.products, lastSupplier, supplier],
  );
  const knownLocations = useMemo(
    () => collectInventoryLabels([lastLocation, params.location, ...inventory.products.map(product => product.location)], location),
    [inventory.products, lastLocation, location, params.location],
  );

  useEffect(() => {
    const chantierId = activeChantier?.id;
    if (!chantierId) return;
    void AsyncStorage.multiGet([
      `buildtrack-inventory-last-supplier-${chantierId}`,
      `buildtrack-inventory-last-location-${chantierId}`,
    ]).then(entries => {
      const rememberedSupplier = entries[0][1]?.trim() || '';
      const rememberedLocation = entries[1][1]?.trim() || '';
      if (rememberedSupplier) {
        setLastSupplier(rememberedSupplier);
        if (!supplierEdited.current) setSupplier(current => preferInventoryLabel(current, rememberedSupplier));
      }
      if (rememberedLocation) {
        setLastLocation(rememberedLocation);
        if (!locationEdited.current) setLocation(current => preferInventoryLabel(current, rememberedLocation));
      }
    });
  }, [activeChantier?.id]);

  const companyOptions = useMemo(() => {
    const known = new Set(companies.map(company => company.name.toLowerCase()));
    return [
      ...companies.map(company => ({ id: company.id, name: company.name })),
      ...DEFAULT_COMPANIES.filter(name => !known.has(name.toLowerCase())).map(name => ({ id: `preset-${name}`, name })),
    ];
  }, [companies]);

  const numericQuantity = Number(quantity.replace(',', '.'));
  const stockBefore = selectedProduct?.currentStock ?? 0;
  const projectedStock = Number.isFinite(numericQuantity) && numericQuantity > 0
    ? mode === 'in' ? stockBefore + numericQuantity : stockBefore - numericQuantity
    : stockBefore;
  const insufficient = mode === 'out' && numericQuantity > 0 && projectedStock < 0;
  const negativeAllowed = allowNegative && permissions.canAdjustInventory;
  const insufficientBlocksSubmit = mode === 'out' && shouldBlockInventoryMovementForInsufficientStock({
    stockAfter: projectedStock,
    negativeAllowed,
    isOnline,
    isServerConfigured: isSupabaseConfigured,
  });
  const serverWillVerifyStock = insufficient
    && !negativeAllowed
    && isOnline
    && isSupabaseConfigured;

  function selectProduct(product: typeof inventory.products[number]) {
    setBarcodeLookup({ status: 'idle' });
    setProductId(product.id);
    setReference(product.reference);
    setBarcode(product.barcode ?? params.code ?? '');
    setDesignation(product.designation);
    setPhotoUrl(current => current ?? product.photoUrl);
    setSupplier(product.supplier?.trim() || (supplierEdited.current ? supplier : lastSupplier));
    setLocation(resolveInventoryStorageLocation({
      scannedLocation: params.location,
      productLocation: product.location,
      edited: locationEdited.current,
      current: location,
    }));
    setMinStock(String(product.minStock));
  }

  function handleReferenceChange(value: string) {
    setReference(value);
    setProductId(undefined);
  }

  function handleDesignationChange(value: string) {
    designationEdited.current = true;
    setDesignation(value);
  }

  function handleSupplierChange(value: string) {
    supplierEdited.current = true;
    setSupplier(value);
  }

  function pickSupplier(value: string) {
    supplierEdited.current = true;
    setSupplier(value);
  }

  function pickLocation(value: string) {
    locationEdited.current = true;
    setLocation(value);
  }

  function bumpQuantity(delta: number) {
    setQuantity(current => {
      const value = Number(String(current).replace(',', '.'));
      const next = (Number.isFinite(value) ? value : 0) + delta;
      return String(Math.max(0, Math.round(next * 1000) / 1000));
    });
  }

  function handleBarcodeChange(value: string) {
    setBarcode(value);
    if (productId && value !== selectedProduct?.barcode) setProductId(undefined);
  }

  function openLookupSource(url: string | undefined) {
    if (url) void Linking.openURL(url);
  }

  function searchBarcodeOnInternet() {
    if (lookupCode) void Linking.openURL(inventoryBarcodeWebSearchUrl(lookupCode));
  }

  function lookupSourceLabel(match: InventoryBarcodeMatch): string {
    if (match.source === 'open-products-facts') return 'Open Products Facts';
    if (match.source === 'open-food-facts') return 'Open Food Facts';
    if (match.source === 'upcitemdb') return 'UPCitemdb';
    return copy.internet;
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(copy.error, copy.cameraPermission);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
    if (!result.canceled && result.assets[0]?.uri) setPhotoUrl(await persistLocalPhoto(result.assets[0].uri));
  }

  function validate(): string | null {
    if (!activeChantier) return copy.noSite;
    if (!reference.trim()) return copy.referenceRequired;
    if (mode === 'out' && !selectedProduct) return copy.productNotInStock;
    if (!selectedProduct && mode === 'in' && !designation.trim()) return copy.designationRequired;
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) return copy.quantityRequired;
    if (mode === 'in' && !location.trim()) return copy.locationRequired;
    if (destinationPolicy.buildingRequired && !buildingName.trim()) return copy.destinationRequired;
    if (insufficientBlocksSubmit) return copy.negativeWarning;
    return null;
  }

  async function performSubmit() {
    const error = validate();
    if (error || !activeChantier) {
      Alert.alert(copy.error, error ?? copy.noSite);
      return;
    }
    setSubmitting(true);
    try {
      const movementDestination = toInventoryMovementDestination(destination);
      const result = await inventory.recordMovement({
        chantierId: activeChantier.id,
        movementType: mode,
        quantity: numericQuantity,
        productId: selectedProduct?.id ?? productId,
        reference: selectedProduct?.reference ?? reference.trim(),
        designation: selectedProduct?.designation ?? designation.trim(),
        barcode: barcode.trim() || undefined,
        photoUrl,
        minStock: Number(minStock.replace(',', '.')) || 0,
        location: location.trim() || undefined,
        supplier: supplier.trim() || undefined,
        buildingId: movementDestination.building_id ?? undefined,
        buildingName: movementDestination.building_name ?? undefined,
        zoneId: movementDestination.zone_id ?? undefined,
        zoneName: movementDestination.zone_name ?? undefined,
        companyId,
        companyName: companyName.trim() || undefined,
        personName: personName.trim() || undefined,
        comment: comment.trim() || undefined,
        allowNegative,
      });
      if (activeChantier && mode === 'in') {
        const pairs: [string, string][] = [];
        if (supplier.trim()) pairs.push([`buildtrack-inventory-last-supplier-${activeChantier.id}`, supplier.trim()]);
        if (location.trim()) pairs.push([`buildtrack-inventory-last-location-${activeChantier.id}`, location.trim()]);
        if (pairs.length) void AsyncStorage.multiSet(pairs);
      }
      setSuccess({ before: result.movement.stockBefore, after: result.movement.stockAfter, queued: result.queued });
    } catch (operationError: any) {
      Alert.alert(copy.error, operationError?.message ?? String(operationError));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit() {
    const error = validate();
    if (error) {
      Alert.alert(copy.error, error);
      return;
    }
    if (insufficient && allowNegative) {
      Alert.alert(copy.confirmNegativeTitle, copy.confirmNegative.replace('{{stock}}', String(projectedStock)), [
        { text: copy.cancel, style: 'cancel' },
        { text: copy.confirm, style: 'destructive', onPress: performSubmit },
      ]);
      return;
    }
    void performSubmit();
  }

  if (!permissions.canRecordInventory) {
    return <View style={styles.root}><Header title={mode === 'in' ? copy.newEntry : copy.newExit} showBack backFallback="/inventory" /><View style={styles.center}><Text style={styles.centerText}>{copy.restricted}</Text></View></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title={mode === 'in' ? copy.newEntry : copy.newExit} subtitle={activeChantier?.name} showBack backFallback="/inventory" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]} keyboardShouldPersistTaps="handled">
        <View style={[styles.modeBanner, { backgroundColor: mode === 'in' ? C.closedBg : C.openBg }]}>
          <Ionicons name={mode === 'in' ? 'arrow-down-circle' : 'arrow-up-circle'} size={24} color={mode === 'in' ? C.closed : C.open} />
          <Text style={[styles.modeText, { color: mode === 'in' ? C.closed : C.open }]}>{mode === 'in' ? copy.entry : copy.exit}</Text>
          <TouchableOpacity style={styles.scanAgain} onPress={() => router.replace(`/inventory/scan?mode=${mode}` as any)}>
            <Ionicons name="scan-outline" size={17} color={C.primary} /><Text style={styles.scanAgainText}>{copy.rescan}</Text>
          </TouchableOpacity>
        </View>
        {mode === 'out' ? (
          <View style={[styles.pickBanner, !(location || selectedProduct?.location) && styles.pickBannerMissing]}>
            <Ionicons name="location" size={26} color={(location || selectedProduct?.location) ? C.primary : C.waiting} />
            <View style={{ flex: 1 }}>
              <Text style={styles.pickLabel}>{copy.pickFrom}</Text>
              <Text style={styles.pickValue}>{location || selectedProduct?.location || copy.pickLocationMissing}</Text>
              <Text style={styles.sectionHint}>{copy.pickFromHint}</Text>
            </View>
            <View style={styles.pickActions}>
              {(location || selectedProduct?.location) ? (
                <TouchableOpacity style={styles.pickAction} onPress={() => setLocationScanOpen(true)}>
                  <Text style={styles.pickActionText}>{copy.otherLocation}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.pickActionPrimary} onPress={() => setLocationScanOpen(true)}>
                  <Text style={styles.pickActionPrimaryText}>{copy.setLocation}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{copy.product}</Text>
          <Field label={copy.reference}>
            <View style={styles.inputWithIcon}>
              <TextInput style={styles.inputFlex} value={reference} onChangeText={handleReferenceChange} placeholder="ABC-12580" placeholderTextColor={C.textMuted} autoCapitalize="characters" autoCorrect={false} />
              <Ionicons name="barcode-outline" size={21} color={C.textMuted} />
            </View>
          </Field>
          {suggestions.map(product => <InventoryProductCard key={product.id} product={product} compact onPress={() => selectProduct(product)} />)}
          {selectedProduct ? (
            <View style={styles.foundBox}><Ionicons name="checkmark-circle" size={18} color={C.closed} /><Text style={styles.foundText}>{copy.knownProduct}</Text></View>
          ) : (
            <View style={styles.lookupStack}>
              <View style={styles.foundBox}><Ionicons name="add-circle-outline" size={18} color={C.primary} /><Text style={[styles.foundText, { color: C.primary }]}>{copy.newProduct}</Text></View>
              {barcodeLookup.status === 'searching' && (
                <View style={styles.lookupBox}>
                  <ActivityIndicator size="small" color={C.primary} />
                  <Text style={styles.lookupText}>{copy.lookupSearching}</Text>
                </View>
              )}
              {barcodeLookup.status === 'found' && (
                <View style={[
                  styles.lookupBox,
                  barcodeLookup.match.variantComplete ? styles.lookupFound : styles.lookupIncomplete,
                ]}>
                  <Ionicons
                    name={barcodeLookup.match.variantComplete ? 'globe-outline' : 'warning-outline'}
                    size={18}
                    color={barcodeLookup.match.variantComplete ? C.closed : C.waiting}
                  />
                  <View style={styles.lookupTextWrap}>
                    <Text style={[
                      styles.lookupText,
                      { color: barcodeLookup.match.variantComplete ? C.closed : C.waiting },
                    ]}>
                      {barcodeLookup.match.variantComplete ? copy.lookupFound : copy.lookupFoundIncomplete}
                    </Text>
                    <Text style={styles.lookupSource}>{lookupSourceLabel(barcodeLookup.match)}</Text>
                  </View>
                  {barcodeLookup.match.variantComplete && !!barcodeLookup.match.sourceUrl && (
                    <TouchableOpacity onPress={() => openLookupSource(barcodeLookup.match.sourceUrl)} style={styles.lookupLink}>
                      <Text style={styles.lookupLinkText}>{copy.viewSource}</Text>
                    </TouchableOpacity>
                  )}
                  {!barcodeLookup.match.variantComplete && (
                    <TouchableOpacity onPress={searchBarcodeOnInternet} style={styles.lookupLink}>
                      <Text style={styles.lookupLinkText}>{copy.searchInternet}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {barcodeLookup.status === 'not-found' && (
                <View style={styles.lookupBox}>
                  <Ionicons name="information-circle-outline" size={18} color={C.textSub} />
                  <Text style={[styles.lookupText, { flex: 1 }]}>{copy.lookupNotFound}</Text>
                  <TouchableOpacity onPress={searchBarcodeOnInternet} style={styles.lookupLink}>
                    <Text style={styles.lookupLinkText}>{copy.searchInternet}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          <Field label={copy.designation}>
            <TextInput
              style={[styles.input, styles.designationInput]}
              value={designation}
              onChangeText={handleDesignationChange}
              editable={!selectedProduct}
              placeholder="Vanne DN25"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
          </Field>
          <Field label={copy.barcode} optional={copy.optional}>
            <TextInput style={styles.input} value={barcode} onChangeText={handleBarcodeChange} editable={!selectedProduct} placeholder="EAN, QR, Code 128…" placeholderTextColor={C.textMuted} autoCapitalize="none" autoCorrect={false} />
          </Field>
          <TouchableOpacity style={styles.photoButton} onPress={takePhoto}>
            {photoUrl ? <MediaImage source={{ uri: photoUrl }} style={styles.photoPreview} /> : <View style={styles.photoPlaceholder}><Ionicons name="camera-outline" size={25} color={C.primary} /></View>}
            <Text style={styles.photoButtonText}>{photoUrl ? copy.changePhoto : copy.addPhoto}</Text>
            <Ionicons name="chevron-forward" size={17} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{copy.quantity}</Text>
          <View style={styles.quantityRow}>
            <View style={styles.stockSummary}><Text style={styles.stockSummaryLabel}>{copy.currentStock}</Text><Text style={styles.stockSummaryValue}>{stockBefore}</Text></View>
            <Ionicons name="arrow-forward" size={20} color={C.textMuted} />
            <View style={styles.quantityStepper}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => bumpQuantity(-1)} accessibilityLabel="-1">
                <Ionicons name="remove" size={18} color={C.text} />
              </TouchableOpacity>
              <TextInput style={[styles.quantityInput, insufficient && styles.inputDanger]} value={quantity} onChangeText={setQuantity} placeholder="0" placeholderTextColor={C.textMuted} keyboardType="decimal-pad" selectTextOnFocus />
              <TouchableOpacity style={styles.stepperBtn} onPress={() => bumpQuantity(1)} accessibilityLabel="+1">
                <Ionicons name="add" size={18} color={C.text} />
              </TouchableOpacity>
            </View>
            <Ionicons name="arrow-forward" size={20} color={C.textMuted} />
            <View style={[styles.stockSummary, insufficient && styles.stockSummaryDanger]}><Text style={styles.stockSummaryLabel}>{copy.afterMovement}</Text><Text style={[styles.stockSummaryValue, insufficient && { color: C.open }]}>{projectedStock}</Text></View>
          </View>
          {insufficient && (
            <View style={styles.warningBox}>
              <Ionicons name="warning" size={20} color={C.open} />
              <View style={{ flex: 1 }}><Text style={styles.warningTitle}>{copy.insufficient}</Text><Text style={styles.warningText}>{serverWillVerifyStock ? copy.serverStockCheck : copy.negativeWarning}</Text></View>
            </View>
          )}
          {insufficient && permissions.canAdjustInventory && (
            <TouchableOpacity style={styles.checkRow} onPress={() => setAllowNegative(value => !value)}>
              <Ionicons name={allowNegative ? 'checkbox' : 'square-outline'} size={23} color={allowNegative ? C.open : C.textMuted} />
              <Text style={styles.checkText}>{copy.allowNegative}</Text>
            </TouchableOpacity>
          )}
        </View>

        {mode === 'in' && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{copy.storeHere}</Text>
            <Text style={styles.sectionHint}>{copy.storeHereHint}</Text>
            <Field label={copy.supplier} optional={copy.optional}>
              <TextInput style={styles.input} value={supplier} onChangeText={handleSupplierChange} placeholder={copy.supplier} placeholderTextColor={C.textMuted} />
              {knownSuppliers.length > 0 ? (
                <View style={styles.chipWrap}>
                  {knownSuppliers.map(name => (
                    <Chip key={name} selected={supplier.trim().toLocaleLowerCase() === name.toLocaleLowerCase()} label={name} onPress={() => pickSupplier(name)} />
                  ))}
                </View>
              ) : null}
            </Field>
            <Field label={copy.location} required>
              <View style={styles.inputWithIcon}>
                <TextInput
                  style={styles.inputFlex}
                  value={location}
                  onChangeText={value => { locationEdited.current = true; setLocation(value); }}
                  placeholder="A-12"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="characters"
                />
                <TouchableOpacity style={styles.scanFieldButton} onPress={() => setLocationScanOpen(true)} accessibilityLabel={copy.scanShelf}>
                  <Ionicons name="scan-outline" size={18} color="#fff" />
                  <Text style={styles.scanFieldText}>{copy.scanShelf}</Text>
                </TouchableOpacity>
              </View>
              {knownLocations.length > 0 ? (
                <View style={styles.chipWrap}>
                  {knownLocations.map(name => (
                    <Chip key={name} selected={location.trim().toLocaleLowerCase() === name.toLocaleLowerCase()} label={name} onPress={() => pickLocation(name)} />
                  ))}
                </View>
              ) : null}
            </Field>
          </View>
        )}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{mode === 'in' ? copy.receivedAt : copy.dispatchLogistics}</Text>
          <Text style={styles.sectionHint}>{mode === 'in' ? copy.entryDestinationHint : copy.exitDestinationHint}</Text>
          <Field label={mode === 'in' ? copy.entryBuilding : copy.exitBuilding} optional={mode === 'in' ? copy.optional : undefined} required={mode === 'out'}>
            <TextInput
              style={styles.input}
              value={buildingName}
              onChangeText={value => setDestination(current => transitionInventoryDestination(destinationCatalog, current, { type: 'edit-building', buildingName: value }))}
              placeholder={mode === 'in' ? copy.entryBuilding : copy.exitBuilding}
              placeholderTextColor={C.textMuted}
            />
          </Field>
          {buildings.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {buildings.map(building => (
                <Chip
                  key={building.id}
                  label={building.name}
                  selected={buildingId === building.id}
                  onPress={() => setDestination(current => transitionInventoryDestination(destinationCatalog, current, { type: 'select-building', buildingId: building.id }))}
                />
              ))}
            </ScrollView>
          )}
          <Field label={copy.zone} optional={copy.optional}>
            <TextInput
              style={[styles.input, !buildingName.trim() && styles.inputDisabled]}
              value={zoneName}
              onChangeText={value => setDestination(current => transitionInventoryDestination(destinationCatalog, current, { type: 'edit-zone', zoneName: value }))}
              placeholder={buildingName.trim() ? copy.zone : copy.chooseBuildingFirst}
              placeholderTextColor={C.textMuted}
              editable={Boolean(buildingName.trim())}
              accessibilityState={{ disabled: !buildingName.trim() }}
            />
          </Field>
          {zones.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {zones.map(zone => (
                <Chip
                  key={zone.id}
                  label={zone.label}
                  selected={zoneId === zone.id}
                  onPress={() => setDestination(current => transitionInventoryDestination(destinationCatalog, current, { type: 'select-zone', zoneId: zone.id }))}
                />
              ))}
            </ScrollView>
          )}
          {mode === 'out' && <>
            <Field label={copy.company} optional={copy.optional}><TextInput style={styles.input} value={companyName} onChangeText={value => { setCompanyName(value); setCompanyId(undefined); }} placeholder={copy.company} placeholderTextColor={C.textMuted} /></Field>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{companyOptions.map(company => <Chip key={company.id} label={company.name} selected={companyName === company.name} onPress={() => { setCompanyId(company.id.startsWith('preset-') ? undefined : company.id); setCompanyName(company.name); }} />)}</ScrollView>
            <Field label={copy.person} optional={copy.optional}><TextInput style={styles.input} value={personName} onChangeText={setPersonName} placeholder={copy.person} placeholderTextColor={C.textMuted} /></Field>
          </>}
          {!selectedProduct && mode === 'in' && <Field label={copy.minimumStock} optional={copy.optional}><TextInput style={styles.input} value={minStock} onChangeText={setMinStock} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.textMuted} /></Field>}
          <Field label={copy.comment} optional={copy.optional}><TextInput style={[styles.input, styles.textArea]} value={comment} onChangeText={setComment} placeholder={copy.comment} placeholderTextColor={C.textMuted} multiline textAlignVertical="top" /></Field>
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TouchableOpacity style={[styles.submitButton, { backgroundColor: mode === 'in' ? C.closed : C.open }, submitting && styles.disabled]} onPress={handleSubmit} disabled={submitting} activeOpacity={0.82}>
          {submitting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark-circle" size={22} color="#fff" /><Text style={styles.submitText}>{mode === 'in' ? copy.validateEntry : copy.validateExit}</Text></>}
        </TouchableOpacity>
      </View>
      {success ? (
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <Ionicons name="checkmark-circle" size={42} color={C.closed} />
            <Text style={styles.successTitle}>{copy.movementSaved}</Text>
            <Text style={styles.successMeta}>{success.before} → {success.after}</Text>
            <Text style={styles.sectionHint}>{success.queued ? copy.queued : copy.synchronized}</Text>
            <TouchableOpacity style={styles.successPrimary} onPress={() => router.replace(`/inventory/scan?mode=${mode}` as any)}>
              <Text style={styles.successPrimaryText}>{copy.scanNext}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.successSecondary} onPress={() => router.replace('/inventory' as any)}>
              <Text style={styles.successSecondaryText}>{copy.backHome}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
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
        onClose={() => setLocationScanOpen(false)}
        onDetected={code => {
          locationEdited.current = true;
          setLocation(code);
          setLocationScanOpen(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }, centerText: { color: C.text, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  content: { padding: 14, gap: 12 },
  modeBanner: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 14 }, modeText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  pickBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 16, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: `${C.primary}30` },
  pickBannerMissing: { backgroundColor: C.waitingBg, borderColor: `${C.waiting}30` },
  pickLabel: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 10, textTransform: 'uppercase' },
  pickValue: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 22, marginTop: 2 },
  pickActions: { gap: 8 },
  pickAction: { minHeight: 40, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pickActionText: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 11 },
  pickActionPrimary: { minHeight: 40, paddingHorizontal: 12, borderRadius: 11, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  pickActionPrimaryText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 11 },
  scanFieldButton: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  scanFieldText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 10 },
  successOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,20,48,0.46)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  successCard: { width: '100%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 20, padding: 22, alignItems: 'center', gap: 8 },
  successTitle: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 18 },
  successMeta: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 22 },
  successPrimary: { width: '100%', minHeight: 50, borderRadius: 14, backgroundColor: C.closed, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  successPrimaryText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 14 },
  successSecondary: { width: '100%', minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  successSecondaryText: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  scanAgain: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 }, scanAgainText: { color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  sectionCard: { backgroundColor: C.surface, borderRadius: 17, borderWidth: 1, borderColor: C.border, padding: 15, gap: 12 },
  sectionTitle: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 16 },
  sectionHint: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  field: { gap: 6 }, fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, fieldLabel: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase' }, optional: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 10 },
  input: { minHeight: 47, backgroundColor: C.inputBg, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 13, color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14 },
  designationInput: { minHeight: 72, paddingTop: 11, paddingBottom: 11 },
  inputWithIcon: { minHeight: 47, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.inputBg, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 13 }, inputFlex: { flex: 1, color: C.text, fontFamily: 'Inter_600SemiBold', fontSize: 15, paddingVertical: 0 },
  foundBox: { flexDirection: 'row', alignItems: 'center', gap: 6 }, foundText: { color: C.closed, fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  lookupStack: { gap: 8 },
  lookupBox: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 11, backgroundColor: C.surface2, paddingHorizontal: 10, paddingVertical: 8 },
  lookupFound: { backgroundColor: C.closedBg }, lookupIncomplete: { backgroundColor: C.waitingBg }, lookupTextWrap: { flex: 1 },
  lookupText: { color: C.textSub, fontFamily: 'Inter_500Medium', fontSize: 10, lineHeight: 14 },
  lookupSource: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 9, marginTop: 1 },
  lookupLink: { borderRadius: 9, backgroundColor: '#fff', paddingHorizontal: 9, paddingVertical: 7 },
  lookupLinkText: { color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 9 },
  photoButton: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 8 }, photoPreview: { width: 48, height: 48, borderRadius: 9 }, photoPlaceholder: { width: 48, height: 48, borderRadius: 9, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' }, photoButtonText: { flex: 1, color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, stockSummary: { flex: 1, minWidth: 65, backgroundColor: C.surface2, borderRadius: 12, padding: 9, alignItems: 'center' }, stockSummaryDanger: { backgroundColor: C.openBg }, stockSummaryLabel: { color: C.textSub, fontFamily: 'Inter_500Medium', fontSize: 8, textTransform: 'uppercase', textAlign: 'center' }, stockSummaryValue: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 20, marginTop: 2 }, quantityStepper: { flexDirection: 'row', alignItems: 'center', gap: 4 }, stepperBtn: { width: 36, height: 44, borderRadius: 11, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' }, quantityInput: { width: 64, height: 56, borderRadius: 13, borderWidth: 2, borderColor: C.primary, backgroundColor: '#fff', color: C.text, fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' }, inputDanger: { borderColor: C.open, color: C.open },
  warningBox: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', borderRadius: 12, backgroundColor: C.openBg, padding: 11 }, warningTitle: { color: C.open, fontFamily: 'Inter_700Bold', fontSize: 12 }, warningText: { color: C.open, fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 2 }, checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 3 }, checkText: { flex: 1, color: C.open, fontFamily: 'Inter_500Medium', fontSize: 12 },
  chips: { gap: 7, paddingRight: 8 }, chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 }, chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 22, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface }, chipSelected: { borderColor: C.primary, backgroundColor: C.primaryBg }, chipText: { color: C.textSub, fontFamily: 'Inter_500Medium', fontSize: 11 }, chipTextSelected: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  textArea: { minHeight: 84, paddingTop: 12 },
  inputDisabled: { opacity: 0.5, backgroundColor: C.surface2 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 10, backgroundColor: 'rgba(244,247,251,0.96)', borderTopWidth: 1, borderTopColor: C.border }, submitButton: { minHeight: 54, borderRadius: 15, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, submitText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 14, letterSpacing: 0.3 }, disabled: { opacity: 0.6 },
});
