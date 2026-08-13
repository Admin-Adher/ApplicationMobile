'use client';

import type { ReactNode } from 'react';
import styles from './WorkspaceChrome.module.css';

export type WorkspaceIconName =
  | 'archive'
  | 'assistant'
  | 'back'
  | 'building'
  | 'chevron'
  | 'close'
  | 'document'
  | 'filter'
  | 'more'
  | 'pin'
  | 'plan'
  | 'plus'
  | 'search'
  | 'warning';

export function WorkspaceIcon({ name, size = 20 }: { name: WorkspaceIconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
  if (name === 'plus') return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === 'filter') return <svg {...common}><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
  if (name === 'back') return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
  if (name === 'chevron') return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  if (name === 'close') return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === 'document') return <svg {...common}><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
  if (name === 'plan') return <svg {...common}><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></svg>;
  if (name === 'building') return <svg {...common}><path d="M4 21V5l8-3 8 3v16M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M9 21v-5h6v5" /></svg>;
  if (name === 'pin') return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
  if (name === 'warning') return <svg {...common}><path d="M10.3 3.8 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.8a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
  if (name === 'archive') return <svg {...common}><path d="M4 7h16v14H4V7ZM3 3h18v4H3V3ZM9 11h6" /></svg>;
  if (name === 'assistant') return <svg {...common}><path d="m12 3 1.1 3.9L17 8l-3.9 1.1L12 13l-1.1-3.9L7 8l3.9-1.1L12 3Z" /><path d="m18 14 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7L18 14Z" /></svg>;
  if (name === 'more') return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>;
}

export type WorkspaceMetric = {
  label: string;
  value: number;
  tone?: 'blue' | 'orange' | 'danger' | 'green';
};

export function WorkspacePageHeader({
  eyebrow,
  title,
  description,
  metrics,
  actions,
  compactDetail = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  metrics: WorkspaceMetric[];
  actions?: ReactNode;
  compactDetail?: boolean;
}) {
  return (
    <header
      className={styles.header}
      data-compact-detail={compactDetail}
    >
      <div className={styles.heading}>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
        <span>{description}</span>
      </div>
      <dl className={styles.metrics} aria-label={title}>
        {metrics.map(metric => (
          <div key={metric.label} data-tone={metric.tone ?? 'blue'}>
            <dt>{metric.label}</dt>
            <dd>{metric.value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}

export function WorkspaceSearch({
  value,
  placeholder,
  clearLabel,
  onChange,
}: {
  value: string;
  placeholder: string;
  clearLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.search}>
      <WorkspaceIcon name="search" size={19} />
      <span className={styles.srOnly}>{placeholder}</span>
      <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
      {value ? (
        <button type="button" onClick={() => onChange('')} aria-label={clearLabel}>
          <WorkspaceIcon name="close" size={18} />
        </button>
      ) : null}
    </label>
  );
}

export function WorkspaceBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.backButton} onClick={onClick}>
      <WorkspaceIcon name="back" />
      <span>{label}</span>
    </button>
  );
}
