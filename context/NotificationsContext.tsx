import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { parseDeadline, isOverdue } from '@/lib/reserveUtils';

const SEEN_PREFIX = 'buildtrack_notif_seen_v2_';

function parseSortable(s: string): number {
  if (!s || s === '—') return 0;
  const fr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (fr) {
    const t = new Date(`${fr[3]}-${fr[2]}-${fr[1]}`).getTime();
    return isNaN(t) ? 0 : t;
  }
  const t = new Date(s).getTime();
  return isNaN(t) ? 0 : t;
}

export type NotifType = 'critical_reserve' | 'overdue_reserve' | 'due_soon_reserve' | 'late_task' | 'system';

export interface AppNotification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  route?: string;
  routeParams?: Record<string, string>;
  createdAt: string;
  read: boolean;
}

interface NotificationsContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  notifications: [],
  unreadCount: 0,
  markRead: () => {},
  markAllRead: () => {},
});

export function useNotifications() {
  return useContext(NotificationsContext);
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { reserves, tasks, activeChantierId, companies } = useApp();
  const { user } = useAuth();
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const seenKey = SEEN_PREFIX + (user?.id ?? 'anon');

  useEffect(() => {
    AsyncStorage.getItem(seenKey).then(raw => {
      if (raw) {
        try {
          const parsed: string[] = JSON.parse(raw);
          // Keep only the 200 most recent seen IDs to prevent unbounded growth
          const capped = parsed.slice(-200);
          setSeenIds(new Set(capped));
        } catch {}
      }
    });
  }, [seenKey]);

  async function persistSeen(updated: Set<string>) {
    try {
      await AsyncStorage.setItem(seenKey, JSON.stringify([...updated]));
    } catch {}
  }

  const notifications: AppNotification[] = React.useMemo(() => {
    const result: AppNotification[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isSousTraitant = user?.role === 'sous_traitant';
    const sousTraitantCompanyName = isSousTraitant && user?.companyId
      ? companies.find(c => c.id === user.companyId)?.name ?? null
      : null;

    let visibleReserves = activeChantierId
      ? reserves.filter(r => r.chantierId === activeChantierId)
      : reserves;

    if (isSousTraitant && sousTraitantCompanyName) {
      visibleReserves = visibleReserves.filter(r => {
        const names = r.companies ?? (r.company ? [r.company] : []);
        return names.includes(sousTraitantCompanyName!);
      });
    }

    const activeReserves = visibleReserves;

    for (const r of activeReserves) {
      const isCritical = r.priority === 'critical' && r.status !== 'closed';
      const isLate = r.status !== 'closed' && isOverdue(r.deadline, r.status);

      if (isCritical) {
        result.push({
          id: `crit_${r.id}`,
          type: 'critical_reserve',
          title: 'Réserve critique',
          body: isLate ? `${r.title} — critique et en retard` : r.title,
          route: '/reserve/[id]',
          routeParams: { id: r.id },
          createdAt: r.createdAt,
          read: seenIds.has(`crit_${r.id}`),
        });
      } else if (isLate) {
        result.push({
          id: `late_${r.id}`,
          type: 'overdue_reserve',
          title: 'Réserve en retard',
          body: `${r.title} — échéance dépassée`,
          route: '/reserve/[id]',
          routeParams: { id: r.id },
          createdAt: r.deadline || r.createdAt,
          read: seenIds.has(`late_${r.id}`),
        });
      }
      if (r.status !== 'closed' && r.deadline && r.deadline !== '—') {
        const deadlineDate = parseDeadline(r.deadline);
        if (deadlineDate !== null) {
          const daysLeft = Math.floor((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (daysLeft >= 0 && daysLeft <= 3 && !isOverdue(r.deadline, r.status)) {
            const label = daysLeft === 0 ? "aujourd'hui" : daysLeft === 1 ? 'demain' : `dans ${daysLeft} jours`;
            result.push({
              id: `soon_${r.id}`,
              type: 'due_soon_reserve',
              title: 'Échéance imminente',
              body: `${r.title} — échéance ${label}`,
              route: '/reserve/[id]',
              routeParams: { id: r.id },
              createdAt: r.createdAt,
              read: seenIds.has(`soon_${r.id}`),
            });
          }
        }
      }
    }

    const activeTasks = activeChantierId
      ? tasks.filter(t => t.chantierId === activeChantierId)
      : tasks;

    for (const t of activeTasks) {
      if (t.status !== 'done') {
        const d = parseDeadline(t.deadline);
        const isLate = t.status === 'delayed' || (d !== null && d < today);
        if (isLate) {
          result.push({
            id: `task_${t.id}`,
            type: 'late_task',
            title: 'Tâche en retard',
            body: t.title,
            route: '/planning',
            createdAt: t.deadline || t.createdAt || new Date().toISOString(),
            read: seenIds.has(`task_${t.id}`),
          });
        }
      }
    }

    result.sort((a, b) => parseSortable(b.createdAt) - parseSortable(a.createdAt));
    return result;
  }, [reserves, tasks, activeChantierId, seenIds, user, companies]);

  // Prune seenIds whenever the notification set changes —
  // removes stale IDs for notifications that no longer exist
  useEffect(() => {
    setSeenIds(prev => {
      const currentIds = new Set(notifications.map(n => n.id));
      const pruned = new Set([...prev].filter(id => currentIds.has(id)));
      if (pruned.size === prev.size) return prev;
      persistSeen(pruned);
      return pruned;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.length]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markRead = useCallback((id: string) => {
    setSeenIds(prev => {
      const updated = new Set(prev).add(id);
      persistSeen(updated);
      return updated;
    });
  }, [seenKey]);

  const markAllRead = useCallback(() => {
    setSeenIds(prev => {
      const updated = new Set(prev);
      notifications.forEach(n => updated.add(n.id));
      persistSeen(updated);
      return updated;
    });
  }, [notifications, seenKey]);

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markRead, markAllRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}
