'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MeetingReport, MeetingReportAction } from '../../../constants/types';
import { useProjectMeetingReports } from '../../../hooks/useProjectMeetingReports';
import { formatDateFR } from '../../../lib/utils';
import { supabaseBrowser } from '../../lib/supabase-browser';
import styles from './web.module.css';

const TEMPLATES = [
  { subject: 'Réunion hebdomadaire', agenda: 'Avancement des travaux\nRéserves en cours\nPlanning de la semaine suivante' },
  { subject: 'Réception de chantier', agenda: 'État des travaux\nRéserves à lever\nÉchéances et responsables' },
  { subject: 'Coordination des entreprises', agenda: 'Interfaces entre lots\nContraintes de chantier\nDécisions et responsabilités' },
  { subject: 'Synthèse de chantier', agenda: 'Points bloquants\nArbitrages\nProchaines étapes' },
];

function readReports(key: string): MeetingReport[] {
  const raw = window.localStorage.getItem(key);
  const parsed = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) throw new Error('Les comptes rendus locaux sont illisibles.');
  return parsed;
}

export default function MeetingsWorkspace({ userId, organizationId, chantierId, author, reserves, canCreate, canEdit, canDelete, exportReport, exporting }: {
  userId: string;
  organizationId: string | null | undefined;
  chantierId: string;
  author: string;
  reserves: Array<{ id: string; title: string }>;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  exportReport?: (report: MeetingReport) => void;
  exporting: boolean;
}) {
  const key = `buildtrack-web-meetings-v1:${userId}:${organizationId}:${chantierId}`;
  const shared = useProjectMeetingReports(supabaseBrowser, userId, organizationId, chantierId);
  const [reports, setReports] = useState<MeetingReport[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<MeetingReport | null | undefined>();
  const [editingVersion, setEditingVersion] = useState<number>();
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [template, setTemplate] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [agenda, setAgenda] = useState('');
  const sharedById = new Map(shared.rows.map(row => [row.report.id, row]));
  const visibleReports = [...shared.rows.map(row => row.report), ...reports.filter(report => !sharedById.has(report.id))];
  const sharedLoading = Boolean(organizationId && !shared.ready && !shared.failed);
  const canOpenForm = ready || shared.ready;

  useEffect(() => {
    const refresh = () => {
      try { setReports(readReports(key)); setReady(true); setError(''); }
      catch { setReady(false); setError('Les comptes rendus locaux sont indisponibles.'); }
    };
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) refresh(); };
    refresh();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  function store(update: (previous: MeetingReport[]) => MeetingReport[]) {
    try {
      const next = update(readReports(key));
      window.localStorage.setItem(key, JSON.stringify(next));
      setReports(next);
      setError('');
      return true;
    } catch {
      setError('Enregistrement local impossible.');
      return false;
    }
  }

  async function write(operation: () => Promise<boolean>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      if (!await operation()) throw new Error('Enregistrement indisponible. Réessayez.');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.');
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  function open(report: MeetingReport | null) {
    setEditing(report);
    setEditingVersion(report ? sharedById.get(report.id)?.version : undefined);
    setSubject(report?.subject ?? '');
    setAgenda(report?.agenda ?? '');
    setTemplate(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subject.trim() || (editing ? !canEdit : !canCreate)) return;
    const fields = new FormData(event.currentTarget);
    const value = (name: string) => String(fields.get(name) ?? '').trim();
    const [year, month, day] = value('date').split('-');
    if (!year || !month || !day) return;
    const changes = { subject: subject.trim(), agenda: agenda.trim(), date: `${day}/${month}/${year}`, location: value('location'),
      participants: value('participants'), notes: value('notes'), nextMeeting: value('nextMeeting'),
      decisions: value('decisions').split('\n').map(line => line.trim()).filter(Boolean) };
    const report = editing
      ? { ...editing, ...changes }
      : { ...changes, id: crypto.randomUUID(), actions: [], redactedBy: author, createdAt: new Date().toISOString() };
    const saved = editingVersion !== undefined || (!editing && shared.ready)
      ? await write(() => shared.save(report, editing ? 'update' : 'create', editingVersion))
      : store(previous => editing ? previous.map(item => item.id === report.id ? report : item) : [report, ...previous]);
    if (saved) setEditing(undefined);
  }

  async function changeActions(id: string, update: (actions: MeetingReportAction[]) => MeetingReportAction[]) {
    if (!canEdit) return false;
    const row = sharedById.get(id);
    if (row) return write(() => shared.save({ ...row.report, actions: update(row.report.actions) }, 'update', row.version));
    return store(previous => previous.map(report => report.id === id ? { ...report, actions: update(report.actions) } : report));
  }

  async function addAction(event: FormEvent<HTMLFormElement>, report: MeetingReport) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const value = (name: string) => String(fields.get(name) ?? '').trim();
    if (!value('description')) return;
    if (await changeActions(report.id, actions => [...actions, { id: crypto.randomUUID(), description: value('description'),
      responsible: value('responsible'), deadline: value('deadline'), reserveId: value('reserveId') || undefined, status: 'pending' }])) form.reset();
  }

  return <section className={styles.panel}>
    <div className={styles.panelHeaderCompact}>
      <div><h2>Comptes rendus de réunion</h2><p>Les comptes rendus partagés sont disponibles sur le web et Android.</p></div>
      <div className={styles.segmented}>
        {shared.ready && <button type="button" disabled={busy} onClick={() => void shared.refresh()}>Actualiser</button>}
        {canOpenForm && canCreate && editing === undefined && <button className={styles.settingsGhostButton} type="button" disabled={sharedLoading} onClick={() => open(null)}>Nouveau compte rendu</button>}
      </div>
    </div>
    {shared.failed && <p role="status">Comptes rendus partagés indisponibles. Les nouveaux comptes rendus restent dans ce navigateur. <button type="button" onClick={() => void shared.refresh()}>Réessayer</button></p>}
    {error && <p role="alert">{error}</p>}
    {canOpenForm && editing !== undefined && <form key={editing?.id ?? 'new'} className={`${styles.reportCard} ${styles.fieldForm}`} onSubmit={submit}>
      {!editing && <p>{shared.ready ? 'Ce compte rendu sera visible par l’équipe de ce chantier.' : 'Ce compte rendu sera conservé dans ce navigateur.'}</p>}
      {!editing && <label>Modèle<select value={template ?? ''} onChange={event => {
        if (!event.target.value) { setTemplate(null); return; }
        const index = Number(event.target.value);
        setTemplate(index); setSubject(TEMPLATES[index].subject); setAgenda(TEMPLATES[index].agenda);
      }}><option value="">Compte rendu vierge</option>{TEMPLATES.map((item, index) => <option key={item.subject} value={index}>{item.subject}</option>)}</select></label>}
      <label>Sujet<input required maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} /></label>
      <label>Date<input name="date" type="date" required defaultValue={(editing?.date ?? formatDateFR(new Date())).split('/').reverse().join('-')} /></label>
      <label>Lieu<input name="location" maxLength={160} defaultValue={editing?.location} /></label>
      <label>Participants, un par ligne<textarea name="participants" maxLength={5000} defaultValue={editing?.participants} /></label>
      <label>Ordre du jour<textarea maxLength={5000} value={agenda} onChange={event => setAgenda(event.target.value)} /></label>
      <label>Notes<textarea name="notes" maxLength={15000} defaultValue={editing?.notes} /></label>
      <label>Décisions, une par ligne<textarea name="decisions" maxLength={5000} defaultValue={editing?.decisions.join('\n')} /></label>
      <label>Prochaine réunion<input name="nextMeeting" maxLength={160} defaultValue={editing?.nextMeeting} /></label>
      <div className={styles.segmented}><button type="button" disabled={busy} onClick={() => setEditing(undefined)}>Annuler</button> <button type="submit" disabled={busy}>Enregistrer</button></div>
    </form>}
    {sharedLoading ? <p role="status">Chargement des comptes rendus partagés…</p> : null}
    {canOpenForm && !sharedLoading && visibleReports.length === 0 && <p>Aucun compte rendu à afficher.</p>}
    <div className={styles.stack}>
      {visibleReports.map(report => <details key={report.id} className={styles.reportCard}>
        <summary><strong>{report.subject}</strong> · {report.date} · {report.actions.length} action(s){sharedById.has(report.id) ? '' : ' · Sur ce navigateur'}</summary>
        <p style={{ whiteSpace: 'pre-wrap' }}>{[report.location, report.participants, report.agenda, report.notes, ...report.decisions, report.nextMeeting].filter(Boolean).join('\n\n')}</p>
        <ul>{report.actions.map((action, index) => <li key={action.id ?? index}>
          <label><input type="checkbox" checked={action.status === 'done'} disabled={!canEdit || busy} onChange={event => {
            const checked = event.currentTarget.checked;
            changeActions(report.id, actions => actions.map(item => item.id === action.id ? { ...item, status: checked ? 'done' : 'pending' } : item));
          }} />{[action.description, action.responsible, action.deadline, action.reserveId].filter(Boolean).join(' · ')}</label>
          {canEdit && <button type="button" disabled={busy} onClick={() => void changeActions(report.id, actions => actions.filter(item => item.id !== action.id))}>Retirer</button>}
        </li>)}</ul>
        {canEdit && <form className={styles.fieldForm} onSubmit={event => addAction(event, report)}>
          <label>Action<input name="description" required maxLength={300} /></label>
          <label>Responsable<input name="responsible" maxLength={160} /></label>
          <label>Échéance<input name="deadline" type="date" /></label>
          <label>Réserve liée<select name="reserveId"><option value="">Aucune</option>{reserves.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <button type="submit" disabled={busy}>Ajouter l’action</button>
        </form>}
        <div className={styles.segmented}>
          {canEdit && <button type="button" disabled={busy} onClick={() => open(report)}>Modifier</button>}
          {exportReport && <button type="button" disabled={exporting} onClick={() => exportReport(report)}>Télécharger PDF</button>}
          {canCreate && shared.ready && !sharedById.has(report.id) && <button type="button" disabled={busy} onClick={async () => {
            if (!window.confirm(`Partager « ${report.subject} » avec l’équipe de ce chantier ?`)) return;
            if (await write(() => shared.save(report, 'create'))) store(previous => previous.filter(item => item.id !== report.id));
          }}>Partager sur le chantier</button>}
          {canDelete && <button type="button" disabled={busy} onClick={() => {
            if (!window.confirm(`Supprimer le compte rendu « ${report.subject} » ?`)) return;
            if (sharedById.has(report.id)) void write(() => shared.remove(report.id));
            else store(previous => previous.filter(item => item.id !== report.id));
          }}>Supprimer</button>}
        </div>
      </details>)}
    </div>
  </section>;
}
