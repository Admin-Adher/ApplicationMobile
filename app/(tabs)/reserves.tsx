import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Platform, ScrollView, Modal, ActivityIndicator, useWindowDimensions, Image, Alert, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, useMemo, useCallback } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Reserve, ReserveStatus, ReservePriority, ReserveKind } from '@/constants/types';
import ReserveCard from '@/components/ReserveCard';
import { isOverdue } from '@/lib/reserveUtils';

function buildReservesCSV(reserves: Reserve[]): string {
  const header = 'ID,Titre,Bâtiment,Zone,Niveau,Entreprise,Priorité,Statut,Créé le,Échéance,Description';
  const PRIORITY_MAP: Record<string, string> = { low: 'Faible', medium: 'Moyenne', high: 'Haute', critical: 'Critique' };
  const STATUS_MAP: Record<string, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé' };
  const rows = reserves.map(r => {
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    return [
      esc(r.id), esc(r.title), esc(`Bât. ${r.building}`), esc(r.zone), esc(r.level),
      esc(r.company), esc(PRIORITY_MAP[r.priority] ?? r.priority), esc(STATUS_MAP[r.status] ?? r.status),
      esc(r.createdAt), esc(r.deadline ?? '—'), esc(r.description),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

function parseDeadline(s: string): Date | null {
  if (!s || s === '—') return null;
  const parts = s.split('/');
  if (parts.length === 3) return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  return null;
}

const STATUS_FILTERS: { key: 'all' | 'overdue' | ReserveStatus; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'open', label: 'Ouvert' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'waiting', label: 'En attente' },
  { key: 'verification', label: 'Vérification' },
  { key: 'closed', label: 'Clôturé' },
  { key: 'overdue', label: '⚠ En retard' },
];

type SortKey = 'date_desc' | 'date_asc' | 'priority' | 'deadline' | 'status';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'date_desc', label: 'Plus récente' },
  { key: 'date_asc', label: 'Plus ancienne' },
  { key: 'priority', label: 'Priorité (critique d\'abord)' },
  { key: 'deadline', label: 'Échéance (plus proche)' },
  { key: 'status', label: 'Statut' },
];

const PRIORITY_ORDER: Record<ReservePriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER_MAP: Record<ReserveStatus, number> = { open: 0, in_progress: 1, waiting: 2, verification: 3, closed: 4 };
const STATUS_LABELS: Record<ReserveStatus, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé' };

function toSortableDate(s: string): string {
  if (!s || s === '—') return '9999-99-99';
  const p = s.split('/');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : s;
}

export default function ReservesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reserves, companies, isLoading, chantiers, activeChantierId, lots, batchUpdateReserves } = useApp();
  const { permissions, user } = useAuth();

  const isSousTraitant = user?.role === 'sous_traitant';
  const sousTraitantCompanyName = isSousTraitant && user?.companyId
    ? companies.find(c => c.id === user.companyId)?.name ?? null
    : null;
  const [chantierFilter, setChantierFilter] = useState<string>(activeChantierId ?? 'all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'overdue' | ReserveStatus>('all');
  const [kindFilter, setKindFilter] = useState<'all' | ReserveKind>('all');
  const [buildingFilter, setBuildingFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | ReservePriority>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [lotFilter, setLotFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date_desc');
  const [search, setSearch] = useState('');
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const topPad = insets.top;
  const { width } = useWindowDimensions();
  const isWideScreen = width >= 768;
  const [selectedReserveId, setSelectedReserveId] = useState<string | null>(null);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [batchAction, setBatchAction] = useState<'status' | 'company' | 'deadline' | null>(null);
  const [batchStatus, setBatchStatus] = useState<ReserveStatus>('in_progress');
  const [batchCompany, setBatchCompany] = useState('');
  const [batchDeadline, setBatchDeadline] = useState('');

  const chantierReserves = useMemo(() => {
    let list = chantierFilter === 'all' ? reserves : reserves.filter(r => r.chantierId === chantierFilter);
    if (isSousTraitant && sousTraitantCompanyName) {
      list = list.filter(r => r.company === sousTraitantCompanyName);
    }
    return list;
  }, [reserves, chantierFilter, isSousTraitant, sousTraitantCompanyName]);

  const nearDeadlineReserves = useMemo(() => {
    const now = new Date();
    const in3Days = new Date(now);
    in3Days.setDate(in3Days.getDate() + 3);
    return chantierReserves.filter(r => {
      if (r.status === 'closed') return false;
      const dl = parseDeadline(r.deadline);
      if (!dl) return false;
      return dl >= now && dl <= in3Days;
    });
  }, [chantierReserves]);

  function handleExportCSV() {
    const csv = buildReservesCSV(filtered);
    if (Platform.OS === 'web') {
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reserves_export_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      Share.share({
        title: 'Export réserves CSV',
        message: csv,
      }).catch(() => {});
    }
  }

  const buildings = useMemo(() => {
    const b = new Set(chantierReserves.map(r => r.building));
    return Array.from(b).sort();
  }, [chantierReserves]);

  const zones = useMemo(() => {
    const z = new Set(chantierReserves.map(r => r.zone).filter(Boolean));
    return Array.from(z).sort();
  }, [chantierReserves]);

  const activeFilterCount = (buildingFilter !== 'all' ? 1 : 0)
    + (priorityFilter !== 'all' ? 1 : 0)
    + (companyFilter !== 'all' ? 1 : 0)
    + (zoneFilter !== 'all' ? 1 : 0)
    + (kindFilter !== 'all' ? 1 : 0)
    + (lotFilter !== 'all' ? 1 : 0);

  const overdueCount = useMemo(
    () => chantierReserves.filter(r => isOverdue(r.deadline, r.status)).length,
    [chantierReserves]
  );

  const filtered = useMemo(() => {
    let list = chantierReserves.filter(r => {
      const matchStatus =
        statusFilter === 'all' ? true :
        statusFilter === 'overdue' ? isOverdue(r.deadline, r.status) :
        r.status === statusFilter;
      const matchKind =
        kindFilter === 'all' ? true :
        kindFilter === 'observation' ? r.kind === 'observation' :
        (!r.kind || r.kind === 'reserve');
      const matchBuilding = buildingFilter === 'all' || r.building === buildingFilter;
      const matchPriority = priorityFilter === 'all' || r.priority === priorityFilter;
      const matchCompany = companyFilter === 'all' || r.company === companyFilter;
      const matchZone = zoneFilter === 'all' || r.zone === zoneFilter;
      const matchLot = lotFilter === 'all' || r.lotId === lotFilter;
      const q = search.toLowerCase();
      const matchSearch = !q ||
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.company.toLowerCase().includes(q) ||
        r.building.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.zone.toLowerCase().includes(q) ||
        r.level.toLowerCase().includes(q);
      return matchStatus && matchKind && matchBuilding && matchPriority && matchCompany && matchZone && matchLot && matchSearch;
    });

    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'date_desc': return b.createdAt.localeCompare(a.createdAt);
        case 'date_asc': return a.createdAt.localeCompare(b.createdAt);
        case 'priority': return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        case 'deadline': return toSortableDate(a.deadline).localeCompare(toSortableDate(b.deadline));
        case 'status': return STATUS_ORDER_MAP[a.status] - STATUS_ORDER_MAP[b.status];
        default: return 0;
      }
    });
    return list;
  }, [chantierReserves, statusFilter, kindFilter, buildingFilter, priorityFilter, companyFilter, zoneFilter, lotFilter, sortKey, search]);

  const isSortActive = sortKey !== 'date_desc';
  const obsCount = useMemo(() => chantierReserves.filter(r => r.kind === 'observation').length, [chantierReserves]);
  const selectedReserve = useMemo(
    () => filtered.find(r => r.id === selectedReserveId) ?? null,
    [filtered, selectedReserveId]
  );

  const toggleSelectMode = useCallback(() => {
    setIsSelectMode(prev => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const toggleId = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filtered.map(r => r.id)));
  }, [filtered]);

  const applyBatch = useCallback(() => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const updates: Partial<{ status: ReserveStatus; company: string; deadline: string }> = {};
    if (batchAction === 'status') updates.status = batchStatus;
    if (batchAction === 'company' && batchCompany) updates.company = batchCompany;
    if (batchAction === 'deadline' && batchDeadline) updates.deadline = batchDeadline;
    if (Object.keys(updates).length === 0) return;
    batchUpdateReserves(ids, updates, user?.name);
    setBatchModalVisible(false);
    setBatchAction(null);
    setIsSelectMode(false);
    setSelectedIds(new Set());
    Alert.alert('Mise à jour effectuée', `${ids.length} réserve${ids.length > 1 ? 's' : ''} mise${ids.length > 1 ? 's' : ''} à jour.`);
  }, [selectedIds, batchAction, batchStatus, batchCompany, batchDeadline, batchUpdateReserves, user]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Réserves</Text>
            <Text style={styles.subtitle}>
              {isLoading ? 'Chargement…' : isSelectMode
                ? `${selectedIds.size} sélectionnée${selectedIds.size !== 1 ? 's' : ''} sur ${filtered.length}`
                : `${filtered.length} / ${chantierReserves.length} réserve${chantierReserves.length !== 1 ? 's' : ''}${overdueCount > 0 ? ` · ${overdueCount} en retard` : ''}`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {permissions.canExport && filtered.length > 0 && !isSelectMode && (
              <TouchableOpacity style={styles.selectBtn} onPress={handleExportCSV}>
                <Ionicons name="download-outline" size={15} color={C.textSub} />
                <Text style={styles.selectBtnText}>CSV</Text>
              </TouchableOpacity>
            )}
            {permissions.canEdit && filtered.length > 0 && (
              <TouchableOpacity
                style={[styles.selectBtn, isSelectMode && styles.selectBtnActive]}
                onPress={toggleSelectMode}
              >
                <Ionicons
                  name={isSelectMode ? 'close-circle' : 'checkmark-circle-outline'}
                  size={15}
                  color={isSelectMode ? C.open : C.textSub}
                />
                <Text style={[styles.selectBtnText, isSelectMode && styles.selectBtnTextActive]}>
                  {isSelectMode ? 'Annuler' : 'Sélection'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {isSelectMode && (
          <View style={styles.selectBar}>
            <TouchableOpacity style={styles.selectBarBtn} onPress={selectAll}>
              <Ionicons name="checkmark-done-outline" size={15} color={C.primary} />
              <Text style={styles.selectBarBtnText}>Tout sélect.</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.selectBarBtn} onPress={() => setSelectedIds(new Set())}>
              <Ionicons name="close-outline" size={15} color={C.textSub} />
              <Text style={styles.selectBarBtnText}>Désélect.</Text>
            </TouchableOpacity>
          </View>
        )}

        {isSousTraitant && sousTraitantCompanyName && (
          <View style={styles.stBanner}>
            <Ionicons name="shield-checkmark-outline" size={13} color={C.primary} />
            <Text style={styles.stBannerText}>
              Vue filtrée — uniquement vos réserves : <Text style={{ fontFamily: 'Inter_700Bold' }}>{sousTraitantCompanyName}</Text>
            </Text>
          </View>
        )}

        {nearDeadlineReserves.length > 0 && (
          <TouchableOpacity
            style={styles.deadlineReminderBanner}
            onPress={() => setStatusFilter('all')}
            activeOpacity={0.85}
          >
            <Ionicons name="alarm-outline" size={14} color="#D97706" />
            <Text style={styles.deadlineReminderText}>
              <Text style={{ fontFamily: 'Inter_700Bold' }}>{nearDeadlineReserves.length} réserve{nearDeadlineReserves.length > 1 ? 's' : ''}</Text>
              {' '}expire{nearDeadlineReserves.length > 1 ? 'nt' : ''} dans moins de 3 jours — action requise
            </Text>
            <Ionicons name="chevron-forward" size={13} color="#D97706" />
          </TouchableOpacity>
        )}

        {chantiers.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chantierBar}>
            <TouchableOpacity
              style={[styles.chantierChip, chantierFilter === 'all' && styles.chantierChipActive]}
              onPress={() => setChantierFilter('all')}
            >
              <Ionicons name="layers-outline" size={11} color={chantierFilter === 'all' ? '#fff' : C.textSub} />
              <Text style={[styles.chantierChipText, chantierFilter === 'all' && styles.chantierChipTextActive]}>
                Tous les chantiers
              </Text>
            </TouchableOpacity>
            {chantiers.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chantierChip, chantierFilter === c.id && styles.chantierChipActive]}
                onPress={() => setChantierFilter(c.id)}
              >
                <View style={styles.chantierDot} />
                <Text style={[styles.chantierChipText, chantierFilter === c.id && styles.chantierChipTextActive]} numberOfLines={1}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Titre, bâtiment, zone, entreprise..."
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.toolRow}>
          <View style={styles.filterScrollContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            {STATUS_FILTERS.map(f => {
              const isActive = statusFilter === f.key;
              const isOverdueChip = f.key === 'overdue';
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[
                    styles.filterChip,
                    isActive && (isOverdueChip ? styles.filterChipOverdue : styles.filterChipActive),
                  ]}
                  onPress={() => setStatusFilter(f.key)}
                >
                  <Text style={[
                    styles.filterText,
                    isActive && (isOverdueChip ? styles.filterTextOverdue : styles.filterTextActive),
                  ]}>
                    {f.label}
                    {isOverdueChip && overdueCount > 0 ? ` (${overdueCount})` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <View style={styles.kindSep} />
            <TouchableOpacity
              style={[styles.filterChip, kindFilter === 'all' && styles.filterChipActive]}
              onPress={() => setKindFilter('all')}
            >
              <Text style={[styles.filterText, kindFilter === 'all' && styles.filterTextActive]}>Tous types</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, kindFilter === 'reserve' && styles.filterChipKindReserve]}
              onPress={() => setKindFilter('reserve')}
            >
              <Ionicons name="warning-outline" size={11} color={kindFilter === 'reserve' ? '#EF4444' : C.textSub} />
              <Text style={[styles.filterText, kindFilter === 'reserve' && { color: '#EF4444' }]}>Réserves</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, kindFilter === 'observation' && styles.filterChipKindObs]}
              onPress={() => setKindFilter('observation')}
            >
              <Ionicons name="eye-outline" size={11} color={kindFilter === 'observation' ? '#0EA5E9' : C.textSub} />
              <Text style={[styles.filterText, kindFilter === 'observation' && { color: '#0EA5E9' }]}>
                Observations{obsCount > 0 ? ` (${obsCount})` : ''}
              </Text>
            </TouchableOpacity>
          </ScrollView>
          <View style={styles.filterScrollFade} pointerEvents="none" />
          </View>

          <TouchableOpacity
            style={[styles.toolBtn, activeFilterCount > 0 && styles.toolBtnActive]}
            onPress={() => setFilterModalVisible(true)}
          >
            <Ionicons name="options-outline" size={15} color={activeFilterCount > 0 ? C.primary : C.textSub} />
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolBtn, isSortActive && styles.toolBtnActive]}
            onPress={() => setSortModalVisible(true)}
          >
            <Ionicons name="swap-vertical-outline" size={15} color={isSortActive ? C.primary : C.textSub} />
          </TouchableOpacity>
        </View>
      </View>

      {isWideScreen ? (
        <View style={styles.splitRow}>
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <View style={styles.selectableRow}>
                {isSelectMode && (
                  <TouchableOpacity
                    onPress={() => toggleId(item.id)}
                    style={[styles.checkbox, selectedIds.has(item.id) && styles.checkboxChecked]}
                  >
                    {selectedIds.has(item.id) && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </TouchableOpacity>
                )}
                <View style={{ flex: 1 }}>
                  <ReserveCard
                    reserve={item}
                    onPress={r => isSelectMode ? toggleId(r.id) : setSelectedReserveId(r.id === selectedReserveId ? null : r.id)}
                    selected={item.id === selectedReserveId}
                  />
                </View>
              </View>
            )}
            contentContainerStyle={styles.listNarrow}
            showsVerticalScrollIndicator={false}
            style={styles.splitList}
            ListEmptyComponent={() => (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  {chantierReserves.length === 0
                    ? <Ionicons name="document-text-outline" size={40} color={C.primary} />
                    : <Ionicons name="funnel-outline" size={40} color={C.primary} />}
                </View>
                <Text style={styles.emptyText}>
                  {chantierReserves.length === 0 ? 'Aucune réserve' : 'Aucun résultat'}
                </Text>
                <Text style={styles.emptyHint}>
                  {chantierReserves.length === 0
                    ? 'Créez la première réserve avec le bouton +'
                    : 'Modifiez vos filtres ou votre recherche'}
                </Text>
              </View>
            )}
          />
          <View style={styles.splitDetail}>
            {selectedReserve ? (
              <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
                <View style={styles.detailHeader}>
                  <View style={styles.detailIdRow}>
                    <View style={styles.detailIdWrap}><Text style={styles.detailId}>{selectedReserve.id}</Text></View>
                    {selectedReserve.kind === 'observation' && (
                      <View style={styles.detailObsBadge}><Ionicons name="eye-outline" size={11} color="#0EA5E9" /><Text style={styles.detailObsText}>Observation</Text></View>
                    )}
                  </View>
                  <Text style={styles.detailTitle}>{selectedReserve.title}</Text>
                  <View style={styles.detailBadgeRow}>
                    {(() => {
                      const PRIORITY_COLORS: Record<string, string> = { critical: '#EF4444', high: '#F97316', medium: '#F59E0B', low: '#22C55E' };
                      const PRIORITY_LABELS: Record<string, string> = { critical: 'Critique', high: 'Haute', medium: 'Moyenne', low: 'Basse' };
                      const pc = PRIORITY_COLORS[selectedReserve.priority] ?? '#6B7280';
                      return (
                        <View style={[styles.detailPriorityBadge, { backgroundColor: pc + '20', borderColor: pc }]}>
                          <Text style={[styles.detailPriorityText, { color: pc }]}>{PRIORITY_LABELS[selectedReserve.priority] ?? selectedReserve.priority}</Text>
                        </View>
                      );
                    })()}
                  </View>
                </View>

                {selectedReserve.photoUri ? (
                  <Image source={{ uri: selectedReserve.photoUri }} style={styles.detailPhoto} resizeMode="cover" />
                ) : null}

                <View style={styles.detailCard}>
                  <Text style={styles.detailLabel}>DESCRIPTION</Text>
                  <Text style={styles.detailText}>{selectedReserve.description}</Text>
                </View>

                <View style={styles.detailCard}>
                  <View style={styles.detailRow}>
                    <Ionicons name="business-outline" size={14} color={C.textMuted} />
                    <Text style={styles.detailMeta}>Bât. {selectedReserve.building} — {selectedReserve.zone} — {selectedReserve.level}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Ionicons name="people-outline" size={14} color={C.textMuted} />
                    <Text style={styles.detailMeta}>{selectedReserve.company}</Text>
                  </View>
                  {selectedReserve.deadline && selectedReserve.deadline !== '—' && (
                    <View style={styles.detailRow}>
                      <Ionicons name="calendar-outline" size={14} color={C.textMuted} />
                      <Text style={styles.detailMeta}>Échéance : {selectedReserve.deadline}</Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Ionicons name="time-outline" size={14} color={C.textMuted} />
                    <Text style={styles.detailMeta}>Créée le {selectedReserve.createdAt}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.detailOpenBtn}
                  onPress={() => router.push(`/reserve/${selectedReserve.id}` as any)}
                >
                  <Text style={styles.detailOpenText}>Ouvrir la fiche complète</Text>
                  <Ionicons name="arrow-forward" size={15} color={C.primary} />
                </TouchableOpacity>
              </ScrollView>
            ) : (
              <View style={styles.detailEmpty}>
                <Ionicons name="hand-left-outline" size={36} color={C.textMuted} />
                <Text style={styles.detailEmptyText}>Sélectionnez une réserve</Text>
                <Text style={styles.detailEmptyHint}>Cliquez sur une réserve dans la liste pour voir ses détails ici</Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <View style={styles.selectableRow}>
              {isSelectMode && (
                <TouchableOpacity
                  onPress={() => toggleId(item.id)}
                  style={[styles.checkbox, selectedIds.has(item.id) && styles.checkboxChecked]}
                >
                  {selectedIds.has(item.id) && <Ionicons name="checkmark" size={14} color="#fff" />}
                </TouchableOpacity>
              )}
              <View style={{ flex: 1 }}>
                <ReserveCard
                  reserve={item}
                  onPress={r => isSelectMode ? toggleId(r.id) : router.push(`/reserve/${r.id}` as any)}
                />
              </View>
            </View>
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                {chantierReserves.length === 0
                  ? <Ionicons name="document-text-outline" size={40} color={C.primary} />
                  : <Ionicons name="funnel-outline" size={40} color={C.primary} />}
              </View>
              <Text style={styles.emptyText}>
                {chantierReserves.length === 0 ? 'Aucune réserve' : 'Aucun résultat'}
              </Text>
              <Text style={styles.emptyHint}>
                {chantierReserves.length === 0
                  ? 'Créez la première réserve avec le bouton +'
                  : 'Modifiez vos filtres ou votre recherche'}
              </Text>
            </View>
          )}
        />
      )}

      {isSelectMode && selectedIds.size > 0 && (
        <View style={styles.batchBar}>
          <Text style={styles.batchBarCount}>{selectedIds.size} sélectionnée{selectedIds.size > 1 ? 's' : ''}</Text>
          <TouchableOpacity
            style={styles.batchBarBtn}
            onPress={() => { setBatchAction('status'); setBatchModalVisible(true); }}
          >
            <Ionicons name="swap-horizontal-outline" size={16} color="#fff" />
            <Text style={styles.batchBarBtnText}>Statut</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.batchBarBtn}
            onPress={() => { setBatchAction('company'); setBatchModalVisible(true); }}
          >
            <Ionicons name="people-outline" size={16} color="#fff" />
            <Text style={styles.batchBarBtnText}>Entreprise</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.batchBarBtn}
            onPress={() => { setBatchAction('deadline'); setBatchModalVisible(true); }}
          >
            <Ionicons name="calendar-outline" size={16} color="#fff" />
            <Text style={styles.batchBarBtnText}>Échéance</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isSelectMode && permissions.canCreate && (
        <TouchableOpacity
          style={[styles.fab, { bottom: Platform.OS === 'web' ? 100 : insets.bottom + 61 }]}
          onPress={() => router.push('/reserve/new' as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      )}

      <Modal visible={batchModalVisible} transparent animationType="slide" onRequestClose={() => setBatchModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setBatchModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.bottomSheet, { paddingBottom: insets.bottom + 32 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>
                {batchAction === 'status' ? 'Changer le statut' : batchAction === 'company' ? 'Assigner une entreprise' : 'Modifier l\'échéance'}
              </Text>
            </View>
            <Text style={styles.batchDesc}>
              Modification de {selectedIds.size} réserve{selectedIds.size > 1 ? 's' : ''} sélectionnée{selectedIds.size > 1 ? 's' : ''}
            </Text>

            {batchAction === 'status' && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {(Object.entries(STATUS_LABELS) as [ReserveStatus, string][]).map(([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.sheetItem, batchStatus === key && styles.sheetItemActive]}
                    onPress={() => setBatchStatus(key)}
                  >
                    <Text style={[styles.sheetItemText, batchStatus === key && styles.sheetItemTextActive]}>{label}</Text>
                    {batchStatus === key && <Ionicons name="checkmark" size={16} color={C.primary} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {batchAction === 'company' && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {companies.map(co => (
                  <TouchableOpacity
                    key={co.id}
                    style={[styles.sheetItem, batchCompany === co.name && styles.sheetItemActive]}
                    onPress={() => setBatchCompany(co.name)}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={[styles.coDot, { backgroundColor: co.color }]} />
                      <Text style={[styles.sheetItemText, batchCompany === co.name && styles.sheetItemTextActive]}>{co.name}</Text>
                    </View>
                    {batchCompany === co.name && <Ionicons name="checkmark" size={16} color={C.primary} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {batchAction === 'deadline' && (
              <View style={{ paddingVertical: 12 }}>
                <Text style={styles.batchInputLabel}>Nouvelle date d'échéance (JJ/MM/AAAA)</Text>
                <TextInput
                  style={styles.batchInput}
                  placeholder="ex: 31/12/2025"
                  placeholderTextColor={C.textMuted}
                  value={batchDeadline}
                  onChangeText={setBatchDeadline}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            )}

            <TouchableOpacity style={styles.applyBtn} onPress={applyBatch}>
              <Text style={styles.applyBtnText}>Appliquer à {selectedIds.size} réserve{selectedIds.size > 1 ? 's' : ''}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setBatchModalVisible(false)}>
              <Text style={styles.cancelText}>Annuler</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={sortModalVisible} transparent animationType="slide" onRequestClose={() => setSortModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSortModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.bottomSheet, { paddingBottom: insets.bottom + 32 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>Trier par</Text>
              {isSortActive && (
                <TouchableOpacity onPress={() => { setSortKey('date_desc'); setSortModalVisible(false); }}>
                  <Text style={styles.resetText}>Réinitialiser</Text>
                </TouchableOpacity>
              )}
            </View>
            {SORT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={styles.sheetItem}
                onPress={() => { setSortKey(opt.key); setSortModalVisible(false); }}
              >
                <Text style={[styles.sheetItemText, sortKey === opt.key && styles.sheetItemTextActive]}>
                  {opt.label}
                </Text>
                {sortKey === opt.key && <Ionicons name="checkmark" size={16} color={C.primary} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setSortModalVisible(false)}>
              <Text style={styles.cancelText}>Fermer</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={filterModalVisible} transparent animationType="slide" onRequestClose={() => setFilterModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFilterModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.bottomSheet, { paddingBottom: insets.bottom + 32 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>Filtres avancés</Text>
              {activeFilterCount > 0 && (
                <TouchableOpacity onPress={() => { setBuildingFilter('all'); setPriorityFilter('all'); setCompanyFilter('all'); setZoneFilter('all'); setKindFilter('all'); setLotFilter('all'); }}>
                  <Text style={styles.resetText}>Réinitialiser</Text>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetSectionLabel}>BÂTIMENT</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                <View style={styles.chipRowInline}>
                  {['all', ...buildings].map(b => (
                    <TouchableOpacity
                      key={b}
                      style={[styles.chip, buildingFilter === b && styles.chipActive]}
                      onPress={() => setBuildingFilter(b)}
                    >
                      <Text style={[styles.chipText, buildingFilter === b && styles.chipTextActive]}>
                        {b === 'all' ? 'Tous' : `Bât. ${b}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.sheetSectionLabel}>PRIORITÉ</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                <View style={styles.chipRowInline}>
                  {([
                    { key: 'all', label: 'Toutes', color: C.textSub },
                    { key: 'critical', label: 'Critique', color: C.critical },
                    { key: 'high', label: 'Haute', color: C.high },
                    { key: 'medium', label: 'Moyenne', color: C.medium },
                    { key: 'low', label: 'Basse', color: C.low },
                  ] as const).map(p => (
                    <TouchableOpacity
                      key={p.key}
                      style={[styles.chip, priorityFilter === p.key && { backgroundColor: p.color + '20', borderColor: p.color }]}
                      onPress={() => setPriorityFilter(p.key as 'all' | ReservePriority)}
                    >
                      <Text style={[styles.chipText, priorityFilter === p.key && { color: p.color }]}>{p.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.sheetSectionLabel}>ZONE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                <View style={styles.chipRowInline}>
                  {['all', ...zones].map(z => (
                    <TouchableOpacity
                      key={z}
                      style={[styles.chip, zoneFilter === z && styles.chipActive]}
                      onPress={() => setZoneFilter(z)}
                    >
                      <Text style={[styles.chipText, zoneFilter === z && styles.chipTextActive]}>
                        {z === 'all' ? 'Toutes' : z}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.sheetSectionLabel}>ENTREPRISE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                <View style={styles.chipRowInline}>
                  <TouchableOpacity
                    style={[styles.chip, companyFilter === 'all' && styles.chipActive]}
                    onPress={() => setCompanyFilter('all')}
                  >
                    <Text style={[styles.chipText, companyFilter === 'all' && styles.chipTextActive]}>Toutes</Text>
                  </TouchableOpacity>
                  {companies.map(co => (
                    <TouchableOpacity
                      key={co.id}
                      style={[styles.chip, companyFilter === co.name && { backgroundColor: co.color + '20', borderColor: co.color }]}
                      onPress={() => setCompanyFilter(co.name)}
                    >
                      <View style={[styles.dot, { backgroundColor: co.color }]} />
                      <Text style={[styles.chipText, companyFilter === co.name && { color: co.color }]}>{co.shortName}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {lots.length > 0 && (
                <>
                  <Text style={styles.sheetSectionLabel}>CORPS D'ÉTAT (LOT)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                    <View style={styles.chipRowInline}>
                      <TouchableOpacity
                        style={[styles.chip, lotFilter === 'all' && styles.chipActive]}
                        onPress={() => setLotFilter('all')}
                      >
                        <Text style={[styles.chipText, lotFilter === 'all' && styles.chipTextActive]}>Tous</Text>
                      </TouchableOpacity>
                      {lots.map(lot => (
                        <TouchableOpacity
                          key={lot.id}
                          style={[styles.chip, lotFilter === lot.id && { backgroundColor: (lot.color ?? C.primary) + '20', borderColor: lot.color ?? C.primary }]}
                          onPress={() => setLotFilter(lot.id)}
                        >
                          {lot.color && <View style={[styles.dot, { backgroundColor: lot.color }]} />}
                          <Text style={[styles.chipText, lotFilter === lot.id && { color: lot.color ?? C.primary }]} numberOfLines={1}>
                            {lot.number ? `${lot.number}. ` : ''}{lot.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </>
              )}

              <TouchableOpacity style={styles.applyBtn} onPress={() => setFilterModalVisible(false)}>
                <Text style={styles.applyBtnText}>Appliquer</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  selectBtnActive: { backgroundColor: C.open + '15', borderColor: C.open },
  selectBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  selectBtnTextActive: { color: C.open },
  selectBar: {
    flexDirection: 'row', gap: 10, marginBottom: 8,
  },
  selectBarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primaryBg, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: C.primary + '40',
  },
  selectBarBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 10, marginBottom: 10, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  filterScrollContainer: { flex: 1, position: 'relative' },
  filterScrollFade: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 32,
    backgroundColor: C.surface,
    opacity: 0.88,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
  },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surface2, marginRight: 8, borderWidth: 1, borderColor: C.border,
  },
  filterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterChipOverdue: { backgroundColor: C.open, borderColor: C.open },
  filterChipKindReserve: { backgroundColor: '#EF444415', borderColor: '#EF4444' },
  filterChipKindObs: { backgroundColor: '#0EA5E915', borderColor: '#0EA5E9' },
  filterText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  filterTextActive: { color: '#fff' },
  filterTextOverdue: { color: '#fff' },
  kindSep: { width: 1, height: 20, backgroundColor: C.border, marginHorizontal: 6, alignSelf: 'center' },
  toolBtn: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border,
  },
  toolBtnActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  filterBadge: {
    position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: 7,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  filterBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  chantierBar: { marginBottom: 10 },
  stBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 10, borderWidth: 1, borderColor: C.primary + '30',
  },
  stBannerText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.text, flex: 1 },
  chantierChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.surface2, marginRight: 8, borderWidth: 1.5, borderColor: C.border,
  },
  chantierChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chantierChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  chantierChipTextActive: { color: '#fff' },
  chantierDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.closed },
  selectableRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12 },
  checkbox: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.border,
    backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', marginRight: 8,
  },
  checkboxChecked: { backgroundColor: C.primary, borderColor: C.primary },
  list: { padding: 16, paddingBottom: 120 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
  batchBar: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 80 : 0,
    left: 0, right: 0,
    backgroundColor: C.primary,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 14,
    ...Platform.select({
      web: { boxShadow: '0px -4px 16px rgba(0,48,130,0.25)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 10 },
    }),
  },
  batchBarCount: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff', flex: 1 },
  batchBarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.20)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  batchBarBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  batchDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 14, fontStyle: 'italic' },
  batchInputLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 8 },
  batchInput: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border,
  },
  coDot: { width: 10, height: 10, borderRadius: 5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  bottomSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12, maxHeight: '80%',
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  resetText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.open },
  sheetItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  sheetItemActive: { backgroundColor: C.primaryBg, borderRadius: 10, paddingHorizontal: 10, marginHorizontal: -10 },
  sheetItemText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text },
  sheetItemTextActive: { fontFamily: 'Inter_600SemiBold', color: C.primary },
  cancelBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 14, backgroundColor: C.surface2, borderRadius: 12 },
  cancelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  sheetSectionLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 8,
  },
  chipScroll: { marginBottom: 4 },
  chipRowInline: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
    borderColor: C.border, backgroundColor: C.surface2, flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  chipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  chipTextActive: { color: C.primary },
  dot: { width: 7, height: 7, borderRadius: 4 },
  applyBtn: { marginTop: 20, marginBottom: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  applyBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0px 4px 16px rgba(0,48,130,0.30)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.30, shadowRadius: 10, elevation: 8 },
    }),
  },

  splitRow: { flex: 1, flexDirection: 'row' },
  splitList: { width: '42%', minWidth: 280, maxWidth: 420, borderRightWidth: 1, borderRightColor: C.border },
  listNarrow: { padding: 10, paddingBottom: 100 },
  splitDetail: { flex: 1, backgroundColor: C.bg },
  detailContent: { padding: 20, paddingBottom: 48, maxWidth: 600, alignSelf: 'center', width: '100%' },
  detailHeader: { marginBottom: 16 },
  detailIdRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  detailIdWrap: { backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  detailId: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary, letterSpacing: 0.5 },
  detailObsBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0EA5E915', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: '#0EA5E930' },
  detailObsText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#0EA5E9' },
  detailTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, lineHeight: 26, marginBottom: 10 },
  detailBadgeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  detailPriorityBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5 },
  detailPriorityText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  detailPhoto: { width: '100%', height: 180, borderRadius: 12, marginBottom: 14 },
  detailCard: { backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: C.border, gap: 8 },
  detailLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  detailText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 21 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailMeta: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  detailOpenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 12, paddingVertical: 14,
    borderWidth: 1.5, borderColor: C.primary, marginTop: 4,
  },
  detailOpenText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  detailEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  detailEmptyText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  detailEmptyHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', lineHeight: 19 },
});
