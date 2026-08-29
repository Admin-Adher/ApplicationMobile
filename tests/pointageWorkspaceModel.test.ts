import { describe, expect, it } from 'vitest';
import {
  buildPointageWorkspaceModel,
  calculateAttendanceDuration,
  formatAttendanceDate,
  formatAttendanceDuration,
  shiftAttendanceDate,
} from '../vercel-app/app/web/pointage-workspace/pointage-workspace-model';

describe('BuildTrack pointage workspace model', () => {
  const entries = [
    {
      id: 'TIME-PRESENT-LATE',
      date: '2026-08-29',
      worker_name: 'Nora Martin',
      company_id: 'company-a',
      company_name: 'Bati Nord',
      arrival_time: '09:10',
    },
    {
      id: 'TIME-DEPARTED',
      date: '2026-08-29',
      worker_name: 'Samir Diallo',
      company_id: 'company-b',
      company_name: 'Elec Pro',
      arrival_time: '07:30',
      departure_time: '16:15',
      notes: 'Niveau 2',
    },
    {
      id: 'TIME-PRESENT-EARLY',
      date: '2026-08-29',
      worker_name: 'Lina Moreau',
      company_id: 'company-a',
      company_name: 'Bati Nord',
      arrival_time: '08:00',
    },
    {
      id: 'TIME-OTHER-DAY',
      date: '2026-08-28',
      worker_name: 'Alex Roy',
      company_name: 'Bati Nord',
      arrival_time: '08:00',
    },
  ];

  it('builds an operational day split with present workers first', () => {
    const originalOrder = entries.map(entry => entry.id);
    const model = buildPointageWorkspaceModel(entries, '2026-08-29');

    expect(model.presentEntries.map(entry => entry.id)).toEqual(['TIME-PRESENT-EARLY', 'TIME-PRESENT-LATE']);
    expect(model.departedEntries.map(entry => entry.id)).toEqual(['TIME-DEPARTED']);
    expect(model.dayEntries.map(entry => entry.id)).toEqual(['TIME-PRESENT-EARLY', 'TIME-PRESENT-LATE', 'TIME-DEPARTED']);
    expect(model.uniqueCompanies).toBe(2);
    expect(model.completedMinutes).toBe(525);
    expect(model.totalEntries).toBe(4);
    expect(entries.map(entry => entry.id)).toEqual(originalOrder);
  });

  it('calculates normal and overnight durations without turning equal times into 24 hours', () => {
    expect(calculateAttendanceDuration('08:00', '17:30')).toBe(570);
    expect(calculateAttendanceDuration('22:00', '02:15')).toBe(255);
    expect(calculateAttendanceDuration('08:00', '08:00')).toBe(0);
    expect(calculateAttendanceDuration('invalid', '17:30')).toBe(0);
    expect(formatAttendanceDuration(525)).toBe('8 h 45');
  });

  it('navigates ISO dates across month boundaries and formats the selected locale', () => {
    expect(shiftAttendanceDate('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftAttendanceDate('2026-09-01', -1)).toBe('2026-08-31');
    expect(formatAttendanceDate('2026-08-29', 'fr-FR', true)).toContain('août');
    expect(formatAttendanceDate('2026-08-29', 'es-ES', true)).toContain('agosto');
  });
});
