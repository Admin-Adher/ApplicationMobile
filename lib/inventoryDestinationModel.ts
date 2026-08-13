export type InventoryDestinationZone = {
  id: string;
  name: string;
  levelId?: string;
  levelName?: string;
  label: string;
};

export type InventoryDestinationBuilding = {
  id: string;
  name: string;
  zones: InventoryDestinationZone[];
};

export type InventoryDestinationCatalog = {
  buildings: InventoryDestinationBuilding[];
  hasHierarchy: boolean;
};

export type InventoryDestination = {
  buildingId?: string;
  buildingName: string;
  zoneId?: string;
  zoneName: string;
  levelId?: string;
  levelName?: string;
  buildingMode: 'catalog' | 'manual';
  zoneMode: 'catalog' | 'manual';
};

export type InventoryDestinationIntent =
  | { type: 'clear' }
  | { type: 'select-building'; buildingId: string }
  | { type: 'edit-building'; buildingName: string }
  | { type: 'select-zone'; zoneId: string }
  | { type: 'edit-zone'; zoneName: string };

export const EMPTY_INVENTORY_DESTINATION: InventoryDestination = {
  buildingName: '',
  zoneName: '',
  buildingMode: 'catalog',
  zoneMode: 'catalog',
};

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function parseHierarchy(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createInventoryDestinationCatalog(value: unknown): InventoryDestinationCatalog {
  const seenBuildings = new Set<string>();
  const buildings: InventoryDestinationBuilding[] = [];

  for (const rawBuilding of parseHierarchy(value)) {
    const building = recordValue(rawBuilding);
    const id = nonEmptyString(building?.id);
    const name = nonEmptyString(building?.name);
    if (!id || !name || seenBuildings.has(id)) continue;
    seenBuildings.add(id);

    const seenZones = new Set<string>();
    const zones: InventoryDestinationZone[] = [];
    const levels = Array.isArray(building?.levels) ? building.levels : [];

    for (const rawLevel of levels) {
      const level = recordValue(rawLevel);
      const levelId = nonEmptyString(level?.id);
      const levelName = nonEmptyString(level?.name);
      const levelZones = Array.isArray(level?.zones) ? level.zones : [];

      for (const rawZone of levelZones) {
        const zone = recordValue(rawZone);
        const zoneId = nonEmptyString(zone?.id);
        const zoneName = nonEmptyString(zone?.name);
        if (!zoneId || !zoneName || seenZones.has(zoneId)) continue;
        seenZones.add(zoneId);
        zones.push({
          id: zoneId,
          name: zoneName,
          levelId,
          levelName,
          label: levelName ? `${levelName} · ${zoneName}` : zoneName,
        });
      }
    }

    buildings.push({ id, name, zones });
  }

  return { buildings, hasHierarchy: buildings.length > 0 };
}

export function inventoryDestinationBuilding(
  catalog: InventoryDestinationCatalog,
  buildingId: string | undefined,
) {
  return buildingId
    ? catalog.buildings.find(building => building.id === buildingId)
    : undefined;
}

export function inventoryDestinationZones(
  catalog: InventoryDestinationCatalog,
  buildingId: string | undefined,
) {
  return inventoryDestinationBuilding(catalog, buildingId)?.zones ?? [];
}

export function transitionInventoryDestination(
  catalog: InventoryDestinationCatalog,
  current: InventoryDestination,
  intent: InventoryDestinationIntent,
): InventoryDestination {
  if (intent.type === 'clear') return { ...EMPTY_INVENTORY_DESTINATION };

  if (intent.type === 'select-building') {
    const building = inventoryDestinationBuilding(catalog, intent.buildingId);
    if (!building) return { ...EMPTY_INVENTORY_DESTINATION };
    return {
      buildingId: building.id,
      buildingName: building.name,
      zoneName: '',
      buildingMode: 'catalog',
      zoneMode: 'catalog',
    };
  }

  if (intent.type === 'edit-building') {
    return {
      buildingName: intent.buildingName,
      zoneName: '',
      buildingMode: 'manual',
      zoneMode: 'manual',
    };
  }

  if (intent.type === 'select-zone') {
    const zone = inventoryDestinationZones(catalog, current.buildingId)
      .find(candidate => candidate.id === intent.zoneId);
    if (!zone) {
      return {
        ...current,
        zoneId: undefined,
        zoneName: '',
        levelId: undefined,
        levelName: undefined,
        zoneMode: 'catalog',
      };
    }
    return {
      ...current,
      zoneId: zone.id,
      zoneName: zone.name,
      levelId: zone.levelId,
      levelName: zone.levelName,
      zoneMode: 'catalog',
    };
  }

  return {
    ...current,
    zoneId: undefined,
    zoneName: intent.zoneName,
    levelId: undefined,
    levelName: undefined,
    zoneMode: 'manual',
  };
}

export function toInventoryMovementDestination(destination: InventoryDestination) {
  return {
    building_id: destination.buildingId?.trim() || null,
    building_name: destination.buildingName.trim() || null,
    zone_id: destination.zoneId?.trim() || null,
    zone_name: destination.zoneName.trim() || null,
  };
}
