'use client';

import { useEffect, useState } from 'react';

export function useWebAlertReads(scope: string | null) {
  const key = scope ? `buildtrack-web-alert-reads:${scope}` : null;
  const [state, setState] = useState<{ key: string; ids: string[] } | null>(null);
  useEffect(() => {
    if (!key) return;
    function refresh(event?: StorageEvent) {
      if (!key || (event?.key && event.key !== key)) return;
      let ids: string[] = [];
      try {
        const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
        if (Array.isArray(value)) ids = value.filter(id => typeof id === 'string');
      } catch {}
      setState({ key, ids });
    }
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [key]);

  const seen = state?.key === key ? state.ids : [];
  function markRead(ids: string[]) {
    if (!key) return;
    const next = [...new Set([...seen, ...ids])];
    setState({ key, ids: next });
    try { window.localStorage.setItem(key, JSON.stringify(next)); } catch {}
  }
  return { seen, markRead };
}
