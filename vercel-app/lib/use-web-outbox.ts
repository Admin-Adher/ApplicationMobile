'use client';

import { useEffect, useRef, useState } from 'react';
import { isWebNetworkFailure, listWebOperations, listenWebOperations, removeWebOperation, saveWebOperation, type WebQueuedOperation } from './web-outbox';

export function useWebOutbox(owner: string, execute: (operation: WebQueuedOperation, stillOwned: () => boolean) => Promise<void>) {
  const [rows, setRows] = useState<WebQueuedOperation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [storageError, setStorageError] = useState('');
  const ownerRef = useRef(owner);
  const executeRef = useRef(execute);
  const busyRef = useRef(false);
  ownerRef.current = owner;
  executeRef.current = execute;

  async function refresh(scope = ownerRef.current) {
    if (!scope) return;
    try {
      const result = await listWebOperations(scope);
      if (ownerRef.current === scope) { setRows(result); setStorageError(''); }
    } catch {
      if (ownerRef.current === scope) setStorageError('Le navigateur ne peut pas ouvrir la file hors connexion.');
    }
  }

  async function flush(retryFailed = false) {
    const scope = ownerRef.current;
    if (!scope || busyRef.current || !navigator.onLine) return;
    const stillOwned = () => ownerRef.current === scope;
    busyRef.current = true;
    setSyncing(true);
    try {
      const drain = async () => {
        const pending = await listWebOperations(scope);
        for (const operation of pending) {
          if (!stillOwned() || !navigator.onLine) return;
          if (operation.error && !retryFailed) continue;
          try {
            await executeRef.current(operation, stillOwned);
            if (stillOwned()) await removeWebOperation(operation.key);
          } catch (cause) {
            if (!stillOwned() || !navigator.onLine || isWebNetworkFailure(cause)) return;
            const message = typeof cause === 'object' && cause && 'message' in cause
              ? String(cause.message).slice(0, 240) : 'Opération refusée par le serveur.';
            await saveWebOperation({ ...operation, error: message });
          }
        }
      };
      if (navigator.locks) {
        await navigator.locks.request('buildtrack-outbox:' + scope, { ifAvailable: true }, async lock => {
          if (lock && stillOwned()) await drain();
        });
      } else await drain();
    } catch {
      if (stillOwned()) setStorageError('La file hors connexion n’a pas pu être synchronisée.');
    } finally {
      busyRef.current = false;
      setSyncing(false);
      await refresh();
    }
  }

  useEffect(() => {
    setRows([]);
    setStorageError('');
    if (!owner) return;
    const retry = () => { void flush(); };
    const unsubscribe = listenWebOperations(() => void refresh(owner));
    void refresh(owner);
    retry();
    window.addEventListener('online', retry);
    const timer = window.setInterval(retry, 30_000);
    return () => {
      unsubscribe();
      window.removeEventListener('online', retry);
      window.clearInterval(timer);
    };
    // The latest owner and handler are read through refs during each replay.
  }, [owner]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enqueue(kind: WebQueuedOperation['kind'], payload: Record<string, unknown>, files?: unknown, prepared?: unknown) {
    const scope = ownerRef.current;
    if (!scope || typeof payload.id !== 'string') throw new Error('Une session de chantier est nécessaire pour sauvegarder hors connexion.');
    await saveWebOperation({
      key: scope + ':' + kind + ':' + payload.id, owner: scope, kind, payload,
      createdAt: Date.now(), files, prepared,
    });
    if (ownerRef.current === scope) await refresh(scope);
  }

  return { rows: rows.filter(row => row.owner === owner), syncing, storageError, enqueue, flush };
}
