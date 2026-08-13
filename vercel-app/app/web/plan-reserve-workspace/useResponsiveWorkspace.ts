'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export const COMPACT_WORKSPACE_QUERY = '(max-width: 1180px)';

type ResponsiveWorkspaceOptions = {
  hasDetail: boolean;
  initialDetailOpen?: boolean;
  forceDetailOpen?: boolean;
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
}: ResponsiveWorkspaceOptions) {
  // The server snapshot intentionally starts compact. This keeps detail media out
  // of the initial HTML and hydration pass until the real viewport is known.
  const isCompact = useMediaQuery(COMPACT_WORKSPACE_QUERY, true);
  const [detailOpen, setDetailOpen] = useState(initialDetailOpen);

  useEffect(() => {
    if (!isCompact) setDetailOpen(false);
  }, [isCompact]);

  useEffect(() => {
    if (detailOpen && !hasDetail) setDetailOpen(false);
  }, [detailOpen, hasDetail]);

  useEffect(() => {
    if (isCompact && forceDetailOpen && hasDetail) setDetailOpen(true);
  }, [forceDetailOpen, hasDetail, isCompact]);

  const openDetail = useCallback(() => setDetailOpen(true), []);

  const closeDetail = useCallback(() => setDetailOpen(false), []);
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
