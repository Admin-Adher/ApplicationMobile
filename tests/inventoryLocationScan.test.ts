import { describe, expect, it } from 'vitest';
import {
  initialInventoryScanPhase,
  isSameInventoryScanCode,
  resolveInventoryScanAction,
  resolveInventoryStorageLocation,
} from '../lib/inventoryLocationScan';

describe('inventory location scan flow', () => {
  it('asks for a shelf scan after a product receipt, not after an issue', () => {
    expect(initialInventoryScanPhase()).toBe('product');
    expect(initialInventoryScanPhase('location')).toBe('location');
    expect(resolveInventoryScanAction({ mode: 'in', phase: 'product' })).toBe('continue-location');
    expect(resolveInventoryScanAction({ mode: 'out', phase: 'product' })).toBe('complete-product');
    expect(resolveInventoryScanAction({ mode: 'in', phase: 'location' })).toBe('complete-location');
    expect(resolveInventoryScanAction({ mode: 'in', phase: 'product', target: 'location' })).toBe('complete-location');
  });

  it('keeps a scanned shelf over the previous product location', () => {
    expect(resolveInventoryStorageLocation({
      scannedLocation: 'A-12',
      productLocation: 'Magasin',
    })).toBe('A-12');
    expect(resolveInventoryStorageLocation({
      productLocation: 'Magasin',
    })).toBe('Magasin');
    expect(resolveInventoryStorageLocation({
      scannedLocation: 'A-12',
      productLocation: 'Magasin',
      edited: true,
      current: 'B-03',
    })).toBe('B-03');
    expect(isSameInventoryScanCode('ABC-1', 'ABC-1')).toBe(true);
    expect(isSameInventoryScanCode('ABC-1', 'A-12')).toBe(false);
  });
});
