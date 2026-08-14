import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  mergeSitePlanWriteSnapshots,
  queuedSitePlanSnapshotRequiresFileReplacement,
  sitePlanSnapshotCoalesceKey,
  type SitePlanWriteSnapshot,
} from '../lib/plan-annotations/site-plan-write-policy';

function snapshot(fileChanged: boolean, annotations: string): SitePlanWriteSnapshot {
  return {
    ownerId: 'user-a',
    planId: 'plan-1',
    updatePayload: { annotations },
    retryPayload: { annotations },
    fileChanged,
  };
}

describe('site plan write policy', () => {
  it('keeps a guarded file replacement sticky while adopting the newest snapshot', () => {
    const merged = mergeSitePlanWriteSnapshots(snapshot(true, 'A'), snapshot(false, 'B'));
    expect(merged.fileChanged).toBe(true);
    expect(merged.updatePayload).toEqual({ annotations: 'B' });
    expect(merged.retryPayload).toEqual({ annotations: 'B' });
  });

  it('does not merge snapshots across owners or plans', () => {
    const next = { ...snapshot(false, 'B'), ownerId: 'user-b' };
    expect(mergeSitePlanWriteSnapshots(snapshot(true, 'A'), next)).toBe(next);
  });

  it('detects a persisted guarded retry for the same scoped plan only', () => {
    const key = sitePlanSnapshotCoalesceKey('user-a', 'plan-1');
    expect(queuedSitePlanSnapshotRequiresFileReplacement([
      { coalesceKey: key, rpc: { fn: 'replace_site_plan_file_safely' } },
    ], key)).toBe(true);
    expect(queuedSitePlanSnapshotRequiresFileReplacement([
      { coalesceKey: sitePlanSnapshotCoalesceKey('user-b', 'plan-1'), rpc: { fn: 'replace_site_plan_file_safely' } },
      { coalesceKey: key, rpc: { fn: 'another_rpc' } },
    ], key)).toBe(false);
  });

  it('persists the complete snapshot after both online and replayed guarded replacements', () => {
    const repositoryRoot = resolve(import.meta.dirname, '..');
    const hook = readFileSync(resolve(repositoryRoot, 'hooks/queries/useChantiers.ts'), 'utf8');
    const network = readFileSync(resolve(repositoryRoot, 'context/NetworkContext.tsx'), 'utf8');

    expect(hook).toContain(".rpc('replace_site_plan_file_safely'");
    expect(hook).toContain('.update(latest.retryPayload)');
    expect(network).toContain("op.rpc.fn === 'replace_site_plan_file_safely'");
    expect(network).toContain("supabaseRestMutation(\n              'site_plans',\n              'update',\n              snapshotPatch");
  });
});
