import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const PDFJS_MODULE_ASSET = require('../assets/pdfjs/pdf.min.mjs.txt');

let bundledPdfJsSourcePromise: Promise<string | null> | null = null;

export async function loadBundledPdfJsSource(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (bundledPdfJsSourcePromise) return bundledPdfJsSourcePromise;

  bundledPdfJsSourcePromise = (async () => {
    try {
      const asset = Asset.fromModule(PDFJS_MODULE_ASSET);
      await asset.downloadAsync();
      const sourceUri = asset.localUri ?? asset.uri;
      if (!sourceUri) return null;
      return await FileSystem.readAsStringAsync(sourceUri);
    } catch (error) {
      console.warn('[pdfjsAsset] Failed to load bundled PDF.js:', error);
      return null;
    }
  })();

  return bundledPdfJsSourcePromise;
}
