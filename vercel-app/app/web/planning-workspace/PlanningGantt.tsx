'use client';

import { useMemo, useState } from 'react';
import { buildPlanningGantt } from './planning-model';
import styles from './PlanningGantt.module.css';

export default function PlanningGantt({ tasks, locale, onOpenTask }: { tasks: any[]; locale: string; onOpenTask: (id: string) => void }) {
  const [reference, setReference] = useState(() => new Date());
  const { days, rows } = useMemo(() => buildPlanningGantt(tasks, reference), [reference, tasks]);
  const short = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }), [locale]);
  const full = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }), [locale]);

  function move(weeks: number) {
    setReference(previous => {
      const date = new Date(previous);
      date.setDate(date.getDate() + weeks * 7);
      return date;
    });
  }

  return (
    <section className={styles.gantt} aria-label="Diagramme de Gantt">
      <div className={styles.header}>
        <strong>{short.format(days[0])} – {short.format(days.at(-1)!)}</strong>
        <div>
          <button type="button" onClick={() => move(-2)}>Période précédente</button>
          <button type="button" onClick={() => setReference(new Date())}>Aujourd’hui</button>
          <button type="button" onClick={() => move(2)}>Période suivante</button>
        </div>
      </div>
      {!rows.length ? <p>Aucune tâche datée sur cette période.</p> : (
        <div className={styles.scroll} tabIndex={0} aria-label="Calendrier des tâches">
          <div className={styles.grid}>
            <span className={styles.title}>Tâche</span>
            {days.map(day => <time key={day.toISOString()} className={styles.day}>{short.format(day)}</time>)}
            {rows.map(({ task, from, to, startDate, endDate }, row) => (
              <div key={task.id} className={styles.row}>
                <button type="button" className={styles.task} style={{ gridRow: row + 2 }} onClick={() => onOpenTask(String(task.id))}>{task.title}</button>
                <div className={styles.bar} data-done={task.status === 'done'} style={{ gridRow: row + 2, gridColumn: (from + 2) + ' / ' + (to + 3) }}
                  aria-label={task.title + ' du ' + full.format(startDate) + ' au ' + full.format(endDate)}
                  title={full.format(startDate) + ' – ' + full.format(endDate)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
