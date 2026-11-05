import { describe, expect, it } from 'vitest';
import { buildOprSignature, issueOprAccess, verifyOprAccess } from '../vercel-app/lib/opr-signature';
import { buildWeeklyAttendanceCsv } from '../vercel-app/app/web/pointage-workspace/pointage-workspace-model';
import { buildPlanningGantt } from '../vercel-app/app/web/planning-workspace/planning-model';
import { recoverRejectedOprWrite } from '../lib/oprQueueRecovery';

describe('BuildTrack parity fixes', () => {
  it('retries a proven OPR date rejection without replacing the visit date', () => {
    const data = { visit_contradictoire: '17/09/2026' };
    const entry = {
      table: 'oprs', op: 'update', filter: { column: 'id', value: 'OPR-1' }, terminal: true,
      terminalStatus: 'server_rejected', lastError: '[22P02] — invalid input syntax for type boolean: "17/09/2026"', data,
    };
    const repaired = recoverRejectedOprWrite(entry);
    expect(repaired.terminal).toBe(false);
    expect(repaired.data).toEqual(data);
    expect(recoverRejectedOprWrite(repaired)).toBe(repaired);
    const unrelated = { ...entry, lastError: '[22P02] — invalid input syntax for type integer: "17/09/2026"' };
    expect(recoverRejectedOprWrite(unrelated)).toBe(unrelated);
  });

  it('binds a signature link to one OPR and expires it', () => {
    const now = Date.UTC(2026, 10, 5);
    const subject = { oprId: 'OPR-1', signerId: 'signer-1', signerVersion: 'document-version' };
    const token = issueOprAccess(subject, 'secret', now);
    expect(verifyOprAccess(token, 'OPR-1', 'secret', now)).toMatchObject(subject);
    expect(verifyOprAccess(token, 'OPR-2', 'secret', now)).toBeNull();
    expect(verifyOprAccess(token, 'OPR-1', 'another-secret', now)).toBeNull();
    expect(verifyOprAccess(token, 'OPR-1', 'secret', now + 7 * 86400000)).toBeNull();
    expect(buildOprSignature([[[10, 20], [40, 90]]])).toContain('10,20 40,90');
    expect(buildOprSignature([[[0, 0], ['" onload="x', 1]]])).toBeNull();
  });

  it('exports the selected Monday–Sunday week and escapes spreadsheet formulas', () => {
    const result = buildWeeklyAttendanceCsv([
      { date: '2026-11-01', worker_name: 'Outside' },
      { date: '2026-11-02', worker_name: 'Alice', arrival_time: '22:00', departure_time: '02:00', notes: '=WEBSERVICE("x")' },
      { date: '2026-11-08', worker_name: 'Bob', arrival_time: '09:00' },
    ], '2026-11-05');
    expect(result?.filename).toBe('Pointage_2026-11-02_2026-11-08.csv');
    expect(result?.csv).toContain('"Alice";"Sans entreprise";"22:00";"02:00";"4"');
    expect(result?.csv).toContain("'=WEBSERVICE(\"\"x\"\")");
    expect(result?.csv).toContain('Bob');
    expect(result?.csv).not.toContain('Outside');
  });

  it('clips Gantt bars to the visible dates and accepts dates from Android', () => {
    const result = buildPlanningGantt([
      { id: 'a', title: 'A', start_date: '30/10/2026', deadline: '2026-11-04' },
      { id: 'b', title: 'B', deadline: '2026-11-16' },
    ], new Date(2026, 10, 5, 12));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ from: 0, to: 2, task: { id: 'a' } });
  });
});
