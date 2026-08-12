'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase-browser';
import {
  authenticatedWorkspaceState,
  type AuthenticatedWorkspaceState,
} from '@/lib/authenticated-workspace-state';

type UseAuthenticatedWorkspaceSessionOptions = {
  onAuthenticatedUserChange: (userId: string | null) => void;
};

/**
 * Owns the only arbitration point between Supabase's initial session lookup
 * and subsequent auth events. The page never has to infer "anonymous" from a
 * temporary null session, so the login form cannot flash during restoration.
 */
export function useAuthenticatedWorkspaceSession({
  onAuthenticatedUserChange,
}: UseAuthenticatedWorkspaceSessionOptions) {
  const [state, setState] = useState<AuthenticatedWorkspaceState>({ status: 'checking' });
  const hadSessionRef = useRef(false);
  const intendedSignOutRef = useRef(false);
  const scopeChangeRef = useRef(onAuthenticatedUserChange);

  useEffect(() => {
    scopeChangeRef.current = onAuthenticatedUserChange;
  }, [onAuthenticatedUserChange]);

  useEffect(() => {
    let alive = true;
    let authEventObserved = false;

    const applySession = (session: Session | null, event?: string) => {
      if (!alive) return;
      const intendedSignOut = intendedSignOutRef.current;
      scopeChangeRef.current(session?.user?.id ?? null);
      const nextState = authenticatedWorkspaceState(session, {
        event,
        hadSession: hadSessionRef.current,
        intendedSignOut,
      });
      if (session) hadSessionRef.current = true;
      if (event === 'SIGNED_OUT') intendedSignOutRef.current = false;
      setState(nextState);
    };

    void supabaseBrowser.auth.getSession().then(({ data }) => {
      if (!alive || authEventObserved) return;
      applySession(data.session ?? null);
    }).catch(() => {
      if (!alive || authEventObserved) return;
      applySession(null);
    });

    const { data: subscription } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
      authEventObserved = true;
      applySession(session, event);
    });

    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    intendedSignOutRef.current = true;
    const { error } = await supabaseBrowser.auth.signOut();
    if (error) intendedSignOutRef.current = false;
    return error;
  }, []);

  return { state, signOut };
}
