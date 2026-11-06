import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canSignOprDirectly, summarizeOpr } from '../vercel-app/app/web/opr-workspace/opr-workspace-model';
import { buildWebOprPrint } from '../vercel-app/app/web/opr-workspace/opr-print';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web OPR experience', () => {
  it('keeps signing on site separate and prints both signature formats', () => {
    expect(canSignOprDirectly({ id: 'OPR-1', status: 'draft' })).toBe(true);
    expect(canSignOprDirectly({ id: 'OPR-1', status: 'signed' })).toBe(false);
    expect(canSignOprDirectly({ id: 'OPR-1', status: 'draft', signatories: [{ id: 'remote' }] })).toBe(false);
    const png = 'data:image/png;base64,YWJj';
    const opr = summarizeOpr({ id: 'OPR-1', conducteur_signature: png, mo_signature: '<svg></svg>' });
    const html = buildWebOprPrint(opr, 'Recette', [], 'pv');
    expect(html).toContain('src="' + png + '"');
    expect(html).toContain('data:image/svg+xml,');
  });
  it('replaces generic KPI cards with a compact operational register', () => {
    const component = read('vercel-app/app/web/opr-workspace/OprWorkspace.tsx');

    expect(component).toContain('data-testid="web-opr-workspace"');
    expect(component).toContain('className={styles.overviewMetrics}');
    expect(component).toContain('className={styles.continuation}');
    expect(component).toContain('className={styles.oprList}');
    expect(component).not.toContain('<Kpi');
  });

  it('makes filtering, disclosure and reserve navigation accessible', () => {
    const component = read('vercel-app/app/web/opr-workspace/OprWorkspace.tsx');

    expect(component).toContain('role="toolbar" aria-label="Filtrer les procès-verbaux"');
    expect(component).toContain('aria-pressed={filter === item.key}');
    expect(component).toContain('aria-expanded={open}');
    expect(component).toContain('<progress');
    expect(component).toContain('Voir la réserve');
    expect(component).toContain('role="status" aria-live="polite"');
  });

  it('keeps the OPR workspace responsive and motion-safe', () => {
    const css = read('vercel-app/app/web/opr-workspace/OprWorkspace.module.css');

    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('@media (max-width: 480px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/\.filters button \{[\s\S]*?min-height: 44px;/);
    expect(css).toContain('.workspace :is(button, a):focus-visible');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  });
});
