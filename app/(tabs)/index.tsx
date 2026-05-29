import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { openChantierSwitcher } from '@/components/ChantierSwitcherSheet';
import { useState, useCallback, useMemo } from 'react';
import GlobalSearch from '@/components/GlobalSearch';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useIncidents } from '@/context/IncidentsContext';
import { useNotifications } from '@/context/NotificationsContext';
import { useNetwork } from '@/context/NetworkContext';
import { useLanguage } from '@/context/LanguageContext';
import { parseDeadline, isOverdue } from '@/lib/reserveUtils';
import { Task, ReserveWeekStat, CompanyClosureStat } from '@/constants/types';
import PortfolioDashboard from '@/components/PortfolioDashboard';
import { localeForLanguage } from '@/constants/language';
import { useTranslation } from 'react-i18next';

function isTaskLate(t: Task): boolean {
  if (t.status === 'done') return false;
  if (t.status === 'delayed') return true;
  const d = parseDeadline(t.deadline);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function getWeekLabel(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + 1);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + 1);
  return d.toISOString().slice(0, 10);
}

function parseDateSafe(s: string): Date | null {
  if (!s) return null;
  const parts = s.split('/');
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function hasReservePlanPin(reserve: any): boolean {
  const planId = reserve?.planId ?? reserve?.plan_id;
  const x = reserve?.planX ?? reserve?.plan_x;
  const y = reserve?.planY ?? reserve?.plan_y;
  return Boolean(planId) && x != null && y != null && Number.isFinite(Number(x)) && Number.isFinite(Number(y));
}

function KPICard({
  label, value, color, icon, bg, onPress,
}: {
  label: string; value: string | number; color: string; icon: string; bg: string; onPress?: () => void;
}) {
  const card = (
    <View style={[styles.kpiCard, { borderLeftColor: color }]}>
      <View style={styles.kpiCardTop}>
        <View style={[styles.kpiIconWrap, { backgroundColor: bg }]}>
          <Ionicons name={icon as any} size={18} color={color} />
        </View>
        {onPress && <Ionicons name="chevron-forward" size={13} color={C.textMuted} />}
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.kpiTouchable}>
        {card}
      </TouchableOpacity>
    );
  }
  return <View style={styles.kpiTouchable}>{card}</View>;
}

function ReserveStatusBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={styles.statusLabel}>{label}</Text>
      <View style={styles.statusBarWrap}>
        <View style={[styles.statusBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[styles.statusCount, { color }]}>{count}</Text>
    </View>
  );
}

function WeekTrendChart({
  weekStats,
  createdLabel,
  closedLabel,
}: {
  weekStats: ReserveWeekStat[];
  createdLabel: string;
  closedLabel: string;
}) {
  const maxVal = Math.max(...weekStats.map(w => Math.max(w.created, w.closed)), 1);
  return (
    <View style={styles.chartContainer}>
      <View style={styles.chartLegend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: C.open }]} />
          <Text style={styles.legendText}>{createdLabel}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: C.closed }]} />
          <Text style={styles.legendText}>{closedLabel}</Text>
        </View>
      </View>
      <View style={styles.chartBars}>
        {weekStats.map((week, i) => (
          <View key={i} style={styles.barGroup}>
            <View style={styles.barPair}>
              <View style={styles.barCol}>
                <View style={[styles.bar, {
                  height: Math.max(2, (week.created / maxVal) * 80),
                  backgroundColor: C.open,
                }]} />
              </View>
              <View style={styles.barCol}>
                <View style={[styles.bar, {
                  height: Math.max(2, (week.closed / maxVal) * 80),
                  backgroundColor: C.closed,
                }]} />
              </View>
            </View>
            <Text style={styles.barLabel}>{week.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CompanyTable({ stats }: { stats: CompanyClosureStat[] }) {
  return (
    <View style={styles.companyTable}>
      {stats.map((co, i) => (
        <View key={i} style={styles.companyRow}>
          <View style={[styles.companyDot, { backgroundColor: co.color }]} />
          <Text style={styles.companyName} numberOfLines={1}>{co.companyName}</Text>
          <View style={styles.companyBarWrap}>
            <View style={[styles.companyBarFill, {
              width: `${co.rate}%` as any,
              backgroundColor: co.rate >= 70 ? C.closed : co.rate >= 40 ? C.inProgress : C.open,
            }]} />
          </View>
          <Text style={[styles.companyRate, {
            color: co.rate >= 70 ? C.closed : co.rate >= 40 ? C.inProgress : C.open,
          }]}>{co.rate}%</Text>
          {co.overdue > 0 && (
            <View style={styles.overdueTag}>
              <Text style={styles.overdueTagText}>{co.overdue}⚠</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

export default function DashboardScreen() {
  const { t } = useTranslation();
  const { effectiveLanguage } = useLanguage();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { stats, reserves, companies, tasks, reload, chantiers, activeChantier, realtimeConnected, isLoading: appLoading } = useApp();
  const { user, permissions } = useAuth();
  const { incidents } = useIncidents();
  const { unreadCount } = useNotifications();
  const { queueCount, syncStatus, syncProgress, isOnline } = useNetwork();
  const topPad = insets.top;
  const [refreshing, setRefreshing] = useState(false);
  const [analyticsTab, setAnalyticsTab] = useState<'trend' | 'companies'>('trend');
  const [viewMode, setViewMode] = useState<'chantier' | 'portfolio'>('chantier');
  const [globalSearchVisible, setGlobalSearchVisible] = useState(false);
  const [personnelExpanded, setPersonnelExpanded] = useState(false);

  const isSousTraitant = user?.role === 'sous_traitant';

  const userCompany = useMemo(() => {
    if (!isSousTraitant || !user?.companyId) return null;
    return companies.find(c => c.id === user.companyId) ?? null;
  }, [isSousTraitant, user?.companyId, companies]);

  const chantieredReserves = useMemo(() => {
    if (!activeChantier) return reserves;
    return reserves.filter(r => r.chantierId === activeChantier.id);
  }, [reserves, activeChantier]);

  const visibleReserves = useMemo(() => {
    if (isSousTraitant && userCompany) {
      return chantieredReserves.filter(r =>
        r.company === userCompany.name ||
        (Array.isArray(r.companies) && r.companies.includes(userCompany.name))
      );
    }
    return chantieredReserves;
  }, [isSousTraitant, userCompany, chantieredReserves]);

  const activeVisibleReserves = useMemo(
    () => visibleReserves.filter(r => !r.archivedAt),
    [visibleReserves],
  );

  const visibleStats = useMemo(() => {
    const total = activeVisibleReserves.length;
    const open = activeVisibleReserves.filter(r => r.status === 'open').length;
    const inProgress = activeVisibleReserves.filter(r => r.status === 'in_progress').length;
    const waiting = activeVisibleReserves.filter(r => r.status === 'waiting').length;
    const verification = activeVisibleReserves.filter(r => r.status === 'verification').length;
    const closed = activeVisibleReserves.filter(r => r.status === 'closed').length;
    const progress = total > 0 ? Math.round((closed / total) * 100) : 0;
    return { ...stats, total, open, inProgress, waiting, verification, closed, progress };
  }, [activeVisibleReserves, stats]);

  const showPortfolioToggle = !isSousTraitant && chantiers.length >= 2;

  const criticalReserves = useMemo(
    () => activeVisibleReserves.filter(r => r.priority === 'critical' && r.status !== 'closed'),
    [activeVisibleReserves]
  );
  const overdueNonCritical = useMemo(
    () => activeVisibleReserves.filter(r => r.status !== 'closed' && r.priority !== 'critical' && isOverdue(r.deadline, r.status)),
    [activeVisibleReserves]
  );
  const lateTasks = useMemo(() => {
    let all = tasks.filter(isTaskLate);
    if (activeChantier) {
      all = all.filter(t => t.chantierId === activeChantier.id);
    }
    if (isSousTraitant && userCompany) {
      return all.filter(t => t.company === userCompany.name);
    }
    return all;
  }, [tasks, isSousTraitant, userCompany, activeChantier]);
  const openIncidents = useMemo(
    () => incidents.filter(i => i.status !== 'resolved'),
    [incidents]
  );

  const today = new Date().toLocaleDateString(localeForLanguage(effectiveLanguage), { weekday: 'long', day: 'numeric', month: 'long' });
  const firstName = user?.name?.split(' ')[0] ?? null;

  const priorityLabels = useMemo(() => ({
    low: t('reserveLabels.priority.low'),
    medium: t('reserveLabels.priority.medium'),
    high: t('reserveLabels.priority.high'),
    critical: t('reserveLabels.priority.critical'),
  }), [t]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const weekStats = useMemo((): ReserveWeekStat[] => {
    const now = new Date();
    const weeks: Map<string, ReserveWeekStat> = new Map();
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const key = getWeekKey(d);
      const label = getWeekLabel(d);
      weeks.set(key, { week: key, label, created: 0, closed: 0 });
    }
    activeVisibleReserves.forEach(r => {
      if (r.createdAt) {
        const d = parseDateSafe(r.createdAt);
        if (d) {
          const key = getWeekKey(d);
          const w = weeks.get(key);
          if (w) w.created += 1;
        }
      }
      if (r.closedAt) {
        const d = parseDateSafe(r.closedAt);
        if (d) {
          const key = getWeekKey(d);
          const w = weeks.get(key);
          if (w) w.closed += 1;
        }
      }
    });
    return Array.from(weeks.values());
  }, [activeVisibleReserves]);

  const companyStats = useMemo((): CompanyClosureStat[] => {
    return companies.map(co => {
      const coReserves = chantieredReserves.filter(r =>
        !r.archivedAt &&
        (
          r.company === co.name ||
          (Array.isArray(r.companies) && r.companies.includes(co.name))
        )
      );
      const closed = coReserves.filter(r => r.status === 'closed').length;
      const total = coReserves.length;
      const overdue = coReserves.filter(r => r.status !== 'closed' && isOverdue(r.deadline, r.status)).length;
      const rate = total > 0 ? Math.round((closed / total) * 100) : 0;
      return { companyName: co.name, color: co.color, total, closed, rate, overdue };
    }).filter(c => c.total > 0).sort((a, b) => b.rate - a.rate);
  }, [chantieredReserves, companies]);

  const visibleCompanies = useMemo(() => {
    if (isSousTraitant && userCompany) {
      return companies.filter(c => c.id === userCompany.id);
    }
    return companies;
  }, [isSousTraitant, userCompany, companies]);

  const pinnedVisibleReserves = useMemo(
    () => activeVisibleReserves.filter(hasReservePlanPin),
    [activeVisibleReserves],
  );

  const companyPinPodium = useMemo(() => {
    return visibleCompanies
      .map(company => {
        const companyReserves = activeVisibleReserves.filter(r =>
          r.company === company.name ||
          (Array.isArray(r.companies) && r.companies.includes(company.name))
        );
        const pinned = companyReserves.filter(hasReservePlanPin).length;
        const total = companyReserves.length;
        return {
          id: company.id,
          name: company.name,
          shortName: (company as any).shortName ?? (company as any).short_name ?? company.name,
          color: company.color ?? C.primary,
          pinned,
          total,
        };
      })
      .filter(company => company.pinned > 0)
      .sort((a, b) => b.pinned - a.pinned || a.name.localeCompare(b.name))
      .slice(0, 3);
  }, [activeVisibleReserves, visibleCompanies]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        {/* Row 1: greeting + actions */}
        <View style={styles.headerTopRow}>
          <View style={styles.headerLeft}>
            <View style={styles.logoMini}>
              <Text style={styles.logoMiniLetter}>B</Text>
            </View>
            <View style={styles.headerGreeting}>
              <Text style={styles.brand} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                {firstName ? t('dashboard.hello', { name: firstName }) : 'BuildTrack'}
              </Text>
              <Text style={styles.date}>{today}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            {queueCount > 0 && (
              <TouchableOpacity
                style={styles.syncChip}
                onPress={() => router.push('/settings' as any)}
                accessibilityRole="button"
                accessibilityLabel={t(isOnline ? 'dashboard.syncPendingOnline' : 'dashboard.syncPendingOffline', { count: queueCount })}
                hitSlop={8}
              >
                {syncStatus === 'syncing' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons
                    name={isOnline ? 'cloud-upload-outline' : 'cloud-offline-outline'}
                    size={12}
                    color="#fff"
                  />
                )}
                <Text style={styles.syncChipText}>
                  {syncStatus === 'syncing' && syncProgress.total > 0
                    ? `${syncProgress.done}/${syncProgress.total}`
                    : queueCount}
                </Text>
              </TouchableOpacity>
            )}
            {realtimeConnected && (
              <View style={styles.realtimeDot} />
            )}
            <TouchableOpacity
              style={styles.iconHeaderBtn}
              onPress={() => setGlobalSearchVisible(true)}
            >
              <Ionicons name="search-outline" size={20} color={C.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bellBtn}
              onPress={() => router.push('/notifications' as any)}
            >
              <Ionicons name="notifications-outline" size={20} color={C.text} />
              {unreadCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>
                    {unreadCount > 9 ? '9+' : String(unreadCount)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Row 2: chantier selector */}
        {!isSousTraitant && viewMode === 'chantier' && (
          activeChantier ? (
            <TouchableOpacity
              style={styles.chantierPillRow}
              onPress={openChantierSwitcher}
              activeOpacity={0.75}
            >
              <View style={styles.chantierPillDot} />
              <Text style={styles.chantierPillRowText} numberOfLines={1}>{activeChantier.name}</Text>
              <Ionicons name="chevron-down" size={12} color={C.primary} />
            </TouchableOpacity>
          ) : (
            permissions.canCreate && (
              <TouchableOpacity
                style={styles.chantierPillRowEmpty}
                onPress={() => router.push('/chantier/new' as any)}
                activeOpacity={0.75}
              >
                <Ionicons name="add-circle-outline" size={14} color={C.textMuted} />
                <Text style={styles.chantierPillEmptyText}>{t('dashboard.addChantier')}</Text>
              </TouchableOpacity>
            )
          )
        )}
        {isSousTraitant && activeChantier && (
          <View style={styles.chantierPillRowReadOnly}>
            <View style={styles.chantierPillReadOnlyDot} />
            <Text style={styles.chantierPillReadOnlyText} numberOfLines={1}>{activeChantier.name}</Text>
          </View>
        )}
      </View>

      {showPortfolioToggle && (
        <View style={styles.viewToggleBar}>
          <TouchableOpacity
            style={[styles.viewToggleBtn, viewMode === 'chantier' && styles.viewToggleBtnActive]}
            onPress={() => setViewMode('chantier')}
          >
            <Ionicons
              name="business-outline"
              size={13}
              color={viewMode === 'chantier' ? C.primary : C.textMuted}
            />
            <Text style={[styles.viewToggleText, viewMode === 'chantier' && styles.viewToggleTextActive]}>
              {activeChantier?.name ?? t('dashboard.chantier')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewToggleBtn, viewMode === 'portfolio' && styles.viewToggleBtnActive]}
            onPress={() => setViewMode('portfolio')}
          >
            <Ionicons
              name="grid-outline"
              size={13}
              color={viewMode === 'portfolio' ? C.primary : C.textMuted}
            />
            <Text style={[styles.viewToggleText, viewMode === 'portfolio' && styles.viewToggleTextActive]}>
              {t('dashboard.portfolio')}
            </Text>
            <View style={styles.viewToggleBadge}>
              <Text style={styles.viewToggleBadgeText}>{chantiers.length}</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {viewMode === 'portfolio' && (
        <PortfolioDashboard onSwitchToChantier={() => setViewMode('chantier')} />
      )}

      {viewMode === 'chantier' && permissions.canCreate && activeChantier && (
        <TouchableOpacity
          style={[styles.fab, { bottom: Platform.OS === 'web' ? 104 : insets.bottom + 61 }]}
          onPress={() => router.push('/reserve/new' as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={28} color="#fff" />
          <Text style={styles.fabLabel}>{t('dashboard.newReserve')}</Text>
        </TouchableOpacity>
      )}

      {viewMode === 'chantier' && <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, chantiers.length === 0 && !isSousTraitant && styles.contentEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
      >
        {isSousTraitant && userCompany && (
          <View style={styles.scopeBanner}>
            <View style={[styles.scopeDot, { backgroundColor: userCompany.color }]} />
            <Text style={styles.scopeText}>{t('dashboard.subcontractorScope', { company: userCompany.name })}</Text>
          </View>
        )}

        {chantiers.length === 0 && !isSousTraitant && !appLoading && (
          <View style={styles.dashEmptyState}>
            <View style={styles.dashEmptyIconWrap}>
              <Ionicons name="speedometer-outline" size={44} color={C.primary} />
            </View>
            <Text style={styles.dashEmptyTitle}>{t('dashboard.noActiveChantier')}</Text>
            <Text style={styles.dashEmptySubtitle}>
              {t('dashboard.noActiveChantierHint')}
            </Text>
            <View style={styles.dashEmptyFeatures}>
              <View style={styles.dashEmptyFeatureRow}>
                <View style={[styles.dashEmptyFeatureDot, { backgroundColor: '#003082' }]}>
                  <Ionicons name="pulse-outline" size={14} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dashEmptyFeatureTitle}>{t('dashboard.overviewRealtime')}</Text>
                  <Text style={styles.dashEmptyFeatureDesc}>{t('dashboard.overviewRealtimeHint')}</Text>
                </View>
              </View>
              <View style={styles.dashEmptyFeatureRow}>
                <View style={[styles.dashEmptyFeatureDot, { backgroundColor: '#EF4444' }]}>
                  <Ionicons name="warning-outline" size={14} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dashEmptyFeatureTitle}>{t('dashboard.alertsPriorities')}</Text>
                  <Text style={styles.dashEmptyFeatureDesc}>{t('dashboard.alertsPrioritiesHint')}</Text>
                </View>
              </View>
              <View style={styles.dashEmptyFeatureRow}>
                <View style={[styles.dashEmptyFeatureDot, { backgroundColor: '#7C3AED' }]}>
                  <Ionicons name="bar-chart-outline" size={14} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dashEmptyFeatureTitle}>{t('dashboard.analyticsTrends')}</Text>
                  <Text style={styles.dashEmptyFeatureDesc}>{t('dashboard.analyticsTrendsHint')}</Text>
                </View>
              </View>
            </View>
            {permissions.canCreate && (
              <TouchableOpacity style={styles.dashEmptyBtn} onPress={() => router.push('/chantier/new' as any)}>
                <Ionicons name="add-circle-outline" size={16} color="#fff" />
                <Text style={styles.dashEmptyBtnText}>{t('dashboard.createChantier')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {appLoading && chantiers.length === 0 && !isSousTraitant && (
          <View style={styles.dashLoadingState}>
            <ActivityIndicator size="small" color={C.primary} />
          </View>
        )}

        {(chantiers.length > 0 || isSousTraitant) && (
          <>
        <View style={styles.kpiGrid}>
          <KPICard
            label={t('dashboard.totalReserves')}
            value={visibleStats.total}
            color={C.primary}
            icon="list"
            bg={C.primaryBg}
            onPress={() => router.navigate('/(tabs)/reserves' as any)}
          />
          <KPICard
            label={t('dashboard.active')}
            value={visibleStats.open + visibleStats.inProgress}
            color={C.open}
            icon="alert-circle"
            bg={C.openBg}
            onPress={() => router.navigate('/(tabs)/reserves' as any)}
          />
          <KPICard
            label={t('dashboard.critical')}
            value={criticalReserves.length}
            color={C.critical}
            icon="warning"
            bg={C.criticalBg}
            onPress={() => router.navigate('/(tabs)/reserves' as any)}
          />
          <KPICard
            label={t('dashboard.closed')}
            value={visibleStats.closed}
            color={C.closed}
            icon="checkmark-circle"
            bg={C.closedBg}
            onPress={() => router.navigate('/(tabs)/reserves' as any)}
          />
        </View>

        {!isSousTraitant && (
          <TouchableOpacity
            style={[styles.kpiWide, { borderLeftColor: lateTasks.length > 0 ? C.waiting : C.closed }]}
            onPress={() => router.push('/planning' as any)}
            activeOpacity={0.75}
          >
            <View style={[styles.kpiIconWrap, { backgroundColor: lateTasks.length > 0 ? C.waiting + '20' : C.closedBg }]}>
              <Ionicons
                name="time-outline"
                size={18}
                color={lateTasks.length > 0 ? C.waiting : C.closed}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.kpiValue, { fontSize: 24, color: lateTasks.length > 0 ? C.waiting : C.closed }]}>
                {lateTasks.length}
              </Text>
              <Text style={styles.kpiLabel}>
                {lateTasks.length === 0
                  ? t('dashboard.noLateTasks')
                  : t('dashboard.lateTasks', { count: lateTasks.length })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}

        {!isSousTraitant && (
          <TouchableOpacity
            style={[styles.kpiWide, { borderLeftColor: openIncidents.length > 0 ? '#EF4444' : C.closed }]}
            onPress={() => router.push('/incidents' as any)}
            activeOpacity={0.75}
          >
            <View style={[styles.kpiIconWrap, { backgroundColor: openIncidents.length > 0 ? '#EF444420' : C.closedBg }]}>
              <Ionicons
                name="shield-outline"
                size={18}
                color={openIncidents.length > 0 ? '#EF4444' : C.closed}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.kpiValue, { fontSize: 24, color: openIncidents.length > 0 ? '#EF4444' : C.closed }]}>
                {openIncidents.length}
              </Text>
              <Text style={styles.kpiLabel}>
                {openIncidents.length === 0
                  ? t('dashboard.noOpenIncidents')
                  : t('dashboard.openIncidents', { count: openIncidents.length })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}
          </>
        )}

        {chantiers.length > 0 && visibleStats.total === 0 && companies.length === 0 && permissions.canCreate && (
          <View style={styles.onboardCard}>
            <View style={styles.onboardIconWrap}>
              <Ionicons name="construct" size={32} color={C.primary} />
            </View>
            <Text style={styles.onboardTitle}>{t('dashboard.welcome')}</Text>
            <Text style={styles.onboardText}>
              {t('dashboard.welcomeHint')}
            </Text>
            <View style={styles.onboardActions}>
              <TouchableOpacity
                style={styles.onboardBtn}
                onPress={() => router.push('/reserve/new' as any)}
              >
                <Ionicons name="add-circle-outline" size={16} color="#fff" />
                <Text style={styles.onboardBtnText}>{t('dashboard.createReserve')}</Text>
              </TouchableOpacity>
              {permissions.canManageTeams && (
                <TouchableOpacity
                  style={styles.onboardBtnSecondary}
                  onPress={() => router.navigate('/(tabs)/equipes' as any)}
                >
                  <Ionicons name="people-outline" size={16} color={C.primary} />
                  <Text style={styles.onboardBtnSecondaryText}>{t('dashboard.configureTeams')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {visibleStats.total > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{t('dashboard.globalProgress')}</Text>
              <View style={styles.pctBadge}>
                <Text style={styles.pct}>{visibleStats.progress}%</Text>
              </View>
            </View>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${visibleStats.progress}%` as any }]} />
            </View>
            <Text style={styles.progressHint}>{t('dashboard.closedProgress', { closed: visibleStats.closed, total: visibleStats.total })}</Text>
          </View>
        )}

        {visibleStats.total > 0 && (
          <View style={styles.card}>
            <View style={styles.pinPodiumHeader}>
              <View style={styles.pinPodiumTitleBlock}>
                <Text style={styles.cardTitle}>{t('dashboard.pinPodiumTitle')}</Text>
                <Text style={styles.cardSub}>{t('dashboard.pinPodiumSubtitle')}</Text>
              </View>
              <View style={styles.pinPodiumTotalBadge}>
                <Ionicons name="location-outline" size={13} color={C.primary} />
                <Text style={styles.pinPodiumTotalText}>
                  {t('dashboard.pinPodiumTotal', { count: pinnedVisibleReserves.length })}
                </Text>
              </View>
            </View>
            {companyPinPodium.length === 0 ? (
              <Text style={styles.emptyAnalytics}>{t('dashboard.pinPodiumEmpty')}</Text>
            ) : (
              <View style={styles.pinPodiumList}>
                {companyPinPodium.map((company, index) => (
                  <View key={company.id ?? company.name} style={styles.pinPodiumRow}>
                    <View style={[
                      styles.pinPodiumRank,
                      index === 0 && styles.pinPodiumRankGold,
                      index === 1 && styles.pinPodiumRankSilver,
                      index === 2 && styles.pinPodiumRankBronze,
                    ]}>
                      <Text style={styles.pinPodiumRankText}>{index + 1}</Text>
                    </View>
                    <View style={[styles.pinPodiumColor, { backgroundColor: company.color }]} />
                    <View style={styles.pinPodiumBody}>
                      <Text style={styles.pinPodiumCompany} numberOfLines={1}>{company.shortName}</Text>
                      <Text style={styles.pinPodiumMeta}>
                        {t('dashboard.pinPodiumRatio', { pinned: company.pinned, total: company.total })}
                      </Text>
                    </View>
                    <View style={styles.pinPodiumScore}>
                      <Text style={styles.pinPodiumScoreValue}>{company.pinned}</Text>
                      <Text style={styles.pinPodiumScoreLabel}>
                        {t('dashboard.pinPodiumPinned', { count: company.pinned })}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {visibleStats.total > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('dashboard.reserveBreakdown')}</Text>
            <View style={styles.statusBars}>
              <ReserveStatusBar label={t('reserveLabels.status.open')} count={visibleStats.open} total={visibleStats.total} color={C.open} />
              <ReserveStatusBar label={t('reserveLabels.status.in_progress')} count={visibleStats.inProgress} total={visibleStats.total} color={C.inProgress} />
              <ReserveStatusBar label={t('reserveLabels.status.waiting')} count={visibleStats.waiting} total={visibleStats.total} color={C.waiting} />
              <ReserveStatusBar label={t('reserveLabels.status.verification')} count={visibleStats.verification} total={visibleStats.total} color={C.verification} />
              <ReserveStatusBar label={t('reserveLabels.status.closed')} count={visibleStats.closed} total={visibleStats.total} color={C.closed} />
            </View>
          </View>
        )}

        {visibleStats.total > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{t('dashboard.analytics')}</Text>
              {!isSousTraitant && (
                <View style={styles.tabSwitch}>
                  <TouchableOpacity
                    style={[styles.tabSwitchBtn, analyticsTab === 'trend' && styles.tabSwitchBtnActive]}
                    onPress={() => setAnalyticsTab('trend')}
                  >
                    <Text style={[styles.tabSwitchText, analyticsTab === 'trend' && styles.tabSwitchTextActive]}>
                      {t('dashboard.trend')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.tabSwitchBtn, analyticsTab === 'companies' && styles.tabSwitchBtnActive]}
                    onPress={() => setAnalyticsTab('companies')}
                  >
                    <Text style={[styles.tabSwitchText, analyticsTab === 'companies' && styles.tabSwitchTextActive]}>
                      {t('dashboard.companies')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {(isSousTraitant || analyticsTab === 'trend') && (
              <>
                <Text style={styles.chartSubtitle}>{t('dashboard.lastWeeks')}</Text>
                <WeekTrendChart
                  weekStats={weekStats}
                  createdLabel={t('dashboard.created')}
                  closedLabel={t('dashboard.closedPlural')}
                />
              </>
            )}

            {!isSousTraitant && analyticsTab === 'companies' && (
              <>
                {companyStats.length === 0 ? (
                  <Text style={styles.emptyAnalytics}>{t('dashboard.noCompanyData')}</Text>
                ) : (
                  <>
                    <Text style={styles.chartSubtitle}>{t('dashboard.companyClosureRate')}</Text>
                    <CompanyTable stats={companyStats} />
                  </>
                )}
              </>
            )}
          </View>
        )}

        {criticalReserves.length > 0 && (
          <View style={styles.alertCard}>
            <View style={styles.alertHeader}>
              <View style={styles.alertIconWrap}>
                <Ionicons name="warning" size={16} color={C.critical} />
              </View>
              <Text style={styles.alertTitle}>{t('dashboard.criticalAlerts')}</Text>
              <View style={styles.alertCount}>
                <Text style={styles.alertCountText}>{criticalReserves.length}</Text>
              </View>
            </View>
            {criticalReserves.map(r => (
              <TouchableOpacity
                key={r.id}
                style={styles.alertItem}
                onPress={() => router.push(`/reserve/${r.id}` as any)}
              >
                <View style={styles.alertDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertText}>{r.title}</Text>
                  <Text style={styles.alertSub}>{r.building ? `${t('dashboard.buildingShort')} ${r.building} — ` : ''}{t('dashboard.deadline')} : {r.deadline}</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={C.critical} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {overdueNonCritical.length > 0 && (
          <View style={styles.overdueCard}>
            <View style={styles.alertHeader}>
              <View style={styles.overdueIconWrap}>
                <Ionicons name="calendar-outline" size={16} color={C.high} />
              </View>
              <Text style={styles.overdueTitle}>{t('dashboard.overdueReserves')}</Text>
              <View style={styles.overdueCount}>
                <Text style={styles.overdueCountText}>{overdueNonCritical.length}</Text>
              </View>
            </View>
            {overdueNonCritical.map(r => (
              <TouchableOpacity
                key={r.id}
                style={styles.overdueItem}
                onPress={() => router.push(`/reserve/${r.id}` as any)}
              >
                <View style={[styles.alertDot, { backgroundColor: C.high }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertText}>{r.title}</Text>
                  <Text style={styles.alertSub}>{r.building ? `${t('dashboard.buildingShort')} ${r.building} — ` : ''}{priorityLabels[r.priority as keyof typeof priorityLabels] ?? r.priority} — {t('dashboard.deadline')} : {r.deadline}</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={C.high} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {chantiers.length > 0 && permissions.canViewTeams && (() => {
          // Compactage : on ne montre par défaut que les entreprises ayant
          // de l'activité aujourd'hui (effectif réel ou planifié > 0).
          // Les entreprises 0/0 sont masquées derrière un bouton "Voir tout".
          const activeCompanies = visibleCompanies.filter(
            co => co.actualWorkers > 0 || co.plannedWorkers > 0
          );
          const inactiveCount = visibleCompanies.length - activeCompanies.length;
          const displayList = personnelExpanded ? visibleCompanies : activeCompanies;
          const hasNoActivity = activeCompanies.length === 0;

          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{t('dashboard.personnelToday')}</Text>
                <Text style={styles.cardSub}>
                  {t('dashboard.peopleCount', { actual: stats.totalWorkers, planned: stats.plannedWorkers })}
                </Text>
              </View>

              {/* État vide compact : aucune entreprise active aujourd'hui */}
              {hasNoActivity && !personnelExpanded && (
                <TouchableOpacity
                  style={styles.personnelEmptyRow}
                  onPress={() => setPersonnelExpanded(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="people-outline" size={16} color={C.textSub} />
                  <Text style={styles.personnelEmptyText}>
                    {t('dashboard.noAttendance', { count: visibleCompanies.length })}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={C.textSub} />
                </TouchableOpacity>
              )}

              {/* Liste (active par défaut, complète si expanded) */}
              {(!hasNoActivity || personnelExpanded) && displayList.map(co => {
                const pct = co.plannedWorkers > 0 ? (co.actualWorkers / co.plannedWorkers) * 100 : 0;
                const isOver = co.actualWorkers > co.plannedWorkers;
                const isUnder = co.plannedWorkers > 0 && co.actualWorkers < co.plannedWorkers * 0.7;
                const barColor = isOver ? C.waiting : isUnder ? C.open : co.color;
                return (
                  <View key={co.id} style={styles.coRow}>
                    <View style={[styles.coDot, { backgroundColor: co.color }]} />
                    <Text style={styles.coName}>{co.shortName}</Text>
                    <View style={styles.coBarWrap}>
                      <View style={[styles.coBarFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: barColor }]} />
                    </View>
                    <Text style={[styles.coCount, { color: isOver ? C.waiting : isUnder ? C.open : co.color }]}>
                      {co.actualWorkers}/{co.plannedWorkers}{isOver ? ' ↑' : isUnder ? ' ↓' : ''}
                    </Text>
                  </View>
                );
              })}

              {/* Toggle expand / collapse — seulement si y'a quelque chose à cacher/montrer */}
              {!hasNoActivity && inactiveCount > 0 && !personnelExpanded && (
                <TouchableOpacity
                  style={styles.personnelToggle}
                  onPress={() => setPersonnelExpanded(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-down" size={14} color={C.primary} />
                  <Text style={styles.personnelToggleText}>
                    {t('dashboard.seeOtherCompanies', { count: inactiveCount })}
                  </Text>
                </TouchableOpacity>
              )}
              {personnelExpanded && visibleCompanies.length > 5 && (
                <TouchableOpacity
                  style={styles.personnelToggle}
                  onPress={() => setPersonnelExpanded(false)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-up" size={14} color={C.primary} />
                  <Text style={styles.personnelToggleText}>{t('dashboard.reduce')}</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })()}

        {lateTasks.length > 0 && !isSousTraitant && (
          <View style={styles.delayCard}>
            <View style={styles.alertHeader}>
              <View style={styles.delayIconWrap}>
                <Ionicons name="time-outline" size={16} color={C.waiting} />
              </View>
              <Text style={styles.delayTitle}>{lateTasks.length === 1 ? t('dashboard.lateTasks', { count: 1 }) : t('dashboard.lateTasks', { count: lateTasks.length })}</Text>
              <View style={styles.delayCount}>
                <Text style={styles.delayCountText}>{lateTasks.length}</Text>
              </View>
            </View>
            {lateTasks.map(task => (
              <TouchableOpacity
                key={task.id}
                style={styles.delayItem}
                onPress={() => router.push('/planning' as any)}
              >
                <View style={styles.delayDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertText}>{task.title}</Text>
                  <Text style={styles.alertSub}>
                    {(task.status === 'delayed' ? t('dashboard.markedLate') : t('dashboard.deadlineExceeded'))} — {task.deadline}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={C.waiting} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>}

      <GlobalSearch
        visible={globalSearchVisible}
        onClose={() => setGlobalSearchVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingLeft: 20,
    paddingRight: 16,
    paddingBottom: 10,
    flexDirection: 'column',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
    gap: 8,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  headerGreeting: { flex: 1, minWidth: 0 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  realtimeDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  syncChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#F59E0B',
    minHeight: 22,
  },
  syncChipText: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
  },
  iconHeaderBtn: {
    width: 36, height: 36,
    borderRadius: 10,
    backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  bellBtn: {
    width: 36, height: 36,
    borderRadius: 10,
    backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute',
    top: -3, right: -3,
    minWidth: 16, height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bellBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  logoMini: {
    width: 34, height: 34,
    backgroundColor: C.primary,
    borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  logoMiniLetter: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.accent },
  brand: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  date: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 1 },
  chantierPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 22, borderWidth: 1.5, borderColor: C.primary + '60', maxWidth: 120,
  },
  chantierPillRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primaryBg,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1.5, borderColor: C.primary + '50',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  chantierPillRowText: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary,
    flexShrink: 1,
  },
  chantierPillRowEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surface2,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1.5, borderColor: C.border,
    alignSelf: 'flex-start',
  },
  chantierPillRowReadOnly: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surface2,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1.5, borderColor: C.border,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  chantierPillReadOnly: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surface2, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 22, borderWidth: 1.5, borderColor: C.border, maxWidth: 120,
  },
  chantierPillReadOnlyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.textMuted },
  chantierPillReadOnlyText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, flexShrink: 1 },
  chantierPillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.primary },
  chantierPillText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.primary, flex: 1 },
  chantierPillEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surface2, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 22, borderWidth: 1.5, borderColor: C.border,
  },
  chantierPillEmptyText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted },

  viewToggleBar: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  viewToggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10,
    backgroundColor: C.surface2,
  },
  viewToggleBtnActive: {
    backgroundColor: C.primaryBg,
    borderWidth: 1.5,
    borderColor: C.primary + '50',
  },
  viewToggleText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textMuted },
  viewToggleTextActive: { fontFamily: 'Inter_700Bold', color: C.primary },
  viewToggleBadge: {
    backgroundColor: C.primary, borderRadius: 8,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  viewToggleBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },

  scopeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primaryBg, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 10,
    borderWidth: 1, borderColor: C.primary + '30',
  },
  scopeDot: { width: 8, height: 8, borderRadius: 4 },
  scopeText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary },
  scopeBold: { fontFamily: 'Inter_700Bold' },

  content: { padding: 14, paddingBottom: 36 },
  contentEmpty: { flexGrow: 1, padding: 0, paddingBottom: 0 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  kpiTouchable: { flex: 1, minWidth: '44%' },
  kpiCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  kpiCard: {
    backgroundColor: C.surface,
    borderRadius: 14, padding: 18, borderLeftWidth: 4,
    borderWidth: 1, borderColor: C.border, elevation: 1,
    ...Platform.select({
      web: { boxShadow: '0px 1px 6px rgba(0,48,130,0.06)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6 },
    }),
  },
  kpiIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 2 },
  kpiLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  kpiWide: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderLeftWidth: 4, borderWidth: 1, borderColor: C.border,
    marginBottom: 10, elevation: 1,
    ...Platform.select({
      web: { boxShadow: '0px 1px 6px rgba(0,48,130,0.06)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6 },
    }),
  },
  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: C.border, elevation: 1,
    ...Platform.select({
      web: { boxShadow: '0px 1px 6px rgba(0,48,130,0.05)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6 },
    }),
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text },
  cardSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  pctBadge: { backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  pct: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary },
  progressBg: { height: 8, backgroundColor: C.surface2, borderRadius: 6, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: 8, backgroundColor: C.primary, borderRadius: 6 },
  progressHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  statusBars: { gap: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, width: 72 },
  statusBarWrap: { flex: 1, height: 6, backgroundColor: C.surface2, borderRadius: 4, overflow: 'hidden' },
  statusBarFill: { height: 6, borderRadius: 4 },
  statusCount: { fontSize: 12, fontFamily: 'Inter_700Bold', width: 28, textAlign: 'right' },

  tabSwitch: { flexDirection: 'row', gap: 4, backgroundColor: C.surface2, borderRadius: 10, padding: 3 },
  tabSwitchBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  tabSwitchBtnActive: { backgroundColor: C.surface },
  tabSwitchText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted },
  tabSwitchTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  chartSubtitle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 12 },
  emptyAnalytics: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', paddingVertical: 20 },
  pinPodiumHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  pinPodiumTitleBlock: { flex: 1, minWidth: 0 },
  pinPodiumTotalBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primaryBg, borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 5, flexShrink: 0,
  },
  pinPodiumTotalText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.primary },
  pinPodiumList: { gap: 8 },
  pinPodiumRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, paddingHorizontal: 10,
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    backgroundColor: C.surface2,
  },
  pinPodiumRank: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.primary,
  },
  pinPodiumRankGold: { backgroundColor: '#F59E0B' },
  pinPodiumRankSilver: { backgroundColor: '#64748B' },
  pinPodiumRankBronze: { backgroundColor: '#B45309' },
  pinPodiumRankText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  pinPodiumColor: { width: 8, height: 34, borderRadius: 6 },
  pinPodiumBody: { flex: 1, minWidth: 0 },
  pinPodiumCompany: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  pinPodiumMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  pinPodiumScore: { alignItems: 'flex-end', minWidth: 66 },
  pinPodiumScoreValue: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.primary },
  pinPodiumScoreLabel: { fontSize: 9, fontFamily: 'Inter_600SemiBold', color: C.textMuted },

  chartContainer: { gap: 8 },
  chartLegend: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 100 },
  barGroup: { flex: 1, alignItems: 'center', gap: 4 },
  barPair: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 80 },
  barCol: { flex: 1, justifyContent: 'flex-end' },
  bar: { borderRadius: 3, minHeight: 2 },
  barLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },

  companyTable: { gap: 10 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  companyDot: { width: 10, height: 10, borderRadius: 5 },
  companyName: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text, width: 90 },
  companyBarWrap: { flex: 1, height: 8, backgroundColor: C.surface2, borderRadius: 4, overflow: 'hidden' },
  companyBarFill: { height: 8, borderRadius: 4 },
  companyRate: { fontSize: 12, fontFamily: 'Inter_700Bold', width: 34, textAlign: 'right' },
  overdueTag: { backgroundColor: '#EF444415', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  overdueTagText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },

  coRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  coDot: { width: 10, height: 10, borderRadius: 5 },
  coName: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text, width: 60 },
  coBarWrap: { flex: 1, height: 8, backgroundColor: C.surface2, borderRadius: 4, overflow: 'hidden' },
  coBarFill: { height: 8, borderRadius: 4 },
  coCount: { fontSize: 12, fontFamily: 'Inter_700Bold', width: 52, textAlign: 'right' },
  personnelEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: C.surface2,
    borderRadius: 8,
  },
  personnelEmptyText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.textSub,
  },
  personnelToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: C.surface2,
  },
  personnelToggleText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },

  dashLoadingState: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 40,
  },
  dashEmptyState: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    padding: 28, gap: 12,
  },
  dashEmptyIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '25',
    alignItems: 'center', justifyContent: 'center',
  },
  dashEmptyTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center' },
  dashEmptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  dashEmptyFeatures: {
    width: '100%', gap: 0, marginVertical: 8,
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  dashEmptyFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  dashEmptyFeatureDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  dashEmptyFeatureTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 2 },
  dashEmptyFeatureDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 17 },
  dashEmptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14, marginTop: 4 },
  dashEmptyBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  onboardCard: {
    backgroundColor: C.surface, borderRadius: 16, padding: 24,
    alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: C.border,
  },
  onboardIconWrap: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  onboardTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 8, textAlign: 'center' },
  onboardText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20, marginBottom: 18 },
  onboardActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  onboardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12,
  },
  onboardBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  onboardBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.primaryBg, paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1, borderColor: C.primary + '40',
  },
  onboardBtnSecondaryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },

  alertCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.critical + '30',
    borderLeftWidth: 4, borderLeftColor: C.critical,
    marginBottom: 10,
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  alertIconWrap: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: C.critical + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  alertTitle: { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: C.critical },
  alertCount: {
    backgroundColor: C.critical, width: 22, height: 22,
    borderRadius: 11, alignItems: 'center', justifyContent: 'center',
  },
  alertCountText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  alertItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border },
  alertDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.critical },
  alertText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  alertSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },

  overdueCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.high + '30',
    borderLeftWidth: 4, borderLeftColor: C.high,
    marginBottom: 10,
  },
  overdueIconWrap: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.high + '15', alignItems: 'center', justifyContent: 'center' },
  overdueTitle: { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: C.high },
  overdueCount: { backgroundColor: C.high, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  overdueCountText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  overdueItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border },

  delayCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.waiting + '30',
    borderLeftWidth: 4, borderLeftColor: C.waiting,
    marginBottom: 10,
  },
  delayIconWrap: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.waiting + '15', alignItems: 'center', justifyContent: 'center' },
  delayTitle: { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', color: C.waiting },
  delayCount: { backgroundColor: C.waiting, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  delayCountText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  delayItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border },
  delayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.waiting },

  fab: {
    position: 'absolute',
    right: 18,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 30,
    elevation: 6,
    ...Platform.select({
      web: { boxShadow: '0px 4px 16px rgba(0,48,130,0.30)' } as any,
      default: { shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10 },
    }),
  },
  fabLabel: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
});
