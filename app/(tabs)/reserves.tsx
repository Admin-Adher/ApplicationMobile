import {
  View, Text, StyleSheet, FlatList, SectionList, TouchableOpacity, TextInput,
  Platform, ScrollView, Modal, ActivityIndicator, useWindowDimensions,
  Image, Alert, Share, Animated, RefreshControl,
  SafeAreaView, Pressable, KeyboardAvoidingView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SkeletonList } from '@/components/SkeletonCard';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Reserve, ReserveStatus, ReservePriority, ReserveKind } from '@/constants/types';
import ReserveCard from '@/components/ReserveCard';
import DateInput from '@/components/DateInput';
import DictationTextInput from '@/components/DictationTextInput';
import { isOverdue, isDueSoon, formatDate, genReserveId, compareLevels, validateDeadline } from '@/lib/reserveUtils';
import { genId, nowTimestampFR } from '@/lib/utils';
import { PDF_BASE_CSS, PDF_BRAND_COLOR, PDF_MUTED, PDF_TEXT, exportPDF as exportPDFHelper, printPDF as printPDFHelper, escapeHtml, loadPhotoAsDataUrlForPdf } from '@/lib/pdfBase';
import {
  countLocalOnlyReservePhotos,
  enrichReservesForPdf as enrichReserveListForPdf,
  formatReserveLocation,
  getRemoteReservePhotosForPdf,
  getReservePdfPhotos,
} from '@/lib/pdfReserveHelpers';
import { buildPdfFilename } from '@/lib/pdfFilename';
import { generateAndSendReservesReport } from '@/lib/email/client';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  RESERVE_PRIORITY_COLORS as PRIORITY_COLORS,
  RESERVE_PRIORITY_LABELS as PRIORITY_LABELS,
  RESERVE_STATUS_COLORS as STATUS_COLORS,
  RESERVE_STATUS_LABELS as STATUS_LABELS,
} from '@/lib/reserveLabels';
import { getReserveDescriptionText, isReserveDescriptionMissing } from '@/lib/reserveDescription';
import { detectTextLanguage, TEXT_ASSIST_LANGUAGES, textAssistAdvancedCacheKey, TextAssistContext, TextAssistLanguage } from '@/lib/textAssist';
import { requestAdvancedTranslation } from '@/lib/textAssistOnline';
import {
  ENTERPRISE_WORKFLOW_FILTERS,
  EnterpriseWorkflowFilter,
  getEnterpriseWorkflowBadges,
  getEnterpriseWorkflowStats,
  matchesEnterpriseWorkflowFilter,
} from '@/lib/reserveEnterpriseWorkflow';

function buildReservesCSV(reserves: Reserve[]): string {
  const header = 'ID,Titre,Bâtiment,Zone,Niveau,Entreprise,Priorité,Statut,Créé le,Échéance,Description';
  const rows = reserves.map(r => {
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    return [
      esc(r.id), esc(r.title), esc(`Bât. ${r.building}`), esc(r.zone), esc(r.level),
      esc((r.companies ?? (r.company ? [r.company] : [])).join('; ')), esc(PRIORITY_LABELS[r.priority] ?? r.priority), esc(STATUS_LABELS[r.status] ?? r.status),
      esc(r.createdAt), esc(r.deadline ?? '—'), esc(getReserveDescriptionText(r.description, r.title, '')),
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
  { key: 'open', label: STATUS_LABELS.open },
  { key: 'in_progress', label: STATUS_LABELS.in_progress },
  { key: 'waiting', label: STATUS_LABELS.waiting },
  { key: 'verification', label: STATUS_LABELS.verification },
  { key: 'closed', label: STATUS_LABELS.closed },
  { key: 'overdue', label: 'En retard', icon: 'warning-outline' },
];

type SortKey = 'date_desc' | 'date_asc' | 'priority' | 'deadline' | 'status';
type StatusFilterKey = 'all' | 'overdue' | ReserveStatus;
type AdvancedStatusFilterKey = StatusFilterKey | 'archived';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'date_desc', label: 'Plus récente' },
  { key: 'date_asc', label: 'Plus ancienne' },
  { key: 'priority', label: 'Priorité (critique d\'abord)' },
  { key: 'deadline', label: 'Échéance (plus proche)' },
  { key: 'status', label: 'Statut' },
];

type ViewMode = 'list' | 'grouped_status' | 'grouped_company';
type ReserveAssistantScope = 'filtered' | 'chantier' | 'selected';

const PRIORITY_ORDER: Record<ReservePriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER_MAP: Record<ReserveStatus, number> = { open: 0, in_progress: 1, waiting: 2, verification: 3, closed: 4 };

function toSortableDate(s: string): string {
  if (!s || s === '—') return '9999-99-99';
  const p = s.split('/');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : s;
}

async function generateReportPDF(action: 'share' | 'print',
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
        <td>${escapeHtml(co)}</td>
        <td style="text-align:center">${stats.total}</td>
        <td style="text-align:center;color:${C.closed}">${stats.closed}</td>
        <td style="text-align:center;color:${stats.overdue > 0 ? C.open : PDF_MUTED}">${stats.overdue}</td>
        <td style="text-align:center"><span style="background:${rate >= 80 ? '#D1FAE5' : rate >= 50 ? '#FEF3C7' : '#FEE2E2'};color:${rate >= 80 ? '#065F46' : rate >= 50 ? '#92400E' : '#991B1B'};padding:2px 8px;border-radius:10px;font-weight:bold">${rate}%</span></td>
      </tr>`;
    }).join('');

  const MAX_TOTAL_PHOTOS = 150;
  const sortedReserves = [...reserves].sort(
    (a, b) => STATUS_ORDER_MAP[a.status] - STATUS_ORDER_MAP[b.status] || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
  const maxPhotosPerReserve = sortedReserves.length === 0
    ? 0
    : Math.min(2, Math.floor(MAX_TOTAL_PHOTOS / sortedReserves.length));

  const rowsAndPhotos = await Promise.all(sortedReserves.map(async (r) => {
    const overdue = isOverdue(r.deadline, r.status);
    const lot = r.lotId ? lots.find(l => l.id === r.lotId) : null;
    const lotLabel = lot ? escapeHtml((lot.number ? `Lot ${lot.number} — ` : '') + lot.name) : '—';
    const coNames = (r.companies && r.companies.length > 0 ? r.companies : r.company ? [r.company] : ['—']);
    const row = `<tr style="${overdue ? 'background:#FFF1F2' : ''}">
      <td style="font-weight:bold;color:${PDF_BRAND_COLOR}">${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.title)}</td>
      <td>${lotLabel}</td>
      <td>${escapeHtml(formatReserveLocation(r))}</td>
      <td>${coNames.map(c => escapeHtml(c)).join(', ')}</td>
      <td><span style="background:${STATUS_COLORS[r.status]}20;color:${STATUS_COLORS[r.status]};padding:2px 8px;border-radius:8px;font-size:10px;font-weight:bold">${STATUS_LABELS[r.status]}</span></td>
      <td><span style="background:${PRIORITY_COLORS[r.priority]}20;color:${PRIORITY_COLORS[r.priority]};padding:2px 8px;border-radius:8px;font-size:10px;font-weight:bold">${PRIORITY_LABELS[r.priority]}</span></td>
      <td style="${overdue ? 'color:' + C.open + ';font-weight:bold' : ''}">${escapeHtml(r.deadline ?? '—')}</td>
    </tr>`;

    const rawPhotos = getReservePdfPhotos(r);
    const photosToShow = rawPhotos.slice(0, maxPhotosPerReserve);
    let photoHtml = '';
    if (photosToShow.length > 0) {
      const resolvedSrcs = await Promise.all(photosToShow.map(p => loadPhotoAsDataUrlForPdf(p.uri)));
      const statusColor = STATUS_COLORS[r.status] ?? PDF_BRAND_COLOR;
      photoHtml = `<div style="padding:8px 16px 12px 16px;border-bottom:1px solid #f1f5f9;background:#fff;">
        <div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:6px;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:${statusColor};color:#fff;font-weight:700;font-size:9px;margin-right:5px;">●</span>
          ${escapeHtml(r.title)} — Photos (${photosToShow.length}${rawPhotos.length > maxPhotosPerReserve ? ` sur ${rawPhotos.length}` : ''})
        </div>
        <div style="display:flex;gap:8px;flex-wrap:nowrap;">
          ${photosToShow.map((p, idx) => {
            const src = resolvedSrcs[idx] ?? p.uri;
            const isDefect = p.kind === 'defect';
            return `<div style="flex:1;min-width:0;text-align:center;max-width:200px;">
              <img src="${src}" onerror="this.style.opacity='0.15'"
                style="width:100%;height:auto;max-height:160px;object-fit:contain;background:#F9FAFB;border-radius:6px;border:1.5px solid #DDE4EE;display:block;" />
              <span style="display:inline-block;margin-top:3px;padding:1px 7px;border-radius:8px;font-size:9px;font-weight:700;
                background:${isDefect ? '#FEF2F2' : '#ECFDF5'};color:${isDefect ? '#DC2626' : '#059669'};">
                ${isDefect ? '● Constat' : '● Levée'}
              </span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }
    return { row, photoHtml };
  }));

  const reserveRows = rowsAndPhotos.map(rp => rp.row).join('');
  const photosSection = rowsAndPhotos.map(rp => rp.photoHtml).filter(Boolean).join('');

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
    ${photosSection ? `<h2>Photos des réserves</h2><div style="border:1px solid #DDE4EE;border-radius:8px;overflow:hidden;">${photosSection}</div>` : ''}
  </div></body></html>`;

  if (action === 'print') {
    await printPDFHelper(html, buildPdfFilename('Rapport_Reserves', [chantierName]));
  } else {
    await exportPDFHelper(html, buildPdfFilename('Rapport_Reserves', [chantierName]));
  }
}

export default function ReservesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { company: companyParam } = useLocalSearchParams<{ company?: string }>();
  const { reserves, companies, isLoading, chantiers, activeChantierId, lots, batchUpdateReserves, updateReserveFields, updateReserveStatus, deleteReserve, archiveReserve, unarchiveReserve, addComment, addReserve, reload, sitePlans, photos } = useApp();
  const { permissions, user } = useAuth();

  const isSousTraitant = user?.role === 'sous_traitant';
  const canUseReserveAssistant = user?.role === 'admin' || user?.role === 'super_admin';
  const canTrackEnterpriseWorkflow = permissions.canEdit && !isSousTraitant;
  const sousTraitantCompanyName = isSousTraitant && user?.companyId
    ? companies.find(c => c.id === user.companyId)?.name ?? null
    : null;

  const [chantierFilter, setChantierFilter] = useState<string>(activeChantierId ?? 'all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>('all');
  const [enterpriseFilter, setEnterpriseFilter] = useState<EnterpriseWorkflowFilter>('all');
  const [kindFilter, setKindFilter] = useState<'all' | ReserveKind>('all');
  const [pinFilter, setPinFilter] = useState<'all' | 'pinned' | 'unpinned'>('all');
  const [buildingFilter, setBuildingFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | ReservePriority>('all');
  const [companyFilter, setCompanyFilter] = useState<string>(companyParam ?? 'all');
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [lotFilter, setLotFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date_desc');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [actionsModalVisible, setActionsModalVisible] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [viewModeModalVisible, setViewModeModalVisible] = useState(false);

  const statusFilters = useMemo(
    () => ([
      { key: 'all' as const, label: t('reservesScreen.all') },
      { key: 'open' as const, label: t('reserveLabels.status.open') },
      { key: 'in_progress' as const, label: t('reserveLabels.status.in_progress') },
      { key: 'waiting' as const, label: t('reserveLabels.status.waiting') },
      { key: 'verification' as const, label: t('reserveLabels.status.verification') },
      { key: 'closed' as const, label: t('reserveLabels.status.closed') },
      { key: 'overdue' as const, label: t('reservesScreen.statuses.overdue'), icon: 'warning-outline' },
    ] satisfies { key: StatusFilterKey; label: string; icon?: string }[]),
    [t],
  );
  const statusLabelEntries = useMemo(
    () => (['open', 'in_progress', 'waiting', 'verification', 'closed'] as ReserveStatus[])
      .map(status => [status, t(`reserveLabels.status.${status}`)] as [ReserveStatus, string]),
    [t],
  );
  const sortOptions = useMemo(
    () => ([
      { key: 'date_desc' as const, label: t('reservesScreen.sortOptions.dateDesc', { defaultValue: 'Plus récente' }) },
      { key: 'date_asc' as const, label: t('reservesScreen.sortOptions.dateAsc', { defaultValue: 'Plus ancienne' }) },
      { key: 'priority' as const, label: t('reservesScreen.sortOptions.priority', { defaultValue: "Priorité (critique d'abord)" }) },
      { key: 'deadline' as const, label: t('reservesScreen.sortOptions.deadline', { defaultValue: 'Échéance (plus proche)' }) },
      { key: 'status' as const, label: t('reservesScreen.sortOptions.status', { defaultValue: 'Statut' }) },
    ] satisfies { key: SortKey; label: string }[]),
    [t],
  );

  const topPad = insets.top;
  const { width, height: windowHeight } = useWindowDimensions();
  const isWideScreen = width >= 768;
  const filterSheetBottomGap = Math.max(insets.bottom, Platform.OS === 'android' ? 56 : 8);
  const filterFooterBottomPadding = Platform.OS === 'android'
    ? Math.max(insets.bottom, 30)
    : Math.max(insets.bottom + 14, 28);
  const filterSheetHeight = Math.min(
    windowHeight - filterSheetBottomGap,
    Math.max(420, windowHeight - topPad - filterSheetBottomGap - 8),
  );
  const assistantSheetBottomGap = Math.max(insets.bottom, Platform.OS === 'android' ? 56 : 8);
  const assistantSheetHeight = Math.min(
    windowHeight - assistantSheetBottomGap,
    Math.max(420, windowHeight - topPad - assistantSheetBottomGap - 8),
  );
  const assistantSheetBottomPadding = Platform.OS === 'android' ? 14 : Math.max(insets.bottom, 16);
  const [selectedReserveId, setSelectedReserveId] = useState<string | null>(null);
  const [nearDeadlineOnly, setNearDeadlineOnly] = useState(false);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pdfExportModalVisible, setPdfExportModalVisible] = useState(false);
  const [pdfExportMode, setPdfExportMode] = useState<'all' | 'company_single' | 'company_multi' | 'company_none' | 'manual'>('all');
  const [pdfCompanySingle, setPdfCompanySingle] = useState<string>('');
  const [pdfCompaniesMulti, setPdfCompaniesMulti] = useState<Set<string>>(new Set());
  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [batchAction, setBatchAction] = useState<'status' | 'company' | 'deadline' | 'delete' | null>(null);
  const [batchStatus, setBatchStatus] = useState<ReserveStatus>('in_progress');
  const [batchCompany, setBatchCompany] = useState('');
  const [batchDeadline, setBatchDeadline] = useState('');
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [assistantScope, setAssistantScope] = useState<ReserveAssistantScope>('filtered');
  const [assistantTargetLanguage, setAssistantTargetLanguage] = useState<TextAssistLanguage>('fr');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantProgress, setAssistantProgress] = useState({ done: 0, total: 0, label: '' });

  const [quickStatusReserve, setQuickStatusReserve] = useState<Reserve | null>(null);
  const [quickStatusVisible, setQuickStatusVisible] = useState(false);

  const [contextMenuReserve, setContextMenuReserve] = useState<Reserve | null>(null);
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextStatusSubVisible, setContextStatusSubVisible] = useState(false);

  const [flashId, setFlashId] = useState<string | null>(null);

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
  const [emailReportModalVisible, setEmailReportModalVisible] = useState(false);
  const [emailReportTo, setEmailReportTo] = useState('');
  const [emailReportLoading, setEmailReportLoading] = useState(false);

  // Toggle pour afficher les archives. Désactivé par défaut : les réserves
  // archivées sont masquées de la liste principale et apparaissent seulement
  // quand l'utilisateur clique sur la bannière "X réserves archivées".
  const [showArchived, setShowArchived] = useState(false);

  // Toggle compact : masque la barre de progression et le bandeau d'échéance
  // pour libérer de l'espace vertical sur mobile. Persisté localement.
  const HEADER_COMPACT_KEY = 'reserves_header_compact_v1';
  const [headerCompact, setHeaderCompact] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(HEADER_COMPACT_KEY)
      .then(v => { if (v === '1') setHeaderCompact(true); })
      .catch(() => {});
  }, []);
  const toggleHeaderCompact = useCallback(() => {
    setHeaderCompact(prev => {
      const next = !prev;
      AsyncStorage.setItem(HEADER_COMPACT_KEY, next ? '1' : '0').catch(() => {});
      return next;
    });
  }, []);

  const chantierReserves = useMemo(() => {
    let list = chantierFilter === 'all' ? reserves : reserves.filter(r => r.chantierId === chantierFilter);
    if (isSousTraitant && sousTraitantCompanyName) {
      list = list.filter(r => {
        const names = r.companies ?? (r.company ? [r.company] : []);
        return names.includes(sousTraitantCompanyName!);
      });
    }
    // Filtre archives : par défaut on cache, sinon on n'affiche QUE les archives
    list = showArchived
      ? list.filter(r => !!r.archivedAt)
      : list.filter(r => !r.archivedAt);
    return list;
  }, [reserves, chantierFilter, isSousTraitant, sousTraitantCompanyName, showArchived]);

  // Compteur d'archives (basé sur la sélection de chantier mais ignorant le toggle).
  const archivedCount = useMemo(() => {
    let list = chantierFilter === 'all' ? reserves : reserves.filter(r => r.chantierId === chantierFilter);
    if (isSousTraitant && sousTraitantCompanyName) {
      list = list.filter(r => {
        const names = r.companies ?? (r.company ? [r.company] : []);
        return names.includes(sousTraitantCompanyName!);
      });
    }
    return list.filter(r => !!r.archivedAt).length;
  }, [reserves, chantierFilter, isSousTraitant, sousTraitantCompanyName]);

  const enterpriseWorkflowReserves = useMemo(() => {
    let list = chantierFilter === 'all' ? reserves : reserves.filter(r => r.chantierId === chantierFilter);
    if (isSousTraitant && sousTraitantCompanyName) {
      list = list.filter(r => {
        const names = r.companies ?? (r.company ? [r.company] : []);
        return names.includes(sousTraitantCompanyName!);
      });
    }
    return list.filter(r => !r.archivedAt);
  }, [reserves, chantierFilter, isSousTraitant, sousTraitantCompanyName]);

  const chantiersWithPlans = useMemo(
    () => new Set(sitePlans.map(p => p.chantierId).filter(Boolean)),
    [sitePlans]
  );

  const activeSitePlans = useMemo(
    () => sitePlans.filter(p => p.chantierId === activeChantierId),
    [sitePlans, activeChantierId]
  );

  const nearDeadlineReserves = useMemo(
    () => chantierReserves.filter(r => isDueSoon(r.deadline, r.status, 3)),
    [chantierReserves]
  );

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

  async function handleExportPDFForList(list: Reserve[], action: 'share' | 'print' = 'share') {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const chantierName = chantierFilter !== 'all'
        ? chantiers.find(c => c.id === chantierFilter)?.name ?? 'Chantier'
        : 'Tous les chantiers';
      await generateReportPDF(action, enrichReserveListForPdf(list, photos), chantierName, lots);
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

  const levels = useMemo(() => {
    const l = new Set(chantierReserves.map(r => r.level).filter(Boolean));
    return Array.from(l).sort(compareLevels);
  }, [chantierReserves]);

  const activeFilterCount = (buildingFilter !== 'all' ? 1 : 0)
    + (priorityFilter !== 'all' ? 1 : 0)
    + (companyFilter !== 'all' ? 1 : 0)
    + (zoneFilter !== 'all' ? 1 : 0)
    + (levelFilter !== 'all' ? 1 : 0)
    + (kindFilter !== 'all' ? 1 : 0)
    + (lotFilter !== 'all' ? 1 : 0)
    + (statusFilter !== 'all' ? 1 : 0)
    + (canTrackEnterpriseWorkflow && enterpriseFilter !== 'all' ? 1 : 0)
    + (showArchived ? 1 : 0)
    + (nearDeadlineOnly ? 1 : 0)
    + (pinFilter !== 'all' ? 1 : 0);

  const overdueCount = useMemo(
    () => chantierReserves.filter(r => isOverdue(r.deadline, r.status)).length,
    [chantierReserves]
  );

  const enterpriseWorkflowStats = useMemo(
    () => getEnterpriseWorkflowStats(enterpriseWorkflowReserves),
    [enterpriseWorkflowReserves]
  );
  const activeEnterpriseWorkflowFilter = useMemo(
    () => ENTERPRISE_WORKFLOW_FILTERS.find(f => f.key === enterpriseFilter) ?? ENTERPRISE_WORKFLOW_FILTERS[0],
    [enterpriseFilter]
  );
  const hasEnterpriseWorkflowAttention = enterpriseWorkflowStats.needs_validation > 0 || enterpriseWorkflowStats.ack_missing > 0;
  const showEnterpriseWorkflowSummary =
    canTrackEnterpriseWorkflow &&
    enterpriseWorkflowReserves.length > 0 &&
    !isLoading &&
    !headerCompact &&
    !showArchived &&
    (hasEnterpriseWorkflowAttention || enterpriseFilter !== 'all');

  function applyAdvancedStatusFilter(key: AdvancedStatusFilterKey) {
    if (key === 'archived') {
      setShowArchived(true);
      setStatusFilter('all');
      setEnterpriseFilter('all');
      setNearDeadlineOnly(false);
      return;
    }
    setShowArchived(false);
    setStatusFilter(key);
    if (key !== 'overdue') setNearDeadlineOnly(false);
  }

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
      const matchLevel = levelFilter === 'all' || r.level === levelFilter;
      const matchLot = lotFilter === 'all' || r.lotId === lotFilter;
      const q = debouncedSearch.toLowerCase();
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
      const matchPin =
        pinFilter === 'all' ? true :
        pinFilter === 'pinned' ? (r.planId != null && r.planX != null && r.planY != null) :
        /* unpinned */ chantiersWithPlans.has(r.chantierId ?? '') && (r.planId == null || r.planX == null || r.planY == null);
      const matchEnterpriseWorkflow =
        !canTrackEnterpriseWorkflow ||
        enterpriseFilter === 'all' ||
        matchesEnterpriseWorkflowFilter(r, enterpriseFilter);
      return matchStatus && matchKind && matchBuilding && matchPriority && matchCompany && matchZone && matchLevel && matchLot && matchSearch && matchNearDeadline && matchPin && matchEnterpriseWorkflow;
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
  }, [chantierReserves, statusFilter, kindFilter, buildingFilter, priorityFilter, companyFilter, zoneFilter, levelFilter, lotFilter, sortKey, debouncedSearch, nearDeadlineOnly, lots, pinFilter, chantiersWithPlans, canTrackEnterpriseWorkflow, enterpriseFilter]);

  const assistantTargetReserves = useMemo(() => {
    if (assistantScope === 'selected') {
      return chantierReserves.filter(r => selectedIds.has(r.id));
    }
    if (assistantScope === 'chantier') return chantierReserves;
    return filtered;
  }, [assistantScope, chantierReserves, filtered, selectedIds]);

  const assistantScopeOptions = useMemo(() => ([
    { key: 'filtered' as const, label: 'Vue actuelle', count: filtered.length, icon: 'funnel-outline' },
    { key: 'chantier' as const, label: chantierFilter === 'all' ? 'Tous chantiers' : 'Chantier', count: chantierReserves.length, icon: 'business-outline' },
    { key: 'selected' as const, label: 'Sélection', count: selectedIds.size, icon: 'checkbox-outline' },
  ]), [chantierFilter, chantierReserves.length, filtered.length, selectedIds.size]);

  const missingDescriptionReserves = useMemo(
    () => assistantTargetReserves.filter(r => r.title.trim().length > 0 && isReserveDescriptionMissing(r.description)),
    [assistantTargetReserves]
  );

  const currentMissingDescriptionCount = useMemo(
    () => chantierReserves.filter(r => r.title.trim().length > 0 && isReserveDescriptionMissing(r.description)).length,
    [chantierReserves]
  );

  const translationCandidateCount = useMemo(
    () => assistantTargetReserves.filter(r =>
      r.title.trim() ||
      getReserveDescriptionText(r.description, r.title, '').trim() ||
      (r.comments ?? []).some(c => c.content.trim())
    ).length,
    [assistantTargetReserves]
  );

  const selectedAssistantLanguage = TEXT_ASSIST_LANGUAGES.find(l => l.code === assistantTargetLanguage) ?? TEXT_ASSIST_LANGUAGES[0];

  const translateBulkText = useCallback(async (
    value: string,
    target: TextAssistLanguage,
    context: TextAssistContext,
  ) => {
    const clean = value.trim();
    if (!clean) return value;
    const source = detectTextLanguage(clean);
    if (source === target) return value;
    const cacheKey = textAssistAdvancedCacheKey(clean, target, source);
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) return cached;
    const translated = await requestAdvancedTranslation({
      text: clean,
      target,
      source,
      context,
      timeoutMs: 9000,
    });
    if (!translated?.text) return value;
    AsyncStorage.setItem(cacheKey, translated.text).catch(() => {});
    return translated.text;
  }, []);

  const runFillMissingDescriptions = useCallback(async () => {
    const targets = missingDescriptionReserves;
    if (targets.length === 0 || assistantBusy) return;
    setAssistantBusy(true);
    setAssistantProgress({ done: 0, total: targets.length, label: 'Descriptions' });
    try {
      for (let i = 0; i < targets.length; i += 1) {
        const reserve = targets[i];
        const titleText = reserve.title.trim();
        if (titleText) {
          const updated: Reserve = {
            ...reserve,
            description: titleText,
            history: [
              ...reserve.history,
              {
                id: genId(),
                action: 'Description complétée',
                author: user?.name ?? 'Système',
                createdAt: nowTimestampFR(),
                newValue: 'Titre copié dans la description',
              },
            ],
          };
          await Promise.resolve(updateReserveFields(updated) as any);
        }
        setAssistantProgress({ done: i + 1, total: targets.length, label: 'Descriptions' });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Descriptions complétées', `${targets.length} description${targets.length > 1 ? 's' : ''} mise${targets.length > 1 ? 's' : ''} à jour.`);
    } finally {
      setAssistantBusy(false);
    }
  }, [assistantBusy, missingDescriptionReserves, updateReserveFields, user?.name]);

  const confirmFillMissingDescriptions = useCallback(() => {
    if (missingDescriptionReserves.length === 0) {
      Alert.alert('Aucune action nécessaire', 'Aucune réserve sans description dans le périmètre choisi.');
      return;
    }
    Alert.alert(
      'Compléter les descriptions',
      `Copier le titre dans la description pour ${missingDescriptionReserves.length} réserve${missingDescriptionReserves.length > 1 ? 's' : ''}. Les descriptions existantes ne seront pas modifiées.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Appliquer', onPress: () => void runFillMissingDescriptions() },
      ],
    );
  }, [missingDescriptionReserves.length, runFillMissingDescriptions]);

  const runTranslateReserves = useCallback(async () => {
    const targets = assistantTargetReserves.filter(r =>
      r.title.trim() ||
      getReserveDescriptionText(r.description, r.title, '').trim() ||
      (r.comments ?? []).some(c => c.content.trim())
    );
    if (targets.length === 0 || assistantBusy) return;
    setAssistantBusy(true);
    setAssistantProgress({ done: 0, total: targets.length, label: `Traduction ${selectedAssistantLanguage.label}` });
    let updatedCount = 0;
    let failedCount = 0;
    try {
      for (let i = 0; i < targets.length; i += 1) {
        const reserve = targets[i];
        try {
          const title = await translateBulkText(reserve.title, assistantTargetLanguage, 'description');
          const descriptionWasMissing = isReserveDescriptionMissing(reserve.description);
          const description = descriptionWasMissing
            ? title
            : await translateBulkText(reserve.description, assistantTargetLanguage, 'description');
          const comments = await Promise.all((reserve.comments ?? []).map(async comment => ({
            ...comment,
            content: await translateBulkText(comment.content, assistantTargetLanguage, 'comment'),
          })));
          const changed =
            title !== reserve.title ||
            description !== reserve.description ||
            comments.some((comment, index) => comment.content !== reserve.comments[index]?.content);
          if (changed) {
            const updated: Reserve = {
              ...reserve,
              title,
              description,
              comments,
              history: [
                ...reserve.history,
                {
                  id: genId(),
                  action: 'Traduction groupée',
                  author: user?.name ?? 'Système',
                  createdAt: nowTimestampFR(),
                  newValue: selectedAssistantLanguage.title,
                },
              ],
            };
            await Promise.resolve(updateReserveFields(updated) as any);
            updatedCount += 1;
          }
        } catch (error: any) {
          console.warn('[reserves-assistant] Translation failed:', error?.message ?? error);
          failedCount += 1;
        } finally {
          setAssistantProgress({ done: i + 1, total: targets.length, label: `Traduction ${selectedAssistantLanguage.label}` });
        }
      }
      if (failedCount > 0) {
        Alert.alert(
          'Traduction partielle',
          `${updatedCount} réserve${updatedCount > 1 ? 's' : ''} traduite${updatedCount > 1 ? 's' : ''}. ${failedCount} échec${failedCount > 1 ? 's' : ''}, vérifiez la configuration Azure ou la connexion.`,
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('Traduction terminée', `${updatedCount} réserve${updatedCount > 1 ? 's' : ''} mise${updatedCount > 1 ? 's' : ''} à jour en ${selectedAssistantLanguage.title}.`);
      }
    } finally {
      setAssistantBusy(false);
    }
  }, [assistantBusy, assistantTargetLanguage, assistantTargetReserves, selectedAssistantLanguage, translateBulkText, updateReserveFields, user?.name]);

  const confirmTranslateReserves = useCallback(() => {
    if (translationCandidateCount === 0) {
      Alert.alert('Aucun texte à traduire', 'Aucune réserve avec titre, description ou commentaire dans le périmètre choisi.');
      return;
    }
    Alert.alert(
      'Traduction groupée',
      `Cette action remplacera les titres, descriptions et commentaires de ${translationCandidateCount} réserve${translationCandidateCount > 1 ? 's' : ''} par une version ${selectedAssistantLanguage.title}. Les entreprises, statuts, priorités et localisations ne seront pas modifiés.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: `Traduire en ${selectedAssistantLanguage.label}`, onPress: () => void runTranslateReserves() },
      ],
    );
  }, [runTranslateReserves, selectedAssistantLanguage, translationCandidateCount]);

  const isSansEntrepriseReserve = useCallback((r: Reserve) => {
    const names = r.companies ?? (r.company ? [r.company] : []);
    return names.length === 0;
  }, []);

  const handleConfirmPdfExport = useCallback(async (action: 'share' | 'print' = 'share') => {
    if (pdfExportMode === 'all') {
      setPdfExportModalVisible(false);
      await handleExportPDFForList(filtered, action);
      return;
    }

    if (pdfExportMode === 'company_none') {
      const list = filtered.filter(isSansEntrepriseReserve);
      if (list.length === 0) return;
      setPdfExportModalVisible(false);
      await handleExportPDFForList(list, action);
      return;
    }

    if (pdfExportMode === 'company_single') {
      const companyName = pdfCompanySingle;
      if (!companyName) return;
      const list = companyName === '—'
        ? filtered.filter(isSansEntrepriseReserve)
        : filtered.filter(r => (r.companies ?? (r.company ? [r.company] : [])).includes(companyName));
      if (list.length === 0) return;
      setPdfExportModalVisible(false);
      await handleExportPDFForList(list, action);
      return;
    }

    if (pdfExportMode === 'company_multi') {
      const selected = Array.from(pdfCompaniesMulti);
      if (selected.length === 0) return;
      const list = filtered.filter(r => {
        if (selected.includes('—') && isSansEntrepriseReserve(r)) return true;
        const names = r.companies ?? (r.company ? [r.company] : []);
        return selected.some(cn => cn !== '—' && names.includes(cn));
      });
      if (list.length === 0) return;
      setPdfExportModalVisible(false);
      await handleExportPDFForList(list, action);
      return;
    }

    // manual
    setPdfExportModalVisible(false);
    setIsSelectMode(true);
    setSelectedIds(new Set());
  }, [filtered, handleExportPDFForList, pdfCompaniesMulti, pdfCompanySingle, pdfExportMode]);

  const groupedByStatus = useMemo(() => {
    const ORDER: ReserveStatus[] = ['open', 'in_progress', 'waiting', 'verification', 'closed'];
    return ORDER.map(s => {
      const data = filtered.filter(r => r.status === s);
      return { title: t(`reserveLabels.status.${s}`), key: s, data, color: STATUS_COLORS[s] };
    }).filter(s => s.data.length > 0);
  }, [filtered, t]);

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

  const getSelectedReservesForEmail = useCallback((): Reserve[] => {
    if (pdfExportMode === 'all') return filtered;
    if (pdfExportMode === 'company_none') return filtered.filter(isSansEntrepriseReserve);
    if (pdfExportMode === 'company_single') {
      if (!pdfCompanySingle) return [];
      return pdfCompanySingle === '—'
        ? filtered.filter(isSansEntrepriseReserve)
        : filtered.filter(r => (r.companies ?? (r.company ? [r.company] : [])).includes(pdfCompanySingle));
    }
    if (pdfExportMode === 'company_multi') {
      const selected = Array.from(pdfCompaniesMulti);
      if (selected.length === 0) return [];
      return filtered.filter(r => {
        if (selected.includes('—') && isSansEntrepriseReserve(r)) return true;
        const names = r.companies ?? (r.company ? [r.company] : []);
        return selected.some(cn => cn !== '—' && names.includes(cn));
      });
    }
    return filtered;
  }, [filtered, isSansEntrepriseReserve, pdfCompaniesMulti, pdfCompanySingle, pdfExportMode]);

  const handleSendReservesReport = useCallback(async () => {
    const emails = emailReportTo.split(/[,;\s]+/).map(e => e.trim()).filter(e => e.includes('@'));
    if (emails.length === 0) {
      Alert.alert('Email requis', 'Entrez au moins une adresse email valide.');
      return;
    }
    const list = enrichReserveListForPdf(getSelectedReservesForEmail(), photos);
    if (list.length === 0) {
      Alert.alert('Aucune réserve', 'Aucune réserve à exporter avec cette sélection.');
      return;
    }
    const localOnlyPhotoCount = countLocalOnlyReservePhotos(list);
    if (localOnlyPhotoCount > 0) {
      const shouldContinue = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Photos non synchronisées',
          `${localOnlyPhotoCount} photo${localOnlyPhotoCount > 1 ? 's' : ''} locale${localOnlyPhotoCount > 1 ? 's' : ''} ne ${localOnlyPhotoCount > 1 ? 'seront' : 'sera'} pas incluse${localOnlyPhotoCount > 1 ? 's' : ''} dans le PDF envoyé par email tant que la synchronisation n'est pas terminée.`,
          [
            { text: 'Attendre la sync', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Envoyer quand même', onPress: () => resolve(true) },
          ],
        );
      });
      if (!shouldContinue) return;
    }
    setEmailReportLoading(true);
    try {
      const chantierName = chantierFilter !== 'all'
        ? chantiers.find(c => c.id === chantierFilter)?.name ?? 'Chantier'
        : 'Tous les chantiers';
      const companyFilter = pdfExportMode === 'company_single' && pdfCompanySingle
        ? pdfCompanySingle
        : null;
      const reservesPayload = list.map(r => {
        const remotePhotos = getRemoteReservePhotosForPdf(r, 2);
        return {
          id: r.id,
          title: r.title,
          company: r.company ?? '',
          companies: r.companies,
          building: r.building ?? undefined,
          level: r.level ?? undefined,
          zone: r.zone ?? undefined,
          status: r.status,
          priority: r.priority,
          deadline: r.deadline ?? undefined,
          description: getReserveDescriptionText(r.description, r.title, ''),
          photos: remotePhotos.photos.map(p => ({ uri: p.uri })),
        };
      });
      const result = await generateAndSendReservesReport({
        chantierName,
        companyFilter,
        generatedAt: new Date().toISOString(),
        reserves: reservesPayload,
        recipients: emails,
        sendByEmail: true,
      });
      if (!result.success) {
        Alert.alert('Erreur', result.error ?? "Impossible de générer le rapport.");
        return;
      }
      if (result.pdfBase64) {
        try {
          const filename = buildPdfFilename('Rapport_Reserves', [chantierName]);
          const fileUri = (FileSystem.cacheDirectory ?? '') + filename;
          await FileSystem.writeAsStringAsync(fileUri, result.pdfBase64, { encoding: FileSystem.EncodingType.Base64 });
          const canShare = await Sharing.isAvailableAsync();
          if (canShare) {
            setEmailReportModalVisible(false);
            setPdfExportModalVisible(false);
            setEmailReportTo('');
            await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf', dialogTitle: filename, UTI: 'com.adobe.pdf' });
            return;
          }
        } catch (saveErr) {
          console.warn('[Email Report] Erreur sauvegarde locale:', saveErr);
        }
      }
      const count = list.length;
      Alert.alert('✓ Rapport envoyé', `Le rapport (${count} réserve${count !== 1 ? 's' : ''}) a bien été envoyé à :\n${emails.join('\n')}`);
      setEmailReportModalVisible(false);
      setPdfExportModalVisible(false);
      setEmailReportTo('');
    } catch (err: any) {
      Alert.alert('Erreur', err?.message ?? "Impossible d'envoyer le rapport.");
    } finally {
      setEmailReportLoading(false);
    }
  }, [emailReportTo, getSelectedReservesForEmail, photos, chantierFilter, chantiers, pdfExportMode, pdfCompanySingle]);

  const pdfPreviewCount = useMemo(() => {
    if (pdfExportMode === 'all') return filtered.length;
    if (pdfExportMode === 'company_none') return filtered.filter(isSansEntrepriseReserve).length;
    if (pdfExportMode === 'company_single') {
      if (!pdfCompanySingle) return 0;
      if (pdfCompanySingle === '—') return filtered.filter(isSansEntrepriseReserve).length;
      return filtered.filter(r => (r.companies ?? (r.company ? [r.company] : [])).includes(pdfCompanySingle)).length;
    }
    if (pdfExportMode === 'company_multi') {
      if (pdfCompaniesMulti.size === 0) return 0;
      const selected = Array.from(pdfCompaniesMulti);
      return filtered.filter(r => {
        if (selected.includes('—') && isSansEntrepriseReserve(r)) return true;
        const names = r.companies ?? (r.company ? [r.company] : []);
        return selected.some(cn => cn !== '—' && names.includes(cn));
      }).length;
    }
    return 0;
  }, [filtered, isSansEntrepriseReserve, pdfCompaniesMulti, pdfCompanySingle, pdfExportMode]);

  const isSortActive = sortKey !== 'date_desc';
  const obsCount = useMemo(() => chantierReserves.filter(r => r.kind === 'observation').length, [chantierReserves]);
  const closedCount = useMemo(() => chantierReserves.filter(r => r.status === 'closed').length, [chantierReserves]);
  const progressPct = chantierReserves.length > 0 ? Math.round((closedCount / chantierReserves.length) * 100) : 0;
  const selectedReserve = useMemo(
    () => filtered.find(r => r.id === selectedReserveId) ?? null,
    [filtered, selectedReserveId]
  );
  const hasReserveActions =
    (permissions.canExport && filtered.length > 0) ||
    (permissions.canEdit && filtered.length > 0) ||
    (canUseReserveAssistant && chantierReserves.length > 0) ||
    chantierReserves.length > 0;

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

  const closeFabMenu = useCallback(() => {
    setFabOpen(false);
    Animated.spring(fabAnim, { toValue: 0, useNativeDriver: true, tension: 60, friction: 10 }).start();
  }, [fabAnim]);

  const openPdfExportModal = useCallback(() => {
    setPdfExportMode('all');
    setPdfCompanySingle('');
    setPdfCompaniesMulti(new Set());
    setPdfExportModalVisible(true);
  }, []);

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
    if (batchAction === 'deadline' && batchDeadline) {
      if (!validateDeadline(batchDeadline)) {
        Alert.alert('Date invalide', "Vérifiez que le jour, le mois et l'année sont corrects (ex : 30/04/2026).");
        return;
      }
      updates.deadline = batchDeadline;
    }
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
    setLevelFilter('all');
    setKindFilter('all');
    setLotFilter('all');
    setStatusFilter('all');
    setEnterpriseFilter('all');
    setShowArchived(false);
    setNearDeadlineOnly(false);
    setPinFilter('all');
  }

  function handleQuickStatusChange(reserve: Reserve) {
    setQuickStatusReserve(reserve);
    setQuickStatusVisible(true);
  }

  function applyQuickStatus(newStatus: ReserveStatus) {
    if (!quickStatusReserve) return;
    const id = quickStatusReserve.id;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    updateReserveStatus(id, newStatus, user?.name ?? 'Conducteur de travaux');
    setQuickStatusVisible(false);
    setQuickStatusReserve(null);
    setFlashId(id);
    setTimeout(() => setFlashId(null), 900);
  }

  function handleContextMenu(reserve: Reserve) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setContextMenuReserve(reserve);
    setContextStatusSubVisible(false);
    setContextMenuVisible(true);
  }

  function handleContextStatusApply(newStatus: ReserveStatus) {
    if (!contextMenuReserve) return;
    const id = contextMenuReserve.id;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    updateReserveStatus(id, newStatus, user?.name ?? 'Conducteur de travaux');
    setContextMenuVisible(false);
    setContextMenuReserve(null);
    setContextStatusSubVisible(false);
    setFlashId(id);
    setTimeout(() => setFlashId(null), 900);
  }

  function handleContextDuplicate(reserve: Reserve) {
    setContextMenuVisible(false);
    setContextMenuReserve(null);
    const lot = reserve.lotId ? (lots.find(l => l.id === reserve.lotId) ?? null) : null;
    const newId = genReserveId(reserves, lot);
    const newR: Reserve = {
      ...reserve,
      id: newId,
      title: `${reserve.title} (copie)`,
      status: 'open',
      createdAt: new Date().toLocaleDateString('fr-FR'),
      deadline: '—',
      comments: [],
      photos: [],
      photoUri: undefined,
      history: [{
        id: genId(),
        action: 'Réserve dupliquée',
        author: user?.name ?? 'Système',
        createdAt: nowTimestampFR(),
        oldValue: reserve.id,
        newValue: newId,
      }],
      archivedAt: undefined,
      archivedBy: undefined,
      closedAt: undefined,
      closedBy: undefined,
      enterpriseAcknowledgedAt: undefined,
      enterpriseSignature: undefined,
      enterpriseSignataire: undefined,
      companySignatures: undefined,
      visiteId: undefined,
      linkedTaskId: undefined,
    };
    addReserve(newR);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  function handleContextDelete(reserve: Reserve) {
    setContextMenuVisible(false);
    setContextMenuReserve(null);
    Alert.alert(
      'Supprimer cette réserve',
      `Supprimer "${reserve.title}" ? Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            deleteReserve(reserve.id);
          },
        },
      ]
    );
  }

  function handleSwipeLeft(reserve: Reserve) {
    const isArchived = !!reserve.archivedAt;
    if (isArchived) {
      Alert.alert(
        'Désarchiver cette réserve',
        `Remettre "${reserve.title}" dans les réserves actives ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Désarchiver', onPress: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              unarchiveReserve(reserve.id, user?.name ?? 'Conducteur de travaux');
            },
          },
        ]
      );
    } else {
      Alert.alert(
        'Archiver cette réserve',
        `Mettre "${reserve.title}" de côté ? La réserve sera masquée du plan et de la liste, mais restera consultable depuis les archives. Son statut (${reserve.status === 'closed' ? 'Clôturé' : reserve.status === 'open' ? 'Ouvert' : reserve.status === 'in_progress' ? 'En cours' : reserve.status === 'waiting' ? 'En attente' : 'Vérification'}) ne change pas.`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Archiver', onPress: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              archiveReserve(reserve.id, user?.name ?? 'Conducteur de travaux');
            },
          },
        ]
      );
    }
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

  const renderCard = (item: Reserve) => {
    const hasPlansAvailable = chantiersWithPlans.has(item.chantierId ?? '');
    return (
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
            onLongPress={permissions.canEdit ? handleContextMenu : undefined}
            onSwipeRight={permissions.canEdit ? handleQuickStatusChange : undefined}
            onSwipeLeft={permissions.canEdit ? handleSwipeLeft : undefined}
            selected={item.id === selectedReserveId}
            isFlashed={item.id === flashId}
            hasPlansAvailable={hasPlansAvailable}
            showEnterpriseTracking={canTrackEnterpriseWorkflow}
          />
        </View>
      </View>
    );
  };

  const listEmpty = (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        {chantierReserves.length === 0
          ? <Ionicons name="document-text-outline" size={40} color={C.primary} />
          : <Ionicons name="funnel-outline" size={40} color={C.primary} />}
      </View>
      <Text style={styles.emptyText}>
        {chantierReserves.length === 0 ? t('reservesScreen.empty.noReserve') : t('reservesScreen.empty.noResult')}
      </Text>
      <Text style={styles.emptyHint}>
        {chantierReserves.length === 0
          ? t('reservesScreen.empty.createReserve')
          : t('reservesScreen.empty.resetFilters')}
      </Text>
      {chantierReserves.length === 0 && permissions.canCreate && (
        <TouchableOpacity
          style={styles.emptyBtn}
          onPress={toggleFab}
        >
          <Ionicons name="add-circle-outline" size={16} color="#fff" />
          <Text style={styles.emptyBtnText}>{t('reservesScreen.empty.createReserve')}</Text>
        </TouchableOpacity>
      )}
      {chantierReserves.length > 0 && (
        <TouchableOpacity style={styles.emptyBtnSecondary} onPress={resetAllFilters}>
          <Text style={styles.emptyBtnSecondaryText}>{t('reservesScreen.empty.resetFilters')}</Text>
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

  if (!isLoading && !activeChantierId) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: topPad + 12 }]}>
          <Text style={styles.title}>{t('reservesScreen.title')}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.emptyChantierState} showsVerticalScrollIndicator={false}>

          <View style={styles.emptyChantierIconWrap}>
            <Ionicons name="clipboard-outline" size={44} color={C.primary} />
          </View>

          <Text style={styles.emptyChantierTitle}>{t('reservesScreen.emptyProjectTitle')}</Text>
          <Text style={styles.emptyChantierSubtitle}>
            {t('reservesScreen.emptyProjectHint')}
          </Text>

          <View style={styles.emptyChantierFeatures}>
            <View style={styles.emptyChantierFeatureRow}>
              <View style={[styles.emptyChantierFeatureDot, { backgroundColor: '#003082' }]}>
                <Ionicons name="alert-circle-outline" size={14} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.emptyChantierFeatureTitle}>{t('reservesScreen.features.trackingTitle')}</Text>
                <Text style={styles.emptyChantierFeatureDesc}>{t('reservesScreen.features.trackingText')}</Text>
              </View>
            </View>
            <View style={styles.emptyChantierFeatureRow}>
              <View style={[styles.emptyChantierFeatureDot, { backgroundColor: '#059669' }]}>
                <Ionicons name="people-outline" size={14} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.emptyChantierFeatureTitle}>{t('reservesScreen.features.companiesTitle')}</Text>
                <Text style={styles.emptyChantierFeatureDesc}>{t('reservesScreen.features.companiesText')}</Text>
              </View>
            </View>
            <View style={styles.emptyChantierFeatureRow}>
              <View style={[styles.emptyChantierFeatureDot, { backgroundColor: '#7C3AED' }]}>
                <Ionicons name="document-text-outline" size={14} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.emptyChantierFeatureTitle}>{t('reservesScreen.features.exportsTitle')}</Text>
                <Text style={styles.emptyChantierFeatureDesc}>{t('reservesScreen.features.exportsText')}</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.emptyChantierBtn} onPress={() => router.push('/chantier/new' as any)}>
            <Ionicons name="add-circle-outline" size={16} color="#fff" />
            <Text style={styles.emptyChantierBtnText}>{t('reservesScreen.createProject')}</Text>
          </TouchableOpacity>

        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
            <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">{t('reservesScreen.title')}</Text>
            <Text style={styles.subtitle} numberOfLines={2} ellipsizeMode="tail">
              {isLoading ? t('reservesScreen.loading') : isSelectMode
                ? t('reservesScreen.selectedSummary', { count: selectedIds.size, selected: selectedIds.size, total: filtered.length })
                : `${t('reservesScreen.countSummary', { count: chantierReserves.length, shown: filtered.length, total: chantierReserves.length })}${overdueCount > 0 ? t('reservesScreen.overdueSuffix', { count: overdueCount }) : ''}`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            {hasReserveActions && !isLoading && (
              <TouchableOpacity
                style={styles.headerActionsBtn}
                onPress={() => setActionsModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={t('reservesScreen.actions')}
              >
                <Ionicons name="ellipsis-horizontal" size={17} color={C.primary} />
                {currentMissingDescriptionCount > 0 && canUseReserveAssistant && (
                  <View style={styles.headerActionsBadge}>
                    <Text style={styles.headerActionsBadgeText}>{currentMissingDescriptionCount > 9 ? '9+' : currentMissingDescriptionCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {isSelectMode && (
          <View style={styles.selectBar}>
            <TouchableOpacity style={styles.selectBarBtn} onPress={selectAll} accessibilityLabel={t('reservesScreen.selectAll')}>
              <Ionicons name="checkmark-done-outline" size={14} color={C.primary} />
              <Text style={styles.selectBarBtnText}>{t('reservesScreen.selectAll')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.selectBarBtn} onPress={() => setSelectedIds(new Set())} accessibilityLabel={t('reservesScreen.deselectAll')}>
              <Ionicons name="close-outline" size={14} color={C.textSub} />
              <Text style={styles.selectBarBtnText}>{t('reservesScreen.deselectAll')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.selectBarBtn, styles.selectBarCancelBtn]}
              onPress={() => { setIsSelectMode(false); setSelectedIds(new Set()); }}
              accessibilityLabel={t('reservesScreen.cancelSelection')}
            >
              <Ionicons name="close-circle-outline" size={14} color={C.open} />
              <Text style={[styles.selectBarBtnText, { color: C.open }]}>{t('reservesScreen.cancelSelection')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {chantierReserves.length > 0 && !isLoading && !headerCompact && (
          <View style={styles.progressBanner}>
            <View style={styles.progressTextRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons name="checkmark-circle-outline" size={13} color={C.closed} />
                <Text style={styles.progressLabel}>
                  <Text style={{ fontFamily: 'Inter_700Bold', color: C.closed }}>{closedCount}</Text>
                  <Text style={{ color: C.textSub }}>{t('reservesScreen.progressLifted', { total: chantierReserves.length })}</Text>
                </Text>
              </View>
              <Text style={[
                styles.progressPct,
                { color: progressPct >= 75 ? C.closed : progressPct >= 40 ? C.inProgress : C.open },
              ]}>
                {progressPct} %
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[
                styles.progressFill,
                {
                  width: `${progressPct}%` as any,
                  backgroundColor: progressPct >= 75 ? C.closed : progressPct >= 40 ? C.inProgress : C.open,
                },
              ]} />
            </View>
          </View>
        )}

        {showEnterpriseWorkflowSummary && (
          <View style={styles.workflowSummaryBar}>
            <View style={styles.workflowSummaryTitle}>
              <Ionicons name="business-outline" size={13} color={C.primary} />
              <Text style={styles.workflowSummaryTitleText}>{t('reservesScreen.enterpriseTracking')}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.workflowSummaryChips}>
                {(enterpriseWorkflowStats.needs_validation > 0 || enterpriseFilter === 'needs_validation') && (
                  <TouchableOpacity
                    style={[
                      styles.workflowSummaryChip,
                      enterpriseFilter === 'needs_validation' && { borderColor: C.verification, backgroundColor: C.verificationBg },
                    ]}
                    onPress={() => setEnterpriseFilter(enterpriseFilter === 'needs_validation' ? 'all' : 'needs_validation')}
                    accessibilityRole="button"
                    accessibilityState={{ selected: enterpriseFilter === 'needs_validation' }}
                  >
                    <Ionicons name="shield-checkmark-outline" size={11} color={C.verification} />
                    <Text style={[styles.workflowSummaryChipText, { color: C.verification }]}>
                      {t('reservesScreen.needsValidation', { count: enterpriseWorkflowStats.needs_validation })}
                    </Text>
                  </TouchableOpacity>
                )}
                {(enterpriseWorkflowStats.ack_missing > 0 || enterpriseFilter === 'ack_missing') && (
                  <TouchableOpacity
                    style={[
                      styles.workflowSummaryChip,
                      enterpriseFilter === 'ack_missing' && { borderColor: '#B45309', backgroundColor: '#FFFBEB' },
                    ]}
                    onPress={() => setEnterpriseFilter(enterpriseFilter === 'ack_missing' ? 'all' : 'ack_missing')}
                    accessibilityRole="button"
                    accessibilityState={{ selected: enterpriseFilter === 'ack_missing' }}
                  >
                    <Ionicons name="mail-unread-outline" size={11} color="#B45309" />
                    <Text style={[styles.workflowSummaryChipText, { color: '#B45309' }]}>
                      {t('reservesScreen.ackMissing', { count: enterpriseWorkflowStats.ack_missing })}
                    </Text>
                  </TouchableOpacity>
                )}
                {enterpriseFilter !== 'all' && enterpriseFilter !== 'needs_validation' && enterpriseFilter !== 'ack_missing' && (
                  <TouchableOpacity
                    style={[styles.workflowSummaryChip, { borderColor: activeEnterpriseWorkflowFilter.color, backgroundColor: activeEnterpriseWorkflowFilter.color + '10' }]}
                    onPress={() => setEnterpriseFilter('all')}
                    accessibilityRole="button"
                    accessibilityState={{ selected: true }}
                  >
                    <Ionicons name={activeEnterpriseWorkflowFilter.icon as any} size={11} color={activeEnterpriseWorkflowFilter.color} />
                    <Text style={[styles.workflowSummaryChipText, { color: activeEnterpriseWorkflowFilter.color }]}>
                      {activeEnterpriseWorkflowFilter.label}
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.workflowSummaryMore}
                  onPress={() => setFilterModalVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Voir tous les filtres de suivi entreprise"
                >
                  <Text style={styles.workflowSummaryMoreText}>{t('reservesScreen.allPlural')}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}

        {(archivedCount > 0 || showArchived) && (
          <TouchableOpacity
            style={[styles.archiveBanner, showArchived && styles.archiveBannerActive]}
            onPress={() => {
              const next = !showArchived;
              setShowArchived(next);
              if (next) {
                setStatusFilter('all');
                setEnterpriseFilter('all');
                setNearDeadlineOnly(false);
              }
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={
              showArchived
                ? t('reservesScreen.archivedView')
                : t('reservesScreen.archivedBanner', { count: archivedCount })
            }
          >
            <Ionicons name={showArchived ? 'archive' : 'archive-outline'} size={14} color="#6B7280" />
            <Text style={styles.archiveBannerText}>
              {showArchived ? (
                <>
                  <Text style={{ fontFamily: 'Inter_700Bold', color: '#6B7280' }}>{t('reservesScreen.archivedView')}</Text>
                  {' — '}
                  {t('reservesScreen.archivedViewText', { count: archivedCount })}
                </>
              ) : (
                <>
                  <Text style={{ fontFamily: 'Inter_700Bold', color: '#6B7280' }}>{archivedCount}</Text>
                  {' '}
                  {t('reservesScreen.archivedBanner', { count: archivedCount }).replace(String(archivedCount), '').trim()}
                </>
              )}
            </Text>
            <Ionicons name={showArchived ? 'close-circle' : 'chevron-forward'} size={13} color="#6B7280" />
          </TouchableOpacity>
        )}

        {isSousTraitant && sousTraitantCompanyName && (
          <View style={styles.stBanner}>
            <Ionicons name="shield-checkmark-outline" size={13} color={C.primary} />
            <Text style={styles.stBannerText}>
              {t('reservesScreen.subcontractorScope', { company: sousTraitantCompanyName })}
            </Text>
          </View>
        )}

        {nearDeadlineReserves.length > 0 && !headerCompact && (
          <TouchableOpacity
            style={[styles.deadlineReminderBanner, nearDeadlineOnly && styles.deadlineReminderBannerActive]}
            onPress={() => setNearDeadlineOnly(v => !v)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('reservesScreen.deadlineReminder', { count: nearDeadlineReserves.length })}
          >
            <Ionicons name="alarm-outline" size={14} color="#D97706" />
            <Text style={styles.deadlineReminderText}>
              <Text style={{ fontFamily: 'Inter_700Bold' }}>{t('reservesScreen.deadlineReminder', { count: nearDeadlineReserves.length })}</Text>
              {nearDeadlineOnly ? t('reservesScreen.filterActive') : t('reservesScreen.see')}
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
              accessibilityLabel={t('reservesScreen.allProjects')}
            >
              <Ionicons name="layers-outline" size={11} color={chantierFilter === 'all' ? '#fff' : C.textSub} />
              <Text style={[styles.chantierChipText, chantierFilter === 'all' && styles.chantierChipTextActive]}>
                {t('reservesScreen.allProjects')}
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
            placeholder={t('reservesScreen.searchPlaceholder')}
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
            accessibilityLabel={t('reservesScreen.searchAccessibility')}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel={t('reservesScreen.clearSearch')}>
              <Ionicons name="close-circle" size={16} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Status filter row */}
        <View style={styles.toolRow}>
          <View style={styles.filterScrollContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              {statusFilters.map(f => {
                const isActive = !showArchived && statusFilter === f.key;
                const isOverdueChip = f.key === 'overdue';
                return (
                  <TouchableOpacity
                    key={f.key}
                    style={[
                      styles.filterChip,
                      isActive && (isOverdueChip ? styles.filterChipOverdue : styles.filterChipActive),
                    ]}
                    onPress={() => applyAdvancedStatusFilter(f.key)}
                    accessibilityRole="button"
                    accessibilityLabel={t('reservesScreen.filterByStatus', { status: f.label })}
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
          </View>

          <TouchableOpacity
            style={[styles.toolBtn, activeFilterCount > 0 && styles.toolBtnActive]}
            onPress={() => setFilterModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={t('reservesScreen.filterButtonAccessibility', { count: activeFilterCount })}
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
            accessibilityLabel={t('reservesScreen.sort')}
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
            {isLoading ? (
              <SkeletonList count={5} type="reserve" />
            ) : viewMode === 'grouped_status' || viewMode === 'grouped_company' ? (
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
                      <View style={styles.detailObsBadge}><Ionicons name="eye-outline" size={11} color="#0EA5E9" /><Text style={styles.detailObsText}>{t('reservesScreen.detail.observation')}</Text></View>
                    )}
                  </View>
                  <Text style={styles.detailTitle}>{selectedReserve.title}</Text>
                  <View style={styles.detailBadgeRow}>
                    {(() => {
                      const pc = PRIORITY_COLORS[selectedReserve.priority] ?? '#6B7280';
                      return (
                        <View style={[styles.detailPriorityBadge, { backgroundColor: pc + '20', borderColor: pc }]}>
                          <Text style={[styles.detailPriorityText, { color: pc }]}>{t(`reserveLabels.priority.${selectedReserve.priority}`)}</Text>
                        </View>
                      );
                    })()}
                    {canTrackEnterpriseWorkflow && getEnterpriseWorkflowBadges(selectedReserve).map(badge => (
                      <View
                        key={badge.key}
                        style={[styles.detailWorkflowBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}
                      >
                        <Ionicons name={badge.icon as any} size={11} color={badge.color} />
                        <Text style={[styles.detailWorkflowBadgeText, { color: badge.color }]}>{badge.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Quick status buttons */}
                {permissions.canEdit && (
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>{t('reservesScreen.detail.changeStatus')}</Text>
                    <View style={styles.quickStatusRow}>
                      {statusLabelEntries.map(([s, label]) => {
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
                  <Text style={styles.detailLabel}>{t('reservesScreen.detail.description')}</Text>
                  <Text style={styles.detailText}>{getReserveDescriptionText(selectedReserve.description, selectedReserve.title)}</Text>
                </View>

                <View style={styles.detailCard}>
                  <View style={styles.detailRow}>
                    <Ionicons name="business-outline" size={14} color={C.textMuted} />
                    <Text style={styles.detailMeta}>
                      {[selectedReserve.building ? `Bât. ${selectedReserve.building}` : null, selectedReserve.zone, selectedReserve.level].filter(Boolean).join(' — ')}
                    </Text>
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
                      <Text style={styles.detailMeta}>{t('reservesScreen.detail.deadline', { date: selectedReserve.deadline })}</Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Ionicons name="time-outline" size={14} color={C.textMuted} />
                    <Text style={styles.detailMeta}>{t('reservesScreen.detail.createdAt', { date: formatDate(selectedReserve.createdAt) })}</Text>
                  </View>
                </View>

                {/* Quick comment */}
                {permissions.canEdit && (
                  <View style={styles.detailCard}>
                    <Text style={styles.detailLabel}>{t('reservesScreen.detail.addComment')}</Text>
                    <View style={styles.tabletCommentRow}>
                      <DictationTextInput
                        inputStyle={styles.tabletCommentInput}
                        containerStyle={{ flex: 1 }}
                        placeholder={t('reservesScreen.detail.commentPlaceholder')}
                        placeholderTextColor={C.textMuted}
                        value={tabletComment}
                        onChangeText={setTabletComment}
                        multiline
                        numberOfLines={2}
                        textAssistEnabled
                        textAssistContext="comment"
                        accessibilityLabel="Saisir un commentaire"
                      />
                      <TouchableOpacity
                        style={[styles.tabletCommentBtn, (!tabletComment.trim() || tabletCommentSending) && styles.tabletCommentBtnDisabled]}
                        onPress={() => handleTabletComment(selectedReserve)}
                        disabled={!tabletComment.trim() || tabletCommentSending}
                        accessibilityRole="button"
                        accessibilityLabel={t('channel.sendAccessibility')}
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
                  <Text style={styles.detailOpenText}>{t('reservesScreen.detail.openFull')}</Text>
                  <Ionicons name="arrow-forward" size={15} color={C.primary} />
                </TouchableOpacity>
              </ScrollView>
            ) : (
              <View style={styles.detailEmpty}>
                <Ionicons name="hand-left-outline" size={36} color={C.textMuted} />
                <Text style={styles.detailEmptyText}>{t('reservesScreen.empty.selectReserve')}</Text>
                <Text style={styles.detailEmptyHint}>{t('reservesScreen.empty.selectReserveHint')}</Text>
              </View>
            )}
          </View>
        </View>
      ) : isLoading ? (
        <SkeletonList count={5} type="reserve" />
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
          <Text style={styles.batchBarCount}>{selectedIds.size}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.batchBarScroll}
          >
            {permissions.canExport && (
              <TouchableOpacity
                style={styles.batchBarBtn}
                onPress={() => {
                  const list = filtered.filter(r => selectedIds.has(r.id));
                  if (list.length === 0) return;
                  void handleExportPDFForList(list);
                }}
                disabled={pdfLoading}
              >
                <Ionicons name="document-text-outline" size={14} color="#fff" />
                <Text style={styles.batchBarBtnText}>PDF</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.batchBarBtn}
              onPress={() => { setBatchAction('status'); setBatchModalVisible(true); }}
            >
              <Ionicons name="swap-horizontal-outline" size={14} color="#fff" />
              <Text style={styles.batchBarBtnText}>Statut</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.batchBarBtn}
              onPress={() => { setBatchAction('company'); setBatchModalVisible(true); }}
            >
              <Ionicons name="people-outline" size={14} color="#fff" />
              <Text style={styles.batchBarBtnText}>Entreprise</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.batchBarBtn}
              onPress={() => { setBatchAction('deadline'); setBatchModalVisible(true); }}
            >
              <Ionicons name="calendar-outline" size={14} color="#fff" />
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
                <Ionicons name="trash-outline" size={14} color="#fff" />
                <Text style={styles.batchBarBtnText}>Supprimer</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}

      {!isSelectMode && permissions.canCreate && (
        <View style={[styles.fabContainer, { bottom: Platform.OS === 'web' ? 94 : insets.bottom + 55 }]}>
          {fabOpen && (
            <Animated.View style={[styles.fabSubRow, { opacity: fabAnim }]}>
              <TouchableOpacity
                style={styles.fabAction}
                onPress={() => { closeFabMenu(); router.push('/reserve/new' as any); }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Formulaire complet"
              >
                <View style={styles.fabActionIcon}>
                  <Ionicons name="create-outline" size={18} color="#fff" />
                </View>
                <Text style={styles.fabSubLabelText}>Formulaire complet</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {fabOpen && activeSitePlans.length > 0 && (
            <Animated.View style={[styles.fabSubRow, { opacity: fabAnim }]}>
              <TouchableOpacity
                style={styles.fabAction}
                onPress={() => { closeFabMenu(); router.push('/(tabs)/plans' as any); }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Depuis le plan"
              >
                <View style={[styles.fabActionIcon, { backgroundColor: '#16A34A' }]}>
                  <Ionicons name="map-outline" size={18} color="#fff" />
                </View>
                <Text style={styles.fabSubLabelText}>Depuis le plan</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {fabOpen && (
            <Animated.View style={[styles.fabSubRow, { opacity: fabAnim }]}>
              <TouchableOpacity
                style={styles.fabAction}
                onPress={handleQuickPhoto}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Photo rapide"
              >
                <View style={[styles.fabActionIcon, { backgroundColor: '#0EA5E9' }]}>
                  <Ionicons name="camera-outline" size={18} color="#fff" />
                </View>
                <Text style={styles.fabSubLabelText}>Photo rapide</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {chantierReserves.length > 0 && (
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
          )}
        </View>
      )}

      <Modal visible={actionsModalVisible} transparent animationType="slide" onRequestClose={() => setActionsModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setActionsModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.bottomSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>{'Actions r\u00e9serves'}</Text>
              <TouchableOpacity style={styles.filtCloseBtn} onPress={() => setActionsModalVisible(false)}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            {chantierReserves.length > 0 && (
              <TouchableOpacity
                style={styles.contextItem}
                onPress={() => {
                  setActionsModalVisible(false);
                  toggleHeaderCompact();
                }}
              >
                <View style={styles.contextItemIcon}>
                  <Ionicons name={headerCompact ? 'eye-outline' : 'eye-off-outline'} size={18} color={C.primary} />
                </View>
                <Text style={styles.contextItemText}>{headerCompact ? 'Afficher les indicateurs' : 'Masquer les indicateurs'}</Text>
                <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
              </TouchableOpacity>
            )}

            {permissions.canExport && filtered.length > 0 && (
              <>
                <TouchableOpacity
                  style={styles.contextItem}
                  onPress={() => {
                    setActionsModalVisible(false);
                    openPdfExportModal();
                  }}
                  disabled={pdfLoading}
                >
                  <View style={styles.contextItemIcon}>
                    {pdfLoading
                      ? <ActivityIndicator size="small" color={C.primary} />
                      : <Ionicons name="document-text-outline" size={18} color={C.primary} />}
                  </View>
                  <Text style={styles.contextItemText}>Exporter en PDF</Text>
                  <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.contextItem}
                  onPress={() => {
                    setActionsModalVisible(false);
                    handleExportCSV();
                  }}
                >
                  <View style={styles.contextItemIcon}>
                    <Ionicons name="download-outline" size={18} color={C.textSub} />
                  </View>
                  <Text style={styles.contextItemText}>Exporter en CSV</Text>
                </TouchableOpacity>
              </>
            )}

            {permissions.canEdit && filtered.length > 0 && (
              <TouchableOpacity
                style={styles.contextItem}
                onPress={() => {
                  setActionsModalVisible(false);
                  setIsSelectMode(true);
                }}
              >
                <View style={styles.contextItemIcon}>
                  <Ionicons name="checkmark-circle-outline" size={18} color={C.inProgress} />
                </View>
                <Text style={styles.contextItemText}>{'S\u00e9lection multiple'}</Text>
                <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
              </TouchableOpacity>
            )}

            {canUseReserveAssistant && chantierReserves.length > 0 && (
              <TouchableOpacity
                style={styles.contextItem}
                onPress={() => {
                  setActionsModalVisible(false);
                  setAssistantVisible(true);
                }}
              >
                <View style={styles.contextItemIcon}>
                  <Ionicons name="sparkles-outline" size={18} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contextItemText}>{'Assistant r\u00e9serves'}</Text>
                  {currentMissingDescriptionCount > 0 && (
                    <Text style={styles.actionItemHint}>
                      {currentMissingDescriptionCount} description{currentMissingDescriptionCount > 1 ? 's' : ''}{' \u00e0 compl\u00e9ter'}
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setActionsModalVisible(false)}>
              <Text style={styles.cancelText}>Fermer</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {canUseReserveAssistant && (
      <Modal
        visible={assistantVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !assistantBusy && setAssistantVisible(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { paddingBottom: assistantSheetBottomGap }]}
          onPress={() => { if (!assistantBusy) setAssistantVisible(false); }}
        >
          <Pressable
            style={[
              styles.assistantBottomSheet,
              { height: assistantSheetHeight, paddingBottom: assistantSheetBottomPadding },
            ]}
            onPress={() => {}}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.assistantHeader}>
              <View style={styles.assistantHeaderIcon}>
                <Ionicons name="sparkles-outline" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Assistant réserves</Text>
                <Text style={styles.modalSubtitle}>Actions groupées avec aperçu avant modification.</Text>
              </View>
              <TouchableOpacity
                style={styles.filtCloseBtn}
                onPress={() => setAssistantVisible(false)}
                disabled={assistantBusy}
                accessibilityLabel="Fermer l'assistant réserves"
              >
                <Ionicons name="close" size={20} color={assistantBusy ? C.textMuted : C.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.assistantScroll}
              showsVerticalScrollIndicator
              contentContainerStyle={styles.assistantContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              <View style={styles.assistantSection}>
                <Text style={styles.sheetSectionLabel}>Périmètre</Text>
                <View style={styles.assistantScopeGrid}>
                  {assistantScopeOptions.map(option => {
                    const active = assistantScope === option.key;
                    const disabled = option.key === 'selected' && option.count === 0;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[
                          styles.assistantScopeCard,
                          active && styles.assistantScopeCardActive,
                          disabled && styles.assistantScopeCardDisabled,
                        ]}
                        onPress={() => !disabled && setAssistantScope(option.key)}
                        disabled={disabled || assistantBusy}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active, disabled }}
                      >
                        <Ionicons
                          name={option.icon as any}
                          size={16}
                          color={active ? C.primary : disabled ? C.textMuted : C.textSub}
                        />
                        <Text style={[styles.assistantScopeLabel, active && styles.assistantScopeLabelActive]}>{option.label}</Text>
                        <Text style={styles.assistantScopeCount}>{option.count}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.assistantActionCard}>
                <View style={styles.assistantActionTop}>
                  <View style={[styles.assistantActionIcon, { backgroundColor: C.primaryBg }]}>
                    <Ionicons name="document-text-outline" size={20} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.assistantActionTitle}>Compléter les descriptions</Text>
                    <Text style={styles.assistantActionText}>
                      {missingDescriptionReserves.length} réserve{missingDescriptionReserves.length > 1 ? 's' : ''} sans description dans ce périmètre. Le titre sera copié dans la description.
                    </Text>
                  </View>
                </View>
                {missingDescriptionReserves.length > 0 && (
                  <View style={styles.assistantPreviewBox}>
                    {missingDescriptionReserves.slice(0, 3).map(r => (
                      <View key={r.id} style={styles.assistantPreviewRow}>
                        <Text style={styles.assistantPreviewId}>{r.id}</Text>
                        <Text style={styles.assistantPreviewText} numberOfLines={1}>{r.title}</Text>
                      </View>
                    ))}
                    {missingDescriptionReserves.length > 3 && (
                      <Text style={styles.assistantMoreText}>+{missingDescriptionReserves.length - 3} autres réserves</Text>
                    )}
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.assistantPrimaryBtn, (assistantBusy || missingDescriptionReserves.length === 0) && styles.assistantBtnDisabled]}
                  onPress={confirmFillMissingDescriptions}
                  disabled={assistantBusy || missingDescriptionReserves.length === 0}
                >
                  <Ionicons name="copy-outline" size={16} color="#fff" />
                  <Text style={styles.assistantPrimaryBtnText}>Copier les titres</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.assistantActionCard}>
                <View style={styles.assistantActionTop}>
                  <View style={[styles.assistantActionIcon, { backgroundColor: '#EEF2FF' }]}>
                    <Ionicons name="language-outline" size={20} color="#4F46E5" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.assistantActionTitle}>Traduire les champs textuels</Text>
                    <Text style={styles.assistantActionText}>
                      Titres, descriptions et commentaires seront remplacés par une version traduite via Azure.
                    </Text>
                  </View>
                </View>
                <View style={styles.assistantLangRow}>
                  {TEXT_ASSIST_LANGUAGES.map(lang => {
                    const active = assistantTargetLanguage === lang.code;
                    return (
                      <TouchableOpacity
                        key={lang.code}
                        style={[styles.assistantLangChip, active && styles.assistantLangChipActive]}
                        onPress={() => setAssistantTargetLanguage(lang.code)}
                        disabled={assistantBusy}
                      >
                        <Text style={[styles.assistantLangText, active && styles.assistantLangTextActive]}>{lang.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.assistantPreviewBox}>
                  <Text style={styles.assistantPreviewHint}>
                    {translationCandidateCount} réserve{translationCandidateCount > 1 ? 's' : ''} analysée{translationCandidateCount > 1 ? 's' : ''}. Les statuts, priorités, entreprises et localisations restent inchangés.
                  </Text>
                  {assistantTargetReserves.slice(0, 3).map(r => (
                    <View key={r.id} style={styles.assistantPreviewRow}>
                      <Text style={styles.assistantPreviewId}>{r.id}</Text>
                      <Text style={styles.assistantPreviewText} numberOfLines={1}>{r.title}</Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity
                  style={[styles.assistantPrimaryBtn, { backgroundColor: '#4F46E5' }, (assistantBusy || translationCandidateCount === 0) && styles.assistantBtnDisabled]}
                  onPress={confirmTranslateReserves}
                  disabled={assistantBusy || translationCandidateCount === 0}
                >
                  <Ionicons name="language-outline" size={16} color="#fff" />
                  <Text style={styles.assistantPrimaryBtnText}>Traduire en {selectedAssistantLanguage.label}</Text>
                </TouchableOpacity>
              </View>

              {assistantBusy && (
                <View style={styles.assistantProgressBox}>
                  <ActivityIndicator size="small" color={C.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.assistantProgressTitle}>{assistantProgress.label}</Text>
                    <View style={styles.assistantProgressTrack}>
                      <View style={[
                        styles.assistantProgressFill,
                        { width: `${assistantProgress.total > 0 ? Math.round((assistantProgress.done / assistantProgress.total) * 100) : 0}%` as any },
                      ]} />
                    </View>
                    <Text style={styles.assistantProgressText}>{assistantProgress.done} / {assistantProgress.total}</Text>
                  </View>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      )}

      {/* Quick Status Modal */}
      <Modal
        visible={pdfExportModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPdfExportModalVisible(false)}
      >
        <Pressable style={styles.pdfModalOverlay} onPress={() => setPdfExportModalVisible(false)}>
          <Pressable style={styles.pdfModalCard} onPress={() => {}}>
            <View style={styles.pdfModalHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Télécharger en PDF</Text>
                <Text style={styles.modalSubtitle}>Choisis ce que tu veux exporter</Text>
              </View>
              <TouchableOpacity onPress={() => setPdfExportModalVisible(false)} accessibilityLabel="Fermer">
                <Ionicons name="close" size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }} keyboardShouldPersistTaps="handled">
            <View style={styles.pdfOptionGroup}>
              <TouchableOpacity
                style={[styles.pdfOption, pdfExportMode === 'all' && styles.pdfOptionActive]}
                onPress={() => setPdfExportMode('all')}
              >
                <Ionicons name="albums-outline" size={14} color={pdfExportMode === 'all' ? '#fff' : C.text} />
                <Text style={[styles.pdfOptionText, pdfExportMode === 'all' && styles.pdfOptionTextActive]}>Toutes les réserves (filtre actuel)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.pdfOption, pdfExportMode === 'company_single' && styles.pdfOptionActive]}
                onPress={() => setPdfExportMode('company_single')}
              >
                <Ionicons name="business-outline" size={14} color={pdfExportMode === 'company_single' ? '#fff' : C.text} />
                <Text style={[styles.pdfOptionText, pdfExportMode === 'company_single' && styles.pdfOptionTextActive]}>Une entreprise</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.pdfOption, pdfExportMode === 'company_multi' && styles.pdfOptionActive]}
                onPress={() => setPdfExportMode('company_multi')}
              >
                <Ionicons name="people-outline" size={14} color={pdfExportMode === 'company_multi' ? '#fff' : C.text} />
                <Text style={[styles.pdfOptionText, pdfExportMode === 'company_multi' && styles.pdfOptionTextActive]}>Plusieurs entreprises</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.pdfOption, pdfExportMode === 'company_none' && styles.pdfOptionActive]}
                onPress={() => setPdfExportMode('company_none')}
              >
                <Ionicons name="ban-outline" size={14} color={pdfExportMode === 'company_none' ? '#fff' : C.text} />
                <Text style={[styles.pdfOptionText, pdfExportMode === 'company_none' && styles.pdfOptionTextActive]}>Réserves sans entreprise</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.pdfOption, pdfExportMode === 'manual' && styles.pdfOptionActive]}
                onPress={() => setPdfExportMode('manual')}
              >
                <Ionicons name="checkbox-outline" size={14} color={pdfExportMode === 'manual' ? '#fff' : C.text} />
                <Text style={[styles.pdfOptionText, pdfExportMode === 'manual' && styles.pdfOptionTextActive]}>Sélection manuelle</Text>
              </TouchableOpacity>
            </View>

            {pdfExportMode === 'company_single' && (
              <View style={styles.pdfPickerWrap}>
                <ScrollView>
                  {groupedByCompany.length === 0 && (
                    <Text style={styles.pdfEmptyHint}>Aucune réserve avec cette sélection.</Text>
                  )}
                  {groupedByCompany.map(g => {
                    const active = pdfCompanySingle === g.key;
                    return (
                      <TouchableOpacity
                        key={g.key}
                        style={[styles.pdfPickRow, active && styles.pdfPickRowActive]}
                        onPress={() => setPdfCompanySingle(g.key)}
                      >
                        <View style={[styles.pdfRadio, active && styles.pdfRadioActive]}>
                          {active && <View style={styles.pdfRadioDot} />}
                        </View>
                        <Text style={[styles.pdfPickRowText, active && styles.pdfPickRowTextActive]} numberOfLines={1}>
                          {g.key === '—' ? 'Sans entreprise' : g.title}
                        </Text>
                        <Text style={styles.pdfPickRowCount}>{g.data.length}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {pdfExportMode === 'company_multi' && (
              <View style={styles.pdfPickerWrap}>
                <View style={styles.pdfPickActions}>
                  <TouchableOpacity
                    style={styles.pdfPickActionBtn}
                    onPress={() => setPdfCompaniesMulti(new Set(groupedByCompany.map(g => g.key)))}
                  >
                    <Text style={styles.pdfPickActionBtnText}>Tout</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pdfPickActionBtn}
                    onPress={() => setPdfCompaniesMulti(new Set())}
                  >
                    <Text style={styles.pdfPickActionBtnText}>Aucun</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView>
                  {groupedByCompany.length === 0 && (
                    <Text style={styles.pdfEmptyHint}>Aucune réserve avec cette sélection.</Text>
                  )}
                  {groupedByCompany.map(g => {
                    const checked = pdfCompaniesMulti.has(g.key);
                    return (
                      <TouchableOpacity
                        key={g.key}
                        style={styles.pdfPickRow}
                        onPress={() => {
                          setPdfCompaniesMulti(prev => {
                            const next = new Set(prev);
                            if (next.has(g.key)) next.delete(g.key);
                            else next.add(g.key);
                            return next;
                          });
                        }}
                      >
                        <View style={[styles.pdfCheckbox, checked && styles.pdfCheckboxChecked]}>
                          {checked && <Ionicons name="checkmark" size={12} color="#fff" />}
                        </View>
                        <Text style={styles.pdfPickRowText} numberOfLines={1}>
                          {g.key === '—' ? 'Sans entreprise' : g.title}
                        </Text>
                        <Text style={styles.pdfPickRowCount}>{g.data.length}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {pdfExportMode === 'manual' && (
              <Text style={styles.pdfEmptyHint}>
                Coche les réserves souhaitées dans la liste, puis génère le PDF depuis la barre d'actions en bas.
              </Text>
            )}

            <Text style={styles.pdfPreview}>
              {pdfExportMode === 'manual'
                ? 'Le modal se fermera et le mode sélection s\'activera.'
                : `${pdfPreviewCount} réserve${pdfPreviewCount !== 1 ? 's' : ''} ${pdfPreviewCount !== 1 ? 'seront' : 'sera'} exportée${pdfPreviewCount !== 1 ? 's' : ''}.`
              }
            </Text>

            <View style={styles.pdfModalActions}>
              {pdfExportMode === 'manual' ? (
                <>
                  <TouchableOpacity style={styles.pdfCancelBtn} onPress={() => setPdfExportModalVisible(false)} disabled={pdfLoading}>
                    <Text style={styles.pdfCancelBtnText}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.pdfConfirmBtn, pdfLoading && { opacity: 0.5 }]}
                    onPress={() => { void handleConfirmPdfExport(); }}
                    disabled={pdfLoading}
                  >
                    {pdfLoading
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="arrow-forward-circle-outline" size={16} color="#fff" />}
                    <Text style={styles.pdfConfirmBtnText}>Commencer</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    style={[styles.pdfDownloadBtn, (pdfLoading || pdfPreviewCount === 0) && { opacity: 0.5 }]}
                    onPress={() => { void handleConfirmPdfExport('print'); }}
                    disabled={pdfLoading || pdfPreviewCount === 0}
                  >
                    <Ionicons name="download-outline" size={16} color={C.primary} />
                    <Text style={styles.pdfDownloadBtnText}>Télécharger</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.pdfConfirmBtn, (pdfLoading || pdfPreviewCount === 0) && { opacity: 0.5 }]}
                    onPress={() => { void handleConfirmPdfExport('share'); }}
                    disabled={pdfLoading || pdfPreviewCount === 0}
                  >
                    {pdfLoading
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="share-social-outline" size={16} color="#fff" />}
                    <Text style={styles.pdfConfirmBtnText}>Partager</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
            {pdfExportMode !== 'manual' && (
              <TouchableOpacity
                style={[styles.emailReportBtn, (pdfLoading || pdfPreviewCount === 0) && { opacity: 0.5 }]}
                onPress={() => { setPdfExportModalVisible(false); setEmailReportModalVisible(true); }}
                disabled={pdfLoading || pdfPreviewCount === 0}
              >
                <Ionicons name="mail-outline" size={15} color={C.primary} />
                <Text style={styles.emailReportBtnText}>Envoyer par email</Text>
              </TouchableOpacity>
            )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={emailReportModalVisible} transparent animationType="fade" onRequestClose={() => setEmailReportModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.pdfModalOverlay} onPress={() => setEmailReportModalVisible(false)}>
            <Pressable style={styles.pdfModalCard} onPress={() => {}}>
              <View style={styles.pdfModalHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Envoyer par email</Text>
                  <Text style={styles.modalSubtitle}>PDF haute fidélité</Text>
                </View>
                <TouchableOpacity onPress={() => setEmailReportModalVisible(false)}>
                  <Ionicons name="close" size={20} color={C.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 12, color: C.textSub, marginBottom: 8 }}>
                Destinataires (séparés par virgule ou espace)
              </Text>
              <TextInput
                style={[styles.emailInput, { marginBottom: 16 }]}
                value={emailReportTo}
                onChangeText={setEmailReportTo}
                placeholder="ex: conducteur@bouygues.fr, chef@bouygues.fr"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
              <View style={styles.pdfModalActions}>
                <TouchableOpacity style={styles.pdfCancelBtn} onPress={() => setEmailReportModalVisible(false)} disabled={emailReportLoading}>
                  <Text style={styles.pdfCancelBtnText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pdfConfirmBtn, (emailReportLoading || !emailReportTo.trim()) && { opacity: 0.5 }]}
                  onPress={() => { void handleSendReservesReport(); }}
                  disabled={emailReportLoading || !emailReportTo.trim()}
                >
                  {emailReportLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="mail-outline" size={16} color="#fff" />}
                  <Text style={styles.pdfConfirmBtnText}>Envoyer</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

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
            {statusLabelEntries.map(([key, label]) => {
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
                {statusLabelEntries.map(([key, label]) => (
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
            {sortOptions.map(opt => (
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

      {/* Context Menu Modal */}
      <Modal visible={contextMenuVisible} transparent animationType="fade" onRequestClose={() => { setContextMenuVisible(false); setContextStatusSubVisible(false); }}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => { setContextMenuVisible(false); setContextStatusSubVisible(false); }}
        >
          <TouchableOpacity activeOpacity={1} style={[styles.bottomSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHandle} />
            {contextMenuReserve && (
              <>
                <View style={styles.sheetTitleRow}>
                  <View style={styles.contextIdWrap}>
                    <Text style={styles.contextId}>{contextMenuReserve.id}</Text>
                  </View>
                  <Text style={styles.contextTitle} numberOfLines={1}>{contextMenuReserve.title}</Text>
                </View>

                {!contextStatusSubVisible ? (
                  <>
                    <TouchableOpacity
                      style={styles.contextItem}
                      onPress={() => { setContextMenuVisible(false); router.push(`/reserve/${contextMenuReserve.id}` as any); }}
                    >
                      <View style={styles.contextItemIcon}>
                        <Ionicons name="open-outline" size={18} color={C.primary} />
                      </View>
                      <Text style={styles.contextItemText}>Ouvrir la fiche</Text>
                      <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                    </TouchableOpacity>

                    {permissions.canEdit && (
                      <TouchableOpacity
                        style={styles.contextItem}
                        onPress={() => setContextStatusSubVisible(true)}
                      >
                        <View style={styles.contextItemIcon}>
                          <Ionicons name="swap-horizontal-outline" size={18} color={C.inProgress} />
                        </View>
                        <Text style={styles.contextItemText}>Changer le statut</Text>
                        <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                      </TouchableOpacity>
                    )}

                    {permissions.canCreate && (
                      <TouchableOpacity
                        style={styles.contextItem}
                        onPress={() => handleContextDuplicate(contextMenuReserve)}
                      >
                        <View style={styles.contextItemIcon}>
                          <Ionicons name="copy-outline" size={18} color={C.textSub} />
                        </View>
                        <Text style={styles.contextItemText}>Dupliquer</Text>
                      </TouchableOpacity>
                    )}

                    {permissions.canDelete && (
                      <TouchableOpacity
                        style={[styles.contextItem, styles.contextItemDanger]}
                        onPress={() => handleContextDelete(contextMenuReserve)}
                      >
                        <View style={[styles.contextItemIcon, { backgroundColor: C.open + '18' }]}>
                          <Ionicons name="trash-outline" size={18} color={C.open} />
                        </View>
                        <Text style={[styles.contextItemText, { color: C.open }]}>Supprimer</Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={styles.contextBackBtn} onPress={() => setContextStatusSubVisible(false)}>
                      <Ionicons name="arrow-back" size={15} color={C.primary} />
                      <Text style={styles.contextBackText}>Retour</Text>
                    </TouchableOpacity>
                    {statusLabelEntries.map(([key, label]) => {
                      const isActive = contextMenuReserve.status === key;
                      const color = STATUS_COLORS[key];
                      return (
                        <TouchableOpacity
                          key={key}
                          style={[styles.sheetItem, isActive && styles.sheetItemActive]}
                          onPress={() => handleContextStatusApply(key)}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <View style={[styles.statusDot, { backgroundColor: color }]} />
                            <Text style={[styles.sheetItemText, isActive && styles.sheetItemTextActive]}>{label}</Text>
                          </View>
                          {isActive && <Ionicons name="checkmark" size={16} color={C.primary} />}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}

                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => { setContextMenuVisible(false); setContextStatusSubVisible(false); }}
                >
                  <Text style={styles.cancelText}>Fermer</Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Advanced Filters Modal */}
      <Modal visible={filterModalVisible} transparent animationType="slide" onRequestClose={() => setFilterModalVisible(false)}>
        <View style={[styles.modalOverlay, { paddingBottom: filterSheetBottomGap }]}>
          <View style={[styles.filtersBottomSheet, { height: filterSheetHeight }]}>

            {/* Handle */}
            <View style={styles.filtHandleArea}>
              <View style={styles.sheetHandle} />
            </View>

            {/* Header — same layout as Plans FiltersSheet */}
            <View style={styles.filtHeader}>
              <View style={styles.filtHeaderLeft}>
                <Ionicons name="options-outline" size={18} color={C.primary} />
                <Text style={styles.filtTitle}>{t('reservesScreen.filters')}</Text>
                {activeFilterCount > 0 && (
                  <View style={styles.filtBadge}>
                    <Text style={styles.filtBadgeText}>{activeFilterCount}</Text>
                  </View>
                )}
              </View>
              <View style={styles.filtHeaderRight}>
                {activeFilterCount > 0 && (
                  <TouchableOpacity style={styles.filtResetBtn} onPress={resetAllFilters}>
                    <Ionicons name="refresh-outline" size={14} color={C.textSub} />
                    <Text style={styles.filtResetText}>{t('reservesScreen.reset')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.filtCloseBtn} onPress={() => setFilterModalVisible(false)}>
                  <Ionicons name="close" size={20} color={C.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              style={styles.filtScroll}
              showsVerticalScrollIndicator
              contentContainerStyle={styles.filtContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >

              {/* STATUT */}
              <View style={styles.filtSection}>
                <View style={styles.filtSectionHeader}>
                  <Ionicons name="flag-outline" size={13} color={C.textSub} />
                  <Text style={styles.filtSectionTitle}>{t('reservesScreen.sections.status')}</Text>
                </View>
                <View style={styles.filtChipRow}>
                    {([
                      ...statusFilters,
                      { key: 'archived', label: `${t('reservesScreen.statuses.archived')}${archivedCount > 0 ? ` (${archivedCount})` : ''}`, icon: 'archive-outline' },
                    ] as { key: AdvancedStatusFilterKey; label: string; icon?: string }[]).map(f => {
                      const isArchivedChip = f.key === 'archived';
                      const isOverdueChip = f.key === 'overdue';
                      const isActive = isArchivedChip ? showArchived : !showArchived && statusFilter === f.key;
                      const chipColor = isArchivedChip ? '#6B7280' : isOverdueChip ? C.open : C.primary;
                      return (
                        <TouchableOpacity
                          key={f.key}
                          style={[
                            styles.filtChip,
                            isActive && { backgroundColor: chipColor + '18', borderColor: chipColor },
                            isActive && f.key === 'all' && styles.filtChipActive,
                          ]}
                          onPress={() => applyAdvancedStatusFilter(f.key)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isActive }}
                        >
                          {f.icon ? (
                            <Ionicons name={f.icon as any} size={12} color={isActive ? chipColor : C.textSub} />
                          ) : null}
                          <Text style={[
                            styles.filtChipText,
                            isActive && f.key === 'all' && styles.filtChipTextActive,
                            isActive && f.key !== 'all' && { color: chipColor, fontFamily: 'Inter_600SemiBold' },
                          ]}>
                            {f.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                </View>
              </View>

              {canTrackEnterpriseWorkflow && enterpriseWorkflowReserves.length > 0 && (
                <View style={styles.filtSection}>
                  <View style={styles.filtSectionHeader}>
                    <Ionicons name="business-outline" size={13} color={C.textSub} />
                    <Text style={styles.filtSectionTitle}>{t('reservesScreen.sections.enterprise')}</Text>
                  </View>
                  <View style={styles.filtChipRow}>
                      {ENTERPRISE_WORKFLOW_FILTERS.map(f => {
                        const isActive = enterpriseFilter === f.key;
                        const count = enterpriseWorkflowStats[f.key];
                        return (
                          <TouchableOpacity
                            key={f.key}
                            style={[
                              styles.filtChip,
                              isActive && { backgroundColor: f.color + '18', borderColor: f.color },
                            ]}
                            onPress={() => {
                              setEnterpriseFilter(f.key);
                              if (f.key !== 'all') setShowArchived(false);
                            }}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isActive }}
                          >
                            <Ionicons name={f.icon as any} size={12} color={isActive ? f.color : C.textSub} />
                            <Text style={[
                              styles.filtChipText,
                              isActive && { color: f.color, fontFamily: 'Inter_600SemiBold' },
                            ]}>
                              {f.label}{f.key !== 'all' ? ` (${count})` : ''}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                  </View>
                </View>
              )}

              {/* TYPE */}
              <View style={styles.filtSection}>
                <View style={styles.filtSectionHeader}>
                  <Ionicons name="swap-horizontal-outline" size={13} color={C.textSub} />
                  <Text style={styles.filtSectionTitle}>{t('reservesScreen.sections.type')}</Text>
                </View>
                <View style={styles.filtChipRow}>
                    <TouchableOpacity
                      style={[styles.filtChip, kindFilter === 'all' && styles.filtChipActive]}
                      onPress={() => setKindFilter('all')}
                    >
                      <Text style={[styles.filtChipText, kindFilter === 'all' && styles.filtChipTextActive]}>{t('reservesScreen.types.all')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filtChip, kindFilter === 'reserve' && { backgroundColor: '#EF444420', borderColor: '#EF4444' }]}
                      onPress={() => setKindFilter('reserve')}
                    >
                      <Ionicons name="warning-outline" size={12} color={kindFilter === 'reserve' ? '#EF4444' : C.textSub} />
                      <Text style={[styles.filtChipText, kindFilter === 'reserve' && { color: '#EF4444', fontFamily: 'Inter_600SemiBold' }]}>{t('reservesScreen.types.reserves')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filtChip, kindFilter === 'observation' && { backgroundColor: '#0EA5E920', borderColor: '#0EA5E9' }]}
                      onPress={() => setKindFilter('observation')}
                    >
                      <Ionicons name="eye-outline" size={12} color={kindFilter === 'observation' ? '#0EA5E9' : C.textSub} />
                      <Text style={[styles.filtChipText, kindFilter === 'observation' && { color: '#0EA5E9', fontFamily: 'Inter_600SemiBold' }]}>
                        {t('reservesScreen.types.observations')}{obsCount > 0 ? ` (${obsCount})` : ''}
                      </Text>
                    </TouchableOpacity>
                </View>
              </View>

              {/* BATIMENT - localisation macro */}
              {buildings.length >= 1 && (
                <View style={styles.filtSection}>
                  <View style={styles.filtSectionHeader}>
                    <Ionicons name="business-outline" size={13} color={C.textSub} />
                    <Text style={styles.filtSectionTitle}>{t('reservesScreen.sections.building')}</Text>
                  </View>
                  <View style={styles.filtChipRow}>
                      {['all', ...buildings].map(b => (
                        <TouchableOpacity
                          key={b}
                          style={[styles.filtChip, buildingFilter === b && styles.filtChipActive]}
                          onPress={() => setBuildingFilter(b)}
                        >
                          {b !== 'all' && <Ionicons name="business-outline" size={12} color={buildingFilter === b ? '#fff' : C.textSub} />}
                          {b === 'all' && <Ionicons name="grid-outline" size={12} color={buildingFilter === b ? '#fff' : C.textSub} />}
                          <Text style={[styles.filtChipText, buildingFilter === b && styles.filtChipTextActive]}>
                            {b === 'all' ? t('reservesScreen.allPlural') : b}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </View>
              )}

              {/* NIVEAU — localisation intermédiaire (étage) */}
              {levels.length > 0 && (
                <View style={styles.filtSection}>
                  <View style={styles.filtSectionHeader}>
                    <Ionicons name="layers-outline" size={13} color={C.textSub} />
                    <Text style={styles.filtSectionTitle}>{t('reservesScreen.sections.level')}</Text>
                  </View>
                  <View style={styles.filtChipRow}>
                      {['all', ...levels].map(lv => (
                        <TouchableOpacity
                          key={lv}
                          style={[styles.filtChip, levelFilter === lv && styles.filtChipActive]}
                          onPress={() => setLevelFilter(lv)}
                        >
                          <Text style={[styles.filtChipText, levelFilter === lv && styles.filtChipTextActive]}>
                            {lv === 'all' ? t('reservesScreen.allPlural') : lv}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </View>
              )}

              {/* ZONE — localisation micro */}
              {zones.length > 0 && (
                <View style={styles.filtSection}>
                  <View style={styles.filtSectionHeader}>
                    <Ionicons name="location-outline" size={13} color={C.textSub} />
                    <Text style={styles.filtSectionTitle}>{t('reservesScreen.sections.zone')}</Text>
                  </View>
                  <View style={styles.filtChipRow}>
                      {['all', ...zones].map(z => (
                        <TouchableOpacity
                          key={z}
                          style={[styles.filtChip, zoneFilter === z && styles.filtChipActive]}
                          onPress={() => setZoneFilter(z)}
                        >
                          <Text style={[styles.filtChipText, zoneFilter === z && styles.filtChipTextActive]}>
                            {z === 'all' ? t('reservesScreen.allFem') : z}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </View>
              )}

              {/* ENTREPRISE — responsabilité */}
              {companies.length > 0 && (
                <View style={styles.filtSection}>
                  <View style={styles.filtSectionHeader}>
                    <Ionicons name="construct-outline" size={13} color={C.textSub} />
                    <Text style={styles.filtSectionTitle}>{t('reservesScreen.sections.company')}</Text>
                  </View>
                  <View style={styles.filtChipRow}>
                      <TouchableOpacity
                        style={[styles.filtChip, companyFilter === 'all' && styles.filtChipActive]}
                        onPress={() => setCompanyFilter('all')}
                      >
                        <Text style={[styles.filtChipText, companyFilter === 'all' && styles.filtChipTextActive]}>{t('reservesScreen.allFem')}</Text>
                      </TouchableOpacity>
                      {companies.map(co => (
                        <TouchableOpacity
                          key={co.id}
                          style={[styles.filtChip, companyFilter === co.name && { backgroundColor: co.color + '20', borderColor: co.color }]}
                          onPress={() => setCompanyFilter(companyFilter === co.name ? 'all' : co.name)}
                        >
                          <View style={[styles.dot, { backgroundColor: co.color }]} />
                          <Text style={[styles.filtChipText, companyFilter === co.name && { color: co.color, fontFamily: 'Inter_600SemiBold' }]}>{co.shortName}</Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </View>
              )}

              {/* CORPS D'ÉTAT (LOT) — sous-catégorie travaux */}
              {lots.length > 0 && (
                <View style={styles.filtSection}>
                  <View style={styles.filtSectionHeader}>
                    <Ionicons name="briefcase-outline" size={13} color={C.textSub} />
                    <Text style={styles.filtSectionTitle}>{t('reservesScreen.sections.lot')}</Text>
                  </View>
                  <View style={styles.filtChipRow}>
                      <TouchableOpacity
                        style={[styles.filtChip, lotFilter === 'all' && styles.filtChipActive]}
                        onPress={() => setLotFilter('all')}
                      >
                        <Text style={[styles.filtChipText, lotFilter === 'all' && styles.filtChipTextActive]}>{t('reservesScreen.allPlural')}</Text>
                      </TouchableOpacity>
                      {lots.map(lot => (
                        <TouchableOpacity
                          key={lot.id}
                          style={[styles.filtChip, lotFilter === lot.id && { backgroundColor: (lot.color ?? C.primary) + '20', borderColor: lot.color ?? C.primary }]}
                          onPress={() => setLotFilter(lotFilter === lot.id ? 'all' : lot.id)}
                        >
                          {lot.color && <View style={[styles.dot, { backgroundColor: lot.color }]} />}
                          <Text style={[styles.filtChipText, lotFilter === lot.id && { color: lot.color ?? C.primary, fontFamily: 'Inter_600SemiBold' }]} numberOfLines={1}>
                            {lot.number ? `${lot.number}. ` : ''}{lot.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </View>
              )}

              {/* LOCALISATION PLAN — épinglage */}
              {chantiersWithPlans.size > 0 && (
                <View style={styles.filtSection}>
                  <View style={styles.filtSectionHeader}>
                    <Ionicons name="map-outline" size={13} color={C.textSub} />
                    <Text style={styles.filtSectionTitle}>{t('reservesScreen.sections.planLocation')}</Text>
                  </View>
                  <View style={styles.filtChipRow}>
                      <TouchableOpacity
                        style={[styles.filtChip, pinFilter === 'all' && styles.filtChipActive]}
                        onPress={() => setPinFilter('all')}
                      >
                        <Text style={[styles.filtChipText, pinFilter === 'all' && styles.filtChipTextActive]}>{t('reservesScreen.pin.all')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.filtChip, pinFilter === 'pinned' && { backgroundColor: '#3B82F620', borderColor: '#3B82F6' }]}
                        onPress={() => setPinFilter(pinFilter === 'pinned' ? 'all' : 'pinned')}
                      >
                        <Ionicons name="location" size={12} color={pinFilter === 'pinned' ? '#3B82F6' : C.textSub} />
                        <Text style={[styles.filtChipText, pinFilter === 'pinned' && { color: '#3B82F6', fontFamily: 'Inter_600SemiBold' }]}>{t('reservesScreen.pin.pinned')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.filtChip, pinFilter === 'unpinned' && { backgroundColor: '#F59E0B20', borderColor: '#F59E0B' }]}
                        onPress={() => setPinFilter(pinFilter === 'unpinned' ? 'all' : 'unpinned')}
                      >
                        <Ionicons name="location-outline" size={12} color={pinFilter === 'unpinned' ? '#F59E0B' : C.textSub} />
                        <Text style={[styles.filtChipText, pinFilter === 'unpinned' && { color: '#F59E0B', fontFamily: 'Inter_600SemiBold' }]}>{t('reservesScreen.pin.unpinned')}</Text>
                      </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* PRIORITÉ — qualification de l'urgence (en dernier) */}
              <View style={styles.filtSection}>
                <View style={styles.filtSectionHeader}>
                  <Ionicons name="alert-circle-outline" size={13} color={C.textSub} />
                  <Text style={styles.filtSectionTitle}>{t('reservesScreen.sections.priority')}</Text>
                </View>
                <View style={styles.filtChipRow}>
                    {([
                      { key: 'all', label: t('reservesScreen.allFem'), color: C.textSub },
                      { key: 'critical', label: t('reserveLabels.priority.critical'), color: PRIORITY_COLORS.critical },
                      { key: 'high', label: t('reserveLabels.priority.high'), color: PRIORITY_COLORS.high },
                      { key: 'medium', label: t('reserveLabels.priority.medium'), color: PRIORITY_COLORS.medium },
                      { key: 'low', label: t('reserveLabels.priority.low'), color: PRIORITY_COLORS.low },
                    ] as const).map(p => (
                      <TouchableOpacity
                        key={p.key}
                        style={[
                          styles.filtChip,
                          priorityFilter === p.key && p.key === 'all' && styles.filtChipActive,
                          priorityFilter === p.key && p.key !== 'all' && { backgroundColor: p.color + '20', borderColor: p.color },
                        ]}
                        onPress={() => setPriorityFilter(p.key as 'all' | ReservePriority)}
                      >
                        <Text style={[
                          styles.filtChipText,
                          priorityFilter === p.key && p.key === 'all' && styles.filtChipTextActive,
                          priorityFilter === p.key && p.key !== 'all' && { color: p.color, fontFamily: 'Inter_600SemiBold' },
                        ]}>{p.label}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </View>

            </ScrollView>

            <View style={[styles.filtFooter, { paddingBottom: filterFooterBottomPadding }]}>
              <TouchableOpacity style={[styles.applyBtn, styles.filtApplyBtn]} onPress={() => setFilterModalVisible(false)}>
                <Text style={styles.applyBtnText}>{t('reservesScreen.apply')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingLeft: 24,
    paddingRight: 16,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 19, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 1 },
  headerActionsBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primaryBg,
    borderWidth: 1.5,
    borderColor: C.primary + '35',
    position: 'relative',
  },
  headerActionsBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  headerActionsBadgeText: { fontSize: 9, fontFamily: 'Inter_800ExtraBold', color: '#fff' },
  selectBar: {
    flexDirection: 'row', gap: 10, marginBottom: 8,
  },
  selectBarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primaryBg, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: C.primary + '40',
  },
  selectBarCancelBtn: { backgroundColor: C.open + '10', borderColor: C.open + '35' },
  selectBarBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface2, borderRadius: 8, paddingHorizontal: 10,
    paddingVertical: 4, marginBottom: 6, borderWidth: 1, borderColor: C.border,
    minHeight: 34,
  },
  searchInput: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, paddingVertical: 0 },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
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
    backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    marginBottom: 6, borderWidth: 1, borderColor: C.primary + '30',
  },
  stBannerText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.text, flex: 1 },
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

  emptyChantierState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  emptyChantierIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '25',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyChantierTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center' },
  emptyChantierSubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  emptyChantierFeatures: { width: '100%', gap: 0, marginVertical: 8, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  emptyChantierFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  emptyChantierFeatureDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  emptyChantierFeatureTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 2 },
  emptyChantierFeatureDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 17 },
  emptyChantierBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14, marginTop: 4 },
  emptyChantierBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

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
    paddingLeft: 12, paddingRight: 4, paddingVertical: 6, gap: 8,
    paddingBottom: Platform.OS === 'ios' ? 18 : 6,
    ...Platform.select({
      web: { boxShadow: '0px -4px 16px rgba(0,48,130,0.25)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 10 },
    }),
  },
  batchBarCount: {
    fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff',
    minWidth: 22, textAlign: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    overflow: 'hidden',
  },
  batchBarScroll: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12,
  },
  batchBarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.20)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  batchBarBtnDelete: { backgroundColor: 'rgba(220,38,38,0.40)' },
  batchBarBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  batchDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 14, fontStyle: 'italic' },
  coDot: { width: 10, height: 10, borderRadius: 5 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  modalTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  modalSubtitle: { marginTop: 2, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  pdfModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  pdfModalCard: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12, maxHeight: '90%', width: '100%', maxWidth: 560 },
  pdfModalHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pdfOptionGroup: { gap: 6 },
  pdfOption: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  pdfOptionActive: { backgroundColor: C.primary, borderColor: C.primary },
  pdfOptionText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text, flex: 1 },
  pdfOptionTextActive: { color: '#fff', fontFamily: 'Inter_600SemiBold' },
  pdfPickerWrap: { maxHeight: 240, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 6, backgroundColor: C.surface2 },
  pdfPickActions: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  pdfPickActionBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  pdfPickActionBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  pdfPickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8 },
  pdfPickRowActive: { backgroundColor: C.primaryBg },
  pdfPickRowText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text, flex: 1 },
  pdfPickRowTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  pdfPickRowCount: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: C.surface, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  pdfRadio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  pdfRadioActive: { borderColor: C.primary },
  pdfRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  pdfCheckbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  pdfCheckboxChecked: { backgroundColor: C.primary, borderColor: C.primary },
  pdfEmptyHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', padding: 16 },
  pdfPreview: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, textAlign: 'center' },
  pdfModalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  pdfCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  pdfCancelBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  pdfDownloadBtn: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: C.primary, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pdfDownloadBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  pdfConfirmBtn: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  pdfConfirmBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  emailReportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: C.primary + '50', backgroundColor: C.primary + '08' },
  emailReportBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  emailInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, backgroundColor: C.surface },
  checkboxDisabled: { backgroundColor: C.surface2, borderColor: C.border },
  bottomSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12, maxHeight: '85%',
    width: '100%', maxWidth: 640, overflow: 'hidden',
  },
  filtersBottomSheet: {
    width: '100%',
    maxWidth: 640,
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 0,
    overflow: 'hidden',
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  assistantBottomSheet: {
    width: '100%',
    maxWidth: 640,
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    overflow: 'hidden',
  },
  assistantHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  assistantHeaderIcon: {
    width: 40, height: 40, borderRadius: 14,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  assistantScroll: { flex: 1, alignSelf: 'stretch' },
  assistantContent: { gap: 14, paddingBottom: 24 },
  assistantSection: { gap: 8 },
  assistantScopeGrid: { flexDirection: 'row', gap: 8 },
  assistantScopeCard: {
    flex: 1, minHeight: 72, borderRadius: 14, borderWidth: 1.5,
    borderColor: C.border, backgroundColor: C.surface2,
    padding: 10, justifyContent: 'space-between',
  },
  assistantScopeCardActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  assistantScopeCardDisabled: { opacity: 0.45 },
  assistantScopeLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  assistantScopeLabelActive: { color: C.primary },
  assistantScopeCount: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  assistantActionCard: {
    borderWidth: 1, borderColor: C.border, borderRadius: 16,
    backgroundColor: C.surface, padding: 14, gap: 12,
  },
  assistantActionTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  assistantActionIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  assistantActionTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text },
  assistantActionText: { marginTop: 3, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17 },
  assistantPreviewBox: {
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    backgroundColor: C.surface2, padding: 10, gap: 7,
  },
  assistantPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  assistantPreviewId: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.primary, minWidth: 72 },
  assistantPreviewText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text },
  assistantPreviewHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17 },
  assistantMoreText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  assistantPrimaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12,
  },
  assistantPrimaryBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  assistantBtnDisabled: { opacity: 0.45 },
  assistantLangRow: { flexDirection: 'row', gap: 8 },
  assistantLangChip: {
    minWidth: 54, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12,
    backgroundColor: C.surface2, borderWidth: 1.5, borderColor: C.border,
  },
  assistantLangChipActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  assistantLangText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.textSub },
  assistantLangTextActive: { color: '#fff' },
  assistantProgressBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, borderRadius: 14, borderWidth: 1,
    borderColor: C.primary + '30', backgroundColor: C.primaryBg,
  },
  assistantProgressTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary, marginBottom: 6 },
  assistantProgressTrack: { height: 5, borderRadius: 999, backgroundColor: '#DDE4EE', overflow: 'hidden' },
  assistantProgressFill: { height: '100%', borderRadius: 999, backgroundColor: C.primary },
  assistantProgressText: { marginTop: 4, fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
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
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  chipTextActive: { color: '#fff', fontFamily: 'Inter_600SemiBold' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  applyBtn: { marginTop: 12, marginBottom: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginHorizontal: 0 },
  applyBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  filtHandleArea: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 10 },
  filtHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -16, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  filtHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filtHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filtTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  filtBadge: { backgroundColor: C.primary, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  filtBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  filtResetBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  filtResetText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  filtCloseBtn: { padding: 4 },
  filtScroll: { flex: 1, alignSelf: 'stretch' },
  filtContent: { paddingHorizontal: 0, paddingTop: 16, paddingBottom: 18, gap: 20 },
  filtFooter: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  filtApplyBtn: { marginTop: 0, marginBottom: 0 },
  filtSection: { gap: 10 },
  filtSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filtSectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, flex: 1 },
  filtChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  filtChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1.5, borderColor: C.border, maxWidth: '100%' },
  filtChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filtChipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub, flexShrink: 1 },
  filtChipTextActive: { color: '#fff', fontFamily: 'Inter_600SemiBold' },

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
  fabAction: {
    minWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0px 2px 10px rgba(0,0,0,0.12)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 7, elevation: 5 },
    }),
  },
  fabActionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
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
  detailWorkflowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  detailWorkflowBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
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
    backgroundColor: '#FEF3C7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    marginBottom: 6, borderWidth: 1, borderColor: '#FCD34D',
  },
  deadlineReminderBannerActive: {
    backgroundColor: '#FFFBEB', borderColor: '#D97706',
  },
  deadlineReminderText: {
    flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: '#92400E',
  },

  archiveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    marginBottom: 6, borderWidth: 1, borderColor: '#D1D5DB',
  },
  archiveBannerActive: {
    backgroundColor: '#E5E7EB', borderColor: '#9CA3AF',
  },
  archiveBannerText: {
    flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub,
  },

  progressBanner: {
    backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
    marginBottom: 6, borderWidth: 1, borderColor: C.border,
  },
  progressTextRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4,
  },
  progressLabel: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub,
  },
  progressPct: {
    fontSize: 13, fontFamily: 'Inter_700Bold',
  },
  progressTrack: {
    height: 4, borderRadius: 2, backgroundColor: C.border, overflow: 'hidden',
  },
  progressFill: {
    height: 4, borderRadius: 2,
  },
  workflowSummaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  workflowSummaryTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
  },
  workflowSummaryTitleText: {
    fontSize: 11,
    fontFamily: 'Inter_800ExtraBold',
    color: C.text,
  },
  workflowSummaryChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 2,
  },
  workflowSummaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: C.surface,
  },
  workflowSummaryChipText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  workflowSummaryMore: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  workflowSummaryMoreText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
  },
  contextIdWrap: {
    backgroundColor: C.primaryBg, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, flexShrink: 0,
  },
  contextId: {
    fontSize: 11, fontFamily: 'Inter_700Bold', color: C.primary, letterSpacing: 0.5,
  },
  contextTitle: {
    flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginLeft: 8,
  },
  contextItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: C.border + '60',
  },
  contextItemDanger: {},
  contextItemIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border,
    flexShrink: 0,
  },
  contextItemText: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: C.text,
  },
  actionItemHint: {
    marginTop: 2,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: C.textMuted,
  },
  contextBackBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 4, marginBottom: 4,
  },
  contextBackText: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary,
  },
});
