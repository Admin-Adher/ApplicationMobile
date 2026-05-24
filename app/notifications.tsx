import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useNotifications, NotifType } from '@/context/NotificationsContext';
import { useLanguage } from '@/context/LanguageContext';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';

const TYPE_CONFIG: Record<NotifType, { icon: string; color: string; bg: string; labelKey: string }> = {
  critical_reserve: {
    icon: 'warning',
    color: '#EF4444',
    bg: '#FEF2F2',
    labelKey: 'notifications.types.critical_reserve',
  },
  overdue_reserve: {
    icon: 'time',
    color: '#F59E0B',
    bg: '#FFFBEB',
    labelKey: 'notifications.types.overdue_reserve',
  },
  due_soon_reserve: {
    icon: 'alarm-outline',
    color: '#6366F1',
    bg: '#EEF2FF',
    labelKey: 'notifications.types.due_soon_reserve',
  },
  late_task: {
    icon: 'calendar',
    color: '#8B5CF6',
    bg: '#F5F3FF',
    labelKey: 'notifications.types.late_task',
  },
  system: {
    icon: 'information-circle',
    color: C.primary,
    bg: C.primaryBg,
    labelKey: 'notifications.types.system',
  },
};

function localeForLanguage(language: string): string {
  if (language === 'en') return 'en-US';
  if (language === 'es') return 'es-ES';
  return 'fr-FR';
}

function timeAgo(dateStr: string, t: (key: string, options?: Record<string, unknown>) => string, locale: string): string {
  try {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 30) return d.toLocaleDateString(locale);
    if (days > 0) return t('notifications.time.days', { count: days });
    if (hours > 0) return t('notifications.time.hours', { count: hours });
    if (mins > 0) return t('notifications.time.minutes', { count: mins });
    return t('notifications.time.now');
  } catch {
    return '';
  }
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const { effectiveLanguage } = useLanguage();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const topPad = insets.top;

  function handlePress(id: string, route?: string, params?: Record<string, string>) {
    markRead(id);
    if (route) {
      if (params && Object.keys(params).length > 0) {
        router.push({ pathname: route as any, params } as any);
      } else {
        router.push(route as any);
      }
    }
  }

  const unread = notifications.filter(n => !n.read);
  const read = notifications.filter(n => n.read);

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <Header
        title={t('notifications.title')}
        subtitle={unreadCount > 0 ? t('notifications.unread', { count: unreadCount }) : t('notifications.upToDate')}
        onBack={() => router.back()}
        rightElement={
          unreadCount > 0 ? (
            <TouchableOpacity style={styles.markAllBtn} onPress={markAllRead}>
              <Text style={styles.markAllText}>{t('notifications.markAllRead')}</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {notifications.length === 0 && (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="notifications-off-outline" size={36} color={C.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>{t('notifications.emptyTitle')}</Text>
            <Text style={styles.emptySub}>
              {t('notifications.emptyText')}
            </Text>
          </View>
        )}

        {unread.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>{t('notifications.unreadSection')}</Text>
            {unread.map(n => {
              const cfg = TYPE_CONFIG[n.type];
              return (
                <TouchableOpacity
                  key={n.id}
                  style={[styles.card, styles.cardUnread]}
                  activeOpacity={0.75}
                  onPress={() => handlePress(n.id, n.route, n.routeParams)}
                >
                  <View style={[styles.iconWrap, { backgroundColor: cfg.bg }]}>
                    <Ionicons name={cfg.icon as any} size={18} color={cfg.color} />
                  </View>
                  <View style={styles.cardContent}>
                    <View style={styles.cardTop}>
                      <Text style={[styles.cardType, { color: cfg.color }]}>{t(cfg.labelKey)}</Text>
                      <Text style={styles.cardTime}>{timeAgo(n.createdAt, t, localeForLanguage(effectiveLanguage))}</Text>
                    </View>
                    <Text style={styles.cardBody} numberOfLines={2}>{n.body}</Text>
                  </View>
                  <View style={styles.unreadDot} />
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {read.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>{unread.length > 0 ? t('notifications.readSection') : t('notifications.allSection')}</Text>
            {read.map(n => {
              const cfg = TYPE_CONFIG[n.type];
              return (
                <TouchableOpacity
                  key={n.id}
                  style={styles.card}
                  activeOpacity={0.75}
                  onPress={() => handlePress(n.id, n.route, n.routeParams)}
                >
                  <View style={[styles.iconWrap, { backgroundColor: C.surface2 }]}>
                    <Ionicons name={cfg.icon as any} size={18} color={C.textMuted} />
                  </View>
                  <View style={styles.cardContent}>
                    <View style={styles.cardTop}>
                      <Text style={[styles.cardType, { color: C.textMuted }]}>{t(cfg.labelKey)}</Text>
                      <Text style={styles.cardTime}>{timeAgo(n.createdAt, t, localeForLanguage(effectiveLanguage))}</Text>
                    </View>
                    <Text style={[styles.cardBody, { color: C.textSub }]} numberOfLines={2}>{n.body}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>
      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  content: {
    padding: 16,
    gap: 8,
    paddingBottom: 100,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  emptySub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 2,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardUnread: {
    borderColor: C.primary + '30',
    backgroundColor: C.surface,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardContent: {
    flex: 1,
    gap: 3,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardType: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cardTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
  cardBody: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.text,
    lineHeight: 18,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
    marginTop: 4,
    flexShrink: 0,
  },
  markAllBtn: {
    backgroundColor: C.primaryBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  markAllText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.primary,
  },
});
