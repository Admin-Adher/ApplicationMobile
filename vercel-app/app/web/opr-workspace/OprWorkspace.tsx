'use client';

import { useId, useMemo, useState } from 'react';
import {
  buildOprWorkspaceModel,
  filterOprSummaries,
  formatOprDate,
  type OprFilter,
  type OprItemStatus,
  type OprSource,
  type OprStatus,
  type OprSummary,
  type ReserveSource,
} from './opr-workspace-model';
import styles from './OprWorkspace.module.css';

type OprWorkspaceProps = {
  oprs: OprSource[];
  reserves: ReserveSource[];
  projectName: string;
  onOpenReserve: (id: string) => void;
  isReserveArchived?: (reserve: ReserveSource) => boolean;
};

const STATUS_COPY: Record<OprStatus, { label: string; description: string }> = {
  draft: { label: 'Brouillon', description: 'Préparation à poursuivre' },
  in_progress: { label: 'En cours', description: 'Contrôle en cours' },
  signed: { label: 'Signé', description: 'Procès-verbal finalisé' },
};

const ITEM_STATUS_COPY: Record<OprItemStatus, string> = {
  ok: 'Conforme',
  reserve: 'Réserve',
  non_applicable: 'Non applicable',
};

const FILTERS: Array<{ key: OprFilter; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'draft', label: 'Brouillons' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'signed', label: 'Signés' },
];

type IconName = 'clipboard' | 'check' | 'alert' | 'minus' | 'chevron' | 'calendar' | 'location' | 'user' | 'reserve';

function OprIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    clipboard: <><path d="M9 5h6" /><path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z" /><path d="M7 5H5.5A1.5 1.5 0 0 0 4 6.5v13A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 18.5 5H17" /><path d="m8 13 2.2 2.2L16 9.5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    alert: <><path d="M12 4 3 20h18L12 4Z" /><path d="M12 9v5" /><path d="M12 17h.01" /></>,
    minus: <path d="M5 12h14" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    location: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    reserve: <><path d="M4 7h16v13H4z" /><path d="M8 7V4h8v3M8 12h8M8 16h5" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function StatusBadge({ status }: { status: OprStatus }) {
  return (
    <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>
      <span aria-hidden="true" />
      {STATUS_COPY[status].label}
    </span>
  );
}

function OprCard({ opr, open, onToggle, onOpenReserve }: {
  opr: OprSummary;
  open: boolean;
  onToggle: () => void;
  onOpenReserve: (id: string) => void;
}) {
  const reactId = useId().replace(/:/g, '');
  const detailId = `opr-detail-${reactId}`;
  const dateLabel = formatOprDate(opr.date);
  const locationLabel = opr.location || 'Localisation à préciser';

  return (
    <article className={styles.oprCard} data-open={open ? 'true' : 'false'} data-opr-id={opr.id}>
      <button
        className={styles.oprCardToggle}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={detailId}
      >
        <StatusBadge status={opr.status} />
        <span className={styles.oprCardIdentity}>
          <strong>{opr.title}</strong>
          <span><OprIcon name="location" />{locationLabel}</span>
        </span>
        <span className={styles.oprCardProgress}>
          <strong>{opr.conformity}%</strong>
          <span>conforme</span>
        </span>
        <span className={styles.oprCardChevron} aria-hidden="true"><OprIcon name="chevron" /></span>
      </button>

      <div className={styles.oprCardFooter}>
        <span><OprIcon name="calendar" /><time dateTime={opr.date || undefined}>{dateLabel}</time></span>
        <span><OprIcon name="user" />{opr.conducteur || 'Conducteur à préciser'}</span>
        <span><OprIcon name="check" />{opr.okCount} conforme{opr.okCount > 1 ? 's' : ''}</span>
        <span className={opr.reserveCount ? styles.reserveMeta : undefined}><OprIcon name="alert" />{opr.reserveCount} réserve{opr.reserveCount > 1 ? 's' : ''}</span>
      </div>

      {open ? (
        <div className={styles.oprDetail} id={detailId}>
          <div className={styles.oprDetailHeader}>
            <div>
              <p className={styles.detailEyebrow}>Avancement du contrôle</p>
              <strong>{opr.okCount} lot{opr.okCount > 1 ? 's' : ''} conforme{opr.okCount > 1 ? 's' : ''} sur {opr.items.length}</strong>
            </div>
            <span>{STATUS_COPY[opr.status].description}</span>
          </div>
          <progress value={opr.conformity} max={100} aria-label={`Conformité de ${opr.title} : ${opr.conformity} %`} />

          <dl className={styles.oprFacts}>
            <div><dt>Bâtiment</dt><dd>{opr.building || 'À préciser'}</dd></div>
            <div><dt>Niveau</dt><dd>{opr.level || 'À préciser'}</dd></div>
            <div><dt>Zone</dt><dd>{opr.zone || 'Toutes zones'}</dd></div>
            <div><dt>Date du contrôle</dt><dd>{formatOprDate(opr.date, true)}</dd></div>
          </dl>

          <div className={styles.checklistHeader}>
            <div>
              <h3>Lots contrôlés</h3>
              <p>{opr.items.length} élément{opr.items.length > 1 ? 's' : ''} dans ce procès-verbal</p>
            </div>
            {opr.notApplicableCount ? <span>{opr.notApplicableCount} non applicable{opr.notApplicableCount > 1 ? 's' : ''}</span> : null}
          </div>

          {opr.items.length ? (
            <ul className={styles.oprChecklist}>
              {opr.items.map(item => (
                <li key={item.id} data-status={item.status}>
                  <span className={styles.itemStatusIcon} aria-hidden="true">
                    <OprIcon name={item.status === 'ok' ? 'check' : item.status === 'reserve' ? 'alert' : 'minus'} />
                  </span>
                  <div className={styles.itemBody}>
                    <div className={styles.itemTitleRow}>
                      <strong>{item.lotName}</strong>
                      <span>{ITEM_STATUS_COPY[item.status]}</span>
                    </div>
                    {item.description && item.description !== item.lotName ? <p>{item.description}</p> : null}
                    <div className={styles.itemMeta}>
                      {item.entreprise ? <span>{item.entreprise}</span> : null}
                      {item.deadline ? <span>Échéance {formatOprDate(item.deadline)}</span> : null}
                      {item.note ? <span>{item.note}</span> : null}
                    </div>
                  </div>
                  {item.reserveId ? (
                    <button className={styles.reserveAction} type="button" onClick={() => onOpenReserve(item.reserveId as string)}>
                      <OprIcon name="reserve" />Voir la réserve
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.detailEmpty}>Aucun lot n’est encore rattaché à ce procès-verbal.</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

export default function OprWorkspace({ oprs, reserves, projectName, onOpenReserve, isReserveArchived }: OprWorkspaceProps) {
  const [filter, setFilter] = useState<OprFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const model = useMemo(
    () => buildOprWorkspaceModel(oprs, reserves, isReserveArchived),
    [isReserveArchived, oprs, reserves],
  );
  const visible = useMemo(() => filterOprSummaries(model.summaries, filter), [filter, model.summaries]);
  const activeFilterLabel = FILTERS.find(item => item.key === filter)?.label ?? 'Tous';
  const countForFilter = (value: OprFilter) => model.counts[value];

  const openContinuation = () => {
    if (!model.continuation) return;
    setFilter('all');
    setOpenId(model.continuation.id);
  };

  return (
    <div className={styles.workspace} data-testid="web-opr-workspace">
      <section className={styles.overview} aria-labelledby="opr-overview-title">
        <div className={styles.overviewIntro}>
          <span className={styles.overviewIcon}><OprIcon name="clipboard" /></span>
          <div>
            <p className={styles.eyebrow}>Réception chantier</p>
            <h2 id="opr-overview-title">Contrôler, consigner, signer</h2>
            <p>Suivez chaque procès-verbal du premier contrôle jusqu’à sa signature.</p>
            <span className={styles.projectScope}>{projectName}</span>
          </div>
        </div>
        <dl className={styles.overviewMetrics}>
          <div><dt>Total</dt><dd>{model.counts.all}</dd><small>dossiers</small></div>
          <div><dt>À finaliser</dt><dd>{model.counts.active}</dd><small>actifs</small></div>
          <div><dt>Signés</dt><dd>{model.counts.signed}</dd><small>PV clos</small></div>
          <div data-alert={model.linkedOpenReserveCount > 0 ? 'true' : 'false'}><dt>Réserves</dt><dd>{model.linkedOpenReserveCount}</dd><small>ouvertes</small></div>
        </dl>
      </section>

      {model.continuation ? (
        <section className={styles.continuation} aria-labelledby="opr-continuation-title">
          <div className={styles.continuationMarker}><OprIcon name="clipboard" /></div>
          <div className={styles.continuationBody}>
            <p className={styles.eyebrow}>Dossier actif</p>
            <h2 id="opr-continuation-title">{model.continuation.title}</h2>
            <p>{formatOprDate(model.continuation.date)} · {model.continuation.location || 'Localisation à préciser'}</p>
          </div>
          <div className={styles.continuationProgress}>
            <strong>{model.continuation.conformity}%</strong>
            <span>de conformité</span>
          </div>
          <button type="button" onClick={openContinuation}>Ouvrir le dossier<OprIcon name="chevron" /></button>
        </section>
      ) : null}

      <section className={styles.listPanel} aria-labelledby="opr-list-title">
        <div className={styles.listHeader}>
          <div>
            <p className={styles.eyebrow}>Registre OPR</p>
            <h2 id="opr-list-title">Procès-verbaux</h2>
            <p>Retrouvez les lots contrôlés, les écarts et les réserves rattachées.</p>
          </div>
          <div className={styles.filters} role="toolbar" aria-label="Filtrer les procès-verbaux">
            {FILTERS.map(item => (
              <button
                key={item.key}
                type="button"
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
              >
                <span>{item.label}</span>
                <strong>{countForFilter(item.key)}</strong>
              </button>
            ))}
          </div>
        </div>

        <p className={styles.resultCount} role="status" aria-live="polite">
          {visible.length} {visible.length === 1 ? 'dossier affiché' : 'dossiers affichés'} · filtre {activeFilterLabel.toLowerCase()}
        </p>

        {visible.length ? (
          <div className={styles.oprList}>
            {visible.map(opr => (
              <OprCard
                key={opr.id}
                opr={opr}
                open={openId === opr.id}
                onToggle={() => setOpenId(current => current === opr.id ? null : opr.id)}
                onOpenReserve={onOpenReserve}
              />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <span><OprIcon name="clipboard" /></span>
            <div>
              <h3>{model.counts.all ? `Aucun dossier ${activeFilterLabel.toLowerCase()}` : 'Aucun procès-verbal pour ce chantier'}</h3>
              <p>{model.counts.all
                ? 'Modifiez le filtre pour retrouver les autres procès-verbaux.'
                : 'Les OPR préparées sur le terrain apparaîtront ici après synchronisation.'}</p>
            </div>
            {model.counts.all ? <button type="button" onClick={() => setFilter('all')}>Voir tous les OPR</button> : null}
          </div>
        )}
      </section>
    </div>
  );
}
