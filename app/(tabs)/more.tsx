import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity, Alert, useWindowDimensions } from 'react-native';
import { openChantierSwitcher } from '@/components/ChantierSwitcherSheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useIncidents } from '@/context/IncidentsContext';
import UpdateBanner from '@/components/UpdateBanner';
import UpdateCheckRow from '@/components/UpdateCheckRow';
import { useInventoryCopy } from '@/lib/inventoryI18n';

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#8B5CF6',
  admin: '#8B5CF6',
  conducteur: C.primary,
  chef_equipe: C.inProgress,
  observateur: C.textSub,
  sous_traitant: '#10B981',
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
  const { t } = useTranslation();
  const inventoryCopy = useInventoryCopy();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { documents, photos, tasks, companies, chantiers, activeChantier } = useApp();
  const { user, logout, permissions } = useAuth();
  const { projectName } = useSettings();
  const { incidents } = useIncidents();
  const { width: screenWidth } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const TABLET_SIDEBAR_W = 72;
  const cardWidth = isTablet ? (screenWidth - TABLET_SIDEBAR_W - 42) / 2 : (screenWidth - 42) / 2;
  const topPad = insets.top;
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

    const isSousTraitant = user?.role === 'sous_traitant';
    const terrainItems: MenuItem[] = [
      ...(!isSousTraitant ? [
        { icon: 'eye', label: t('moreScreen.items.visits.0'), subtitle: t('moreScreen.items.visits.1'), route: '/visites', color: '#F59E0B' },
        { icon: 'clipboard', label: t('moreScreen.items.opr.0'), subtitle: t('moreScreen.items.opr.1'), route: '/opr', color: '#7C3AED' },
        { icon: 'book', label: t('moreScreen.items.journal.0'), subtitle: t('moreScreen.items.journal.1'), route: '/journal', color: '#059669' },
        { icon: 'time', label: t('moreScreen.items.pointage.0'), subtitle: t('moreScreen.items.pointage.1'), route: '/pointage', color: '#0891B2' },
        { icon: 'chatbubbles', label: t('tabs.messages'), subtitle: t('moreScreen.items.messages.1', { defaultValue: 'Échanges chantier' }), route: '/(tabs)/messages', color: '#2563EB' },
        {
          icon: 'shield',
          label: t('moreScreen.items.incidents.0', { defaultValue: 'Incidents' }),
          subtitle: openIncidentsCount > 0
            ? t('moreScreen.items.incidentsOpen', { count: openIncidentsCount })
            : t('moreScreen.items.incidentsTotal', { count: incidents.length }),
          route: '/(tabs)/incidents',
          color: '#EF4444',
          badge: openIncidentsCount || undefined,
        },
      ] : [
        { icon: 'warning', label: t('moreScreen.items.myReserves.0'), subtitle: t('moreScreen.items.myReserves.1'), route: '/sous-traitant', color: '#10B981' },
      ]),
    ];
    result.push({ title: t('moreScreen.sections.daily'), items: terrainItems });

    const chantierItems: MenuItem[] = [
      {
        icon: 'business',
        label: t('moreScreen.items.sites.0'),
        subtitle: chantiers.length > 0
          ? t('moreScreen.items.sites.1', {
              count: chantiers.length,
              active: activeChantier ? t('moreScreen.items.activeSiteSuffix', { name: activeChantier.name }) : '',
            })
          : t('moreScreen.items.noSite'),
        route: '/chantier/manage',
        color: C.primary,
      },
      ...(permissions.canViewInventory ? [{
        icon: 'cube',
        label: inventoryCopy.module,
        subtitle: inventoryCopy.subtitle,
        route: '/inventory',
        color: '#0F766E',
      } as MenuItem] : []),
      ...(!isSousTraitant ? [
        { icon: 'calendar', label: t('moreScreen.items.planning.0'), subtitle: t('moreScreen.items.planning.1', { count: tasks.length }), route: '/planning', color: C.closed, badge: delayedCount || undefined } as MenuItem,
        { icon: 'bar-chart', label: t('moreScreen.items.analytics.0'), subtitle: t('moreScreen.items.analytics.1'), route: '/analytics', color: '#0EA5E9' } as MenuItem,
      ] : []),
      { icon: 'search', label: t('moreScreen.items.search.0'), subtitle: t('moreScreen.items.search.1'), route: '/search', color: '#8B5CF6' },
    ];
    if (permissions.canViewTeams) {
      chantierItems.push({ icon: 'people', label: t('moreScreen.items.teams.0'), subtitle: t('moreScreen.items.teams.1', { count: companies.length }), route: '/(tabs)/equipes', color: '#EC4899' });
    }
    result.push({ title: t('moreScreen.sections.site'), items: chantierItems });

    const outilsItems: MenuItem[] = [
      ...(!isSousTraitant ? [
        { icon: 'document-text', label: t('moreScreen.items.reports.0'), subtitle: t('moreScreen.items.reports.1'), route: '/rapports', color: C.verification } as MenuItem,
        { icon: 'folder-open', label: t('moreScreen.items.documents.0'), subtitle: t('moreScreen.items.documents.1', { count: documents.length }), route: '/documents', color: C.inProgress, badge: recentDocsCount || undefined } as MenuItem,
      ] : []),
      { icon: 'camera', label: t('moreScreen.items.photos.0'), subtitle: t('moreScreen.items.photos.1', { count: photos.length }), route: '/photos', color: C.medium },
      ...(!isSousTraitant ? [
        { icon: 'document-text', label: t('moreScreen.items.meetingReports.0'), subtitle: t('moreScreen.items.meetingReports.1'), route: '/meeting-report', color: '#7C3AED' } as MenuItem,
        { icon: 'checkbox', label: t('moreScreen.items.checklists.0'), subtitle: t('moreScreen.items.checklists.1'), route: '/checklist', color: '#06B6D4' } as MenuItem,
        { icon: 'document-lock', label: t('moreScreen.items.regulatoryDocs.0'), subtitle: t('moreScreen.items.regulatoryDocs.1'), route: '/reglementaire', color: '#BE185D' } as MenuItem,
      ] : []),
    ];
    result.push({ title: t('moreScreen.sections.documents'), items: outilsItems });

    const adminItems: MenuItem[] = [
      { icon: 'briefcase', label: t('tabs.pilotage'), subtitle: t('moreScreen.items.administration.1'), route: '/(tabs)/admin', color: '#EF4444' },
      { icon: 'settings', label: t('moreScreen.items.settings.0'), subtitle: t('moreScreen.items.settings.1'), route: '/settings', color: C.textSub },
      { icon: 'git-network', label: t('moreScreen.items.integrations.0'), subtitle: t('moreScreen.items.integrations.1'), route: '/integrations', color: '#6366F1' },
    ];
    if (user?.role === 'super_admin') {
      adminItems.push({ icon: 'globe', label: t('moreScreen.items.superAdmin.0'), subtitle: t('moreScreen.items.superAdmin.1'), route: '/superadmin', color: '#7C3AED' });
    }
    if (isAdmin) {
      result.unshift({ title: t('moreScreen.sections.administration'), items: adminItems });
    } else {
      result.push({ title: t('moreScreen.sections.account'), items: [
        { icon: 'settings', label: t('moreScreen.items.settings.0'), subtitle: t('moreScreen.items.settings.1'), route: '/settings', color: C.textSub },
      ]});
    }

    return result;
  }, [documents.length, tasks.length, photos.length, companies.length, incidents.length, delayedCount, recentDocsCount, openIncidentsCount, permissions.canViewTeams, permissions.canViewInventory, inventoryCopy.module, inventoryCopy.subtitle, isAdmin, user?.role, chantiers.length, activeChantier?.id, activeChantier?.name, t]);

  function handleLogout() {
    Alert.alert(t('moreScreen.logoutTitle'), t('moreScreen.logoutMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('moreScreen.logoutAction'), style: 'destructive', onPress: () => { logout(); } },
    ]);
  }

  const [permExpanded, setPermExpanded] = useState(false);
  const roleColor = ROLE_COLORS[user?.role ?? 'observateur'] ?? C.textSub;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t('moreScreen.title')}</Text>
            <Text style={styles.subtitle}>{t('moreScreen.subtitle')}</Text>
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
              <Text style={styles.chantierPillEmptyText}>{t('moreScreen.site')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Bandeau mise à jour APK */}
        <UpdateBanner />

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
              <Text style={styles.permTitle}>{t('moreScreen.permissions')}</Text>
              <Ionicons name={permExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />
            </TouchableOpacity>
            {permExpanded && (
              <View style={styles.permRow}>
                {[
                  { label: t('moreScreen.permissionLabels.create'), key: 'canCreate' },
                  { label: t('moreScreen.permissionLabels.edit'), key: 'canEdit' },
                  { label: t('moreScreen.permissionLabels.delete'), key: 'canDelete' },
                  { label: t('moreScreen.permissionLabels.export'), key: 'canExport' },
                  { label: t('moreScreen.permissionLabels.teams'), key: 'canViewTeams' },
                  { label: t('moreScreen.permissionLabels.attendance'), key: 'canUpdateAttendance' },
                  { label: inventoryCopy.stock, key: 'canViewInventory' },
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
                  style={[styles.menuCard, { width: cardWidth }]}
                  onPress={() => item.route.startsWith('/(tabs)/') ? router.navigate(item.route as any) : router.push(item.route as any)}
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
          <Text style={styles.infoText}>{t('moreScreen.appDescription')}</Text>
          <Text style={styles.infoVersion}>{projectName}</Text>
          <UpdateCheckRow />
        </View>

        <TouchableOpacity style={styles.logoutFullBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color={C.open} />
          <Text style={styles.logoutFullText}>{t('moreScreen.logoutButton')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {permissions.canCreate && (
        <TouchableOpacity
          style={[styles.fab, { bottom: Platform.OS === 'web' ? 104 : insets.bottom + 12 }]}
          onPress={() => router.push('/reserve/new' as any)}
          activeOpacity={0.85}
          accessibilityLabel={t('moreScreen.reserveFab')}
        >
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingLeft: 24, paddingRight: 16, paddingBottom: 14,
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
    backgroundColor: C.surface, borderRadius: 16, padding: 16,
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
    right: 12,
    zIndex: 100,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primary,
    borderRadius: 28,
    elevation: 6,
    ...Platform.select({
      web: { boxShadow: '0px 4px 16px rgba(0,48,130,0.30)' } as any,
      default: { shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10 },
    }),
  },
});
