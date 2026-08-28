import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8').replace(/\r\n/g, '\n');

describe('reserve create and annotation ordering', () => {
  it('queues an edit behind a local-first create instead of uploading it in parallel', () => {
    const source = read('hooks/queries/useReserves.ts');
    const update = source.slice(source.indexOf('const updateReserve = useCallback'), source.indexOf('const updateReserveFields'));
    const pendingGuard = update.indexOf('hasPendingReserveCreateOperation(queueRef.current, reserve.id)');
    const directUpload = update.indexOf('uploadLocalPhotosInPayload(\'reserves\', payload)');

    expect(pendingGuard).toBeGreaterThan(-1);
    expect(pendingGuard).toBeLessThan(directUpload);
    expect(update).toContain('queuePendingCreatePatch(payload)');
    expect(update).toContain('proveNeverStarted: true');
  });

  it('rebases local photo URIs on the live gallery before any queued upload', () => {
    const source = read('context/NetworkContext.tsx');
    const executor = source.slice(
      source.indexOf('const executeQueuedOperation = async'),
      source.indexOf('const appliedReserveCreateIds'),
    );
    const liveGalleryRead = executor.indexOf("'photos,photo_uri'");
    const rebase = executor.indexOf('rebasePendingReservePhotoPayload(data, liveReserveForPhotoPatch)');
    const upload = executor.indexOf('uploadLocalPhotosInPayload(op.table, data)');

    expect(liveGalleryRead).toBeGreaterThan(-1);
    expect(rebase).toBeGreaterThan(liveGalleryRead);
    expect(rebase).toBeLessThan(upload);
    expect(executor).not.toMatch(/E35[A-Z]/);
  });

  it('keeps the child untouched when its create parent did not apply', () => {
    const source = read('context/NetworkContext.tsx');
    const loop = source.slice(source.indexOf('const appliedReserveCreateIds'), source.indexOf('// Keep only unresolved items'));

    expect(loop).toContain('prepared.operations.find(candidate => (');
    expect(loop).toContain('hasPendingReserveCreateOperation([candidate], photoPatchReserveId)');
    expect(loop).toContain('!appliedReserveCreateIds.has(photoPatchReserveId)');
    expect(loop).toContain('failedOps.push({');
    expect(loop).toContain('appliedReserveCreateIds.add(createdReserveId)');
  });
});
