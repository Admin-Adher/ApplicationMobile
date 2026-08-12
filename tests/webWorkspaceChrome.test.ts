import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack authenticated web workspace', () => {
  it('owns the authenticated shell in one dedicated component', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const chrome = read('vercel-app/app/web/WorkspaceChrome.tsx');

    expect(page).toContain("import { WorkspaceChrome } from './WorkspaceChrome'");
    expect(page).toContain('<WorkspaceChrome');
    expect(page).not.toContain('function ProjectDropdown');
    expect(chrome).toContain('<BuildTrackBrand variant="wordmark"');
    expect(chrome).toContain('WorkspaceProjectPicker');
    expect(chrome).toContain('aria-current={item.active');
  });

  it('keeps the product chrome restrained, accessible and touch friendly', () => {
    const css = read('vercel-app/app/web/WorkspaceChrome.module.css');

    expect(css).toContain('var(--font-buildtrack-body)');
    expect(css).toContain('var(--font-buildtrack-display)');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('@media (max-width: 620px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  });

  it('removes duplicate Dashboard actions and the fake B logo', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const dashboardStart = page.indexOf('function Dashboard({');
    const dashboardEnd = page.indexOf('function DashboardKpi(', dashboardStart);
    const dashboard = page.slice(dashboardStart, dashboardEnd);

    expect(dashboardStart).toBeGreaterThan(-1);
    expect(dashboardEnd).toBeGreaterThan(dashboardStart);
    expect(dashboard).not.toContain('dashboardLogo');
    expect(dashboard).not.toContain('dashboardQuickActions');
    expect(dashboard).not.toContain('onCreateReserve');
    expect(dashboard).not.toContain('onCreateVisit');
    expect(dashboard).toContain("t('dashboard.welcome'");
  });

  it('localizes the personalized Dashboard greeting in all supported languages', () => {
    const i18n = read('vercel-app/lib/i18n.ts');
    expect(i18n.match(/'dashboard\.welcome'/g)).toHaveLength(3);
    expect(i18n).toContain("'dashboard.welcome': 'Bonjour, {name}'");
    expect(i18n).toContain("'dashboard.welcome': 'Hello, {name}'");
    expect(i18n).toContain("'dashboard.welcome': 'Hola, {name}'");
  });
});
