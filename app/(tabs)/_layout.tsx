import { Tabs } from 'expo-router';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';

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
          title: 'Modules',
          tabBarIcon: ({ color }) => <TabIcon name="apps-outline" color={color} size={26} />,
        }}
      />
      {/* Screens accessible via "Plus" menu — not shown in tab bar */}
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
});
