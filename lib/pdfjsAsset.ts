import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const PDFJS_MODULE_ASSET = require('../assets/pdfjs/pdf.min.mjs.txt');
const PDFJS_WORKER_ASSET = require('../assets/pdfjs/pdf.worker.min.mjs.txt');

export type BundledPdfJsSources = {
  moduleSource: string | null;
  workerSource: string | null;
};

let bundledPdfJsSourcesPromise: Promise<BundledPdfJsSources> | null = null;

async function readBundledAsset(assetModule: number, label: string): Promise<string | null> {
  try {
    const asset = Asset.fromModule(assetModule);
    await asset.downloadAsync();
    const sourceUri = asset.localUri ?? asset.uri;
    if (!sourceUri) return null;
    return await FileSystem.readAsStringAsync(sourceUri);
  } catch (error) {
    console.warn(`[pdfjsAsset] Failed to load bundled ${label}:`, error);
    return null;
  }
}

export async function loadBundledPdfJsSources(): Promise<BundledPdfJsSources> {
  if (Platform.OS === 'web') return { moduleSource: null, workerSource: null };
  if (bundledPdfJsSourcesPromise) return bundledPdfJsSourcesPromise;

  bundledPdfJsSourcesPromise = Promise.all([
    readBundledAsset(PDFJS_MODULE_ASSET, 'PDF.js'),
    readBundledAsset(PDFJS_WORKER_ASSET, 'PDF.js worker'),
  ]).then(([moduleSource, workerSource]) => ({ moduleSource, workerSource }));

  return bundledPdfJsSourcesPromise;
}

export async function loadBundledPdfJsSource(): Promise<string | null> {
  const { moduleSource } = await loadBundledPdfJsSources();
  return moduleSource;
}
