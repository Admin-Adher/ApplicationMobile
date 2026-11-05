'use client';

import { useEffect, useRef, useState } from 'react';
import type { DxfParseResult } from '../../../../lib/dxfParser';
import { dxfCanvasHeight, paintWebDxf, readWebDxf } from './web-dxf';
import styles from './WebDxfPlan.module.css';

const WIDTH = 1200;

export default function WebDxfPlan({ uri, name }: { uri: string; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState<DxfParseResult | null>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setDrawing(null);
    setError('');
    void readWebDxf(uri, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setVisible(new Set(result.layers));
      setDrawing(result);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Aperçu DXF indisponible.');
    });
    return () => controller.abort();
  }, [uri, retry]);

  useEffect(() => {
    if (drawing && canvas.current) paintWebDxf(canvas.current, drawing, visible);
  }, [drawing, visible]);

  if (!drawing) return (
    <div className={styles.state} role={error ? 'alert' : 'status'}>
      <span>{error || 'Chargement du plan DXF…'}</span>
      {error ? <button type="button" onClick={() => setRetry(count => count + 1)}>Réessayer</button> : null}
    </div>
  );

  return (
    <>
      <canvas ref={canvas} className={styles.canvas} width={WIDTH} height={dxfCanvasHeight(WIDTH)} aria-label={name} role="img" />
      <details className={styles.layers}>
        <summary>Couches DXF ({visible.size}/{drawing.layers.length})</summary>
        <fieldset>
          <legend>Afficher les couches</legend>
          {drawing.layers.map(layer => (
            <label key={layer}>
              <input type="checkbox" checked={visible.has(layer)} onChange={event => {
                const checked = event.currentTarget.checked;
                setVisible(previous => {
                  const next = new Set(previous);
                  if (checked) next.add(layer);
                  else next.delete(layer);
                  return next;
                });
              }} />
              {layer}
            </label>
          ))}
        </fieldset>
        {drawing.entities.length > 25_000 ? <small>Aperçu limité aux 25 000 premiers tracés.</small> : null}
      </details>
    </>
  );
}
