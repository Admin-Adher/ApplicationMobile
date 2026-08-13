'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  peekPrivateMediaAccess,
  requestPrivateMedia,
  subscribePrivateMedia,
  type PrivateMediaAccess,
  type PrivateMediaPriority,
} from '@/lib/private-media-client';

type PrivateMediaOptions = {
  enabled?: boolean;
  priority?: PrivateMediaPriority;
};

type VisiblePrivateMediaOptions = PrivateMediaOptions & {
  immediate?: boolean;
  rootMargin?: string;
};

export function usePrivateMediaAccess(
  source: unknown,
  { enabled = true, priority = 'background' }: PrivateMediaOptions = {},
) {
  const ref = String(source ?? '').trim();
  const [snapshot, setSnapshot] = useState<{ ref: string; access: PrivateMediaAccess }>(() => ({
    ref,
    access: peekPrivateMediaAccess(ref),
  }));
  const access = snapshot.ref === ref ? snapshot.access : peekPrivateMediaAccess(ref);

  useEffect(() => {
    const refresh = () => setSnapshot({ ref, access: peekPrivateMediaAccess(ref) });
    refresh();
    return subscribePrivateMedia(refresh);
  }, [ref]);

  useEffect(() => {
    if (!enabled) return;
    setSnapshot({ ref, access: requestPrivateMedia(ref, { priority }) });
  }, [enabled, priority, ref]);

  return access;
}

export function useVisiblePrivateMedia(
  source: unknown,
  {
    enabled = true,
    immediate = false,
    priority = 'background',
    rootMargin = '280px',
  }: VisiblePrivateMediaOptions = {},
) {
  const ref = String(source ?? '').trim();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(immediate);

  useEffect(() => {
    setVisible(immediate);
  }, [immediate, ref]);

  useEffect(() => {
    if (!enabled || immediate || !target || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin });
    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled, immediate, rootMargin, target, visible]);

  const access = usePrivateMediaAccess(ref, {
    enabled: enabled && (immediate || visible),
    priority,
  });
  const observe = useCallback((node: HTMLElement | null) => setTarget(node), []);
  const requestNow = useCallback(() => {
    setVisible(true);
    return requestPrivateMedia(ref, { priority });
  }, [priority, ref]);

  return { access, observe, requestNow, visible: immediate || visible };
}
