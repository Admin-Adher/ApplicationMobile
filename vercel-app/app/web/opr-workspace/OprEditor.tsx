'use client';

import { useState, type FormEvent } from 'react';
import { normalizeOprItem, type OprItemStatus, type OprItemView, type OprSource } from './opr-workspace-model';
import styles from './OprEditor.module.css';

const ITEM_OPTIONS: Record<OprItemStatus, string> = { ok: 'Conforme', reserve: 'Réserve', non_applicable: 'Non applicable' };

export type SaveOpr = (current: OprSource | null, fields: Record<string, unknown>) => Promise<string>;

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function localDate() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

function newItem(): OprItemView {
  return { id: crypto.randomUUID(), lotName: '', description: '', status: 'ok' as OprItemStatus, reserveId: null, note: '', entreprise: '', deadline: '' };
}

export default function OprEditor({
  current, reserves, onSave, onClose,
}: {
  current: OprSource | null;
  reserves: Record<string, unknown>[];
  onSave: SaveOpr;
  onClose: (id?: string) => void;
}) {
  const [title, setTitle] = useState(text(current?.title));
  const [date, setDate] = useState(text(current?.date) || localDate());
  const [building, setBuilding] = useState(text(current?.building));
  const [level, setLevel] = useState(text(current?.level));
  const [zone, setZone] = useState(text(current?.zone));
  const [owner, setOwner] = useState(text(current?.maire_ouvrage));
  const [visit, setVisit] = useState(() => {
    const value = text(current?.visit_contradictoire);
    return /^(true|false)$/i.test(value) ? '' : value;
  });
  const [items, setItems] = useState(() => Array.isArray(current?.items) && current.items.length
    ? current.items.map(normalizeOprItem) : [newItem()]);
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const savedItems = items.filter(item => item.lotName.trim());
    if (!title.trim() || !date.trim() || !savedItems.length || saving) {
      setError('Renseignez le titre, la date et au moins un lot.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const id = await onSave(current, {
        title: title.trim(), date: date.trim(), building: building.trim(), level: level.trim(),
        zone: zone.trim() || null, maire_ouvrage: owner.trim() || null, visit_contradictoire: visit.trim() || null,
        items: savedItems.map(item => {
          const previous = current?.items?.find((row: OprSource) => row.id === item.id);
          return { ...previous, ...item, lotName: item.lotName.trim(), description: item.description.trim() || item.lotName.trim() };
        }),
        ...(signerName.trim() ? {
          signatories: [...(Array.isArray(current?.signatories) ? current.signatories : []), {
            id: crypto.randomUUID(), name: signerName.trim(), role: signerRole.trim() || 'Participant', email: signerEmail.trim() || undefined,
          }],
        } : {}),
      });
      onClose(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }

  function changeItem(id: string, patch: Partial<ReturnType<typeof newItem>>) {
    setItems(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  return (
    <form className={styles.editor} onSubmit={submit} aria-label={current ? 'Modifier le procès-verbal' : 'Nouveau procès-verbal'} aria-busy={saving}>
      <h3>{current ? 'Modifier le procès-verbal' : 'Nouveau procès-verbal'}</h3>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <fieldset disabled={saving}>
        <legend>Informations du contrôle</legend>
        <div className={styles.grid}>
          <label>Titre<input autoFocus required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label>Date du contrôle<input required maxLength={24} value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Bâtiment<input value={building} onChange={e => setBuilding(e.target.value)} /></label>
          <label>Niveau<input value={level} onChange={e => setLevel(e.target.value)} /></label>
          <label>Zone<input value={zone} onChange={e => setZone(e.target.value)} /></label>
          <label>Maître d’ouvrage<input value={owner} onChange={e => setOwner(e.target.value)} /></label>
          <label>Visite contradictoire<input placeholder="JJ/MM/AAAA" maxLength={32} value={visit} onChange={e => setVisit(e.target.value)} /></label>
        </div>
      </fieldset>
      {items.map((item, index) => (
        <fieldset key={item.id} disabled={saving}>
          <legend>Lot {index + 1}</legend>
          <div className={styles.grid}>
            <label>Nom<input value={item.lotName} onChange={e => changeItem(item.id, { lotName: e.target.value })} /></label>
            <label>Entreprise<input value={item.entreprise} onChange={e => changeItem(item.id, { entreprise: e.target.value })} /></label>
            <label>Statut<select value={item.status} onChange={e => changeItem(item.id, { status: e.target.value as OprItemStatus })}>
              {Object.entries(ITEM_OPTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label>Réserve liée<select value={item.reserveId ?? ''} onChange={e => changeItem(item.id, { reserveId: e.target.value || null })}>
              <option value="">Aucune</option>
              {item.reserveId && !reserves.some(reserve => reserve.id === item.reserveId) ? <option value={item.reserveId}>{item.reserveId}</option> : null}
              {reserves.map(reserve => <option key={String(reserve.id)} value={String(reserve.id)}>{String(reserve.title || reserve.id)}</option>)}
            </select></label>
            <label>Échéance<input value={item.deadline} placeholder="JJ/MM/AAAA" onChange={e => changeItem(item.id, { deadline: e.target.value })} /></label>
            <label>Observations<input value={item.note} onChange={e => changeItem(item.id, { note: e.target.value })} /></label>
          </div>
          {items.length > 1 ? <button type="button" onClick={() => setItems(previous => previous.filter(row => row.id !== item.id))}>Retirer le lot {index + 1}</button> : null}
        </fieldset>
      ))}
      <button type="button" disabled={saving} onClick={() => setItems(previous => [...previous, newItem()])}>Ajouter un lot</button>
      <fieldset disabled={saving}>
        <legend>Ajouter un signataire</legend>
        <div className={styles.grid}>
          <label>Nom<input value={signerName} onChange={e => setSignerName(e.target.value)} /></label>
          <label>Fonction<input value={signerRole} onChange={e => setSignerRole(e.target.value)} /></label>
          <label>E-mail<input type="email" value={signerEmail} onChange={e => setSignerEmail(e.target.value)} /></label>
        </div>
      </fieldset>
      <div className={styles.actions}>
        <button type="button" disabled={saving} onClick={() => onClose()}>Annuler</button>
        <button type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le procès-verbal'}</button>
      </div>
    </form>
  );
}
