'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BuildTrackBrand } from '../_components/BuildTrackBrand';
import styles from './WorkspaceChrome.module.css';

export type WorkspaceNavigationItem = {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  badge?: string | number;
  badgeLabel?: string;
  onSelect: () => void;
};

export type WorkspaceNavigationGroup = {
  id: string;
  label: string;
  items: WorkspaceNavigationItem[];
};

export type WorkspaceProject = {
  id: string | number;
  name?: string | null;
  location?: string | null;
  city?: string | null;
  address?: string | null;
};

export type WorkspaceChromeAction = {
  id: string;
  label: string;
  icon: 'reserve' | 'visit' | 'sync';
  variant?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
};

type WorkspaceProjectLabels = {
  allProjects: string;
  activeProject: string;
  projectCount: string;
};

type WorkspaceChromeProps = {
  title: string;
  eyebrow: string;
  navigationLabel: string;
  navigationGroups: WorkspaceNavigationGroup[];
  projects: WorkspaceProject[];
  selectedProjectId: string;
  projectLabels: WorkspaceProjectLabels;
  userName: string;
  userRole: string;
  logoutLabel: string;
  openMenuLabel: string;
  closeMenuLabel: string;
  expandSidebarLabel: string;
  collapseSidebarLabel: string;
  collapsed: boolean;
  mobileOpen: boolean;
  actions: WorkspaceChromeAction[];
  workspaceClassName?: string;
  containedWorkspace?: boolean;
  children: ReactNode;
  onProjectSelect: (projectId: string) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onMobileOpenChange: (open: boolean) => void;
  onLogout: () => void;
};

function ChromeIcon({ name }: { name: WorkspaceChromeAction['icon'] | 'close' | 'logout' | 'menu' | 'check' }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  const paths: Record<string, ReactNode> = {
    reserve: (
      <>
        <path d="M12 5v14M5 12h14" {...common} />
      </>
    ),
    visit: (
      <>
        <path d="M7 3.8h10a2 2 0 0 1 2 2v14.4H5V5.8a2 2 0 0 1 2-2Z" {...common} />
        <path d="M8.5 8h7M8.5 12h7M8.5 16h4" {...common} />
      </>
    ),
    sync: (
      <>
        <path d="M19.2 8.2A7.7 7.7 0 0 0 5.4 6.6L3 9" {...common} />
        <path d="M3 4.8V9h4.2M4.8 15.8a7.7 7.7 0 0 0 13.8 1.6L21 15" {...common} />
        <path d="M21 19.2V15h-4.2" {...common} />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" {...common} />
      </>
    ),
    logout: (
      <>
        <path d="M10 5H5.5A1.5 1.5 0 0 0 4 6.5v11A1.5 1.5 0 0 0 5.5 19H10" {...common} />
        <path d="m14.5 8 4 4-4 4M18.5 12H9" {...common} />
      </>
    ),
    menu: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" {...common} />
      </>
    ),
    check: (
      <>
        <path d="m5.5 12.5 4 4 9-9" {...common} />
      </>
    ),
  };

  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function WorkspaceProjectPicker({
  projects,
  selectedProjectId,
  labels,
  onSelect,
}: {
  projects: WorkspaceProject[];
  selectedProjectId: string;
  labels: WorkspaceProjectLabels;
  onSelect: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const selectedProject = selectedProjectId === 'all'
    ? null
    : projects.find(project => String(project.id) === String(selectedProjectId)) ?? null;
  const selectedLabel = selectedProject?.name ?? labels.allProjects;
  const selectedMeta = selectedProject ? labels.activeProject : labels.projectCount;
  const options = [
    { id: 'all', name: labels.allProjects, meta: labels.projectCount },
    ...projects.map(project => ({
      id: String(project.id),
      name: project.name ?? labels.activeProject,
      meta: String(project.location ?? project.city ?? project.address ?? labels.activeProject),
    })),
  ];

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: globalThis.MouseEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className={styles.projectPicker} ref={dropdownRef}>
      <button
        type="button"
        className={styles.projectTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className={styles.projectIndicator} aria-hidden="true" />
        <span className={styles.projectValue}>
          <strong>{selectedLabel}</strong>
          <small>{selectedMeta}</small>
        </span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className={styles.projectMenu} role="listbox" aria-label={labels.allProjects}>
          {options.map(option => {
            const active = option.id === selectedProjectId;
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`${styles.projectOption} ${active ? styles.projectOptionActive : ''}`}
                onClick={() => {
                  onSelect(option.id);
                  setOpen(false);
                }}
              >
                <span className={styles.projectIndicator} aria-hidden="true" />
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.meta}</small>
                </span>
                {active ? <ChromeIcon name="check" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceChrome({
  title,
  eyebrow,
  navigationLabel,
  navigationGroups,
  projects,
  selectedProjectId,
  projectLabels,
  userName,
  userRole,
  logoutLabel,
  openMenuLabel,
  closeMenuLabel,
  expandSidebarLabel,
  collapseSidebarLabel,
  collapsed,
  mobileOpen,
  actions,
  workspaceClassName = '',
  containedWorkspace = false,
  children,
  onProjectSelect,
  onCollapsedChange,
  onMobileOpenChange,
  onLogout,
}: WorkspaceChromeProps) {
  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || 'BT';

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMobileOpenChange(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen, onMobileOpenChange]);

  return (
    <main className={`${styles.shell} ${collapsed ? styles.shellCollapsed : ''} ${mobileOpen ? styles.shellMobileOpen : ''}`}>
      {mobileOpen ? (
        <button
          type="button"
          className={styles.scrim}
          aria-label={closeMenuLabel}
          onClick={() => onMobileOpenChange(false)}
        />
      ) : null}

      <aside
        className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''} ${mobileOpen ? styles.sidebarMobileOpen : ''}`}
        data-bt-i18n-skip="true"
      >
        <div className={styles.brandRow}>
          <div className={styles.brandWordmark}>
            <BuildTrackBrand variant="wordmark" size="sm" />
            <span>Web</span>
          </div>
          <div className={styles.brandMark}>
            <BuildTrackBrand variant="mark" size="sm" />
          </div>
          <button
            type="button"
            className={styles.mobileClose}
            aria-label={closeMenuLabel}
            onClick={() => onMobileOpenChange(false)}
          >
            <ChromeIcon name="close" />
          </button>
        </div>

        <button
          type="button"
          className={styles.collapseButton}
          aria-label={collapsed ? expandSidebarLabel : collapseSidebarLabel}
          title={collapsed ? expandSidebarLabel : collapseSidebarLabel}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <span className={`${styles.collapseChevron} ${collapsed ? styles.collapseChevronClosed : ''}`} aria-hidden="true" />
        </button>

        <nav className={styles.navigation} aria-label={navigationLabel}>
          {navigationGroups.map(group => (
            <div className={styles.navigationGroup} key={group.id}>
              <span className={styles.navigationGroupLabel}>{group.label}</span>
              <div className={styles.navigationItems}>
                {group.items.map(item => (
                  <button
                    type="button"
                    key={item.id}
                    className={`${styles.navigationItem} ${item.active ? styles.navigationItemActive : ''}`}
                    title={collapsed ? item.label : undefined}
                    aria-current={item.active ? 'page' : undefined}
                    aria-label={item.label}
                    onClick={item.onSelect}
                  >
                    <span className={styles.navigationIcon}>{item.icon}</span>
                    <span className={styles.navigationText}>{item.label}</span>
                    {item.badge !== undefined ? (
                      <span className={styles.navigationBadge} aria-label={item.badgeLabel}>
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={styles.accountCard}>
          <span className={styles.accountAvatar} aria-hidden="true">{initials}</span>
          <span className={styles.accountIdentity}>
            <strong>{userName}</strong>
            <small>{userRole}</small>
          </span>
          <button type="button" className={styles.logoutButton} onClick={onLogout} aria-label={logoutLabel} title={logoutLabel}>
            <ChromeIcon name="logout" />
            <span>{logoutLabel}</span>
          </button>
        </div>
      </aside>

      <section className={`${styles.workspace} ${containedWorkspace ? styles.workspaceContained : ''} ${workspaceClassName}`}>
        <header className={styles.topbar} data-bt-i18n-skip="true">
          <div className={styles.headingRow}>
            <button
              type="button"
              className={styles.mobileMenu}
              aria-label={openMenuLabel}
              onClick={() => onMobileOpenChange(true)}
            >
              <ChromeIcon name="menu" />
            </button>
            <div className={styles.heading}>
              <p>{eyebrow}</p>
              <h1>{title}</h1>
            </div>
          </div>

          <div className={styles.controls}>
            <WorkspaceProjectPicker
              projects={projects}
              selectedProjectId={selectedProjectId}
              labels={projectLabels}
              onSelect={onProjectSelect}
            />
            <div className={styles.actions}>
              {actions.map(action => (
                <button
                  type="button"
                  key={action.id}
                  className={`${styles.action} ${styles[`action_${action.variant ?? 'secondary'}`]}`}
                  disabled={action.disabled}
                  aria-busy={action.busy || undefined}
                  onClick={action.onClick}
                >
                  <span className={action.busy ? styles.spinning : ''}>
                    <ChromeIcon name={action.icon} />
                  </span>
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        </header>

        {children}
      </section>
    </main>
  );
}
