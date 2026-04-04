import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useIncidents } from '@/context/IncidentsContext';
import { useApp } from '@/context/AppContext';
import { Incident, IncidentSeverity, IncidentStatus } from '@/constants/types';
import Header from '@/components/Header';
import SkeletonCard from '@/components/SkeletonCard';

const SEVERITY_CONFIG: Record<IncidentSeverity, { label: string; color: string; bg: string; icon: string }> = {
  minor:    { label: 'Mineur',   color: '#6B7280', bg: '#F3F4F6', icon: 'information-circle' },
  moderate: { label: 'Modéré',  color: '#F59E0B', bg: '#FFFBEB', icon: 'warning' },
  major:    { label: 'Majeur',   color: '#EF4444', bg: '#FEF2F2', icon: 'alert-circle' },
  critical: { label: 'Critique', color: '#7F1D1D', bg: '#FEE2E2', icon: 'nuclear' },
};

const STATUS_CONFIG: Record<IncidentStatus, { label: string; color: string; bg: string }> = {
  open:          { label: 'Ouvert',   color: C.open,       bg: C.open + '15'       },
  investigating: { label: 'En cours', color: C.inProgress, bg: C.inProgress + '15' },
  resolved:      { label: 'Résolu',   color: C.closed,     bg: C.closed + '15'     },
};

const SEVERITIES: IncidentSeverity[] = ['minor', 'moderate', 'major', 'critical'];
const STATUSES: IncidentStatus[] = ['open', 'investigating', 'resolved'];

function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Ionicons name={cfg.icon as any} size={11} color={cfg.color} />
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: IncidentStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

type FilterSeverity = IncidentSeverity | 'all';
type FilterStatus = IncidentStatus | 'all';

export default function IncidentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { permissions } = useAuth();
  const { incidents, isLoading, deleteIncident } = useIncidents();
  const { reload } = useApp();

  const [search, setSearch] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<FilterSeverity>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.resolve(reload()); } finally { setRefreshing(false); }
  }, [reload]);

  const filtered = useMemo(() => {
    return incidents.filter(i => {
      if (filterSeverity !== 'all' && i.severity !== filterSeverity) return false;
      if (filterStatus !== 'all' && i.status !== filterStatus) return false;
      if (search && !i.title.toLowerCase().includes(search.toLowerCase()) &&
          !i.location.toLowerCase().includes(search.toLowerCase()) &&
          !i.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }).sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  }, [incidents, filterSeverity, filterStatus, search]);

  const openCount = incidents.filter(i => i.status !== 'resolved').length;

  function handleCreateReserveFromIncident(incident: Incident) {
    router.push({
      pathname: '/reserve/new',
      params: {
        prefill_description: `Issu d'un incident : ${incident.title}. ${incident.description}`,
        prefill_source: `Incident ${incident.severity === 'critical' ? 'critique' : 'majeur'} — ${incident.reportedAt}`,
        building: incident.building,
      },
    } as any);
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Header
        title="Sécurité & Incidents"
        subtitle={`${openCount} non résolu${openCount !== 1 ? 's' : ''}`}
        showBack
        rightActions={
          permissions.canCreate ? (
            <TouchableOpacity
              onPress={() => router.push('/incident/new' as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.headerAddBtn}
            >
              <Ionicons name="add" size={24} color={C.primary} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={15} color={C.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher un incident..."
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={15} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filtersWrap}>
        <View style={styles.filterRowLabeled}>
          <Text style={styles.filterRowLabel}>Statut</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={styles.filterChips}>
              <TouchableOpacity
                style={[styles.fChip, filterStatus === 'all' && styles.fChipActive]}
                onPress={() => setFilterStatus('all')}
              >
                <Text style={[styles.fChipText, filterStatus === 'all' && styles.fChipTextActive]}>Tous</Text>
              </TouchableOpacity>
              {STATUSES.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.fChip, filterStatus === s && { borderColor: STATUS_CONFIG[s].color, backgroundColor: STATUS_CONFIG[s].bg }]}
                  onPress={() => setFilterStatus(prev => prev === s ? 'all' : s)}
                >
                  <Text style={[styles.fChipText, filterStatus === s && { color: STATUS_CONFIG[s].color }]}>
                    {STATUS_CONFIG[s].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
        <View style={styles.filterRowLabeled}>
          <Text style={styles.filterRowLabel}>Gravité</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={styles.filterChips}>
              <TouchableOpacity
                style={[styles.fChip, filterSeverity === 'all' && styles.fChipActive]}
                onPress={() => setFilterSeverity('all')}
              >
                <Text style={[styles.fChipText, filterSeverity === 'all' && styles.fChipTextActive]}>Tous</Text>
              </TouchableOpacity>
              {SEVERITIES.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.fChip, filterSeverity === s && { borderColor: SEVERITY_CONFIG[s].color, backgroundColor: SEVERITY_CONFIG[s].bg }]}
                  onPress={() => setFilterSeverity(prev => prev === s ? 'all' : s)}
                >
                  <Ionicons name={SEVERITY_CONFIG[s].icon as any} size={12} color={SEVERITY_CONFIG[s].color} />
                  <Text style={[styles.fChipText, filterSeverity === s && { color: SEVERITY_CONFIG[s].color }]}>
                    {SEVERITY_CONFIG[s].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        {isLoading ? (
          [0, 1, 2, 3].map(i => <SkeletonCard key={i} />)
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={48} color={C.closed} />
            <Text style={styles.emptyTitle}>Aucun incident</Text>
            <Text style={styles.emptyText}>
              {incidents.length === 0
                ? 'Aucun incident signalé sur ce chantier.'
                : 'Aucun incident ne correspond aux filtres sélectionnés.'}
            </Text>
            {permissions.canCreate && incidents.length === 0 && (
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => router.push('/incident/new' as any)}
              >
                <Ionicons name="add-circle-outline" size={18} color={C.primary} />
                <Text style={styles.emptyBtnText}>Signaler un incident</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          filtered.map(incident => {
            const scfg = SEVERITY_CONFIG[incident.severity];
            return (
              <TouchableOpacity
                key={incident.id}
                style={[styles.incCard, { borderLeftColor: scfg.color }]}
                onPress={() => router.push({ pathname: '/incident/[id]', params: { id: incident.id } } as any)}
                activeOpacity={0.8}
              >
                <View style={styles.incHeader}>
                  <View style={styles.incBadges}>
                    <SeverityBadge severity={incident.severity} />
                    <StatusBadge status={incident.status} />
                  </View>
                  {permissions.canDelete && (
                    <TouchableOpacity
                      onPress={e => {
                        e.stopPropagation?.();
                        deleteIncident(incident.id);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={16} color={C.open} />
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.incTitle}>{incident.title}</Text>
                {!!incident.description && (
                  <Text style={styles.incDesc} numberOfLines={2}>{incident.description}</Text>
                )}
                <View style={styles.incMeta}>
                  {!!(incident.building || incident.location) && (
                    <View style={styles.incMetaItem}>
                      <Ionicons name="location-outline" size={12} color={C.textMuted} />
                      <Text style={styles.incMetaText}>
                        {[incident.building && `Bât. ${incident.building}`, incident.location].filter(Boolean).join(' — ')}
                      </Text>
                    </View>
                  )}
                  <View style={styles.incMetaItem}>
                    <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
                    <Text style={styles.incMetaText}>{incident.reportedAt}</Text>
                  </View>
                  <View style={styles.incMetaItem}>
                    <Ionicons name="person-outline" size={12} color={C.textMuted} />
                    <Text style={styles.incMetaText}>{incident.reportedBy}</Text>
                  </View>
                </View>
                {!!incident.actions && (
                  <View style={styles.actionsRow}>
                    <Ionicons name="checkmark-circle-outline" size={12} color={C.inProgress} />
                    <Text style={styles.actionsText} numberOfLines={1}>{incident.actions}</Text>
                  </View>
                )}
                {incident.status === 'resolved' && incident.closedAt ? (
                  <View style={styles.closedBanner}>
                    <Ionicons name="checkmark-circle" size={12} color={C.closed} />
                    <Text style={styles.closedText}>
                      Résolu le {incident.closedAt}{incident.closedBy ? ` par ${incident.closedBy}` : ''}
                    </Text>
                  </View>
                ) : null}
                {(incident.severity === 'major' || incident.severity === 'critical') && permissions.canCreate && (
                  <TouchableOpacity
                    style={styles.createReserveBtn}
                    onPress={e => { e.stopPropagation?.(); handleCreateReserveFromIncident(incident); }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="alert-circle-outline" size={13} color={C.open} />
                    <Text style={styles.createReserveBtnText}>Créer une réserve</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      {permissions.canCreate && (
        <TouchableOpacity
          style={[styles.fab, { bottom: Math.max(insets.bottom + 16, 24) }]}
          onPress={() => router.push('/incident/new' as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  headerAddBtn: {
    padding: 4,
  },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    backgroundColor: C.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
  },

  filtersWrap: {
    paddingHorizontal: 16, gap: 6, marginBottom: 8,
  },
  filterRowLabeled: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  filterRowLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted,
    width: 44,
  },
  filterChips: { flexDirection: 'row', gap: 6, paddingRight: 16 },
  fChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  fChipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  fChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  fChipTextActive: { color: C.primary },

  list: { paddingHorizontal: 16, paddingTop: 4 },

  empty: { alignItems: 'center', paddingVertical: 64, gap: 8 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 8 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', maxWidth: 260 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 16, paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: C.primaryBg, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40',
  },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },

  incCard: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 10,
    borderLeftWidth: 4, borderWidth: 1, borderColor: C.border,
    ...({ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any),
  },
  incHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  incBadges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  incTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  incDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 8, lineHeight: 18 },
  incMeta: { gap: 4 },
  incMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  incMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  actionsText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress, flex: 1 },
  closedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 8, backgroundColor: C.closed + '10', borderRadius: 8, padding: 8,
  },
  closedText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.closed },
  createReserveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10,
    paddingVertical: 7, paddingHorizontal: 10,
    backgroundColor: C.open + '10', borderRadius: 8,
    borderWidth: 1, borderColor: C.open + '30',
    alignSelf: 'flex-start',
  },
  createReserveBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.open },

  fab: {
    position: 'absolute', right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    ...({ boxShadow: '0 4px 12px rgba(0,0,0,0.2)' } as any),
  },
});
