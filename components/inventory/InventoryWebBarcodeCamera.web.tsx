import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  startWebBarcodeScanner,
  webBarcodeCameraErrorMessage,
  type WebBarcodeScannerControls,
} from '@/lib/webBarcodeScanner';
import type {
  InventoryWebBarcodeCameraHandle,
  InventoryWebBarcodeCameraProps,
} from './InventoryWebBarcodeCamera.types';

const InventoryWebBarcodeCamera = forwardRef<
  InventoryWebBarcodeCameraHandle,
  InventoryWebBarcodeCameraProps
>(function InventoryWebBarcodeCamera({ active, torch, errorMessage, retryLabel, onDetected }, forwardedRef) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<WebBarcodeScannerControls | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [retryKey, setRetryKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useImperativeHandle(forwardedRef, () => ({
    async takePictureAsync(options) {
      const video = videoRef.current;
      if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
        throw new Error(errorMessage);
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error(errorMessage);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return {
        uri: canvas.toDataURL('image/jpeg', options?.quality ?? 0.72),
        width: canvas.width,
        height: canvas.height,
      };
    },
  }), [errorMessage]);

  useEffect(() => {
    if (!active || !videoRef.current) return undefined;
    let disposed = false;
    setLoading(true);
    setCameraError('');
    void startWebBarcodeScanner({
      video: videoRef.current,
      loadZXing: () => import('@zxing/browser'),
      onDetected: result => {
        if (!disposed) onDetectedRef.current({ data: result.text, type: result.format });
      },
    }).then(controls => {
      if (disposed) controls.stop();
      else {
        controlsRef.current = controls;
        setLoading(false);
      }
    }).catch(error => {
      if (!disposed) {
        setLoading(false);
        setCameraError(webBarcodeCameraErrorMessage(error, errorMessage));
      }
    });
    return () => {
      disposed = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [active, errorMessage, retryKey]);

  useEffect(() => {
    if (!controlsRef.current?.switchTorch) return;
    void controlsRef.current.switchTorch(torch).catch(() => undefined);
  }, [torch]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="Aperçu de la caméra pour scanner le code-barres"
        style={webStyles.video}
      />
      {loading ? (
        <View style={styles.status} pointerEvents="none">
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : null}
      {cameraError ? (
        <View style={styles.status}>
          <Text style={styles.errorText}>{cameraError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => setRetryKey(value => value + 1)}>
            <Text style={styles.retryText}>{retryLabel}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
});

const webStyles = {
  video: {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    backgroundColor: '#071426',
  },
};

const styles = StyleSheet.create({
  status: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 28,
    backgroundColor: 'rgba(7, 20, 38, 0.82)',
  },
  errorText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  retryButton: { borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 18, paddingVertical: 11 },
  retryText: { color: '#0F3B75', fontFamily: 'Inter_700Bold', fontSize: 13 },
});

export default InventoryWebBarcodeCamera;
export type { InventoryWebBarcodeCameraHandle } from './InventoryWebBarcodeCamera.types';
