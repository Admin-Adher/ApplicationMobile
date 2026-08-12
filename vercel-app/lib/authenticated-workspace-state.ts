import type { Session, User } from '@supabase/supabase-js';

export type AuthenticatedWorkspaceState =
  | { status: 'checking' }
  | { status: 'anonymous'; reason: 'signed_out' | 'expired' }
  | { status: 'authenticated'; session: Session; user: User };

export function authenticatedWorkspaceState(
  session: Session | null,
  context: { event?: string; hadSession: boolean; intendedSignOut: boolean },
): AuthenticatedWorkspaceState {
  if (session) return { status: 'authenticated', session, user: session.user };
  const expired = context.event === 'SIGNED_OUT' && context.hadSession && !context.intendedSignOut;
  return { status: 'anonymous', reason: expired ? 'expired' : 'signed_out' };
}
