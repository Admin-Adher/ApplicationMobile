'use client';

import { useDeferredValue, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { WorkspaceIcon, WorkspaceSearch } from '../plan-reserve-workspace/WorkspaceChrome';
import styles from './PlanningWorkspace.module.css';
import { fieldDateInput } from '@/lib/web-field-writes';
import PlanningGantt from './PlanningGantt';
import TextAssistControls from '../TextAssistControls';
import {
  PLANNING_SCHEDULE_BATCH_SIZE,
  buildPlanningSchedule,
  filterPlanningSchedule,
  filterPlanningCompany,
  parsePlanningDate,
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
  onUpdateTask?: (task: any, patch: Record<string, unknown>) => boolean | Promise<boolean>;
  commentUserId?: string;
  commentUserName?: string;
  onChangeTaskComment?: (task: any, id: string, action: 'edit' | 'delete') => Promise<void>;
  onAddTaskComment?: (task: any, content: string) => Promise<boolean>;
  onDeleteTask?: (task: any) => Promise<void>;
  onCreateTask?: (draft: Record<string, string>) => boolean | Promise<boolean>;
  onOpenReserve?: (reserveId: string) => void;
  onOpenVisit?: (visitId: string) => void;
  initialTaskId?: string;
  initialCompanyId?: string;
  correctiveReserve?: { id: string; title: string; description?: string; deadline?: string; company?: string };
  onCloseCorrectiveTask?: () => void;
};

const TASK_MODES: Array<{ id: PlanningTaskMode; label: string }> = [
  { id: 'week', label: 'Cette semaine' },
  { id: 'company', label: 'Par entreprise' },
  { id: 'priority', label: 'Par priorité' },
  { id: 'late', label: 'En retard' },
];

const SCHEDULE_FILTERS: Array<{ id: PlanningScheduleFilter; label: string }> = [
  { id: 'all', label: 'Tout' },
  { id: 'late', label: 'En retard' },
  { id: 'reserve', label: 'Réserves' },
  { id: 'visit', label: 'Visites' },
  { id: 'task', label: 'Tâches' },
];

const TASK_STATUS_LABELS: Record<string, string> = {
  todo: 'À faire', in_progress: 'En cours', delayed: 'En retard', done: 'Terminée',
  completed: 'Terminée', closed: 'Terminée',
};

function formatTaskDate(value: string | null | undefined, locale: string) {
  if (!value) return 'Sans échéance';
  const date = parsePlanningDate(value);
  if (!date) return 'Sans échéance';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function TaskEditForm({ task, companies, onSave, onClose }: {
  task: any;
  companies: any[];
  onSave: NonNullable<PlanningWorkspaceProps['onUpdateTask']>;
  onClose: () => void;
}) {
  const initial = {
    title: String(task.title ?? ''),
    description: String(task.description ?? ''),
    company: String(task.company ?? ''),
    assignee: String(task.assignee ?? ''),
    start_date: fieldDateInput(task.start_date),
    deadline: fieldDateInput(task.deadline),
    priority: String(task.priority ?? 'medium'),
    status: String(task.status ?? 'todo'),
    progress: Number(task.progress ?? 0),
  };
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const companyId = useId();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim() || busy) return;
    const patch = Object.fromEntries(Object.entries(draft)
      .filter(([key, value]) => initial[key as keyof typeof initial] !== value)
      .map(([key, value]) => [key, key === 'start_date' || key === 'deadline' ? value || null : typeof value === 'string' ? value.trim() : value]));
    setBusy(true);
    try {
      if (!Object.keys(patch).length || await onSave(task, patch)) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${styles.taskComposer} ${styles.taskEditor}`} aria-label="Modifier la tâche" onSubmit={save}>
      <div className={styles.composerGrid}>
        <div className={styles.composerTitle}><label><span>Titre de la tâche</span><input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} required autoFocus /></label>
              <TextAssistControls compact label="titre de la tâche" value={draft.title} onChange={title => setDraft(current => ({ ...current, title }))} context="description" disabled={busy} /></div>
        <div className={styles.composerTitle}><label><span>Description</span><textarea rows={3} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
              <TextAssistControls compact label="description de la tâche" value={draft.description} onChange={description => setDraft(current => ({ ...current, description }))} context="description" disabled={busy} /></div>
        <label><span>Début</span><input type="date" value={draft.start_date} onChange={event => setDraft({ ...draft, start_date: event.target.value })} /></label>
        <label><span>Échéance</span><input type="date" value={draft.deadline} onChange={event => setDraft({ ...draft, deadline: event.target.value })} /></label>
        <label><span>Entreprise</span><input list={companyId} value={draft.company} onChange={event => setDraft({ ...draft, company: event.target.value })} /><datalist id={companyId}>{companies.map(company => <option key={company.id} value={company.name} />)}</datalist></label>
        <label><span>Responsable</span><input value={draft.assignee} onChange={event => setDraft({ ...draft, assignee: event.target.value })} /></label>
        <label><span>Priorité</span><select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value })}>
          <option value="low">Basse</option><option value="medium">Normale</option><option value="high">Haute</option><option value="critical">Critique</option>
        </select></label>
        <label><span>Statut</span><select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value, progress: event.target.value === 'done' ? 100 : draft.progress })}>
          <option value="todo">À faire</option><option value="in_progress">En cours</option><option value="delayed">En retard</option><option value="done">Terminée</option>
        </select></label>
        <label><span>Avancement (%)</span><input type="number" min={0} max={100} required value={draft.progress} onChange={event => setDraft({ ...draft, progress: event.target.valueAsNumber })} /></label>
      </div>
      <div className={styles.taskActions}>
        <button type="button" onClick={onClose} disabled={busy}>Annuler</button>
        <button type="submit" disabled={busy || !draft.title.trim()}>Enregistrer la tâche</button>
      </div>
    </form>
  );
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
  onAddTaskComment,
  onChangeTaskComment,
  commentUserId,
  commentUserName,
  onDeleteTask,
  onCreateTask,
  onOpenReserve,
  onOpenVisit,
  initialTaskId = '',
  initialCompanyId = '',
  correctiveReserve,
  onCloseCorrectiveTask,
}: PlanningWorkspaceProps) {
  const taskHeadingId = useId();
  const agendaHeadingId = useId();
  const [taskMode, setTaskMode] = useState<PlanningTaskMode>(() => {
    if (initialCompanyId) return 'company';
    const target = initialTaskId ? tasks.find(task => String(task.id) === initialTaskId) : undefined;
    if (!target) return 'week';
    return isPlanningTaskLate(target, new Date()) ? 'late' : 'company';
  });
  const [companyFilter, setCompanyFilter] = useState(initialCompanyId);
  const [scheduleFilter, setScheduleFilter] = useState<PlanningScheduleFilter>('all');
  const [scheduleQuery, setScheduleQuery] = useState('');
  const deferredScheduleQuery = useDeferredValue(scheduleQuery);
  const [visibleScheduleCount, setVisibleScheduleCount] = useState(PLANNING_SCHEDULE_BATCH_SIZE);
  const [showForm, setShowForm] = useState(Boolean(correctiveReserve));
  const [showGantt, setShowGantt] = useState(false);
  const [detailId, setDetailId] = useState(initialTaskId);
  const [taskComment, setTaskComment] = useState('');
  const [editingTask, setEditingTask] = useState<any>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const emptyDraft = { title: '', description: '', start_date: '', deadline: '', company: '', assignee: '', priority: 'medium', status: 'todo', progress: '0' };
  const [draft, setDraft] = useState(() => correctiveReserve ? {
    ...emptyDraft, title: 'Lever : ' + correctiveReserve.title, description: correctiveReserve.description ?? '',
    deadline: fieldDateInput(correctiveReserve.deadline), company: correctiveReserve.company ?? '',
  } : emptyDraft);

  function closeComposer() {
    setShowForm(false);
    if (correctiveReserve) {
      setDraft(emptyDraft);
      onCloseCorrectiveTask?.();
    }
  }
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => new Date(), []);
  const weekRange = useMemo(() => getPlanningWeekRange(now, locale), [locale, now]);

  const companyTasks = useMemo(
    () => filterPlanningCompany(tasks, companies.find(company => company.id === companyFilter)),
    [companies, companyFilter, tasks],
  );
  const scheduleEntries = useMemo(() => {
    const companyNames = new Map(companies.map(company => [company.id, company.name]));
    return buildPlanningSchedule(visites, reserves, now, companyTasks.map(task => ({
      ...task, company: companyNames.get(task.company) ?? task.company,
    })));
  }, [companies, companyTasks, now, reserves, visites]);
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

  const reserveLinks = useMemo(() => ({
    byId: new Map(reserves.map(reserve => [String(reserve.id), reserve])),
    byTask: new Map(reserves.filter(reserve => reserve.linked_task_id).map(reserve => [String(reserve.linked_task_id), reserve])),
  }), [reserves]);
  const visibleTasks = useMemo(() => filterPlanningTasks(companyTasks, taskMode, now), [companyTasks, now, taskMode]);
  const taskGroups = useMemo(
    () => groupPlanningTasks(visibleTasks, companies, taskMode),
    [companies, taskMode, visibleTasks],
  );
  const weekTasksCount = useMemo(() => filterPlanningTasks(companyTasks, 'week', now).length, [companyTasks, now]);
  const lateTasksCount = useMemo(() => companyTasks.filter(task => isPlanningTaskLate(task, now)).length, [companyTasks, now]);
  const activeTasksCount = companyTasks.filter(task => !['done', 'completed', 'closed'].includes(String(task.status ?? ''))).length;
  const visitCount = scheduleEntries.filter(entry => entry.kind === 'visit').length;
  const reserveCount = scheduleEntries.filter(entry => entry.kind === 'reserve').length;
  const lateScheduleCount = scheduleEntries.filter(entry => entry.isLate).length;
  const attentionCount = lateTasksCount + scheduleEntries.filter(entry => entry.kind !== 'task' && entry.isLate).length;

  const taskModeCounts: Record<PlanningTaskMode, number> = {
    week: weekTasksCount,
    company: companyTasks.length,
    priority: companyTasks.length,
    late: lateTasksCount,
  };
  const scheduleFilterCounts: Record<PlanningScheduleFilter, number> = {
    all: scheduleEntries.length,
    late: lateScheduleCount,
    reserve: reserveCount,
    visit: visitCount,
    task: companyTasks.length,
  };

  useEffect(() => {
    setVisibleScheduleCount(PLANNING_SCHEDULE_BATCH_SIZE);
  }, [companyFilter, deferredScheduleQuery, scheduleEntries.length, scheduleFilter]);

  function openTask(id: string) {
    setTaskMode('company');
    setDetailId(id);
    setTaskComment('');
    requestAnimationFrame(() => {
      const card = document.getElementById('planning-task-' + id);
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: 'nearest' });
    });
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.title.trim()) return;
    setBusy(true);
    try {
      const saved = await onCreateTask?.(draft);
      if (saved) {
        onCloseCorrectiveTask?.();
        setDraft(emptyDraft);
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
              onClick={() => showForm ? closeComposer() : setShowForm(true)}
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
                <strong>{correctiveReserve ? 'Tâche corrective · ' + correctiveReserve.id : 'Préparer une tâche'}</strong>
                <small>Ajoutez le responsable et l’échéance pour la rendre immédiatement actionnable.</small>
              </div>
            </div>
            <div className={styles.composerGrid}>
              <div className={styles.composerTitle}><label>
                <span>Titre de la tâche</span>
                <input value={draft.title} onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} required autoFocus />
              </label>
              <TextAssistControls compact label="titre de la tâche" value={draft.title} onChange={title => setDraft(current => ({ ...current, title }))} context="description" disabled={busy} /></div>
              <div className={styles.composerTitle}><label>
                <span>Description</span>
                <textarea value={draft.description} onChange={event => setDraft(previous => ({ ...previous, description: event.target.value }))} />
              </label>
              <TextAssistControls compact label="description de la tâche" value={draft.description} onChange={description => setDraft(current => ({ ...current, description }))} context="description" disabled={busy} /></div>
              <label>
                <span>Début</span>
                <input type="date" value={draft.start_date} onChange={event => setDraft(previous => ({ ...previous, start_date: event.target.value }))} />
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
              <label><span>Priorité</span><select value={draft.priority} onChange={event => setDraft(previous => ({ ...previous, priority: event.target.value }))}>
                <option value="low">Basse</option><option value="medium">Normale</option><option value="high">Haute</option><option value="critical">Critique</option>
              </select></label>
              <label><span>Statut</span><select value={draft.status} onChange={event => setDraft(previous => ({ ...previous, status: event.target.value, progress: event.target.value === 'done' ? '100' : previous.progress }))}>
                <option value="todo">À faire</option><option value="in_progress">En cours</option><option value="delayed">En retard</option><option value="done">Terminée</option>
              </select></label>
              <label><span>Avancement (%)</span><input type="number" min={0} max={100} required value={draft.progress} onChange={event => setDraft(previous => ({ ...previous, progress: event.target.value }))} /></label>
            </div>
            <div className={styles.composerActions}>
              <button type="button" onClick={closeComposer}>Annuler</button>
              <button type="submit" disabled={busy}>{busy ? 'Création…' : 'Créer la tâche'}</button>
            </div>
          </form>
        ) : null}

        <div className={styles.taskActions}>
          <button type="button" aria-expanded={showGantt} onClick={() => setShowGantt(value => !value)}>Diagramme de Gantt</button>
        </div>
        {showGantt ? <PlanningGantt tasks={companyTasks} companies={companies} locale={locale} onOpenTask={openTask} /> : null}
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

            {companies.length > 0 && (
              <label className={styles.companyFilter}>
                <span>Filtrer les tâches par entreprise</span>
                <select value={companyFilter} onChange={event => { setCompanyFilter(event.target.value); setDetailId(''); }}>
                  <option value="">Toutes les entreprises</option>
                  {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
                </select>
              </label>
            )}

            {visibleTasks.length ? (
              <div className={styles.taskGroups}>
                {taskGroups.map(([group, groupTasks]) => (
                  <section key={group} className={styles.taskGroup}>
                    {taskMode === 'company' || taskMode === 'priority' ? <h4>{group}<span>{groupTasks.length}</span></h4> : null}
                    <div className={styles.taskList}>
                      {groupTasks.map(task => {
                        const company = companies.find(item => item.id === task.company || item.name === task.company);
                        const progress = Math.max(0, Math.min(100, Number(task.progress ?? 0)));
                        const late = isPlanningTaskLate(task, now);
                        const linkedReserve = reserveLinks.byId.get(String(task.reserve_id ?? '')) ?? reserveLinks.byTask.get(String(task.id));
                        return (
                          <article key={task.id} id={'planning-task-' + task.id} tabIndex={-1} className={styles.taskCard} data-late={late}>
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
                            <details open={detailId === String(task.id)} onToggle={event => {
                              if (event.currentTarget.open) { setDetailId(String(task.id)); setTaskComment(''); }
                              else setDetailId(current => current === String(task.id) ? '' : current);
                            }}>
                              <summary>Détails de la tâche</summary>
                              {editable && onUpdateTask ? (
                                editingTask?.id === task.id
                                  ? <TaskEditForm key={task.id} task={editingTask} companies={companies} onSave={onUpdateTask} onClose={() => setEditingTask(null)} />
                                  : <div className={styles.taskActions}><button type="button" onClick={() => setEditingTask(task)}>Modifier la tâche</button></div>
                              ) : null}
                              {linkedReserve && onOpenReserve ? (
                                <div className={styles.taskActions}>
                                  <button type="button" onClick={() => onOpenReserve(linkedReserve.id)}>
                                    Réserve liée · {linkedReserve.title ?? linkedReserve.id}
                                  </button>
                                </div>
                              ) : null}
                              <p>{task.description || 'Aucune description.'}</p>
                              {task.start_date ? <p>Début {formatTaskDate(task.start_date, locale)}</p> : null}
                              {Array.isArray(task.comments) ? task.comments.map((comment: any, index: number) => (
                                <div key={comment.id ?? index}>
                                  <p><strong>{comment.author}</strong> {comment.content ?? comment.text}</p>
                                  {editable && onChangeTaskComment && comment.id &&
                                    (comment.authorId ? comment.authorId === commentUserId : Boolean(commentUserName && comment.author === commentUserName)) && (
                                    <div>
                                      <button type="button" onClick={() => void onChangeTaskComment(task, comment.id, 'edit')}>Modifier le commentaire</button>
                                      <button type="button" onClick={() => void onChangeTaskComment(task, comment.id, 'delete')}>Supprimer le commentaire</button>
                                    </div>
                                  )}
                                </div>
                              )) : null}
                              {editable && onAddTaskComment ? (
                                <form className={styles.taskActions} onSubmit={async event => {
                                  event.preventDefault();
                                  if (!taskComment.trim() || commentBusy) return;
                                  setCommentBusy(true);
                                  try { if (await onAddTaskComment(task, taskComment)) setTaskComment(''); }
                                  finally { setCommentBusy(false); }
                                }}>
                                  <input aria-label="Commentaire de la tâche" placeholder="Ajouter un commentaire" value={taskComment} onChange={event => setTaskComment(event.target.value)} />
                                  <button type="submit" disabled={commentBusy || !taskComment.trim()}>Ajouter</button>
                                </form>
                              ) : null}
                              {onDeleteTask ? <div className={styles.taskActions}><button type="button" onClick={() => void onDeleteTask(task)}>Supprimer la tâche</button></div> : null}
                            </details>
                            {editable ? (
                              <div className={styles.taskActions} aria-label={`Mettre à jour ${task.title ?? 'la tâche'}`}>
                                <button type="button" disabled={task.status === 'todo'} onClick={() => onUpdateTask?.(task, { status: 'todo', progress: Math.min(progress, 10) })}>À faire</button>
                                <button type="button" disabled={task.status === 'in_progress'} onClick={() => onUpdateTask?.(task, { status: 'in_progress', progress: Math.max(progress, 25) })}>En cours</button>
                                <button type="button" disabled={task.status === 'delayed'} onClick={() => onUpdateTask?.(task, { status: 'delayed' })}>En retard</button>
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
                  <p>Tâches, visites et réserves regroupées par jour.</p>
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
                        const statusLabel = entry.kind === 'task'
                          ? (TASK_STATUS_LABELS[entry.status] ?? entry.status)
                          : (entry.kind === 'reserve' ? reserveStatusLabels : visitStatusLabels)[entry.status] ?? entry.status;
                        const sourceLabel = { task: 'Tâche', reserve: 'Réserve', visit: 'Visite chantier' }[entry.kind];
                        return (
                          <li key={entry.id}>
                            <button
                              type="button"
                              className={styles.agendaItem}
                              data-kind={entry.kind}
                              data-late={entry.isLate}
                              onClick={() => {
                                const id = String(entry.source.id);
                                if (entry.kind === 'task') openTask(id);
                                else if (entry.kind === 'visit') onOpenVisit?.(id);
                                else onOpenReserve?.(id);
                              }}
                            >
                              <span className={styles.agendaItemIcon}><WorkspaceIcon name={entry.kind === 'reserve' ? 'warning' : 'calendar'} size={18} /></span>
                              <span className={styles.agendaItemContent}>
                                <span className={styles.agendaItemType}>{sourceLabel}</span>
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
