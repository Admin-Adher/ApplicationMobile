import { Tabs } from 'expo-router';
import { Platform, View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { TABLET_SIDEBAR_W } from '@/lib/useTablet';

const TAB_ITEMS = [
  { name: 'index',    title: 'Dashboard', icon: 'grid',          iconOutline: 'grid-outline' },
  { name: 'reserves', title: 'Réserves',  icon: 'warning',       iconOutline: 'warning-outline' },
  { name: 'plans',    title: 'Plans',     icon: 'map',           iconOutline: 'map-outline' },
  { name: 'messages', title: 'Messages',  icon: 'chatbubbles',   iconOutline: 'chatbubbles-outline' },
  { name: 'more',     title: 'Terrain',   icon: 'hammer',        iconOutline: 'hammer-outline' },
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

function TabletSidebar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { unreadCount } = useApp();

  return (
    <View style={[styles.sidebar, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.sidebarLogo}>
        <View style={styles.sidebarLogoMark}>
          <Text style={styles.sidebarLogoText}>BT</Text>
        </View>
      </View>

      <View style={styles.sidebarDivider} />

      {TAB_ITEMS.map(tab => {
        const routeIndex = state.routes.findIndex(r => r.name === tab.name);
        if (routeIndex === -1) return null;
        const isFocused = state.index === routeIndex;
        const hasBadge = tab.name === 'messages' && unreadCount > 0;

        return (
          <TouchableOpacity
            key={tab.name}
            style={[styles.sidebarItem, isFocused && styles.sidebarItemActive]}
            onPress={() => navigation.navigate(tab.name)}
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
                  <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
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

export default function TabLayout() {
  const { unreadCount } = useApp();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  return (
    <Tabs
      {...(isTablet ? {
        tabBar: (props) => <TabletSidebar {...props} />,
        sceneContainerStyle: { marginLeft: TABLET_SIDEBAR_W },
      } : {})}
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
          tabBarIcon: ({ color }) => <TabIcon name="grid" color={color} size={26} />,
        }}
      />
      <Tabs.Screen
        name="reserves"
        options={{
          title: 'Réserves',
          tabBarIcon: ({ color }) => <TabIcon name="warning" color={color} size={26} />,
        }}
      />
      <Tabs.Screen
        name="plans"
        options={{
          title: 'Plans',
          tabBarIcon: ({ color }) => <TabIcon name="map" color={color} size={26} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color }) => (
            <TabIcon name="chatbubbles" color={color} size={26} badge={unreadCount} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'Terrain',
          tabBarIcon: ({ color }) => <TabIcon name="hammer-outline" color={color} size={26} />,
        }}
      />
      <Tabs.Screen name="incidents" options={{ href: null }} />
      <Tabs.Screen name="equipes"   options={{ href: null }} />
      <Tabs.Screen name="admin"     options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
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
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: TABLET_SIDEBAR_W,
    backgroundColor: C.tabBar,
    borderRightWidth: 1,
    borderRightColor: C.tabBorder,
    alignItems: 'center',
    zIndex: 200,
    ...Platform.select({
      web: { boxShadow: '2px 0 8px rgba(0,0,0,0.07)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 2, height: 0 }, shadowOpacity: 0.07, shadowRadius: 8 },
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
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarLogoText: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    letterSpacing: 0.5,
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
    borderRadius: 0,
    marginBottom: 2,
  },
  sidebarItemActive: {
    backgroundColor: C.primary + '12',
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
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: C.textMuted,
    textAlign: 'center',
  },
  sidebarLabelActive: {
    color: C.primary,
  },
});
