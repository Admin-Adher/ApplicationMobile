import {
  View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity,
  Alert, Modal, TextInput, Linking, TextInput as RNTextInput,
} from 'react-native';
import { useState, useMemo, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { Company, AttendanceRecord } from '@/constants/types';
import { useRouter } from 'expo-router';

type SortKey = 'name' | 'presence' | 'reserves';

const SORT_OPTIONS: { key: SortKey; label: string; icon: string }[] = [
  { key: 'name',     label: 'Nom A–Z',    icon: 'text-outline' },
  { key: 'presence', label: 'Présence %', icon: 'people-outline' },
  { key: 'reserves', label: 'Réserves',   icon: 'warning-outline' },
];

function MiniHistoryChart({ records, companyId, color }: {
  records: AttendanceRecord[];
  companyId: string;
  color: string;
}) {
  const last7 = useMemo(() => {
    const days: { label: string; workers: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString('fr-FR', { weekday: 'short' });
      const dateStr = d.toLocaleDateString('fr-FR');
      const rec = records.find(r => r.companyId === companyId && r.date === dateStr);
      days.push({ label, workers: rec?.workers ?? 0 });
    }
    return days;
  }, [records, companyId]);

  const maxVal = Math.max(...last7.map(d => d.workers), 1);

  return (
    <View style={hStyles.chart}>
      {last7.map((d, i) => (
        <View key={i} style={hStyles.barCol}>
          <View style={hStyles.barBg}>
            <View style={[
              hStyles.barFill,
              { height: `${Math.max(4, (d.workers / maxVal) * 100)}%` as any, backgroundColor: color },
            ]} />
          </View>
          <Text style={hStyles.barLabel}>{d.label.charAt(0).toUpperCase()}</Text>
          {d.workers > 0 && <Text style={[hStyles.barVal, { color }]}>{d.workers}</Text>}
        </View>
      ))}
    </View>
  );
}

const hStyles = StyleSheet.create({
  chart: { flexDirection: 'row', gap: 4, alignItems: 'flex-end', height: 54, marginTop: 8 },
  barCol: { flex: 1, alignItems: 'center', gap: 3 },
  barBg: { flex: 1, width: '100%', backgroundColor: C.surface2, borderRadius: 3, overflow: 'hidden', justifyContent: 'flex-end' },
  barFill: { width: '100%', borderRadius: 3 },
  barLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.textMuted },
  barVal: { fontSize: 9, fontFamily: 'Inter_700Bold' },
});

function GlobalHistoryChart({ records, companies }: {
  records: AttendanceRecord[];
  companies: Company[];
}) {
  const last7 = useMemo(() => {
    const days: { label: string; fullDate: string; total: number; byCompany: Record<string, number> }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('fr-FR');
      const label = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
      const dayRecs = records.filter(r => r.date === dateStr);
      const byCompany: Record<string, number> = {};
      let total = 0;
      for (const r of dayRecs) {
        byCompany[r.companyId] = r.workers;
        total += r.workers;
      }
      days.push({ label, fullDate: dateStr, total, byCompany });
    }
    return days;
  }, [records]);

  const maxVal = Math.max(...last7.map(d => d.total), 1);
  const hasAnyData = last7.some(d => d.total > 0);

  if (!hasAnyData) {
    return (
      <View style={ghStyles.empty}>
        <Ionicons name="bar-chart-outline" size={28} color={C.textMuted} />
        <Text style={ghStyles.emptyText}>Aucune donnée — sauvegardez les présences pour alimenter l'historique</Text>
      </View>
    );
  }

  return (
    <View style={ghStyles.wrap}>
      <View style={ghStyles.chart}>
        {last7.map((d, i) => (
          <View key={i} style={ghStyles.dayCol}>
            <View style={ghStyles.stackWrap}>
              {companies.map(co => {
                const val = d.byCompany[co.id] ?? 0;
                if (val === 0) return null;
                return (
                  <View
                    key={co.id}
                    style={[
                      ghStyles.stackSegment,
                      {
                        height: Math.max(3, (val / maxVal) * 72),
                        backgroundColor: co.color,
                      },
                    ]}
                  />
                );
              })}
            </View>
            {d.total > 0 && (
              <Text style={ghStyles.totalVal}>{d.total}</Text>
            )}
            <Text style={ghStyles.dayLabel}>{d.label.split(' ')[0]}</Text>
            <Text style={ghStyles.dayNum}>{d.label.split(' ')[1]}</Text>
          </View>
        ))}
      </View>
      <View style={ghStyles.legend}>
        {companies.filter(co => last7.some(d => (d.byCompany[co.id] ?? 0) > 0)).map(co => (
          <View key={co.id} style={ghStyles.legendItem}>
            <View style={[ghStyles.legendDot, { backgroundColor: co.color }]} />
            <Text style={ghStyles.legendText}>{co.shortName || co.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const ghStyles = StyleSheet.create({
  wrap: { gap: 12 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 88 },
  dayCol: { flex: 1, alignItems: 'center', gap: 2 },
  stackWrap: { flex: 1, width: '100%', justifyContent: 'flex-end', gap: 1 },
  stackSegment: { width: '100%', borderRadius: 2 },
  totalVal: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.textSub },
  dayLabel: { fontSize: 9, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  dayNum: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.textMuted },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  emptyText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', lineHeight: 17 },
});

export default function EquipesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, permissions } = useAuth();
  const {
    companies, tasks, reserves, stats, chantiers, activeChantierId,
    updateCompanyWorkers, updateCompanyHours,
  } = useApp();
  const { saveAttendanceSnapshot, attendanceHistory, standardDayHours } = useSettings();
  const topPad = insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const [workerModal, setWorkerModal] = useState<{ id: string; name: string; current: number } | null>(null);
  const [workerInput, setWorkerInput] = useState('');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const searchRef = useRef<RNTextInput>(null);

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  const totalHours = useMemo(() => companies.reduce((s, c) => s + c.hoursWorked, 0), [companies]);

  const companyStats = useMemo(() => {
    const map: Record<string, { openReserves: number; activeTasks: number }> = {};
    for (const co of companies) {
      map[co.id] = {
        openReserves: reserves.filter(r => {
          const names = r.companies ?? (r.company ? [r.company] : []);
          return names.includes(co.name) && r.status !== 'closed';
        }).length,
        activeTasks: tasks.filter(t =>
          (t.company === co.id || t.company === co.name) &&
          (t.status === 'in_progress' || t.status === 'delayed')
        ).length,
      };
    }
    return map;
  }, [companies, reserves, tasks]);

  const filteredSortedCompanies = useMemo(() => {
    let list = [...companies];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(co =>
        co.name.toLowerCase().includes(q) ||
        co.shortName?.toLowerCase().includes(q) ||
        co.zone?.toLowerCase().includes(q) ||
        (co.lots ?? []).some(l => l.toLowerCase().includes(q))
      );
    }
    if (sortKey === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    } else if (sortKey === 'presence') {
      list.sort((a, b) => {
        const pa = a.plannedWorkers > 0 ? a.actualWorkers / a.plannedWorkers : 0;
        const pb = b.plannedWorkers > 0 ? b.actualWorkers / b.plannedWorkers : 0;
        return pb - pa;
      });
    } else if (sortKey === 'reserves') {
      list.sort((a, b) => (companyStats[b.id]?.openReserves ?? 0) - (companyStats[a.id]?.openReserves ?? 0));
    }
    return list;
  }, [companies, search, sortKey, companyStats]);

  const presencePct = stats.plannedWorkers > 0
    ? Math.round((stats.totalWorkers / stats.plannedWorkers) * 100)
    : 0;

  const historyByCompany = useMemo(() => {
    const map: Record<string, AttendanceRecord[]> = {};
    for (const r of attendanceHistory) {
      if (!map[r.companyId]) map[r.companyId] = [];
      map[r.companyId].push(r);
    }
    return map;
  }, [attendanceHistory]);

  if (user && !permissions.canViewTeams) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, textAlign: 'center' }}>
          Accès restreint
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 8, textAlign: 'center' }}>
          Votre rôle ne donne pas accès à la gestion des équipes.
        </Text>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.navigate('/(tabs)/' as any)}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Retour au tableau de bord</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function openWorkerModal(co: Company) {
    setWorkerModal({ id: co.id, name: co.name, current: co.actualWorkers });
    setWorkerInput(String(co.actualWorkers));
  }

  function handleSaveWorkers() {
    if (!workerModal) return;
    const n = parseInt(workerInput, 10);
    if (isNaN(n) || n < 0) {
      Alert.alert('Valeur invalide', 'Le nombre de personnes présentes doit être un entier positif.');
      return;
    }
    const estimatedHours = n * standardDayHours;
    updateCompanyWorkers(workerModal.id, n);
    updateCompanyHours(workerModal.id, estimatedHours);
    setWorkerModal(null);
  }

  function stepWorker(delta: number) {
    const n = Math.max(0, (parseInt(workerInput, 10) || 0) + delta);
    setWorkerInput(String(n));
  }

  function toggleSearch() {
    setShowSearch(v => {
      if (!v) setTimeout(() => searchRef.current?.focus(), 80);
      else setSearch('');
      return !v;
    });
  }

  function handleSaveAttendance() {
    const total = companies.reduce((a, c) => a + c.actualWorkers, 0);
    Alert.alert(
      'Sauvegarder les présences',
      `Enregistrer les présences du jour (${total} personnes) dans l'historique ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Sauvegarder',
          onPress: async () => {
            await saveAttendanceSnapshot(companies, user?.name ?? 'Système');
            Alert.alert('Présences sauvegardées', "L'instantané a été enregistré dans l'historique.");
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Équipes</Text>
            <Text style={styles.subtitle}>{today}</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.headerIconBtn} onPress={toggleSearch} hitSlop={4}>
              <Ionicons name={showSearch ? 'close' : 'search-outline'} size={19} color={C.text} />
            </TouchableOpacity>
            {permissions.canManageTeams && (
              <TouchableOpacity
                style={styles.manageBtn}
                onPress={() => router.navigate('/(tabs)/admin' as any)}
              >
                <Ionicons name="settings-outline" size={14} color={C.primary} />
                <Text style={styles.manageBtnLabel}>Gérer</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Search bar */}
        {showSearch && (
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={15} color={C.textMuted} />
            <TextInput
              ref={searchRef}
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Rechercher une entreprise, lot…"
              placeholderTextColor={C.textMuted}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
        )}

        {/* Sort chips */}
        {companies.length > 1 && (
          <View style={styles.sortRow}>
            {SORT_OPTIONS.map(o => (
              <TouchableOpacity
                key={o.key}
                style={[styles.sortChip, sortKey === o.key && styles.sortChipActive]}
                onPress={() => setSortKey(o.key)}
              >
                <Ionicons name={o.icon as any} size={11} color={sortKey === o.key ? C.primary : C.textMuted} />
                <Text style={[styles.sortChipText, sortKey === o.key && styles.sortChipTextActive]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Empty state ── */}
        {companies.length === 0 && (
          <View style={styles.equipeEmptyWrap}>
            <View style={styles.equipeEmptyIconCircle}>
              <Ionicons name="people" size={38} color="#EC4899" />
            </View>
            <Text style={styles.equipeEmptyTitle}>Aucune entreprise enregistrée</Text>
            <Text style={styles.equipeEmptySubtitle}>
              Ajoutez les entreprises intervenantes dans l'Admin pour suivre les présences et les réserves de chantier.
            </Text>
            {permissions.canManageTeams && (
              <TouchableOpacity
                style={styles.equipeEmptyBtn}
                onPress={() => router.navigate('/(tabs)/admin' as any)}
              >
                <Ionicons name="settings-outline" size={18} color="#fff" />
                <Text style={styles.equipeEmptyBtnText}>Gérer les entreprises dans l'Admin</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Global summary ── */}
        {companies.length > 0 && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{stats.totalWorkers}</Text>
                <Text style={styles.summaryLabel}>Présents</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: C.textSub }]}>{stats.plannedWorkers}</Text>
                <Text style={styles.summaryLabel}>Prévus</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: stats.plannedWorkers - stats.totalWorkers > 0 ? C.waiting : C.closed }]}>
                  {stats.plannedWorkers - stats.totalWorkers > 0 ? `-${stats.plannedWorkers - stats.totalWorkers}` : '✓'}
                </Text>
                <Text style={styles.summaryLabel}>Écart</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: C.inProgress, fontSize: 22 }]}>{totalHours}h</Text>
                <Text style={styles.summaryLabel}>Heures tot.</Text>
              </View>
            </View>
            <View style={styles.summaryBarRow}>
              <View style={styles.summaryBarBg}>
                <View style={[styles.summaryBarFill, { width: `${Math.min(presencePct, 100)}%` as any }]} />
              </View>
              <Text style={styles.summaryBarPct}>{presencePct}%</Text>
            </View>
            {permissions.canUpdateAttendance && (
              <TouchableOpacity style={styles.saveSnapshotBtn} onPress={handleSaveAttendance}>
                <Ionicons name="save-outline" size={13} color={C.primary} />
                <Text style={styles.saveSnapshotText}>Sauvegarder les présences du jour</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Section label ── */}
        {filteredSortedCompanies.length > 0 && (
          <View style={styles.sectionLabelRow}>
            <Text style={styles.sectionTitle}>
              Intervenants{search ? ` · ${filteredSortedCompanies.length} résultat${filteredSortedCompanies.length > 1 ? 's' : ''}` : ` (${filteredSortedCompanies.length})`}
            </Text>
          </View>
        )}

        {/* ── No results ── */}
        {companies.length > 0 && filteredSortedCompanies.length === 0 && (
          <View style={styles.noResults}>
            <Ionicons name="search-outline" size={28} color={C.textMuted} />
            <Text style={styles.noResultsText}>Aucune entreprise ne correspond à "{search}"</Text>
          </View>
        )}

        {/* ── Company cards ── */}
        {filteredSortedCompanies.map(co => {
          const pct = co.plannedWorkers > 0 ? Math.round((co.actualWorkers / co.plannedWorkers) * 100) : 0;
          const ecart = co.plannedWorkers - co.actualWorkers;
          const cs = companyStats[co.id] ?? { openReserves: 0, activeTasks: 0 };
          const coHistory = historyByCompany[co.id] ?? [];
          const linkedChantiers = chantiers.filter(ch => ch.companyIds?.includes(co.id));

          return (
            <View key={co.id} style={styles.coCard}>
              {/* Top: color bar + name + badges */}
              <View style={styles.coTop}>
                <View style={[styles.coColorBar, { backgroundColor: co.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.coName}>{co.name}</Text>
                  {(co.zone || (co.lots && co.lots.length > 0)) && (
                    <Text style={styles.coZone}>
                      {co.zone}{co.lots && co.lots.length > 0 ? ` · ${co.lots.join(', ')}` : ''}
                    </Text>
                  )}
                </View>
                {permissions.canUpdateAttendance && (
                  <TouchableOpacity
                    style={[styles.pointageBtn, { borderColor: co.color + '60', backgroundColor: co.color + '12' }]}
                    onPress={() => openWorkerModal(co)}
                  >
                    <Ionicons name="pencil-outline" size={13} color={co.color} />
                    <Text style={[styles.pointageBtnText, { color: co.color }]}>Pointage</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Stats */}
              <View style={styles.coStats}>
                <View style={styles.coStat}>
                  <Text style={[styles.coStatVal, { color: co.color }]}>{co.actualWorkers}</Text>
                  <Text style={styles.coStatLabel}>Présents</Text>
                </View>
                <View style={styles.coStat}>
                  <Text style={styles.coStatVal}>{co.plannedWorkers}</Text>
                  <Text style={styles.coStatLabel}>Prévus</Text>
                </View>
                <View style={styles.coStat}>
                  <Text style={[styles.coStatVal, { color: ecart > 0 ? C.waiting : C.closed }]}>
                    {ecart > 0 ? `-${ecart}` : '✓'}
                  </Text>
                  <Text style={styles.coStatLabel}>Écart</Text>
                </View>
                <View style={styles.coStat}>
                  <Text style={styles.coStatVal}>{co.hoursWorked}h</Text>
                  <Text style={styles.coStatLabel}>Heures</Text>
                </View>
              </View>

              {/* Progress bar */}
              <View style={styles.coBarRow}>
                <View style={styles.coBarBg}>
                  <View style={[styles.coBarFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: co.color }]} />
                </View>
                <Text style={[styles.coBarPct, { color: co.color }]}>{pct}%</Text>
              </View>

              {/* Mini sparkline history */}
              {coHistory.length > 0 && (
                <MiniHistoryChart records={coHistory} companyId={co.id} color={co.color} />
              )}

              {/* ── Quick actions ── */}
              <View style={styles.quickActions}>
                <TouchableOpacity
                  style={[styles.qaBtn, cs.openReserves > 0 && styles.qaBtnAlert]}
                  onPress={() => router.navigate({ pathname: '/(tabs)/reserves', params: { company: co.name } } as any)}
                >
                  <Ionicons
                    name="warning-outline"
                    size={14}
                    color={cs.openReserves > 0 ? C.open : C.textMuted}
                  />
                  <Text style={[styles.qaBtnText, cs.openReserves > 0 && { color: C.open }]}>
                    {cs.openReserves > 0 ? `${cs.openReserves} réserve${cs.openReserves > 1 ? 's' : ''}` : 'Réserves'}
                  </Text>
                  <Ionicons name="chevron-forward" size={11} color={cs.openReserves > 0 ? C.open : C.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.qaBtn, cs.activeTasks > 0 && styles.qaBtnTask]}
                  onPress={() => router.push('/planning' as any)}
                >
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={14}
                    color={cs.activeTasks > 0 ? C.primary : C.textMuted}
                  />
                  <Text style={[styles.qaBtnText, cs.activeTasks > 0 && { color: C.primary }]}>
                    {cs.activeTasks > 0 ? `${cs.activeTasks} tâche${cs.activeTasks > 1 ? 's' : ''}` : 'Tâches'}
                  </Text>
                  <Ionicons name="chevron-forward" size={11} color={cs.activeTasks > 0 ? C.primary : C.textMuted} />
                </TouchableOpacity>

                {co.phone ? (
                  <TouchableOpacity
                    style={styles.qaBtnPhone}
                    onPress={() => Linking.openURL(`tel:${co.phone}`)}
                  >
                    <Ionicons name="call-outline" size={14} color={C.primary} />
                    <Text style={[styles.qaBtnText, { color: C.primary }]}>Appeler</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Contact + SIRET */}
              {(co.email || co.siret) && (
                <View style={styles.coFooter}>
                  {co.email ? (
                    <TouchableOpacity
                      style={styles.coContactItem}
                      onPress={() => Linking.openURL(`mailto:${co.email}`)}
                    >
                      <Ionicons name="mail-outline" size={12} color={C.textMuted} />
                      <Text style={styles.coContactText}>{co.email}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {co.siret ? (
                    <View style={styles.coContactItem}>
                      <Ionicons name="document-text-outline" size={12} color={C.textMuted} />
                      <Text style={styles.coContactText}>SIRET {co.siret}</Text>
                    </View>
                  ) : null}
                </View>
              )}

              {/* Linked chantiers */}
              {linkedChantiers.length > 0 && (
                <View style={styles.chantierPillsSection}>
                  <View style={styles.chantierPillsHeader}>
                    <Ionicons name="business-outline" size={11} color={C.textMuted} />
                    <Text style={styles.chantierPillsLabel}>Chantiers</Text>
                  </View>
                  <View style={styles.chantierPillsRow}>
                    {linkedChantiers.map(ch => (
                      <View key={ch.id} style={[
                        styles.chantierPill,
                        ch.id === activeChantierId && { borderColor: co.color + '80', backgroundColor: co.color + '12' },
                      ]}>
                        <Text style={[styles.chantierPillText, ch.id === activeChantierId && { color: co.color }]} numberOfLines={1}>
                          {ch.name}{ch.id === activeChantierId ? ' ●' : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {/* ── Historique 7 jours ── */}
        {companies.length > 0 && (
          <View style={styles.historyCard}>
            <TouchableOpacity style={styles.historyHeader} onPress={() => setHistoryExpanded(v => !v)}>
              <View style={styles.historyHeaderLeft}>
                <Ionicons name="bar-chart-outline" size={16} color={C.primary} />
                <Text style={styles.historyTitle}>Historique des présences</Text>
                {attendanceHistory.length > 0 && (
                  <View style={styles.historyCountBadge}>
                    <Text style={styles.historyCountText}>{attendanceHistory.length}</Text>
                  </View>
                )}
              </View>
              <Ionicons
                name={historyExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={C.textMuted}
              />
            </TouchableOpacity>

            {historyExpanded && (
              <View style={styles.historyBody}>
                <Text style={styles.historySubtitle}>7 derniers jours — total ouvriers par jour</Text>
                <GlobalHistoryChart records={attendanceHistory} companies={companies} />
                {attendanceHistory.length === 0 && (
                  <Text style={styles.historyEmptyHint}>
                    Utilisez "Sauvegarder les présences du jour" pour alimenter l'historique.
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* ── Admin link ── */}
        {companies.length > 0 && permissions.canManageTeams && (
          <TouchableOpacity
            style={styles.adminLinkBtn}
            onPress={() => router.navigate('/(tabs)/admin' as any)}
          >
            <Ionicons name="settings-outline" size={15} color={C.textSub} />
            <Text style={styles.adminLinkBtnText}>Gérer les entreprises dans l'Admin</Text>
            <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* ══ Pointage Modal ══ */}
      <Modal visible={!!workerModal} transparent animationType="fade" onRequestClose={() => setWorkerModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{workerModal?.name}</Text>
              <TouchableOpacity onPress={() => setWorkerModal(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={24} color={C.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.workerModalSub}>Combien de personnes sont présentes sur le chantier ?</Text>

            <Text style={styles.fieldLabel}>Personnes présentes</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => stepWorker(-1)}>
                <Ionicons name="remove" size={20} color={C.primary} />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.stepperInput]}
                value={workerInput}
                onChangeText={setWorkerInput}
                keyboardType="number-pad"
              />
              <TouchableOpacity style={styles.stepperBtn} onPress={() => stepWorker(1)}>
                <Ionicons name="add" size={20} color={C.primary} />
              </TouchableOpacity>
            </View>

            <View style={styles.autoHoursBox}>
              <Ionicons name="time-outline" size={14} color={C.primary} />
              <Text style={styles.autoHoursText}>
                Heures estimées :{' '}
                <Text style={styles.autoHoursValue}>
                  {(parseInt(workerInput, 10) || 0) * standardDayHours}h
                </Text>
                {'  '}
                <Text style={styles.autoHoursMuted}>
                  ({workerInput || 0} pers. × {standardDayHours}h/jour)
                </Text>
              </Text>
            </View>

            <Text style={styles.autoHoursHint}>
              La durée journée est configurable dans Paramètres → Présences.
            </Text>

            <TouchableOpacity style={[styles.confirmBtn, { marginTop: 16, alignSelf: 'stretch' }]} onPress={handleSaveWorkers}>
              <Text style={styles.confirmBtnText}>Enregistrer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface, gap: 8,
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: { padding: 2 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIconBtn: {
    width: 34, height: 34, borderRadius: 9,
    backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center',
  },
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40',
    backgroundColor: C.primaryBg,
  },
  manageBtnLabel: { color: C.primary, fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, padding: 0 },

  sortRow: { flexDirection: 'row', gap: 6 },
  sortChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface2,
  },
  sortChipActive: { borderColor: C.primary + '60', backgroundColor: C.primaryBg },
  sortChipText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted },
  sortChipTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },

  content: { padding: 16, gap: 0 },
  sectionLabelRow: { marginBottom: 10 },
  sectionTitle: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  noResults: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  noResultsText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },

  summaryCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: C.border, gap: 12,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around' },
  summaryItem: { alignItems: 'center' },
  summaryValue: { fontSize: 26, fontFamily: 'Inter_700Bold', color: C.primary },
  summaryLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  divider: { width: 1, backgroundColor: C.border, marginVertical: 4 },
  summaryBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryBarBg: { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  summaryBarFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  summaryBarPct: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary, width: 36, textAlign: 'right' },
  saveSnapshotBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8, borderWidth: 1, borderColor: C.primary + '40',
    backgroundColor: C.primaryBg, alignSelf: 'flex-start',
  },
  saveSnapshotText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

  coCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: C.border, gap: 10,
  },
  coTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  coColorBar: { width: 4, height: 40, borderRadius: 2, flexShrink: 0 },
  coName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  coZone: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  pointageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
  },
  pointageBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  coStats: { flexDirection: 'row', justifyContent: 'space-between' },
  coStat: { alignItems: 'center', flex: 1 },
  coStatVal: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  coStatLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },

  coBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  coBarBg: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  coBarFill: { height: '100%', borderRadius: 3 },
  coBarPct: { fontSize: 11, fontFamily: 'Inter_600SemiBold', width: 36, textAlign: 'right' },

  quickActions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  qaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface2, flex: 1, minWidth: 100,
  },
  qaBtnAlert: { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  qaBtnTask: { borderColor: C.primary + '40', backgroundColor: C.primaryBg },
  qaBtnPhone: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1, borderColor: C.primary + '40',
    backgroundColor: C.primaryBg,
  },
  qaBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textMuted, flex: 1 },

  coFooter: { gap: 4 },
  coContactItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coContactText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },

  chantierPillsSection: { gap: 5 },
  chantierPillsHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chantierPillsLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  chantierPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chantierPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2 },
  chantierPillText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },

  historyCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 12, overflow: 'hidden',
  },
  historyHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14,
  },
  historyHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  historyTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  historyCountBadge: {
    backgroundColor: C.primaryBg, paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 8, borderWidth: 1, borderColor: C.primary + '30',
  },
  historyCountText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.primary },
  historyBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 8, borderTopWidth: 1, borderTopColor: C.border },
  historySubtitle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, paddingTop: 8 },
  historyEmptyHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic' },

  adminLinkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface, marginBottom: 8,
  },
  adminLinkBtnText: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },

  equipeEmptyWrap: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  equipeEmptyIconCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#FCE7F3', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  equipeEmptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center' },
  equipeEmptySubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 19, paddingHorizontal: 8 },
  equipeEmptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primary, paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 12, marginTop: 8,
  },
  equipeEmptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: {
    backgroundColor: C.surface, borderRadius: 20, padding: 24,
    width: '100%', maxWidth: 380,
    ...Platform.select({ default: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 12 } }),
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text, flex: 1 },
  workerModalSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 8 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperBtn: {
    width: 42, height: 42, borderRadius: 10,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40',
    alignItems: 'center', justifyContent: 'center',
  },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 15,
  },
  stepperInput: { flex: 1, textAlign: 'center', paddingVertical: 10 },

  autoHoursBox: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.primaryBg, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.primary + '30',
    marginTop: 14,
  },
  autoHoursText: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  autoHoursValue: { fontFamily: 'Inter_700Bold', color: C.primary },
  autoHoursMuted: { fontFamily: 'Inter_400Regular', color: C.textMuted, fontSize: 12 },
  autoHoursHint: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted,
    marginTop: 6, lineHeight: 16,
  },

  confirmBtn: {
    backgroundColor: C.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  confirmBtnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
