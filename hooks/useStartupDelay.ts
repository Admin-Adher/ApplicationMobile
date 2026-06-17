import { useState, useEffect } from 'react';
import { InteractionManager, Platform } from 'react-native';

const STARTUP_DELAY_MS = 3200;

export function useStartupDelay(trigger: boolean, delayMs = STARTUP_DELAY_MS): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!trigger) {
      setReady(false);
      return;
    }
    let cancelled = false;
    let interactionTask: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
    const timer = setTimeout(() => {
      if (Platform.OS === 'web') {
        setReady(true);
        return;
      }
      interactionTask = InteractionManager.runAfterInteractions(() => {
        if (!cancelled) setReady(true);
      });
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      interactionTask?.cancel?.();
    };
  }, [trigger, delayMs]);

  return ready;
}
