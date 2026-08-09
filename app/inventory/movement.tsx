import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Header from '@/components/Header';
import { InventoryProductCard } from '@/components/inventory/InventoryCards';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useInventory, normalizeInventoryReference } from '@/hooks/queries/useInventory';
import { persistLocalPhoto } from '@/lib/storage';
import { useInventoryCopy } from '@/lib/inventoryI18n';
import {
  inventoryBarcodeWebSearchUrl,
  lookupInventoryBarcode,
  type InventoryBarcodeMatch,
} from '@/lib/inventoryBarcodeLookup';
import { canonicalizeGtin, normalizeBarcodeLookupCode } from '@/lib/inventoryBarcodeCore';

const DEFAULT_BUILDINGS = [
  'Service Building', 'Guestblock', 'One Bedroom', 'Residence', 'Arrival',
  'Events', 'SPA', 'Villas', 'Utility Compound',
];
const DEFAULT_COMPANIES = ['INICA', 'Grupo Eléctrico', 'Symantel', 'Acabados'];

type BarcodeLookupState =
  | { status: 'idle' | 'searching' | 'not-found' }
  | { status: 'found'; match: InventoryBarcodeMatch };

function Field({ label, optional, children }: { label: string; optional?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}><Text style={styles.fieldLabel}>{label}</Text>{!!optional && <Text style={styles.optional}>{optional}</Text>}</View>
      {children}
    </View>
  );
}

function Chip({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={onPress} activeOpacity={0.72}>
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
  }>();
  const mode = params.mode === 'out' ? 'out' : 'in';
  const { activeChantier, companies } = useApp();
  const { permissions } = useAuth();
  const inventory = useInventory(activeChantier?.id, activeChantier?.organizationId);
  const initialApplied = useRef(false);
  const normalizedInitialCode = normalizeBarcodeLookupCode(params.code ?? '');
  const designationEdited = useRef(Boolean(params.ocrDesignation?.trim()));
  const supplierEdited = useRef(false);

  const [productId, setProductId] = useState<string | undefined>(params.productId);
  const [reference, setReference] = useState(params.ocrReference ?? normalizedInitialCode);
  const [barcode, setBarcode] = useState(normalizedInitialCode);
  const [designation, setDesignation] = useState(params.ocrDesignation ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(params.photoUri);
  const [quantity, setQuantity] = useState('');
  const [supplier, setSupplier] = useState('');
  const [location, setLocation] = useState('');
  const [minStock, setMinStock] = useState('0');
  const [buildingId, setBuildingId] = useState<string | undefined>();
  const [buildingName, setBuildingName] = useState('');
  const [zoneId, setZoneId] = useState<string | undefined>();
  const [zoneName, setZoneName] = useState('');
  const [companyId, setCompanyId] = useState<string | undefined>();
  const [companyName, setCompanyName] = useState('');
  const [personName, setPersonName] = useState('');
  const [comment, setComment] = useState('');
  const [allowNegative, setAllowNegative] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
      setBarcodeLookup({ status: 'searching' });
      void lookupInventoryBarcode(lookupCode, {
        language: i18n.resolvedLanguage ?? i18n.language ?? 'fr',
      }).then(match => {
        if (!active) return;
        if (!match) {
          setBarcodeLookup({ status: 'not-found' });
          return;
        }
        setBarcodeLookup({ status: 'found', match });
        setDesignation(current => designationEdited.current || current.trim() ? current : match.designation);
        if (match.brand) {
          setSupplier(current => supplierEdited.current || current.trim() ? current : match.brand ?? current);
        }
        if (match.photoUrl) {
          setPhotoUrl(current => current ?? match.photoUrl);
        }
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

  const buildings = useMemo(() => {
    const projectBuildings = activeChantier?.buildings ?? [];
    const known = new Set(projectBuildings.map(building => building.name.toLowerCase()));
    return [
      ...projectBuildings.map(building => ({ id: building.id, name: building.name, source: building })),
      ...DEFAULT_BUILDINGS.filter(name => !known.has(name.toLowerCase())).map(name => ({ id: `preset-${name}`, name, source: undefined })),
    ];
  }, [activeChantier?.buildings]);

  const zones = useMemo(() => {
    const building = activeChantier?.buildings?.find(item => item.id === buildingId);
    if (!building) return [];
    return building.levels.flatMap(level => level.zones.map(zone => ({ id: zone.id, name: zone.name, level: level.name })));
  }, [activeChantier?.buildings, buildingId]);

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

  function selectProduct(product: typeof inventory.products[number]) {
    setBarcodeLookup({ status: 'idle' });
    setProductId(product.id);
    setReference(product.reference);
    setBarcode(product.barcode ?? params.code ?? '');
    setDesignation(product.designation);
    setPhotoUrl(current => current ?? product.photoUrl);
    setSupplier(product.supplier ?? '');
    setLocation(product.location ?? '');
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
    if (mode === 'out' && !buildingName.trim()) return copy.destinationRequired;
    if (insufficient && !(allowNegative && permissions.canAdjustInventory)) return copy.negativeWarning;
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
        buildingId,
        buildingName: buildingName.trim() || undefined,
        zoneId,
        zoneName: zoneName.trim() || undefined,
        companyId,
        companyName: companyName.trim() || undefined,
        personName: personName.trim() || undefined,
        comment: comment.trim() || undefined,
        allowNegative,
      });
      Alert.alert(
        copy.movementSaved,
        `${copy.currentStock}: ${result.movement.stockBefore}\n${mode === 'in' ? '+' : '−'}${numericQuantity}\n${copy.afterMovement}: ${result.movement.stockAfter}\n\n${result.queued ? copy.queued : copy.synchronized}`,
        [{ text: 'OK', onPress: () => router.replace('/inventory' as any) }],
      );
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
            <TextInput style={styles.input} value={designation} onChangeText={handleDesignationChange} editable={!selectedProduct} placeholder="Vanne DN25" placeholderTextColor={C.textMuted} />
          </Field>
          <Field label={copy.barcode} optional={copy.optional}>
            <TextInput style={styles.input} value={barcode} onChangeText={handleBarcodeChange} editable={!selectedProduct} placeholder="EAN, QR, Code 128…" placeholderTextColor={C.textMuted} autoCapitalize="none" autoCorrect={false} />
          </Field>
          <TouchableOpacity style={styles.photoButton} onPress={takePhoto}>
            {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.photoPreview} /> : <View style={styles.photoPlaceholder}><Ionicons name="camera-outline" size={25} color={C.primary} /></View>}
            <Text style={styles.photoButtonText}>{photoUrl ? copy.changePhoto : copy.addPhoto}</Text>
            <Ionicons name="chevron-forward" size={17} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{copy.quantity}</Text>
          <View style={styles.quantityRow}>
            <View style={styles.stockSummary}><Text style={styles.stockSummaryLabel}>{copy.currentStock}</Text><Text style={styles.stockSummaryValue}>{stockBefore}</Text></View>
            <Ionicons name="arrow-forward" size={20} color={C.textMuted} />
            <TextInput style={[styles.quantityInput, insufficient && styles.inputDanger]} value={quantity} onChangeText={setQuantity} placeholder="0" placeholderTextColor={C.textMuted} keyboardType="decimal-pad" selectTextOnFocus />
            <Ionicons name="arrow-forward" size={20} color={C.textMuted} />
            <View style={[styles.stockSummary, insufficient && styles.stockSummaryDanger]}><Text style={styles.stockSummaryLabel}>{copy.afterMovement}</Text><Text style={[styles.stockSummaryValue, insufficient && { color: C.open }]}>{projectedStock}</Text></View>
          </View>
          {insufficient && (
            <View style={styles.warningBox}>
              <Ionicons name="warning" size={20} color={C.open} />
              <View style={{ flex: 1 }}><Text style={styles.warningTitle}>{copy.insufficient}</Text><Text style={styles.warningText}>{copy.negativeWarning}</Text></View>
            </View>
          )}
          {insufficient && permissions.canAdjustInventory && (
            <TouchableOpacity style={styles.checkRow} onPress={() => setAllowNegative(value => !value)}>
              <Ionicons name={allowNegative ? 'checkbox' : 'square-outline'} size={23} color={allowNegative ? C.open : C.textMuted} />
              <Text style={styles.checkText}>{copy.allowNegative}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{mode === 'in' ? copy.supplier : copy.destination}</Text>
          {mode === 'in' && <Field label={copy.supplier} optional={copy.optional}><TextInput style={styles.input} value={supplier} onChangeText={handleSupplierChange} placeholder={copy.supplier} placeholderTextColor={C.textMuted} /></Field>}
          <Field label={mode === 'in' ? copy.location : copy.destination} optional={mode === 'in' ? copy.optional : undefined}>
            <TextInput style={styles.input} value={mode === 'in' ? location : buildingName} onChangeText={mode === 'in' ? setLocation : value => { setBuildingName(value); setBuildingId(undefined); }} placeholder={mode === 'in' ? copy.location : copy.destination} placeholderTextColor={C.textMuted} />
          </Field>
          {mode === 'in' && <Field label={copy.destination} optional={copy.optional}><TextInput style={styles.input} value={buildingName} onChangeText={value => { setBuildingName(value); setBuildingId(undefined); }} placeholder={copy.destination} placeholderTextColor={C.textMuted} /></Field>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{buildings.map(building => <Chip key={building.id} label={building.name} selected={buildingName === building.name} onPress={() => { setBuildingId(building.source?.id); setBuildingName(building.name); setZoneId(undefined); setZoneName(''); }} />)}</ScrollView>
          {zones.length > 0 && <><Field label={copy.zone} optional={copy.optional}><View /></Field><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{zones.map(zone => <Chip key={zone.id} label={`${zone.level} · ${zone.name}`} selected={zoneId === zone.id} onPress={() => { setZoneId(zone.id); setZoneName(zone.name); }} />)}</ScrollView></>}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }, centerText: { color: C.text, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  content: { padding: 14, gap: 12 },
  modeBanner: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 14 }, modeText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  scanAgain: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 }, scanAgainText: { color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  sectionCard: { backgroundColor: C.surface, borderRadius: 17, borderWidth: 1, borderColor: C.border, padding: 15, gap: 12 },
  sectionTitle: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 16 },
  field: { gap: 6 }, fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, fieldLabel: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase' }, optional: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 10 },
  input: { minHeight: 47, backgroundColor: C.inputBg, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 13, color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14 },
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
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, stockSummary: { flex: 1, minWidth: 65, backgroundColor: C.surface2, borderRadius: 12, padding: 9, alignItems: 'center' }, stockSummaryDanger: { backgroundColor: C.openBg }, stockSummaryLabel: { color: C.textSub, fontFamily: 'Inter_500Medium', fontSize: 8, textTransform: 'uppercase', textAlign: 'center' }, stockSummaryValue: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 20, marginTop: 2 }, quantityInput: { width: 76, height: 56, borderRadius: 13, borderWidth: 2, borderColor: C.primary, backgroundColor: '#fff', color: C.text, fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' }, inputDanger: { borderColor: C.open, color: C.open },
  warningBox: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', borderRadius: 12, backgroundColor: C.openBg, padding: 11 }, warningTitle: { color: C.open, fontFamily: 'Inter_700Bold', fontSize: 12 }, warningText: { color: C.open, fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 2 }, checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 3 }, checkText: { flex: 1, color: C.open, fontFamily: 'Inter_500Medium', fontSize: 12 },
  chips: { gap: 7, paddingRight: 8 }, chip: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface }, chipSelected: { borderColor: C.primary, backgroundColor: C.primaryBg }, chipText: { color: C.textSub, fontFamily: 'Inter_500Medium', fontSize: 11 }, chipTextSelected: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  textArea: { minHeight: 84, paddingTop: 12 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 10, backgroundColor: 'rgba(244,247,251,0.96)', borderTopWidth: 1, borderTopColor: C.border }, submitButton: { minHeight: 54, borderRadius: 15, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, submitText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 14, letterSpacing: 0.3 }, disabled: { opacity: 0.6 },
});
