'use client';

import { useDeferredValue, useId, useMemo, useRef, useState } from 'react';
import {
  buildJournalWorkspaceModel,
  countAttendanceForDate,
  filterJournalEntries,
  formatJournalDate,
  journalDateParts,
  type JournalEntrySource,
  type JournalEntrySummary,
  type JournalFilter,
} from './journal-workspace-model';
import styles from './JournalWorkspace.module.css';

type JournalDraft = {
  id?: string;
  date: string;
  weather: string;
  workerCount: string;
  workDone: string;
  materials: string;
  incidents: string;
  observations: string;
  visitors: string;
};

type JournalWorkspaceProps = {
  entries: JournalEntrySource[];
  timeEntries: Array<Record<string, unknown>>;
  projectName: string;
  today: string;
  selectedProjectId: string;
  canCreate: boolean;
  canDelete: boolean;
  canExport: boolean;
  onCreate: (payload: Record<string, unknown>) => Promise<unknown>;
  onUpdate: (entry: JournalEntrySource, payload: Record<string, unknown>) => Promise<unknown>;
  onDelete: (entry: JournalEntrySource) => Promise<unknown> | unknown;
  onExport: () => void;
};

const FILTERS: Array<{ key: JournalFilter; label: string }> = [
  { key: 'all', label: 'Tout' },
  { key: 'recent', label: '7 jours' },
  { key: 'incidents', label: 'Incidents' },
];

type IconName = 'journal' | 'calendar' | 'users' | 'alert' | 'export' | 'plus' | 'close' | 'search' | 'pencil' | 'trash' | 'weather' | 'materials' | 'visitors' | 'note' | 'chevron' | 'check';

function JournalIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    journal: <><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5Z" /><path d="M5 4.5v17M9 7h7M9 11h7M9 15h4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 4 4.9" /></>,
    alert: <><path d="M12 4 3 20h18L12 4Z" /><path d="M12 9v5M12 17h.01" /></>,
    export: <><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 13v7h14v-7" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    pencil: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z" /><path d="m14 7 3 3" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    weather: <><circle cx="8" cy="8" r="3" /><path d="M8 2v1M8 13v1M2 8h1M13 8h1M3.8 3.8l.7.7M11.5 11.5l.7.7" /><path d="M9 19h9a3 3 0 0 0 .3-6 5 5 0 0 0-9.3 2" /></>,
    materials: <><path d="m12 3 8 4-8 4-8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></>,
    visitors: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M17 8h4M19 6v4" /></>,
    note: <><path d="M5 3h14v18H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function emptyDraft(date: string): JournalDraft {
  return {
    date,
    weather: '',
    workerCount: '',
    workDone: '',
    materials: '',
    incidents: '',
    observations: '',
    visitors: '',
  };
}

function draftFromEntry(entry: JournalEntrySummary): JournalDraft {
  return {
    id: entry.id,
    date: entry.date,
    weather: entry.weather,
    workerCount: entry.workerCount ? String(entry.workerCount) : '',
    workDone: entry.workDone,
    materials: entry.materials,
    incidents: entry.incidents,
    observations: entry.observations,
    visitors: entry.visitors,
  };
}

function draftSignature(draft: JournalDraft) {
  return JSON.stringify(draft);
}

function JournalEntryRecord({ entry, canCreate, canDelete, onEdit, onDelete }: {
  entry: JournalEntrySummary;
  canCreate: boolean;
  canDelete: boolean;
  onEdit: (entry: JournalEntrySummary) => void;
  onDelete: (entry: JournalEntrySummary) => void;
}) {
  const date = journalDateParts(entry.date);
  const hasDetails = Boolean(entry.materials || entry.incidents || entry.observations || entry.visitors);
  return (
    <article className={styles.entryRecord} data-incident={entry.incidents ? 'true' : 'false'}>
      <time className={styles.entryDate} dateTime={entry.date || undefined}>
        <span>{date.weekday}</span>
        <strong>{date.day}</strong>
        <small>{date.month}</small>
      </time>
      <div className={styles.entryBody}>
        <div className={styles.entryTopline}>
          <div className={styles.entryMeta}>
            <span><JournalIcon name="weather" />{entry.weather || 'Météo non renseignée'}</span>
            <span><JournalIcon name="users" />{entry.workerCount} présent{entry.workerCount > 1 ? 's' : ''}</span>
            <span>{entry.author ? `Par ${entry.author}` : 'Auteur non renseigné'}</span>
          </div>
          {entry.incidents ? <span className={styles.incidentFlag}><JournalIcon name="alert" />Incident consigné</span> : null}
        </div>
        <h3>{entry.workDone || 'Travaux non renseignés'}</h3>
        {hasDetails ? (
          <details className={styles.entryDetails}>
            <summary>Voir le compte rendu complet <JournalIcon name="chevron" /></summary>
            <dl>
              {entry.materials ? <div><dt><JournalIcon name="materials" />Matériaux</dt><dd>{entry.materials}</dd></div> : null}
              {entry.visitors ? <div><dt><JournalIcon name="visitors" />Visiteurs</dt><dd>{entry.visitors}</dd></div> : null}
              {entry.observations ? <div><dt><JournalIcon name="note" />Observations</dt><dd>{entry.observations}</dd></div> : null}
              {entry.incidents ? <div data-alert="true"><dt><JournalIcon name="alert" />Incidents</dt><dd>{entry.incidents}</dd></div> : null}
            </dl>
          </details>
        ) : <p className={styles.noDetails}>Aucun complément pour cette journée.</p>}
      </div>
      {(canCreate || canDelete) ? (
        <div className={styles.entryActions}>
          {canCreate ? <button type="button" onClick={() => onEdit(entry)}><JournalIcon name="pencil" />Modifier</button> : null}
          {canDelete ? <button className={styles.deleteAction} type="button" onClick={() => onDelete(entry)}><JournalIcon name="trash" />Supprimer</button> : null}
        </div>
      ) : null}
    </article>
  );
}

export default function JournalWorkspace({
  entries,
  timeEntries,
  projectName,
  today,
  selectedProjectId,
  canCreate,
  canDelete,
  canExport,
  onCreate,
  onUpdate,
  onDelete,
  onExport,
}: JournalWorkspaceProps) {
  const idPrefix = useId().replace(/:/g, '');
  const [filter, setFilter] = useState<JournalFilter>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [showEditor, setShowEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const [draft, setDraft] = useState<JournalDraft>(() => emptyDraft(today));
  const initialDraft = useRef(draftSignature(emptyDraft(today)));
  const editorTitle = useRef<HTMLHeadingElement | null>(null);
  const model = useMemo(() => buildJournalWorkspaceModel(entries, today), [entries, today]);
  const visibleEntries = useMemo(
    () => filterJournalEntries(model.entries, filter, deferredQuery, today),
    [deferredQuery, filter, model.entries, today],
  );
  const todayAttendance = useMemo(() => countAttendanceForDate(timeEntries, today), [timeEntries, today]);
  const draftAttendance = useMemo(() => countAttendanceForDate(timeEntries, draft.date), [draft.date, timeEntries]);
  const draftChanged = draftSignature(draft) !== initialDraft.current;

  function focusEditor() {
    window.requestAnimationFrame(() => {
      editorTitle.current?.focus({ preventScroll: true });
      editorTitle.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }

  function beginDraft(next: JournalDraft) {
    if (showEditor && draftChanged && !window.confirm('Remplacer la saisie en cours sans l’enregistrer ?')) return;
    initialDraft.current = draftSignature(next);
    setDraft(next);
    setSubmissionError('');
    setShowEditor(true);
    focusEditor();
  }

  function openTodayEditor() {
    if (showEditor) {
      focusEditor();
      return;
    }
    beginDraft(model.todayEntry ? draftFromEntry(model.todayEntry) : emptyDraft(today));
  }

  function closeEditor(force = false) {
    if (!force && draftChanged && !window.confirm('Fermer sans enregistrer les modifications ?')) return;
    setSubmissionError('');
    setShowEditor(false);
  }

  async function submitEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate || !draft.workDone.trim() || busy) return;
    const duplicate = !draft.id && model.entries.some(entry => entry.date === draft.date);
    if (duplicate && !window.confirm(`Une entrée existe déjà pour le ${formatJournalDate(draft.date)}. Créer quand même ?`)) return;
    setBusy(true);
    setSubmissionError('');
    try {
      const payload = {
        ...draft,
        workerCount: Number(draft.workerCount || draftAttendance || 0),
        chantier_id: selectedProjectId !== 'all' ? selectedProjectId : null,
      };
      const current = draft.id ? model.entries.find(entry => entry.id === draft.id) : null;
      const saved = current ? await onUpdate(current.source, payload) : await onCreate(payload);
      if (saved) {
        const next = emptyDraft(today);
        initialDraft.current = draftSignature(next);
        setDraft(next);
        closeEditor(true);
      } else {
        setSubmissionError('L’enregistrement n’a pas abouti. Vérifiez le message d’erreur affiché puis réessayez.');
      }
    } catch {
      setSubmissionError('L’enregistrement a échoué. Vérifiez votre connexion puis réessayez.');
    } finally {
      setBusy(false);
    }
  }

  function resetFilters() {
    setQuery('');
    setFilter('all');
  }

  const todayStatus = model.todayEntry ? 'Renseigné' : canCreate ? 'À saisir' : 'Non renseigné';
  const resultLabel = `${visibleEntries.length} entrée${visibleEntries.length > 1 ? 's' : ''} affichée${visibleEntries.length > 1 ? 's' : ''}`;

  return (
    <div className={styles.workspace} data-testid="web-journal-workspace">
      <section className={styles.overview} aria-labelledby="journal-overview-title">
        <div className={styles.overviewIntro}>
          <span className={styles.overviewIcon}><JournalIcon name="journal" /></span>
          <div className={styles.overviewCopy}>
            <p className={styles.eyebrow}>Main courante chantier</p>
            <h2 id="journal-overview-title">Le chantier, jour après jour</h2>
            <p>Consignez les conditions, les équipes, les travaux et les faits marquants dans un registre commun.</p>
            <span className={styles.projectScope}>{projectName}</span>
            {(canCreate || canExport) ? (
              <div className={styles.overviewActions}>
                {canCreate ? (
                  <button className={styles.primaryAction} type="button" onClick={openTodayEditor}>
                    <JournalIcon name={model.todayEntry ? 'pencil' : 'plus'} />
                    {showEditor ? 'Revenir à la saisie' : model.todayEntry ? 'Modifier le journal du jour' : 'Journal du jour'}
                  </button>
                ) : null}
                {canExport ? <button className={styles.secondaryAction} type="button" onClick={onExport}><JournalIcon name="export" />Exporter</button> : null}
              </div>
            ) : null}
          </div>
        </div>
        <dl className={styles.overviewMetrics}>
          <div data-today={model.todayEntry ? 'complete' : 'pending'}>
            <dt>Aujourd’hui</dt><dd>{todayStatus}</dd><small>{todayAttendance} personne{todayAttendance > 1 ? 's' : ''} pointée{todayAttendance > 1 ? 's' : ''}</small>
          </div>
          <div><dt>Entrées</dt><dd>{model.entries.length}</dd><small>{model.monthEntries} ce mois</small></div>
          <div><dt>Effectif cumulé</dt><dd>{model.totalWorkers}</dd><small>personnes consignées</small></div>
          <div data-alert={model.incidentDays > 0 ? 'true' : 'false'}><dt>Incidents</dt><dd>{model.incidentDays}</dd><small>jour{model.incidentDays > 1 ? 's' : ''} concerné{model.incidentDays > 1 ? 's' : ''}</small></div>
        </dl>
      </section>

      {canCreate && showEditor ? (
        <section className={styles.editor} aria-labelledby="journal-editor-title">
          <header className={styles.editorHeader}>
            <div>
              <p className={styles.eyebrow}>{draft.id ? 'Modification' : 'Nouvelle entrée'}</p>
              <h2 id="journal-editor-title" ref={editorTitle} tabIndex={-1}>Feuille du {formatJournalDate(draft.date, true)}</h2>
              <p>Les travaux réalisés sont obligatoires. Les autres informations complètent la trace du chantier.</p>
            </div>
            <button className={styles.closeEditor} type="button" onClick={() => closeEditor()}><JournalIcon name="close" />Fermer</button>
          </header>
          <form className={styles.editorForm} onSubmit={submitEntry} aria-busy={busy}>
            <fieldset>
              <legend><JournalIcon name="weather" /><span><strong>Conditions du jour</strong><small>Date, météo et présence sur site</small></span></legend>
              <div className={styles.conditionGrid}>
                <label htmlFor={`${idPrefix}-date`}><span>Date</span><input id={`${idPrefix}-date`} type="date" value={draft.date} onChange={event => setDraft(previous => ({ ...previous, date: event.target.value }))} required /></label>
                <label htmlFor={`${idPrefix}-weather`}><span>Météo</span><input id={`${idPrefix}-weather`} value={draft.weather} onChange={event => setDraft(previous => ({ ...previous, weather: event.target.value }))} placeholder="Soleil, pluie, vent…" autoComplete="off" /></label>
                <label htmlFor={`${idPrefix}-workers`}><span>Effectif</span><input id={`${idPrefix}-workers`} type="number" inputMode="numeric" min={0} value={draft.workerCount} onChange={event => setDraft(previous => ({ ...previous, workerCount: event.target.value }))} placeholder={draftAttendance ? String(draftAttendance) : '0'} aria-describedby={`${idPrefix}-workers-help`} /><small id={`${idPrefix}-workers-help`}>{draftAttendance ? `${draftAttendance} personne${draftAttendance > 1 ? 's' : ''} détectée${draftAttendance > 1 ? 's' : ''} dans le pointage` : 'Repris automatiquement du pointage si le champ reste vide'}</small></label>
              </div>
            </fieldset>

            <fieldset>
              <legend><JournalIcon name="journal" /><span><strong>Production</strong><small>Ce qui a été exécuté et livré</small></span></legend>
              <div className={styles.productionGrid}>
                <label className={styles.workDoneField} htmlFor={`${idPrefix}-work`}><span>Travaux réalisés <em>obligatoire</em></span><textarea id={`${idPrefix}-work`} rows={5} value={draft.workDone} onChange={event => setDraft(previous => ({ ...previous, workDone: event.target.value }))} placeholder="Décrivez les zones, lots et tâches réalisés aujourd’hui…" required /></label>
                <label htmlFor={`${idPrefix}-materials`}><span>Matériaux et livraisons</span><textarea id={`${idPrefix}-materials`} rows={5} value={draft.materials} onChange={event => setDraft(previous => ({ ...previous, materials: event.target.value }))} placeholder="Réceptions, consommations, manquants…" /></label>
              </div>
            </fieldset>

            <fieldset>
              <legend><JournalIcon name="note" /><span><strong>Vie du chantier</strong><small>Événements utiles au suivi et à la traçabilité</small></span></legend>
              <div className={styles.siteLifeGrid}>
                <label htmlFor={`${idPrefix}-visitors`}><span>Visiteurs</span><textarea id={`${idPrefix}-visitors`} rows={3} value={draft.visitors} onChange={event => setDraft(previous => ({ ...previous, visitors: event.target.value }))} placeholder="Noms, sociétés, objet de la visite…" /></label>
                <label htmlFor={`${idPrefix}-incidents`}><span>Incidents</span><textarea id={`${idPrefix}-incidents`} rows={3} value={draft.incidents} onChange={event => setDraft(previous => ({ ...previous, incidents: event.target.value }))} placeholder="Sécurité, arrêt, retard, anomalie…" /><small>Laissez vide si aucun incident n’est à signaler.</small></label>
                <label htmlFor={`${idPrefix}-observations`}><span>Observations</span><textarea id={`${idPrefix}-observations`} rows={3} value={draft.observations} onChange={event => setDraft(previous => ({ ...previous, observations: event.target.value }))} placeholder="Décisions, points de vigilance, suite à donner…" /></label>
              </div>
            </fieldset>

            <div className={styles.formFooter}>
              <div className={styles.formStatus} aria-live="polite">
                {submissionError ? <p role="alert">{submissionError}</p> : <p>{draftChanged ? 'Modifications non enregistrées' : 'Aucune modification en attente'}</p>}
              </div>
              <div className={styles.formActions}>
                <button className={styles.cancelAction} type="button" onClick={() => closeEditor()} disabled={busy}>Annuler</button>
                <button className={styles.saveAction} type="submit" disabled={busy || !draft.workDone.trim()}>
                  <JournalIcon name="check" />{busy ? 'Enregistrement…' : draft.id ? 'Enregistrer les modifications' : 'Enregistrer le journal'}
                </button>
              </div>
            </div>
          </form>
        </section>
      ) : null}

      <section className={styles.register} aria-labelledby="journal-register-title">
        <header className={styles.registerHeader}>
          <div>
            <p className={styles.eyebrow}>Registre quotidien</p>
            <h2 id="journal-register-title">Entrées journal</h2>
            <p>Recherchez un travail, un intervenant ou un événement dans l’historique partagé.</p>
          </div>
          <span className={styles.resultCount} role="status" aria-live="polite">{resultLabel}</span>
        </header>

        {model.entries.length ? (
          <div className={styles.registerToolbar}>
            <label className={styles.searchField} htmlFor={`${idPrefix}-search`}>
              <span>Rechercher dans le journal</span>
              <span className={styles.searchControl}><JournalIcon name="search" /><input id={`${idPrefix}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Travaux, météo, auteur…" /></span>
            </label>
            <div className={styles.filters} role="toolbar" aria-label="Filtrer les entrées du journal">
              {FILTERS.map(item => (
                <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
                  {item.label}<span>{model.counts[item.key]}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {visibleEntries.length ? (
          <div className={styles.entryList}>
            {visibleEntries.map(entry => (
              <JournalEntryRecord
                key={entry.id}
                entry={entry}
                canCreate={canCreate}
                canDelete={canDelete}
                onEdit={item => beginDraft(draftFromEntry(item))}
                onDelete={item => onDelete(item.source)}
              />
            ))}
          </div>
        ) : model.entries.length ? (
          <div className={styles.emptyState}>
            <span><JournalIcon name="search" /></span>
            <h3>Aucune entrée ne correspond</h3>
            <p>Élargissez la recherche ou revenez à l’ensemble du registre.</p>
            <button type="button" onClick={resetFilters}>Réinitialiser les filtres</button>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <span><JournalIcon name="journal" /></span>
            <h3>Le registre est prêt pour sa première entrée</h3>
            <p>Commencez par consigner les travaux et les conditions de la journée.</p>
            {canCreate && !showEditor ? <button type="button" onClick={() => beginDraft(emptyDraft(today))}><JournalIcon name="plus" />Créer le journal du jour</button> : null}
          </div>
        )}
      </section>
    </div>
  );
}
