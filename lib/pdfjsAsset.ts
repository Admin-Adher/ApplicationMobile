import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const PDFJS_MODULE_ASSET = require('../assets/pdfjs/pdf.min.mjs.txt');
const PDFJS_WORKER_ASSET = require('../assets/pdfjs/pdf.worker.min.mjs.txt');

export type BundledPdfJsSources = {
  moduleSource: string | null;
  workerSource: string | null;
};

let bundledPdfJsSourcesPromise: Promise<BundledPdfJsSources> | null = null;
const BUNDLED_PDFJS_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timeout after ${BUNDLED_PDFJS_TIMEOUT_MS}ms`)),
      BUNDLED_PDFJS_TIMEOUT_MS,
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readBundledAsset(assetModule: number, label: string): Promise<string | null> {
  try {
    const asset = Asset.fromModule(assetModule);
    await withTimeout(asset.downloadAsync(), `${label} download`);
    const sourceUri = asset.localUri ?? asset.uri;
    if (!sourceUri) return null;
    return await withTimeout(FileSystem.readAsStringAsync(sourceUri), `${label} read`);
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
