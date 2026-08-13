export const WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE = 12;

type BuildingGroup = {
  key: string;
};

type CompactBuildingOrderOptions = {
  selectedKey?: string | null;
  expandedKey?: string | null;
  recentKeys?: readonly string[];
  showRecentRail: boolean;
};

export function orderCompactBuildingGroups<T extends BuildingGroup>(
  groups: readonly T[],
  {
    selectedKey = null,
    expandedKey = null,
    recentKeys = [],
    showRecentRail,
  }: CompactBuildingOrderOptions,
) {
  const groupsByKey = new Map(groups.map(group => [group.key, group]));
  const recentGroups: T[] = [];
  const recentGroupKeys = new Set<string>();
  const expandedWasRecent = Boolean(
    showRecentRail
    && expandedKey
    && recentKeys.includes(expandedKey),
  );

  if (showRecentRail) {
    for (const key of recentKeys) {
      if (key === expandedKey || key === selectedKey || recentGroupKeys.has(key)) continue;
      const group = groupsByKey.get(key);
      if (!group) continue;
      recentGroupKeys.add(key);
      recentGroups.push(group);
    }
  }

  const mainGroups: T[] = [];
  const mainGroupKeys = new Set<string>();
  const appendMainGroup = (key?: string | null) => {
    if (!key || recentGroupKeys.has(key) || mainGroupKeys.has(key)) return;
    const group = groupsByKey.get(key);
    if (!group) return;
    mainGroupKeys.add(key);
    mainGroups.push(group);
  };

  if (expandedWasRecent) appendMainGroup(expandedKey);
  appendMainGroup(selectedKey);
  for (const group of groups) appendMainGroup(group.key);

  return { recentGroups, mainGroups };
}

export function takeCompactBuildingBatch<T extends BuildingGroup>(
  mainGroups: readonly T[],
  recentGroupCount: number,
  visibleBuildingLimit: number,
) {
  const mainLimit = Math.max(0, visibleBuildingLimit - recentGroupCount);
  const visibleMainGroups = mainGroups.slice(0, mainLimit);
  const visibleCount = recentGroupCount + visibleMainGroups.length;
  return {
    visibleMainGroups,
    visibleCount,
    hiddenCount: Math.max(0, mainGroups.length - visibleMainGroups.length),
  };
}

export function toggleCompactBuildingKey(currentKey: string | null, nextKey: string) {
  return currentKey === nextKey ? null : nextKey;
}
