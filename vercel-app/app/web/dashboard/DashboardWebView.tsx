'use client';

import { useMemo, type ReactNode } from 'react';
import type { SupportedLang } from '@/lib/i18n';
import {
  buildDashboardModel,
  type DashboardBuilding,
  type DashboardDestination,
  type DashboardPriorityItem,
  type DashboardSource,
  type DashboardWeek,
} from './dashboard-model';
import styles from './DashboardWebView.module.css';

export type { DashboardSource } from './dashboard-model';

export type DashboardIntent =
  | { type: 'navigate'; target: DashboardDestination }
  | { type: 'open-building'; buildingName: string; projectId?: string }
  | { type: 'select-project'; projectId: string }
  | { type: 'open-reserve'; reserveId: string }
  | { type: 'approve-lift'; reserveId: string }
  | { type: 'reject-lift'; reserveId: string };

type DashboardWebViewProps = {
  source: DashboardSource;
  selectedProjectId: string;
  viewerName: string;
  language: SupportedLang;
  onIntent: (intent: DashboardIntent) => void;
};

type DashboardCopy = {
  allProjects: string;
  greeting: (name: string) => string;
  totalReserves: string;
  totalHint: string;
  remaining: string;
  remainingHint: (open: number, inProgress: number) => string;
  overdue: string;
  overdueHint: (critical: number) => string;
  fieldAlerts: string;
  fieldAlertsHint: (incidents: number, tasks: number) => string;
  reserveProgress: string;
  reserveProgressHint: (closed: number, total: number) => string;
  viewReserves: string;
  closed: string;
  toClose: string;
  localized: string;
  statusOpen: string;
  statusInProgress: string;
  statusWaiting: string;
  statusVerification: string;
  statusClosed: string;
  priorities: string;
  prioritiesHint: string;
  alertCount: (count: number) => string;
  noPriority: string;
  noPriorityHint: string;
  criticalReserve: string;
  lateReserve: string;
  lateTask: string;
  deadline: (date: string) => string;
  viewPlanning: string;
  activity: string;
  activityHint: string;
  created: string;
  resolved: string;
  chartAria: string;
  locations: string;
  locationsHint: string;
  buildingCount: (count: number) => string;
  buildingMeta: (pinned: number, overdue: number) => string;
  unknownBuilding: string;
  noBuilding: string;
  companies: string;
  companiesHint: (actual: number, planned: number) => string;
  company: string;
  workforce: string;
  closure: string;
  late: string;
  noCompany: string;
  portfolio: string;
  portfolioHint: string;
  projectMeta: (total: number, overdue: number) => string;
  quickAccess: string;
  quickAccessHint: string;
  plans: string;
  visits: string;
  messages: string;
  documents: string;
  open: string;
};

const COPY: Record<SupportedLang, DashboardCopy> = {
  fr: {
    allProjects: 'Tous les chantiers',
    greeting: name => `Bonjour, ${name}`,
    totalReserves: 'Réserves suivies',
    totalHint: 'Hors archives et corbeille',
    remaining: 'À lever',
    remainingHint: (open, inProgress) => `${open} ouvertes · ${inProgress} en cours`,
    overdue: 'En retard',
    overdueHint: critical => `${critical} critique${critical > 1 ? 's' : ''}`,
    fieldAlerts: 'Alertes terrain',
    fieldAlertsHint: (incidents, tasks) => `${incidents} incident${incidents > 1 ? 's' : ''} · ${tasks} tâche${tasks > 1 ? 's' : ''}`,
    reserveProgress: 'Avancement des réserves',
    reserveProgressHint: (closed, total) => `${closed} levée${closed > 1 ? 's' : ''} sur ${total}`,
    viewReserves: 'Voir les réserves',
    closed: 'Levées',
    toClose: 'Restantes',
    localized: 'Localisées sur plan',
    statusOpen: 'Ouvertes',
    statusInProgress: 'En cours',
    statusWaiting: 'En attente',
    statusVerification: 'Vérification',
    statusClosed: 'Clôturées',
    priorities: 'À traiter maintenant',
    prioritiesHint: 'Les points qui nécessitent une action en premier.',
    alertCount: count => `${count} alerte${count > 1 ? 's' : ''}`,
    noPriority: 'Aucune urgence active',
    noPriorityHint: 'Les réserves critiques et les tâches en retard sont à jour.',
    criticalReserve: 'Réserve critique',
    lateReserve: 'Réserve en retard',
    lateTask: 'Tâche en retard',
    deadline: date => `Échéance ${date}`,
    viewPlanning: 'Voir le planning',
    activity: 'Activité sur 8 semaines',
    activityHint: 'Comparer les réserves créées et clôturées.',
    created: 'Créées',
    resolved: 'Clôturées',
    chartAria: 'Évolution des réserves créées et clôturées sur huit semaines',
    locations: 'Points chauds par bâtiment',
    locationsHint: 'Les zones avec le plus de retards apparaissent en premier.',
    buildingCount: count => `${count} bâtiment${count > 1 ? 's' : ''}`,
    buildingMeta: (pinned, overdue) => `${pinned} localisée${pinned > 1 ? 's' : ''} · ${overdue} en retard`,
    unknownBuilding: 'Sans bâtiment',
    noBuilding: 'Aucune localisation disponible.',
    companies: 'Pilotage des entreprises',
    companiesHint: (actual, planned) => `${actual} présents sur ${planned} planifiés aujourd’hui`,
    company: 'Entreprise',
    workforce: 'Effectif',
    closure: 'Clôture',
    late: 'Retards',
    noCompany: 'Aucune donnée entreprise sur ce périmètre.',
    portfolio: 'Vue portefeuille',
    portfolioHint: 'Comparer rapidement la charge et l’avancement des chantiers.',
    projectMeta: (total, overdue) => `${total} réserves · ${overdue} en retard`,
    quickAccess: 'Accès rapide',
    quickAccessHint: 'Continuer le pilotage dans les modules du chantier.',
    plans: 'Plans',
    visits: 'Visites',
    messages: 'Messages',
    documents: 'Documents',
    open: 'Ouvrir',
  },
  en: {
    allProjects: 'All projects',
    greeting: name => `Hello, ${name}`,
    totalReserves: 'Tracked snags',
    totalHint: 'Excluding archives and trash',
    remaining: 'To close',
    remainingHint: (open, inProgress) => `${open} open · ${inProgress} in progress`,
    overdue: 'Overdue',
    overdueHint: critical => `${critical} critical`,
    fieldAlerts: 'Site alerts',
    fieldAlertsHint: (incidents, tasks) => `${incidents} incident${incidents === 1 ? '' : 's'} · ${tasks} late task${tasks === 1 ? '' : 's'}`,
    reserveProgress: 'Snag progress',
    reserveProgressHint: (closed, total) => `${closed} closed out of ${total}`,
    viewReserves: 'View snags',
    closed: 'Closed',
    toClose: 'Remaining',
    localized: 'Located on plan',
    statusOpen: 'Open',
    statusInProgress: 'In progress',
    statusWaiting: 'Waiting',
    statusVerification: 'Verification',
    statusClosed: 'Closed',
    priorities: 'Needs attention now',
    prioritiesHint: 'The items that require action first.',
    alertCount: count => `${count} alert${count === 1 ? '' : 's'}`,
    noPriority: 'No active urgency',
    noPriorityHint: 'Critical snags and late tasks are up to date.',
    criticalReserve: 'Critical snag',
    lateReserve: 'Overdue snag',
    lateTask: 'Late task',
    deadline: date => `Due ${date}`,
    viewPlanning: 'View schedule',
    activity: '8-week activity',
    activityHint: 'Compare created and closed snags.',
    created: 'Created',
    resolved: 'Closed',
    chartAria: 'Created and closed snag trend over eight weeks',
    locations: 'Building hotspots',
    locationsHint: 'Areas with the most overdue items appear first.',
    buildingCount: count => `${count} building${count === 1 ? '' : 's'}`,
    buildingMeta: (pinned, overdue) => `${pinned} located · ${overdue} overdue`,
    unknownBuilding: 'No building',
    noBuilding: 'No location data available.',
    companies: 'Company performance',
    companiesHint: (actual, planned) => `${actual} present out of ${planned} planned today`,
    company: 'Company',
    workforce: 'Workforce',
    closure: 'Closure',
    late: 'Overdue',
    noCompany: 'No company data for this scope.',
    portfolio: 'Portfolio view',
    portfolioHint: 'Compare project workload and progress at a glance.',
    projectMeta: (total, overdue) => `${total} snags · ${overdue} overdue`,
    quickAccess: 'Quick access',
    quickAccessHint: 'Continue managing the project in each module.',
    plans: 'Plans',
    visits: 'Visits',
    messages: 'Messages',
    documents: 'Documents',
    open: 'Open',
  },
  es: {
    allProjects: 'Todos los proyectos',
    greeting: name => `Hola, ${name}`,
    totalReserves: 'Reservas controladas',
    totalHint: 'Sin archivos ni papelera',
    remaining: 'Por cerrar',
    remainingHint: (open, inProgress) => `${open} abiertas · ${inProgress} en curso`,
    overdue: 'Con retraso',
    overdueHint: critical => `${critical} crítica${critical === 1 ? '' : 's'}`,
    fieldAlerts: 'Alertas de obra',
    fieldAlertsHint: (incidents, tasks) => `${incidents} incidencia${incidents === 1 ? '' : 's'} · ${tasks} tarea${tasks === 1 ? '' : 's'}`,
    reserveProgress: 'Avance de reservas',
    reserveProgressHint: (closed, total) => `${closed} cerradas de ${total}`,
    viewReserves: 'Ver reservas',
    closed: 'Cerradas',
    toClose: 'Pendientes',
    localized: 'Ubicadas en plano',
    statusOpen: 'Abiertas',
    statusInProgress: 'En curso',
    statusWaiting: 'En espera',
    statusVerification: 'Verificación',
    statusClosed: 'Cerradas',
    priorities: 'Para tratar ahora',
    prioritiesHint: 'Los puntos que requieren una acción prioritaria.',
    alertCount: count => `${count} alerta${count === 1 ? '' : 's'}`,
    noPriority: 'Sin urgencias activas',
    noPriorityHint: 'Las reservas críticas y las tareas atrasadas están al día.',
    criticalReserve: 'Reserva crítica',
    lateReserve: 'Reserva atrasada',
    lateTask: 'Tarea atrasada',
    deadline: date => `Vence ${date}`,
    viewPlanning: 'Ver planificación',
    activity: 'Actividad de 8 semanas',
    activityHint: 'Comparar reservas creadas y cerradas.',
    created: 'Creadas',
    resolved: 'Cerradas',
    chartAria: 'Evolución de reservas creadas y cerradas durante ocho semanas',
    locations: 'Puntos críticos por edificio',
    locationsHint: 'Las zonas con más retrasos aparecen primero.',
    buildingCount: count => `${count} edificio${count === 1 ? '' : 's'}`,
    buildingMeta: (pinned, overdue) => `${pinned} ubicada${pinned === 1 ? '' : 's'} · ${overdue} con retraso`,
    unknownBuilding: 'Sin edificio',
    noBuilding: 'No hay datos de ubicación disponibles.',
    companies: 'Seguimiento de empresas',
    companiesHint: (actual, planned) => `${actual} presentes de ${planned} planificados hoy`,
    company: 'Empresa',
    workforce: 'Personal',
    closure: 'Cierre',
    late: 'Retrasos',
    noCompany: 'No hay datos de empresas para este ámbito.',
    portfolio: 'Vista de cartera',
    portfolioHint: 'Comparar de un vistazo la carga y el avance de los proyectos.',
    projectMeta: (total, overdue) => `${total} reservas · ${overdue} con retraso`,
    quickAccess: 'Acceso rápido',
    quickAccessHint: 'Continuar la gestión en los módulos de la obra.',
    plans: 'Planos',
    visits: 'Visitas',
    messages: 'Mensajes',
    documents: 'Documentos',
    open: 'Abrir',
  },
};

type DashboardIconName =
  | 'clipboard'
  | 'backlog'
  | 'warning'
  | 'shield'
  | 'plan'
  | 'visit'
  | 'message'
  | 'document'
  | 'arrow'
  | 'check';

function DashboardIcon({ name }: { name: DashboardIconName }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (name === 'clipboard') return <svg {...common}><path d="M9 5h6" /><path d="M9 3h6v4H9z" /><path d="M7 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1" /><path d="M8 12h8M8 16h6" /></svg>;
  if (name === 'backlog') return <svg {...common}><path d="M5 7h14M5 12h10M5 17h7" /><path d="m17 15 2 2 3-4" /></svg>;
  if (name === 'warning') return <svg {...common}><path d="M10.3 3.8 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.8a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
  if (name === 'shield') return <svg {...common}><path d="M12 3 4.5 6v5.5c0 4.5 3 7.8 7.5 9.5 4.5-1.7 7.5-5 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (name === 'plan') return <svg {...common}><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></svg>;
  if (name === 'visit') return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4" /></svg>;
  if (name === 'message') return <svg {...common}><path d="M20 15a3 3 0 0 1-3 3H8l-4 3v-6a3 3 0 0 1-1-2.2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8Z" /><path d="M8 10h8M8 14h5" /></svg>;
  if (name === 'document') return <svg {...common}><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
  if (name === 'check') return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  return <svg {...common}><path d="M5 12h14M14 7l5 5-5 5" /></svg>;
}

function PanelHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className={styles.panelHeader}>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function MetricButton({
  value,
  label,
  hint,
  tone,
  icon,
  onClick,
}: {
  value: number;
  label: string;
  hint: string;
  tone: 'blue' | 'orange' | 'danger' | 'green';
  icon: DashboardIconName;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.metric} data-tone={tone} onClick={onClick}>
      <span className={styles.metricIcon}><DashboardIcon name={icon} /></span>
      <span className={styles.metricValue}>{value.toLocaleString()}</span>
      <strong>{label}</strong>
      <small>{hint}</small>
    </button>
  );
}

function PriorityLabel({ item, copy }: { item: DashboardPriorityItem; copy: DashboardCopy }) {
  const label = item.kind === 'critical-reserve'
    ? copy.criticalReserve
    : item.kind === 'verification-reserve'
      ? copy.statusVerification
      : item.kind === 'late-task'
        ? copy.lateTask
        : copy.lateReserve;
  return <span className={styles.priorityKind} data-kind={item.kind}>{label}</span>;
}

function ActivityChart({ weeks, copy, locale }: { weeks: DashboardWeek[]; copy: DashboardCopy; locale: string }) {
  const width = 720;
  const height = 230;
  const left = 42;
  const right = 16;
  const top = 18;
  const bottom = 190;
  const innerWidth = width - left - right;
  const innerHeight = bottom - top;
  const maximum = Math.max(1, ...weeks.flatMap(week => [week.created, week.closed]));
  const x = (index: number) => left + (index * innerWidth / Math.max(weeks.length - 1, 1));
  const y = (value: number) => bottom - ((value / maximum) * innerHeight);
  const createdPoints = weeks.map((week, index) => `${x(index)},${y(week.created)}`).join(' ');
  const closedPoints = weeks.map((week, index) => `${x(index)},${y(week.closed)}`).join(' ');
  const formatter = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' });
  const ticks = [maximum, Math.round(maximum / 2), 0];

  return (
    <div className={styles.chart}>
      <div className={styles.legend} aria-hidden="true">
        <span><i data-series="created" />{copy.created}</span>
        <span><i data-series="closed" />{copy.resolved}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={copy.chartAria}>
        {ticks.map((tick, index) => {
          const tickY = top + (index * innerHeight / 2);
          return (
            <g key={`${tick}-${index}`}>
              <line className={styles.chartGrid} x1={left} x2={width - right} y1={tickY} y2={tickY} />
              <text className={styles.chartAxis} x={left - 10} y={tickY + 4} textAnchor="end">{tick}</text>
            </g>
          );
        })}
        <polyline className={styles.createdLine} points={createdPoints} />
        <polyline className={styles.closedLine} points={closedPoints} />
        {weeks.map((week, index) => (
          <g key={week.key}>
            <circle className={styles.createdPoint} cx={x(index)} cy={y(week.created)} r="4"><title>{`${copy.created}: ${week.created}`}</title></circle>
            <circle className={styles.closedPoint} cx={x(index)} cy={y(week.closed)} r="4"><title>{`${copy.resolved}: ${week.closed}`}</title></circle>
            <text className={styles.chartLabel} x={x(index)} y={218} textAnchor="middle">{formatter.format(week.start)}</text>
          </g>
        ))}
      </svg>
      <div className={styles.srOnly}>
        <table>
          <caption>{copy.chartAria}</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">{copy.created}</th><th scope="col">{copy.resolved}</th></tr></thead>
          <tbody>{weeks.map(week => <tr key={week.key}><th scope="row">{formatter.format(week.start)}</th><td>{week.created}</td><td>{week.closed}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function BuildingRow({
  building,
  maximum,
  copy,
  onOpen,
}: {
  building: DashboardBuilding;
  maximum: number;
  copy: DashboardCopy;
  onOpen: () => void;
}) {
  const width = maximum ? Math.round((building.total / maximum) * 100) : 0;
  return (
    <button type="button" className={styles.buildingRow} disabled={!building.selectable} onClick={onOpen}>
      <span className={styles.buildingText}>
        <strong>{building.name || copy.unknownBuilding}</strong>
        <small>{copy.buildingMeta(building.pinned, building.overdue)}</small>
      </span>
      <span className={styles.buildingMeasure}>
        <b>{building.total}</b>
        <i aria-hidden="true"><em style={{ width: `${width}%` }} /></i>
      </span>
      {building.selectable ? <DashboardIcon name="arrow" /> : null}
    </button>
  );
}

export function DashboardWebView({
  source,
  selectedProjectId,
  viewerName,
  language,
  onIntent,
}: DashboardWebViewProps) {
  const model = useMemo(
    () => buildDashboardModel(source, { selectedProjectId }),
    [selectedProjectId, source],
  );
  const copy = COPY[language];
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const firstName = viewerName.trim().split(/\s+/)[0] || 'BuildTrack';
  const today = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const alertCount = model.priorities.length;
  const localizedRate = model.totalCount ? Math.round((model.pinnedCount / model.totalCount) * 100) : 0;
  const maximumBuildingTotal = Math.max(1, ...model.buildings.map(building => building.total));
  const statusRows = [
    { label: copy.statusOpen, count: model.statuses.open, tone: 'danger' },
    { label: copy.statusInProgress, count: model.statuses.inProgress, tone: 'blue' },
    { label: copy.statusWaiting, count: model.statuses.waiting, tone: 'orange' },
    { label: copy.statusVerification, count: model.statuses.verification, tone: 'ink' },
    { label: copy.statusClosed, count: model.statuses.closed, tone: 'green' },
  ];
  const quickLinks: Array<{ label: string; value: number; target: DashboardDestination; icon: DashboardIconName }> = [
    { label: copy.plans, value: model.quick.plans, target: 'plans', icon: 'plan' },
    { label: copy.visits, value: model.quick.visits, target: 'visites', icon: 'visit' },
    { label: copy.messages, value: model.quick.messages, target: 'messages', icon: 'message' },
    { label: copy.documents, value: model.quick.documents, target: 'terrain', icon: 'document' },
  ];

  return (
    <div className={styles.root} data-testid="web-dashboard" data-bt-i18n-skip="true">
      <header className={styles.heading}>
        <div>
          <p>{model.projectName ?? copy.allProjects}</p>
          <h2>{copy.greeting(firstName)}</h2>
        </div>
        <time suppressHydrationWarning>{today}</time>
      </header>

      <section className={styles.metricRail} aria-label={copy.totalReserves}>
        <MetricButton value={model.totalCount} label={copy.totalReserves} hint={copy.totalHint} tone="blue" icon="clipboard" onClick={() => onIntent({ type: 'navigate', target: 'reserves' })} />
        <MetricButton value={model.remainingCount} label={copy.remaining} hint={copy.remainingHint(model.statuses.open, model.statuses.inProgress)} tone="orange" icon="backlog" onClick={() => onIntent({ type: 'navigate', target: 'reserves' })} />
        <MetricButton value={model.overdueCount} label={copy.overdue} hint={copy.overdueHint(model.criticalCount)} tone="danger" icon="warning" onClick={() => onIntent({ type: 'navigate', target: 'reserves' })} />
        <MetricButton value={model.openIncidentCount + model.lateTaskCount} label={copy.fieldAlerts} hint={copy.fieldAlertsHint(model.openIncidentCount, model.lateTaskCount)} tone={model.openIncidentCount + model.lateTaskCount ? 'danger' : 'green'} icon="shield" onClick={() => onIntent({ type: 'navigate', target: model.openIncidentCount ? 'incidents' : 'planning' })} />
      </section>

      {model.portfolio.length > 1 ? (
        <section className={styles.panel}>
          <PanelHeader title={copy.portfolio} description={copy.portfolioHint} />
          <div className={styles.portfolioList}>
            {model.portfolio.map(project => (
              <button key={project.id} type="button" onClick={() => onIntent({ type: 'select-project', projectId: project.id })}>
                <span><strong>{project.name}</strong><small>{copy.projectMeta(project.total, project.overdue)}</small></span>
                <i aria-hidden="true"><em style={{ width: `${project.progress}%` }} /></i>
                <b>{project.progress}%</b>
                <DashboardIcon name="arrow" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className={styles.operationalGrid}>
        <section className={`${styles.panel} ${styles.progressPanel}`}>
          <PanelHeader
            title={copy.reserveProgress}
            description={copy.reserveProgressHint(model.closedCount, model.totalCount)}
            action={<button type="button" className={styles.textAction} onClick={() => onIntent({ type: 'navigate', target: 'reserves' })}>{copy.viewReserves}<DashboardIcon name="arrow" /></button>}
          />
          <div className={styles.progressSummary}>
            <div className={styles.progressValue}>
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle className={styles.progressRingBase} cx="60" cy="60" r="50" pathLength="100" />
                <circle className={styles.progressRingValue} cx="60" cy="60" r="50" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - model.progress} />
              </svg>
              <span className={styles.progressValueText}>
                <strong>{model.progress}%</strong>
                <small>{copy.closed}</small>
              </span>
            </div>
            <div className={styles.progressBody}>
              <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={model.progress} aria-label={copy.reserveProgress}>
                <i style={{ width: `${model.progress}%` }} />
              </div>
              <dl className={styles.progressFacts}>
                <div><dt>{copy.closed}</dt><dd>{model.closedCount}</dd></div>
                <div><dt>{copy.toClose}</dt><dd>{model.remainingCount}</dd></div>
                <div><dt>{copy.localized}</dt><dd>{model.pinnedCount} <small>({localizedRate}%)</small></dd></div>
              </dl>
            </div>
          </div>
          <div className={styles.statusList}>
            {statusRows.map(status => {
              const width = model.totalCount ? Math.round((status.count / model.totalCount) * 100) : 0;
              return (
                <div key={status.label} className={styles.statusRow} data-tone={status.tone} aria-label={`${status.label}: ${status.count}`}>
                  <span>{status.label}</span>
                  <i aria-hidden="true"><em style={{ width: `${width}%` }} /></i>
                  <strong>{status.count}</strong>
                </div>
              );
            })}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.priorityPanel}`}>
          <PanelHeader title={copy.priorities} description={copy.prioritiesHint} action={<span className={styles.alertTotal}>{copy.alertCount(alertCount)}</span>} />
          <div className={styles.todayChips}>
            <button type="button" className={styles.todayChip} onClick={() => onIntent({ type: 'navigate', target: 'reserves' })}>
              <strong>{model.statuses.verification}</strong><span>{copy.statusVerification}</span>
            </button>
            <button type="button" className={styles.todayChip} onClick={() => onIntent({ type: 'navigate', target: 'reserves' })}>
              <strong>{model.criticalCount}</strong><span>{copy.criticalReserve}</span>
            </button>
            <button type="button" className={styles.todayChip} onClick={() => onIntent({ type: 'navigate', target: 'reserves' })}>
              <strong>{model.overdueCount}</strong><span>{copy.lateReserve}</span>
            </button>
            <button type="button" className={styles.todayChip} onClick={() => onIntent({ type: 'navigate', target: 'visites' })}>
              <strong>{model.quick.visits}</strong><span>{copy.visits}</span>
            </button>
          </div>
          {alertCount ? (
            <div className={styles.priorityList}>
              {model.priorities.slice(0, 5).map(item => {
                const meta = [item.building, item.company, item.deadline ? copy.deadline(new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(item.deadline)) : ''].filter(Boolean).join(' · ');
                return (
                  <div key={item.id} className={styles.priorityRow}>
                    <button type="button" className={styles.priorityMain} onClick={() => item.reserveId ? onIntent({ type: 'open-reserve', reserveId: item.reserveId }) : onIntent({ type: 'navigate', target: item.target })}>
                      <span className={styles.priorityMarker} data-kind={item.kind} aria-hidden="true" />
                      <span className={styles.priorityText}>
                        <PriorityLabel item={item} copy={copy} />
                        <strong>{item.title}</strong>
                        {meta ? <small>{meta}</small> : null}
                      </span>
                    </button>
                    {item.kind === 'verification-reserve' && item.reserveId ? (
                      <span className={styles.priorityActions}>
                        <button type="button" className={styles.liftApprove} onClick={() => onIntent({ type: 'approve-lift', reserveId: item.reserveId! })}>Valider</button>
                        <button type="button" className={styles.liftReject} onClick={() => onIntent({ type: 'reject-lift', reserveId: item.reserveId! })}>Refuser</button>
                      </span>
                    ) : <DashboardIcon name="arrow" />}
                  </div>
                );
              })}
              {model.priorities.length > 5 ? (
                <button type="button" className={styles.priorityMore} onClick={() => onIntent({ type: 'navigate', target: 'reserves' })}>
                  {copy.alertCount(model.priorities.length - 5)}
                </button>
              ) : null}
            </div>
          ) : (
            <div className={styles.successState}>
              <span><DashboardIcon name="check" /></span>
              <div><strong>{copy.noPriority}</strong><p>{copy.noPriorityHint}</p></div>
            </div>
          )}
        </section>
      </div>

      {model.totalCount > 0 ? (
        <div className={styles.insightGrid}>
          <section className={styles.panel}>
            <PanelHeader title={copy.activity} description={copy.activityHint} />
            <ActivityChart weeks={model.weeks} copy={copy} locale={locale} />
          </section>
          <section className={styles.panel}>
            <PanelHeader title={copy.locations} description={copy.locationsHint} action={<span className={styles.countLabel}>{copy.buildingCount(model.buildings.length)}</span>} />
            {model.buildings.length ? (
              <div className={styles.buildingList}>
                {model.buildings.slice(0, 8).map(building => (
                  <BuildingRow
                    key={building.key}
                    building={building}
                    maximum={maximumBuildingTotal}
                    copy={copy}
                    onOpen={() => onIntent({ type: 'open-building', buildingName: building.name, projectId: selectedProjectId === 'all' ? undefined : selectedProjectId })}
                  />
                ))}
              </div>
            ) : <p className={styles.empty}>{copy.noBuilding}</p>}
          </section>
        </div>
      ) : null}

      {model.totalCount > 0 ? (
        <section className={styles.panel}>
          <PanelHeader title={copy.companies} description={copy.companiesHint(model.workforce.actual, model.workforce.planned)} />
          {model.companies.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.companyTable}>
                <thead><tr><th scope="col">{copy.company}</th><th scope="col">{copy.workforce}</th><th scope="col">{copy.closure}</th><th scope="col">{copy.late}</th></tr></thead>
                <tbody>
                  {model.companies.slice(0, 8).map(company => (
                    <tr key={company.id}>
                      <th scope="row"><i style={{ background: company.color }} /><span>{company.name}</span></th>
                      <td>{company.actualWorkers}/{company.plannedWorkers}</td>
                      <td><span className={styles.tableProgress}><i style={{ width: `${company.rate}%` }} /></span><b>{company.rate}%</b></td>
                      <td data-alert={company.overdue > 0}>{company.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className={styles.empty}>{copy.noCompany}</p>}
        </section>
      ) : null}

      <section className={styles.quickSection}>
        <PanelHeader title={copy.quickAccess} description={copy.quickAccessHint} />
        <div className={styles.quickRail}>
          {quickLinks.map(link => (
            <button key={link.target} type="button" onClick={() => onIntent({ type: 'navigate', target: link.target })}>
              <span><DashboardIcon name={link.icon} /></span>
              <strong>{link.value.toLocaleString()}</strong>
              <small>{link.label}</small>
              <em>{copy.open}<DashboardIcon name="arrow" /></em>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
