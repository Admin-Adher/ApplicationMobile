'use client';

import { useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { WorkspaceIcon } from '../plan-reserve-workspace/WorkspaceChrome';
import {
  buildPointageWorkspaceModel,
  formatAttendanceDate,
  formatAttendanceDuration,
  shiftAttendanceDate,
  type TimeEntrySource,
  type TimeEntrySummary,
} from './pointage-workspace-model';
import styles from './PointageWorkspace.module.css';

type CompanySource = {
  id: string;
  name?: string | null;
  color?: string | null;
};

type PointageDraft = {
  workerName: string;
  companyId: string;
  arrivalTime: string;
  departureTime: string;
  notes: string;
};

type PointageWorkspaceProps = {
  entries: TimeEntrySource[];
  companies: CompanySource[];
  projectName: string;
  today: string;
  locale?: string;
  editable: boolean;
  canDelete: boolean;
  onCreate: (payload: Record<string, unknown>) => Promise<unknown>;
  onUpdate: (entry: TimeEntrySource, patch: Record<string, unknown>) => Promise<unknown>;
  onDelete: (entry: TimeEntrySource) => Promise<unknown> | unknown;
};

function initialDraft(companyId = ''): PointageDraft {
  return {
    workerName: '',
    companyId,
    arrivalTime: '08:00',
    departureTime: '',
    notes: '',
  };
}

function currentTime() {
  return new Date().toTimeString().slice(0, 5);
}

function AttendanceRow({
  entry,
  editable,
  canDelete,
  actionPending,
  onDeparture,
  onDelete,
}: {
  entry: TimeEntrySummary;
  editable: boolean;
  canDelete: boolean;
  actionPending: string;
  onDeparture: (entry: TimeEntrySummary) => void;
  onDelete: (entry: TimeEntrySummary) => void;
}) {
  const pendingDeparture = actionPending === `departure:${entry.id}`;
  const pendingDelete = actionPending === `delete:${entry.id}`;
  return (
    <article
      className={styles.entryRow}
      data-status={entry.status}
      style={{ '--company-color': entry.companyColor } as CSSProperties}
      aria-busy={pendingDeparture || pendingDelete}
    >
      <div className={styles.timeRail}>
        <time dateTime={entry.arrivalTime}>{entry.arrivalTime}</time>
        <span>{entry.status === 'present' ? 'Arrivée' : `→ ${entry.departureTime}`}</span>
        {entry.status === 'departed' ? <small>{formatAttendanceDuration(entry.durationMinutes)}</small> : null}
      </div>
      <div className={styles.entryIdentity}>
        <div className={styles.entryTitleLine}>
          <strong>{entry.workerName}</strong>
          <span className={styles.statusLabel}>
            <i aria-hidden="true" />
            {entry.status === 'present' ? 'Sur site' : 'Parti'}
          </span>
        </div>
        <p className={styles.companyLine}>
          <span aria-hidden="true" />
          {entry.companyName}
        </p>
        {entry.notes ? <p className={styles.entryNotes}><WorkspaceIcon name="document" size={16} />{entry.notes}</p> : null}
      </div>
      {(editable || canDelete) ? (
        <div className={styles.rowActions}>
          {editable && entry.status === 'present' ? (
            <button className={styles.departureAction} type="button" disabled={Boolean(actionPending)} onClick={() => onDeparture(entry)}>
              <WorkspaceIcon name="check" size={17} />
              {pendingDeparture ? 'Enregistrement…' : 'Enregistrer le départ'}
            </button>
          ) : null}
          {canDelete ? (
            <button className={styles.deleteAction} type="button" disabled={Boolean(actionPending)} onClick={() => onDelete(entry)}>
              <WorkspaceIcon name="trash" size={17} />
              {pendingDelete ? 'Suppression…' : 'Supprimer'}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default function PointageWorkspace({
  entries,
  companies,
  projectName,
  today,
  locale = 'fr-FR',
  editable,
  canDelete,
  onCreate,
  onUpdate,
  onDelete,
}: PointageWorkspaceProps) {
  const idPrefix = useId().replace(/:/g, '');
  const composerTitle = useRef<HTMLHeadingElement | null>(null);
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<PointageDraft>(() => initialDraft(companies[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState('');
  const model = useMemo(() => buildPointageWorkspaceModel(entries, date), [date, entries]);
  const effectiveCompanyId = draft.companyId || companies[0]?.id || '';
  const selectedCompany = companies.find(company => company.id === effectiveCompanyId) ?? null;
  const isToday = date === today;
  const historyLabel = `${model.totalEntries} pointage${model.totalEntries > 1 ? 's' : ''} au total`;
  const presenceSummary = model.presentEntries.length
    ? `${model.presentEntries.length} personne${model.presentEntries.length > 1 ? 's' : ''} encore sur site.`
    : 'Aucune personne actuellement signalée sur site.';
  const passageLabel = `${model.dayEntries.length} passage${model.dayEntries.length > 1 ? 's' : ''}`;
  const formDateLabel = `Pointage pour le ${formatAttendanceDate(date, locale)}.`;

  function focusComposer() {
    window.requestAnimationFrame(() => {
      composerTitle.current?.focus({ preventScroll: true });
      composerTitle.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    });
  }

  function changeDate(nextDate: string) {
    setDate(nextDate);
    setActionError('');
    setSubmissionError('');
  }

  async function submitEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const workerName = draft.workerName.trim();
    if (!workerName) {
      setSubmissionError('Renseignez le nom du compagnon avant d’enregistrer.');
      return;
    }
    if (!effectiveCompanyId || !selectedCompany) {
      setSubmissionError('Sélectionnez une entreprise avant d’enregistrer.');
      return;
    }
    if (draft.departureTime && draft.departureTime === draft.arrivalTime) {
      setSubmissionError('L’heure de départ doit être différente de l’heure d’arrivée.');
      return;
    }
    setBusy(true);
    setSubmissionError('');
    try {
      const saved = await onCreate({
        worker_name: workerName,
        company_id: effectiveCompanyId,
        company_name: selectedCompany.name ?? '',
        company_color: selectedCompany.color ?? '#003082',
        arrival_time: draft.arrivalTime || '08:00',
        departure_time: draft.departureTime || null,
        notes: draft.notes.trim(),
        date,
      });
      if (!saved) {
        setSubmissionError('Le pointage n’a pas été enregistré. Vérifiez le message affiché puis réessayez.');
        return;
      }
      setDraft(previous => ({
        ...initialDraft(effectiveCompanyId),
        arrivalTime: previous.arrivalTime,
      }));
    } catch {
      setSubmissionError('L’enregistrement a échoué. Vérifiez votre connexion puis réessayez.');
    } finally {
      setBusy(false);
    }
  }

  async function recordDeparture(entry: TimeEntrySummary) {
    if (actionPending) return;
    setActionPending(`departure:${entry.id}`);
    setActionError('');
    try {
      const saved = await onUpdate(entry.source, { departure_time: currentTime() });
      if (!saved) setActionError(`Le départ de ${entry.workerName} n’a pas été enregistré. Réessayez.`);
    } catch {
      setActionError(`Le départ de ${entry.workerName} n’a pas été enregistré. Vérifiez la connexion.`);
    } finally {
      setActionPending('');
    }
  }

  async function removeEntry(entry: TimeEntrySummary) {
    if (actionPending) return;
    setActionPending(`delete:${entry.id}`);
    setActionError('');
    try {
      await onDelete(entry.source);
    } catch {
      setActionError(`Le pointage de ${entry.workerName} n’a pas été supprimé. Vérifiez la connexion.`);
    } finally {
      setActionPending('');
    }
  }

  return (
    <div className={styles.workspace} data-testid="web-pointage-workspace">
      <section className={styles.overview} aria-labelledby="pointage-overview-title">
        <div className={styles.overviewMain}>
          <div className={styles.overviewCopy}>
            <span className={styles.overviewIcon}><WorkspaceIcon name="users" size={24} /></span>
            <div>
              <p className={styles.eyebrow}>Registre de présence</p>
              <h2 id="pointage-overview-title">La journée sur site, sans angle mort</h2>
              <p>Visualisez les personnes présentes, enregistrez les arrivées et clôturez les départs depuis un même registre.</p>
              <div className={styles.scopeLine}>
                <span><WorkspaceIcon name="building" size={16} />{projectName}</span>
                <span>{historyLabel}</span>
              </div>
            </div>
          </div>
          <div className={styles.dayWorkspace}>
            <div className={styles.dateNavigator} aria-label="Naviguer entre les journées">
              <button type="button" aria-label="Jour précédent" onClick={() => changeDate(shiftAttendanceDate(date, -1))}>
                <WorkspaceIcon name="back" size={18} />
              </button>
              <label htmlFor={`${idPrefix}-date`}>
                <span>Date du pointage</span>
                <input id={`${idPrefix}-date`} type="date" value={date} onChange={event => changeDate(event.target.value)} required />
              </label>
              <button type="button" aria-label="Jour suivant" onClick={() => changeDate(shiftAttendanceDate(date, 1))}>
                <WorkspaceIcon name="chevron" size={18} />
              </button>
            </div>
            <div className={styles.dayActions}>
              {!isToday ? <button type="button" onClick={() => changeDate(today)}>Aujourd’hui</button> : null}
              {editable ? <button type="button" onClick={focusComposer}><WorkspaceIcon name="plus" size={18} />Ajouter une présence</button> : null}
            </div>
          </div>
        </div>
        <dl className={styles.overviewStats} aria-label={`Synthèse du ${formatAttendanceDate(date, locale)}`}>
          <div data-tone="present"><dt>Sur site</dt><dd>{model.presentEntries.length}</dd><small>sans départ enregistré</small></div>
          <div><dt>Passages</dt><dd>{model.dayEntries.length}</dd><small>sur la journée</small></div>
          <div><dt>Entreprises</dt><dd>{model.uniqueCompanies}</dd><small>intervenues ce jour</small></div>
          <div><dt>Temps enregistré</dt><dd>{formatAttendanceDuration(model.completedMinutes)}</dd><small>départs clôturés</small></div>
        </dl>
      </section>

      <div className={styles.workspaceGrid} data-editable={editable ? 'true' : 'false'}>
        <section className={styles.board} aria-labelledby="pointage-board-title">
          <header className={styles.boardHeader}>
            <div>
              <p className={styles.eyebrow}>Présences du jour</p>
              <h2 id="pointage-board-title">{formatAttendanceDate(date, locale, true)}</h2>
              <p>{presenceSummary}</p>
            </div>
            <span className={styles.boardCount} role="status" aria-live="polite">{passageLabel}</span>
          </header>

          {actionError ? <p className={styles.actionError} role="alert"><WorkspaceIcon name="warning" size={18} />{actionError}</p> : null}

          {!model.dayEntries.length ? (
            <div className={styles.emptyState}>
              <span><WorkspaceIcon name="clock" size={24} /></span>
              <h3>Aucun passage enregistré pour cette journée</h3>
              <p>Le registre est prêt à recevoir la première arrivée.</p>
              {editable ? <button type="button" onClick={focusComposer}><WorkspaceIcon name="plus" size={18} />Pointer une arrivée</button> : null}
            </div>
          ) : (
            <div className={styles.dayRegister}>
              <section className={styles.registerSection} aria-labelledby={`${idPrefix}-present-title`}>
                <header>
                  <div><span className={styles.sectionMarker} data-status="present" /><h3 id={`${idPrefix}-present-title`}>Présents maintenant</h3></div>
                  <strong>{model.presentEntries.length}</strong>
                </header>
                {model.presentEntries.length ? (
                  <div className={styles.entryList}>
                    {model.presentEntries.map(entry => (
                      <AttendanceRow key={entry.id} entry={entry} editable={editable} canDelete={canDelete} actionPending={actionPending} onDeparture={recordDeparture} onDelete={removeEntry} />
                    ))}
                  </div>
                ) : <p className={styles.emptySegment}>Tous les départs de la journée ont été enregistrés.</p>}
              </section>

              <section className={styles.registerSection} aria-labelledby={`${idPrefix}-departed-title`}>
                <header>
                  <div><span className={styles.sectionMarker} data-status="departed" /><h3 id={`${idPrefix}-departed-title`}>Départs enregistrés</h3></div>
                  <strong>{model.departedEntries.length}</strong>
                </header>
                {model.departedEntries.length ? (
                  <div className={styles.entryList}>
                    {model.departedEntries.map(entry => (
                      <AttendanceRow key={entry.id} entry={entry} editable={editable} canDelete={canDelete} actionPending={actionPending} onDeparture={recordDeparture} onDelete={removeEntry} />
                    ))}
                  </div>
                ) : <p className={styles.emptySegment}>Aucun départ enregistré pour le moment.</p>}
              </section>
            </div>
          )}
        </section>

        {editable ? (
          <aside className={styles.composer} aria-labelledby="pointage-composer-title">
            <header className={styles.composerHeader}>
              <span><WorkspaceIcon name="plus" size={20} /></span>
              <div>
                <p className={styles.eyebrow}>Saisie rapide</p>
                <h2 id="pointage-composer-title" ref={composerTitle} tabIndex={-1}>Nouveau pointage</h2>
                <p>Ajoutez une personne à la journée sélectionnée.</p>
              </div>
            </header>
            <form className={styles.composerForm} onSubmit={submitEntry} aria-busy={busy}>
              <fieldset>
                <legend>Compagnon</legend>
                <label htmlFor={`${idPrefix}-worker`}>
                  <span>Nom complet <em>obligatoire</em></span>
                  <input id={`${idPrefix}-worker`} value={draft.workerName} onChange={event => setDraft(previous => ({ ...previous, workerName: event.target.value }))} autoComplete="off" required />
                </label>
                <label htmlFor={`${idPrefix}-company`}>
                  <span>Entreprise <em>obligatoire</em></span>
                  <select id={`${idPrefix}-company`} value={effectiveCompanyId} onChange={event => setDraft(previous => ({ ...previous, companyId: event.target.value }))} required disabled={!companies.length}>
                    <option value="">Sélectionner une entreprise</option>
                    {companies.map(company => <option key={company.id} value={company.id}>{company.name ?? company.id}</option>)}
                  </select>
                </label>
              </fieldset>

              <fieldset>
                <legend>Horaires et contexte</legend>
                <div className={styles.timeFields}>
                  <label htmlFor={`${idPrefix}-arrival`}>
                    <span>Arrivée</span>
                    <input id={`${idPrefix}-arrival`} type="time" value={draft.arrivalTime} onChange={event => setDraft(previous => ({ ...previous, arrivalTime: event.target.value }))} required />
                    <button type="button" onClick={() => setDraft(previous => ({ ...previous, arrivalTime: currentTime() }))}>Utiliser l’heure actuelle</button>
                  </label>
                  <label htmlFor={`${idPrefix}-departure`}>
                    <span>Départ <em>optionnel</em></span>
                    <input id={`${idPrefix}-departure`} type="time" value={draft.departureTime} onChange={event => setDraft(previous => ({ ...previous, departureTime: event.target.value }))} />
                    <small>Laissez vide si la personne est encore sur site.</small>
                  </label>
                </div>
                <label htmlFor={`${idPrefix}-notes`}>
                  <span>Note <em>optionnelle</em></span>
                  <textarea id={`${idPrefix}-notes`} rows={3} value={draft.notes} onChange={event => setDraft(previous => ({ ...previous, notes: event.target.value }))} placeholder="Zone, équipe, précision utile…" />
                </label>
              </fieldset>

              <div className={styles.formFooter}>
                <div className={styles.formStatus} aria-live="polite">
                  {submissionError ? <p role="alert">{submissionError}</p> : <p>{formDateLabel}</p>}
                </div>
                <button className={styles.saveAction} type="submit" disabled={busy || !draft.workerName.trim() || !effectiveCompanyId}>
                  <WorkspaceIcon name="check" size={18} />
                  {busy ? 'Enregistrement…' : 'Enregistrer le pointage'}
                </button>
              </div>
            </form>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
