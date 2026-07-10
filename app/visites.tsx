import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useMemo, useState, useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Visite, VisiteStatus, VisiteType } from '@/constants/types';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';
import PageContainer from '@/components/PageContainer';
import { showAlert } from '@/lib/appAlert';

const STATUS_CFG: Record<VisiteStatus, { color: string; icon: string }> = {
  planned: { color: '#6366F1', icon: 'calendar-outline' },
  in_progress: { color: C.inProgress, icon: 'walk-outline' },
  completed: { color: C.closed, icon: 'checkmark-circle-outline' },
};

const TYPE_CFG: Record<VisiteType, { icon: string; color: string }> = {
  controle:  { icon: 'clipboard-outline',          color: '#6366F1' },
  opr:       { icon: 'document-text-outline',      color: '#F59E0B' },
  securite:  { icon: 'shield-outline',             color: '#EF4444' },
  reception: { icon: 'ribbon-outline',             color: '#10B981' },
  synthese:  { icon: 'people-outline',             color: '#3B82F6' },
  autre:     { icon: 'ellipsis-horizontal-outline', color: '#6B7280' },
};

type VisitFilter = 'all' | VisiteStatus;

const FILTER_OPTIONS: { value: VisitFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'visits.statusFilter.all' },
  { value: 'planned', labelKey: 'visits.statusFilter.planned' },
  { value: 'in_progress', labelKey: 'visits.statusFilter.in_progress' },
  { value: 'completed', labelKey: 'visits.statusFilter.completed' },
];

function VisiteCard({
  visite, reserveCount, onPress, onDelete, canDelete,
}: {
  visite: Visite; reserveCount: number; onPress: () => void; onDelete: () => void; canDelete: boolean;
}) {
  const { t } = useTranslation();
  const cfg = STATUS_CFG[visite.status];
  const typeCfg = visite.visitType ? TYPE_CFG[visite.visitType] : null;
  const locationMeta = visite.visitedLocations?.length
    ? t('visits.buildings', { count: visite.visitedLocations.length })
    : [
      visite.building ? t('visits.buildingShort', { building: visite.building }) : '',
      visite.level,
      visite.zone,
    ].filter(Boolean).join(' — ');
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <View style={styles.cardBadges}>
          <View style={[styles.statusBadge, { backgroundColor: cfg.color + '20' }]}>
            <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
            <Text style={[styles.statusText, { color: cfg.color }]}>
              {t(`visits.status.${visite.status}`)}
            </Text>
          </View>
          {typeCfg && (
            <View style={[styles.typeBadge, { backgroundColor: typeCfg.color + '15' }]}>
              <Ionicons name={typeCfg.icon as any} size={11} color={typeCfg.color} />
              <Text style={[styles.typeBadgeText, { color: typeCfg.color }]}>
                {t(`visits.type.${visite.visitType}`)}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.cardActions}>
          <Text style={styles.cardDate}>{visite.date}</Text>
          {canDelete && (
            <TouchableOpacity
              onPress={(event) => {
                event.stopPropagation?.();
                onDelete();
              }}
              hitSlop={8}
              style={{ marginLeft: 8 }}
            >
              <Ionicons name="trash-outline" size={15} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Text style={styles.cardTitle}>{visite.title}</Text>

      <View style={styles.cardMeta}>
        <Ionicons name="person-outline" size={12} color={C.textMuted} />
        <Text style={styles.cardMetaText}>{visite.conducteur}</Text>
        {locationMeta && (
          <>
            <Ionicons name="business-outline" size={12} color={C.textMuted} style={{ marginLeft: 10 }} />
            <Text style={styles.cardMetaText}>{locationMeta}</Text>
          </>
        )}
      </View>

      {visite.notes ? (
        <Text style={styles.cardNotes} numberOfLines={2}>{visite.notes}</Text>
      ) : null}

      <View style={styles.cardFooter}>
        <View style={styles.reservesPill}>
          <Ionicons name="warning-outline" size={12} color={C.open} />
          <Text style={styles.reservesPillText}>{t('visits.reserves', { count: reserveCount })}</Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

export default function VisitesScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { visites, reserves, deleteVisite, activeChantierId, reload, isLoading } = useApp();
  const { user, permissions } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<VisitFilter>('all');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.resolve(reload()); } finally { setRefreshing(false); }
  }, [reload]);

  const chantierVisites = useMemo(
    () => visites.filter(v => !activeChantierId || v.chantierId === activeChantierId)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [visites, activeChantierId]
  );

  const stats = useMemo(() => ({
    total: chantierVisites.length,
    planned: chantierVisites.filter(v => v.status === 'planned').length,
    inProgress: chantierVisites.filter(v => v.status === 'in_progress').length,
    completed: chantierVisites.filter(v => v.status === 'completed').length,
  }), [chantierVisites]);

  const reserveCountsByVisit = useMemo(() => {
    const existingReserveIds = new Set(reserves.map(r => r.id));
    const counts = new Map<string, Set<string>>();
    const ensure = (visitId: string) => {
      const current = counts.get(visitId);
      if (current) return current;
      const next = new Set<string>();
      counts.set(visitId, next);
      return next;
    };

    chantierVisites.forEach(v => {
      const linkedIds = ensure(v.id);
      v.reserveIds.forEach(id => {
        if (existingReserveIds.has(id)) linkedIds.add(id);
      });
    });

    reserves.forEach(r => {
      if (r.visiteId) ensure(r.visiteId).add(r.id);
    });

    return new Map(Array.from(counts.entries()).map(([visitId, ids]) => [visitId, ids.size]));
  }, [chantierVisites, reserves]);

  const visibleVisites = useMemo(
    () => statusFilter === 'all'
      ? chantierVisites
      : chantierVisites.filter(v => v.status === statusFilter),
    [chantierVisites, statusFilter]
  );

  const sectionTitle = statusFilter === 'all'
    ? t('visits.allVisits')
    : t(FILTER_OPTIONS.find(opt => opt.value === statusFilter)?.labelKey ?? 'visits.visitsFallback');

  if (user?.role === 'sous_traitant') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, marginBottom: 8 }}>{t('visits.restrictedTitle')}</Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginBottom: 24 }}>
          {t('visits.restrictedText')}
        </Text>
        <TouchableOpacity onPress={() => goBack()} style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: C.primaryBg, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40' }}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary }}>{t('visits.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function handleDelete(v: Visite) {
    showAlert(t('visits.deleteTitle'), t('visits.deleteText', { title: v.title }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('visits.delete'), style: 'destructive', onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          deleteVisite(v.id);
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Header
        title={t('visits.title')}
        subtitle={t('visits.count', { count: stats.total })}
        showBack
        rightIcon={permissions.canCreate ? 'add-circle-outline' : undefined}
        onRightPress={permissions.canCreate ? () => router.push('/visite/new' as any) : undefined}
      />

      <PageContainer maxWidth={1000}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        <View style={styles.statsRow}>
          {[
            { label: t('visits.statusFilter.planned'), count: stats.planned, color: '#6366F1', filter: 'planned' as VisitFilter },
            { label: t('visits.statusFilter.in_progress'), count: stats.inProgress, color: C.inProgress, filter: 'in_progress' as VisitFilter },
            { label: t('visits.statusFilter.completed'), count: stats.completed, color: C.closed, filter: 'completed' as VisitFilter },
          ].map(s => (
            <TouchableOpacity
              key={s.label}
              style={[
                styles.statCard,
                { borderTopColor: s.color },
                statusFilter === s.filter && { borderColor: s.color, backgroundColor: s.color + '10' },
              ]}
              onPress={() => setStatusFilter(statusFilter === s.filter ? 'all' : s.filter)}
              activeOpacity={0.8}
            >
              <Text style={[styles.statVal, { color: s.color }]}>{s.count}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTER_OPTIONS.map(opt => {
            const active = statusFilter === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setStatusFilter(opt.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{t(opt.labelKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{sectionTitle}</Text>
          {permissions.canCreate && (
            <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/visite/new' as any)}>
              <Ionicons name="add" size={15} color={C.primary} />
              <Text style={styles.newBtnText}>{t('visits.newVisit')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {isLoading && !refreshing && chantierVisites.length === 0 ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color={C.primary} />
            <Text style={styles.loadingText}>{t('visits.loading')}</Text>
          </View>
        ) : visibleVisites.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="walk-outline" size={40} color={C.textMuted} />
            <Text style={styles.emptyTitle}>
              {chantierVisites.length === 0 ? t('visits.noVisit') : t('visits.noVisitInFilter')}
            </Text>
            <Text style={styles.emptyText}>
              {chantierVisites.length === 0
                ? t('visits.createHint')
                : t('visits.changeFilterHint')}
            </Text>
            {permissions.canCreate && chantierVisites.length === 0 && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/visite/new' as any)}>
                <Text style={styles.emptyBtnText}>{t('visits.createVisit')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          visibleVisites.map(v => (
            <VisiteCard
              key={v.id}
              visite={v}
              reserveCount={reserveCountsByVisit.get(v.id) ?? 0}
              onPress={() => router.push(`/visite/${v.id}` as any)}
              onDelete={() => handleDelete(v)}
              canDelete={permissions.canDelete}
            />
          ))
        )}
      </ScrollView>
      </PageContainer>

      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 100 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  statCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border, borderTopWidth: 3, alignItems: 'center',
  },
  statVal: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2, textAlign: 'center' },

  filterRow: { gap: 8, paddingBottom: 14 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  filterChipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  filterChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  filterChipTextActive: { color: C.primary, fontFamily: 'Inter_700Bold' },

  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  newBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardBadges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  typeBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  cardActions: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, marginLeft: 8 },
  cardDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },

  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 8 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  cardMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  cardNotes: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18, marginBottom: 10, fontStyle: 'italic' },

  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  reservesPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  reservesPillText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.open },

  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center' },
  emptyBtn: { backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  loadingState: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 44, gap: 10,
  },
  loadingText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
});
