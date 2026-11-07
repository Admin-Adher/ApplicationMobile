import { describe, expect, it } from 'vitest';
import { companyActiveTasks, companyOpenReserves, filterTeams } from '../vercel-app/lib/teams-list-model';

const companies = [
  { id: 'electric', name: 'Électricité', short_name: 'ELEC', zone: 'Tour nord', lots: ['Courants faibles'], actual_workers: 2, planned_workers: 10 },
  { id: 'plumbing', name: 'Plomberie', zone: 'Atelier', lots: ['Sanitaire'], actual_workers: 10, planned_workers: 10 },
];
const reserves = [
  { id: 'r1', companies: ['Électricité', 'Plomberie'], status: 'open' },
  { id: 'r2', company: 'ELEC', status: 'verification' },
  { id: 'r3', company: 'Électricité', status: 'closed' },
  { id: 'r4', company: 'Électricité', status: 'open', deleted_at: '2026-11-01' },
];

describe('team list controls', () => {
  it('searches names, short names, zones and trades ignoring accents and case', () => {
    for (const query of [' ELECTRICITE ', 'elec', 'NORD', 'faibles']) {
      expect(filterTeams(companies, reserves, query, 'name').map(company => company.id)).toEqual(['electric']);
    }
    expect(filterTeams(companies, reserves, 'absent', 'name')).toEqual([]);
  });

  it('orders presence ratios and open reserves without mutating the loaded company list', () => {
    expect(filterTeams(companies, reserves, '', 'presence').map(company => company.id)).toEqual(['plumbing', 'electric']);
    expect(filterTeams(companies, reserves, '', 'reserves').map(company => company.id)).toEqual(['electric', 'plumbing']);
    expect(companyOpenReserves(companies[0], reserves)).toBe(2);
    expect(companies.map(company => company.id)).toEqual(['electric', 'plumbing']);
  });

  it('handles unplanned or invalid staffing figures deterministically', () => {
    expect(filterTeams([{ id: 'b', name: 'B', actual_workers: 5, planned_workers: 0 }, { id: 'a', name: 'A', actual_workers: 'invalid' }], [], '', 'presence').map(company => company.id)).toEqual(['a', 'b']);
  });

  it('counts active tasks stored with a company ID or a name and excludes finished tasks', () => {
    expect(companyActiveTasks(companies[0], [{ company: 'electric', status: 'todo' }, { company: 'Électricité', status: 'in_progress' }, { company: 'ELEC', status: 'done' }, { company: 'plumbing', status: 'todo' }])).toBe(2);
  });
});
