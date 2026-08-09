import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useBottomNavigationInset } from '@/hooks/useBottomNavigationInset';

const TABS = [
  { key: 'dashboard', icon: 'grid', iconOff: 'grid-outline', route: '/(tabs)/' },
  { key: 'reserves', icon: 'warning', iconOff: 'warning-outline', route: '/(tabs)/reserves' },
  { key: 'plans', icon: 'map', iconOff: 'map-outline', route: '/(tabs)/plans' },
  { key: 'messages', icon: 'chatbubbles', iconOff: 'chatbubbles-outline', route: '/(tabs)/messages' },
  { key: 'more', icon: 'hammer', iconOff: 'hammer-outline', route: '/(tabs)/more' },
] as const;

interface Props {
  activeTab?: 'dashboard' | 'reserves' | 'plans' | 'messages' | 'more';
}

export default function BottomNavBar({ activeTab = 'more' }: Props) {
  const { t } = useTranslation();
  const bottomInset = useBottomNavigationInset();
  const router = useRouter();
  const { unreadCount } = useApp();

  const bottomPad = Platform.OS === 'web' ? 34 : bottomInset + 12;
  const barHeight = Platform.OS === 'web' ? 90 : 72 + bottomInset;

  const TAB_KEYS = ['dashboard', 'reserves', 'plans', 'messages', 'more'] as const;
  const activeIndex = TAB_KEYS.indexOf(activeTab);

  return (
    <View style={[styles.container, { height: barHeight, paddingBottom: bottomPad }]}>
      {TABS.map((tab, i) => {
        const isActive = i === activeIndex;
        const hasBadge = i === 3 && unreadCount > 0;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => router.navigate(tab.route as any)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={hasBadge
              ? `${t(`tabs.${tab.key}`)} — ${t('notifications.unread', { count: unreadCount })}`
              : t(`tabs.${tab.key}`)}
          >
            <View style={styles.iconWrap}>
              <Ionicons
                name={isActive ? tab.icon : tab.iconOff}
                size={22}
                color={isActive ? C.primary : C.textMuted}
              />
              {hasBadge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, isActive && styles.labelActive]}>{t(`tabs.${tab.key}`)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: C.tabBar,
    borderTopWidth: 1,
    borderTopColor: C.tabBorder,
    ...Platform.select({
      web: { boxShadow: '0px -2px 8px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 8 },
    }),
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
  },
  iconWrap: { position: 'relative' },
  label: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: C.textMuted,
    marginTop: 3,
  },
  labelActive: { color: C.primary },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: C.open,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontFamily: 'Inter_700Bold' },
});
