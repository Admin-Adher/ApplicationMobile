import { describe, expect, it } from 'vitest';
import { buildVisitReportHtml } from '../vercel-app/lib/reportBuilder';
import { visitSignatureImageSource } from '../vercel-app/lib/visit-signature';
import { projectTerrainChanges, type WebTerrainChange } from '../vercel-app/lib/web-terrain-edits';
import type { WebQueuedOperation } from '../vercel-app/lib/web-outbox';

function operation(rowId: string, change: WebTerrainChange): WebQueuedOperation {
  return { kind: 'terrain_action', key: 'fixture', owner: 'actor:organization', createdAt: 1, payload: { rowId, change } };
}

describe('Terrain web repairs', () => {
  it('renders raw mobile SVG and keeps the web PNG in the visit report', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1L10 10"/></svg>';
    const png = 'data:image/png;base64,c2lnbmF0dXJl';
    const encoded = visitSignatureImageSource(svg);
    expect(encoded).toBe('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
    const html = buildVisitReportHtml({ visit: { conducteur_signature: svg, entrepriseSignature: png } });
    expect(html).toContain('src="' + encoded + '"');
    expect(html).toContain('src="' + png + '"');
    expect(visitSignatureImageSource('javascript:alert(1)')).toBe('');
  });

  it('projects one checklist point onto the current row and preserves unrelated checks', () => {
    const visit = { id: 'VIS-1', status: 'in_progress', checklist_items: [{ id: 'first', checked: false }, { id: 'second', checked: true }] };
    const change = operation(visit.id, { action: 'visit_checklist_item', itemId: 'first', checked: true });
    const rows = [visit];
    expect(projectTerrainChanges(rows, [change], 'visit_checklist_item')[0].checklist_items.map(item => item.checked)).toEqual([true, true]);
    expect(visit.checklist_items[0].checked).toBe(false);
    expect(projectTerrainChanges(rows, [{ ...change, error: 'Refus' }], 'visit_checklist_item')).toBe(rows);
  });

  it('preserves other task comments and avoids an optimistic duplicate after acknowledgement', () => {
    const local = { id: 'local', author: 'Adrien', content: 'À contrôler', createdAt: '2026-11-06T20:00:00Z' };
    const remote = { ...local, id: 'remote', author: 'Camille', content: 'Terminé' };
    const task = { id: 'task', comments: [remote] };
    const change = operation(task.id, { action: 'task_comment', change: { action: 'add', comment: local } });
    const projected = projectTerrainChanges([task], [change], 'task_comment');
    expect(projected[0].comments).toEqual([remote, local]);
    expect(projectTerrainChanges(projected, [change], 'task_comment')[0].comments).toEqual([remote, local]);
  });
});
