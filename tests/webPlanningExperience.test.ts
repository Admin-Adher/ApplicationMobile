import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateWebStaticText } from '../vercel-app/lib/i18n';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web planning experience', () => {
  it('routes Planning through a dedicated operational workspace', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const component = read('vercel-app/app/web/planning-workspace/PlanningWorkspace.tsx');

    expect(page).toContain("import PlanningWorkspace from './planning-workspace/PlanningWorkspace'");
    expect(page).toContain('<PlanningWorkspace');
    expect(component).toContain('className={styles.summaryStrip}');
    expect(component).toContain('Planification chantier');
    expect(component).toContain('Tâches d’équipe');
    expect(component).toContain('Agenda des échéances');
  });

  it('separates task modes from agenda filters and bounds the first schedule render', () => {
    const component = read('vercel-app/app/web/planning-workspace/PlanningWorkspace.tsx');
    const model = read('vercel-app/app/web/planning-workspace/planning-model.ts');

    expect(component).toContain('role="toolbar" aria-label="Afficher les tâches"');
    expect(component).toContain('role="toolbar" aria-label="Filtrer l’agenda"');
    expect(component).toContain('useDeferredValue(scheduleQuery)');
    expect(component).toContain('placeholder="Rechercher une échéance"');
    expect(component).toContain('filteredSchedule.slice(0, visibleScheduleCount)');
    expect(component).toContain('count + PLANNING_SCHEDULE_BATCH_SIZE');
    expect(component).toContain('aria-live="polite"');
    expect(model).toContain('PLANNING_SCHEDULE_BATCH_SIZE = 18');
    expect(model).toContain('groupPlanningSchedule');
  });

  it('keeps controls accessible and the mobile layout structurally responsive', () => {
    const component = read('vercel-app/app/web/planning-workspace/PlanningWorkspace.tsx');
    const css = read('vercel-app/app/web/planning-workspace/PlanningWorkspace.module.css');

    expect(component).toContain('aria-pressed={taskMode === option.id}');
    expect(component).toContain('aria-pressed={scheduleFilter === option.id}');
    expect(component).toContain('aria-expanded={showForm}');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('@media (max-width: 860px)');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/\.planningColumns,\s*\.planningColumns\[data-tasks-empty='true'\]\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(css).toContain('.planningRoot :is(button, input, select):focus-visible');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  });

  it('keeps the main Planning copy available in English and Spanish', () => {
    expect(translateWebStaticText('Repères du planning', 'en')).toBe('Planning overview');
    expect(translateWebStaticText('Agenda des échéances', 'es')).toBe('Agenda de vencimientos');
    expect(translateWebStaticText('Cette semaine', 'en')).toBe('This week');
    expect(translateWebStaticText('Rechercher une échéance', 'es')).toBe('Buscar vencimientos');
    expect(translateWebStaticText('18 échéances de plus', 'en')).toBe('18 échéances de plus');
    expect(translateWebStaticText('Afficher 18 échéances de plus', 'en')).toBe('Show 18 more due dates');
    expect(translateWebStaticText('2 tâches affichées', 'es')).toBe('2 tareas mostradas');
    expect(translateWebStaticText('Progression 75%', 'en')).toBe('Progress 75%');
  });
});
