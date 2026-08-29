import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web journal experience', () => {
  it('replaces generic KPI cards with a dedicated daily register', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const journal = page.slice(page.indexOf('function JournalView'), page.indexOf('function PointageView'));
    const component = read('vercel-app/app/web/journal-workspace/JournalWorkspace.tsx');

    expect(page).toContain("import JournalWorkspace from './journal-workspace/JournalWorkspace'");
    expect(journal).toContain('<JournalWorkspace');
    expect(journal).not.toContain('<Kpi');
    expect(component).toContain('data-testid="web-journal-workspace"');
    expect(component).toContain('className={styles.overviewMetrics}');
    expect(component).toContain('className={styles.entryList}');
  });

  it('groups the daily form around the real construction workflow', () => {
    const component = read('vercel-app/app/web/journal-workspace/JournalWorkspace.tsx');

    expect(component).toContain('<strong>Conditions du jour</strong>');
    expect(component).toContain('<strong>Production</strong>');
    expect(component).toContain('<strong>Vie du chantier</strong>');
    expect(component).toContain('aria-busy={busy}');
    expect(component).toContain('role="alert"');
    expect(component).toContain('Modifications non enregistrées');
  });

  it('keeps discovery, filtering and disclosure accessible', () => {
    const component = read('vercel-app/app/web/journal-workspace/JournalWorkspace.tsx');

    expect(component).toContain('role="toolbar" aria-label="Filtrer les entrées du journal"');
    expect(component).toContain('aria-pressed={filter === item.key}');
    expect(component).toContain('type="search"');
    expect(component).toContain('<details className={styles.entryDetails}>');
    expect(component).toContain('role="status" aria-live="polite"');
    expect(component).not.toMatch(/[⚠📘📅👥]/u);
  });

  it('preserves compact responsive layout, touch targets and reduced motion', () => {
    const css = read('vercel-app/app/web/journal-workspace/JournalWorkspace.module.css');

    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('@media (max-width: 480px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/\.filters button \{[\s\S]*?min-height: 44px;/);
    expect(css).toContain('content-visibility: auto');
    expect(css).toContain('.workspace :is(button, input, textarea, summary):focus-visible');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  });
});
