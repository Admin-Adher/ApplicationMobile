import { useEffect, useRef, useState, type Ref } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import InventoryWebBarcodeCamera, {
  type InventoryWebBarcodeCameraHandle,
} from './InventoryWebBarcodeCamera';

export function InventoryLocationScanModal({
  visible,
  title,
  hint,
  torchLabel,
  cancelLabel,
  cameraPermission,
  allowCamera,
  cameraUnavailable,
  retryLabel,
  onClose,
  onDetected,
}: {
  visible: boolean;
  title: string;
  hint: string;
  torchLabel: string;
  cancelLabel: string;
  cameraPermission: string;
  allowCamera: string;
  cameraUnavailable: string;
  retryLabel: string;
  onClose: () => void;
  onDetected: (code: string) => void;
}) {
  const cameraRef = useRef<CameraView | InventoryWebBarcodeCameraHandle | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [torch, setTorch] = useState(false);

  useEffect(() => {
    if (visible) {
      setScanned(false);
      setTorch(false);
    }
  }, [visible]);

  function handleBarcode(result: BarcodeScanningResult) {
    const code = result.data?.trim();
    if (!visible || scanned || !code) return;
    setScanned(true);
    onDetected(code);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Text style={styles.cancel}>{cancelLabel}</Text>
          </TouchableOpacity>
        </View>
        {!permission ? (
          <View style={styles.center}><ActivityIndicator color="#fff" /></View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.permission}>{cameraPermission}</Text>
            <TouchableOpacity style={styles.allow} onPress={requestPermission}>
              <Text style={styles.allowText}>{allowCamera}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            {Platform.OS === 'web' ? (
              <InventoryWebBarcodeCamera
                ref={cameraRef as Ref<InventoryWebBarcodeCameraHandle>}
                active={visible && !scanned}
                torch={torch}
                errorMessage={cameraUnavailable}
                retryLabel={retryLabel}
                onDetected={result => handleBarcode({ data: result.data, type: result.type } as BarcodeScanningResult)}
              />
            ) : (
              <CameraView
                ref={cameraRef as Ref<CameraView>}
                style={StyleSheet.absoluteFill}
                facing="back"
                enableTorch={torch}
                onBarcodeScanned={scanned ? undefined : handleBarcode}
                barcodeScannerSettings={{ barcodeTypes: ['aztec', 'ean13', 'ean8', 'qr', 'pdf417', 'upc_e', 'datamatrix', 'code39', 'code93', 'itf14', 'codabar', 'code128', 'upc_a'] }}
              />
            )}
            <View style={styles.overlay} pointerEvents="box-none">
              <Text style={styles.hint}>{hint}</Text>
              <TouchableOpacity style={styles.torch} onPress={() => setTorch(value => !value)}>
                <Ionicons name={torch ? 'flash' : 'flash-outline'} size={22} color="#fff" />
                <Text style={styles.torchText}>{torchLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#071426' },
  header: { paddingTop: 18, paddingHorizontal: 18, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 16 },
  cancel: { color: '#FFCB00', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 },
  permission: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  allow: { backgroundColor: C.primary, borderRadius: 13, paddingHorizontal: 20, paddingVertical: 13 },
  allowText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  cameraWrap: { flex: 1, overflow: 'hidden' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', padding: 22 },
  hint: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.42)', padding: 14, borderRadius: 12 },
  torch: { alignSelf: 'center', alignItems: 'center', gap: 6, padding: 12 },
  torchText: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 11 },
});
