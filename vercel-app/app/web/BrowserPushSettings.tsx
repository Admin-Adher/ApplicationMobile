'use client';

import { useEffect, useState } from 'react';
import { browserPushRequest, canUseBrowserPush, stopBrowserPush, WEB_WORKER_PATH, WEB_WORKER_SCOPE } from '@/lib/browser-push-client';
import styles from './web.module.css';

export default function BrowserPushSettings() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const available = canUseBrowserPush();
    setSupported(available);
    if (!available) return;
    let current = true;
    void Promise.all([navigator.serviceWorker.getRegistration(WEB_WORKER_SCOPE), browserPushRequest({ action: 'config' })])
      .then(async ([worker, config]) => {
        const subscription = await worker?.pushManager.getSubscription();
        if (current) {
          setEnabled(Boolean(subscription) && Notification.permission === 'granted');
          setPublicKey(config.publicKey);
        }
      }).catch(cause => {
        if (current) setError(cause instanceof Error ? cause.message : 'Notifications indisponibles.');
      });
    return () => { current = false; };
  }, []);

  async function change() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (enabled) {
        await stopBrowserPush();
        setEnabled(false);
      } else {
        if (!publicKey) return;
        if (await Notification.requestPermission() !== 'granted') throw new Error('Autorisez les notifications dans les réglages du navigateur.');
        await navigator.serviceWorker.register(WEB_WORKER_PATH, { scope: WEB_WORKER_SCOPE });
        const worker = await navigator.serviceWorker.ready;
        const existing = await worker.pushManager.getSubscription();
        const subscription = existing ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
        try {
          await browserPushRequest({ action: 'save', subscription: subscription.toJSON() });
          setEnabled(true);
        } catch (cause) {
          if (!existing) await subscription.unsubscribe().catch(() => false);
          throw cause;
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de modifier les notifications.');
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.reportCard}>
    <strong>Notifications dans ce navigateur</strong>
    <p>Recevez les alertes des messages et réserves selon vos préférences, même lorsque BuildTrack est fermé.</p>
    {supported === false && <small>Ce navigateur ne prend pas en charge cet abonnement.</small>}
    {supported && <button type="button" disabled={busy || (!enabled && !publicKey)} onClick={() => void change()}>{enabled ? 'Désactiver sur ce navigateur' : 'Activer sur ce navigateur'}</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
