import { Tabs } from 'expo-router';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';

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

export default function TabLayout() {
  const { unreadCount } = useApp();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textMuted,
        tabBarStyle: {
          backgroundColor: C.tabBar,
          borderTopColor: C.tabBorder,
          borderTopWidth: 1,
          height: Platform.OS === 'web' ? 84 : 62,
          paddingBottom: Platform.OS === 'web' ? 34 : 8,
          paddingTop: 8,
          elevation: 8,
          ...Platform.select({
            web: { boxShadow: '0px -2px 8px rgba(0,0,0,0.06)' } as any,
            default: { shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 8 },
          }),
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_600SemiBold',
          fontSize: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <TabIcon name="grid" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="reserves"
        options={{
          title: 'Réserves',
          tabBarIcon: ({ color, size }) => <TabIcon name="warning" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="plans"
        options={{
          title: 'Plans',
          tabBarIcon: ({ color, size }) => <TabIcon name="map" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="chatbubbles" color={color} size={size} badge={unreadCount} />
          ),
        }}
      />
      <Tabs.Screen
        name="incidents"
        options={{
          title: 'Incidents',
          tabBarIcon: ({ color, size }) => <TabIcon name="shield" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'Plus',
          tabBarIcon: ({ color, size }) => <TabIcon name="grid-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="equipes"
        options={{
          title: 'Équipes',
          tabBarIcon: ({ color, size }) => <TabIcon name="people" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="shield-checkmark" size={size} color={color} />
          ),
        }}
      />
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
});
