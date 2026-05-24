export type SupportedLang = 'fr' | 'en' | 'es';

export const LANG_PARAM = 'lang';

export function normalizeLang(value?: string | null): SupportedLang {
  const raw = (value ?? '').toLowerCase();
  if (raw.startsWith('en')) return 'en';
  if (raw.startsWith('es')) return 'es';
  return 'fr';
}

export function getBrowserLang(): SupportedLang {
  if (typeof navigator === 'undefined') return 'fr';
  return normalizeLang(navigator.language);
}

export function getRequestedLang(getParam: (name: string) => string | null): SupportedLang {
  return normalizeLang(getParam(LANG_PARAM) ?? getBrowserLang());
}

export function appendLang(url: string, lang: SupportedLang): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${LANG_PARAM}=${encodeURIComponent(lang)}`;
}
