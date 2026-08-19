import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'buildtrack_support_org_v1';

export type SupportSession = { orgId: string; orgName: string };

type SupportSessionValue = {
  session: SupportSession | null;
  ready: boolean;
  enter: (orgId: string, orgName: string) => Promise<void>;
  exit: () => Promise<void>;
};

const SupportSessionContext = createContext<SupportSessionValue | null>(null);

export function SupportSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SupportSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(raw => {
      if (raw) {
        try { setSession(JSON.parse(raw) as SupportSession); } catch { /* ignore */ }
      }
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  const enter = useCallback(async (orgId: string, orgName: string) => {
    const next = { orgId, orgName };
    setSession(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  }, []);

  const exit = useCallback(async () => {
    setSession(null);
    await AsyncStorage.removeItem(KEY);
  }, []);

  return (
    <SupportSessionContext.Provider value={{ session, ready, enter, exit }}>
      {children}
    </SupportSessionContext.Provider>
  );
}

export function useSupportSession() {
  const value = useContext(SupportSessionContext);
  if (!value) {
    return {
      session: null,
      ready: true,
      enter: async () => undefined,
      exit: async () => undefined,
    };
  }
  return value;
}
