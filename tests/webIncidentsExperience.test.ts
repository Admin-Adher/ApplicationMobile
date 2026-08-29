import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateWebStaticText } from '../vercel-app/lib/i18n';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web incidents experience', () => {
  it('replaces generic KPI cards with a dedicated safety register', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const view = page.slice(page.indexOf('function IncidentsView'), page.indexOf('function EquipesView'));
    const component = read('vercel-app/app/web/incidents-workspace/IncidentsWorkspace.tsx');

    expect(page).toContain("import IncidentsWorkspace from './incidents-workspace/IncidentsWorkspace'");
    expect(view).toContain('<IncidentsWorkspace');
    expect(view).not.toContain('<Kpi');
    expect(component).toContain('data-testid="web-incidents-workspace"');
    expect(component).toContain('Chaque alerte, du signalement à la résolution');
    expect(component).toContain('Incidents du chantier');
    expect(component).toContain('Nouveau signalement');
  });

  it('keeps filtering, reporting and status changes accessible and explicit', () => {
    const component = read('vercel-app/app/web/incidents-workspace/IncidentsWorkspace.tsx');

    expect(component).toContain('useDeferredValue(query)');
    expect(component).toContain('role="toolbar" aria-label="Filtrer les incidents"');
    expect(component).toContain('aria-pressed={filter === item.key}');
    expect(component).toContain('aria-busy={busy}');
    expect(component).toContain('role="alert"');
    expect(component).toContain('Prendre en charge');
    expect(component).toContain('Signaler l’incident');
    expect(component).not.toMatch(/[🚨⚠️🛡]/u);
  });

  it('uses responsive, reduced-motion and performance safeguards', () => {
    const css = read('vercel-app/app/web/incidents-workspace/IncidentsWorkspace.module.css');

    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('@media (max-width: 480px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('content-visibility: auto');
    expect(css).toMatch(/\.recordActions button \{[\s\S]*?min-height: 44px;/);
    expect(css).toContain('.workspace :is(button, input, select, textarea):focus-visible');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  });

  it('keeps the new operational copy available in English and Spanish', () => {
    expect(translateWebStaticText('Sécurité chantier', 'en')).toBe('Site safety');
    expect(translateWebStaticText('Incidents du chantier', 'es')).toBe('Incidentes de la obra');
    expect(translateWebStaticText('2 incidents affichés', 'en')).toBe('2 incidents shown');
    expect(translateWebStaticText('Prendre en charge', 'es')).toBe('Hacerse cargo');
  });
});
