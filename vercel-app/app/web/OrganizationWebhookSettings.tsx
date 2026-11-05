'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import styles from './web.module.css';

type Connection = { provider: 'make' | 'n8n'; last_tested_at: string | null; last_sent_at: string | null };
type Action = 'read' | 'save' | 'remove' | 'test' | 'send';

async function requestConnection(action: Action, userId: string, input: Record<string, string> = {}, signal?: AbortSignal) {
  const { data: { session } } = await supabaseBrowser.auth.getSession();
  if (!session || session.user.id !== userId) throw new Error('Reconnectez-vous pour gérer le connecteur.');
  const response = await fetch('/api/organization-webhook', {
    method: 'POST', signal, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...input }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Connecteur indisponible.');
  return result.connection as Connection | null;
}

export default function OrganizationWebhookSettings({ userId, projectId }: { userId: string; projectId: string | null }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(true);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void requestConnection('read', userId, {}, controller.signal).then(value => {
      if (!controller.signal.aborted) setConnection(value);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Connecteur indisponible.');
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [userId]);

  async function run(action: Exclude<Action, 'read'>) {
    if (busy || (action === 'send' && !projectId)) return;
    if (action === 'remove' && !window.confirm('Retirer le webhook pour toute l’organisation ?')) return;
    if (action === 'send' && !window.confirm('Envoyer le nom du chantier et le nombre de réserves actives et clôturées au webhook configuré ?')) return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      setConnection(await requestConnection(action, userId, action === 'save' ? { url: url.trim() } : action === 'send' ? { projectId: projectId! } : {}));
      if (action === 'save' || action === 'remove') setUrl('');
      setNotice({ save: 'Connecteur enregistré.', remove: 'Connecteur retiré.', test: 'Test reçu par le fournisseur.', send: 'Bilan reçu par le fournisseur.' }[action]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${styles.reportCard} ${styles.fieldForm}`} onSubmit={event => { event.preventDefault(); void run('save'); }} aria-busy={busy}>
      <strong>Webhook Make ou n8n Cloud</strong>
      <p>Connecteur partagé par l’organisation. Le test envoie un événement de contrôle. Le bilan du chantier est envoyé à la demande.</p>
      <p>{connection ? `Connecté à ${connection.provider === 'make' ? 'Make' : 'n8n Cloud'}` : busy ? 'Chargement du connecteur…' : 'Aucun webhook configuré.'}</p>
      <label>URL HTTPS du webhook <input type="password" autoComplete="off" required maxLength={2000} value={url} onChange={event => setUrl(event.target.value)} /></label>
      <div className={styles.segmented}>
        <button type="submit" disabled={busy || !url.trim()}>{connection ? 'Remplacer l’URL' : 'Enregistrer'}</button>
        <button type="button" disabled={busy || !connection} onClick={() => void run('test')}>Tester</button>
        <button type="button" disabled={busy || !connection || !projectId} onClick={() => void run('send')}>Envoyer le bilan</button>
        <button type="button" disabled={busy || !connection} onClick={() => void run('remove')}>Retirer</button>
      </div>
      {connection && !projectId && <small>Sélectionnez un chantier pour envoyer son bilan.</small>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
