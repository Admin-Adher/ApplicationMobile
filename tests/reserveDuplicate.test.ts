import { describe, expect, it } from 'vitest';
import { reserveDuplicatePayload } from '../vercel-app/lib/reserve-duplicate';

describe('reserve duplication', () => {
  it('keeps the location and assignment while starting a new unsigned reserve', () => {
    const source = {
      id: 'old', title: 'Joint', description: 'À reprendre', organization_id: 'org', chantier_id: 'site',
      company: 'A', companies: ['A', 'B'], plan_id: 'plan', plan_x: 0, plan_y: 25, kind: 'observation',
      status: 'closed', deadline: '2026-11-01', version: 9, comments: ['old'], history: ['old'],
      photo_uri: 'private', photos: ['private'], enterprise_signature: 'signature', company_signatures: ['signature'],
      enterprise_acknowledged_at: '2026-11-01', closed_at: '2026-11-02', archived_at: '2026-11-03',
      visite_id: 'visit', linked_task_id: 'task',
    };
    const copy = reserveDuplicatePayload(source, 'new', '2026-11-07', ['duplicated']);
    expect(copy).toMatchObject({
      id: 'new', title: 'Joint (copie)', description: 'À reprendre', status: 'open', kind: 'observation',
      organization_id: 'org', chantier_id: 'site', companies: ['A', 'B'], plan_x: 0, plan_y: 25,
      deadline: null, comments: [], history: ['duplicated'], photos: null, photo_uri: null, visite_id: null,
    });
    for (const key of ['version', 'enterprise_signature', 'company_signatures', 'enterprise_acknowledged_at',
      'closed_at', 'archived_at', 'linked_task_id']) expect(copy).not.toHaveProperty(key);
    copy.companies.push('C');
    expect(source.companies).toEqual(['A', 'B']);
  });

  it('supports older reserves with a single company and no kind', () => {
    expect(reserveDuplicatePayload({ title: 'Ancienne', company: 'A' }, 'new', '2026-11-07', []))
      .toMatchObject({ kind: 'reserve', company: 'A', companies: ['A'], title: 'Ancienne (copie)' });
  });
});
