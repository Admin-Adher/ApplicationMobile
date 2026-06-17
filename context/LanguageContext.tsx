import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n from '@/lib/i18n';
import {
  AppLanguage,
  DEFAULT_APP_LANGUAGE,
  LanguagePreference,
  SUPPORTED_APP_LANGUAGES,
  isLanguagePreference,
  normalizeAppLanguage,
} from '@/constants/language';
import { useAuth } from '@/context/AuthContext';

const LANGUAGE_PREFERENCE_KEY = 'buildtrack_language_preference_v1';

type LanguageContextValue = {
  deviceLanguage: AppLanguage;
  effectiveLanguage: AppLanguage;
  isLoadingLanguage: boolean;
  languagePreference: LanguagePreference;
  setLanguagePreference: (next: LanguagePreference) => Promise<void>;
  supportedLanguages: typeof SUPPORTED_APP_LANGUAGES;
};

const LanguageContext = createContext<LanguageContextValue>({
  deviceLanguage: DEFAULT_APP_LANGUAGE,
  effectiveLanguage: DEFAULT_APP_LANGUAGE,
  isLoadingLanguage: true,
  languagePreference: 'auto',
  setLanguagePreference: async () => {},
  supportedLanguages: SUPPORTED_APP_LANGUAGES,
});

function detectDeviceLanguage(): AppLanguage {
  try {
    const locale = Localization.getLocales?.()[0];
    return normalizeAppLanguage(locale?.languageCode ?? locale?.languageTag) ?? DEFAULT_APP_LANGUAGE;
  } catch {
    return DEFAULT_APP_LANGUAGE;
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { user, updateUserPreferredLanguage } = useAuth();
  const [deviceLanguage, setDeviceLanguage] = useState<AppLanguage>(detectDeviceLanguage);
  const [languagePreference, setLanguagePreferenceState] = useState<LanguagePreference>('auto');
  const [isLoadingLanguage, setIsLoadingLanguage] = useState(true);
  const [hasStoredPreference, setHasStoredPreference] = useState(false);
  const profileSyncSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(LANGUAGE_PREFERENCE_KEY)
      .then(raw => {
        if (cancelled) return;
        if (isLanguagePreference(raw)) {
          setLanguagePreferenceState(raw);
          setHasStoredPreference(true);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLanguage(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hasStoredPreference || isLoadingLanguage) return;
    if (user?.preferredLanguage) {
      setLanguagePreferenceState(user.preferredLanguage);
    }
  }, [hasStoredPreference, isLoadingLanguage, user?.preferredLanguage]);

  useEffect(() => {
    setDeviceLanguage(detectDeviceLanguage());
  }, []);

  const effectiveLanguage = useMemo<AppLanguage>(() => {
    if (languagePreference !== 'auto') return languagePreference;
    return user?.preferredLanguage ?? deviceLanguage ?? DEFAULT_APP_LANGUAGE;
  }, [deviceLanguage, languagePreference, user?.preferredLanguage]);

  useEffect(() => {
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) void i18n.changeLanguage(effectiveLanguage);
    });
    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [effectiveLanguage]);

  const setLanguagePreference = useCallback(async (next: LanguagePreference) => {
    setLanguagePreferenceState(next);
    setHasStoredPreference(true);
    await AsyncStorage.setItem(LANGUAGE_PREFERENCE_KEY, next);

    if (user?.id) {
      const syncSeq = ++profileSyncSeqRef.current;
      const profileLanguage = next === 'auto' ? null : next;
      InteractionManager.runAfterInteractions(() => {
        if (profileSyncSeqRef.current !== syncSeq) return;
        updateUserPreferredLanguage(profileLanguage).catch(() => {
          // The local setting is already persisted. The profile sync can be
          // retried naturally when the user changes the setting again.
        });
      });
    }
  }, [updateUserPreferredLanguage, user?.id]);

  const value = useMemo<LanguageContextValue>(() => ({
    deviceLanguage,
    effectiveLanguage,
    isLoadingLanguage,
    languagePreference,
    setLanguagePreference,
    supportedLanguages: SUPPORTED_APP_LANGUAGES,
  }), [deviceLanguage, effectiveLanguage, isLoadingLanguage, languagePreference, setLanguagePreference]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
