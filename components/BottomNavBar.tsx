import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';

const TABS = [
  { icon: 'grid', iconOff: 'grid-outline', label: 'Dashboard', route: '/(tabs)/' },
  { icon: 'warning', iconOff: 'warning-outline', label: 'Réserves', route: '/(tabs)/reserves' },
  { icon: 'map', iconOff: 'map-outline', label: 'Plans', route: '/(tabs)/plans' },
  { icon: 'chatbubbles', iconOff: 'chatbubbles-outline', label: 'Messages', route: '/(tabs)/messages' },
  { icon: 'apps', iconOff: 'apps-outline', label: 'Modules', route: '/(tabs)/more' },
] as const;

interface Props {
  activeTab?: 'dashboard' | 'reserves' | 'plans' | 'messages' | 'more';
}

export default function BottomNavBar({ activeTab = 'more' }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unreadCount } = useApp();

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const barHeight = 50 + bottomPad;

  const activeIndex = ['dashboard', 'reserves', 'plans', 'messages', 'more'].indexOf(activeTab);

  return (
    <View style={[styles.container, { height: barHeight, paddingBottom: bottomPad }]}>
      {TABS.map((tab, i) => {
        const isActive = i === activeIndex;
        const hasBadge = i === 3 && unreadCount > 0;
        return (
          <TouchableOpacity
            key={tab.label}
            style={styles.tab}
            onPress={() => router.navigate(tab.route as any)}
            activeOpacity={0.7}
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
            <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
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
