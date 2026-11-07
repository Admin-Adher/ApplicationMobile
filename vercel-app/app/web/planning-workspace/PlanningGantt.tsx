'use client';

import { Fragment, useMemo, useState } from 'react';
import { buildPlanningGantt, groupPlanningGantt } from './planning-model';
import styles from './PlanningGantt.module.css';

export default function PlanningGantt({ tasks, companies, locale, onOpenTask }: { tasks: any[]; companies: any[]; locale: string; onOpenTask: (id: string) => void }) {
  const [reference, setReference] = useState(() => new Date());
  const [scale, setScale] = useState<'week' | 'month'>('week');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const { days, rows } = useMemo(() => {
    const start = scale === 'month' ? new Date(reference.getFullYear(), reference.getMonth(), 1) : reference;
    return buildPlanningGantt(tasks, start, scale === 'month' ? 42 : 14);
  }, [reference, scale, tasks]);
  const groups = useMemo(() => groupPlanningGantt(rows, companies), [companies, rows]);
  const short = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }), [locale]);
  const full = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }), [locale]);

  function move(direction: number) {
    setReference(previous => scale === 'month'
      ? new Date(previous.getFullYear(), previous.getMonth() + direction, 1)
      : new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() + direction * 14));
  }

  function toggleCompany(key: string) {
    setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <section className={styles.gantt} aria-label="Diagramme de Gantt">
      <div className={styles.header}>
        <strong aria-live="polite">{short.format(days[0])} – {short.format(days.at(-1)!)}</strong>
        <div>
          <button type="button" onClick={() => move(-1)}>Période précédente</button>
          <button type="button" onClick={() => setReference(new Date())}>Aujourd’hui</button>
          <button type="button" onClick={() => move(1)}>Période suivante</button>
        </div>
        <fieldset className={styles.scale}>
          <legend>Échelle du Gantt</legend>
          <button type="button" aria-pressed={scale === 'week'} onClick={() => setScale('week')}>Semaine</button>
          <button type="button" aria-pressed={scale === 'month'} onClick={() => setScale('month')}>Mois</button>
        </fieldset>
      </div>
      {!rows.length ? <p>Aucune tâche datée sur cette période.</p> : (
        <div className={styles.scroll} tabIndex={0} aria-label="Calendrier des tâches">
          <div className={styles.grid} style={{ gridTemplateColumns: `11rem repeat(${days.length}, minmax(${scale === 'month' ? '1.5' : '2.75'}rem, 1fr))` }}>
            <span className={styles.title}>Entreprise / Tâche</span>
            {days.map(day => <time key={day.toISOString()} className={styles.day} dateTime={day.toISOString()}>{short.format(day)}</time>)}
            {groups.map(group => <Fragment key={group.key}>
              <button type="button" className={styles.company} aria-expanded={!collapsed.has(group.key)} onClick={() => toggleCompany(group.key)}>
                <span aria-hidden="true">{collapsed.has(group.key) ? '▸' : '▾'}</span> {group.name} <span>({group.rows.length})</span>
              </button>
              {!collapsed.has(group.key) && group.rows.map(({ task, from, to, startDate, endDate }) => (
                <div key={task.id} className={styles.row}>
                  <button type="button" className={styles.task} onClick={() => onOpenTask(String(task.id))}>{task.title}</button>
                  <div className={styles.timeline}>
                    <button type="button" className={styles.bar} data-done={task.status === 'done'}
                      style={{ left: `${from / days.length * 100}%`, width: `${(to - from + 1) / days.length * 100}%` }}
                      onClick={() => onOpenTask(String(task.id))}
                      aria-label={task.title + ' du ' + full.format(startDate) + ' au ' + full.format(endDate)}
                      title={full.format(startDate) + ' – ' + full.format(endDate)} />
                  </div>
                </div>
              ))}
            </Fragment>)}
          </div>
        </div>
      )}
    </section>
  );
}
