'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import styles from './OprSignaturePage.module.css';

type Point = [number, number];
type OprSummary = {
  title: string;
  date: string;
  location: string;
  visitDate?: string;
  signerName: string;
  signed: boolean;
  finished: boolean;
  items: { name?: string; description?: string; status?: string }[];
};
const labels: Record<string, string> = { ok: 'Conforme', reserve: 'Réserve', non_applicable: 'Non applicable' };

async function request(input: object, signal?: AbortSignal) {
  const response = await fetch('/api/opr-signature', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'La signature est temporairement indisponible.');
  return result;
}

export default function OprSignaturePage({ id }: { id: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [opr, setOpr] = useState<OprSummary | null>(null);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pointer = useRef<number | null>(null);
  const pointCount = useRef(0);
  const workspaceHref = '/web?opr=' + encodeURIComponent(id);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('access') ?? '';
    setToken(value);
    if (!value) return;
    const controller = new AbortController();
    void request({ action: 'read', oprId: id, token: value }, controller.signal).then(setOpr).catch(cause => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, [id]);

  function position(event: PointerEvent<SVGSVGElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      Math.round(Math.max(0, Math.min(600, (event.clientX - rect.left) * 600 / rect.width))),
      Math.round(Math.max(0, Math.min(220, (event.clientY - rect.top) * 220 / rect.height))),
    ];
  }

  async function sign() {
    if (!opr || !token || saving) return;
    setError('');
    setSaving(true);
    try {
      await request({ action: 'sign', oprId: id, token, strokes });
      setOpr({ ...opr, signed: true });
      setStrokes([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d’enregistrer la signature.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header><Link href="/web">BuildTrack</Link><p>Session OPR</p><h1>{opr?.title || 'Procès-verbal de réception'}</h1></header>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {token === '' ? (
        <p>Ce lien ouvre un procès-verbal dans l’espace BuildTrack. <Link href={workspaceHref}>Accéder au procès-verbal</Link></p>
      ) : null}
      {!opr && token && !error ? <p role="status">Chargement du procès-verbal…</p> : null}
      {opr ? (
        <>
          <p>{[opr.date, opr.location].filter(Boolean).join(' · ')}</p>
          {opr.visitDate && !/^(true|false)$/i.test(opr.visitDate) ? <p>Visite contradictoire le {opr.visitDate}</p> : null}
          <ul className={styles.items}>
            {opr.items.map((item, index) => (
              <li key={index}>
                <strong>{item.name || 'Contrôle'}</strong>
                <span>{labels[item.status || ''] || 'À préciser'}</span>
                {item.description && item.description !== item.name ? <p>{item.description}</p> : null}
              </li>
            ))}
          </ul>
          {opr.signed ? <p role="status">La signature de {opr.signerName} est enregistrée.</p> : opr.finished ? (
            <p role="status">Le procès-verbal est déjà finalisé.</p>
          ) : (
            <section aria-labelledby="opr-sign">
              <h2 id="opr-sign">Signature de {opr.signerName}</h2>
              <p>Tracez votre signature dans le cadre, puis validez.</p>
              <svg viewBox="0 0 600 220" preserveAspectRatio="none" className={styles.pad} role="img" aria-label="Cadre de signature"
                onPointerDown={event => {
                  if (saving || pointer.current !== null || !event.isPrimary || event.button !== 0 || strokes.length >= 50 || pointCount.current >= 4000) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  pointer.current = event.pointerId;
                  pointCount.current += 1;
                  const point = position(event);
                  setStrokes(current => [...current, [point]]);
                }}
                onPointerMove={event => {
                  if (pointer.current !== event.pointerId || pointCount.current >= 4000) return;
                  pointCount.current += 1;
                  const point = position(event);
                  setStrokes(current => [...current.slice(0, -1), [...(current.at(-1) ?? []), point]]);
                }}
                onLostPointerCapture={() => { pointer.current = null; }}>
                {strokes.map((stroke, index) => (
                  <polyline key={index} points={stroke.map(point => point.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                ))}
              </svg>
              <div className={styles.actions}>
                <button type="button" disabled={saving || !strokes.length} onClick={() => { setStrokes([]); pointCount.current = 0; }}>Effacer</button>
                <button type="button" disabled={saving || !strokes.some(stroke => stroke.length > 1)} onClick={sign}>
                  {saving ? 'Enregistrement…' : 'Valider la signature'}
                </button>
              </div>
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}
