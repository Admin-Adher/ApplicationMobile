import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';

interface MenuItem {
  icon: string;
  label: string;
  subtitle: string;
  route: string;
  color: string;
  badge?: number;
}

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { documents, photos, tasks, messages, unreadCount } = useApp();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const MENU_ITEMS: MenuItem[] = [
    { icon: 'folder-open', label: 'Documents', subtitle: `${documents.length} fichiers`, route: '/documents', color: '#3B82F6' },
    { icon: 'calendar', label: 'Planning', subtitle: `${tasks.length} tâches`, route: '/planning', color: '#10B981' },
    { icon: 'camera', label: 'Photos', subtitle: `${photos.length} photos`, route: '/photos', color: '#F59E0B' },
    { icon: 'document-text', label: 'Rapports', subtitle: 'Journalier, hebdo', route: '/rapports', color: '#8B5CF6' },
    { icon: 'chatbubbles', label: 'Messages', subtitle: unreadCount > 0 ? `${unreadCount} non lus` : 'Communication', route: '/messages', color: '#EC4899', badge: unreadCount },
  ];

  return (
    <View style={[styles.container]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={styles.title}>Modules</Text>
        <Text style={styles.subtitle}>Accès rapide aux outils</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {MENU_ITEMS.map(item => (
            <TouchableOpacity
              key={item.route}
              style={styles.menuCard}
              onPress={() => router.push(item.route as any)}
              activeOpacity={0.75}
            >
              <View style={[styles.iconWrap, { backgroundColor: item.color + '20' }]}>
                <Ionicons name={item.icon as any} size={28} color={item.color} />
                {item.badge && item.badge > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuSub}>{item.subtitle}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="construct-outline" size={18} color={C.primary} />
            <Text style={styles.infoTitle}>BuildTrack</Text>
          </View>
          <Text style={styles.infoText}>Application de gestion de chantier numérique — Type Dalux</Text>
          <Text style={styles.infoVersion}>Version 1.0.0 — Projet Horizon</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  content: { padding: 16, paddingBottom: 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  menuCard: {
    width: '47%', backgroundColor: C.surface, borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: C.border, alignItems: 'flex-start',
  },
  iconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  menuLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 3 },
  menuSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  badge: {
    position: 'absolute', top: -4, right: -4, backgroundColor: C.open,
    borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontFamily: 'Inter_700Bold' },
  infoCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  infoTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  infoText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18, marginBottom: 6 },
  infoVersion: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
