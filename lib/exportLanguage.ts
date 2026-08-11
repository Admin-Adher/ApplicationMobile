import type { TFunction } from 'i18next';
import type { AppLanguage } from '../constants/language';
import { localeForLanguage, normalizeAppLanguage } from '../constants/language';
import i18n from './i18n';

export type ExportLanguage = AppLanguage;

export function normalizeExportLanguage(value?: string | null, fallback: ExportLanguage = 'en'): ExportLanguage {
  return normalizeAppLanguage(value) ?? fallback;
}

export function localeForExportLanguage(language: ExportLanguage): string {
  return localeForLanguage(language);
}

export function getExportTranslator(language: ExportLanguage): TFunction {
  return i18n.getFixedT(language);
}

export function exportLanguageSuffix(language: ExportLanguage): string {
  return language.toUpperCase();
}
