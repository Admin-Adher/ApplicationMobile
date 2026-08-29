'use client';

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { WorkspaceIcon } from '../plan-reserve-workspace/WorkspaceChrome';
import {
  buildIncidentsWorkspaceModel,
  filterIncidentSummaries,
  formatIncidentDate,
  type IncidentFilter,
  type IncidentSeverity,
  type IncidentSource,
  type IncidentStatus,
  type IncidentSummary,
} from './incidents-workspace-model';
import styles from './IncidentsWorkspace.module.css';

type IncidentDraft = {
  title: string;
  location: string;
  severity: IncidentSeverity;
  description: string;
  actions: string;
};

type IncidentsWorkspaceProps = {
  incidents: IncidentSource[];
  projectName: string;
  locale?: string;
  canCreate: boolean;
  canEdit: boolean;
  onCreate: (payload: Record<string, unknown>) => Promise<unknown>;
  onUpdate: (incident: IncidentSource, patch: Record<string, unknown>) => Promise<unknown>;
};

const FILTERS: Array<{ key: IncidentFilter; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'priority', label: 'Prioritaires' },
  { key: 'open', label: 'Ouverts' },
  { key: 'investigating', label: 'En cours' },
  { key: 'resolved', label: 'Résolus' },
];

const STATUS_COPY: Record<IncidentStatus, { label: string; detail: string }> = {
  open: { label: 'Ouvert', detail: 'À traiter' },
  investigating: { label: 'En cours', detail: 'Pris en charge' },
  resolved: { label: 'Résolu', detail: 'Clôturé' },
};

const SEVERITY_COPY: Record<IncidentSeverity, string> = {
  minor: 'Mineur',
  moderate: 'Modéré',
  major: 'Majeur',
  critical: 'Critique',
};

function emptyDraft(): IncidentDraft {
  return {
    title: '',
    location: '',
    severity: 'moderate',
    description: '',
    actions: '',
  };
}

function IncidentRecord({
  incident,
  locale,
  canEdit,
  pendingAction,
  onStatusChange,
}: {
  incident: IncidentSummary;
  locale: string;
  canEdit: boolean;
  pendingAction: string;
  onStatusChange: (incident: IncidentSummary, status: IncidentStatus) => void;
}) {
  const location = [incident.building, incident.location].filter(Boolean).join(' · ');
  const takingOwnership = pendingAction === `${incident.id}:investigating`;
  const resolving = pendingAction === `${incident.id}:resolved`;
  const isPending = takingOwnership || resolving;

  return (
    <article
      className={styles.incidentRecord}
      data-status={incident.status}
      data-severity={incident.severity}
      aria-busy={isPending}
    >
      <div className={styles.recordState}>
        <span className={styles.statusLabel}>
          <i aria-hidden="true" />
          {STATUS_COPY[incident.status].label}
        </span>
        <span className={styles.severityLabel}>
          <WorkspaceIcon name="warning" size={17} />
          {SEVERITY_COPY[incident.severity]}
        </span>
        <time dateTime={incident.reportedAt || undefined}>{formatIncidentDate(incident.reportedAt, locale)}</time>
      </div>

      <div className={styles.recordBody}>
        <div className={styles.recordTitleLine}>
          <strong>{incident.title}</strong>
          <span>{STATUS_COPY[incident.status].detail}</span>
        </div>
        <p className={styles.locationLine}>
          <WorkspaceIcon name="pin" size={16} />
          {location || 'Lieu à préciser'}
        </p>
        {incident.description ? <p className={styles.description}>{incident.description}</p> : null}
        {incident.actions ? (
          <p className={styles.immediateAction}>
            <WorkspaceIcon name="check" size={16} />
            <span><strong>Mesures immédiates</strong>{incident.actions}</span>
          </p>
        ) : null}
      </div>

      <div className={styles.recordSide}>
        <p className={styles.reporter}>
          <WorkspaceIcon name="users" size={17} />
          <span><small>Signalé par</small>{incident.reportedBy || 'Auteur non renseigné'}</span>
        </p>
        {canEdit && incident.status !== 'resolved' ? (
          <div className={styles.recordActions}>
            {incident.status === 'open' ? (
              <button type="button" disabled={Boolean(pendingAction)} onClick={() => onStatusChange(incident, 'investigating')}>
                <WorkspaceIcon name="clock" size={17} />
                {takingOwnership ? 'Mise à jour…' : 'Prendre en charge'}
              </button>
            ) : null}
            <button type="button" disabled={Boolean(pendingAction)} onClick={() => onStatusChange(incident, 'resolved')}>
              <WorkspaceIcon name="check" size={17} />
              {resolving ? 'Clôture…' : 'Clôturer'}
            </button>
          </div>
        ) : incident.status === 'resolved' ? (
          <p className={styles.resolutionMeta}>
            <WorkspaceIcon name="check" size={17} />
            <span><small>Clôturé par</small>{incident.closedBy || 'Équipe chantier'}</span>
          </p>
        ) : null}
      </div>
    </article>
  );
}

export default function IncidentsWorkspace({
  incidents,
  projectName,
  locale = 'fr-FR',
  canCreate,
  canEdit,
  onCreate,
  onUpdate,
}: IncidentsWorkspaceProps) {
  const idPrefix = useId().replace(/:/g, '');
  const composerTitle = useRef<HTMLHeadingElement | null>(null);
  const signalAction = useRef<HTMLButtonElement | null>(null);
  const [filter, setFilter] = useState<IncidentFilter>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState<IncidentDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const model = useMemo(() => buildIncidentsWorkspaceModel(incidents), [incidents]);
  const visible = useMemo(
    () => filterIncidentSummaries(model.summaries, filter, deferredQuery),
    [deferredQuery, filter, model.summaries],
  );
  const activeFilterLabel = FILTERS.find(item => item.key === filter)?.label ?? 'Tous';
  const resultLabel = `${visible.length} incident${visible.length > 1 ? 's' : ''} affiché${visible.length > 1 ? 's' : ''}`;

  useEffect(() => {
    if (!composerOpen) return;
    window.requestAnimationFrame(() => {
      composerTitle.current?.focus({ preventScroll: true });
      composerTitle.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    });
  }, [composerOpen]);

  function openComposer() {
    setSubmissionError('');
    setComposerOpen(true);
  }

  function closeComposer() {
    if (busy) return;
    setSubmissionError('');
    setComposerOpen(false);
    window.requestAnimationFrame(() => signalAction.current?.focus({ preventScroll: true }));
  }

  async function submitIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const title = draft.title.trim();
    if (!title) {
      setSubmissionError('Renseignez un titre court pour identifier l’incident.');
      return;
    }
    setBusy(true);
    setSubmissionError('');
    try {
      const saved = await onCreate({
        title,
        location: draft.location.trim(),
        severity: draft.severity,
        description: draft.description.trim(),
        actions: draft.actions.trim(),
        status: 'open',
      });
      if (!saved) {
        setSubmissionError('Le signalement n’a pas été enregistré. Vérifiez le message affiché puis réessayez.');
        return;
      }
      setDraft(emptyDraft());
      setComposerOpen(false);
      window.requestAnimationFrame(() => signalAction.current?.focus({ preventScroll: true }));
    } catch {
      setSubmissionError('Le signalement a échoué. Vérifiez votre connexion puis réessayez.');
    } finally {
      setBusy(false);
    }
  }

  async function changeIncidentStatus(incident: IncidentSummary, status: IncidentStatus) {
    if (pendingAction) return;
    setPendingAction(`${incident.id}:${status}`);
    setActionError('');
    try {
      const saved = await onUpdate(incident.source, { status });
      if (!saved) setActionError(`La mise à jour de « ${incident.title} » n’a pas été enregistrée. Réessayez.`);
    } catch {
      setActionError(`La mise à jour de « ${incident.title} » a échoué. Vérifiez votre connexion.`);
    } finally {
      setPendingAction('');
    }
  }

  return (
    <div className={styles.workspace} data-testid="web-incidents-workspace">
      <section className={styles.overview} aria-labelledby="incidents-overview-title">
        <div className={styles.overviewMain}>
          <div className={styles.overviewCopy}>
            <span className={styles.overviewIcon}><WorkspaceIcon name="shield" size={25} /></span>
            <div>
              <p className={styles.eyebrow}>Sécurité chantier</p>
              <h2 id="incidents-overview-title">Chaque alerte, du signalement à la résolution</h2>
              <p>Signalez, priorisez et clôturez les incidents depuis un registre partagé.</p>
              <span className={styles.projectScope}><WorkspaceIcon name="building" size={16} />{projectName}</span>
            </div>
          </div>
          {canCreate ? (
            <button ref={signalAction} className={styles.signalAction} type="button" onClick={openComposer} aria-expanded={composerOpen}>
              <WorkspaceIcon name="plus" size={19} />
              Signaler un incident
            </button>
          ) : null}
        </div>
        <dl className={styles.overviewStats} aria-label="Synthèse des incidents">
          <div data-tone={model.activeCount ? 'active' : 'quiet'}><dt><WorkspaceIcon name="warning" size={17} />À traiter</dt><dd>{model.activeCount}</dd><small>incidents actifs</small></div>
          <div><dt><WorkspaceIcon name="clock" size={17} />En cours</dt><dd>{model.counts.investigating}</dd><small>pris en charge</small></div>
          <div data-tone={model.criticalCount ? 'critical' : 'quiet'}><dt><WorkspaceIcon name="shield" size={17} />Critiques</dt><dd>{model.criticalCount}</dd><small>encore ouverts</small></div>
          <div data-tone="resolved"><dt><WorkspaceIcon name="check" size={17} />Résolus</dt><dd>{model.counts.resolved}</dd><small>historique clos</small></div>
        </dl>
      </section>

      <div className={styles.workspaceGrid} data-composer-open={composerOpen ? 'true' : 'false'}>
        <section className={styles.register} aria-labelledby="incidents-register-title">
          <header className={styles.registerHeader}>
            <div className={styles.registerHeading}>
              <div>
                <p className={styles.eyebrow}>Registre sécurité</p>
                <h2 id="incidents-register-title">Incidents du chantier</h2>
                <p>Retrouvez les alertes, leur niveau de gravité et les actions engagées.</p>
              </div>
              {canCreate && !composerOpen ? (
                <button type="button" onClick={openComposer}><WorkspaceIcon name="plus" size={18} />Nouveau signalement</button>
              ) : null}
            </div>

            <div className={styles.registerTools}>
              <label className={styles.search} htmlFor={`${idPrefix}-search`}>
                <WorkspaceIcon name="search" size={19} />
                <span className={styles.srOnly}>Rechercher dans les incidents</span>
                <input
                  id={`${idPrefix}-search`}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Rechercher un incident, un lieu…"
                />
                {query ? <button type="button" onClick={() => setQuery('')} aria-label="Effacer la recherche"><WorkspaceIcon name="close" size={17} /></button> : null}
              </label>
              <div className={styles.filters} role="toolbar" aria-label="Filtrer les incidents">
                {FILTERS.map(item => (
                  <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
                    <span>{item.label}</span>
                    <strong>{model.counts[item.key]}</strong>
                  </button>
                ))}
              </div>
            </div>
          </header>

          <p className={styles.resultCount} role="status" aria-live="polite">
            <span>{resultLabel}</span><span aria-hidden="true"> · </span><span>filtre</span>{' '}<span>{activeFilterLabel}</span>
          </p>

          {actionError ? <p className={styles.actionError} role="alert"><WorkspaceIcon name="warning" size={18} />{actionError}</p> : null}

          {visible.length ? (
            <div className={styles.incidentList}>
              {visible.map(incident => (
                <IncidentRecord
                  key={incident.id}
                  incident={incident}
                  locale={locale}
                  canEdit={canEdit}
                  pendingAction={pendingAction}
                  onStatusChange={changeIncidentStatus}
                />
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span><WorkspaceIcon name={query || filter !== 'all' ? 'search' : 'shield'} size={25} /></span>
              <h3>{query || filter !== 'all' ? 'Aucun incident ne correspond à cette recherche' : 'Aucun incident sur ce chantier'}</h3>
              <p>{query || filter !== 'all' ? 'Modifiez la recherche ou revenez à tous les incidents.' : 'Le registre est prêt pour le premier signalement terrain.'}</p>
              {query || filter !== 'all' ? (
                <button type="button" onClick={() => { setQuery(''); setFilter('all'); }}><WorkspaceIcon name="close" size={18} />Réinitialiser les filtres</button>
              ) : canCreate ? (
                <button type="button" onClick={openComposer}><WorkspaceIcon name="plus" size={18} />Signaler le premier incident</button>
              ) : null}
            </div>
          )}
        </section>

        {composerOpen && canCreate ? (
          <aside className={styles.composer} aria-labelledby="incidents-composer-title">
            <header className={styles.composerHeader}>
              <div>
                <p className={styles.eyebrow}>Signalement terrain</p>
                <h2 id="incidents-composer-title" ref={composerTitle} tabIndex={-1}>Nouveau signalement</h2>
                <p>Décrivez l’incident avec les éléments utiles à sa prise en charge.</p>
              </div>
              <button type="button" onClick={closeComposer} aria-label="Fermer le formulaire"><WorkspaceIcon name="close" size={20} /></button>
            </header>

            <form className={styles.composerForm} onSubmit={submitIncident} aria-busy={busy}>
              <label htmlFor={`${idPrefix}-title`}>
                <span>Titre <em>obligatoire</em></span>
                <input
                  id={`${idPrefix}-title`}
                  value={draft.title}
                  onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))}
                  maxLength={160}
                  placeholder="Ex. Garde-corps manquant"
                  autoComplete="off"
                  required
                />
              </label>

              <div className={styles.formPair}>
                <label htmlFor={`${idPrefix}-location`}>
                  <span>Lieu / zone <em>optionnel</em></span>
                  <input
                    id={`${idPrefix}-location`}
                    value={draft.location}
                    onChange={event => setDraft(previous => ({ ...previous, location: event.target.value }))}
                    placeholder="Bâtiment A · Toiture"
                  />
                </label>
                <label htmlFor={`${idPrefix}-severity`}>
                  <span>Gravité</span>
                  <select id={`${idPrefix}-severity`} value={draft.severity} onChange={event => setDraft(previous => ({ ...previous, severity: event.target.value as IncidentSeverity }))}>
                    <option value="minor">Mineur</option>
                    <option value="moderate">Modéré</option>
                    <option value="major">Majeur</option>
                    <option value="critical">Critique</option>
                  </select>
                </label>
              </div>

              <label htmlFor={`${idPrefix}-description`}>
                <span>Description <em>optionnelle</em></span>
                <textarea
                  id={`${idPrefix}-description`}
                  rows={4}
                  maxLength={1000}
                  value={draft.description}
                  onChange={event => setDraft(previous => ({ ...previous, description: event.target.value }))}
                  placeholder="Circonstances, impacts constatés, zone sécurisée…"
                />
                <small>{draft.description.length}/1000</small>
              </label>

              <label htmlFor={`${idPrefix}-actions`}>
                <span>Mesures immédiates <em>optionnelles</em></span>
                <textarea
                  id={`${idPrefix}-actions`}
                  rows={3}
                  maxLength={1000}
                  value={draft.actions}
                  onChange={event => setDraft(previous => ({ ...previous, actions: event.target.value }))}
                  placeholder="Balisage, arrêt de zone, responsable prévenu…"
                />
                <small>{draft.actions.length}/1000</small>
              </label>

              <p className={styles.formHint}><WorkspaceIcon name="shield" size={18} />Le signalement sera visible par l’équipe chantier et suivi jusqu’à sa résolution.</p>

              <div className={styles.formFooter}>
                <div className={styles.formStatus} aria-live="polite">
                  {submissionError ? <p role="alert">{submissionError}</p> : <p>Le titre suffit pour enregistrer rapidement une première alerte.</p>}
                </div>
                <div className={styles.formActions}>
                  <button type="button" onClick={closeComposer} disabled={busy}>Annuler</button>
                  <button type="submit" disabled={busy || !draft.title.trim()}>
                    <WorkspaceIcon name="warning" size={18} />
                    {busy ? 'Signalement…' : 'Signaler l’incident'}
                  </button>
                </div>
              </div>
            </form>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
