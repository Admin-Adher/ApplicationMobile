import { Tabs, usePathname, useRouter } from 'expo-router';
import { Platform, View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useIncidents } from '@/context/IncidentsContext';
import { TABLET_SIDEBAR_W } from '@/lib/useTablet';

const TAB_ITEMS = [
  { name: 'index',    title: 'Dashboard', icon: 'grid',          iconOutline: 'grid-outline',        path: '/(tabs)/' },
  { name: 'plans',    title: 'Plans',     icon: 'map',           iconOutline: 'map-outline',         path: '/(tabs)/plans' },
  { name: 'reserves', title: 'Réserves',  icon: 'warning',       iconOutline: 'warning-outline',     path: '/(tabs)/reserves' },
  { name: 'messages', title: 'Messages',  icon: 'chatbubbles',   iconOutline: 'chatbubbles-outline', path: '/(tabs)/messages' },
  { name: 'more',     title: 'Terrain',   icon: 'hammer',        iconOutline: 'hammer-outline',      path: '/(tabs)/more' },
] as const;

function TabIcon({ name, color, size, badge }: { name: any; color: string; size: number; badge?: number }) {
  return (
    <View>
      <Ionicons name={name} size={size} color={color} />
      {badge && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

function TabletSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { unreadCount, stats } = useApp();
  const { incidents } = useIncidents();
  const openIncidentsCount = incidents.filter(i => i.status !== 'resolved').length;
  const insets = useSafeAreaInsets();

  function getActiveTab(): string {
    const p = pathname;
    if (p === '/' || p === '' || p === '/index' || p === '/(tabs)' || p === '/(tabs)/') return 'index';
    for (const tab of TAB_ITEMS) {
      if (tab.name === 'index') continue;
      if (p === `/${tab.name}` || p.startsWith(`/${tab.name}/`) ||
          p === `/(tabs)/${tab.name}` || p.startsWith(`/(tabs)/${tab.name}/`)) {
        return tab.name;
      }
    }
    return 'index';
  }

  const activeTab = getActiveTab();

  return (
    <View style={[styles.sidebar, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
      <TouchableOpacity
        style={styles.sidebarLogo}
        onPress={() => router.navigate('/(tabs)/' as any)}
        activeOpacity={0.7}
        hitSlop={8}
      >
        <Image
          source={require('../../assets/images/icon.png')}
          style={styles.sidebarLogoMark}
          resizeMode="contain"
        />
      </TouchableOpacity>

      <View style={styles.sidebarDivider} />

      {TAB_ITEMS.map(tab => {
        const isFocused = activeTab === tab.name;
        const badgeCount =
          tab.name === 'messages' ? unreadCount :
          tab.name === 'reserves' ? stats.open :
          tab.name === 'more' ? openIncidentsCount :
          0;
        const hasBadge = badgeCount > 0;

        return (
          <TouchableOpacity
            key={tab.name}
            style={[styles.sidebarItem, isFocused && styles.sidebarItemActive]}
            onPress={() => router.navigate(tab.path as any)}
            activeOpacity={0.75}
          >
            <View style={styles.sidebarIconWrap}>
              <Ionicons
                name={isFocused ? tab.icon : tab.iconOutline}
                size={24}
                color={isFocused ? C.primary : C.textMuted}
              />
              {hasBadge && (
                <View style={styles.sidebarBadge}>
                  <Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.sidebarLabel, isFocused && styles.sidebarLabelActive]} numberOfLines={1}>
              {tab.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function TabsNavigator() {
  const { unreadCount, stats } = useApp();
  const { incidents } = useIncidents();
  const openIncidentsCount = incidents.filter(i => i.status !== 'resolved').length;
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textMuted,
        tabBarStyle: isTablet ? { display: 'none' } : {
          backgroundColor: C.tabBar,
          borderTopColor: C.tabBorder,
          borderTopWidth: 1,
          height: Platform.OS === 'web' ? 90 : 72,
          paddingBottom: Platform.OS === 'web' ? 34 : 12,
          paddingTop: 10,
          elevation: 8,
          ...Platform.select({
            web: { boxShadow: '0px -2px 8px rgba(0,0,0,0.06)' } as any,
            default: { shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 8 },
          }),
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_600SemiBold',
          fontSize: 11,
        },
        tabBarIconStyle: {
          marginBottom: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'grid' : 'grid-outline'} color={color} size={26} />,
        }}
      />
      <Tabs.Screen
        name="plans"
        options={{
          title: 'Plans',
          tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'map' : 'map-outline'} color={color} size={26} />,
        }}
      />
      <Tabs.Screen
        name="reserves"
        options={{
          title: 'Réserves',
          tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'warning' : 'warning-outline'} color={color} size={26} badge={stats.open} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'chatbubbles' : 'chatbubbles-outline'} color={color} size={26} badge={unreadCount} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'Terrain',
          tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'hammer' : 'hammer-outline'} color={color} size={26} badge={openIncidentsCount} />,
        }}
      />
      <Tabs.Screen name="incidents" options={{ href: null }} />
      <Tabs.Screen name="equipes"   options={{ href: null }} />
      <Tabs.Screen name="admin"     options={{ href: null }} />
    </Tabs>
  );
}

export default function TabLayout() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  if (isTablet) {
    return (
      <View style={styles.tabletWrapper}>
        <TabletSidebar />
        <View style={styles.tabletContent}>
          <TabsNavigator />
        </View>
      </View>
    );
  }

  return <TabsNavigator />;
}

const styles = StyleSheet.create({
  tabletWrapper: {
    flex: 1,
    flexDirection: 'row',
  },
  tabletContent: {
    flex: 1,
  },
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
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
  },
  sidebar: {
    width: TABLET_SIDEBAR_W,
    backgroundColor: C.tabBar,
    borderRightWidth: 1,
    borderRightColor: C.tabBorder,
    alignItems: 'center',
    ...Platform.select({
      web: { boxShadow: '1px 0 4px rgba(0,0,0,0.08)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 1, height: 0 }, shadowOpacity: 0.08, shadowRadius: 4 },
    }),
  },
  sidebarLogo: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 8,
  },
  sidebarLogoMark: {
    width: 38,
    height: 38,
    borderRadius: 10,
  },
  sidebarDivider: {
    width: 40,
    height: 1,
    backgroundColor: C.border,
    marginVertical: 10,
  },
  sidebarItem: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 2,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  sidebarItemActive: {
    backgroundColor: C.primaryBg,
    borderLeftColor: C.primary,
  },
  sidebarIconWrap: {
    position: 'relative',
    marginBottom: 4,
  },
  sidebarBadge: {
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
  sidebarLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: C.textMuted,
    textAlign: 'center',
  },
  sidebarLabelActive: {
    color: C.primary,
  },
});
