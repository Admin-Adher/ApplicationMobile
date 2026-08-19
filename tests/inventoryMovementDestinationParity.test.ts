import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('inventory receipt and dispatch destination parity', () => {
  it('keeps web and APK adapters on the same destination policy and serializer', () => {
    const web = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.tsx');
    const mobile = read('app/inventory/movement.tsx');

    for (const adapter of [web, mobile]) {
      expect(adapter).toContain('inventoryDestinationPolicy');
      expect(adapter).toContain('toInventoryMovementDestination');
      expect(adapter).toContain('destinationPolicy.buildingRequired');
    }
    expect(web).toContain('...movementDestination');
    expect(mobile).toContain('movementDestination.building_id');
    expect(mobile).toContain('movementDestination.zone_id');
  });

  it('shows receipt context on both surfaces while leaving receipt location optional', () => {
    const web = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.tsx');
    const mobile = read('app/inventory/movement.tsx');

    expect(web).toContain("mode === 'in' ? copy.entryDestinationHint : copy.exitDestinationHint");
    expect(web).toContain("mode === 'in' ? copy.entryBuilding : copy.exitBuilding");
    expect(mobile).toContain("mode === 'in' ? copy.receivedAt : copy.dispatchLogistics");
    expect(mobile).toContain("mode === 'in' ? copy.entryBuilding : copy.exitBuilding");
  });

  it('lets both surfaces scan or type a warehouse location and show it on issue', () => {
    const web = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.tsx');
    const mobile = read('app/inventory/movement.tsx');
    const scan = read('app/inventory/scan.tsx');

    expect(web).toContain("startScanner('location')");
    expect(web).toContain('copy.scanReady');
    expect(web).toContain('armScanner');
    expect(web).toContain('copy.pickFrom');
    expect(web).toContain('copy.locationRequired');
    expect(mobile).toContain('InventoryLocationScanModal');
    expect(mobile).toContain('copy.pickFrom');
    expect(mobile).toContain('copy.locationRequired');
    expect(scan).toContain('nextInventoryScanPhase');
    expect(scan).toContain('location: code');
    expect(scan).toContain('copy.scanReady');
    expect(scan).toContain('setArmed(true)');
  });
});
