import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateWebStaticText } from '../vercel-app/lib/i18n';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web chantiers experience', () => {
  it('routes Chantiers through a dedicated portfolio and structure workspace', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const component = read('vercel-app/app/web/chantiers-workspace/ChantiersWorkspace.tsx');

    expect(page).toContain("import ChantiersWorkspace from './chantiers-workspace/ChantiersWorkspace'");
    expect(page).toContain('<ChantiersWorkspace');
    expect(page).toContain("activeTab === 'chantiers'");
    expect(component).toContain('data-testid="web-chantiers-workspace"');
    expect(component).toContain('Portefeuille');
    expect(component).toContain('Structure du chantier');
    expect(component).toContain('Entreprises affectées');
    expect(component).not.toContain('Dupliquer');
    expect(component).not.toContain('Exporter');
  });

  it('keeps search, status filtering, progressive disclosure and destructive separation explicit', () => {
    const component = read('vercel-app/app/web/chantiers-workspace/ChantiersWorkspace.tsx');

    expect(component).toContain('useDeferredValue(projectQuery)');
    expect(component).toContain('useDeferredValue(buildingQuery)');
    expect(component).toContain('role="toolbar" aria-label="Filtrer les chantiers"');
    expect(component).toContain('aria-expanded={isExpanded}');
    expect(component).toContain('BUILDING_BATCH_SIZE = 18');
    expect(component).toContain('Afficher {Math.min(BUILDING_BATCH_SIZE');
    expect(component).toContain('role="menuitem"');
    expect(component).toContain('Supprimer le chantier');
    expect(component).toContain('Abandonner les modifications non enregistrées ?');
  });

  it('keeps the project editor focused through accessible, lazy-rendered sections', () => {
    const component = read('vercel-app/app/web/chantiers-workspace/ChantiersWorkspace.tsx');
    const css = read('vercel-app/app/web/chantiers-workspace/ChantiersWorkspace.module.css');

    expect(component).toContain('role="tablist" aria-label="Sections du chantier"');
    expect(component).toContain('role="tab"');
    expect(component).toContain('aria-selected={selectedSection}');
    expect(component).toContain("modalSection === 'identity'");
    expect(component).toContain("modalSection === 'companies'");
    expect(component).toContain("modalSection === 'structure'");
    expect(component).toContain('useDeferredValue(companyQuery)');
    expect(component).toContain('useDeferredValue(structureQuery)');
    expect(component).toContain('moveModalSection');
    expect(component).toContain("document.body.style.overflow = 'hidden'");
    expect(component).toContain("event.key !== 'Tab'");
    expect(component).toContain('Modifications non enregistrées');
    expect(css).toContain('.modalWorkspace');
    expect(css).toContain('.modalSectionNav');
    expect(css).toContain('.modalContent');
    expect(css).toMatch(/\.modalContent\s*\{[^}]*overflow-y:\s*auto/s);
  });

  it('provides responsive, accessible and reduced-motion safeguards without decorative effects', () => {
    const css = read('vercel-app/app/web/chantiers-workspace/ChantiersWorkspace.module.css');
    const shellCss = read('vercel-app/app/web/web.module.css');

    expect(css).toContain('@media (max-width: 860px)');
    expect(css).toContain('@media (max-width: 620px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('content-visibility: auto');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('.dossierBody {\n    display: block;');
    expect(css).toContain('.buildingList {\n    display: block;');
    expect(css).toContain('.workspace :is(button, input, select, textarea):focus-visible');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
    expect(shellCss).toContain(".workspaceChantiers[data-operational-mobile='true']");
    expect(shellCss).toContain('overflow-y: auto;');
  });

  it('keeps the main Chantiers copy available in English and Spanish', () => {
    expect(translateWebStaticText('Portefeuille', 'en')).toBe('Portfolio');
    expect(translateWebStaticText('Structure du chantier', 'es')).toBe('Estructura de la obra');
    expect(translateWebStaticText('Supprimer le chantier', 'en')).toBe('Delete project');
    expect(translateWebStaticText('Gérer les affectations', 'es')).toBe('Gestionar asignaciones');
    expect(translateWebStaticText('Sections du chantier', 'en')).toBe('Project sections');
    expect(translateWebStaticText('Affectations autorisées', 'es')).toBe('Asignaciones autorizadas');
    expect(translateWebStaticText('Aucune entreprise ne correspond à cette recherche.', 'en')).toBe(
      'No company matches this search.',
    );
    expect(translateWebStaticText('Rechercher dans la structure', 'es')).toBe('Buscar en la estructura');
    expect(translateWebStaticText('Nom du bâtiment 7', 'en')).toBe('Building name 7');
  });
});
