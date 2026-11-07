'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { MessageChannelRecord } from './messages-model';
import { CHANNEL_COLORS, CHANNEL_ICONS, channelAppearance, channelDisplayColor, isChannelIcon } from './channel-appearance';
import ChannelSymbol from './ChannelSymbol';
import styles from './MessagesWorkspace.module.css';

export type ChannelDraft = { name: string; description: string; type: 'custom' | 'group' | 'dm'; memberIds: string[]; color: string; icon: string };
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
  const [type, setType] = useState<ChannelDraft['type']>(current?.type === 'group' ? 'group' : 'custom');
  const [color, setColor] = useState(() => channelAppearance(current?.type ?? 'custom', current).color);
  const [icon, setIcon] = useState(() => channelAppearance(current?.type ?? 'custom', current).icon);
  const [recipientId, setRecipientId] = useState('');
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
    if (!memberReady || busy) return;
    const recipient = type === 'dm' ? people.find(person => person.id === recipientId && person.id !== actorId) : null;
    if (type === 'dm' ? !recipient : !name.trim()) return;
    if (type === 'group' && memberIds.length < 2) {
      setError('Sélectionnez au moins deux membres pour le groupe.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await save(recipient
        ? { name: recipient.name, description: '', type, memberIds: [actorId, recipient.id], ...channelAppearance('dm') }
        : { name: name.trim(), description: description.trim(), type, memberIds, color, icon });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement du canal impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.channelEditor} aria-label={current ? 'Modifier le canal' : 'Nouveau canal'}>
      {!current ? <label>Type<select value={type} disabled={busy} onChange={event => {
        const nextType = event.target.value as ChannelDraft['type'];
        setType(nextType);
        const appearance = channelAppearance(nextType);
        setColor(appearance.color);
        setIcon(appearance.icon);
      }}>
        <option value="custom">Canal chantier</option>
        <option value="group">Groupe privé</option>
        <option value="dm">Message direct</option>
      </select></label> : null}
      {type === 'dm' ? <label>Destinataire<select required value={recipientId} onChange={event => setRecipientId(event.target.value)}>
        <option value="">Choisir un destinataire</option>
        {people.filter(person => person.id !== actorId).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label> : <>
        <label>Nom<input required value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
        <label>Description<input value={description} maxLength={300} onChange={event => setDescription(event.target.value)} /></label>
      </>}
      {type !== 'dm' ? <fieldset className={styles.channelAppearance} disabled={busy}>
        <legend>Apparence du canal</legend>
        <div className={styles.channelAppearancePreview}>
          <span style={{ color: channelDisplayColor(color), backgroundColor: `${channelDisplayColor(color)}18` }}><ChannelSymbol icon={icon} size={24} /></span>
          <strong>{name.trim() || (type === 'group' ? 'Nouveau groupe' : 'Nouveau canal')}</strong>
        </div>
        <label>Couleur<input type="color" value={channelDisplayColor(color)} onChange={event => setColor(event.target.value)} /></label>
        <div className={styles.channelPalette} role="group" aria-label="Couleurs proposées">
          {CHANNEL_COLORS.map(([value, label]) => <button key={value} type="button" aria-label={label} aria-pressed={color.toLowerCase() === value.toLowerCase()} title={label} style={{ backgroundColor: value }} onClick={() => setColor(value)}>
            {color.toLowerCase() === value.toLowerCase() ? <span aria-hidden="true">✓</span> : null}
          </button>)}
        </div>
        <label>Icône<select value={icon} onChange={event => setIcon(event.target.value)}>
          {!isChannelIcon(icon) ? <option value={icon}>Icône actuelle ({icon})</option> : null}
          {CHANNEL_ICONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </fieldset> : null}
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
      <div><button type="button" onClick={close} disabled={busy}>Annuler</button><button type="submit" disabled={busy || !memberReady}>{type === 'dm' ? 'Ouvrir la discussion' : 'Enregistrer'}</button></div>
    </form>
  );
}
