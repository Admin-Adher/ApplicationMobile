import { useRef, useState, type Ref } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Header from '@/components/Header';
import InventoryWebBarcodeCamera, {
  type InventoryWebBarcodeCameraHandle,
} from '@/components/inventory/InventoryWebBarcodeCamera';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useInventory } from '@/hooks/queries/useInventory';
import { persistLocalPhoto } from '@/lib/storage';
import { useInventoryCopy } from '@/lib/inventoryI18n';
import {
  initialInventoryScanPhase,
  isSameInventoryScanCode,
  nextInventoryScanPhase,
  type InventoryScanPhase,
} from '@/lib/inventoryLocationScan';
import { recognizeInventoryLabel } from '@/lib/inventoryOcr';

type ProductScanPayload = {
  code?: string;
  codeType?: string;
  photoUri?: string;
  ocrReference?: string;
  ocrDesignation?: string;
};

export default function InventoryScanScreen() {
  const router = useRouter();
  const copy = useInventoryCopy();
  const params = useLocalSearchParams<{ mode?: string; target?: string }>();
  const mode = params.mode === 'out' ? 'out' : 'in';
  const target = params.target === 'location' ? 'location' : undefined;
  const { permissions } = useAuth();
  const { activeChantier } = useApp();
  const inventory = useInventory(activeChantier?.id, activeChantier?.organizationId);
  const cameraRef = useRef<CameraView | InventoryWebBarcodeCameraHandle | null>(null);
  const productScan = useRef<ProductScanPayload>({});
  const [phase, setPhase] = useState<InventoryScanPhase>(initialInventoryScanPhase(target));
  const [knownLocation, setKnownLocation] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [armed, setArmed] = useState(false);
  const [torch, setTorch] = useState(false);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const scanningLocation = phase === 'location';
  const confirmingLocation = phase === 'confirm';
  const title = scanningLocation || confirmingLocation ? copy.scanLocation : mode === 'in' ? copy.scanEntry : copy.scanExit;

  function continueAfterProduct(payload: ProductScanPayload) {
    productScan.current = { ...productScan.current, ...payload };
    const existing = inventory.findProduct(payload.code || payload.ocrReference || '')?.location;
    const next = nextInventoryScanPhase({ mode, existingLocation: existing, target });
    if (next === 'complete-product') {
      openMovement(payload);
      return;
    }
    setKnownLocation(existing?.trim() || '');
    setPhase(next);
    setScanned(false);
    setArmed(false);
    setTorch(false);
  }

  function cancelReady() {
    if (scanningLocation && target !== 'location') {
      openMovement();
      return;
    }
    router.back();
  }

  function openMovement(extra?: ProductScanPayload & { location?: string }) {
    router.replace({
      pathname: '/inventory/movement',
      params: { mode, ...productScan.current, ...(extra ?? {}) },
    } as any);
  }

  function handleBarcode(result: BarcodeScanningResult) {
    const code = result.data?.trim();
    if (!armed || scanned || !code) return;
    if (scanningLocation && isSameInventoryScanCode(code, productScan.current.code)) return;
    setScanned(true);
    if (scanningLocation || target === 'location') {
      openMovement({ location: code });
      return;
    }
    continueAfterProduct({ code, codeType: result.type });
  }

  async function takeLabelPhoto() {
    if (!cameraRef.current || takingPhoto || recognizing) return;
    setTakingPhoto(true);
    try {
      const picture = await cameraRef.current.takePictureAsync({ quality: 0.68, skipProcessing: Platform.OS === 'android' } as any);
      const pictureUri = picture && 'uri' in picture ? picture.uri : undefined;
      if (pictureUri) {
        const photoUri = await persistLocalPhoto(pictureUri);
        setTakingPhoto(false);
        setRecognizing(true);
        try {
          const fields = await recognizeInventoryLabel(photoUri);
          continueAfterProduct({
            photoUri,
            ocrReference: fields.reference,
            ocrDesignation: fields.designation,
          });
        } catch (error) {
          console.warn('[inventory-ocr] label recognition failed:', error);
          continueAfterProduct({ photoUri });
        }
      }
    } catch (error: any) {
      Alert.alert(copy.error, error?.message ?? String(error));
    } finally {
      setTakingPhoto(false);
      setRecognizing(false);
    }
  }

  if (!permissions.canRecordInventory) {
    return (
      <View style={styles.root}>
        <Header title={title} showBack backFallback="/inventory" />
        <View style={styles.permissionBox}><Ionicons name="lock-closed-outline" size={38} color={C.textMuted} /><Text style={styles.permissionText}>{copy.restricted}</Text></View>
      </View>
    );
  }

  if (!permission) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={C.primary} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.root}>
        <Header title={title} showBack backFallback="/inventory" />
        <View style={styles.permissionBox}>
          <Ionicons name="camera-outline" size={46} color={C.primary} />
          <Text style={styles.permissionText}>{copy.cameraPermission}</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>{copy.allowCamera}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.manualLink} onPress={() => openMovement()}>
            <Text style={styles.manualLinkText}>{copy.manualEntry}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header title={title} showBack backFallback="/inventory" />
      {confirmingLocation ? (
        <View style={styles.readyBox}>
          <Text style={styles.stepLabel}>{copy.scanStepLocation}</Text>
          <Text style={styles.confirmLabel}>{copy.knownLocation}</Text>
          <Text style={styles.confirmValue}>{knownLocation}</Text>
          <View style={styles.confirmActions}>
            <TouchableOpacity style={styles.confirmPrimary} onPress={() => openMovement({ location: knownLocation })}>
              <Text style={styles.confirmPrimaryText}>{copy.confirmLocation}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmSecondary} onPress={() => { setPhase('location'); setScanned(false); setArmed(false); setTorch(false); }}>
              <Text style={styles.confirmSecondaryText}>{copy.changeLocation}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : !armed ? (
        <View style={styles.readyBox}>
          <Ionicons name="scan-outline" size={46} color={C.primary} />
          {mode === 'in' && !target ? <Text style={styles.stepLabel}>{scanningLocation ? copy.scanStepLocation : copy.scanStepProduct}</Text> : null}
          <Text style={styles.readyTitle}>{copy.scanReady}</Text>
          <Text style={styles.readyHint}>{scanningLocation ? copy.scanReadyHintShelf : copy.scanReadyHint}</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={() => setArmed(true)}>
            <Text style={styles.permissionButtonText}>{copy.scanReadyAction}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.manualLink} onPress={cancelReady}>
            <Text style={styles.manualLinkText}>{copy.cancel}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.cameraWrap}>
          {Platform.OS === 'web' ? (
            <InventoryWebBarcodeCamera
              ref={cameraRef as Ref<InventoryWebBarcodeCameraHandle>}
              active={!scanned}
              torch={torch}
              errorMessage={copy.cameraUnavailable}
              retryLabel={copy.retryCamera}
              onDetected={result => handleBarcode({ data: result.data, type: result.type } as BarcodeScanningResult)}
            />
          ) : (
            <CameraView
              ref={cameraRef as Ref<CameraView>}
              style={StyleSheet.absoluteFill}
              facing="back"
              mode="picture"
              enableTorch={torch}
              onBarcodeScanned={scanned ? undefined : handleBarcode}
              barcodeScannerSettings={{ barcodeTypes: ['aztec', 'ean13', 'ean8', 'qr', 'pdf417', 'upc_e', 'datamatrix', 'code39', 'code93', 'itf14', 'codabar', 'code128', 'upc_a'] }}
            />
          )}
          <View style={styles.overlay} pointerEvents="box-none">
            <View style={styles.topOverlay}>
              {mode === 'in' && !target ? <Text style={styles.stepLabel}>{scanningLocation ? copy.scanStepLocation : copy.scanStepProduct}</Text> : null}
              <Text style={styles.scanHint}>{scanningLocation ? copy.scanLocationHint : copy.scanHint}</Text>
            </View>
            <View style={styles.frame}>
              <View style={[styles.corner, styles.cornerTL]} /><View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} /><View style={[styles.corner, styles.cornerBR]} />
              <View style={styles.scanLine} />
            </View>
            <View style={styles.controls}>
              <TouchableOpacity style={styles.sideControl} onPress={() => setTorch(value => !value)}>
                <Ionicons name={torch ? 'flash' : 'flash-outline'} size={23} color="#fff" />
                <Text style={styles.sideControlText}>{copy.torch}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shutter} onPress={scanningLocation ? undefined : takeLabelPhoto} disabled={scanningLocation || takingPhoto || recognizing}>
                {takingPhoto || recognizing ? <ActivityIndicator color={C.primary} /> : <Ionicons name={scanningLocation ? 'scan' : 'camera'} size={28} color={C.primary} />}
              </TouchableOpacity>
              <TouchableOpacity style={styles.sideControl} onPress={() => openMovement()}>
                <Ionicons name="create-outline" size={23} color="#fff" />
                <Text style={styles.sideControlText}>{scanningLocation ? copy.skipLocation : copy.manualEntry}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.photoHint}>{scanningLocation ? copy.locationHint : recognizing ? copy.ocrReading : copy.takeLabelPhoto}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#071426' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  cameraWrap: { flex: 1, overflow: 'hidden' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'space-between', paddingBottom: 28 },
  topOverlay: { width: '100%', paddingTop: 26, paddingBottom: 38, paddingHorizontal: 28, backgroundColor: 'rgba(0,0,0,0.42)' },
  scanHint: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  stepLabel: { color: '#FFCB00', fontFamily: 'Inter_700Bold', fontSize: 12, textAlign: 'center', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 },
  readyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16, backgroundColor: '#071426' },
  readyTitle: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' },
  readyHint: { color: 'rgba(255,255,255,0.86)', fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  confirmLabel: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase' },
  confirmValue: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 26, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: 8, marginTop: 6, width: '100%', maxWidth: 360 },
  confirmPrimary: { flex: 1, minHeight: 48, borderRadius: 13, backgroundColor: C.closed, alignItems: 'center', justifyContent: 'center' },
  confirmPrimaryText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 14 },
  confirmSecondary: { flex: 1, minHeight: 48, borderRadius: 13, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  confirmSecondaryText: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 14 },
  frame: { position: 'absolute', top: '27%', width: '82%', height: 210 },
  corner: { position: 'absolute', width: 42, height: 42, borderColor: '#FFCB00' },
  cornerTL: { left: 0, top: 0, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 12 },
  cornerTR: { right: 0, top: 0, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 12 },
  cornerBL: { left: 0, bottom: 0, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 12 },
  cornerBR: { right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 12 },
  scanLine: { position: 'absolute', left: 18, right: 18, top: '50%', height: 2, backgroundColor: '#FFCB00', shadowColor: '#FFCB00', shadowOpacity: 0.8, shadowRadius: 8 },
  controls: { marginTop: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', width: '100%', paddingHorizontal: 22, paddingTop: 24, backgroundColor: 'rgba(0,0,0,0.48)' },
  sideControl: { width: 88, alignItems: 'center', gap: 5, paddingVertical: 8 },
  sideControlText: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 10, textAlign: 'center' },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 5, borderColor: 'rgba(255,255,255,0.6)', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  photoHint: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 11, backgroundColor: 'rgba(0,0,0,0.48)', width: '100%', textAlign: 'center', paddingTop: 8, paddingBottom: 16 },
  permissionBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16, backgroundColor: C.bg },
  permissionText: { color: C.text, fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  permissionButton: { backgroundColor: C.primary, borderRadius: 13, paddingHorizontal: 20, paddingVertical: 13 },
  permissionButtonText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  manualLink: { padding: 10 },
  manualLinkText: { color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
