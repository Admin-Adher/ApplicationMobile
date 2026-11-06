'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { MeetingReport, MeetingReportAction } from '../../../constants/types';
import { useProjectMeetingReports } from '../../../hooks/useProjectMeetingReports';
import { formatDateFR } from '../../../lib/utils';
import { supabaseBrowser } from '../../lib/supabase-browser';
import styles from './web.module.css';

const TEMPLATES = [
  { subject: 'Réunion hebdomadaire', agenda: 'Avancement des travaux\nRéserves en cours\nPlanning de la semaine suivante',
    notes: 'Consigner les points d’avancement, les blocages et les réserves à traiter.', weekly: true },
  { subject: 'Réception de chantier', agenda: 'État des travaux\nRéserves à lever\nÉchéances et responsables',
    notes: 'Consigner les résultats de la visite et les délais de levée à convenir.' },
  { subject: 'Coordination des entreprises', agenda: 'Interfaces entre lots\nContraintes de chantier\nDécisions et responsabilités',
    notes: 'Noter les interventions à coordonner et les contraintes de chaque lot.' },
  { subject: 'Synthèse de chantier', agenda: 'Points bloquants\nArbitrages\nProchaines étapes',
    notes: 'Résumer les arbitrages et préciser les prochaines étapes.' },
];

function readReports(key: string): MeetingReport[] {
  const raw = window.localStorage.getItem(key);
  const parsed = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) throw new Error('Les comptes rendus locaux sont illisibles.');
  return parsed;
}

export default function MeetingsWorkspace({ userId, organizationId, chantierId, author, projectName, companies, reserves, canCreate, canEdit, canDelete, exportReport, exporting }: {
  userId: string;
  organizationId: string | null | undefined;
  chantierId: string;
  author: string;
  projectName: string;
  companies: Array<{ name?: string }>;
  reserves: Array<{ id: string; title: string; status?: string; archived_at?: string | null; archivedAt?: string | null }>;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  exportReport?: (report: MeetingReport) => void;
  exporting: boolean;
}) {
  const key = `buildtrack-web-meetings-v1:${userId}:${organizationId}:${chantierId}`;
  const shared = useProjectMeetingReports(
    { useState, useRef, useEffect, useCallback },
    supabaseBrowser, userId, organizationId, chantierId,
  );
  const [reports, setReports] = useState<MeetingReport[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<MeetingReport | null | undefined>();
  const [editingVersion, setEditingVersion] = useState<number>();
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [template, setTemplate] = useState<number | null>(null);
  const [details, setDetails] = useState({ subject: '', agenda: '', participants: '', notes: '', decisions: '' });
  const [invalidActionId, setInvalidActionId] = useState('');
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
    setDetails({
      subject: report?.subject ?? '',
      agenda: report?.agenda ?? '',
      participants: report?.participants ?? '',
      notes: report?.notes ?? '',
      decisions: report?.decisions.join('\n') ?? '',
    });
    setTemplate(null);
  }

  function applyTemplate(index: number) {
    const template = TEMPLATES[index];
    if (!template) return;
    const openCount = reserves.filter(reserve => reserve.status !== 'closed' && !reserve.archived_at && !reserve.archivedAt).length;
    const participants = [...new Set(companies.map(company => company.name?.trim()).filter(Boolean))].join('\n');
    setTemplate(index);
    setDetails({
      subject: [template.subject, projectName].filter(Boolean).join(' — ').slice(0, 200),
      agenda: template.agenda,
      participants: [participants, author].filter(Boolean).join('\n').slice(0, 5000),
      notes: template.notes,
      decisions: template.weekly
        ? `${openCount} réserve${openCount === 1 ? '' : 's'} à examiner\nPlanning de la semaine suivante à confirmer` : '',
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details.subject.trim() || (editing ? !canEdit : !canCreate)) return;
    const fields = new FormData(event.currentTarget);
    const value = (name: string) => String(fields.get(name) ?? '').trim();
    const [year, month, day] = value('date').split('-');
    if (!year || !month || !day) return;
    const changes = { subject: details.subject.trim(), agenda: details.agenda.trim(), date: `${day}/${month}/${year}`, location: value('location'),
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
    const description = value('description');
    const responsible = value('responsible');
    const deadline = value('deadline');
    if (!description || !responsible || !deadline) {
      setInvalidActionId(report.id);
      form.querySelector<HTMLInputElement>(`[name="${!description ? 'description' : !responsible ? 'responsible' : 'deadline'}"]`)?.focus();
      return;
    }
    setInvalidActionId('');
    if (await changeActions(report.id, actions => [...actions, { id: crypto.randomUUID(), description,
      responsible, deadline, reserveId: value('reserveId') || undefined, status: 'pending' }])) form.reset();
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
        applyTemplate(Number(event.target.value));
      }}><option value="">Compte rendu vierge</option>{TEMPLATES.map((item, index) => <option key={item.subject} value={index}>{item.subject}</option>)}</select></label>}
      <label>Sujet<input required maxLength={200} value={details.subject} onChange={event => setDetails({ ...details, subject: event.target.value })} /></label>
      <label>Date<input name="date" type="date" required defaultValue={(editing?.date ?? formatDateFR(new Date())).split('/').reverse().join('-')} /></label>
      <label>Lieu<input name="location" maxLength={160} defaultValue={editing?.location} /></label>
      <label>Participants, un par ligne<textarea name="participants" maxLength={5000} value={details.participants} onChange={event => setDetails({ ...details, participants: event.target.value })} /></label>
      <label>Ordre du jour<textarea maxLength={5000} value={details.agenda} onChange={event => setDetails({ ...details, agenda: event.target.value })} /></label>
      <label>Notes<textarea name="notes" maxLength={15000} value={details.notes} onChange={event => setDetails({ ...details, notes: event.target.value })} /></label>
      <label>Décisions, une par ligne<textarea name="decisions" maxLength={5000} value={details.decisions} onChange={event => setDetails({ ...details, decisions: event.target.value })} /></label>
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
        {canEdit && <form className={styles.fieldForm} onSubmit={event => addAction(event, report)} noValidate>
          <label>Action<input name="description" required maxLength={300} /></label>
          <label>Responsable<input name="responsible" required maxLength={160} /></label>
          <label>Échéance<input name="deadline" type="date" required /></label>
          <label>Réserve liée<select name="reserveId"><option value="">Aucune</option>{reserves.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          {invalidActionId === report.id && <p role="alert">Description, responsable et échéance sont obligatoires.</p>}
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
