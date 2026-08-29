import { describe, expect, it } from 'vitest';
import {
  buildJournalWorkspaceModel,
  countAttendanceForDate,
  filterJournalEntries,
  formatJournalDate,
  journalDateParts,
} from '../vercel-app/app/web/journal-workspace/journal-workspace-model';

describe('BuildTrack journal workspace model', () => {
  const entries = [
    {
      id: 'JRN-OLD',
      date: '2026-08-12',
      weather: 'Pluie',
      workerCount: 4,
      workDone: 'Reprise des seuils',
      incidents: 'Livraison retardée',
      author: 'Nora',
    },
    {
      id: 'JRN-TODAY',
      date: '2026-08-29',
      weather: 'Soleil',
      workerCount: '7',
      workDone: 'Pose des réseaux du niveau 2',
      materials: 'Tubes cuivre',
      author: 'Adrien',
    },
    {
      id: 'JRN-RECENT',
      date: '2026-08-26',
      workerCount: 5,
      workDone: 'Coulage de la dalle',
    },
  ];

  it('builds a date-ordered operational summary without mutating the source', () => {
    const originalOrder = entries.map(entry => entry.id);
    const model = buildJournalWorkspaceModel(entries, '2026-08-29');

    expect(model.entries.map(entry => entry.id)).toEqual(['JRN-TODAY', 'JRN-RECENT', 'JRN-OLD']);
    expect(entries.map(entry => entry.id)).toEqual(originalOrder);
    expect(model.todayEntry?.id).toBe('JRN-TODAY');
    expect(model.totalWorkers).toBe(16);
    expect(model.incidentDays).toBe(1);
    expect(model.counts).toEqual({ all: 3, recent: 2, incidents: 1 });
  });

  it('filters the register by recent period, incident and full-text query', () => {
    const model = buildJournalWorkspaceModel(entries, '2026-08-29');

    expect(filterJournalEntries(model.entries, 'recent', '', '2026-08-29').map(entry => entry.id)).toEqual(['JRN-TODAY', 'JRN-RECENT']);
    expect(filterJournalEntries(model.entries, 'incidents', '', '2026-08-29').map(entry => entry.id)).toEqual(['JRN-OLD']);
    expect(filterJournalEntries(model.entries, 'all', 'cuivre', '2026-08-29').map(entry => entry.id)).toEqual(['JRN-TODAY']);
  });

  it('counts unique attendance and formats stable French dates', () => {
    expect(countAttendanceForDate([
      { date: '2026-08-29', worker_name: 'Mina' },
      { date: '2026-08-29', worker_name: 'Mina' },
      { date: '2026-08-29', workerName: 'Léo' },
      { date: '2026-08-28', worker_name: 'Sam' },
    ], '2026-08-29')).toBe(2);
    expect(formatJournalDate('2026-08-29', true)).toContain('août');
    expect(journalDateParts('2026-08-29')).toMatchObject({ day: '29' });
  });
});
