import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateWebStaticText } from '../vercel-app/lib/i18n';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web pointage experience', () => {
  it('replaces generic KPI cards with a dedicated attendance register', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const pointage = page.slice(page.indexOf('function PointageView'), page.indexOf('function AnalyticsView'));
    const component = read('vercel-app/app/web/pointage-workspace/PointageWorkspace.tsx');

    expect(page).toContain("import PointageWorkspace from './pointage-workspace/PointageWorkspace'");
    expect(pointage).toContain('<PointageWorkspace');
    expect(pointage).not.toContain('<Kpi');
    expect(component).toContain('data-testid="web-pointage-workspace"');
    expect(component).toContain('Présents maintenant');
    expect(component).toContain('Départs enregistrés');
  });

  it('keeps the daily workflow explicit and accessible', () => {
    const component = read('vercel-app/app/web/pointage-workspace/PointageWorkspace.tsx');

    expect(component).toContain('aria-label="Naviguer entre les journées"');
    expect(component).toContain('aria-label="Jour précédent"');
    expect(component).toContain('aria-label="Jour suivant"');
    expect(component).toContain('aria-busy={busy}');
    expect(component).toContain('role="alert"');
    expect(component).toContain('Enregistrer le départ');
    expect(component).toContain('Laissez vide si la personne est encore sur site.');
    expect(component).not.toMatch(/[⏱👷🏗]/u);
  });

  it('uses responsive touch targets, compact rendering and reduced motion', () => {
    const css = read('vercel-app/app/web/pointage-workspace/PointageWorkspace.module.css');

    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('@media (max-width: 480px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('content-visibility: auto');
    expect(css).toMatch(/\.rowActions button \{[\s\S]*?min-height: 44px;/);
    expect(css).toContain('.workspace :is(button, input, select, textarea):focus-visible');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  });

  it('keeps the new operational copy available in English and Spanish', () => {
    expect(translateWebStaticText('Registre de présence', 'en')).toBe('Attendance register');
    expect(translateWebStaticText('Registre de présence', 'es')).toBe('Registro de presencia');
    expect(translateWebStaticText('3 personnes encore sur site.', 'en')).toBe('3 people still on site.');
    expect(translateWebStaticText('3 pointages au total', 'es')).toBe('3 fichajes en total');
  });
});
