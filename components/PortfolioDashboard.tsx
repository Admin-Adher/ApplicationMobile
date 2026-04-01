import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState, useCallback } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useIncidents } from '@/context/IncidentsContext';
import { parseDeadline, isOverdue } from '@/lib/reserveUtils';
import { Reserve, Task, Chantier } from '@/constants/types';

function isTaskLate(t: Task): boolean {
  if (t.status === 'done') return false;
  if (t.status === 'delayed') return true;
  const d = parseDeadline(t.deadline);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

interface ChantierKPI {
  chantier: Chantier;
  total: number;
  closed: number;
  critical: number;
  overdue: number;
  progress: number;
  lateTasksCount: number;
}

function GlobalKPIStrip({
  totalReserves, critical, overdue, globalProgress, totalChantiers,
}: {
  totalReserves: number;
  critical: number;
  overdue: number;
  globalProgress: number;
  totalChantiers: number;
}) {
  return (
    <View style={styles.globalStrip}>
      <View style={styles.globalKPIItem}>
        <Text style={styles.globalKPIValue}>{totalChantiers}</Text>
        <Text style={styles.globalKPILabel}>Chantiers</Text>
      </View>
      <View style={styles.stripDivider} />
      <View style={styles.globalKPIItem}>
        <Text style={styles.globalKPIValue}>{totalReserves}</Text>
        <Text style={styles.globalKPILabel}>Réserves</Text>
      </View>
      <View style={styles.stripDivider} />
      <View style={styles.globalKPIItem}>
        <Text style={[styles.globalKPIValue, critical > 0 && { color: C.critical }]}>{critical}</Text>
        <Text style={styles.globalKPILabel}>Critiques</Text>
      </View>
      <View style={styles.stripDivider} />
      <View style={styles.globalKPIItem}>
        <Text style={[styles.globalKPIValue, overdue > 0 && { color: C.high }]}>{overdue}</Text>
        <Text style={styles.globalKPILabel}>En retard</Text>
      </View>
      <View style={styles.stripDivider} />
      <View style={styles.globalKPIItem}>
        <Text style={[styles.globalKPIValue, { color: C.closed }]}>{globalProgress}%</Text>
        <Text style={styles.globalKPILabel}>Avancement</Text>
      </View>
    </View>
  );
}

function GlobalProgressBar({ progress }: { progress: number }) {
  const color = progress >= 70 ? C.closed : progress >= 40 ? C.inProgress : C.waiting;
  return (
    <View style={styles.globalProgressWrap}>
      <View style={styles.globalProgressBg}>
        <View style={[styles.globalProgressFill, { width: `${progress}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[styles.globalProgressPct, { color }]}>{progress}%</Text>
    </View>
  );
}

function CrossAlertRow({
  reserve,
  chantierName,
  type,
  onPress,
}: {
  reserve: Reserve;
  chantierName: string;
  type: 'critical' | 'overdue';
  onPress: () => void;
}) {
  const color = type === 'critical' ? C.critical : C.high;
  const icon = type === 'critical' ? 'warning' : 'time-outline';
  return (
    <TouchableOpacity style={styles.crossAlertRow} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.crossAlertIcon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon as any} size={14} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.crossAlertTitle} numberOfLines={1}>{reserve.title}</Text>
        <View style={styles.crossAlertMeta}>
          <View style={[styles.chantierTag, { backgroundColor: C.primaryBg }]}>
            <Ionicons name="business-outline" size={9} color={C.primary} />
            <Text style={styles.chantierTagText} numberOfLines={1}>{chantierName}</Text>
          </View>
          {reserve.deadline ? (
            <Text style={styles.crossAlertDeadline}>Échéance {reserve.deadline}</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={14} color={color} />
    </TouchableOpacity>
  );
}

function ChantierCard({
  kpi,
  isActive,
  onActivate,
  onPress,
}: {
  kpi: ChantierKPI;
  isActive: boolean;
  onActivate: () => void;
  onPress: () => void;
}) {
  const { chantier, total, closed, critical, overdue, progress, lateTasksCount } = kpi;
  const progressColor = progress >= 70 ? C.closed : progress >= 40 ? C.inProgress : C.waiting;

  const STATUS_CFG: Record<string, { label: string; color: string }> = {
    active: { label: 'En cours', color: C.closed },
    completed: { label: 'Terminé', color: C.primary },
    paused: { label: 'En pause', color: C.medium },
  };
  const statusCfg = STATUS_CFG[chantier.status] ?? STATUS_CFG.active;

  return (
    <TouchableOpacity
      style={[styles.chantierCard, isActive && styles.chantierCardActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.chantierCardTop}>
        <View style={[styles.chantierIconWrap, { backgroundColor: isActive ? C.primary + '18' : C.surface2 }]}>
          <Ionicons name="business" size={20} color={isActive ? C.primary : C.textSub} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.chantierCardName} numberOfLines={1}>{chantier.name}</Text>
          {chantier.address ? (
            <Text style={styles.chantierCardAddress} numberOfLines={1}>{chantier.address}</Text>
          ) : null}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusCfg.color + '18' }]}>
          <Text style={[styles.statusBadgeText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        </View>
      </View>

      <View style={styles.progressRow}>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progress}%` as any, backgroundColor: progressColor }]} />
        </View>
        <Text style={[styles.progressPct, { color: progressColor }]}>{progress}%</Text>
      </View>
      <Text style={styles.progressHint}>{closed} / {total} réserves clôturées</Text>

      <View style={styles.chantierKpiRow}>
        <View style={[styles.chantierMiniKpi, critical > 0 && styles.chantierMiniKpiRed]}>
          <Ionicons name="warning" size={12} color={critical > 0 ? C.critical : C.textMuted} />
          <Text style={[styles.chantierMiniKpiVal, critical > 0 && { color: C.critical }]}>{critical}</Text>
          <Text style={styles.chantierMiniKpiLabel}>Critiques</Text>
        </View>
        <View style={[styles.chantierMiniKpi, overdue > 0 && styles.chantierMiniKpiOrange]}>
          <Ionicons name="time-outline" size={12} color={overdue > 0 ? C.high : C.textMuted} />
          <Text style={[styles.chantierMiniKpiVal, overdue > 0 && { color: C.high }]}>{overdue}</Text>
          <Text style={styles.chantierMiniKpiLabel}>En retard</Text>
        </View>
        <View style={[styles.chantierMiniKpi, lateTasksCount > 0 && styles.chantierMiniKpiYellow]}>
          <Ionicons name="calendar-outline" size={12} color={lateTasksCount > 0 ? C.waiting : C.textMuted} />
          <Text style={[styles.chantierMiniKpiVal, lateTasksCount > 0 && { color: C.waiting }]}>{lateTasksCount}</Text>
          <Text style={styles.chantierMiniKpiLabel}>Tâches retard</Text>
        </View>
      </View>

      <View style={styles.chantierCardActions}>
        {!isActive && (
          <TouchableOpacity
            style={styles.activateBtn}
            onPress={(e) => { e.stopPropagation?.(); onActivate(); }}
            activeOpacity={0.8}
          >
            <Ionicons name="radio-button-off-outline" size={13} color={C.primary} />
            <Text style={styles.activateBtnText}>Activer</Text>
          </TouchableOpacity>
        )}
        {isActive && (
          <View style={styles.activeTag}>
            <Ionicons name="radio-button-on" size={11} color={C.closed} />
            <Text style={styles.activeTagText}>Chantier actif</Text>
          </View>
        )}
        <View style={styles.seeBtn}>
          <Text style={styles.seeBtnText}>Voir le détail</Text>
          <Ionicons name="arrow-forward" size={12} color={C.primary} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

interface Props {
  onSwitchToChantier: () => void;
}

export default function PortfolioDashboard({ onSwitchToChantier }: Props) {
  const router = useRouter();
  const { chantiers, reserves, tasks, setActiveChantier, activeChantierId, reload } = useApp();
  const { incidents } = useIncidents();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }, [reload]);

  const chantierKPIs = useMemo((): ChantierKPI[] => {
    return chantiers.map(chantier => {
      const cReserves = reserves.filter(r => r.chantierId === chantier.id);
      const cTasks = tasks.filter(t => (t as any).chantierId === chantier.id || !t.chantierId);
      const total = cReserves.length;
      const closed = cReserves.filter(r => r.status === 'closed').length;
      const critical = cReserves.filter(r => r.priority === 'critical' && r.status !== 'closed').length;
      const overdue = cReserves.filter(r => r.status !== 'closed' && r.priority !== 'critical' && isOverdue(r.deadline, r.status)).length;
      const progress = total > 0 ? Math.round((closed / total) * 100) : 0;
      const lateTasksCount = chantier.id === activeChantierId ? cTasks.filter(isTaskLate).length : 0;
      return { chantier, total, closed, critical, overdue, progress, lateTasksCount };
    });
  }, [chantiers, reserves, tasks, activeChantierId]);

  const globalStats = useMemo(() => {
    const totalReserves = reserves.length;
    const closed = reserves.filter(r => r.status === 'closed').length;
    const critical = reserves.filter(r => r.priority === 'critical' && r.status !== 'closed').length;
    const overdue = reserves.filter(r => r.status !== 'closed' && r.priority !== 'critical' && isOverdue(r.deadline, r.status)).length;
    const globalProgress = totalReserves > 0 ? Math.round((closed / totalReserves) * 100) : 0;
    return { totalReserves, closed, critical, overdue, globalProgress };
  }, [reserves]);

  const crossAlerts = useMemo(() => {
    const getChantierName = (r: Reserve) => {
      const c = chantiers.find(ch => ch.id === r.chantierId);
      return c?.name ?? 'Chantier inconnu';
    };

    const criticals = reserves
      .filter(r => r.priority === 'critical' && r.status !== 'closed')
      .map(r => ({ reserve: r, chantierName: getChantierName(r), type: 'critical' as const }));

    const overdues = reserves
      .filter(r => r.status !== 'closed' && r.priority !== 'critical' && isOverdue(r.deadline, r.status))
      .map(r => ({ reserve: r, chantierName: getChantierName(r), type: 'overdue' as const }));

    return [...criticals, ...overdues].slice(0, 12);
  }, [reserves, chantiers]);

  const openIncidentsCount = incidents.filter(i => i.status !== 'resolved').length;

  function handleActivateChantier(id: string) {
    setActiveChantier(id);
    onSwitchToChantier();
  }

  function handleViewChantier(id: string) {
    setActiveChantier(id);
    onSwitchToChantier();
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
      }
    >
      <GlobalKPIStrip
        totalChantiers={chantiers.length}
        totalReserves={globalStats.totalReserves}
        critical={globalStats.critical}
        overdue={globalStats.overdue}
        globalProgress={globalStats.globalProgress}
      />

      {globalStats.totalReserves > 0 && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Avancement global — tous chantiers</Text>
          </View>
          <GlobalProgressBar progress={globalStats.globalProgress} />
          <Text style={styles.cardHint}>
            {globalStats.closed} / {globalStats.totalReserves} réserves clôturées sur {chantiers.length} chantiers
          </Text>
        </View>
      )}

      {crossAlerts.length > 0 && (
        <View style={styles.alertCard}>
          <View style={styles.alertHeader}>
            <View style={styles.alertIconWrap}>
              <Ionicons name="alert-circle" size={16} color={C.critical} />
            </View>
            <Text style={styles.alertTitle}>Alertes croisées</Text>
            <View style={styles.alertBadge}>
              <Text style={styles.alertBadgeText}>{crossAlerts.length}</Text>
            </View>
            <View style={{ flex: 1 }} />
            <View style={[styles.alertTypeTag, { backgroundColor: C.criticalBg }]}>
              <View style={[styles.alertTypeDot, { backgroundColor: C.critical }]} />
              <Text style={[styles.alertTypeText, { color: C.critical }]}>{crossAlerts.filter(a => a.type === 'critical').length} crit.</Text>
            </View>
            <View style={[styles.alertTypeTag, { backgroundColor: C.highBg }]}>
              <View style={[styles.alertTypeDot, { backgroundColor: C.high }]} />
              <Text style={[styles.alertTypeText, { color: C.high }]}>{crossAlerts.filter(a => a.type === 'overdue').length} retard</Text>
            </View>
          </View>
          {crossAlerts.map(({ reserve, chantierName, type }) => (
            <CrossAlertRow
              key={reserve.id}
              reserve={reserve}
              chantierName={chantierName}
              type={type}
              onPress={() => router.push(`/reserve/${reserve.id}` as any)}
            />
          ))}
        </View>
      )}

      {openIncidentsCount > 0 && (
        <TouchableOpacity
          style={[styles.incidentBanner]}
          onPress={() => router.push('/incidents' as any)}
          activeOpacity={0.8}
        >
          <View style={styles.incidentIconWrap}>
            <Ionicons name="shield-outline" size={18} color="#EF4444" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.incidentTitle}>
              {openIncidentsCount} incident{openIncidentsCount > 1 ? 's' : ''} non résolu{openIncidentsCount > 1 ? 's' : ''}
            </Text>
            <Text style={styles.incidentSub}>Tous chantiers confondus</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#EF4444" />
        </TouchableOpacity>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Mes chantiers</Text>
        <TouchableOpacity
          style={styles.newChantierBtn}
          onPress={() => router.push('/chantier/new' as any)}
        >
          <Ionicons name="add" size={14} color={C.primary} />
          <Text style={styles.newChantierBtnText}>Nouveau</Text>
        </TouchableOpacity>
      </View>

      {chantierKPIs.map(kpi => (
        <ChantierCard
          key={kpi.chantier.id}
          kpi={kpi}
          isActive={kpi.chantier.id === activeChantierId}
          onActivate={() => handleActivateChantier(kpi.chantier.id)}
          onPress={() => handleViewChantier(kpi.chantier.id)}
        />
      ))}
    </ScrollView>
  );
}

const CARD_SHADOW = Platform.select({
  web: { boxShadow: '0px 1px 6px rgba(0,48,130,0.06)' } as any,
  default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 14, paddingBottom: 48 },

  globalStrip: {
    flexDirection: 'row',
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
    marginBottom: 12,
    ...CARD_SHADOW,
  },
  globalKPIItem: { flex: 1, alignItems: 'center' },
  globalKPIValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#fff', marginBottom: 2 },
  globalKPILabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)' },
  stripDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: C.border,
    ...CARD_SHADOW,
  },
  cardHeader: { marginBottom: 12 },
  cardTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text },
  cardHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 6 },

  globalProgressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  globalProgressBg: { flex: 1, height: 10, backgroundColor: C.surface2, borderRadius: 6, overflow: 'hidden' },
  globalProgressFill: { height: 10, borderRadius: 6 },
  globalProgressPct: { fontSize: 14, fontFamily: 'Inter_700Bold', width: 40, textAlign: 'right' },

  alertCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 1.5, borderColor: C.critical + '30',
    ...CARD_SHADOW,
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  alertIconWrap: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.criticalBg, alignItems: 'center', justifyContent: 'center' },
  alertTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text },
  alertBadge: { backgroundColor: C.critical, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  alertBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  alertTypeTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  alertTypeDot: { width: 6, height: 6, borderRadius: 3 },
  alertTypeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  crossAlertRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.borderLight,
  },
  crossAlertIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  crossAlertTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text, marginBottom: 4 },
  crossAlertMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chantierTag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  chantierTagText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.primary },
  crossAlertDeadline: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },

  incidentBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FEF2F2', borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 1.5, borderColor: '#EF444430',
  },
  incidentIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#EF444415', alignItems: 'center', justifyContent: 'center' },
  incidentTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#DC2626' },
  incidentSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#EF4444', marginTop: 1 },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10, marginTop: 2,
  },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text },
  newChantierBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40',
  },
  newChantierBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

  chantierCard: {
    backgroundColor: C.surface, borderRadius: 16, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: C.border,
    ...CARD_SHADOW,
  },
  chantierCardActive: {
    borderColor: C.primary + '50', borderWidth: 1.5,
  },
  chantierCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  chantierIconWrap: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  chantierCardName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text },
  chantierCardAddress: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  progressBarBg: { flex: 1, height: 8, backgroundColor: C.surface2, borderRadius: 5, overflow: 'hidden' },
  progressBarFill: { height: 8, borderRadius: 5 },
  progressPct: { fontSize: 13, fontFamily: 'Inter_700Bold', width: 36, textAlign: 'right' },
  progressHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 14 },

  chantierKpiRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  chantierMiniKpi: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 7,
  },
  chantierMiniKpiRed: { backgroundColor: C.criticalBg },
  chantierMiniKpiOrange: { backgroundColor: C.highBg },
  chantierMiniKpiYellow: { backgroundColor: C.waitingBg },
  chantierMiniKpiVal: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text },
  chantierMiniKpiLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },

  chantierCardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: C.primary + '50',
  },
  activateBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  activeTag: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  activeTagText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.closed },
  seeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primaryBg, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10,
  },
  seeBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
});
