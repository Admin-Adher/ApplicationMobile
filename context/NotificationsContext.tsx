import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useNotificationPreferences } from '@/context/NotificationPreferencesContext';
import { buildWorkspaceAlerts } from '@/lib/workspaceAlerts';
import { isSameUserName } from '@/lib/mappers';
import i18n from '@/lib/i18n';

const SEEN_PREFIX = 'buildtrack_notif_seen_v2_';

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
  const { reserves, tasks, activeChantierId, companies, unreadCount: unreadMessagesCount } = useApp();
  const { user } = useAuth();
  const { preferences } = useNotificationPreferences();
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
        return names.some(name => isSameUserName(name, sousTraitantCompanyName));
      });
    }


    const visibleTasks = isSousTraitant ? [] : activeChantierId
      ? tasks.filter(task => task.chantierId === activeChantierId)
      : tasks;

    return buildWorkspaceAlerts(visibleReserves, visibleTasks, preferences).map(alert => {
      let body = alert.title;
      if (alert.type === 'critical_reserve' && alert.overdue) {
        body = i18n.t('notifications.bodies.criticalLate', { title: alert.title });
      } else if (alert.type === 'overdue_reserve') {
        body = i18n.t('notifications.bodies.overdueReserve', { title: alert.title });
      } else if (alert.type === 'due_soon_reserve') {
        const label = alert.daysLeft === 0
          ? i18n.t('notifications.bodies.today')
          : alert.daysLeft === 1
            ? i18n.t('notifications.bodies.tomorrow')
            : i18n.t('notifications.bodies.inDays', { count: alert.daysLeft });
        body = i18n.t('notifications.bodies.dueSoonReserve', { title: alert.title, label });
      }
      return {
        id: alert.id,
        type: alert.type,
        title: i18n.t('notifications.types.' + alert.type),
        body,
        route: alert.target.kind === 'reserve' ? '/reserve/[id]' : '/task/[id]',
        routeParams: { id: alert.target.id },
        createdAt: alert.createdAt,
        read: seenIds.has(alert.id),
      };
    });
  }, [reserves, tasks, activeChantierId, seenIds, user, companies, preferences]);

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

  // Badge sur l'icône de l'app (écran d'accueil) : total des messages non lus
  // + notifications du centre non lues. Sans cela, le compteur n'existait que
  // dans l'app — l'icône ne signalait jamais rien.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    try {
      const Notifications = require('expo-notifications');
      const total = Math.max(0, (unreadMessagesCount ?? 0) + unreadCount);
      Notifications.setBadgeCountAsync?.(total)?.catch?.(() => {});
    } catch {
      // expo-notifications indisponible (Expo Go / web) — badge ignoré
    }
  }, [unreadCount, unreadMessagesCount]);

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
