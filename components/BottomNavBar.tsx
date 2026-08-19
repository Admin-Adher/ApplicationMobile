import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useBottomNavigationInset } from '@/hooks/useBottomNavigationInset';
import { isConducteurRole, isOrgAdminRole } from '@/lib/roleNavigation';

const TABS = [
  { key: 'dashboard', icon: 'sunny', iconOff: 'sunny-outline', route: '/(tabs)/' },
  { key: 'plans', icon: 'map', iconOff: 'map-outline', route: '/(tabs)/plans' },
  { key: 'reserves', icon: 'warning', iconOff: 'warning-outline', route: '/(tabs)/reserves' },
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
  const { user } = useAuth();
  const tabs = isOrgAdminRole(user?.role)
    ? [
        { key: 'pilotage' as const, labelKey: 'tabs.pilotage', icon: 'briefcase' as const, iconOff: 'briefcase-outline' as const, route: '/(tabs)/admin' },
        { key: 'dashboard' as const, labelKey: 'tabs.dashboard', icon: 'sunny' as const, iconOff: 'sunny-outline' as const, route: '/(tabs)/' },
        { key: 'plans' as const, icon: 'map' as const, iconOff: 'map-outline' as const, route: '/(tabs)/plans' },
        { key: 'reserves' as const, icon: 'warning' as const, iconOff: 'warning-outline' as const, route: '/(tabs)/reserves' },
        { key: 'more' as const, icon: 'hammer' as const, iconOff: 'hammer-outline' as const, route: '/(tabs)/more' },
      ]
    : isConducteurRole(user?.role) ? TABS.filter(tab => tab.key !== 'messages') : TABS;

  const bottomPad = Platform.OS === 'web' ? 34 : bottomInset + 12;
  const barHeight = Platform.OS === 'web' ? 90 : 72 + bottomInset;

  const activeIndex = tabs.findIndex(tab => tab.key === activeTab);

  return (
    <View style={[styles.container, { height: barHeight, paddingBottom: bottomPad }]}>
      {tabs.map((tab, i) => {
        const isActive = i === activeIndex;
        const hasBadge = tab.key === 'messages' && unreadCount > 0;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => router.navigate(tab.route as any)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={hasBadge
              ? `${t(('labelKey' in tab ? tab.labelKey : `tabs.${tab.key}`) as any)} — ${t('notifications.unread', { count: unreadCount })}`
              : t(('labelKey' in tab ? tab.labelKey : `tabs.${tab.key}`) as any)}
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
            <Text style={[styles.label, isActive && styles.labelActive]}>{t(('labelKey' in tab ? tab.labelKey : `tabs.${tab.key}`) as any)}</Text>
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
