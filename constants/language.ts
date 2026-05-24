export type AppLanguage = 'fr' | 'en' | 'es';
export type LanguagePreference = 'auto' | AppLanguage;

export const DEFAULT_APP_LANGUAGE: AppLanguage = 'fr';

export const SUPPORTED_APP_LANGUAGES: Array<{
  code: AppLanguage;
  label: string;
  nativeName: string;
  locale: string;
}> = [
  { code: 'fr', label: 'FR', nativeName: 'Français', locale: 'fr-FR' },
  { code: 'en', label: 'EN', nativeName: 'English', locale: 'en-US' },
  { code: 'es', label: 'ES', nativeName: 'Español', locale: 'es-ES' },
];

export function normalizeAppLanguage(value?: string | null): AppLanguage | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  const short = normalized.split(/[-_]/)[0];
  if (short === 'fr' || short === 'en' || short === 'es') return short;
  return null;
}

export function isLanguagePreference(value?: string | null): value is LanguagePreference {
  return value === 'auto' || value === 'fr' || value === 'en' || value === 'es';
}

export function localeForLanguage(language: AppLanguage): string {
  return SUPPORTED_APP_LANGUAGES.find(item => item.code === language)?.locale ?? 'fr-FR';
}
