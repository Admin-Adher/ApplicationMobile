import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as Updates from 'expo-updates';

export type OtaUpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'up_to_date'
  | 'error'
  | 'restarting';

export type OtaCheckOutcome = 'unsupported' | 'ready' | 'up_to_date' | 'error';

export interface OtaUpdateState {
  updateReady: boolean;
  checking: boolean;
  phase: OtaUpdatePhase;
  downloadProgress: number | null;
  error: string | null;
  lastCheckedAt: Date | null;
  applyUpdate: () => Promise<boolean>;
  checkNow: () => Promise<OtaCheckOutcome>;
}

let sharedCheckPromise: Promise<Exclude<OtaCheckOutcome, 'unsupported' | 'error'>> | null = null;

function requestAndDownloadUpdate() {
  if (sharedCheckPromise) return sharedCheckPromise;
  sharedCheckPromise = (async () => {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable && !result.isRollBackToEmbedded) return 'up_to_date' as const;

    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew || fetched.isRollBackToEmbedded
      ? 'ready' as const
      : 'up_to_date' as const;
  })().finally(() => {
    sharedCheckPromise = null;
  });
  return sharedCheckPromise;
}

export function useOtaUpdate({ automatic = true }: { automatic?: boolean } = {}): OtaUpdateState {
  const updatesState = Updates.useUpdates();
  const [manualOutcome, setManualOutcome] = useState<OtaCheckOutcome | null>(null);
  const [manualChecking, setManualChecking] = useState(false);
  const [manualRestarting, setManualRestarting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualCheckedAt, setManualCheckedAt] = useState<Date | null>(null);
  const checkingRef = useRef(false);
  const outcomeRef = useRef<OtaCheckOutcome | null>(null);

  const supported = Platform.OS !== 'web'
    && !(typeof __DEV__ !== 'undefined' && __DEV__)
    && Updates.isEnabled;
  const updateReady = updatesState.isUpdatePending || manualOutcome === 'ready';

  const checkNow = useCallback(async (): Promise<OtaCheckOutcome> => {
    if (!supported) {
      outcomeRef.current = 'unsupported';
      setManualOutcome('unsupported');
      return 'unsupported';
    }
    if (updatesState.isUpdatePending) {
      outcomeRef.current = 'ready';
      setManualOutcome('ready');
      return 'ready';
    }
    if (checkingRef.current) return outcomeRef.current ?? 'up_to_date';

    checkingRef.current = true;
    setManualChecking(true);
    setManualError(null);
    outcomeRef.current = null;
    setManualOutcome(null);
    try {
      const outcome = await requestAndDownloadUpdate();
      outcomeRef.current = outcome;
      setManualOutcome(outcome);
      setManualCheckedAt(new Date());
      return outcome;
    } catch (cause) {
      setManualError(cause instanceof Error ? cause.message : String(cause));
      outcomeRef.current = 'error';
      setManualOutcome('error');
      setManualCheckedAt(new Date());
      return 'error';
    } finally {
      checkingRef.current = false;
      setManualChecking(false);
    }
  }, [supported, updatesState.isUpdatePending]);

  useEffect(() => {
    if (!supported || !automatic) return;
    void checkNow();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void checkNow();
    });
    return () => sub.remove();
  }, [automatic, checkNow, supported]);

  const applyUpdate = useCallback(async () => {
    if (!supported || !updateReady) return false;
    setManualRestarting(true);
    setManualError(null);
    try {
      await Updates.reloadAsync();
      return true;
    } catch (cause) {
      setManualError(cause instanceof Error ? cause.message : String(cause));
      outcomeRef.current = 'error';
      setManualOutcome('error');
      setManualRestarting(false);
      return false;
    }
  }, [supported, updateReady]);

  const phase = useMemo<OtaUpdatePhase>(() => {
    if (!supported) return 'unsupported';
    if (manualRestarting || updatesState.isRestarting) return 'restarting';
    if (updateReady) return 'ready';
    if (updatesState.isDownloading) return 'downloading';
    if (manualChecking || updatesState.isChecking) return 'checking';
    if (manualOutcome === 'up_to_date') return 'up_to_date';
    if (manualOutcome === 'error' || (!manualOutcome && (updatesState.checkError || updatesState.downloadError))) return 'error';
    return 'idle';
  }, [manualChecking, manualOutcome, manualRestarting, supported, updateReady, updatesState]);

  return {
    updateReady,
    checking: phase === 'checking' || phase === 'downloading',
    phase,
    downloadProgress: typeof updatesState.downloadProgress === 'number'
      ? updatesState.downloadProgress
      : null,
    error: manualError ?? updatesState.checkError?.message ?? updatesState.downloadError?.message ?? null,
    lastCheckedAt: manualCheckedAt ?? updatesState.lastCheckForUpdateTimeSinceRestart ?? null,
    applyUpdate,
    checkNow,
  };
}
