import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity, Alert } from 'react-native';
import { openChantierSwitcher } from '@/components/ChantierSwitcherSheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useIncidents } from '@/context/IncidentsContext';

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#8B5CF6',
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

interface MenuSection {
  title: string;
  items: MenuItem[];
}

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { documents, photos, tasks, companies, chantiers, activeChantier } = useApp();
  const { user, logout, permissions } = useAuth();
  const { projectName } = useSettings();
  const { incidents } = useIncidents();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 0 : insets.bottom;

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const delayedCount = useMemo(() => tasks.filter(t => t.status === 'delayed').length, [tasks]);
  const openIncidentsCount = useMemo(() => incidents.filter(i => i.status !== 'resolved').length, [incidents]);
  const recentDocsCount = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return documents.filter(d => {
      const parts = d.uploadedAt.split('/');
      if (parts.length !== 3) return false;
      const date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      return date >= sevenDaysAgo;
    }).length;
  }, [documents]);

  const sections = useMemo<MenuSection[]>(() => {
    const result: MenuSection[] = [];

    // Section Terrain quotidien — accès immédiat aux outils de chantier
    const terrainItems: MenuItem[] = [
      { icon: 'book', label: 'Journal chantier', subtitle: 'Saisie quotidienne', route: '/journal', color: '#059669' },
      { icon: 'time', label: 'Pointage', subtitle: 'Arrivées & départs', route: '/pointage', color: '#0891B2' },
      { icon: 'clipboard', label: 'OPR', subtitle: 'Opérations de réception', route: '/(tabs)/opr', color: '#7C3AED' },
      { icon: 'eye', label: 'Visites chantier', subtitle: 'Compte-rendu visite', route: '/(tabs)/visites', color: '#F59E0B' },
      { icon: 'shield', label: 'Incidents', subtitle: `${openIncidentsCount > 0 ? openIncidentsCount + ' non résolu' + (openIncidentsCount > 1 ? 's' : '') : incidents.length + ' au total'}`, route: '/(tabs)/incidents', color: '#EF4444', badge: openIncidentsCount || undefined },
    ];
    result.push({ title: 'Terrain quotidien', items: terrainItems });

    // Section Chantier
    const chantierItems: MenuItem[] = [
      { icon: 'business', label: 'Chantiers', subtitle: chantiers.length > 0 ? `${chantiers.length} chantier${chantiers.length > 1 ? 's' : ''}${activeChantier ? ' · Actif: ' + activeChantier.name : ''}` : 'Aucun chantier', route: '/chantier/manage', color: C.primary },
      { icon: 'calendar', label: 'Planning', subtitle: `${tasks.length} tâche${tasks.length !== 1 ? 's' : ''}`, route: '/planning', color: C.closed, badge: delayedCount || undefined },
      { icon: 'bar-chart', label: 'Analytique', subtitle: 'Tendances & KPIs', route: '/analytics', color: '#0EA5E9' },
      { icon: 'search', label: 'Recherche', subtitle: 'Tout le chantier', route: '/search', color: '#8B5CF6' },
    ];
    if (permissions.canViewTeams) {
      chantierItems.push({ icon: 'people', label: 'Équipes', subtitle: `${companies.length} entreprise${companies.length !== 1 ? 's' : ''}`, route: '/(tabs)/equipes', color: '#EC4899' });
    }
    result.push({ title: 'Chantier', items: chantierItems });

    // Section Documents & Outils
    const outilsItems: MenuItem[] = [
      { icon: 'document-text', label: 'Rapports', subtitle: 'Journalier, hebdo', route: '/rapports', color: C.verification },
      { icon: 'folder-open', label: 'Documents', subtitle: `${documents.length} fichier${documents.length !== 1 ? 's' : ''}`, route: '/documents', color: C.inProgress, badge: recentDocsCount || undefined },
      { icon: 'camera', label: 'Photos', subtitle: `${photos.length} photo${photos.length !== 1 ? 's' : ''}`, route: '/photos', color: C.medium },
      { icon: 'document-text', label: 'CR Réunions', subtitle: 'Comptes-rendus', route: '/meeting-report', color: '#7C3AED' },
      { icon: 'checkbox', label: 'Checklists', subtitle: 'Contrôle qualité', route: '/checklist', color: '#06B6D4' },
      { icon: 'document-lock', label: 'Docs réglementaires', subtitle: 'PPSPS · DICT · DOE', route: '/reglementaire', color: '#BE185D' },
    ];
    result.push({ title: 'Documents', items: outilsItems });

    // Section Administration (admin/super_admin uniquement)
    if (isAdmin) {
      const adminItems: MenuItem[] = [
        { icon: 'shield-checkmark', label: 'Administration', subtitle: 'Utilisateurs & accès', route: '/(tabs)/admin', color: '#EF4444' },
        { icon: 'settings', label: 'Paramètres', subtitle: 'Projet & présences', route: '/settings', color: C.textSub },
        { icon: 'git-network', label: 'Intégrations BTP', subtitle: 'Procore · BIM · URSSAF', route: '/integrations', color: '#6366F1' },
      ];
      if (user?.role === 'super_admin') {
        adminItems.push({ icon: 'globe', label: 'Super Admin', subtitle: 'Toutes les orgs', route: '/superadmin', color: '#7C3AED' });
      }
      result.push({ title: 'Administration', items: adminItems });
    } else {
      result.push({ title: 'Compte', items: [
        { icon: 'settings', label: 'Paramètres', subtitle: 'Projet & présences', route: '/settings', color: C.textSub },
        { icon: 'git-network', label: 'Intégrations BTP', subtitle: 'Procore · BIM · URSSAF', route: '/integrations', color: '#6366F1' },
      ]});
    }

    return result;
  }, [documents.length, tasks.length, photos.length, companies.length, incidents.length, delayedCount, recentDocsCount, openIncidentsCount, permissions.canViewTeams, isAdmin, user?.role, chantiers.length, activeChantier?.id, activeChantier?.name]);

  function handleLogout() {
    Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnexion', style: 'destructive', onPress: () => { logout(); } },
    ]);
  }

  const [permExpanded, setPermExpanded] = useState(false);
  const roleColor = ROLE_COLORS[user?.role ?? 'observateur'] ?? C.textSub;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Terrain</Text>
            <Text style={styles.subtitle}>Outils terrain quotidiens</Text>
          </View>
          {activeChantier ? (
            <TouchableOpacity style={styles.chantierPill} onPress={openChantierSwitcher} activeOpacity={0.8}>
              <View style={styles.chantierPillDot} />
              <Text style={styles.chantierPillText} numberOfLines={1}>{activeChantier.name}</Text>
              <Ionicons name="chevron-down" size={11} color={C.primary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.chantierPillEmpty} onPress={openChantierSwitcher} activeOpacity={0.8}>
              <Ionicons name="add" size={13} color={C.textMuted} />
              <Text style={styles.chantierPillEmptyText}>Chantier</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Carte utilisateur */}
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

        {/* Permissions */}
        {user && (
          <View style={styles.permCard}>
            <TouchableOpacity style={styles.permHeader} onPress={() => setPermExpanded(v => !v)}>
              <Text style={styles.permTitle}>Permissions</Text>
              <Ionicons name={permExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />
            </TouchableOpacity>
            {permExpanded && (
              <View style={styles.permRow}>
                {[
                  { label: 'Créer', key: 'canCreate' },
                  { label: 'Modifier', key: 'canEdit' },
                  { label: 'Supprimer', key: 'canDelete' },
                  { label: 'Exporter', key: 'canExport' },
                  { label: 'Équipes', key: 'canViewTeams' },
                  { label: 'Présences', key: 'canUpdateAttendance' },
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
            )}
          </View>
        )}

        {/* Sections de menu */}
        {sections.map(section => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            <View style={styles.grid}>
              {section.items.map(item => (
                <TouchableOpacity
                  key={item.route}
                  style={styles.menuCard}
                  onPress={() => router.push(item.route as any)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.iconWrap, { backgroundColor: item.color + '20' }]}>
                    <Ionicons name={item.icon as any} size={26} color={item.color} />
                    {item.badge && item.badge > 0 ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.badge > 9 ? '9+' : item.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.menuLabel} numberOfLines={2}>{item.label}</Text>
                  <Text style={styles.menuSub} numberOfLines={1}>{item.subtitle}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="construct-outline" size={18} color={C.primary} />
            <Text style={styles.infoTitle}>BuildTrack</Text>
          </View>
          <Text style={styles.infoText}>Application de gestion de chantier numérique</Text>
          <Text style={styles.infoVersion}>Version 1.0.0 — {projectName}</Text>
        </View>

        <TouchableOpacity style={styles.logoutFullBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color={C.open} />
          <Text style={styles.logoutFullText}>Se déconnecter</Text>
        </TouchableOpacity>
      </ScrollView>

      {permissions.canCreate && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/reserve/new' as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={styles.fabLabel}>Réserve</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  chantierPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primaryBg, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.primary + '40', maxWidth: 140,
  },
  chantierPillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.primary },
  chantierPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary, flex: 1 },
  chantierPillEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surface2, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
  },
  chantierPillEmptyText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted },

  content: { padding: 16 },

  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: C.border, borderLeftWidth: 4,
  },
  userAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  userName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, marginBottom: 4 },
  roleText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  userEmail: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },

  permCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    marginBottom: 16, borderWidth: 1, borderColor: C.border,
  },
  permHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  permTitle: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  permRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-around', marginTop: 12 },
  permItem: { alignItems: 'center', gap: 4 },
  permLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },

  section: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  menuCard: {
    width: '47%', backgroundColor: C.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: C.border, alignItems: 'flex-start',
  },
  iconWrap: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  menuLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 3 },
  menuSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  badge: {
    position: 'absolute', top: -4, right: -4, backgroundColor: C.open,
    borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontFamily: 'Inter_700Bold' },

  infoCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  infoTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  infoText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18, marginBottom: 6 },
  infoVersion: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },

  logoutFullBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.open + '15', borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: C.open + '30',
  },
  logoutFullText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.open },
  fab: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 104 : 80,
    right: 18,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.primary,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 30,
    elevation: 6,
    ...Platform.select({
      web: { boxShadow: '0px 4px 16px rgba(0,48,130,0.30)' } as any,
      default: { shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10 },
    }),
  },
  fabLabel: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
});
