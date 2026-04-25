/**
 * Module-level flag used to distinguish an intentional `supabase.auth.signOut()`
 * (the user tapped the "Logout" button) from an automatic one fired by
 * supabase-js when a token refresh fails or the session is invalidated
 * server-side.
 *
 * Why we need this:
 *
 * AppContext listens to `onAuthStateChange` and, on `SIGNED_OUT`, used to
 * unconditionally clear the React Query cache + the persisted RQ cache in
 * AsyncStorage. That made the UI lose every chantier/réserve/photo the user
 * had cached locally whenever Supabase auto-signed-out (e.g. a transient
 * refresh-token failure right after an APK update). The user then had to
 * log out and log back in to repopulate the cache, which felt like data
 * loss even though the server still had everything.
 *
 * With this flag, AuthContext.logout() sets `intentionalLogout = true`
 * BEFORE calling `supabase.auth.signOut()`. AppContext's SIGNED_OUT handler
 * then only wipes caches when this flag is true, and resets it to false
 * after handling. Auto-signouts leave the offline cache intact so the user
 * keeps seeing their data while AuthContext silently re-authenticates or
 * falls back to the cached profile.
 */
let intentional = false;

export function markIntentionalLogout(): void {
  intentional = true;
}

export function consumeIntentionalLogout(): boolean {
  const wasIntentional = intentional;
  intentional = false;
  return wasIntentional;
}
