export type WebAuthFeedbackCode =
  | 'invalid_credentials'
  | 'email_unconfirmed'
  | 'rate_limited'
  | 'network_unavailable'
  | 'reset_unavailable'
  | 'unknown';

type AuthErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

/**
 * Converts provider-specific authentication failures to stable product codes.
 * Raw Supabase messages must never be rendered directly in the interface.
 */
export function webAuthFeedbackCode(error: unknown): WebAuthFeedbackCode {
  const candidate = (error && typeof error === 'object' ? error : {}) as AuthErrorLike;
  const code = String(candidate.code ?? '').toLowerCase();
  const message = String(candidate.message ?? error ?? '').toLowerCase();
  const status = Number(candidate.status ?? 0);

  if (
    code.includes('invalid_credentials')
    || code.includes('invalid_grant')
    || message.includes('invalid login credentials')
  ) return 'invalid_credentials';

  if (
    code.includes('email_not_confirmed')
    || message.includes('email not confirmed')
  ) return 'email_unconfirmed';

  if (
    status === 429
    || code.includes('rate_limit')
    || message.includes('rate limit')
    || message.includes('too many requests')
  ) return 'rate_limited';

  if (
    error instanceof TypeError
    || code.includes('fetch')
    || message.includes('failed to fetch')
    || message.includes('network')
    || message.includes('load failed')
  ) return 'network_unavailable';

  return 'unknown';
}
