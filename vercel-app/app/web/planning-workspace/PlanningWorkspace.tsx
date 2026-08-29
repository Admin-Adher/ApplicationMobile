'use client';

import { useDeferredValue, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { WorkspaceIcon, WorkspaceSearch } from '../plan-reserve-workspace/WorkspaceChrome';
import styles from './PlanningWorkspace.module.css';
import {
  PLANNING_SCHEDULE_BATCH_SIZE,
  buildPlanningSchedule,
  filterPlanningSchedule,
  filterPlanningTasks,
  getPlanningWeekRange,
  groupPlanningSchedule,
  groupPlanningTasks,
  isPlanningTaskLate,
  type PlanningScheduleFilter,
  type PlanningTaskMode,
} from './planning-model';

type PlanningWorkspaceProps = {
  tasks: any[];
  visites: any[];
  reserves: any[];
  companies: any[];
  editable: boolean;
  canCreate: boolean;
  locale: string;
  emptyTaskLabel: string;
  reserveStatusLabels: Record<string, string>;
  visitStatusLabels: Record<string, string>;
  onUpdateTask?: (task: any, patch: Record<string, unknown>) => void | Promise<void>;
  onCreateTask?: (draft: Record<string, string>) => boolean | Promise<boolean>;
  onOpenReserve?: (reserveId: string) => void;
  onOpenVisites?: () => void;
};

const TASK_MODES: Array<{ id: PlanningTaskMode; label: string }> = [
  { id: 'week', label: 'Cette semaine' },
  { id: 'company', label: 'Par entreprise' },
  { id: 'late', label: 'En retard' },
];

const SCHEDULE_FILTERS: Array<{ id: PlanningScheduleFilter; label: string }> = [
  { id: 'all', label: 'Tout' },
  { id: 'late', label: 'En retard' },
  { id: 'reserve', label: 'Réserves' },
  { id: 'visit', label: 'Visites' },
];

function formatTaskDate(value: string | null | undefined, locale: string) {
  if (!value) return 'Sans échéance';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return 'Sans échéance';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function countLabel(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export default function PlanningWorkspace({
  tasks,
  visites,
  reserves,
  companies,
  editable,
  canCreate,
  locale,
  emptyTaskLabel,
  reserveStatusLabels,
  visitStatusLabels,
  onUpdateTask,
  onCreateTask,
  onOpenReserve,
  onOpenVisites,
}: PlanningWorkspaceProps) {
  const taskHeadingId = useId();
  const agendaHeadingId = useId();
  const [taskMode, setTaskMode] = useState<PlanningTaskMode>('week');
  const [scheduleFilter, setScheduleFilter] = useState<PlanningScheduleFilter>('all');
  const [scheduleQuery, setScheduleQuery] = useState('');
  const deferredScheduleQuery = useDeferredValue(scheduleQuery);
  const [visibleScheduleCount, setVisibleScheduleCount] = useState(PLANNING_SCHEDULE_BATCH_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ title: '', deadline: '', company: '', assignee: '' });
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => new Date(), []);
  const weekRange = useMemo(() => getPlanningWeekRange(now, locale), [locale, now]);

  const scheduleEntries = useMemo(
    () => buildPlanningSchedule(visites, reserves, now),
    [now, reserves, visites],
  );
  const filteredSchedule = useMemo(
    () => filterPlanningSchedule(scheduleEntries, scheduleFilter, deferredScheduleQuery),
    [deferredScheduleQuery, scheduleEntries, scheduleFilter],
  );
  const visibleSchedule = useMemo(
    () => filteredSchedule.slice(0, visibleScheduleCount),
    [filteredSchedule, visibleScheduleCount],
  );
  const scheduleGroups = useMemo(
    () => groupPlanningSchedule(visibleSchedule, locale, now),
    [locale, now, visibleSchedule],
  );

  const visibleTasks = useMemo(() => filterPlanningTasks(tasks, taskMode, now), [now, taskMode, tasks]);
  const taskGroups = useMemo(
    () => groupPlanningTasks(visibleTasks, companies, taskMode),
    [companies, taskMode, visibleTasks],
  );
  const weekTasksCount = useMemo(() => filterPlanningTasks(tasks, 'week', now).length, [now, tasks]);
  const lateTasksCount = useMemo(() => tasks.filter(task => isPlanningTaskLate(task, now)).length, [now, tasks]);
  const activeTasksCount = tasks.filter(task => !['done', 'completed', 'closed'].includes(String(task.status ?? ''))).length;
  const visitCount = scheduleEntries.filter(entry => entry.kind === 'visit').length;
  const reserveCount = scheduleEntries.filter(entry => entry.kind === 'reserve').length;
  const lateScheduleCount = scheduleEntries.filter(entry => entry.isLate).length;
  const attentionCount = lateTasksCount + lateScheduleCount;

  const taskModeCounts: Record<PlanningTaskMode, number> = {
    week: weekTasksCount,
    company: tasks.length,
    late: lateTasksCount,
  };
  const scheduleFilterCounts: Record<PlanningScheduleFilter, number> = {
    all: scheduleEntries.length,
    late: lateScheduleCount,
    reserve: reserveCount,
    visit: visitCount,
  };

  useEffect(() => {
    setVisibleScheduleCount(PLANNING_SCHEDULE_BATCH_SIZE);
  }, [deferredScheduleQuery, scheduleEntries.length, scheduleFilter]);

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await onCreateTask?.(draft);
      if (saved) {
        setDraft({ title: '', deadline: '', company: '', assignee: '' });
        setShowForm(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.planningRoot}>
      <section className={styles.summaryStrip} aria-label="Repères du planning">
        <div className={styles.weekContext}>
          <span className={styles.weekIcon}><WorkspaceIcon name="calendar" size={20} /></span>
          <div>
            <span>Semaine en cours</span>
            <strong>{weekRange.label}</strong>
            <small>{attentionCount ? 'Des actions nécessitent votre attention.' : 'Le planning est à jour.'}</small>
          </div>
        </div>
        <dl className={styles.summaryMetrics}>
          <div data-tone={attentionCount ? 'danger' : 'neutral'}>
            <dt>À traiter</dt>
            <dd>{attentionCount}</dd>
            <small>retards détectés</small>
          </div>
          <div>
            <dt>Tâches actives</dt>
            <dd>{activeTasksCount}</dd>
            <small>actions d’équipe</small>
          </div>
          <div data-tone="green">
            <dt>Visites à venir</dt>
            <dd>{visitCount}</dd>
            <small>rendez-vous chantier</small>
          </div>
          <div data-tone="amber">
            <dt>Échéances réserves</dt>
            <dd>{reserveCount}</dd>
            <small>réserves ouvertes</small>
          </div>
        </dl>
      </section>

      <section className={styles.workspace} aria-labelledby="planning-workspace-title">
        <header className={styles.workspaceHeader}>
          <div>
            <span className={styles.eyebrow}>Planification chantier</span>
            <h2 id="planning-workspace-title">Planning opérationnel</h2>
            <p>Priorisez les tâches d’équipe et parcourez les visites ou échéances dans un agenda unique.</p>
          </div>
          {canCreate ? (
            <button
              type="button"
              className={styles.primaryAction}
              aria-expanded={showForm}
              aria-controls="planning-task-composer"
              onClick={() => setShowForm(value => !value)}
            >
              <WorkspaceIcon name={showForm ? 'close' : 'plus'} size={19} />
              {showForm ? 'Fermer le formulaire' : 'Nouvelle tâche'}
            </button>
          ) : null}
        </header>

        {showForm && canCreate ? (
          <form id="planning-task-composer" className={styles.taskComposer} onSubmit={submitTask} aria-busy={busy}>
            <div className={styles.composerIntro}>
              <span><WorkspaceIcon name="edit" size={20} /></span>
              <div>
                <strong>Préparer une tâche</strong>
                <small>Ajoutez le responsable et l’échéance pour la rendre immédiatement actionnable.</small>
              </div>
            </div>
            <div className={styles.composerGrid}>
              <label className={styles.composerTitle}>
                <span>Titre de la tâche</span>
                <input value={draft.title} onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} required autoFocus />
              </label>
              <label>
                <span>Échéance</span>
                <input type="date" value={draft.deadline} onChange={event => setDraft(previous => ({ ...previous, deadline: event.target.value }))} />
              </label>
              <label>
                <span>Entreprise</span>
                <select value={draft.company} onChange={event => setDraft(previous => ({ ...previous, company: event.target.value }))}>
                  <option value="">Sans entreprise</option>
                  {companies.map(company => <option key={company.id} value={company.name}>{company.name}</option>)}
                </select>
              </label>
              <label>
                <span>Assigné</span>
                <input value={draft.assignee} onChange={event => setDraft(previous => ({ ...previous, assignee: event.target.value }))} />
              </label>
            </div>
            <div className={styles.composerActions}>
              <button type="button" onClick={() => setShowForm(false)}>Annuler</button>
              <button type="submit" disabled={busy}>{busy ? 'Création…' : 'Créer la tâche'}</button>
            </div>
          </form>
        ) : null}

        <div className={styles.planningColumns} data-tasks-empty={visibleTasks.length === 0}>
          <section className={styles.taskLane} aria-labelledby={taskHeadingId}>
            <div className={styles.laneHeader}>
              <div className={styles.laneTitle}>
                <span><WorkspaceIcon name="check" size={19} /></span>
                <div>
                  <h3 id={taskHeadingId}>Tâches d’équipe</h3>
                  <p>{countLabel(visibleTasks.length, 'tâche affichée', 'tâches affichées')}</p>
                </div>
              </div>
              <div className={styles.taskModes} role="toolbar" aria-label="Afficher les tâches">
                {TASK_MODES.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={taskMode === option.id}
                    onClick={() => setTaskMode(option.id)}
                  >
                    <span>{option.label}</span>
                    <strong>{taskModeCounts[option.id]}</strong>
                  </button>
                ))}
              </div>
            </div>

            {visibleTasks.length ? (
              <div className={styles.taskGroups}>
                {taskGroups.map(([group, groupTasks]) => (
                  <section key={group} className={styles.taskGroup}>
                    {taskMode === 'company' ? <h4>{group}<span>{groupTasks.length}</span></h4> : null}
                    <div className={styles.taskList}>
                      {groupTasks.map(task => {
                        const company = companies.find(item => item.id === task.company || item.name === task.company);
                        const progress = Math.max(0, Math.min(100, Number(task.progress ?? 0)));
                        const late = isPlanningTaskLate(task, now);
                        return (
                          <article key={task.id} className={styles.taskCard} data-late={late}>
                            <div className={styles.taskCardHeader}>
                              <div>
                                <span className={styles.taskState}>{late ? 'En retard' : task.status === 'done' ? 'Terminée' : 'À suivre'}</span>
                                <strong>{task.title ?? 'Tâche'}</strong>
                              </div>
                              <em>{progress}%</em>
                            </div>
                            <dl className={styles.taskMeta}>
                              <div><dt>Entreprise</dt><dd>{company?.name ?? task.company ?? 'Sans entreprise'}</dd></div>
                              <div><dt>Responsable</dt><dd>{task.assignee || 'Non assigné'}</dd></div>
                              <div><dt>Échéance</dt><dd>{formatTaskDate(task.deadline, locale)}</dd></div>
                            </dl>
                            <div className={styles.taskProgress} aria-label={`Progression ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
                            {editable ? (
                              <div className={styles.taskActions} aria-label={`Mettre à jour ${task.title ?? 'la tâche'}`}>
                                <button type="button" disabled={task.status === 'todo'} onClick={() => onUpdateTask?.(task, { status: 'todo', progress: Math.min(progress, 10) })}>À faire</button>
                                <button type="button" disabled={task.status === 'in_progress'} onClick={() => onUpdateTask?.(task, { status: 'in_progress', progress: Math.max(progress, 25) })}>En cours</button>
                                <button type="button" disabled={task.status === 'done'} onClick={() => onUpdateTask?.(task, { status: 'done', progress: 100 })}>Terminée</button>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <span><WorkspaceIcon name={taskMode === 'late' ? 'check' : 'calendar'} size={24} /></span>
                <div>
                  <strong>{taskMode === 'late' ? 'Aucune tâche en retard' : emptyTaskLabel}</strong>
                  <p>{tasks.length ? 'Changez de filtre pour retrouver les autres tâches.' : 'Créez la première tâche pour organiser le travail de l’équipe.'}</p>
                </div>
                {canCreate && !tasks.length ? <button type="button" onClick={() => setShowForm(true)}>Créer une tâche</button> : null}
              </div>
            )}
          </section>

          <section className={styles.agendaLane} aria-labelledby={agendaHeadingId}>
            <div className={styles.agendaHeader}>
              <div className={styles.laneTitle}>
                <span><WorkspaceIcon name="calendar" size={19} /></span>
                <div>
                  <h3 id={agendaHeadingId}>Agenda des échéances</h3>
                  <p>Visites et réserves regroupées par jour.</p>
                </div>
              </div>
              <div className={styles.agendaSearch}>
                <WorkspaceSearch
                  value={scheduleQuery}
                  placeholder="Rechercher une échéance"
                  clearLabel="Effacer la recherche d’échéance"
                  onChange={setScheduleQuery}
                />
              </div>
            </div>

            <div className={styles.agendaToolbar}>
              <div className={styles.scheduleFilters} role="toolbar" aria-label="Filtrer l’agenda">
                {SCHEDULE_FILTERS.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={scheduleFilter === option.id}
                    onClick={() => setScheduleFilter(option.id)}
                  >
                    <span>{option.label}</span>
                    <strong>{scheduleFilterCounts[option.id]}</strong>
                  </button>
                ))}
              </div>
              <dl className={styles.resultCount} aria-live="polite">
                <div><dt>Résultats</dt><dd>{filteredSchedule.length}</dd></div>
                <div><dt>Affichés</dt><dd>{Math.min(visibleSchedule.length, filteredSchedule.length)}</dd></div>
              </dl>
            </div>

            {scheduleGroups.length ? (
              <div className={styles.agendaGroups}>
                {scheduleGroups.map(group => (
                  <section key={group.key} className={styles.agendaGroup}>
                    <header>
                      <div>
                        <strong>{group.label}</strong>
                        <span data-tone={group.relativeLabel === 'En retard' ? 'late' : group.relativeLabel === 'Aujourd’hui' ? 'today' : 'future'}>{group.relativeLabel}</span>
                      </div>
                      <small>{countLabel(group.entries.length, 'élément', 'éléments')}</small>
                    </header>
                    <ul className={styles.agendaItems}>
                      {group.entries.map(entry => {
                        const statusLabel = entry.kind === 'reserve'
                          ? reserveStatusLabels[entry.status] ?? entry.status
                          : visitStatusLabels[entry.status] ?? entry.status;
                        return (
                          <li key={entry.id}>
                            <button
                              type="button"
                              className={styles.agendaItem}
                              data-kind={entry.kind}
                              data-late={entry.isLate}
                              onClick={() => entry.kind === 'reserve' ? onOpenReserve?.(entry.source.id) : onOpenVisites?.()}
                            >
                              <span className={styles.agendaItemIcon}><WorkspaceIcon name={entry.kind === 'reserve' ? 'warning' : 'calendar'} size={18} /></span>
                              <span className={styles.agendaItemContent}>
                                <span className={styles.agendaItemType}>{entry.kind === 'reserve' ? 'Réserve' : 'Visite chantier'}</span>
                                <strong>{entry.title}</strong>
                                <small>{entry.meta}</small>
                              </span>
                              <span className={styles.agendaItemStatus}>{statusLabel || (entry.isLate ? 'En retard' : 'À venir')}</span>
                              <span className={styles.agendaItemChevron}><WorkspaceIcon name="chevron" size={17} /></span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <span><WorkspaceIcon name="search" size={24} /></span>
                <div>
                  <strong>Aucune échéance trouvée</strong>
                  <p>Modifiez la recherche ou choisissez un autre filtre.</p>
                </div>
              </div>
            )}

            {visibleScheduleCount < filteredSchedule.length ? (
              <button
                type="button"
                className={styles.showMore}
                onClick={() => setVisibleScheduleCount(count => count + PLANNING_SCHEDULE_BATCH_SIZE)}
              >
                Afficher {Math.min(PLANNING_SCHEDULE_BATCH_SIZE, filteredSchedule.length - visibleScheduleCount)} échéances de plus
                <span>{visibleScheduleCount} / {filteredSchedule.length}</span>
              </button>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  );
}
