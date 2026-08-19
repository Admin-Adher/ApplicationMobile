export type InventoryScanPhase = 'product' | 'location';

export function initialInventoryScanPhase(target?: string): InventoryScanPhase {
  return target === 'location' ? 'location' : 'product';
}

export function resolveInventoryScanAction(options: {
  mode: 'in' | 'out';
  phase: InventoryScanPhase;
  target?: string;
}): 'continue-location' | 'complete-product' | 'complete-location' {
  if (options.phase === 'location' || options.target === 'location') return 'complete-location';
  if (options.mode === 'in') return 'continue-location';
  return 'complete-product';
}

export function resolveInventoryStorageLocation(options: {
  scannedLocation?: string | null;
  productLocation?: string | null;
  edited?: boolean;
  current?: string;
}): string {
  if (options.edited) return options.current?.trim() ?? '';
  const scanned = options.scannedLocation?.trim();
  if (scanned) return scanned;
  return options.productLocation?.trim() || '';
}

export function isSameInventoryScanCode(left?: string | null, right?: string | null): boolean {
  const a = left?.trim();
  const b = right?.trim();
  return Boolean(a && b && a === b);
}
