import type { TFunc } from '../../lib/reportLabels';
import { resources } from '../../lib/i18n/resources';
import type { SupportedLang } from './i18n';

export function fieldReportTranslator(language: SupportedLang): TFunc {
  const pluralRules = new Intl.PluralRules(language);
  return (key, params = {}) => {
    const parts = key.split('.');
    const last = parts.pop()!;
    const catalog = parts.reduce<any>((node, part) => node?.[part], resources[language].translation);
    const plural = typeof params.count === 'number' ? catalog?.[last + '_' + pluralRules.select(params.count)] : null;
    const message = plural ?? catalog?.[last] ?? params.defaultValue ?? key;
    return String(message).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params[name] ?? ''));
  };
}
