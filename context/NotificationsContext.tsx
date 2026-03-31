import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp } from '@/context/AppContext';
import { parseDeadline, isOverdue } from '@/lib/reserveUtils';

const SEEN_KEY = 'buildtrack_notif_seen_v1';

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
  const { reserves, tasks, activeChantierId } = useApp();
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY).then(raw => {
      if (raw) {
        try { setSeenIds(new Set(JSON.parse(raw))); } catch {}
      }
    });
  }, []);

  async function persistSeen(updated: Set<string>) {
    try {
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...updated]));
    } catch {}
  }

  const notifications: AppNotification[] = React.useMemo(() => {
    const result: AppNotification[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activeReserves = activeChantierId
      ? reserves.filter(r => r.chantierId === activeChantierId)
      : reserves;

    for (const r of activeReserves) {
      if (r.priority === 'critical' && r.status !== 'closed') {
        result.push({
          id: `crit_${r.id}`,
          type: 'critical_reserve',
          title: 'Réserve critique',
          body: r.title,
          route: '/reserve/[id]',
          routeParams: { id: r.id },
          createdAt: r.createdAt,
          read: seenIds.has(`crit_${r.id}`),
        });
      }
      if (r.status !== 'closed' && isOverdue(r.deadline, r.status)) {
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

    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return result;
  }, [reserves, tasks, activeChantierId, seenIds]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markRead = useCallback((id: string) => {
    setSeenIds(prev => {
      const updated = new Set(prev).add(id);
      persistSeen(updated);
      return updated;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setSeenIds(prev => {
      const updated = new Set(prev);
      notifications.forEach(n => updated.add(n.id));
      persistSeen(updated);
      return updated;
    });
  }, [notifications]);

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markRead, markAllRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}
