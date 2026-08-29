import { describe, expect, it } from 'vitest';
import {
  buildIncidentsWorkspaceModel,
  filterIncidentSummaries,
  formatIncidentDate,
  normalizeIncidentSeverity,
  normalizeIncidentStatus,
} from '../vercel-app/app/web/incidents-workspace/incidents-workspace-model';

describe('BuildTrack incidents workspace model', () => {
  const incidents = [
    {
      id: 'INC-RESOLVED',
      title: 'Accès encombré',
      severity: 'minor',
      status: 'closed',
      location: 'Zone logistique',
      reported_at: '2026-08-25',
    },
    {
      id: 'INC-CRITICAL',
      title: 'Garde-corps manquant',
      severity: 'critical',
      status: 'open',
      location: 'Bâtiment A - Toiture',
      reported_by: 'Marc Dupont',
      reported_at: '2026-08-29T09:32:00Z',
    },
    {
      id: 'INC-MAJOR',
      title: 'Fuite au local technique',
      severity: 'high',
      status: 'in-progress',
      description: 'Fuite d’eau au niveau du compteur principal.',
      reported_at: '2026-08-28T14:17:00Z',
    },
    {
      id: 'INC-DONE-CRITICAL',
      title: 'Ancienne alerte',
      severity: 'critical',
      status: 'done',
      reported_at: '2026-08-20',
    },
  ];

  it('normalizes legacy values, counts the workflow and prioritizes active severity', () => {
    const model = buildIncidentsWorkspaceModel(incidents);

    expect(model.counts).toEqual({ all: 4, priority: 2, open: 1, investigating: 1, resolved: 2 });
    expect(model.activeCount).toBe(2);
    expect(model.criticalCount).toBe(1);
    expect(model.summaries.map(incident => incident.id)).toEqual([
      'INC-CRITICAL',
      'INC-MAJOR',
      'INC-DONE-CRITICAL',
      'INC-RESOLVED',
    ]);
    expect(normalizeIncidentStatus('in-progress')).toBe('investigating');
    expect(normalizeIncidentSeverity('high')).toBe('major');
  });

  it('filters by operational state and accent-insensitive full text without mutating the source', () => {
    const originalOrder = incidents.map(incident => incident.id);
    const model = buildIncidentsWorkspaceModel(incidents);

    expect(filterIncidentSummaries(model.summaries, 'priority', '').map(incident => incident.id)).toEqual(['INC-CRITICAL', 'INC-MAJOR']);
    expect(filterIncidentSummaries(model.summaries, 'all', 'batiment toiture').map(incident => incident.id)).toEqual(['INC-CRITICAL']);
    expect(filterIncidentSummaries(model.summaries, 'investigating', 'fuite eau').map(incident => incident.id)).toEqual(['INC-MAJOR']);
    expect(incidents.map(incident => incident.id)).toEqual(originalOrder);
  });

  it('formats date-only and timestamp values in the requested locale', () => {
    expect(formatIncidentDate('2026-08-29', 'fr-FR')).toContain('août');
    expect(formatIncidentDate('2026-08-29T09:32:00Z', 'es-ES')).toContain('ago');
    expect(formatIncidentDate('', 'fr-FR')).toBe('Date non renseignée');
  });
});
