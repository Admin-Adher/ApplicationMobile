export type AuthScopedLoadLease = {
  isCurrent: () => boolean;
};

export type AuthScopedLoadGuard = {
  setAuthenticatedUser: (userId: string | null) => void;
  begin: (userId: string) => AuthScopedLoadLease;
};

/**
 * Keeps asynchronous workspace loads scoped to the user who started them.
 * A sign-out, account switch, or newer refresh invalidates older work before
 * it can commit stale data or errors to the React state.
 */
export function createAuthScopedLoadGuard(): AuthScopedLoadGuard {
  let authenticatedUserId: string | null = null;
  let generation = 0;

  return {
    setAuthenticatedUser(userId) {
      if (authenticatedUserId === userId) return;
      authenticatedUserId = userId;
      generation += 1;
    },

    begin(userId) {
      generation += 1;
      const loadGeneration = generation;

      return {
        isCurrent: () => authenticatedUserId === userId && generation === loadGeneration,
      };
    },
  };
}
