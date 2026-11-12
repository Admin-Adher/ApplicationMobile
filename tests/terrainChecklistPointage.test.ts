import { describe, expect, it } from 'vitest';
import { attendanceMinutes, attendanceHoursText, attendanceCsv } from '../lib/attendanceMath';
import { projectChecklistIntents } from '../lib/checklistMutations';
import { queueReplayPriority } from '../lib/syncQueueDependencies';
import { buildWeeklyAttendanceCsv } from '../vercel-app/app/web/pointage-workspace/pointage-workspace-model';
import type { Checklist } from '../constants/types';
import { isAppliedRpcAcknowledgement } from '../lib/syncRpcAcknowledgement';

const checklist: Checklist = { id: 'cl', title: 'Contrôle', type: 'custom', building: '', zone: '', level: '',
  status: 'in_progress', createdAt: '', createdBy: '', items: [{ id: 'a', label: 'A', checked: true }, { id: 'b', label: 'B', checked: false }] };
const setItem = (checked: boolean) => ({ table: 'checklists', op: 'rpc',
  rpc: { fn: 'set_checklist_item_checked', args: { p_checklist_id: 'cl', p_item_id: 'b', p_checked: checked } } });

describe('Terrain checklist and pointage parity regressions', () => {
  it('accepts actual REST-normalized confirmations and keeps uncertain writes queued', () => {
    expect(isAppliedRpcAcknowledgement([{ applied: true }])).toBe(true);
    expect(isAppliedRpcAcknowledgement({ applied: true })).toBe(true);
    for (const value of [null, [], {}, [{ applied: false }], [{ applied: 'true' }], [{ applied: true }, { applied: true }]]) {
      expect(isAppliedRpcAcknowledgement(value)).toBe(false);
    }
  });
  it('projects a mobile offline checkbox on fresh web data without restoring a stale array', () => {
    const [after] = projectChecklistIntents([checklist], [setItem(true)]);
    expect(after.items.map(item => item.checked)).toEqual([true, true]);
    expect(after.status).toBe('completed');
    expect(checklist.items[1].checked).toBe(false);
  });
  it('preserves queued order, repeated sets and ignores other tables', () => {
    const [after] = projectChecklistIntents([checklist], [setItem(true), setItem(true), setItem(false), { ...setItem(true), table: 'other' }]);
    expect(after.items.map(item => item.checked)).toEqual([true, false]);
    expect(after.status).toBe('in_progress');
  });
  it('does not resurrect deleted or missing checklists during offline projection', () => {
    expect(projectChecklistIntents([checklist], [{ table: 'checklists', op: 'delete', filter: { column: 'id', value: 'cl' } }, setItem(true)])).toEqual([]);
    expect(projectChecklistIntents([], [setItem(true)])).toEqual([]);
    expect(projectChecklistIntents([checklist], [{ table: 'checklists', op: 'delete' }])).toEqual([checklist]);
  });
  it('replays checklist creation before its checkboxes and deletion', () => {
    expect(queueReplayPriority({ table: 'checklists', op: 'insert' })).toBeLessThan(queueReplayPriority(setItem(true)));
    expect(queueReplayPriority(setItem(true))).toBe(queueReplayPriority({ table: 'checklists', op: 'delete' }));
  });
  it('keeps exact minutes for overnight work and totals before rounding', () => {
    expect(attendanceMinutes('22:00', '06:00')).toBe(480);
    expect(attendanceMinutes('08:00', '09:10')).toBe(70);
    expect(attendanceMinutes('08:00', '08:00')).toBe(0);
    expect(attendanceMinutes('25:00', '06:00')).toBe(0);
    expect(attendanceMinutes('08:00')).toBe(0);
    expect(attendanceHoursText(70 / 60)).toBe('1,17');
    expect(attendanceHoursText((70 + 70 + 70) / 60)).toBe('3,5');
    expect(attendanceHoursText(70 / 60, 'en-US')).toBe('1.17');
  });
  it('escapes quotes, delimiters and multiline notes without losing their contents', () => {
    const csv = attendanceCsv([['Compagnon', 'Notes'], ['Jean "Recette"', 'Note, avec; séparateurs\net retour']]);
    expect(csv).toBe('\uFEFF"Compagnon";"Notes"\r\n"Jean ""Recette""";"Note, avec; séparateurs\net retour"\r\n');
    expect(attendanceCsv([['=SUM(A1)', null]])).toContain('"\'=SUM(A1)";""');
  });
  it('produces identical web and mobile CSV cells for the same 70 minute attendance', () => {
    const entry = { id: 'time', date: '2026-11-12', worker_name: 'Jean "Recette"', company_name: 'Entreprise',
      arrival_time: '08:00', departure_time: '09:10', notes: 'Note, conservée', task_title: '', recorded_by: 'Recette' };
    const web = buildWeeklyAttendanceCsv([entry], entry.date)!;
    const mobileRow = attendanceCsv([['12/11/2026', entry.worker_name, entry.company_name, '08:00', '09:10', attendanceHoursText(attendanceMinutes('08:00', '09:10') / 60), '', 'Recette', entry.notes]]).slice(1);
    expect(web.csv).toContain(mobileRow);
  });
});
