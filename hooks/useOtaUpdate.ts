import { useEffect, useState, useCallback, useRef } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';

export interface OtaUpdateState {
  updateReady: boolean;
  checking: boolean;
  applyUpdate: () => Promise<void>;
  checkNow: () => Promise<void>;
}

const noop = async () => {};

const WEB_STATE: OtaUpdateState = {
  updateReady: false,
  checking: false,
  applyUpdate: noop,
  checkNow: noop,
};

export function useOtaUpdate(): OtaUpdateState {
  const [updateReady, setUpdateReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);

  const check = useCallback(async () => {
    if (Platform.OS === 'web') return;
    if (typeof __DEV__ !== 'undefined' && __DEV__) return;
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      const Updates = require('expo-updates');
      if (!Updates.isEnabled) return;
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        await Updates.fetchUpdateAsync();
        setUpdateReady(true);
      }
    } catch {
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    check();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  const applyUpdate = useCallback(async () => {
    try {
      const Updates = require('expo-updates');
      await Updates.reloadAsync();
    } catch {}
  }, []);

  if (Platform.OS === 'web') return WEB_STATE;

  return { updateReady, checking, applyUpdate, checkNow: check };
}
