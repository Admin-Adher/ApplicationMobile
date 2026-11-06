'use client';

import { useEffect, useRef, useState } from 'react';
import {
  changeQueuedReserveEdit, isReserveEditConflict, isWebNetworkFailure, listWebOperations,
  listenWebOperations, removeWebOperation, ReserveEditConflict, saveWebOperation, type WebQueuedOperation,
} from './web-outbox';

export function useWebOutbox(owner: string, execute: (operation: WebQueuedOperation, stillOwned: () => boolean) => Promise<void>) {
  const [rows, setRows] = useState<WebQueuedOperation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [storageError, setStorageError] = useState('');
  const ownerRef = useRef(owner);
  const executeRef = useRef(execute);
  const busyRef = useRef(false);
  const flushRequestedRef = useRef(false);
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
    if (!scope || !navigator.onLine) return;
    if (busyRef.current) {
      flushRequestedRef.current = true;
      return;
    }
    const stillOwned = () => ownerRef.current === scope;
    busyRef.current = true;
    setSyncing(true);
    try {
      const drain = async () => {
        const pending = await listWebOperations(scope);
        for (const operation of pending) {
          if (!stillOwned() || !navigator.onLine) return;
          if (isReserveEditConflict(operation) || (operation.error && !retryFailed)) continue;
          try {
            await executeRef.current(operation, stillOwned);
            if (stillOwned()) await removeWebOperation(operation.key);
          } catch (cause) {
            if (!stillOwned()) return;
            const conflict = cause instanceof ReserveEditConflict;
            if (!conflict && (!navigator.onLine || isWebNetworkFailure(cause))) return;
            const accessDenied = typeof cause === 'object' && cause &&
              (('status' in cause && cause.status === 403) || ('code' in cause && cause.code === '42501'));
            const message = accessDenied ? 'Accès refusé. Vérifiez les droits de votre compte.'
              : typeof cause === 'object' && cause && 'message' in cause
                ? String(cause.message).slice(0, 240) : 'Opération refusée par le serveur.';
            await saveWebOperation({ ...operation, error: message, failure: conflict ? 'version_conflict' : undefined });
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
      if (flushRequestedRef.current) {
        flushRequestedRef.current = false;
        void flush();
      }
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

  async function changeReserveEdit(next: WebQueuedOperation | null, previous?: WebQueuedOperation) {
    const scope = ownerRef.current;
    if (!scope || (previous && previous.owner !== scope) || (next && next.owner !== scope)) {
      throw new Error('La session de synchronisation a changé.');
    }
    const write = async () => {
      if (ownerRef.current !== scope) throw new Error('La session de synchronisation a changé.');
      await changeQueuedReserveEdit(scope, next, previous?.key);
    };
    if (previous && navigator.locks) await navigator.locks.request('buildtrack-outbox:' + scope, write);
    else await write();
    if (ownerRef.current === scope) await refresh(scope);
  }

  async function discardFieldWrite(key: string) {
    const scope = ownerRef.current;
    if (!scope || busyRef.current) return;
    const discard = async () => {
      const queued = (await listWebOperations(scope)).find(row => row.key === key);
      if (ownerRef.current === scope && queued?.error && (queued.kind === 'field_write' || queued.kind === 'visit_reserves')) {
        await removeWebOperation(key);
      }
    };
    if (navigator.locks) await navigator.locks.request('buildtrack-outbox:' + scope, discard);
    else await discard();
    await refresh(scope);
  }

  return {
    rows: rows.filter(row => row.owner === owner), syncing, storageError, enqueue, flush, changeReserveEdit, discardFieldWrite,
    owns: (operation: WebQueuedOperation) => ownerRef.current === operation.owner,
  };
}
