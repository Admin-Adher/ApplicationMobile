import { describe, expect, it } from 'vitest';
import {
  orderCompactBuildingGroups,
  takeCompactBuildingBatch,
  toggleCompactBuildingKey,
  WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE,
} from '../vercel-app/app/web/plan-reserve-workspace/building-navigator';

const groups = Array.from({ length: 55 }, (_, index) => ({
  key: `building-${index + 1}`,
  name: `Building ${index + 1}`,
}));

describe('BuildTrack compact web building navigator', () => {
  it('shows exactly 12 distinct buildings before loading the next 12', () => {
    const ordered = orderCompactBuildingGroups(groups, {
      recentKeys: ['building-3', 'building-2', 'building-1'],
      showRecentRail: true,
    });
    const firstBatch = takeCompactBuildingBatch(
      ordered.mainGroups,
      ordered.recentGroups.length,
      WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE,
    );
    const secondBatch = takeCompactBuildingBatch(
      ordered.mainGroups,
      ordered.recentGroups.length,
      WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE * 2,
    );

    const firstKeys = [
      ...ordered.recentGroups.map(group => group.key),
      ...firstBatch.visibleMainGroups.map(group => group.key),
    ];
    const secondKeys = [
      ...ordered.recentGroups.map(group => group.key),
      ...secondBatch.visibleMainGroups.map(group => group.key),
    ];

    expect(firstKeys).toHaveLength(12);
    expect(new Set(firstKeys)).toHaveLength(12);
    expect(firstBatch.hiddenCount).toBe(43);
    expect(secondKeys).toHaveLength(24);
    expect(new Set(secondKeys)).toHaveLength(24);
    expect(secondBatch.hiddenCount).toBe(31);
  });

  it('keeps the selected building in the first compact batch', () => {
    const ordered = orderCompactBuildingGroups(groups, {
      selectedKey: 'building-55',
      showRecentRail: false,
    });
    const batch = takeCompactBuildingBatch(
      ordered.mainGroups,
      ordered.recentGroups.length,
      WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE,
    );

    expect(batch.visibleMainGroups[0]?.key).toBe('building-55');
    expect(batch.visibleMainGroups).toHaveLength(12);
  });

  it('keeps the selected building out of the recent rail and visible as a row', () => {
    const ordered = orderCompactBuildingGroups(groups, {
      selectedKey: 'building-3',
      recentKeys: ['building-3', 'building-2', 'building-1'],
      showRecentRail: true,
    });
    const batch = takeCompactBuildingBatch(
      ordered.mainGroups,
      ordered.recentGroups.length,
      WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE,
    );

    expect(ordered.recentGroups.map(group => group.key)).toEqual(['building-2', 'building-1']);
    expect(batch.visibleMainGroups[0]?.key).toBe('building-3');
    expect([
      ...ordered.recentGroups,
      ...batch.visibleMainGroups,
    ].filter(group => group.key === 'building-3')).toHaveLength(1);
  });

  it('moves an opened recent building into the accordion without duplicating it', () => {
    const ordered = orderCompactBuildingGroups(groups, {
      expandedKey: 'building-2',
      recentKeys: ['building-3', 'building-2', 'building-1'],
      showRecentRail: true,
    });
    const batch = takeCompactBuildingBatch(
      ordered.mainGroups,
      ordered.recentGroups.length,
      WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE,
    );
    const visibleKeys = [
      ...ordered.recentGroups.map(group => group.key),
      ...batch.visibleMainGroups.map(group => group.key),
    ];

    expect(ordered.recentGroups.map(group => group.key)).toEqual(['building-3', 'building-1']);
    expect(batch.visibleMainGroups[0]?.key).toBe('building-2');
    expect(visibleKeys.filter(key => key === 'building-2')).toHaveLength(1);
    expect(visibleKeys).toHaveLength(12);
  });

  it('keeps the stable list order when a non-recent building is expanded', () => {
    const ordered = orderCompactBuildingGroups(groups, {
      expandedKey: 'building-8',
      recentKeys: ['building-3', 'building-2', 'building-1'],
      showRecentRail: true,
    });

    expect(ordered.mainGroups[0]?.key).toBe('building-4');
    expect(ordered.mainGroups.findIndex(group => group.key === 'building-8')).toBe(4);
  });

  it('ignores stale recent and selected keys outside the filtered result', () => {
    const filtered = groups.slice(20, 28);
    const ordered = orderCompactBuildingGroups(filtered, {
      selectedKey: 'building-55',
      recentKeys: ['building-1', 'building-22'],
      showRecentRail: true,
    });

    expect(ordered.recentGroups.map(group => group.key)).toEqual(['building-22']);
    expect(ordered.mainGroups.map(group => group.key)).not.toContain('building-55');
    expect([
      ...ordered.recentGroups,
      ...ordered.mainGroups,
    ]).toHaveLength(filtered.length);
  });

  it('toggles one compact accordion building at a time', () => {
    expect(toggleCompactBuildingKey(null, 'building-1')).toBe('building-1');
    expect(toggleCompactBuildingKey('building-1', 'building-2')).toBe('building-2');
    expect(toggleCompactBuildingKey('building-2', 'building-2')).toBeNull();
  });
});
