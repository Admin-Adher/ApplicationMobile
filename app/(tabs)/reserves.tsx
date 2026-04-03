import {
  View, Text, StyleSheet, FlatList, SectionList, TouchableOpacity, TextInput,
  Platform, ScrollView, Modal, ActivityIndicator, useWindowDimensions,
  Image, Alert, Share, Animated, RefreshControl,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, useMemo, useCallback, useRef } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Reserve, ReserveStatus, ReservePriority, ReserveKind } from '@/constants/types';
import ReserveCard from '@/components/ReserveCard';
import DateInput from '@/components/DateInput';
import { isOverdue, formatDate } from '@/lib/reserveUtils';
import { PDF_BASE_CSS, PDF_BRAND_COLOR, PDF_MUTED, PDF_TEXT } from '@/lib/pdfBase';

function buildReservesCSV(reserves: Reserve[]): string {
  const header = 'ID,Titre,Bâtiment,Zone,Niveau,Entreprise,Priorité,Statut,Créé le,Échéance,Description';
  const PRIORITY_MAP: Record<string, string> = { low: 'Faible', medium: 'Moyenne', high: 'Haute', critical: 'Critique' };
  const STATUS_MAP: Record<string, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé' };
  const rows = reserves.map(r => {
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    return [
      esc(r.id), esc(r.title), esc(`Bât. ${r.building}`), esc(r.zone), esc(r.level),
      esc((r.companies ?? (r.company ? [r.company] : [])).join('; ')), esc(PRIORITY_MAP[r.priority] ?? r.priority), esc(STATUS_MAP[r.status] ?? r.status),
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

const STATUS_FILTERS: { key: 'all' | 'overdue' | ReserveStatus; label: string; icon?: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'open', label: 'Ouvert' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'waiting', label: 'En attente' },
  { key: 'verification', label: 'Vérification' },
  { key: 'closed', label: 'Clôturé' },
  { key: 'overdue', label: 'En retard', icon: 'warning-outline' },
];

type SortKey = 'date_desc' | 'date_asc' | 'priority' | 'deadline' | 'status';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'date_desc', label: 'Plus récente' },
  { key: 'date_asc', label: 'Plus ancienne' },
  { key: 'priority', label: 'Priorité (critique d\'abord)' },
  { key: 'deadline', label: 'Échéance (plus proche)' },
  { key: 'status', label: 'Statut' },
];

type ViewMode = 'list' | 'grouped_status' | 'grouped_company';

const PRIORITY_ORDER: Record<ReservePriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER_MAP: Record<ReserveStatus, number> = { open: 0, in_progress: 1, waiting: 2, verification: 3, closed: 4 };
const STATUS_LABELS: Record<ReserveStatus, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé' };
const STATUS_COLORS: Record<ReserveStatus, string> = { open: C.open, in_progress: C.inProgress, waiting: C.waiting, verification: C.verification, closed: C.closed };
const PRIORITY_COLORS: Record<ReservePriority, string> = { critical: '#EF4444', high: '#F97316', medium: '#F59E0B', low: '#22C55E' };
const PRIORITY_LABELS: Record<ReservePriority, string> = { critical: 'Critique', high: 'Haute', medium: 'Moyenne', low: 'Basse' };

function toSortableDate(s: string): string {
  if (!s || s === '—') return '9999-99-99';
  const p = s.split('/');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : s;
}

async function generateReportPDF(
  reserves: Reserve[],
  chantierName: string,
  lots: { id: string; name: string; color: string; number?: string }[],
) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR');
  const totalCount = reserves.length;
  const overdueCount = reserves.filter(r => isOverdue(r.deadline, r.status)).length;

  const byStatus: Record<ReserveStatus, number> = { open: 0, in_progress: 0, waiting: 0, verification: 0, closed: 0 };
  for (const r of reserves) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const byCompany: Record<string, { total: number; closed: number; overdue: number }> = {};
  for (const r of reserves) {
    const coNames = r.companies && r.companies.length > 0 ? r.companies : r.company ? [r.company] : ['—'];
    for (const coName of coNames) {
      if (!byCompany[coName]) byCompany[coName] = { total: 0, closed: 0, overdue: 0 };
      byCompany[coName].total++;
      if (r.status === 'closed') byCompany[coName].closed++;
      if (isOverdue(r.deadline, r.status)) byCompany[coName].overdue++;
    }
  }

  const companyRows = Object.entries(byCompany)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([co, stats]) => {
      const rate = stats.total > 0 ? Math.round((stats.closed / stats.total) * 100) : 0;
      return `<tr>
        <td>${co}</td>
        <td style="text-align:center">${stats.total}</td>
        <td style="text-align:center;color:${C.closed}">${stats.closed}</td>
        <td style="text-align:center;color:${stats.overdue > 0 ? C.open : PDF_MUTED}">${stats.overdue}</td>
        <td style="text-align:center"><span style="background:${rate >= 80 ? '#D1FAE5' : rate >= 50 ? '#FEF3C7' : '#FEE2E2'};color:${rate >= 80 ? '#065F46' : rate >= 50 ? '#92400E' : '#991B1B'};padding:2px 8px;border-radius:10px;font-weight:bold">${rate}%</span></td>
      </tr>`;
    }).join('');

  const reserveRows = reserves
    .sort((a, b) => STATUS_ORDER_MAP[a.status] - STATUS_ORDER_MAP[b.status] || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    .map(r => {
      const overdue = isOverdue(r.deadline, r.status);
      const lot = r.lotId ? lots.find(l => l.id === r.lotId) : null;
      return `<tr style="${overdue ? 'background:#FFF1F2' : ''}">
        <td style="font-weight:bold;color:${PDF_BRAND_COLOR}">${r.id}</td>
        <td>${r.title}</td>
        <td>${lot ? (lot.number ? `Lot ${lot.number} — ` : '') + lot.name : '—'}</td>
        <td>Bât. ${r.building} — ${r.zone}</td>
        <td>${(r.companies && r.companies.length > 0 ? r.companies : r.company ? [r.company] : ['—']).join(', ')}</td>
        <td><span style="background:${STATUS_COLORS[r.status]}20;color:${STATUS_COLORS[r.status]};padding:2px 8px;border-radius:8px;font-size:10px;font-weight:bold">${STATUS_LABELS[r.status]}</span></td>
        <td><span style="background:${PRIORITY_COLORS[r.priority]}20;color:${PRIORITY_COLORS[r.priority]};padding:2px 8px;border-radius:8px;font-size:10px;font-weight:bold">${PRIORITY_LABELS[r.priority]}</span></td>
        <td style="${overdue ? 'color:' + C.open + ';font-weight:bold' : ''}">${r.deadline ?? '—'}</td>
      </tr>`;
    }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rapport Réserves</title>
  <style>
    ${PDF_BASE_CSS}
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: ${PDF_BRAND_COLOR}; color: #fff; padding: 8px 10px; text-align: left; font-size: 11px; }
    td { padding: 7px 10px; border-bottom: 1px solid #DDE4EE; font-size: 11px; vertical-align: middle; }
    tr:hover { background: #F4F7FB; }
    .stat-grid { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-card { flex: 1; min-width: 100px; background: #F4F7FB; border-radius: 10px; padding: 12px 16px; border: 1px solid #DDE4EE; }
    .stat-val { font-size: 24px; font-weight: bold; color: ${PDF_BRAND_COLOR}; }
    .stat-lbl { font-size: 10px; color: ${PDF_MUTED}; margin-top: 2px; }
    h2 { color: ${PDF_BRAND_COLOR}; font-size: 14px; margin: 20px 0 10px; border-bottom: 2px solid ${PDF_BRAND_COLOR}; padding-bottom: 4px; }
  </style></head>
  <body><div class="container">
    <div class="letterhead">
      <div class="letterhead-logo">
        <div class="letterhead-logo-mark" style="background:${PDF_BRAND_COLOR};color:#fff;width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:18px">B</div>
        <div><div class="letterhead-brand">BuildTrack</div><div class="letterhead-sub">Rapport de réserves</div></div>
      </div>
      <div style="text-align:right;font-size:11px;color:${PDF_MUTED}">
        <div style="font-weight:bold;color:${PDF_TEXT}">${chantierName}</div>
        <div>Généré le ${dateStr}</div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-val">${totalCount}</div><div class="stat-lbl">Total réserves</div></div>
      <div class="stat-card"><div class="stat-val" style="color:${C.open}">${byStatus.open}</div><div class="stat-lbl">Ouvertes</div></div>
      <div class="stat-card"><div class="stat-val" style="color:${C.inProgress}">${byStatus.in_progress}</div><div class="stat-lbl">En cours</div></div>
      <div class="stat-card"><div class="stat-val" style="color:${C.verification}">${byStatus.verification}</div><div class="stat-lbl">Vérification</div></div>
      <div class="stat-card"><div class="stat-val" style="color:${C.closed}">${byStatus.closed}</div><div class="stat-lbl">Clôturées</div></div>
      <div class="stat-card"><div class="stat-val" style="color:${C.open}">${overdueCount}</div><div class="stat-lbl">En retard</div></div>
    </div>

    <h2>Récapitulatif par entreprise</h2>
    <table>
      <thead><tr><th>Entreprise</th><th>Total</th><th>Clôturées</th><th>En retard</th><th>Taux clôture</th></tr></thead>
      <tbody>${companyRows}</tbody>
    </table>

    <h2>Liste détaillée (${totalCount} réserves)</h2>
    <table>
      <thead><tr><th>ID</th><th>Titre</th><th>Lot</th><th>Localisation</th><th>Entreprise</th><th>Statut</th><th>Priorité</th><th>Échéance</th></tr></thead>
      <tbody>${reserveRows}</tbody>
    </table>
    ${overdueCount > 0 ? `<p style="color:${C.open};font-size:11px">* Les lignes surlignées en rouge indiquent des réserves en retard.</p>` : ''}
  </div></body></html>`;

  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  }
}

export default function ReservesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reserves, companies, isLoading, chantiers, activeChantierId, lots, batchUpdateReserves, updateReserveFields, updateReserveStatus, deleteReserve, addComment, reload } = useApp();
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
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [viewModeModalVisible, setViewModeModalVisible] = useState(false);

  const topPad = insets.top;
  const { width } = useWindowDimensions();
  const isWideScreen = width >= 768;
  const [selectedReserveId, setSelectedReserveId] = useState<string | null>(null);
  const [nearDeadlineOnly, setNearDeadlineOnly] = useState(false);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [batchAction, setBatchAction] = useState<'status' | 'company' | 'deadline' | 'delete' | null>(null);
  const [batchStatus, setBatchStatus] = useState<ReserveStatus>('in_progress');
  const [batchCompany, setBatchCompany] = useState('');
  const [batchDeadline, setBatchDeadline] = useState('');

  const [quickStatusReserve, setQuickStatusReserve] = useState<Reserve | null>(null);
  const [quickStatusVisible, setQuickStatusVisible] = useState(false);

  const [fabOpen, setFabOpen] = useState(false);
  const fabAnim = useRef(new Animated.Value(0)).current;
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.resolve(reload()); } finally { setRefreshing(false); }
  }, [reload]);

  function toggleFab() {
    const toValue = fabOpen ? 0 : 1;
    Animated.spring(fabAnim, { toValue, useNativeDriver: true, tension: 60, friction: 10 }).start();
    setFabOpen(v => !v);
  }

  async function handleQuickPhoto() {
    setFabOpen(false);
    Animated.spring(fabAnim, { toValue: 0, useNativeDriver: true, tension: 60, friction: 10 }).start();
    if (Platform.OS === 'web') {
      router.push('/reserve/new' as any);
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission refusée', "L'accès à l'appareil photo est nécessaire.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      router.push({ pathname: '/reserve/new', params: { quickPhotoUri: result.assets[0].uri } } as any);
    }
  }

  const [tabletComment, setTabletComment] = useState('');
  const [tabletCommentSending, setTabletCommentSending] = useState(false);

  const [pdfLoading, setPdfLoading] = useState(false);

  const chantierReserves = useMemo(() => {
    let list = chantierFilter === 'all' ? reserves : reserves.filter(r => r.chantierId === chantierFilter);
    if (isSousTraitant && sousTraitantCompanyName) {
      list = list.filter(r => {
        const names = r.companies ?? (r.company ? [r.company] : []);
        return names.includes(sousTraitantCompanyName!);
      });
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
      Share.share({ title: 'Export réserves CSV', message: buildReservesCSV(filtered) }).catch(() => {});
    }
  }

  async function handleExportPDF() {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const chantierName = chantierFilter !== 'all'
        ? chantiers.find(c => c.id === chantierFilter)?.name ?? 'Chantier'
        : 'Tous les chantiers';
      await generateReportPDF(filtered, chantierName, lots);
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de générer le rapport PDF.');
    } finally {
      setPdfLoading(false);
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
    + (lotFilter !== 'all' ? 1 : 0)
    + (statusFilter !== 'all' ? 1 : 0)
    + (nearDeadlineOnly ? 1 : 0);

  const overdueCount = useMemo(
    () => chantierReserves.filter(r => isOverdue(r.deadline, r.status)).length,
    [chantierReserves]
  );

  const filtered = useMemo(() => {
    const now = new Date();
    const in3Days = new Date(now);
    in3Days.setDate(in3Days.getDate() + 3);

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
      const matchCompany = companyFilter === 'all' || (r.companies ?? (r.company ? [r.company] : [])).includes(companyFilter);
      const matchZone = zoneFilter === 'all' || r.zone === zoneFilter;
      const matchLot = lotFilter === 'all' || r.lotId === lotFilter;
      const q = search.toLowerCase();
      const lot = r.lotId ? lots.find(l => l.id === r.lotId) : null;
      const matchSearch = !q ||
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.companies ?? (r.company ? [r.company] : [])).some(c => c.toLowerCase().includes(q)) ||
        r.building.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.zone.toLowerCase().includes(q) ||
        r.level.toLowerCase().includes(q) ||
        (lot?.name?.toLowerCase().includes(q) ?? false) ||
        (lot?.number ? `lot ${lot.number}`.toLowerCase().includes(q) : false);
      const matchNearDeadline = !nearDeadlineOnly || (() => {
        if (r.status === 'closed') return false;
        const dl = parseDeadline(r.deadline);
        if (!dl) return false;
        return dl >= now && dl <= in3Days;
      })();
      return matchStatus && matchKind && matchBuilding && matchPriority && matchCompany && matchZone && matchLot && matchSearch && matchNearDeadline;
    });

    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'date_desc': return toSortableDate(b.createdAt).localeCompare(toSortableDate(a.createdAt));
        case 'date_asc': return toSortableDate(a.createdAt).localeCompare(toSortableDate(b.createdAt));
        case 'priority': return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        case 'deadline': return toSortableDate(a.deadline).localeCompare(toSortableDate(b.deadline));
        case 'status': return STATUS_ORDER_MAP[a.status] - STATUS_ORDER_MAP[b.status];
        default: return 0;
      }
    });
    return list;
  }, [chantierReserves, statusFilter, kindFilter, buildingFilter, priorityFilter, companyFilter, zoneFilter, lotFilter, sortKey, search, nearDeadlineOnly, lots]);

  const groupedByStatus = useMemo(() => {
    const ORDER: ReserveStatus[] = ['open', 'in_progress', 'waiting', 'verification', 'closed'];
    return ORDER.map(s => {
      const data = filtered.filter(r => r.status === s);
      return { title: STATUS_LABELS[s], key: s, data, color: STATUS_COLORS[s] };
    }).filter(s => s.data.length > 0);
  }, [filtered]);

  const groupedByCompany = useMemo(() => {
    const coMap: Record<string, Reserve[]> = {};
    for (const r of filtered) {
      const names = r.companies && r.companies.length > 0 ? r.companies : r.company ? [r.company] : ['—'];
      for (const name of names) {
        if (!coMap[name]) coMap[name] = [];
        coMap[name].push(r);
      }
    }
    return Object.entries(coMap)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([company, data]) => {
        const co = companies.find(c => c.name === company);
        return { title: company, key: company, data, color: co?.color ?? C.primary };
      });
  }, [filtered, companies]);

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

    if (batchAction === 'delete') {
      Alert.alert(
        'Confirmer la suppression',
        `Supprimer ${ids.length} réserve${ids.length > 1 ? 's' : ''} ? Cette action est irréversible.`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Supprimer', style: 'destructive',
            onPress: () => {
              ids.forEach(id => deleteReserve(id));
              setBatchModalVisible(false);
              setBatchAction(null);
              setIsSelectMode(false);
              setSelectedIds(new Set());
              Alert.alert('Supprimé', `${ids.length} réserve${ids.length > 1 ? 's' : ''} supprimée${ids.length > 1 ? 's' : ''}.`);
            },
          },
        ]
      );
      return;
    }

    const updates: Partial<{ status: ReserveStatus; company: string; companies: string[]; deadline: string }> = {};
    if (batchAction === 'status') updates.status = batchStatus;
    if (batchAction === 'company' && batchCompany) {
      updates.company = batchCompany;
      updates.companies = [batchCompany];
    }
    if (batchAction === 'deadline' && batchDeadline) updates.deadline = batchDeadline;
    if (Object.keys(updates).length === 0) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    batchUpdateReserves(ids, updates, user?.name);
    setBatchModalVisible(false);
    setBatchAction(null);
    setIsSelectMode(false);
    setSelectedIds(new Set());
    Alert.alert('Mise à jour effectuée', `${ids.length} réserve${ids.length > 1 ? 's' : ''} mise${ids.length > 1 ? 's' : ''} à jour.`);
  }, [selectedIds, batchAction, batchStatus, batchCompany, batchDeadline, batchUpdateReserves, deleteReserve, user]);

  function resetAllFilters() {
    setBuildingFilter('all');
    setPriorityFilter('all');
    setCompanyFilter('all');
    setZoneFilter('all');
    setKindFilter('all');
    setLotFilter('all');
    setStatusFilter('all');
    setNearDeadlineOnly(false);
  }

  function handleQuickStatusChange(reserve: Reserve) {
    setQuickStatusReserve(reserve);
    setQuickStatusVisible(true);
  }

  function applyQuickStatus(newStatus: ReserveStatus) {
    if (!quickStatusReserve) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    updateReserveStatus(quickStatusReserve.id, newStatus, user?.name ?? 'Conducteur de travaux');
    setQuickStatusVisible(false);
    setQuickStatusReserve(null);
  }

  function handleSwipeLeft(reserve: Reserve) {
    Alert.alert(
      'Archiver cette réserve',
      `Clôturer "${reserve.title}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Clôturer', onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            updateReserveStatus(reserve.id, 'closed', user?.name ?? 'Conducteur de travaux');
          },
        },
      ]
    );
  }

  async function handleTabletComment(reserve: Reserve) {
    if (!tabletComment.trim()) return;
    setTabletCommentSending(true);
    try {
      await addComment(reserve.id, tabletComment.trim(), user?.name ?? 'Conducteur');
      setTabletComment('');
    } catch {
      Alert.alert('Erreur', 'Impossible d\'envoyer le commentaire.');
    } finally {
      setTabletCommentSending(false);
    }
  }

  const VIEW_MODE_LABELS: Record<ViewMode, string> = {
    list: 'Liste',
    grouped_status: 'Par statut',
    grouped_company: 'Par entreprise',
  };
  const VIEW_MODE_ICONS: Record<ViewMode, string> = {
    list: 'list-outline',
    grouped_status: 'layers-outline',
    grouped_company: 'people-outline',
  };

  const renderCard = (item: Reserve) => (
    <View style={styles.selectableRow}>
      {isSelectMode && (
        <TouchableOpacity
          onPress={() => toggleId(item.id)}
          style={[styles.checkbox, selectedIds.has(item.id) && styles.checkboxChecked]}
          accessibilityRole="checkbox"
          accessibilityLabel={`Sélectionner réserve ${item.id}`}
          accessibilityState={{ checked: selectedIds.has(item.id) }}
        >
          {selectedIds.has(item.id) && <Ionicons name="checkmark" size={14} color="#fff" />}
        </TouchableOpacity>
      )}
      <View style={{ flex: 1 }}>
        <ReserveCard
          reserve={item}
          onPress={r => isSelectMode ? toggleId(r.id) : (isWideScreen ? setSelectedReserveId(r.id === selectedReserveId ? null : r.id) : router.push(`/reserve/${r.id}` as any))}
          onLongPress={permissions.canEdit ? handleQuickStatusChange : undefined}
          onSwipeRight={permissions.canEdit ? handleQuickStatusChange : undefined}
          onSwipeLeft={permissions.canEdit ? handleSwipeLeft : undefined}
          selected={item.id === selectedReserveId}
        />
      </View>
    </View>
  );

  const listEmpty = (
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
          ? 'Commencez par créer votre première réserve'
          : 'Modifiez vos filtres ou votre recherche'}
      </Text>
      {chantierReserves.length === 0 && permissions.canCreate && (
        <TouchableOpacity
          style={styles.emptyBtn}
          onPress={() => router.push('/reserve/new' as any)}
        >
          <Ionicons name="add-circle-outline" size={16} color="#fff" />
          <Text style={styles.emptyBtnText}>Créer une réserve</Text>
        </TouchableOpacity>
      )}
      {chantierReserves.length > 0 && (
        <TouchableOpacity style={styles.emptyBtnSecondary} onPress={resetAllFilters}>
          <Text style={styles.emptyBtnSecondaryText}>Réinitialiser les filtres</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderSectionHeader = ({ section }: { section: { title: string; color: string; data: Reserve[] } }) => (
    <View style={[styles.sectionHeader, { borderLeftColor: section.color }]}>
      <View style={[styles.sectionDot, { backgroundColor: section.color }]} />
      <Text style={[styles.sectionTitle, { color: section.color }]}>{section.title}</Text>
      <Text style={styles.sectionCount}>{section.data.length}</Text>
    </View>
  );

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
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {permissions.canExport && filtered.length > 0 && !isSelectMode && (
              <>
                <TouchableOpacity style={styles.selectBtn} onPress={handleExportCSV} accessibilityLabel="Exporter en CSV">
                  <Ionicons name="download-outline" size={14} color={C.textSub} />
                  <Text style={styles.selectBtnText}>CSV</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.selectBtn} onPress={handleExportPDF} accessibilityLabel="Exporter rapport PDF" disabled={pdfLoading}>
                  {pdfLoading
                    ? <ActivityIndicator size="small" color={C.primary} />
                    : <Ionicons name="document-text-outline" size={14} color={C.textSub} />}
                  <Text style={styles.selectBtnText}>PDF</Text>
                </TouchableOpacity>
              </>
            )}
            {permissions.canEdit && filtered.length > 0 && (
              <TouchableOpacity
                style={[styles.selectBtn, isSelectMode && styles.selectBtnActive]}
                onPress={toggleSelectMode}
                accessibilityLabel={isSelectMode ? 'Annuler la sélection' : 'Mode sélection multiple'}
              >
                <Ionicons
                  name={isSelectMode ? 'close-circle' : 'checkmark-circle-outline'}
                  size={14}
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
            <TouchableOpacity style={styles.selectBarBtn} onPress={selectAll} accessibilityLabel="Tout sélectionner">
              <Ionicons name="checkmark-done-outline" size={14} color={C.primary} />
              <Text style={styles.selectBarBtnText}>Tout sélect.</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.selectBarBtn} onPress={() => setSelectedIds(new Set())} accessibilityLabel="Désélectionner tout">
              <Ionicons name="close-outline" size={14} color={C.textSub} />
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
            style={[styles.deadlineReminderBanner, nearDeadlineOnly && styles.deadlineReminderBannerActive]}
            onPress={() => setNearDeadlineOnly(v => !v)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`${nearDeadlineReserves.length} réserves expirent dans moins de 3 jours`}
          >
            <Ionicons name="alarm-outline" size={14} color="#D97706" />
            <Text style={styles.deadlineReminderText}>
              <Text style={{ fontFamily: 'Inter_700Bold' }}>{nearDeadlineReserves.length} réserve{nearDeadlineReserves.length > 1 ? 's' : ''}</Text>
              {' '}expire{nearDeadlineReserves.length > 1 ? 'nt' : ''} dans moins de 3 jours{nearDeadlineOnly ? ' — filtre actif' : ' — voir'}
            </Text>
            <Ionicons name={nearDeadlineOnly ? 'close-circle' : 'chevron-forward'} size={13} color="#D97706" />
          </TouchableOpacity>
        )}

        {chantiers.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chantierBar}>
            <TouchableOpacity
              style={[styles.chantierChip, chantierFilter === 'all' && styles.chantierChipActive]}
              onPress={() => setChantierFilter('all')}
              accessibilityRole="button"
              accessibilityLabel="Tous les chantiers"
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
                accessibilityRole="button"
                accessibilityLabel={`Filtrer chantier ${c.name}`}
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
            placeholder="Titre, bâtiment, zone, entreprise, lot..."
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
            accessibilityLabel="Rechercher dans les réserves"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Effacer la recherche">
              <Ionicons name="close-circle" size={16} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Status filter row */}
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
                    accessibilityRole="button"
                    accessibilityLabel={`Filtrer par statut : ${f.label}`}
                    accessibilityState={{ selected: isActive }}
                  >
                    {f.icon && <Ionicons name={f.icon as any} size={11} color={isActive ? '#fff' : C.open} />}
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
            </ScrollView>
            <View style={styles.filterScrollFade} />
          </View>

          <TouchableOpacity
            style={[styles.toolBtn, activeFilterCount > 0 && styles.toolBtnActive]}
            onPress={() => setFilterModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`Filtres avancés${activeFilterCount > 0 ? `, ${activeFilterCount} actif${activeFilterCount > 1 ? 's' : ''}` : ''}`}
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
            accessibilityRole="button"
            accessibilityLabel="Trier"
          >
            <Ionicons name="swap-vertical-outline" size={15} color={isSortActive ? C.primary : C.textSub} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolBtn, viewMode !== 'list' && styles.toolBtnActive]}
            onPress={() => setViewModeModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`Mode d'affichage : ${VIEW_MODE_LABELS[viewMode]}`}
          >
            <Ionicons name={VIEW_MODE_ICONS[viewMode] as any} size={15} color={viewMode !== 'list' ? C.primary : C.textSub} />
          </TouchableOpacity>
        </View>

      </View>

      {isWideScreen ? (
        <View style={styles.splitRow}>
          <View style={styles.splitList}>
            {viewMode === 'grouped_status' || viewMode === 'grouped_company' ? (
              <SectionList
                sections={viewMode === 'grouped_status' ? groupedByStatus : groupedByCompany}
                keyExtractor={item => item.id}
                renderItem={({ item }) => renderCard(item)}
                renderSectionHeader={renderSectionHeader}
                stickySectionHeadersEnabled
                contentContainerStyle={styles.listNarrow}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={() => listEmpty}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
              />
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={item => item.id}
                renderItem={({ item }) => renderCard(item)}
                contentContainerStyle={styles.listNarrow}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={() => listEmpty}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
              />
            )}
          </View>
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
                      const pc = PRIORITY_COLORS[selectedReserve.priority] ?? '#6B7280';
                      return (
                        <View style={[styles.detailPriorityBadge, { backgroundColor: pc + '20', borderColor: pc }]}>
                          <Text style={[styles.detailPriorityText, { color: pc }]}>{PRIORITY_LABELS[selectedReserve.priority] ?? selectedReserve.priority}</Text>
                        </View>
                      );
                    })()}
                  </View>
                </View>

                {/* Quick status buttons */}
                {permissions.canEdit && (
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>CHANGER LE STATUT</Text>
                    <View style={styles.quickStatusRow}>
                      {(Object.entries(STATUS_LABELS) as [ReserveStatus, string][]).map(([s, label]) => {
                        const active = selectedReserve.status === s;
                        const color = STATUS_COLORS[s];
                        return (
                          <TouchableOpacity
                            key={s}
                            style={[styles.quickStatusBtn, { borderColor: color }, active && { backgroundColor: color }]}
                            onPress={() => {
                              if (!active) {
                                updateReserveStatus(selectedReserve.id, s, user?.name ?? 'Conducteur de travaux');
                                setSelectedReserveId(null);
                                setTimeout(() => setSelectedReserveId(selectedReserve.id), 50);
                              }
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`Changer statut en ${label}`}
                            accessibilityState={{ selected: active }}
                          >
                            <Text style={[styles.quickStatusBtnText, { color: active ? '#fff' : color }]}>{label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                {(selectedReserve.photos?.[0]?.uri ?? selectedReserve.photoUri) ? (
                  <Image source={{ uri: selectedReserve.photos?.[0]?.uri ?? selectedReserve.photoUri }} style={styles.detailPhoto} resizeMode="cover" />
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
                    <Text style={styles.detailMeta}>
                      {(selectedReserve.companies && selectedReserve.companies.length > 0
                        ? selectedReserve.companies
                        : selectedReserve.company ? [selectedReserve.company] : ['—']
                      ).join(', ')}
                    </Text>
                  </View>
                  {selectedReserve.deadline && selectedReserve.deadline !== '—' && (
                    <View style={styles.detailRow}>
                      <Ionicons name="calendar-outline" size={14} color={C.textMuted} />
                      <Text style={styles.detailMeta}>Échéance : {selectedReserve.deadline}</Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Ionicons name="time-outline" size={14} color={C.textMuted} />
                    <Text style={styles.detailMeta}>Créée le {formatDate(selectedReserve.createdAt)}</Text>
                  </View>
                </View>

                {/* Quick comment */}
                {permissions.canEdit && (
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>AJOUTER UN COMMENTAIRE</Text>
                    <View style={styles.tabletCommentRow}>
                      <TextInput
                        style={styles.tabletCommentInput}
                        placeholder="Votre commentaire..."
                        placeholderTextColor={C.textMuted}
                        value={tabletComment}
                        onChangeText={setTabletComment}
                        multiline
                        numberOfLines={2}
                        accessibilityLabel="Saisir un commentaire"
                      />
                      <TouchableOpacity
                        style={[styles.tabletCommentBtn, (!tabletComment.trim() || tabletCommentSending) && styles.tabletCommentBtnDisabled]}
                        onPress={() => handleTabletComment(selectedReserve)}
                        disabled={!tabletComment.trim() || tabletCommentSending}
                        accessibilityRole="button"
                        accessibilityLabel="Envoyer le commentaire"
                      >
                        {tabletCommentSending
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Ionicons name="send" size={16} color="#fff" />}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

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
        viewMode === 'grouped_status' || viewMode === 'grouped_company' ? (
          <SectionList
            sections={viewMode === 'grouped_status' ? groupedByStatus : groupedByCompany}
            keyExtractor={item => item.id}
            renderItem={({ item }) => renderCard(item)}
            renderSectionHeader={renderSectionHeader}
            stickySectionHeadersEnabled
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={() => listEmpty}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
          />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            renderItem={({ item }) => renderCard(item)}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={() => listEmpty}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
          />
        )
      )}

      {isSelectMode && selectedIds.size > 0 && (
        <View style={styles.batchBar}>
          <Text style={styles.batchBarCount}>{selectedIds.size} sélect.</Text>
          <TouchableOpacity
            style={styles.batchBarBtn}
            onPress={() => { setBatchAction('status'); setBatchModalVisible(true); }}
          >
            <Ionicons name="swap-horizontal-outline" size={15} color="#fff" />
            <Text style={styles.batchBarBtnText}>Statut</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.batchBarBtn}
            onPress={() => { setBatchAction('company'); setBatchModalVisible(true); }}
          >
            <Ionicons name="people-outline" size={15} color="#fff" />
            <Text style={styles.batchBarBtnText}>Entreprise</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.batchBarBtn}
            onPress={() => { setBatchAction('deadline'); setBatchModalVisible(true); }}
          >
            <Ionicons name="calendar-outline" size={15} color="#fff" />
            <Text style={styles.batchBarBtnText}>Échéance</Text>
          </TouchableOpacity>
          {permissions.canDelete && (
            <TouchableOpacity
              style={[styles.batchBarBtn, styles.batchBarBtnDelete]}
              onPress={() => {
                if (selectedIds.size === 0) return;
                const ids = Array.from(selectedIds);
                Alert.alert(
                  'Confirmer la suppression',
                  `Supprimer ${ids.length} réserve${ids.length > 1 ? 's' : ''} ? Cette action est irréversible.`,
                  [
                    { text: 'Annuler', style: 'cancel' },
                    {
                      text: 'Supprimer', style: 'destructive',
                      onPress: () => {
                        ids.forEach(id => deleteReserve(id));
                        setBatchModalVisible(false);
                        setBatchAction(null);
                        setIsSelectMode(false);
                        setSelectedIds(new Set());
                        Alert.alert('Supprimé', `${ids.length} réserve${ids.length > 1 ? 's' : ''} supprimée${ids.length > 1 ? 's' : ''}.`);
                      },
                    },
                  ]
                );
              }}
            >
              <Ionicons name="trash-outline" size={15} color="#fff" />
              <Text style={styles.batchBarBtnText}>Supprimer</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!isSelectMode && permissions.canCreate && (
        <View style={[styles.fabContainer, { bottom: Platform.OS === 'web' ? 94 : insets.bottom + 55 }]}>
          {fabOpen && (
            <Animated.View style={[styles.fabSubRow, { opacity: fabAnim }]}>
              <TouchableOpacity
                style={styles.fabSubLabel}
                onPress={() => { setFabOpen(false); Animated.spring(fabAnim, { toValue: 0, useNativeDriver: true, tension: 60, friction: 10 }).start(); router.push('/reserve/new' as any); }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Formulaire complet"
              >
                <Text style={styles.fabSubLabelText}>Formulaire complet</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.fabSubBtn}
                onPress={() => { setFabOpen(false); Animated.spring(fabAnim, { toValue: 0, useNativeDriver: true, tension: 60, friction: 10 }).start(); router.push('/reserve/new' as any); }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Formulaire complet"
              >
                <Ionicons name="create-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </Animated.View>
          )}

          {fabOpen && (
            <Animated.View style={[styles.fabSubRow, { opacity: fabAnim }]}>
              <TouchableOpacity
                style={styles.fabSubLabel}
                onPress={handleQuickPhoto}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Photo rapide"
              >
                <Text style={styles.fabSubLabelText}>Photo rapide</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.fabSubBtn, { backgroundColor: '#0EA5E9' }]}
                onPress={handleQuickPhoto}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Photo rapide"
              >
                <Ionicons name="camera-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </Animated.View>
          )}

          <Animated.View style={{
            transform: [{ rotate: fabAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) }],
          }}>
            <TouchableOpacity
              style={styles.fab}
              onPress={toggleFab}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={fabOpen ? 'Fermer le menu' : 'Créer une nouvelle réserve'}
            >
              <Ionicons name="add" size={26} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}

      {/* Quick Status Modal */}
      <Modal visible={quickStatusVisible} transparent animationType="slide" onRequestClose={() => setQuickStatusVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setQuickStatusVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.bottomSheet, { paddingBottom: insets.bottom + 32 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>Changer le statut</Text>
            </View>
            {quickStatusReserve && (
              <Text style={styles.batchDesc} numberOfLines={2}>{quickStatusReserve.title}</Text>
            )}
            {(Object.entries(STATUS_LABELS) as [ReserveStatus, string][]).map(([key, label]) => {
              const isActive = quickStatusReserve?.status === key;
              const color = STATUS_COLORS[key];
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.sheetItem, isActive && styles.sheetItemActive]}
                  onPress={() => applyQuickStatus(key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Changer statut en ${label}`}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.statusDot, { backgroundColor: color }]} />
                    <Text style={[styles.sheetItemText, isActive && styles.sheetItemTextActive]}>{label}</Text>
                  </View>
                  {isActive && <Ionicons name="checkmark" size={16} color={C.primary} />}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setQuickStatusVisible(false)}>
              <Text style={styles.cancelText}>Annuler</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Batch Modal */}
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[key] }]} />
                      <Text style={[styles.sheetItemText, batchStatus === key && styles.sheetItemTextActive]}>{label}</Text>
                    </View>
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
                <DateInput
                  label="Nouvelle date d'échéance"
                  value={batchDeadline}
                  onChange={setBatchDeadline}
                  optional
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

      {/* Sort Modal */}
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

      {/* View mode Modal */}
      <Modal visible={viewModeModalVisible} transparent animationType="slide" onRequestClose={() => setViewModeModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setViewModeModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.bottomSheet, { paddingBottom: insets.bottom + 32 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>Mode d'affichage</Text>
            </View>
            {(Object.entries(VIEW_MODE_LABELS) as [ViewMode, string][]).map(([mode, label]) => (
              <TouchableOpacity
                key={mode}
                style={styles.sheetItem}
                onPress={() => { setViewMode(mode); setViewModeModalVisible(false); }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Ionicons name={VIEW_MODE_ICONS[mode] as any} size={18} color={viewMode === mode ? C.primary : C.textSub} />
                  <Text style={[styles.sheetItemText, viewMode === mode && styles.sheetItemTextActive]}>{label}</Text>
                </View>
                {viewMode === mode && <Ionicons name="checkmark" size={16} color={C.primary} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setViewModeModalVisible(false)}>
              <Text style={styles.cancelText}>Fermer</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Advanced Filters Modal */}
      <Modal visible={filterModalVisible} transparent animationType="slide" onRequestClose={() => setFilterModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFilterModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.bottomSheet, { paddingBottom: insets.bottom + 32 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>Filtres avancés</Text>
              {activeFilterCount > 0 && (
                <TouchableOpacity onPress={resetAllFilters}>
                  <Text style={styles.resetText}>Réinitialiser tout</Text>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetSectionLabel}>TYPE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                <View style={styles.chipRowInline}>
                  <TouchableOpacity
                    style={[styles.chip, kindFilter === 'all' && styles.chipActive]}
                    onPress={() => setKindFilter('all')}
                    accessibilityRole="button"
                    accessibilityLabel="Tous types"
                    accessibilityState={{ selected: kindFilter === 'all' }}
                  >
                    <Text style={[styles.chipText, kindFilter === 'all' && styles.chipTextActive]}>Tous types</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.chip, kindFilter === 'reserve' && { backgroundColor: '#EF444415', borderColor: '#EF4444' }]}
                    onPress={() => setKindFilter('reserve')}
                    accessibilityRole="button"
                    accessibilityLabel="Réserves uniquement"
                    accessibilityState={{ selected: kindFilter === 'reserve' }}
                  >
                    <Ionicons name="warning-outline" size={12} color={kindFilter === 'reserve' ? '#EF4444' : C.textSub} />
                    <Text style={[styles.chipText, kindFilter === 'reserve' && { color: '#EF4444' }]}>Réserves</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.chip, kindFilter === 'observation' && { backgroundColor: '#0EA5E915', borderColor: '#0EA5E9' }]}
                    onPress={() => setKindFilter('observation')}
                    accessibilityRole="button"
                    accessibilityLabel="Observations uniquement"
                    accessibilityState={{ selected: kindFilter === 'observation' }}
                  >
                    <Ionicons name="eye-outline" size={12} color={kindFilter === 'observation' ? '#0EA5E9' : C.textSub} />
                    <Text style={[styles.chipText, kindFilter === 'observation' && { color: '#0EA5E9' }]}>
                      Observations{obsCount > 0 ? ` (${obsCount})` : ''}
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>

              <Text style={styles.sheetSectionLabel}>BÂTIMENT</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                <View style={styles.chipRowInline}>
                  {['all', ...buildings].map(b => (
                    <TouchableOpacity
                      key={b}
                      style={[styles.chip, buildingFilter === b && styles.chipActive]}
                      onPress={() => setBuildingFilter(b)}
                      accessibilityRole="button"
                      accessibilityLabel={b === 'all' ? 'Tous les bâtiments' : `Bâtiment ${b}`}
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
                      accessibilityRole="button"
                      accessibilityLabel={`Priorité ${p.label}`}
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
                      accessibilityRole="button"
                      accessibilityLabel={z === 'all' ? 'Toutes les zones' : `Zone ${z}`}
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
                    accessibilityRole="button"
                    accessibilityLabel="Toutes les entreprises"
                  >
                    <Text style={[styles.chipText, companyFilter === 'all' && styles.chipTextActive]}>Toutes</Text>
                  </TouchableOpacity>
                  {companies.map(co => (
                    <TouchableOpacity
                      key={co.id}
                      style={[styles.chip, companyFilter === co.name && { backgroundColor: co.color + '20', borderColor: co.color }]}
                      onPress={() => setCompanyFilter(co.name)}
                      accessibilityRole="button"
                      accessibilityLabel={`Entreprise ${co.name}`}
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
                        accessibilityRole="button"
                        accessibilityLabel="Tous les lots"
                      >
                        <Text style={[styles.chipText, lotFilter === 'all' && styles.chipTextActive]}>Tous</Text>
                      </TouchableOpacity>
                      {lots.map(lot => (
                        <TouchableOpacity
                          key={lot.id}
                          style={[styles.chip, lotFilter === lot.id && { backgroundColor: (lot.color ?? C.primary) + '20', borderColor: lot.color ?? C.primary }]}
                          onPress={() => setLotFilter(lot.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Lot ${lot.number ?? ''} ${lot.name}`}
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
    paddingLeft: 24,
    paddingRight: 16,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  selectBtnActive: { backgroundColor: C.open + '15', borderColor: C.open },
  selectBtnText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
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
    paddingVertical: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  kindRow: { flexDirection: 'row', marginBottom: 4, paddingBottom: 2 },
  kindChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surface2, marginRight: 6, borderWidth: 1, borderColor: C.border,
  },
  kindChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  kindChipReserve: { backgroundColor: '#EF444415', borderColor: '#EF4444' },
  kindChipObs: { backgroundColor: '#0EA5E915', borderColor: '#0EA5E9' },
  kindChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  kindChipTextActive: { color: '#fff' },
  filterScrollContainer: { flex: 1, position: 'relative' },
  filterScrollFade: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 32,
    backgroundColor: C.surface,
    opacity: 0.88,
    pointerEvents: 'none' as any,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
  },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surface2, marginRight: 6, borderWidth: 1, borderColor: C.border,
  },
  filterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterChipOverdue: { backgroundColor: C.open, borderColor: C.open },
  filterText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  filterTextActive: { color: '#fff' },
  filterTextOverdue: { color: '#fff' },
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
  chantierBar: { marginBottom: 8 },
  stBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 8, borderWidth: 1, borderColor: C.primary + '30',
  },
  stBannerText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.text, flex: 1 },
  chantierChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
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
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primary, paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 12, marginTop: 8,
  },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  emptyBtnSecondary: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, marginTop: 4,
  },
  emptyBtnSecondaryText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.bg, paddingHorizontal: 16, paddingVertical: 10,
    borderLeftWidth: 3, marginBottom: 2,
  },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', flex: 1 },
  sectionCount: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted,
    backgroundColor: C.surface2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
  },
  batchBar: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 80 : 0,
    left: 0, right: 0,
    backgroundColor: C.primary,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 12, gap: 8,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    ...Platform.select({
      web: { boxShadow: '0px -4px 16px rgba(0,48,130,0.25)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 10 },
    }),
  },
  batchBarCount: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#fff', flex: 1 },
  batchBarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.20)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10,
  },
  batchBarBtnDelete: { backgroundColor: 'rgba(220,38,38,0.35)' },
  batchBarBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  batchDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 14, fontStyle: 'italic' },
  coDot: { width: 10, height: 10, borderRadius: 5 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  bottomSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12, maxHeight: '85%',
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

  fabContainer: {
    position: 'absolute',
    right: 20,
    alignItems: 'flex-end',
    zIndex: 100,
  },
  fab: {
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
  fabSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    marginBottom: 10,
  },
  fabSubBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0px 2px 10px rgba(0,48,130,0.25)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 6 },
    }),
  },
  fabSubLabel: {
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0px 2px 8px rgba(0,0,0,0.10)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.10, shadowRadius: 6, elevation: 4 },
    }),
  },
  fabSubLabelText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
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

  quickStatusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  quickStatusBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5,
  },
  quickStatusBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  tabletCommentRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  tabletCommentInput: {
    flex: 1, backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    minHeight: 56,
  },
  tabletCommentBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  tabletCommentBtnDisabled: { backgroundColor: C.border },

  deadlineReminderBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF3C7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9,
    marginBottom: 8, borderWidth: 1, borderColor: '#FCD34D',
  },
  deadlineReminderBannerActive: {
    backgroundColor: '#FFFBEB', borderColor: '#D97706',
  },
  deadlineReminderText: {
    flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: '#92400E',
  },
});
