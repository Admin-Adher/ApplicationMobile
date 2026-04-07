import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Chantier, Message } from '@/constants/types';

const ACTIVE_CHANTIER_KEY = 'buildtrack_active_chantier_v2';

interface Notification {
  msg: Message;
  channelName: string;
  channelColor: string;
  channelIcon: string;
}

interface AppUIState {
  activeChantierId: string | null;
  setActiveChantierId: (id: string | null) => void;
  lastReadByChannel: Record<string, string>;
  setChannelRead: (channelId: string, timestamp: string) => void;
  setLastRead: (map: Record<string, string>) => void;
  notification: Notification | null;
  setNotification: (n: Notification | null) => void;
  dismissNotification: () => void;
  activeChannelIdRef: React.MutableRefObject<string | null>;
}

const AppUIContext = createContext<AppUIState | null>(null);

export function AppUIProvider({ children }: { children: React.ReactNode }) {
  const [activeChantierId, setActiveChantierIdState] = useState<string | null>(null);
  const [lastReadByChannel, setLastReadByChannel] = useState<Record<string, string>>({});
  const [notification, setNotification] = useState<Notification | null>(null);
  const activeChannelIdRef = useRef<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ACTIVE_CHANTIER_KEY).then(id => {
      if (id) setActiveChantierIdState(id);
    }).catch(() => {});

    AsyncStorage.getItem('lastReadByChannel').then(raw => {
      if (raw) {
        try { setLastReadByChannel(JSON.parse(raw)); } catch {}
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4500);
    return () => clearTimeout(timer);
  }, [notification]);

  const setActiveChantierId = useCallback((id: string | null) => {
    setActiveChantierIdState(id);
    if (id) {
      AsyncStorage.setItem(ACTIVE_CHANTIER_KEY, id).catch(() => {});
    } else {
      AsyncStorage.removeItem(ACTIVE_CHANTIER_KEY).catch(() => {});
    }
  }, []);

  const setChannelRead = useCallback((channelId: string, timestamp: string) => {
    setLastReadByChannel(prev => {
      const next = { ...prev, [channelId]: timestamp };
      AsyncStorage.setItem('lastReadByChannel', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const setLastRead = useCallback((map: Record<string, string>) => {
    setLastReadByChannel(map);
  }, []);

  const dismissNotification = useCallback(() => {
    setNotification(null);
  }, []);

  return (
    <AppUIContext.Provider value={{
      activeChantierId,
      setActiveChantierId,
      lastReadByChannel,
      setChannelRead,
      setLastRead,
      notification,
      setNotification,
      dismissNotification,
      activeChannelIdRef,
    }}>
      {children}
    </AppUIContext.Provider>
  );
}

export function useAppUI(): AppUIState {
  const ctx = useContext(AppUIContext);
  if (!ctx) throw new Error('useAppUI must be used within AppUIProvider');
  return ctx;
}

export { AppUIContext };
