type CachedProfileOwner = { id?: unknown } | null | undefined;
type StoredSessionOwner = {
  access_token?: unknown;
  expires_at?: unknown;
  user?: { id?: unknown } | null;
} | null | undefined;

/**
 * A cached profile is presentation/offline data, not an authentication proof.
 * Restore it only when the device still has a Supabase user session owned by
 * the same account. This preserves legitimate offline access without letting a
 * stale profile bypass logout or an account switch.
 */
export function canRestoreCachedProfile(
  profile: CachedProfileOwner,
  session: StoredSessionOwner,
): boolean {
  return Boolean(
    profile &&
    session &&
    typeof profile.id === 'string' &&
    profile.id.length > 0 &&
    typeof session.access_token === 'string' &&
    session.access_token.length > 0 &&
    typeof session.expires_at === 'number' &&
    Number.isFinite(session.expires_at) &&
    session.expires_at > 0 &&
    typeof session.user?.id === 'string' &&
    session.user.id === profile.id
  );
}
