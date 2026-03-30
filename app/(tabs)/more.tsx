import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';

const ROLE_COLORS: Record<string, string> = {
  admin: '#8B5CF6',
  conducteur: C.primary,
  chef_equipe: C.inProgress,
  observateur: C.textSub,
};

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
  const { documents, photos, tasks, unreadCount } = useApp();
  const { user, logout, permissions } = useAuth();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const MENU_ITEMS: MenuItem[] = [
    { icon: 'folder-open', label: 'Documents', subtitle: `${documents.length} fichiers`, route: '/documents', color: '#3B82F6' },
    { icon: 'calendar', label: 'Planning', subtitle: `${tasks.length} tâches`, route: '/planning', color: '#10B981' },
    { icon: 'camera', label: 'Photos', subtitle: `${photos.length} photos`, route: '/photos', color: '#F59E0B' },
    { icon: 'document-text', label: 'Rapports', subtitle: 'Journalier, hebdo', route: '/rapports', color: '#8B5CF6' },
    { icon: 'chatbubbles', label: 'Messages', subtitle: unreadCount > 0 ? `${unreadCount} non lus` : 'Communication', route: '/messages', color: '#EC4899', badge: unreadCount },
  ];

  function handleLogout() {
    Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnexion', style: 'destructive', onPress: () => { logout(); router.replace('/login'); } },
    ]);
  }

  const roleColor = ROLE_COLORS[user?.role ?? 'observateur'];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Modules</Text>
            <Text style={styles.subtitle}>Accès rapide aux outils</Text>
          </View>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={18} color={C.open} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {user && (
          <View style={[styles.userCard, { borderLeftColor: roleColor }]}>
            <View style={[styles.userAvatar, { backgroundColor: roleColor + '20' }]}>
              <Text style={[styles.userAvatarText, { color: roleColor }]}>{user.name.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>{user.name}</Text>
              <View style={[styles.roleBadge, { backgroundColor: roleColor + '20' }]}>
                <Text style={[styles.roleText, { color: roleColor }]}>{user.roleLabel}</Text>
              </View>
              <Text style={styles.userEmail}>{user.email}</Text>
            </View>
          </View>
        )}

        {user && (
          <View style={styles.permCard}>
            <Text style={styles.permTitle}>Permissions</Text>
            <View style={styles.permRow}>
              {[
                { label: 'Créer', key: 'canCreate' },
                { label: 'Modifier', key: 'canEdit' },
                { label: 'Supprimer', key: 'canDelete' },
                { label: 'Exporter', key: 'canExport' },
              ].map(p => (
                <View key={p.key} style={styles.permItem}>
                  <Ionicons
                    name={(permissions as any)[p.key] ? 'checkmark-circle' : 'close-circle'}
                    size={18}
                    color={(permissions as any)[p.key] ? C.closed : C.open}
                  />
                  <Text style={styles.permLabel}>{p.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <Text style={styles.sectionLabel}>Outils</Text>
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

        <TouchableOpacity style={styles.logoutFullBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color={C.open} />
          <Text style={styles.logoutFullText}>Se déconnecter</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  logoutBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.open + '15', alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: C.border, borderLeftWidth: 4 },
  userAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  userName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, marginBottom: 4 },
  roleText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  userEmail: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  permCard: { backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  permTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  permRow: { flexDirection: 'row', justifyContent: 'space-around' },
  permItem: { alignItems: 'center', gap: 4 },
  permLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  sectionLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  menuCard: { width: '47%', backgroundColor: C.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: C.border, alignItems: 'flex-start' },
  iconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  menuLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 3 },
  menuSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  badge: { position: 'absolute', top: -4, right: -4, backgroundColor: C.open, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 9, fontFamily: 'Inter_700Bold' },
  infoCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  infoTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  infoText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18, marginBottom: 6 },
  infoVersion: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  logoutFullBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.open + '15', borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: C.open + '30' },
  logoutFullText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.open },
});
