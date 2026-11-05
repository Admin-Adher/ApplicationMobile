'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { MessageChannelRecord } from './messages-model';
import styles from './MessagesWorkspace.module.css';

export type ChannelDraft = { name: string; description: string; type: 'custom' | 'group'; memberIds: string[] };
export type ChannelPerson = { id: string; name: string };

export default function ChannelEditor({ current, actorId, people, loadMembers, save, close }: {
  current: MessageChannelRecord | null;
  actorId: string;
  people: ChannelPerson[];
  loadMembers: (id: string) => Promise<string[]>;
  save: (draft: ChannelDraft) => Promise<void>;
  close: () => void;
}) {
  const [name, setName] = useState(current?.name ?? '');
  const [description, setDescription] = useState(current?.description ?? '');
  const [type, setType] = useState<'custom' | 'group'>(current?.type === 'group' ? 'group' : 'custom');
  const [memberIds, setMemberIds] = useState<string[]>([actorId]);
  const [memberReady, setMemberReady] = useState(current?.type !== 'group');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (current?.type !== 'group') return;
    let active = true;
    void loadMembers(current.id).then(ids => {
      if (active) { setMemberIds(ids); setMemberReady(true); }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Impossible de charger les membres.');
    });
    return () => { active = false; };
    // Read members once per editor. Refetching on a parent render can reset selections.
  }, [current?.id, current?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!memberReady || !name.trim() || busy) return;
    if (type === 'group' && memberIds.length < 2) {
      setError('Sélectionnez au moins deux membres pour le groupe.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await save({ name: name.trim(), description: description.trim(), type, memberIds });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement du canal impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.channelEditor} aria-label={current ? 'Modifier le canal' : 'Nouveau canal'}>
      <label>Nom<input required value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
      <label>Description<input value={description} maxLength={300} onChange={event => setDescription(event.target.value)} /></label>
      {!current ? <label>Type<select value={type} onChange={event => setType(event.target.value as ChannelDraft['type'])}>
        <option value="custom">Canal chantier</option>
        <option value="group">Groupe privé</option>
      </select></label> : null}
      {type === 'group' ? <fieldset disabled={!memberReady || busy}>
        <legend>Membres du groupe</legend>
        {people.map(person => <label key={person.id}>
          <input type="checkbox" checked={memberIds.includes(person.id)} disabled={person.id === actorId} onChange={event => {
            const checked = event.currentTarget.checked;
            setMemberIds(previous => checked ? [...new Set([...previous, person.id])] : previous.filter(id => id !== person.id));
          }} />
          {person.name}
        </label>)}
      </fieldset> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div><button type="button" onClick={close} disabled={busy}>Annuler</button><button type="submit" disabled={busy || !memberReady}>Enregistrer</button></div>
    </form>
  );
}
