import { describe, expect, it } from 'vitest';
import {
  buildReservePhotoIndex,
  hasPendingReserveCreateOperation,
  planReservePhotoRowReconciliation,
  rebasePendingReservePhotoPayload,
} from '../lib/reservePhotoIntegrity';

describe('reserve photo integrity', () => {
  it('recognizes only a live create parent for the same reserve', () => {
    const create = (id: string, terminal = false) => ({
      table: 'reserves',
      op: 'rpc',
      terminal,
      rpc: { fn: 'create_reserve_with_photos', args: { p_reserve: { id } } },
    });

    expect(hasPendingReserveCreateOperation([create('RSV-1')], 'RSV-1')).toBe(true);
    expect(hasPendingReserveCreateOperation([create('RSV-1', true)], 'RSV-1')).toBe(false);
    expect(hasPendingReserveCreateOperation([create('RSV-2')], 'RSV-1')).toBe(false);
  });

  it('rebases an annotation snapshot on the URI uploaded by its create parent', () => {
    const payload = {
      photos: [
        { id: 'photo-1', uri: 'file:///camera/original.jpg', annotations: [{ id: 'stroke-1' }] },
        { id: 'photo-2', uri: 'file:///camera/new.jpg', annotations: [] },
      ],
      photo_uri: 'file:///camera/original.jpg',
    };
    const serverReserve = {
      photos: [{ id: 'photo-1', uri: 'https://media.example/photo-1.jpg', takenAt: '2026-08-29T10:00:00Z' }],
      photo_uri: 'https://media.example/photo-1.jpg',
    };

    const rebased = rebasePendingReservePhotoPayload(payload, serverReserve);

    expect(rebased.photos[0]).toMatchObject({
      id: 'photo-1',
      uri: 'https://media.example/photo-1.jpg',
      takenAt: '2026-08-29T10:00:00Z',
      annotations: [{ id: 'stroke-1' }],
    });
    expect(rebased.photos[1].uri).toBe('file:///camera/new.jpg');
    expect(rebased.photo_uri).toBe('https://media.example/photo-1.jpg');
  });

  it('soft-deletes only the raw duplicate removed from the desired gallery', () => {
    const annotated = {
      id: 'annotated-photo',
      reserve_id: 'RSV-730-935',
      uri: 'https://media.example/annotated.jpg?signature=one',
    };
    const raw = {
      id: 'raw-photo',
      reserve_id: 'RSV-730-935',
      uri: 'https://media.example/raw.jpg?signature=two',
    };

    const plan = planReservePhotoRowReconciliation(
      [annotated, raw],
      'RSV-730-935',
      [{ ...annotated, annotations: [{ id: 'red-pencil' }] }],
    );

    expect(plan.staleRows).toEqual([raw]);
    expect(plan.rowsToUpdate).toEqual([]);
  });

  it('updates a stable row whose signed URI changed instead of duplicating it', () => {
    const row = {
      id: 'photo-1',
      reserve_id: 'RSV-1',
      uri: 'https://media.example/old.jpg?signature=old',
    };
    const plan = planReservePhotoRowReconciliation(
      [row],
      'RSV-1',
      [{ id: 'photo-1', uri: 'https://media.example/new.jpg?signature=new' }],
    );

    expect(plan.staleRows).toEqual([]);
    expect(plan.rowsToUpdate).toEqual([{ row, patch: { uri: 'https://media.example/new.jpg?signature=new' } }]);
  });

  it('indexes active photo rows once per reserve', () => {
    const active = { id: 'p1', reserve_id: 'RSV-1', uri: 'https://media.example/1.jpg' };
    const deleted = { id: 'p2', reserve_id: 'RSV-1', deleted_at: '2026-08-29T10:00:00Z' };
    const other = { id: 'p3', reserveId: 'RSV-2', uri: 'https://media.example/2.jpg' };

    const index = buildReservePhotoIndex([active, deleted, other]);

    expect(index.get('RSV-1')).toEqual([active]);
    expect(index.get('RSV-2')).toEqual([other]);
  });
});
