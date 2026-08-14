'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export const COMPACT_WORKSPACE_QUERY = '(max-width: 1180px)';

type ResponsiveWorkspaceOptions = {
  hasDetail: boolean;
  initialDetailOpen?: boolean;
  forceDetailOpen?: boolean;
  detailOpen?: boolean;
  onDetailOpenChange?: (open: boolean) => void;
};

export function shouldRenderWorkspaceDetail(isCompact: boolean, detailOpen: boolean) {
  return !isCompact || detailOpen;
}

export function useMediaQuery(query: string, serverFallback = true) {
  const subscribe = useCallback((notify: () => void) => {
    const mediaQuery = window.matchMedia(query);
    mediaQuery.addEventListener('change', notify);
    return () => mediaQuery.removeEventListener('change', notify);
  }, [query]);

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = useCallback(() => serverFallback, [serverFallback]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useResponsiveWorkspaceNavigation({
  hasDetail,
  initialDetailOpen = false,
  forceDetailOpen = false,
  detailOpen: controlledDetailOpen,
  onDetailOpenChange,
}: ResponsiveWorkspaceOptions) {
  // The server snapshot intentionally starts compact. This keeps detail media out
  // of the initial HTML and hydration pass until the real viewport is known.
  const isCompact = useMediaQuery(COMPACT_WORKSPACE_QUERY, true);
  const [uncontrolledDetailOpen, setUncontrolledDetailOpen] = useState(initialDetailOpen);
  const detailOpen = controlledDetailOpen ?? uncontrolledDetailOpen;
  const setDetailOpen = useCallback((open: boolean) => {
    if (controlledDetailOpen === undefined) setUncontrolledDetailOpen(open);
    onDetailOpenChange?.(open);
  }, [controlledDetailOpen, onDetailOpenChange]);

  useEffect(() => {
    if (!isCompact) setDetailOpen(false);
  }, [isCompact, setDetailOpen]);

  useEffect(() => {
    if (detailOpen && !hasDetail) setDetailOpen(false);
  }, [detailOpen, hasDetail, setDetailOpen]);

  useEffect(() => {
    if (isCompact && forceDetailOpen && hasDetail) setDetailOpen(true);
  }, [forceDetailOpen, hasDetail, isCompact, setDetailOpen]);

  const openDetail = useCallback(() => setDetailOpen(true), [setDetailOpen]);

  const closeDetail = useCallback(() => setDetailOpen(false), [setDetailOpen]);
  const showDetail = shouldRenderWorkspaceDetail(isCompact, detailOpen);

  return {
    isCompact,
    detailOpen,
    showList: !isCompact || !detailOpen,
    showDetail,
    shouldLoadDetailMedia: showDetail && hasDetail,
    openDetail,
    closeDetail,
  };
}
