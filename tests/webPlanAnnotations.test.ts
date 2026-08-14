import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web plan annotations', () => {
  it('uses the shared model for strict page scope, history and all eight tools', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const reader = page.slice(page.indexOf('function WebPdfPlan'), page.indexOf('function PlansView'));

    expect(page).toContain("from '../../../lib/plan-annotations/model'");
    expect(reader).toContain('filterPlanDrawingsByPage(annotationSession.drawings, WEB_PLAN_DRAWING_PAGE)');
    expect(reader).toContain('pageAnnotations.map((drawing, index) => renderWebPlanDrawing(');
    expect(reader).not.toContain('annotationSession.drawings.map((drawing');
    expect(reader).toContain('PLAN_DRAWING_TOOLS.map(tool => (');
    expect(reader).toContain('undoPlanDrawing(annotationSessionRef.current)');
    expect(reader).toContain('redoPlanDrawing(annotationSessionRef.current)');
    expect(reader).toContain('deletePlanDrawingsForPage(annotationSessionRef.current, WEB_PLAN_DRAWING_PAGE)');
    expect(page).toContain('webPlanCloudPath(first.x, first.y, last.x, last.y)');
  });

  it('cancels interrupted strokes and batches live pen rendering through animation frames', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const reader = page.slice(page.indexOf('function WebPdfPlan'), page.indexOf('function PlansView'));
    const moveHandler = reader.slice(
      reader.indexOf('function handleDrawPointerMove'),
      reader.indexOf('function handleDrawPointerUp'),
    );

    expect(reader).toContain('onPointerCancel={cancelLiveDrawing}');
    expect(reader).toContain('liveDrawingFrameRef.current = window.requestAnimationFrame');
    expect(moveHandler).toContain('current.points.push(point)');
    expect(moveHandler).toContain('renderLiveDrawingSoon()');
    expect(moveHandler).not.toContain('setLiveDrawing(current =>');
  });

  it('keeps persistence out of React state updaters and offers recoverable destructive actions', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const reader = page.slice(page.indexOf('function WebPdfPlan'), page.indexOf('function PlansView'));
    const applySession = reader.slice(
      reader.indexOf('function applyAnnotationSession'),
      reader.indexOf('function renderLiveDrawingSoon'),
    );

    expect(applySession).toContain('setAnnotationSession(next)');
    expect(applySession).toContain('onAnnotationsChange?.(persisted)');
    expect(applySession).not.toMatch(/setAnnotationSession\([^)]*=>/);
    expect(reader).toContain("window.confirm(t('plans.drawingConfirmClearPage'))");
    expect(reader).toContain("window.confirm(t('plans.drawingConfirmClearAll'))");
    expect(reader).toContain('disabled={!selectedPageAnnotation}');
    expect(reader).toContain('aria-pressed={drawColor === color.value}');
    expect(reader).toContain('aria-pressed={drawTool === tool}');
  });

  it('keeps the newest local document authoritative until the server acknowledges it', () => {
    const page = read('vercel-app/app/web/page.tsx');

    expect(page).toContain("from '../../../lib/plan-annotations/pending-snapshots'");
    expect(page).toContain('pendingWebPlanAnnotationsRef.current.set(planId, pendingSnapshot)');
    expect(page).toContain('applyPendingPlanAnnotationSnapshots(sitePlans, user.id)');
    expect(page).toContain('createPendingPlanAnnotationSnapshot(ownerId, latestAnnotations, false)');
    expect(page).toContain('current?.signature === getCanonicalPlanAnnotationSignature(failedAnnotations)');
  });

  it('floats the contextual palette without consuming plan height', () => {
    const css = read('vercel-app/app/web/web.module.css');

    expect(css).toMatch(/\.webPdfShell \{[\s\S]*?position: relative;[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.webPdfAnnotateControls \{[\s\S]*?position: absolute;[\s\S]*?z-index: 50;/);
    expect(css).toContain('.webPdfDrawingSelectionBox');
  });

  it('translates the annotation controls in every supported web language', () => {
    const i18n = read('vercel-app/lib/i18n.ts');
    for (const key of [
      'plans.drawingTools',
      'plans.drawingTool.highlight',
      'plans.drawingRedo',
      'plans.drawingDeleteObject',
      'plans.drawingConfirmClearAll',
    ]) {
      expect(i18n.match(new RegExp(`'${key.replace('.', '\\.')}'`, 'g'))).toHaveLength(3);
    }
  });
});
