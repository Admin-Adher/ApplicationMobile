'use client';

import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { WorkspaceIcon, type WorkspaceIconName } from '../plan-reserve-workspace/WorkspaceChrome';
import {
  buildChantiersWorkspaceModel,
  chantierStatusLabel,
  extractProjectBuildings,
  filterAndSortBuildings,
  filterChantierSummaries,
  formatChantierDate,
  type BuildingSort,
  type BuildingSource,
  type ChantierFilter,
  type ChantierSource,
  type CompanySource,
} from './chantiers-workspace-model';
import styles from './ChantiersWorkspace.module.css';

type ChantierDraft = {
  id?: string;
  name: string;
  address: string;
  description: string;
  start_date: string;
  end_date: string;
  status: string;
  company_ids: string[];
  buildings: BuildingSource[];
};

type ModalSection = 'identity' | 'companies' | 'structure';

type CompanyView = 'all' | 'selected';

type ChantiersWorkspaceProps = {
  projects: ChantierSource[];
  companies: CompanySource[];
  selectedProjectId: string;
  setSelectedProjectId: (projectId: string) => void;
  canCreateProject: boolean;
  canEditProject: boolean;
  canDeleteProject: boolean;
  saving: boolean;
  onSave: (draft: ChantierDraft) => Promise<unknown>;
  onDelete: (project: ChantierSource) => Promise<unknown>;
  onRequestText: (title: string) => Promise<string | null>;
  locale?: string;
};

const PROJECT_FILTERS: Array<{ key: ChantierFilter; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'active', label: 'Actifs' },
  { key: 'paused', label: 'Suspendus' },
  { key: 'completed', label: 'Terminés' },
];

const BUILDING_BATCH_SIZE = 18;

const MODAL_SECTIONS: Array<{
  key: ModalSection;
  label: string;
  description: string;
  icon: WorkspaceIconName;
}> = [
  { key: 'identity', label: 'Général', description: 'Coordonnées et statut', icon: 'document' },
  { key: 'companies', label: 'Entreprises', description: 'Affectations autorisées', icon: 'users' },
  { key: 'structure', label: 'Structure', description: 'Bâtiments, niveaux et zones', icon: 'building' },
];

function normalizeLookup(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function createStructureId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function moveItem<T>(items: T[], fromIndex: number, direction: -1 | 1) {
  const toIndex = fromIndex + direction;
  if (toIndex < 0 || toIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function draftFromProject(project?: ChantierSource): ChantierDraft {
  if (!project) {
    return {
      name: '',
      address: '',
      description: '',
      start_date: todayISO(),
      end_date: '',
      status: 'active',
      company_ids: [],
      buildings: [],
    };
  }
  return {
    id: String(project.id ?? ''),
    name: String(project.name ?? ''),
    address: String(project.address ?? ''),
    description: String(project.description ?? ''),
    start_date: String(project.start_date ?? ''),
    end_date: String(project.end_date ?? ''),
    status: String(project.status ?? 'active'),
    company_ids: (Array.isArray(project.company_ids)
      ? project.company_ids
      : Array.isArray(project.companyIds)
        ? project.companyIds
        : []).map(String),
    buildings: extractProjectBuildings(project),
  };
}

function ProjectStructureEditor({
  buildings,
  onChange,
  onRequestText,
}: {
  buildings: BuildingSource[];
  onChange: (buildings: BuildingSource[]) => void;
  onRequestText: (title: string) => Promise<string | null>;
}) {
  const [buildingName, setBuildingName] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [structureQuery, setStructureQuery] = useState('');
  const deferredStructureQuery = useDeferredValue(structureQuery);

  function buildingKey(building: BuildingSource, index: number) {
    return String(building.id ?? `building-${index}`);
  }

  const visibleBuildingEntries = useMemo(() => {
    const query = normalizeLookup(deferredStructureQuery);
    return buildings
      .map((building, index) => ({ building, index, key: buildingKey(building, index) }))
      .filter(({ building }) => {
        if (!query) return true;
        const levels = Array.isArray(building.levels) ? building.levels : [];
        return normalizeLookup([building.name, ...levels.map(level => level.name)].join(' ')).includes(query);
      });
  }, [buildings, deferredStructureQuery]);

  function toggleBuilding(key: string) {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function updateBuilding(buildingId: string, patch: Record<string, unknown>) {
    onChange(buildings.map((building, index) => buildingKey(building, index) === buildingId ? { ...building, ...patch } : building));
  }

  function updateLevel(buildingId: string, levelId: string, patch: Record<string, unknown>) {
    onChange(buildings.map((building, buildingIndex) => {
      if (buildingKey(building, buildingIndex) !== buildingId) return building;
      return {
        ...building,
        levels: (building.levels ?? []).map((level, levelIndex) => (
          String(level.id ?? `level-${levelIndex}`) === levelId ? { ...level, ...patch } : level
        )),
      };
    }));
  }

  function addBuilding() {
    const name = buildingName.trim();
    if (!name) return;
    const id = createStructureId('building');
    onChange([
      ...buildings,
      { id, name, levels: [{ id: createStructureId('level'), name: 'RDC', zones: [] }] },
    ]);
    setBuildingName('');
    setStructureQuery('');
    setExpanded(current => new Set(current).add(id));
  }

  function addLevel(buildingId: string) {
    const buildingIndex = buildings.findIndex((item, index) => buildingKey(item, index) === buildingId);
    const building = buildings[buildingIndex];
    const nextIndex = (building?.levels?.length ?? 0) + 1;
    updateBuilding(buildingId, {
      levels: [
        ...(building?.levels ?? []),
        { id: createStructureId('level'), name: nextIndex === 1 ? 'RDC' : `R+${nextIndex - 1}`, zones: [] },
      ],
    });
    setExpanded(current => new Set(current).add(buildingId));
  }

  async function addZone(buildingId: string, levelId: string) {
    const buildingIndex = buildings.findIndex((item, index) => buildingKey(item, index) === buildingId);
    const building = buildings[buildingIndex];
    const level = (building?.levels ?? []).find((item, levelIndex) => String(item.id ?? `level-${levelIndex}`) === levelId);
    const zoneName = await onRequestText('Nom de la zone');
    if (!zoneName?.trim()) return;
    updateLevel(buildingId, levelId, {
      zones: [...(level?.zones ?? []), { id: createStructureId('zone'), name: zoneName.trim() }],
    });
  }

  function updateZone(buildingId: string, levelId: string, zoneId: string, name: string) {
    const buildingIndex = buildings.findIndex((item, index) => buildingKey(item, index) === buildingId);
    const building = buildings[buildingIndex];
    const level = (building?.levels ?? []).find((item, levelIndex) => String(item.id ?? `level-${levelIndex}`) === levelId);
    updateLevel(buildingId, levelId, {
      zones: (level?.zones ?? []).map((zone, zoneIndex) => String(zone.id ?? `zone-${zoneIndex}`) === zoneId ? { ...zone, name } : zone),
    });
  }

  return (
    <div className={styles.structureEditor}>
      <div className={styles.structureEditorToolbar}>
        <div className={styles.searchField}>
          <WorkspaceIcon name="search" size={18} />
          <input
            aria-label="Rechercher dans la structure"
            value={structureQuery}
            onChange={event => setStructureQuery(event.target.value)}
            placeholder="Rechercher un bâtiment ou un niveau"
          />
          {structureQuery ? (
            <button type="button" onClick={() => setStructureQuery('')} aria-label="Effacer la recherche de structure">
              <WorkspaceIcon name="close" size={17} />
            </button>
          ) : null}
        </div>
        <span aria-live="polite">{visibleBuildingEntries.length} sur {buildings.length} bâtiments</span>
      </div>

      <div className={styles.structureAddRow}>
        <label>
          <span>Nouveau bâtiment</span>
          <input
            value={buildingName}
            onChange={event => setBuildingName(event.target.value)}
            placeholder="Nom du bâtiment"
          />
        </label>
        <button type="button" onClick={addBuilding} disabled={!buildingName.trim()}>
          <WorkspaceIcon name="plus" size={18} />
          Ajouter bâtiment
        </button>
      </div>

      <div className={styles.structureTree}>
        {visibleBuildingEntries.map(({ building, index: buildingIndex, key }) => {
          const levels = Array.isArray(building.levels) ? building.levels : [];
          const zoneCount = levels.reduce((total, level) => total + (Array.isArray(level.zones) ? level.zones.length : 0), 0);
          const isExpanded = expanded.has(key);
          return (
            <article key={key} className={styles.structureBuilding} data-expanded={isExpanded}>
              <button
                type="button"
                className={styles.structureDisclosure}
                aria-expanded={isExpanded}
                onClick={() => toggleBuilding(key)}
              >
                <span className={styles.structureBuildingIcon}><WorkspaceIcon name="building" size={18} /></span>
                <span className={styles.structureDisclosureCopy}>
                  <strong>{String(building.name ?? '').trim() || `Bâtiment ${buildingIndex + 1}`}</strong>
                  <small>{levels.length} niveau{levels.length > 1 ? 'x' : ''} · {zoneCount} zone{zoneCount > 1 ? 's' : ''}</small>
                </span>
                <span className={isExpanded ? styles.chevronOpen : ''}><WorkspaceIcon name="chevron" size={17} /></span>
              </button>

              {isExpanded ? (
                <div className={styles.structureBuildingBody}>
                  <div className={styles.structureBuildingEditRow}>
                    <label>
                      <span>Nom du bâtiment</span>
                      <input
                        aria-label={`Nom du bâtiment ${buildingIndex + 1}`}
                        value={String(building.name ?? '')}
                        onChange={event => updateBuilding(key, { name: event.target.value })}
                      />
                    </label>
                    <div className={styles.structureRowActions}>
                      <button type="button" onClick={() => onChange(moveItem(buildings, buildingIndex, -1))} disabled={buildingIndex === 0} aria-label={`Monter ${building.name ?? 'le bâtiment'}`}>↑</button>
                      <button type="button" onClick={() => onChange(moveItem(buildings, buildingIndex, 1))} disabled={buildingIndex === buildings.length - 1} aria-label={`Descendre ${building.name ?? 'le bâtiment'}`}>↓</button>
                      <button type="button" onClick={() => addLevel(key)}>Ajouter un niveau</button>
                      <button type="button" className={styles.dangerTextButton} onClick={() => onChange(buildings.filter((_, index) => index !== buildingIndex))}>Retirer</button>
                    </div>
                  </div>

                  <div className={styles.structureLevels}>
                    {levels.map((level, levelIndex) => {
                      const levelId = String(level.id ?? `level-${levelIndex}`);
                      const zones = Array.isArray(level.zones) ? level.zones : [];
                      return (
                        <section key={levelId} className={styles.structureLevel}>
                          <div className={styles.structureLevelRow}>
                            <input
                              aria-label={`Nom du niveau ${levelIndex + 1}`}
                              value={String(level.name ?? '')}
                              onChange={event => updateLevel(key, levelId, { name: event.target.value })}
                            />
                            <div className={styles.structureRowActions}>
                              <button type="button" onClick={() => updateBuilding(key, { levels: moveItem(levels, levelIndex, -1) })} disabled={levelIndex === 0} aria-label={`Monter ${level.name ?? 'le niveau'}`}>↑</button>
                              <button type="button" onClick={() => updateBuilding(key, { levels: moveItem(levels, levelIndex, 1) })} disabled={levelIndex === levels.length - 1} aria-label={`Descendre ${level.name ?? 'le niveau'}`}>↓</button>
                              <button type="button" onClick={() => addZone(key, levelId)}>Ajouter une zone</button>
                              <button type="button" className={styles.dangerTextButton} onClick={() => updateBuilding(key, { levels: levels.filter((_, index) => index !== levelIndex) })}>Retirer</button>
                            </div>
                          </div>
                          <div className={styles.structureZones}>
                            {zones.map((zone, zoneIndex) => {
                              const zoneId = String(zone.id ?? `zone-${zoneIndex}`);
                              return (
                                <span key={zoneId} className={styles.structureZone}>
                                  <input
                                    aria-label={`Nom de la zone ${zoneIndex + 1}`}
                                    value={String(zone.name ?? '')}
                                    onChange={event => updateZone(key, levelId, zoneId, event.target.value)}
                                  />
                                  <button type="button" onClick={() => updateLevel(key, levelId, { zones: moveItem(zones, zoneIndex, -1) })} disabled={zoneIndex === 0} aria-label={`Monter ${zone.name ?? 'la zone'}`}>↑</button>
                                  <button type="button" onClick={() => updateLevel(key, levelId, { zones: moveItem(zones, zoneIndex, 1) })} disabled={zoneIndex === zones.length - 1} aria-label={`Descendre ${zone.name ?? 'la zone'}`}>↓</button>
                                  <button type="button" className={styles.dangerTextButton} onClick={() => updateLevel(key, levelId, { zones: zones.filter((_, index) => index !== zoneIndex) })}>Retirer</button>
                                </span>
                              );
                            })}
                            {!zones.length ? <small>Aucune zone.</small> : null}
                          </div>
                        </section>
                      );
                    })}
                    {!levels.length ? <p className={styles.editorEmpty}>Aucun niveau. Ajoutez un niveau pour poursuivre la structure.</p> : null}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
        {buildings.length > 0 && !visibleBuildingEntries.length ? (
          <p className={styles.editorEmpty}>Aucun bâtiment ne correspond à cette recherche.</p>
        ) : null}
        {!buildings.length ? (
          <p className={styles.editorEmpty}>Aucune structure. Ajoutez au moins un bâtiment pour lier les plans et visites précisément.</p>
        ) : null}
      </div>
    </div>
  );
}

export default function ChantiersWorkspace({
  projects,
  companies,
  selectedProjectId,
  setSelectedProjectId,
  canCreateProject,
  canEditProject,
  canDeleteProject,
  saving,
  onSave,
  onDelete,
  onRequestText,
  locale = 'fr-FR',
}: ChantiersWorkspaceProps) {
  const dialogTitleId = useId();
  const modalTitle = useRef<HTMLHeadingElement | null>(null);
  const modalDialog = useRef<HTMLElement | null>(null);
  const actionMenu = useRef<HTMLDivElement | null>(null);
  const [projectFilter, setProjectFilter] = useState<ChantierFilter>('all');
  const [projectQuery, setProjectQuery] = useState('');
  const deferredProjectQuery = useDeferredValue(projectQuery);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [buildingQuery, setBuildingQuery] = useState('');
  const deferredBuildingQuery = useDeferredValue(buildingQuery);
  const [buildingSort, setBuildingSort] = useState<BuildingSort>('name');
  const [visibleLimit, setVisibleLimit] = useState(BUILDING_BATCH_SIZE);
  const [expandedBuildings, setExpandedBuildings] = useState<Set<string>>(() => new Set());
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSection, setModalSection] = useState<ModalSection>('identity');
  const [companyQuery, setCompanyQuery] = useState('');
  const deferredCompanyQuery = useDeferredValue(companyQuery);
  const [companyView, setCompanyView] = useState<CompanyView>('all');
  const [draft, setDraft] = useState<ChantierDraft>(() => draftFromProject());
  const [draftDirty, setDraftDirty] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const model = useMemo(
    () => buildChantiersWorkspaceModel(projects, companies, selectedProjectId),
    [companies, projects, selectedProjectId],
  );
  const visibleProjects = useMemo(
    () => filterChantierSummaries(model.projects, projectFilter, deferredProjectQuery),
    [deferredProjectQuery, model.projects, projectFilter],
  );
  const filteredBuildings = useMemo(
    () => filterAndSortBuildings(model.selected?.buildings ?? [], deferredBuildingQuery, buildingSort),
    [buildingSort, deferredBuildingQuery, model.selected?.buildings],
  );
  const visibleBuildings = filteredBuildings.slice(0, visibleLimit);
  const modalCompanies = useMemo(() => {
    const query = normalizeLookup(deferredCompanyQuery);
    const selectedIds = new Set(draft.company_ids);
    return companies
      .map((company, index) => {
        const id = String(company.id ?? `company-${index}`);
        const name = String(company.name ?? company.short_name ?? company.shortName ?? 'Entreprise');
        return { company, id, name, selected: selectedIds.has(id) };
      })
      .filter(item => companyView === 'all' || item.selected)
      .filter(item => !query || normalizeLookup(item.name).includes(query));
  }, [companies, companyView, deferredCompanyQuery, draft.company_ids]);

  useEffect(() => {
    setVisibleLimit(BUILDING_BATCH_SIZE);
  }, [buildingSort, deferredBuildingQuery, model.selected?.id]);

  useEffect(() => {
    const firstBuilding = model.selected?.buildings[0]?.id;
    setExpandedBuildings(firstBuilding ? new Set([firstBuilding]) : new Set());
    setBuildingQuery('');
  }, [model.selected?.id]);

  useEffect(() => {
    if (!actionMenuOpen) return undefined;
    const closeOutside = (event: MouseEvent) => {
      if (!actionMenu.current?.contains(event.target as Node)) setActionMenuOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [actionMenuOpen]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => modalTitle.current?.focus({ preventScroll: true }));
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const handleModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (saving) return;
        if (!draftDirty || window.confirm('Abandonner les modifications non enregistrées ?')) setModalOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = modalDialog.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter(element => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleModalKeyDown);
    return () => document.removeEventListener('keydown', handleModalKeyDown);
  }, [draftDirty, modalOpen, saving]);

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setPortfolioOpen(false);
  }

  function toggleBuilding(buildingId: string) {
    setExpandedBuildings(current => {
      const next = new Set(current);
      if (next.has(buildingId)) next.delete(buildingId);
      else next.add(buildingId);
      return next;
    });
  }

  function openModal(project?: ChantierSource) {
    if (project ? !canEditProject : !canCreateProject) return;
    setDraft(draftFromProject(project));
    setDraftDirty(false);
    setSubmissionError('');
    setModalSection('identity');
    setCompanyQuery('');
    setCompanyView('all');
    setActionMenuOpen(false);
    setModalOpen(true);
  }

  function requestModalClose() {
    if (saving) return;
    if (draftDirty && !window.confirm('Abandonner les modifications non enregistrées ?')) return;
    setSubmissionError('');
    setModalOpen(false);
  }

  function updateDraft(patch: Partial<ChantierDraft>) {
    setDraft(current => ({ ...current, ...patch }));
    setDraftDirty(true);
  }

  function toggleCompany(companyId: string) {
    const current = new Set(draft.company_ids);
    if (current.has(companyId)) current.delete(companyId);
    else current.add(companyId);
    updateDraft({ company_ids: Array.from(current) });
  }

  function moveModalSection(direction: -1 | 1) {
    const currentIndex = MODAL_SECTIONS.findIndex(section => section.key === modalSection);
    const nextIndex = (currentIndex + direction + MODAL_SECTIONS.length) % MODAL_SECTIONS.length;
    const nextSection = MODAL_SECTIONS[nextIndex];
    setModalSection(nextSection.key);
    window.requestAnimationFrame(() => document.getElementById(`${dialogTitleId}-tab-${nextSection.key}`)?.focus());
  }

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSubmissionError('');
    const saved = await onSave({ ...draft, name: draft.name.trim() });
    if (!saved) {
      setSubmissionError('Le chantier n’a pas été enregistré. Corrigez les informations signalées puis réessayez.');
      return;
    }
    setDraftDirty(false);
    setModalOpen(false);
  }

  const selected = model.selected;
  const resultsLabel = `${filteredBuildings.length} bâtiment${filteredBuildings.length > 1 ? 's' : ''} affiché${filteredBuildings.length > 1 ? 's' : ''}`;
  const activeModalSection = MODAL_SECTIONS.find(section => section.key === modalSection) ?? MODAL_SECTIONS[0];

  return (
    <div className={styles.workspace} data-testid="web-chantiers-workspace">
      <section className={styles.portfolio} data-expanded={portfolioOpen} aria-labelledby="portfolio-title">
        <button
          type="button"
          className={styles.portfolioMobileToggle}
          aria-expanded={portfolioOpen}
          aria-controls="chantiers-portfolio-controls"
          onClick={() => setPortfolioOpen(open => !open)}
        >
          <WorkspaceIcon name="building" size={20} />
          <span><strong>{model.projects.length} chantier{model.projects.length > 1 ? 's' : ''}</strong>{selected ? ` · ${selected.name}` : ''}</span>
          <span className={portfolioOpen ? styles.chevronOpen : ''}><WorkspaceIcon name="chevron" size={18} /></span>
        </button>

        <div className={styles.portfolioHeader}>
          <div>
            <h2 id="portfolio-title">Portefeuille</h2>
            <p>{model.counts.active} actif{model.counts.active > 1 ? 's' : ''} · {model.totalBuildings} bâtiments</p>
          </div>
          {canCreateProject ? (
            <button type="button" className={styles.mobileCreateButton} onClick={() => openModal()}>
              <WorkspaceIcon name="plus" size={19} />
              Nouveau chantier
            </button>
          ) : null}
        </div>

        <div id="chantiers-portfolio-controls" className={styles.portfolioControls}>
          <label className={styles.searchField}>
            <WorkspaceIcon name="search" size={18} />
            <span className={styles.srOnly}>Rechercher un chantier</span>
            <input value={projectQuery} onChange={event => setProjectQuery(event.target.value)} placeholder="Rechercher un chantier" />
            {projectQuery ? (
              <button type="button" onClick={() => setProjectQuery('')} aria-label="Effacer la recherche de chantier">
                <WorkspaceIcon name="close" size={17} />
              </button>
            ) : null}
          </label>

          <div className={styles.projectFilters} role="toolbar" aria-label="Filtrer les chantiers">
            {PROJECT_FILTERS.map(item => (
              <button
                key={item.key}
                type="button"
                aria-pressed={projectFilter === item.key}
                onClick={() => setProjectFilter(item.key)}
              >
                <span>{item.label}</span>
                <strong>{model.counts[item.key]}</strong>
              </button>
            ))}
          </div>

          {canCreateProject ? (
            <button type="button" className={styles.createButton} onClick={() => openModal()}>
              <WorkspaceIcon name="plus" size={19} />
              Nouveau chantier
            </button>
          ) : null}

          <div className={styles.projectList} aria-label="Liste des chantiers">
            {visibleProjects.map(project => (
              <button
                key={project.id}
                type="button"
                className={project.id === selected?.id ? styles.projectSelected : ''}
                aria-current={project.id === selected?.id ? 'true' : undefined}
                onClick={() => selectProject(project.id)}
              >
                <span className={styles.projectIcon}><WorkspaceIcon name="building" size={22} /></span>
                <span className={styles.projectCopy}>
                  <strong>{project.name}</strong>
                  <small><i data-status={project.status} aria-hidden="true" />{chantierStatusLabel(project.status)}</small>
                  <span><WorkspaceIcon name="pin" size={14} />{project.location}</span>
                </span>
                <span className={styles.projectMeta}>
                  <small>{project.buildingCount} bâtiments</small>
                  <time dateTime={project.endDate || undefined}>{formatChantierDate(project.endDate, locale)}</time>
                </span>
              </button>
            ))}
            {!visibleProjects.length ? <p className={styles.empty}>Aucun chantier ne correspond à ces filtres.</p> : null}
          </div>
        </div>
      </section>

      <section className={styles.dossier} aria-labelledby="chantier-dossier-title">
        {selected ? (
          <>
            <header className={styles.dossierHeader}>
              <span className={styles.dossierIcon}><WorkspaceIcon name="building" size={27} /></span>
              <div className={styles.dossierTitle}>
                <h2 id="chantier-dossier-title">{selected.name}</h2>
                <p><span><i data-status={selected.status} aria-hidden="true" />{chantierStatusLabel(selected.status)}</span><span><WorkspaceIcon name="pin" size={16} />{selected.location}</span></p>
              </div>
              <div className={styles.dossierActions}>
                {canEditProject ? (
                  <button type="button" className={styles.editButton} onClick={() => openModal(selected.source)}>
                    <WorkspaceIcon name="edit" size={18} />
                    <span>Modifier</span>
                  </button>
                ) : null}
                {canDeleteProject ? (
                  <div className={styles.actionMenu} ref={actionMenu}>
                    <button type="button" className={styles.moreButton} aria-label="Plus d’actions pour le chantier" aria-haspopup="menu" aria-expanded={actionMenuOpen} onClick={() => setActionMenuOpen(open => !open)}>
                      <WorkspaceIcon name="more" size={20} />
                    </button>
                    {actionMenuOpen ? (
                      <div className={styles.actionMenuPanel} role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setActionMenuOpen(false);
                            void onDelete(selected.source);
                          }}
                        >
                          <WorkspaceIcon name="trash" size={18} />
                          Supprimer le chantier
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </header>

            <dl className={styles.facts} aria-label="Repères du chantier">
              <div className={styles.factOptional}><dt>Début</dt><dd>{formatChantierDate(selected.startDate, locale)}</dd></div>
              <div><dt>Fin</dt><dd>{formatChantierDate(selected.endDate, locale)}</dd></div>
              <div><dt>Bâtiments</dt><dd>{selected.buildingCount}</dd></div>
              <div><dt>Niveaux</dt><dd>{selected.levelCount}</dd></div>
              <div className={styles.factOptional}><dt>Zones</dt><dd>{selected.zoneCount}</dd></div>
              <div><dt>Entreprises</dt><dd>{selected.companies.length}</dd></div>
            </dl>

            <div className={styles.dossierBody}>
              <section className={styles.structurePanel} aria-labelledby="structure-title">
                <div className={styles.sectionHeading}>
                  <div>
                    <h3 id="structure-title">Structure du chantier</h3>
                    <p>{selected.buildingCount} bâtiments · {selected.levelCount} niveaux</p>
                  </div>
                  <span>{resultsLabel}</span>
                </div>

                <div className={styles.structureToolbar}>
                  <label className={styles.searchField}>
                    <WorkspaceIcon name="search" size={19} />
                    <span className={styles.srOnly}>Rechercher un bâtiment ou un niveau</span>
                    <input value={buildingQuery} onChange={event => setBuildingQuery(event.target.value)} placeholder="Rechercher un bâtiment ou un niveau" />
                    {buildingQuery ? (
                      <button type="button" onClick={() => setBuildingQuery('')} aria-label="Effacer la recherche de structure">
                        <WorkspaceIcon name="close" size={17} />
                      </button>
                    ) : null}
                  </label>
                  <label className={styles.sortControl}>
                    <WorkspaceIcon name="filter" size={17} />
                    <span className={styles.srOnly}>Trier les bâtiments</span>
                    <select value={buildingSort} onChange={event => setBuildingSort(event.target.value as BuildingSort)}>
                      <option value="name">Tri : A à Z</option>
                      <option value="levels">Plus structurés</option>
                    </select>
                  </label>
                </div>

                <div className={styles.structureColumns} aria-hidden="true">
                  <span>Bâtiment</span><span>Niveaux</span><span>Zones</span><span />
                </div>

                <div className={styles.buildingList}>
                  {visibleBuildings.map(building => {
                    const isExpanded = expandedBuildings.has(building.id);
                    const levelNames = building.levels.map(level => level.name).join(' · ');
                    return (
                      <article key={building.id} className={styles.buildingRecord} data-expanded={isExpanded}>
                        <button type="button" className={styles.buildingRow} aria-expanded={isExpanded} onClick={() => toggleBuilding(building.id)}>
                          <span className={styles.buildingIdentity}>
                            <WorkspaceIcon name="building" size={21} />
                            <span><strong>{building.name}</strong><small>{building.levelCount} niveau{building.levelCount > 1 ? 'x' : ''}{levelNames ? ` · ${levelNames}` : ''}</small></span>
                          </span>
                          <span className={styles.buildingNumber}><strong>{building.levelCount}</strong><small>Niveaux</small></span>
                          <span className={styles.buildingNumber}><strong>{building.zoneCount}</strong><small>Zones</small></span>
                          <span className={isExpanded ? styles.chevronOpen : ''}><WorkspaceIcon name="chevron" size={18} /></span>
                        </button>
                        {isExpanded ? (
                          <div className={styles.levelList} role="region" aria-label={`Niveaux de ${building.name}`}>
                            {building.levels.map(level => (
                              <div key={level.id}>
                                <span aria-hidden="true" />
                                <strong>{level.name}</strong>
                                <small>{level.zoneCount} zone{level.zoneCount > 1 ? 's' : ''}</small>
                              </div>
                            ))}
                            {!building.levels.length ? <p className={styles.empty}>Aucun niveau enregistré.</p> : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  {!filteredBuildings.length ? (
                    <div className={styles.structureEmpty}>
                      <WorkspaceIcon name="building" size={24} />
                      <strong>{selected.buildings.length ? 'Aucun bâtiment trouvé' : 'Aucune structure enregistrée'}</strong>
                      <p>{selected.buildings.length ? 'Modifiez la recherche ou le tri pour retrouver un bâtiment.' : 'Ajoutez des bâtiments depuis la modification du chantier.'}</p>
                      {canEditProject && !selected.buildings.length ? <button type="button" onClick={() => openModal(selected.source)}>Créer la structure</button> : null}
                    </div>
                  ) : null}
                </div>

                {visibleLimit < filteredBuildings.length ? (
                  <button type="button" className={styles.loadMore} onClick={() => setVisibleLimit(limit => limit + BUILDING_BATCH_SIZE)}>
                    Afficher {Math.min(BUILDING_BATCH_SIZE, filteredBuildings.length - visibleLimit)} bâtiments de plus
                  </button>
                ) : null}
              </section>

              <aside className={styles.companiesPanel} aria-labelledby="companies-title">
                <div className={styles.sectionHeading}>
                  <div><h3 id="companies-title">Entreprises affectées</h3><p>{selected.companies.length} entreprise{selected.companies.length > 1 ? 's' : ''}</p></div>
                </div>
                <div className={styles.companyList}>
                  {selected.companies.map(company => (
                    <div key={company.id}>
                      <span style={{ '--company-color': company.color } as CSSProperties}><WorkspaceIcon name="building" size={18} /></span>
                      <strong>{company.name}</strong>
                    </div>
                  ))}
                  {!selected.companies.length ? <p className={styles.empty}>Aucune entreprise affectée.</p> : null}
                </div>
                {canEditProject ? <button type="button" className={styles.manageCompanies} onClick={() => openModal(selected.source)}>Gérer les affectations <WorkspaceIcon name="chevron" size={17} /></button> : null}
              </aside>
            </div>
          </>
        ) : (
          <div className={styles.noProject}>
            <WorkspaceIcon name="building" size={28} />
            <h2 id="chantier-dossier-title">Aucun chantier</h2>
            <p>Créez un chantier pour organiser ses bâtiments, niveaux et entreprises.</p>
            {canCreateProject ? <button type="button" onClick={() => openModal()}><WorkspaceIcon name="plus" size={18} />Nouveau chantier</button> : null}
          </div>
        )}
      </section>

      {modalOpen ? (
        <div className={styles.modalBackdrop} onMouseDown={requestModalClose}>
          <section ref={modalDialog} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={dialogTitleId} onMouseDown={event => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div>
                <h2 id={dialogTitleId} ref={modalTitle} tabIndex={-1}>{draft.id ? 'Modifier le chantier' : 'Nouveau chantier'}</h2>
                <p>Informations, entreprises et structure du projet.</p>
              </div>
              <button type="button" onClick={requestModalClose} disabled={saving} aria-label="Fermer la fenêtre">
                <WorkspaceIcon name="close" size={20} />
              </button>
            </header>

            <form className={styles.projectForm} onSubmit={submitProject} aria-busy={saving}>
              <div className={styles.modalWorkspace}>
                <nav className={styles.modalSectionNav} role="tablist" aria-label="Sections du chantier">
                  {MODAL_SECTIONS.map((section, index) => {
                    const selectedSection = modalSection === section.key;
                    const sectionMeta = section.key === 'identity'
                      ? (draft.name.trim() ? 'Renseigné' : 'À compléter')
                      : section.key === 'companies'
                        ? `${draft.company_ids.length} sélectionnée${draft.company_ids.length > 1 ? 's' : ''}`
                        : `${draft.buildings.length} bâtiment${draft.buildings.length > 1 ? 's' : ''}`;
                    return (
                      <button
                        key={section.key}
                        id={`${dialogTitleId}-tab-${section.key}`}
                        type="button"
                        role="tab"
                        aria-selected={selectedSection}
                        aria-controls={`${dialogTitleId}-panel-${section.key}`}
                        tabIndex={selectedSection ? 0 : -1}
                        onClick={() => setModalSection(section.key)}
                        onKeyDown={event => {
                          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                            event.preventDefault();
                            moveModalSection(1);
                          }
                          if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            moveModalSection(-1);
                          }
                        }}
                      >
                        <span className={styles.modalSectionIndex}>{index + 1}</span>
                        <span className={styles.modalSectionIcon}><WorkspaceIcon name={section.icon} size={19} /></span>
                        <span className={styles.modalSectionCopy}>
                          <strong>{section.label}</strong>
                          <small>{section.description}</small>
                        </span>
                        <em>{sectionMeta}</em>
                      </button>
                    );
                  })}
                </nav>

                <div className={styles.modalContent}>
                  {modalSection === 'identity' ? (
                    <section
                      id={`${dialogTitleId}-panel-identity`}
                      className={styles.formSection}
                      role="tabpanel"
                      aria-labelledby={`${dialogTitleId}-tab-identity`}
                    >
                      <div className={styles.formSectionHeading}>
                        <p className={styles.sectionEyebrow}>Général</p>
                        <h3>Identité du chantier</h3>
                        <p>Les informations utilisées dans les visites, plans et rapports.</p>
                      </div>
                      <div className={styles.formGrid}>
                        <label><span>Nom</span><input value={draft.name} onChange={event => updateDraft({ name: event.target.value })} required autoFocus /></label>
                        <label><span>Statut</span><select value={draft.status} onChange={event => updateDraft({ status: event.target.value })}><option value="active">Actif</option><option value="paused">Suspendu</option><option value="completed">Terminé</option></select></label>
                        <label><span>Date début</span><input type="date" value={draft.start_date} onChange={event => updateDraft({ start_date: event.target.value })} /></label>
                        <label><span>Date fin</span><input type="date" value={draft.end_date} onChange={event => updateDraft({ end_date: event.target.value })} /></label>
                        <label className={styles.fullSpan}><span>Adresse</span><input value={draft.address} onChange={event => updateDraft({ address: event.target.value })} /></label>
                        <label className={styles.fullSpan}><span>Description</span><textarea rows={4} value={draft.description} onChange={event => updateDraft({ description: event.target.value })} /></label>
                      </div>
                    </section>
                  ) : null}

                  {modalSection === 'companies' ? (
                    <section
                      id={`${dialogTitleId}-panel-companies`}
                      className={styles.formSection}
                      role="tabpanel"
                      aria-labelledby={`${dialogTitleId}-tab-companies`}
                    >
                      <div className={styles.formSectionHeading}>
                        <p className={styles.sectionEyebrow}>Entreprises</p>
                        <h3>Entreprises affectées</h3>
                        <p>Sélectionnez les entreprises autorisées sur ce chantier.</p>
                      </div>
                      <div className={styles.companyToolbar}>
                        <div className={styles.searchField}>
                          <WorkspaceIcon name="search" size={18} />
                          <input aria-label="Rechercher une entreprise" value={companyQuery} onChange={event => setCompanyQuery(event.target.value)} placeholder="Rechercher une entreprise" autoFocus />
                          {companyQuery ? (
                            <button type="button" onClick={() => setCompanyQuery('')} aria-label="Effacer la recherche d’entreprise"><WorkspaceIcon name="close" size={17} /></button>
                          ) : null}
                        </div>
                        <div className={styles.companyViewToggle} role="group" aria-label="Filtrer les entreprises du chantier">
                          <button type="button" aria-pressed={companyView === 'all'} onClick={() => setCompanyView('all')}>Toutes <strong>{companies.length}</strong></button>
                          <button type="button" aria-pressed={companyView === 'selected'} onClick={() => setCompanyView('selected')}>Sélectionnées <strong>{draft.company_ids.length}</strong></button>
                        </div>
                      </div>
                      <div className={styles.companySelectionSummary} aria-live="polite">
                        <strong>{draft.company_ids.length} entreprise{draft.company_ids.length > 1 ? 's' : ''} sélectionnée{draft.company_ids.length > 1 ? 's' : ''}</strong>
                        <span>{modalCompanies.length} résultat{modalCompanies.length > 1 ? 's' : ''}</span>
                      </div>
                      <div className={styles.companySelector}>
                        {modalCompanies.map(({ company, id, name, selected: active }) => (
                          <button key={id} type="button" aria-pressed={active} onClick={() => toggleCompany(id)}>
                            <span style={{ '--company-color': String(company.color ?? '#003082') } as CSSProperties} />
                            <span>{name}</span>
                            {active ? <WorkspaceIcon name="check" size={17} /> : null}
                          </button>
                        ))}
                        {!companies.length ? <p className={styles.empty}>Aucune entreprise disponible.</p> : null}
                        {companies.length > 0 && !modalCompanies.length ? <p className={styles.editorEmpty}>Aucune entreprise ne correspond à cette recherche.</p> : null}
                      </div>
                    </section>
                  ) : null}

                  {modalSection === 'structure' ? (
                    <section
                      id={`${dialogTitleId}-panel-structure`}
                      className={styles.formSection}
                      role="tabpanel"
                      aria-labelledby={`${dialogTitleId}-tab-structure`}
                    >
                      <div className={styles.formSectionHeading}>
                        <p className={styles.sectionEyebrow}>Structure</p>
                        <h3>Structure bâtiments / niveaux / zones</h3>
                        <p>Dépliez uniquement le bâtiment à modifier pour conserver une interface fluide.</p>
                      </div>
                      <ProjectStructureEditor buildings={draft.buildings} onChange={buildings => updateDraft({ buildings })} onRequestText={onRequestText} />
                    </section>
                  ) : null}
                </div>
              </div>

              {submissionError ? <p className={styles.formError} role="alert">{submissionError}</p> : null}
              <footer className={styles.modalActions}>
                <div className={styles.modalSaveState} aria-live="polite">
                  <span data-dirty={draftDirty}><i aria-hidden="true" />{draftDirty ? 'Modifications non enregistrées' : draft.id ? 'Aucune modification' : 'Nouveau chantier non enregistré'}</span>
                  <small><span>Section actuelle</span><span aria-hidden="true">·</span><span>{activeModalSection.label}</span></small>
                </div>
                <div>
                  <button type="button" onClick={requestModalClose} disabled={saving}>Annuler</button>
                  <button type="submit" disabled={saving || !draft.name.trim()}>{saving ? 'Enregistrement…' : 'Enregistrer le chantier'}</button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
