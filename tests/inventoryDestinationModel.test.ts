import { describe, expect, it } from 'vitest';
import {
  EMPTY_INVENTORY_DESTINATION,
  createInventoryDestinationCatalog,
  inventoryDestinationZones,
  toInventoryMovementDestination,
  transitionInventoryDestination,
} from '../lib/inventoryDestinationModel';

const hierarchy = [{
  id: 'building-a',
  name: 'Service Building',
  levels: [
    { id: 'level-0', name: 'RDC', zones: [{ id: 'zone-tech-0', name: 'Local technique' }] },
    { id: 'level-1', name: 'R+1', zones: [{ id: 'zone-tech-1', name: 'Local technique' }] },
  ],
}, {
  id: 'building-b',
  name: 'SPA',
  levels: [{ id: 'level-spa', name: 'RDC', zones: [{ id: 'zone-pool', name: 'Piscine' }] }],
}];

describe('inventory destination model', () => {
  it('normalizes array and JSON hierarchies while rejecting malformed values', () => {
    expect(createInventoryDestinationCatalog(hierarchy).buildings).toHaveLength(2);
    expect(createInventoryDestinationCatalog(JSON.stringify(hierarchy)).buildings).toHaveLength(2);
    expect(createInventoryDestinationCatalog('{bad json').hasHierarchy).toBe(false);
    expect(createInventoryDestinationCatalog(null).hasHierarchy).toBe(false);
  });

  it('only exposes zones belonging to the selected building and keeps level labels', () => {
    const catalog = createInventoryDestinationCatalog(hierarchy);
    expect(inventoryDestinationZones(catalog, 'building-a').map(zone => zone.label)).toEqual([
      'RDC · Local technique',
      'R+1 · Local technique',
    ]);
    expect(inventoryDestinationZones(catalog, 'building-b').map(zone => zone.id)).toEqual(['zone-pool']);
  });

  it('clears the zone atomically when the building changes', () => {
    const catalog = createInventoryDestinationCatalog(hierarchy);
    const buildingA = transitionInventoryDestination(catalog, EMPTY_INVENTORY_DESTINATION, {
      type: 'select-building', buildingId: 'building-a',
    });
    const withZone = transitionInventoryDestination(catalog, buildingA, {
      type: 'select-zone', zoneId: 'zone-tech-1',
    });
    const buildingB = transitionInventoryDestination(catalog, withZone, {
      type: 'select-building', buildingId: 'building-b',
    });

    expect(withZone).toMatchObject({
      buildingId: 'building-a',
      zoneId: 'zone-tech-1',
      levelId: 'level-1',
    });
    expect(buildingB).toMatchObject({
      buildingId: 'building-b',
      buildingName: 'SPA',
      zoneName: '',
    });
    expect(buildingB.zoneId).toBeUndefined();
  });

  it('supports an explicit legacy fallback without retaining stale identifiers', () => {
    const catalog = createInventoryDestinationCatalog(hierarchy);
    const selected = transitionInventoryDestination(catalog, EMPTY_INVENTORY_DESTINATION, {
      type: 'select-building', buildingId: 'building-a',
    });
    const manualBuilding = transitionInventoryDestination(catalog, selected, {
      type: 'edit-building', buildingName: 'Zone logistique provisoire',
    });
    const manualZone = transitionInventoryDestination(catalog, manualBuilding, {
      type: 'edit-zone', zoneName: 'Aire Est',
    });

    expect(toInventoryMovementDestination(manualZone)).toEqual({
      building_id: null,
      building_name: 'Zone logistique provisoire',
      zone_id: null,
      zone_name: 'Aire Est',
    });
  });

  it('serializes catalog identifiers together with their historical labels', () => {
    const catalog = createInventoryDestinationCatalog(hierarchy);
    const selectedBuilding = transitionInventoryDestination(catalog, EMPTY_INVENTORY_DESTINATION, {
      type: 'select-building', buildingId: 'building-a',
    });
    const selectedZone = transitionInventoryDestination(catalog, selectedBuilding, {
      type: 'select-zone', zoneId: 'zone-tech-0',
    });

    expect(toInventoryMovementDestination(selectedZone)).toEqual({
      building_id: 'building-a',
      building_name: 'Service Building',
      zone_id: 'zone-tech-0',
      zone_name: 'Local technique',
    });
  });
});
