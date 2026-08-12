import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web plan and reserve workspaces', () => {
  it('uses one restrained feature chrome for both operational pages', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const chrome = read('vercel-app/app/web/plan-reserve-workspace/WorkspaceChrome.tsx');
    const css = read('vercel-app/app/web/plan-reserve-workspace/PlanReserveWorkspace.module.css');

    expect(page).toContain('data-testid="web-reserves-workspace"');
    expect(page).toContain('data-testid="web-plans-workspace"');
    expect(page.match(/<WorkspacePageHeader/g)).toHaveLength(2);
    expect(page.match(/<WorkspaceSearch/g)).toHaveLength(2);
    expect(chrome).toContain('WorkspaceIcon');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
    expect(page).not.toMatch(/data-testid="web-(?:plans|reserves)-workspace"[^>]*data-bt-i18n-skip/);
  });

  it('switches between library and document on compact screens', () => {
    const page = read('vercel-app/app/web/page.tsx');

    expect(page).toContain("useMediaQuery('(max-width: 1180px)')");
    expect(page).toContain('const [mobilePlanOpen, setMobilePlanOpen] = useState(false)');
    expect(page).toContain('{(!isCompactPlanView || !mobilePlanOpen) && (');
    expect(page).toContain('{(!isCompactPlanView || mobilePlanOpen) && (');
    expect(page).toContain('<WorkspaceBackButton label={workspaceCopy.back}');
    expect(page).toContain('openPlanFromNavigator(String(plan.id))');
  });

  it('wraps real-world identifiers and reserve titles without shrinking the plan to zero', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const css = read('vercel-app/app/web/plan-reserve-workspace/PlanReserveWorkspace.module.css');

    expect(page).toContain('data-prw-plan-reserve-row');
    expect(page).toContain('data-reserves-open={planReservePanelOpen}');
    expect(css).toContain("[data-reserves-open='true']");
    expect(css).toContain("[data-reserves-open='false']");
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) minmax(14rem, 34%)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 3.5rem');
    expect(css).toContain(".planRoot [data-prw-plan-reserve-row] strong");
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain(".reserveRoot [data-prw-reserve-row] > div:nth-child(2) > strong");
    expect(css).toContain('-webkit-line-clamp: 2');
  });

  it('keeps every private plan preview on the fail-closed media path', () => {
    const page = read('vercel-app/app/web/page.tsx');

    expect(page).toContain('const selectedPlanMedia = privateMediaAccess(selectedPlanMediaSource)');
    expect(page).toContain('const selectedPlanResolvedUri = selectedPlanMedia.url');
    expect(page).toContain('uri={selectedPlanResolvedUri}');
    expect(page).not.toContain('uri={selectedPlan.uri}');
    expect(page).not.toContain('href={selectedPlan.uri}');
  });
});
