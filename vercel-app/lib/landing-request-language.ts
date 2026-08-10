import 'server-only';
import { cookies, headers } from 'next/headers';
import type { Language } from '@/app/landing-copy';

export const LANDING_LANGUAGE_COOKIE = 'buildtrack_landing_language';

function supported(value: string | undefined): Language | null {
  const base = String(value || '').trim().toLowerCase().split('-')[0];
  return base === 'en' || base === 'fr' || base === 'es' ? base : null;
}

export async function detectRequestLanguage(): Promise<Language> {
  const cookieStore = await cookies();
  const saved = supported(cookieStore.get(LANDING_LANGUAGE_COOKIE)?.value);
  if (saved) return saved;

  const requestHeaders = await headers();
  const accepted = requestHeaders.get('accept-language') || '';
  const primary = accepted.split(',')[0]?.trim().split(';')[0];
  return supported(primary) || 'en';
}
