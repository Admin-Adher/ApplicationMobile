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
    expect(page.match(/<WorkspaceSearch/g)).toHaveLength(3);
    expect(chrome).toContain('WorkspaceIcon');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
    expect(page).not.toMatch(/data-testid="web-(?:plans|reserves)-workspace"[^>]*data-bt-i18n-skip/);
  });

  it('switches between library and document on compact screens', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const responsiveWorkspace = read('vercel-app/app/web/plan-reserve-workspace/useResponsiveWorkspace.ts');

    expect(page).toContain('useResponsiveWorkspaceNavigation({');
    expect(page).toContain('{planWorkspace.showList && (');
    expect(page).toContain('{planWorkspace.showDetail && (');
    expect(page).toContain('label={workspaceCopy.back}');
    expect(page).toContain('openPlanFromNavigator(String(plan.id))');
    expect(responsiveWorkspace).toContain("const getServerSnapshot = useCallback(() => serverFallback");
    expect(responsiveWorkspace).toContain('shouldLoadDetailMedia: showDetail && hasDetail');
  });

  it('keeps mobile plan interaction explicit and touch accessible', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const css = read('vercel-app/app/web/web.module.css');

    expect(page).toContain('createModeActive={pinCreateMode}');
    expect(page).toContain('openPinOnSingleTap={isCompactPlanView}');
    expect(page).toContain("if (pinCreateMode) assignOrCreatePinAt(px, py)");
    expect(page).toContain("aria-pressed={pinCreateMode}");
    expect(css).toMatch(/\.pin \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
    expect(css).toContain('.pin::before');
  });

  it('keeps the compact PDF reader intrinsic, single-line, and responsive to viewport width', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const css = read('vercel-app/app/web/web.module.css');
    const workspaceCss = read('vercel-app/app/web/plan-reserve-workspace/PlanReserveWorkspace.module.css');
    const interaction = read('vercel-app/app/web/plan-reserve-workspace/plan-interaction.ts');
    const reader = page.slice(page.indexOf('function WebPdfPlan'), page.indexOf('function PlansView'));

    expect(reader).toContain('fitModeRef.current = \'manual\'');
    expect(reader).toContain('new ResizeObserver');
    expect(reader).toContain('shouldRefitPdfOnResize(fitModeRef.current');
    expect(reader).toContain('observer.disconnect()');
    expect(reader).toContain('window.cancelAnimationFrame(resizeFrameRef.current)');
    expect(reader).toContain('data-web-pdf-primary-actions');
    expect(reader).toContain('aria-expanded={actionMenuOpen}');
    expect(reader).toContain("fullscreenButtonRef.current?.focus({ preventScroll: true })");
    expect(reader).toMatch(/\{uri \? \(\s*<a[^>]*href=\{uri\}/);
    expect(reader).not.toContain('href={selectedPlan.uri}');
    expect(interaction).toContain("export type PdfZoomMode = 'fit' | 'manual'");
    expect(css).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.plansPreviewPanel \.planCanvas \{[\s\S]*?height: auto;/);
    expect(workspaceCss).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\[data-prw-plan-workarea\] \{[\s\S]*?flex: 0 0 auto;[\s\S]*?grid-template-rows: auto auto;/);
    expect(workspaceCss).toMatch(/@media \(max-width: 760px\)[\s\S]*?\[data-prw-plan-workarea\] \{[\s\S]*?flex: 0 0 auto;[\s\S]*?grid-template-rows: auto auto;/);
    expect(css).toMatch(/\.webPdfToolbarPrimary \{[\s\S]*?overflow-x: auto;/);
    expect(css).toMatch(/\.webPdfAnnotateControls \{[\s\S]*?position: absolute;/);
    expect(css).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.webPdfAnnotateControls \{[\s\S]*?overflow: auto;/);
    expect(css).toMatch(/\.webPdfViewport \{[\s\S]*?overflow: auto;/);
  });

  it('uses one vertical scroll owner and batches long reserve lists across compact layouts', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const css = read('vercel-app/app/web/web.module.css');
    const reserveNavigator = read('vercel-app/app/web/plan-reserve-workspace/reserve-navigator.ts');

    expect(reserveNavigator).toContain('WEB_RESERVE_MOBILE_BATCH_SIZE = 12');
    expect(page).toContain('buildReserveNavigatorModel(reserves, effectiveReserveNavigatorState, props.selectedReserveId)');
    expect(page).toContain('const syncedReserveNavigatorState = syncReserveNavigatorScope(');
    expect(page).toContain('visibleReserveRows.map');
    expect(page).toContain('className={styles.reserveLoadMore}');
    expect(page).toContain('setReserveNavigatorState(showNextReserveBatch)');
    expect(page).toContain('data-prw-reserve-sticky');
    expect(css).toContain(".workspaceReserves[data-operational-mobile='true']");
    expect(css).toMatch(/\.reservesListPanel \.reserveRailStickyWeb \{[\s\S]*?position: sticky;/);
    expect(css).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.reservesListPanel \.reserveList \{[\s\S]*?overflow: visible;/);
    expect(css).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.plansListPanel \.plansList \{[\s\S]*?overflow: visible;/);
  });

  it('separates reserve selection from explicit mobile detail navigation', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const responsiveWorkspace = read('vercel-app/app/web/plan-reserve-workspace/useResponsiveWorkspace.ts');
    const workspaceChromeCss = read('vercel-app/app/web/plan-reserve-workspace/WorkspaceChrome.module.css');
    const workspaceCss = read('vercel-app/app/web/plan-reserve-workspace/PlanReserveWorkspace.module.css');

    expect(page).toContain('const [reserveDetailRequest, setReserveDetailRequest]');
    expect(page).toContain('const openReserveDetailTab = useCallback');
    expect(page).toContain("detailOpen: effectiveReserveNavigatorState.view === 'detail'");
    expect(page).toContain('handleReserveHistoryOutsideCompactView');
    expect(page).toContain("previousActiveTab === 'reserves'");
    expect(page).toContain('const targetProjectId = String(getChantierId(target) || selectedProjectId)');
    expect(page).toContain('openReserveDetailTab(id, finalReserve)');
    expect(page.match(/setSelectedReserveId\(current => current === reserve\.id \? null : current\)/g)).toHaveLength(3);
    expect(page).toContain('if (props.onOpenReserveDetail(reserveId)) return');
    expect(page).toContain("reserveId !== String(explicitlySelectedReserve.id)");
    expect(page).toContain('pushReserveDetailHistory');
    expect(page).toContain("window.addEventListener('popstate', onPopState)");
    expect(page).toContain('reserveListScrollTopRef.current');
    expect(page).toContain('reserveDetailHeadingRef.current?.focus');
    expect(page).toContain("document.querySelector('[data-prw-reserve-sticky] input')");
    expect(page).toContain("aria-current={isSelected ? 'true' : undefined}");
    expect(page).not.toContain('function clearReserveDetailHistory');
    expect(page).toContain('const ownsCurrentHistoryEntry');
    expect(page).toContain('if (ownsCurrentHistoryEntry) window.history.back()');
    expect(page).toMatch(/reserveHistoryEntryRef\.current = false;[\s\S]*?window\.history\.back\(\);/);
    expect(responsiveWorkspace).toContain('detailOpen: controlledDetailOpen');
    expect(responsiveWorkspace).toContain('onDetailOpenChange');
    expect(workspaceChromeCss).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.header\[data-compact-detail='true'\] \{[\s\S]*?display: none;/);
    expect(workspaceCss).toMatch(/@media \(max-width: 1180px\) and \(max-height: 520px\)[\s\S]*?div:last-child \{[\s\S]*?overflow-x: auto;/);
    expect(workspaceCss).not.toContain("div:last-child > :not([data-primary='true'])");
  });

  it('announces reserve filters and honest mobile result counts', () => {
    const page = read('vercel-app/app/web/page.tsx');

    expect(page).toContain('aria-pressed={active}');
    expect(page).toContain('aria-expanded={showAdvancedFilters}');
    expect(page).toContain('aria-controls="reserve-advanced-filters"');
    expect(page).toContain('role="status" aria-live="polite"');
    expect(page).toContain('{visibleReserveRows.length} affichée');
    expect(page).toContain('Priorité {PRIORITY_LABELS[reserve.priority]');
  });

  it('batches the mobile building library with an accessible single accordion', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const css = read('vercel-app/app/web/web.module.css');
    const workspaceChromeCss = read('vercel-app/app/web/plan-reserve-workspace/WorkspaceChrome.module.css');
    const navigator = read('vercel-app/app/web/plan-reserve-workspace/building-navigator.ts');

    expect(navigator).toContain('WEB_PLAN_MOBILE_BUILDING_BATCH_SIZE = 12');
    expect(page).toContain('visibleBuildingGroups.map');
    expect(page).toContain('data-prw-building-load-more');
    expect(page).toContain('toggleCompactBuildingKey(compactExpandedBuildingKey, group.key)');
    expect(page).toContain('aria-expanded={isExpanded}');
    expect(page).toContain('aria-controls={plansRegionId}');
    expect(page).toContain(': hasBuildingSearch || isSelectedGroup || expandedBuildingKeys.has(group.key)');
    expect(page).toMatch(/setSelectedBuildingKey\('all'\);\s*setBuildingQuery\(''\);\s*setActiveFamilyKey\('all'\);[\s\S]*?\}, \[selectedProjectId\]\);/);
    expect(css).toContain(".workspacePlans[data-operational-mobile='true']");
    expect(css).toMatch(/\.plansListPanel \.buildingFamilyRowWeb button,[\s\S]*?min-height: 44px;/);
    expect(css).toMatch(/\.plansListPanel \.buildingRecentBlockWeb \{[\s\S]*?overflow-x: auto;/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.plansListPanel \.buildingFamilyMoreWeb \{[\s\S]*?position: static;/);
    expect(css).toMatch(/\.plansListPanel \.buildingFamilyPopoverWeb \{[\s\S]*?right: 0;[\s\S]*?width: auto;/);
    expect(workspaceChromeCss).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.search input \{[\s\S]*?font-size: 1rem;/);
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

  it('keeps the compact plan reserve navigator bounded, ordered and bidirectional', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const css = read('vercel-app/app/web/web.module.css');
    const i18n = read('vercel-app/lib/i18n.ts');

    expect(page).toContain('buildPlanReserveNavigatorModel(displayPlanReserves');
    expect(page).toContain('planReserveNavigator.visibleRows.map');
    expect(page).not.toContain('displayPlanReserves.map((reserve: any)');
    expect(page).toContain('data-prw-plan-reserve-load-more');
    expect(page).toContain('onClick={() => selectPlanReserve(reserve.id)}');
    expect(page).toContain("aria-current={selected ? 'true' : undefined}");
    expect(page).toContain('onPinClick={selectPlanReserve}');
    expect(page).toContain('isCompactPlanView && selected && renderPlanReserveQuickCard(reserve)');
    expect(page).toContain('aria-controls={planReservePanelId}');
    expect(css).toMatch(/\.planReserveHeaderActions button \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
    expect(css).toContain('.planReserveLoadMore');
    expect(i18n).toContain("'plans.visibleReserveCount': '{visible} affichées sur {total}'");
  });

  it('keeps every private plan preview on the fail-closed media path', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const mediaHook = read('vercel-app/app/web/plan-reserve-workspace/usePrivateMedia.ts');

    expect(page).toContain('const selectedPlanMediaSource = planWorkspace.shouldLoadDetailMedia');
    expect(page).toContain("usePrivateMediaAccess(selectedPlanMediaSource, { priority: 'critical' })");
    expect(page).toContain('const selectedPlanResolvedUri = selectedPlanMedia.url');
    expect(page).toContain('uri={selectedPlanResolvedUri}');
    expect(mediaHook).toContain("requestPrivateMedia(ref, { priority })");
    expect(page).not.toContain('uri={selectedPlan.uri}');
    expect(page).not.toContain('href={selectedPlan.uri}');
    expect(page).toContain("const sitePlansPromise = publishWhenCurrent(");
    expect(page).toContain('const selectedPlan = projectScoped.plans.find');
  });

  it('keeps reserve normalization network-free and resolves photos only near the viewport', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const mediaHook = read('vercel-app/app/web/plan-reserve-workspace/usePrivateMedia.ts');
    const reservePhotoItems = page.slice(
      page.indexOf('function reservePhotoItems'),
      page.indexOf('function localOnlyPhotoCount'),
    );
    const assetNormalizers = page.slice(
      page.indexOf('function storageAssetRef'),
      page.indexOf('function createPhotoAnnotationId'),
    );

    expect(page).toContain('function storageAssetRef');
    expect(assetNormalizers).not.toMatch(/privateMedia(?:Access|Url)|requestPrivateMedia|fetch\(/);
    expect(reservePhotoItems).toContain("assetUrl(photo, 'photos')");
    expect(reservePhotoItems).not.toMatch(/privateMedia(?:Access|Url)|requestPrivateMedia|fetch\(/);
    expect(page).toContain('<PrivatePhotoFrame photo={photo} compact fit="cover" immediate={index < 2} />');
    expect(mediaHook).toContain('new IntersectionObserver');
    expect(mediaHook).toContain("rootMargin = '280px'");
    expect(page).toContain("priority: 'critical',");
    expect(page).toContain('navigator.clipboard.writeText(lightboxPhotoMedia.url)');
  });

  it('opens direct reserve links before secondary modules and serves resized private photos', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const nextConfig = read('vercel-app/next.config.ts');
    const css = read('vercel-app/app/web/web.module.css');
    const privateFrame = page.slice(
      page.indexOf('function PrivatePhotoFrame'),
      page.indexOf('function PrivateMediaLink'),
    );

    expect(page).toContain("import NextImage from 'next/image'");
    expect(privateFrame).toContain('<NextImage');
    expect(privateFrame).toContain('fill');
    expect(privateFrame).toContain("quality={compact ? 70 : 82}");
    expect(privateFrame).toContain("sizes={compact ? '(max-width: 760px) 46vw, 176px'");
    expect(privateFrame).toContain('imageNaturalSize={naturalSize}');
    expect(privateFrame).not.toMatch(/<img\b/);
    expect(page).toContain('const photosByReserve = buildReservePhotoIndex(photos)');
    expect(page).toContain('Promise.all([chantiersPromise, reservesPromise, companiesPromise])');
    expect(page).toContain('const requestedReserveId = reserveIdFromHref(window.location.href)');
    expect(page).toContain('if (!authUser || !profile) return;');
    expect(page).toContain('openReserveDetailTab(requestedReserveId, target)');
    expect(page).toContain("(supabaseBrowser as any).rpc('soft_delete_photo'");
    expect(nextConfig).toContain("formats: ['image/avif', 'image/webp']");
    expect(nextConfig).toContain('minimumCacheTTL: 60');
    expect(nextConfig).toContain("pathname: '/buildtrack-files/**'");
    expect(css).toContain(".photoAnnotationFrame[data-image-ready='false']");
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('shows an account-scoped cached first page before signed media is ready', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const cache = read('vercel-app/app/web/plan-reserve-workspace/plan-preview-cache.ts');

    expect(page).toContain('readPlanPreview({ userId: authUserId, planKey: selectedPlanPreviewKey })');
    expect(page).toContain("cachedPlanPreview.ownerId === authUserId");
    expect(page).toContain('selectedPlan.file_type === \'pdf\' && (selectedPlanResolvedUri || activeCachedPlanPreview)');
    expect(page).toContain('data-plan-preview-source="cache"');
    expect(page).toContain('rasterizePlanPreview(canvas)');
    expect(cache).toContain("const PLAN_PREVIEW_CACHE = 'buildtrack-private-plan-previews-v1'");
    expect(cache).toContain("sha256(`preview\\0${userId}\\0${planKey}`)");
    expect(cache).not.toContain('signedUrl');
  });

  it('bundles a dedicated PDF worker locally instead of sharing or requiring a CDN worker', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const pdfClient = read('vercel-app/app/web/plan-reserve-workspace/pdfjs-client.ts');

    expect(page.match(/loadPdfJs\(\)/g)).toHaveLength(2);
    expect(page).toContain('warmPdfJsWhenIdle()');
    expect(pdfClient).toContain("import('pdfjs-dist')");
    expect(pdfClient).not.toContain("import('pdfjs-dist/webpack.mjs')");
    expect(pdfClient).toContain("'pdfjs-dist/build/pdf.worker.min.mjs'");
    expect(pdfClient).toContain('GlobalWorkerOptions.workerPort = null');
    expect(pdfClient).toContain('createDedicatedPdfLoadingTask');
    expect(pdfClient).toContain('connection?.saveData');
    expect(page).toContain('}, [retryVersion, uri]);');
    expect(page).toContain('}, [isFullscreen, onPreviewReady, pdfPageVersion, previewCacheKey, scale]);');
    expect(page).not.toContain('cdn.jsdelivr.net/npm/pdfjs-dist');
  });
});
