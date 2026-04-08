import { useState, useEffect } from 'react';

const STARTUP_DELAY_MS = 2000;

export function useStartupDelay(trigger: boolean, delayMs = STARTUP_DELAY_MS): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!trigger) {
      setReady(false);
      return;
    }
    const timer = setTimeout(() => setReady(true), delayMs);
    return () => clearTimeout(timer);
  }, [trigger, delayMs]);

  return ready;
}
