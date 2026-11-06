import { describe, expect, it } from 'vitest';
import { recoverReserveDraft, reserveEditPatch, reserveGalleryChanged, type ReserveDraft } from '../vercel-app/lib/reserve-edit-draft';
import { isReserveEditConflict, type WebQueuedOperation } from '../vercel-app/lib/web-outbox';

const base: ReserveDraft = {
  kind: 'reserve', title: 'Porte', description: 'Description initiale', chantierId: 'c1',
  building: 'A', buildingId: '', level: 'RDC', levelId: '', zone: '',
  priority: 'medium', status: 'open', deadline: '', planId: '', lotId: '', visiteId: '',
  companies: ['Électricité'], photos: [],
};

describe('Reprise des brouillons de réserve web', () => {
  it('reporte uniquement les champs édités et conserve les champs mis à jour au serveur', () => {
    const draft = { ...base, title: 'Porte à contrôler', visiteId: 'visite-1' };
    const patch = reserveEditPatch(base, draft, { title: draft.title, visite_id: 'visite-1', description: draft.description });
    expect(patch).toEqual({ title: 'Porte à contrôler', visite_id: 'visite-1' });
    expect(recoverReserveDraft({ ...base, description: 'Description du serveur', status: 'verification' }, patch))
      .toMatchObject({ title: 'Porte à contrôler', description: 'Description du serveur', visiteId: 'visite-1', status: 'verification' });
  });

  it('conserve les nouvelles photos serveur et les fichiers locaux sans remettre une photo supprimée ailleurs', () => {
    const retained = { id: 'p1', uri: 'https://example.test/photos/1?token=old', kind: 'defect' as const };
    const removedHere = { id: 'p2', uri: 'btmedia://p2' };
    const removedOnServer = { id: 'p3', uri: 'btmedia://p3' };
    const addedOnServer = { id: 'p4', uri: 'btmedia://p4' };
    const file = new File(['photo'], 'recette.png', { type: 'image/png' });
    const addedHere = { id: 'local', uri: '', file };
    const oldPhotos = [retained, removedHere, removedOnServer];
    const saved = [{ ...retained, kind: 'resolution' as const }, removedOnServer, addedHere];
    const newerRetained = { ...retained, uri: 'https://example.test/photos/1?token=new' };
    expect(reserveGalleryChanged(oldPhotos, saved)).toBe(true);
    const recovered = recoverReserveDraft({ ...base, photos: [newerRetained, removedHere, addedOnServer] }, {},
      undefined, { saved, base: oldPhotos, removeIds: ['p2'] });
    expect(recovered.photos).toEqual([{ ...newerRetained, kind: 'resolution', annotations: undefined }, addedOnServer, addedHere]);
  });

  it('reconnaît les conflits des anciennes files et conserve les photos serveur inconnues du brouillon', () => {
    const operation: WebQueuedOperation = {
      owner: 'account:organization', key: 'old', kind: 'reserve_edit', payload: {}, createdAt: 1,
      error: 'La réserve a été modifiée entre-temps. Rechargez sa fiche.',
    };
    expect(isReserveEditConflict(operation)).toBe(true);
    expect(isReserveEditConflict({ ...operation, kind: 'send_message' })).toBe(false);
    expect(isReserveEditConflict({ ...operation, error: 'Session expirée' })).toBe(false);
    const remote = { id: 'new', uri: 'btmedia://new' };
    const removed = { id: 'old', uri: 'btmedia://old' };
    expect(recoverReserveDraft({ ...base, photos: [remote, removed] }, { visite_id: null }, undefined,
      { saved: [], removeIds: ['old'] })).toMatchObject({ visiteId: '', photos: [remote] });
  });
});
