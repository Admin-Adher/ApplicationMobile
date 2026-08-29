import { describe, expect, it } from 'vitest';
import {
  buildOprWorkspaceModel,
  filterOprSummaries,
  formatOprDate,
  summarizeOpr,
} from '../vercel-app/app/web/opr-workspace/opr-workspace-model';

describe('BuildTrack OPR workspace model', () => {
  const draft = {
    id: 'OPR-2',
    title: 'Réception niveau 2',
    date: '2026-08-28',
    status: 'draft',
    building: 'Bâtiment A',
    level: 'R+2',
    items: [
      { id: 'i-1', lot_name: 'Peinture', status: 'ok' },
      { id: 'i-2', lotName: 'Électricité', status: 'reserve', reserve_id: 'RSV-2' },
    ],
  };
  const signed = {
    id: 'OPR-1',
    title: 'Réception niveau 1',
    date: '2026-08-20',
    status: 'signed',
    items: [{ id: 'i-3', lotName: 'CVC', status: 'ok' }],
  };

  it('normalizes mixed database and application field names', () => {
    const summary = summarizeOpr(draft);

    expect(summary.location).toBe('Bâtiment A · R+2');
    expect(summary.items[0].lotName).toBe('Peinture');
    expect(summary.items[1].reserveId).toBe('RSV-2');
    expect(summary.conformity).toBe(50);
  });

  it('builds compact status and linked-reserve totals', () => {
    const model = buildOprWorkspaceModel(
      [signed, draft],
      [
        { id: 'RSV-2', status: 'open' },
        { id: 'RSV-CLOSED', status: 'closed', source: 'opr' },
        { id: 'RSV-ARCHIVED', status: 'open', type: 'observation', archived_at: '2026-08-01' },
      ],
      reserve => Boolean(reserve.archived_at),
    );

    expect(model.summaries.map(opr => opr.id)).toEqual(['OPR-2', 'OPR-1']);
    expect(model.counts).toMatchObject({ all: 2, active: 1, draft: 1, in_progress: 0, signed: 1 });
    expect(model.linkedOpenReserveCount).toBe(1);
    expect(model.continuation?.id).toBe('OPR-2');
  });

  it('filters without mutating the date-ordered register', () => {
    const model = buildOprWorkspaceModel([signed, draft], []);

    expect(filterOprSummaries(model.summaries, 'signed').map(opr => opr.id)).toEqual(['OPR-1']);
    expect(model.summaries.map(opr => opr.id)).toEqual(['OPR-2', 'OPR-1']);
    expect(formatOprDate('2026-08-28', true)).toContain('août');
  });
});
