export const RECOVERY_ORIGIN = 'https://buildtrack-mobile.vercel.app';

export function recoveryUrl(tokenHash: string, language: string) {
  if (!/^[a-f0-9]{40,128}$/i.test(tokenHash)) throw new Error('invalid_recovery_token');
  // Fragments are not sent in HTTP requests or Referer headers. The app only
  // verifies this token when the user submits their new password, never on GET.
  return `${RECOVERY_ORIGIN}/reset-password?lang=${encodeURIComponent(language)}#token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
}

export function readRecoveryToken(search: string, hash: string): string | null {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const query = new URLSearchParams(search);
  const source = fragment.has('token_hash') ? fragment : query;
  const token = source.get('token_hash');
  return source.get('type') === 'recovery' && token && /^[a-f0-9]{40,128}$/i.test(token) ? token : null;
}
