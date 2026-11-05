'use client';

import { useState, type FormEvent } from 'react';
import { STANDARD_LOTS } from '../../../constants/standardLots';
import styles from './web.module.css';

export type LotRow = { id: string; code: string; name: string; color?: string; cctp_ref?: string; organization_id?: string | null };
export type LotDraft = Pick<LotRow, 'code' | 'name' | 'color' | 'cctp_ref'>;

export default function LotsWorkspace({ lots, assignedLotIds, save, remove }: {
  lots: LotRow[];
  assignedLotIds: string[];
  save?: (draft: LotDraft, current?: LotRow) => Promise<void>;
  remove?: (lot: LotRow) => Promise<void>;
}) {
  const [editing, setEditing] = useState<LotRow | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const catalog = lots.length ? lots : STANDARD_LOTS;
  const standards = new Set(STANDARD_LOTS.map(lot => lot.id));
  const counts = new Map<string, number>();
  for (const id of assignedLotIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      setEditing(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d’enregistrer le lot.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!save) return;
    const fields = new FormData(event.currentTarget);
    const draft = {
      code: String(fields.get('code') ?? '').trim().toUpperCase(),
      name: String(fields.get('name') ?? '').trim(),
      color: String(fields.get('color') ?? ''),
      cctp_ref: String(fields.get('cctp') ?? '').trim(),
    };
    if (!draft.code || !draft.name) { setError('Renseignez le code et le nom du lot.'); return; }
    void run(() => save(draft, editing ?? undefined));
  }

  return <section className={styles.panel} aria-labelledby="lot-management-title">
    <div className={styles.panelHeaderCompact}>
      <div><h2 id="lot-management-title">Gestion des lots</h2><p>Lots utilisés pour classer les réserves et préparer les OPR.</p></div>
      {save && editing === undefined && <button type="button" className={styles.settingsGhostButton} onClick={() => { setError(''); setEditing(null); }}>Ajouter un lot</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {editing !== undefined && <form key={editing?.id ?? 'new'} className={`${styles.reportCard} ${styles.fieldForm}`} onSubmit={submit}>
      <label>Code <input name="code" required maxLength={4} defaultValue={editing?.code} /></label>
      <label>Nom <input name="name" required maxLength={160} defaultValue={editing?.name} /></label>
      <label>Couleur <input name="color" type="color" defaultValue={/^#[0-9a-f]{6}$/i.test(editing?.color ?? '') ? editing?.color : '#003082'} /></label>
      <label>Référence CCTP <input name="cctp" maxLength={200} defaultValue={editing?.cctp_ref} /></label>
      <div className={styles.segmented}><button type="button" disabled={busy} onClick={() => setEditing(undefined)}>Annuler</button> <button disabled={busy}>Enregistrer</button></div>
    </form>}
    <div className={styles.reportGrid}>
      {catalog.map(lot => <article className={styles.reportCard} key={lot.id}>
        <strong>{lot.code} · {lot.name}</strong>
        <small>{counts.get(lot.id) ?? 0} réserve(s) sur le périmètre affiché{standards.has(lot.id) ? ' · Standard' : ''}</small>
        {!standards.has(lot.id) && <div className={styles.segmented}>
          {save && <button type="button" disabled={busy} onClick={() => { setError(''); setEditing(lot); }}>Modifier</button>}
          {remove && !counts.has(lot.id) && <button type="button" disabled={busy} onClick={() => {
            if (window.confirm(`Supprimer le lot « ${lot.name} » ?`)) void run(() => remove(lot));
          }}>Supprimer</button>}
        </div>}
      </article>)}
    </div>
  </section>;
}
