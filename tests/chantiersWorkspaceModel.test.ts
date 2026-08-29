import { describe, expect, it } from 'vitest';
import {
  buildChantiersWorkspaceModel,
  filterAndSortBuildings,
  filterChantierSummaries,
  formatChantierDate,
  normalizeChantierStatus,
} from '../vercel-app/app/web/chantiers-workspace/chantiers-workspace-model';

describe('BuildTrack chantiers workspace model', () => {
  const companies = [
    { id: 'CO-1', name: 'Bouygues', short_name: 'BOUY', color: '#1b8a66' },
    { id: 'CO-2', name: 'Entreprise Delta' },
  ];
  const projects = [
    {
      id: 'CH-TROPICALIA',
      name: 'Tropicalia',
      address: 'République Dominicaine',
      status: 'active',
      end_date: '2026-12-31',
      company_ids: ['CO-1'],
      buildings: JSON.stringify([
        { id: 'B-10', name: 'GuestBlock 10', levels: [{ id: 'L-1', name: 'RDC', zones: [] }] },
        { id: 'B-2', name: 'GuestBlock 2', levels: [{ id: 'L-2', name: 'RDC', zones: [{ id: 'Z-1', name: 'Hall' }] }, { id: 'L-3', name: 'R+1', zones: [] }] },
      ]),
    },
    {
      id: 'CH-PAUSED',
      name: 'Résidence Nord',
      status: 'suspended',
      buildings: [],
    },
    {
      id: 'CH-DONE',
      name: 'Atelier terminé',
      status: 'done',
      buildings: [],
    },
  ];

  it('normalizes portfolio status, parses structure and keeps company scope', () => {
    const model = buildChantiersWorkspaceModel(projects, companies, 'CH-TROPICALIA');

    expect(model.counts).toEqual({ all: 3, active: 1, paused: 1, completed: 1 });
    expect(model.totalBuildings).toBe(2);
    expect(model.selected?.name).toBe('Tropicalia');
    expect(model.selected?.levelCount).toBe(3);
    expect(model.selected?.zoneCount).toBe(1);
    expect(model.selected?.companies.map(company => company.name)).toEqual(['BOUY']);
    expect(normalizeChantierStatus('suspendu')).toBe('paused');
    expect(normalizeChantierStatus('closed')).toBe('completed');
  });

  it('filters accent-insensitively and sorts building names numerically without mutating source', () => {
    const model = buildChantiersWorkspaceModel(projects, companies, 'CH-TROPICALIA');
    const originalNames = model.selected!.buildings.map(building => building.name);

    expect(filterChantierSummaries(model.projects, 'paused', 'residence').map(project => project.id)).toEqual(['CH-PAUSED']);
    expect(filterAndSortBuildings(model.selected!.buildings, 'r+1', 'name').map(building => building.name)).toEqual(['GuestBlock 2']);
    expect(filterAndSortBuildings(model.selected!.buildings, '', 'name').map(building => building.name)).toEqual(['GuestBlock 2', 'GuestBlock 10']);
    expect(filterAndSortBuildings(model.selected!.buildings, '', 'levels').map(building => building.name)).toEqual(['GuestBlock 2', 'GuestBlock 10']);
    expect(model.selected!.buildings.map(building => building.name)).toEqual(originalNames);
  });

  it('formats valid dates and fails closed for missing or invalid dates', () => {
    expect(formatChantierDate('2026-12-31', 'fr-FR')).toContain('déc.');
    expect(formatChantierDate('', 'fr-FR')).toBe('—');
    expect(formatChantierDate('date-invalide', 'fr-FR')).toBe('—');
  });
});
