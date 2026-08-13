export type BundledPdfJsSources = {
  moduleSource: string | null;
  workerSource: string | null;
};

export async function loadBundledPdfJsSources(): Promise<BundledPdfJsSources> {
  return { moduleSource: null, workerSource: null };
}

export function getLoadedBundledPdfJsSources(): BundledPdfJsSources | null {
  return null;
}

export async function loadBundledPdfJsSource(): Promise<string | null> {
  return null;
}
