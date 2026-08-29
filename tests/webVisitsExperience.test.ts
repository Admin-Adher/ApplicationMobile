import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web visits experience', () => {
  it('uses an explicit list/detail navigator on compact screens', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const visits = page.slice(page.indexOf('function VisitesView'), page.indexOf('function PlanningView'));

    expect(visits).toContain('const visitWorkspace = useResponsiveWorkspaceNavigation({ hasDetail: Boolean(selectedVisit) })');
    expect(visits).toContain('{visitWorkspace.showList && <section');
    expect(visits).toContain('{visitWorkspace.showDetail && <section');
    expect(visits).toContain('<WorkspaceBackButton label="Retour aux visites"');
    expect(visits).toContain('visitWorkspace.openDetail()');
    expect(visits).toContain('data-testid="web-visits-workspace"');
  });

  it('keeps visit discovery dense, searchable and accessible', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const visits = page.slice(page.indexOf('function VisitesView'), page.indexOf('function PlanningView'));

    expect(visits).toContain('<WorkspaceSearch');
    expect(visits).toContain('className={styles.visitStatusRail} role="toolbar"');
    expect(visits).toContain('aria-pressed={statusFilter === item.key}');
    expect(visits).toContain("aria-current={selected ? 'true' : undefined}");
    expect(visits).not.toContain('className={styles.visitFilterChips}');
    expect(visits).not.toContain('className={styles.visitStatsGrid}');
  });

  it('prioritizes common actions and makes long visit details scannable', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const visits = page.slice(page.indexOf('function VisitesView'), page.indexOf('function PlanningView'));

    expect(visits).toContain('className={styles.visitPrimaryAction}');
    expect(visits).toContain('className={styles.visitDangerMenu}');
    expect(visits).toContain('<dl className={styles.visitInfoGrid}');
    expect(visits).toContain('<nav className={styles.visitSectionNav}');
    expect(visits).toContain('<progress');
    expect(visits).toContain('className={styles.visitParticipantAvatar}');
  });

  it('preserves touch targets, compact information density and reduced motion', () => {
    const css = read('vercel-app/app/web/web.module.css');
    const visitsCss = css.slice(css.indexOf('.visitesWorkspace'), css.indexOf('.visitAttachModal'));

    expect(visitsCss).toMatch(/\.visitStatusRail button \{[\s\S]*?min-height: 50px;/);
    expect(visitsCss).toMatch(/\.visitPrimaryAction \{[\s\S]*?min-height: 44px;/);
    expect(visitsCss).toMatch(/\.visitInfoGrid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.visitInfoGrid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.visitSectionNav \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(visitsCss).toMatch(/\.visitPrimaryAction span \{[\s\S]*?color: inherit;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.visitStatusRail button/);
    expect(css).toContain('.visitesWorkspace :is(button, select, summary, a):focus-visible');
  });
});
