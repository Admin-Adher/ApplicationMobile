import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { DEFAULT_APP_LANGUAGE, normalizeAppLanguage } from '@/constants/language';
import { resources } from './resources';

function getInitialLanguage() {
  try {
    const locale = Localization.getLocales?.()[0];
    return normalizeAppLanguage(locale?.languageCode ?? locale?.languageTag) ?? DEFAULT_APP_LANGUAGE;
  } catch {
    return DEFAULT_APP_LANGUAGE;
  }
}

if (!i18n.isInitialized) {
  const initialLanguage = getInitialLanguage();
  void i18n
    .use(initReactI18next)
    .init({
      compatibilityJSON: 'v4',
      fallbackLng: DEFAULT_APP_LANGUAGE,
      interpolation: { escapeValue: false },
      lng: initialLanguage,
      react: { useSuspense: false },
      resources,
    });
}

export default i18n;
