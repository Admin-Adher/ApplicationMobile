import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList, Platform,
  Modal, PanResponder, Animated, Image, KeyboardAvoidingView,
  ActivityIndicator, Alert, TextInput, useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import { TABLET_RESERVE_PANEL_W } from '@/lib/useTablet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Reserve, SitePlan, ReserveStatus } from '@/constants/types';
import StatusBadge from '@/components/StatusBadge';
import { STATUS_CONFIG } from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import { uploadDocument } from '@/lib/storage';
import { genId, formatDateFR } from '@/lib/utils';
import { parseDxf, DxfParseResult } from '@/lib/dxfParser';
import { openChantierSwitcher } from '@/components/ChantierSwitcherSheet';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import PdfPlanViewer, { type PdfPlanViewerHandle } from '@/components/PdfPlanViewer';
import DxfCanvasOverlay from '@/components/plans/DxfCanvasOverlay';
import FiltersSheet from '@/components/plans/FiltersSheet';
import ReservesSheet from '@/components/plans/ReservesSheet';

const HINT_KEY = 'plans_hint_seen';
const PIN_SIZE_KEY = 'plans_pin_size_scale';
const PIN_SIZES_KEY = 'plans_pin_sizes_v2';

const STATUS_ORDER: ReserveStatus[] = ['open', 'in_progress', 'waiting', 'verification', 'closed'];

interface PinCluster {
  cx: number; cy: number;
  items: Reserve[];
  dominantStatus: string;
  dominantCompany: string;
  number: number;
}

function computeClusters(reserves: Reserve[], scale: number, numberMap: Map<string, number>): PinCluster[] {
  const threshold = 8.33 / Math.max(scale, 0.3);
  const pins = reserves.filter(r => r.planX != null && r.planY != null);
  if (pins.length === 0) return [];
  const cellSize = threshold;
  const grid = new Map<string, Reserve[]>();
  const cellKey = (gx: number, gy: number) => `${gx},${gy}`;
  for (const r of pins) {
    const gx = Math.floor(r.planX! / cellSize);
    const gy = Math.floor(r.planY! / cellSize);
    const k = cellKey(gx, gy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(r);
  }
  const assigned = new Set<string>();
  const clusters: PinCluster[] = [];
  const STO: Record<string, number> = { open: 0, in_progress: 1, waiting: 2, verification: 3, closed: 4 };
  for (const r of pins) {
    if (assigned.has(r.id)) continue;
    const group: Reserve[] = [];
    const queue: Reserve[] = [r];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      if (assigned.has(cur.id)) continue;
      assigned.add(cur.id);
      group.push(cur);
      const gx = Math.floor(cur.planX! / cellSize);
      const gy = Math.floor(cur.planY! / cellSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighbors = grid.get(cellKey(gx + dx, gy + dy));
          if (!neighbors) continue;
          for (const n of neighbors) {
            if (assigned.has(n.id)) continue;
            const d = Math.sqrt(Math.pow(cur.planX! - n.planX!, 2) + Math.pow(cur.planY! - n.planY!, 2));
            if (d < threshold) queue.push(n);
          }
        }
      }
    }
    const cx = group.reduce((s, g) => s + g.planX!, 0) / group.length;
    const cy = group.reduce((s, g) => s + g.planY!, 0) / group.length;
    const dominant = group.reduce((prev, cur) =>
      (STO[cur.status] ?? 9) < (STO[prev.status] ?? 9) ? cur : prev
    );
    const uniqueCompanies = new Set(group.map(g => g.company));
    const dominantCompany = uniqueCompanies.size === 1 ? group[0].company : '__mixed__';
    clusters.push({ cx, cy, items: group, dominantStatus: dominant.status, dominantCompany, number: numberMap.get(r.id) ?? clusters.length + 1 });
  }
  return clusters;
}

const STATUS_COLORS: Record<string, string> = {
  open: '#EF4444', in_progress: '#F59E0B', waiting: '#6B7280',
  verification: '#8B5CF6', closed: '#10B981',
};

function getCompanyColor(companyName: string, companies: Array<{ name: string; color: string }>): string {
  if (!companyName || companyName === '__mixed__') return '#6B7280';
  return companies.find(c => c.name === companyName)?.color ?? '#003082';
}

function isPdf(uri?: string | null): boolean {
  if (!uri) return false;
  return uri.toLowerCase().includes('.pdf') || uri.includes('application/pdf');
}

function isPlanPdf(plan?: SitePlan | null): boolean {
  if (!plan) return false;
  if (plan.fileType === 'pdf') return true;
  return isPdf(plan.uri);
}

function isImage(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext);
}

function formatSize(bytes: number | undefined): string {
  if (!bytes) return '?';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

async function fetchAsDataUrl(uri: string): Promise<string> {
  try {
    const resp = await fetch(uri);
    if (!resp.ok) throw new Error('fetch failed');
    const blob = await resp.blob();
    return await new Promise<string>((res, rej) => {
      const reader = new FileReader();
      reader.onloadend = () => res(reader.result as string);
      reader.onerror = rej;
      reader.readAsDataURL(blob);
    });
  } catch {
    return uri;
  }
}

async function exportPlanPDF(
  planName: string,
  chantierName: string,
  reserves: Reserve[],
  numberMap: Map<string, number>,
  planUri?: string | null,
  fileType?: 'pdf' | 'image' | 'dxf' | null,
  pinSizeScale: number = 1.0,
  companiesForColor: Array<{ name: string; color: string }> = [],
) {
  const STATUS_FR: Record<string, string> = {
    open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente',
    verification: 'Vérification', closed: 'Clôturé',
  };
  const PRIORITY_FR: Record<string, string> = {
    critical: 'Critique', high: 'Haute', medium: 'Moyenne', low: 'Basse',
  };
  const pinsWithCoords = reserves.filter(r => r.planX != null && r.planY != null);

  // Pass raw percentages so canvas script can apply them to the actual rendered dimensions
  const pinData = pinsWithCoords.map(r => ({
    pctX: r.planX!,
    pctY: r.planY!,
    n: numberMap.get(r.id) ?? 0,
    color: getCompanyColor(r.company, companiesForColor),
  }));

  const rows = reserves.map(r => {
    const n = numberMap.get(r.id) ?? '—';
    const color = getCompanyColor(r.company, companiesForColor);
    return `<tr>
      <td style="text-align:center;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:11px;">${n}</span></td>
      <td style="font-weight:600;">${r.title}</td>
      <td>${r.company || '—'}</td>
      <td>${r.level || '—'}</td>
      <td><span style="color:${color};font-weight:600;">${STATUS_FR[r.status] || r.status}</span></td>
      <td>${PRIORITY_FR[r.priority] || r.priority}</td>
      <td>${r.deadline || '—'}</td>
    </tr>`;
  }).join('');

  // Pre-fetch plan as data URL to avoid CORS issues in the export popup
  let exportUri = planUri ?? null;
  if (planUri && Platform.OS === 'web') {
    exportUri = await fetchAsDataUrl(planUri);
  }

  const hasPins = pinsWithCoords.length > 0;
  const hasPlan = !!exportUri;
  const isPdf = fileType === 'pdf';
  const RENDER_W = 720;
  // Pin radius and font scale with the user's chosen pinSizeScale (base radius = 10px at 720px wide)
  const PIN_R = Math.max(5, Math.round(10 * pinSizeScale));
  const PIN_FONT = Math.max(7, Math.round(9 * pinSizeScale));

  // Canvas rendering script — runs inside the export iframe/window
  const canvasScript = hasPins ? `(function(){
var canvas=document.getElementById('plan-canvas');
var ctx=canvas.getContext('2d');
var RENDER_W=${RENDER_W};
var planUri=${hasPlan ? JSON.stringify(exportUri) : 'null'};
var isPdf=${isPdf ? 'true' : 'false'};
var pins=${JSON.stringify(pinData)};
var PIN_R=${PIN_R};
var PIN_FONT=${PIN_FONT};

function drawPins(W,H){
  pins.forEach(function(p){
    var x=(p.pctX/100)*W,y=(p.pctY/100)*H;
    ctx.beginPath();ctx.arc(x,y,PIN_R,0,Math.PI*2);
    ctx.fillStyle=p.color;ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.85)';ctx.lineWidth=Math.max(1,PIN_R*0.18);ctx.stroke();
    ctx.fillStyle='#fff';ctx.font='bold '+PIN_FONT+'px Arial';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(String(p.n),x,y);
  });
}

function drawFallback(){
  ctx.fillStyle='#0F1825';ctx.fillRect(0,0,canvas.width,canvas.height);
  drawPins(canvas.width,canvas.height);
}

if(!planUri){drawFallback();return;}

if(isPdf){
  // Use PDF.js to render the first page
  var PDFJS_CDN='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var script=document.createElement('script');
  script.src=PDFJS_CDN;
  script.onload=function(){
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    // Support both data URLs (pre-fetched) and remote URLs
    var docSrc=planUri.startsWith('data:')
      ?{data:atob(planUri.split(',')[1])}
      :{url:planUri,withCredentials:false};
    pdfjsLib.getDocument(docSrc).promise.then(function(doc){
      doc.getPage(1).then(function(page){
        var vp1=page.getViewport({scale:1});
        var scale=RENDER_W/vp1.width;
        var vp=page.getViewport({scale:scale});
        canvas.width=Math.round(vp.width);
        canvas.height=Math.round(vp.height);
        page.render({canvasContext:ctx,viewport:vp}).promise.then(function(){
          drawPins(canvas.width,canvas.height);
        });
      });
    }).catch(drawFallback);
  };
  script.onerror=drawFallback;
  document.head.appendChild(script);
} else {
  // Image plan — data URL avoids any CORS restriction
  var img=new Image();
  if(!planUri.startsWith('data:'))img.crossOrigin='anonymous';
  img.onload=function(){
    var h=Math.round(RENDER_W*(img.naturalHeight/img.naturalWidth));
    canvas.width=RENDER_W;canvas.height=h;
    ctx.drawImage(img,0,0,RENDER_W,h);
    drawPins(RENDER_W,h);
  };
  img.onerror=drawFallback;
  img.src=planUri;
}
})();` : '';

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Plan : ${planName}</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;padding:28px;color:#111;background:#fff;}.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;}.hdr-l h1{color:#003082;font-size:20px;margin-bottom:4px;}.hdr-l .meta{color:#666;font-size:12px;}.hdr-r{text-align:right;font-size:11px;color:#999;}.sec{margin-bottom:24px;}canvas{width:100%;height:auto;border-radius:8px;display:block;border:1px solid #e5e7eb;background:#0F1825;}.leg{font-size:11px;color:#888;margin-top:6px;}table{width:100%;border-collapse:collapse;font-size:12px;}th{background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}td{padding:7px 10px;border-bottom:1px solid #f0f0f0;vertical-align:middle;}tr:nth-child(even) td{background:#f8fafc;}.stitle{font-size:13px;font-weight:700;color:#003082;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;border-bottom:2px solid #003082;padding-bottom:4px;}.footer{margin-top:28px;font-size:10px;color:#bbb;text-align:center;border-top:1px solid #eee;padding-top:12px;}@media print{body{padding:0;}@page{margin:16mm;}}</style>
</head><body>
<div class="hdr"><div class="hdr-l"><h1>Plan : ${planName}</h1><div class="meta">Chantier : <strong>${chantierName}</strong> &nbsp;·&nbsp; ${reserves.length} réserve${reserves.length !== 1 ? 's' : ''}</div></div>
<div class="hdr-r">Exporté le ${new Date().toLocaleDateString('fr-FR')}<br>BuildTrack</div></div>
${hasPins ? `<div class="sec"><div class="stitle">Plan annoté</div><canvas id="plan-canvas" width="${RENDER_W}" height="${Math.round(RENDER_W * 0.6)}"></canvas><div class="leg">Les numéros correspondent aux réserves du tableau ci-dessous.</div></div>` : ''}
<div class="stitle">Liste des réserves</div>
<table><thead><tr><th>#</th><th>Titre</th><th>Entreprise</th><th>Niveau</th><th>Statut</th><th>Priorité</th><th>Échéance</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#999;padding:20px;">Aucune réserve sur ce plan</td></tr>'}</tbody></table>
<div class="footer">BuildTrack — Gestion de chantier numérique — ${new Date().toLocaleDateString('fr-FR')}</div>
${hasPins ? `<script>${canvasScript}<\/script>` : ''}
</body></html>`;

  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    if (win) {
      win.document.open(); win.document.write(html); win.document.close();
      // Give scripts (PDF.js) time to load before printing
      setTimeout(() => { try { win.print(); } catch {} }, isPdf ? 2500 : 600);
    }
  } else {
    try {
      await Print.printAsync({ html });
    } catch {
      Alert.alert('Erreur', "Impossible d'imprimer le PDF.");
    }
  }
}

export default function PlansScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    reserves, companies, sitePlans, activeChantierId, activeChantier,
    addSitePlan, updateSitePlan, deleteSitePlan, addSitePlanVersion, migrateReservesToPlan,
    updateReserveStatus, updateReserveFields,
  } = useApp();
  const { permissions, user } = useAuth();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const topPad = insets.top;

  const chantierPlans = useMemo(
    () => sitePlans.filter(p => p.chantierId === activeChantierId),
    [sitePlans, activeChantierId]
  );

  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [selected, setSelected] = useState<Reserve | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [importing, setImporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [dxfData, setDxfData] = useState<Record<string, DxfParseResult>>({});
  const [visibleLayers, setVisibleLayers] = useState<Record<string, string[]>>({});
  const [showQRModal, setShowQRModal] = useState<{ x: number; y: number } | null>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const [newPlanModal, setNewPlanModal] = useState<{ visible: boolean; name: string; building: string; level: string }>({
    visible: false, name: '', building: '', level: '',
  });
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [revisionModal, setRevisionModal] = useState<{ visible: boolean; code: string; note: string }>({ visible: false, code: '', note: '' });
  const [highlightedReserveId, setHighlightedReserveId] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<'list' | 'detail'>('list');
  const [pdfZoomPct, setPdfZoomPct] = useState<number>(100);
  const [fullscreen, setFullscreen] = useState(false);
  const [hintSeen, setHintSeen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [planDimensions, setPlanDimensions] = useState({ width: 320, height: 240 });
  const [pinSizeScale, setPinSizeScale] = useState(1.0);
  const [pinSizes, setPinSizes] = useState<Record<string, number>>({});
  const [focusedPinId, setFocusedPinId] = useState<string | null>(null);
  const [draggingPinState, setDraggingPinState] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dxfLoading, setDxfLoading] = useState(false);

  const pdfViewerRef = useRef<PdfPlanViewerHandle>(null);
  const reserveListRef = useRef<FlatList<Reserve> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(HINT_KEY).then(v => { if (v === '1') setHintSeen(true); });
    AsyncStorage.getItem(PIN_SIZE_KEY).then(v => { if (v) { const n = parseFloat(v); if (!isNaN(n)) setPinSizeScale(n); } });
    AsyncStorage.getItem(PIN_SIZES_KEY).then(v => { if (v) { try { setPinSizes(JSON.parse(v)); } catch {} } });
  }, []);

  useEffect(() => {
    setActivePlanId(null);
    setSelectedBuilding('all');
    setSelectedLevel('all');
    setStatusFilter('all');
    setCompanyFilter('all');
    setLevelFilter('all');
  }, [activeChantierId]);

  function dismissHint() {
    setHintSeen(true);
    AsyncStorage.setItem(HINT_KEY, '1');
  }

  function changePinSize(delta: number) {
    // Use ref to always read the latest focusedPinId — avoids stale closure when called immediately after long-press
    const pinId = focusedPinIdRef.current;
    if (pinId) {
      setPinSizes(prev => {
        const current = prev[pinId] ?? 1.0;
        const next = Math.min(3.0, Math.max(0.4, parseFloat((current + delta).toFixed(2))));
        const updated = { ...prev, [pinId]: next };
        AsyncStorage.setItem(PIN_SIZES_KEY, JSON.stringify(updated));
        return updated;
      });
      if (focusedPinTimerRef.current) clearTimeout(focusedPinTimerRef.current);
      focusedPinTimerRef.current = setTimeout(() => setFocusedPinIdRef.current(null), 5000);
    } else {
      setPinSizeScale(prev => {
        const next = Math.min(2.5, Math.max(0.5, parseFloat((prev + delta).toFixed(2))));
        AsyncStorage.setItem(PIN_SIZE_KEY, String(next));
        return next;
      });
    }
  }

  function getPinDisplaySize(id: string, base: number): number {
    const individualScale = pinSizes[id] ?? 1.0;
    return Math.round(base * individualScale);
  }

  const buildings = useMemo(() => {
    const b = Array.from(new Set(chantierPlans.map(p => p.building).filter(Boolean))) as string[];
    return b.sort();
  }, [chantierPlans]);

  const planLevelsForBuilding = useMemo(() => {
    const scope = selectedBuilding === 'all' ? chantierPlans : chantierPlans.filter(p => (p.building ?? '') === selectedBuilding);
    const lvls = Array.from(new Set(scope.map(p => p.level).filter(Boolean))) as string[];
    return lvls.sort();
  }, [chantierPlans, selectedBuilding]);

  const filteredPlans = useMemo(() => {
    let plans = chantierPlans;
    if (selectedBuilding !== 'all' && buildings.length >= 2) plans = plans.filter(p => (p.building ?? '') === selectedBuilding);
    if (selectedLevel !== 'all' && planLevelsForBuilding.length >= 2) plans = plans.filter(p => (p.level ?? '') === selectedLevel);
    return plans;
  }, [chantierPlans, selectedBuilding, buildings, selectedLevel, planLevelsForBuilding]);

  const currentPlanId = activePlanId ?? filteredPlans[0]?.id ?? chantierPlans[0]?.id ?? null;
  const currentPlan = chantierPlans.find(p => p.id === currentPlanId) ?? null;

  const allPlanReserves = useMemo(
    () => reserves.filter(r => r.planId === currentPlanId),
    [reserves, currentPlanId]
  );
  const pinNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    const sorted = [...allPlanReserves].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    sorted.forEach((r, i) => map.set(r.id, i + 1));
    return map;
  }, [allPlanReserves]);

  const planReserves = useMemo(() => {
    let list = allPlanReserves;
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter);
    if (companyFilter !== 'all') list = list.filter(r => r.company === companyFilter);
    if (levelFilter !== 'all') list = list.filter(r => r.level === levelFilter);
    return list;
  }, [allPlanReserves, statusFilter, companyFilter, levelFilter]);

  const pinSize = Math.round((isTablet ? 48 : 44) * pinSizeScale);
  const clusterSize = Math.round((isTablet ? 60 : 52) * pinSizeScale);
  const dynW = planDimensions.width;
  const dynH = planDimensions.height;

  const pinClusters = useMemo(
    () => computeClusters(planReserves, displayScale, pinNumberMap),
    [planReserves, displayScale, pinNumberMap]
  );
  const ghostReserves = useMemo(() => {
    const activeIds = new Set(planReserves.map(r => r.id));
    return allPlanReserves.filter(r => !activeIds.has(r.id));
  }, [allPlanReserves, planReserves]);
  const ghostClusters = useMemo(
    () => computeClusters(ghostReserves, displayScale, pinNumberMap),
    [ghostReserves, displayScale, pinNumberMap]
  );

  const activeFilters = [statusFilter, companyFilter, levelFilter].filter(f => f !== 'all').length
    + (selectedBuilding !== 'all' ? 1 : 0)
    + (selectedLevel !== 'all' ? 1 : 0);

  const planLevels = useMemo(() => {
    const lvls = reserves.filter(r => r.planId === currentPlanId).map(r => r.level);
    return Array.from(new Set(lvls)).filter(Boolean).sort() as string[];
  }, [reserves, currentPlanId]);

  const currentDxfLayers = currentPlanId && dxfData[currentPlanId]
    ? dxfData[currentPlanId].layers : [];
  const currentVisibleLayers = currentPlanId ? (visibleLayers[currentPlanId] ?? []) : [];

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const lastScale = useRef(1);
  const committedTX = useRef(0);
  const committedTY = useRef(0);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const isDraggingRef = useRef(false);
  const suppressNextPlanTapRef = useRef(false);
  const suppressPlanTapUntilRef = useRef<number>(0);
  const isPinchingRef = useRef(false);
  const pinchStartDistRef = useRef(0);
  const pinchStartScaleRef = useRef(1);

  const draggingPinIdRef = useRef<string | null>(null);
  const draggingPinStartRef = useRef<{ cx: number; cy: number } | null>(null);
  const draggingPinPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggingPinMovedRef = useRef(false);
  const longPressTimeRef = useRef<number>(0);
  const dynWRef = useRef(320);
  const dynHRef = useRef(240);
  const reservesRef = useRef(reserves);
  const updateReserveFieldsRef = useRef(updateReserveFields);
  const focusedPinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setDraggingPinStateRef = useRef(setDraggingPinState);
  const setFocusedPinIdRef = useRef(setFocusedPinId);
  const setPinSizesRef = useRef(setPinSizes);
  const pinSizesRef = useRef(pinSizes);
  // Always-current mirror of focusedPinId state — used inside callbacks to avoid stale closures
  const focusedPinIdRef = useRef<string | null>(null);

  React.useEffect(() => { reservesRef.current = reserves; }, [reserves]);
  React.useEffect(() => { updateReserveFieldsRef.current = updateReserveFields; }, [updateReserveFields]);
  React.useEffect(() => { pinSizesRef.current = pinSizes; }, [pinSizes]);
  React.useEffect(() => { focusedPinIdRef.current = focusedPinId; }, [focusedPinId]);

  // Auto-load DXF when plan has fileType=dxf and is not yet parsed in memory
  React.useEffect(() => {
    if (!currentPlanId || !currentPlan?.uri || currentPlan.fileType !== 'dxf') return;
    if (dxfData[currentPlanId]) return;
    setDxfLoading(true);
    fetch(currentPlan.uri)
      .then(r => r.text())
      .then(text => {
        const parsed = parseDxf(text);
        if (parsed.entities.length > 0) {
          setDxfData(prev => ({ ...prev, [currentPlanId]: parsed }));
        }
      })
      .catch(() => {})
      .finally(() => setDxfLoading(false));
  }, [currentPlanId, currentPlan?.uri, currentPlan?.fileType]);

  function getPinchDist(touches: any[]) {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // Capture phase: fires before children, lets parent steal drag after long-press on Android
      onMoveShouldSetPanResponderCapture: (e, gs) => {
        if (draggingPinIdRef.current) {
          const age = Date.now() - longPressTimeRef.current;
          if (age > 3000) {
            draggingPinIdRef.current = null;
            draggingPinPosRef.current = null;
            draggingPinMovedRef.current = false;
            return false;
          }
          const dist = Math.abs(gs.dx) + Math.abs(gs.dy);
          return dist > 4;
        }
        return false;
      },
      onMoveShouldSetPanResponder: (e, gs) => {
        if (draggingPinIdRef.current) {
          // Expire stale drag state (long-press fired but user released without moving)
          if (Date.now() - longPressTimeRef.current > 3000) {
            draggingPinIdRef.current = null;
            draggingPinPosRef.current = null;
            draggingPinMovedRef.current = false;
          } else {
            return true;
          }
        }
        if (e.nativeEvent.touches.length === 2) return true;
        return Math.abs(gs.dx) + Math.abs(gs.dy) > 4;
      },
      onPanResponderGrant: (e) => {
        touchStartXRef.current = e.nativeEvent.pageX;
        touchStartYRef.current = e.nativeEvent.pageY;
        isDraggingRef.current = false;
        isPinchingRef.current = false;
        pinchStartDistRef.current = 0;
        draggingPinMovedRef.current = false;
      },
      onPanResponderMove: (e, gs) => {
        if (draggingPinIdRef.current) {
          // Require at least 10px of movement before treating as a real drag
          const dragDist = Math.sqrt(gs.dx * gs.dx + gs.dy * gs.dy);
          if (dragDist > 10) {
            draggingPinMovedRef.current = true;
          }
          if (draggingPinMovedRef.current) {
            isDraggingRef.current = true;
            const s = lastScale.current;
            const newX = Math.min(100, Math.max(0, draggingPinStartRef.current!.cx + (gs.dx / dynWRef.current / s) * 100));
            const newY = Math.min(100, Math.max(0, draggingPinStartRef.current!.cy + (gs.dy / dynHRef.current / s) * 100));
            draggingPinPosRef.current = { x: newX, y: newY };
            setDraggingPinStateRef.current({ id: draggingPinIdRef.current, x: newX, y: newY });
          }
          return;
        }
        const touches = e.nativeEvent.touches;
        if (touches.length === 2) {
          isPinchingRef.current = true;
          isDraggingRef.current = true;
          const dist = getPinchDist(touches);
          if (pinchStartDistRef.current === 0) { pinchStartDistRef.current = dist; pinchStartScaleRef.current = lastScale.current; return; }
          const rawScale = (dist / pinchStartDistRef.current) * pinchStartScaleRef.current;
          const clamped = Math.min(4, Math.max(0.4, rawScale));
          lastScale.current = clamped; scale.setValue(clamped); return;
        }
        pinchStartDistRef.current = 0;
        if (Math.abs(gs.dx) + Math.abs(gs.dy) > 6) isDraggingRef.current = true;
        translateX.setValue(committedTX.current + gs.dx);
        translateY.setValue(committedTY.current + gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (draggingPinIdRef.current) {
          const pinId = draggingPinIdRef.current;
          const moved = draggingPinMovedRef.current;
          const finalPos = draggingPinPosRef.current;
          draggingPinIdRef.current = null;
          draggingPinPosRef.current = null;
          draggingPinMovedRef.current = false;
          setDraggingPinStateRef.current(null);
          // Clear timestamp suppress so regular taps work immediately after drag
          suppressPlanTapUntilRef.current = 0;
          if (moved && finalPos) {
            const reserve = reservesRef.current.find(r => r.id === pinId);
            if (reserve) {
              updateReserveFieldsRef.current({ ...reserve, planX: Math.round(finalPos.x), planY: Math.round(finalPos.y) });
            }
          } else {
            setFocusedPinIdRef.current(pinId);
            if (focusedPinTimerRef.current) clearTimeout(focusedPinTimerRef.current);
            focusedPinTimerRef.current = setTimeout(() => { setFocusedPinIdRef.current(null); }, 5000);
          }
          setTimeout(() => { isDraggingRef.current = false; }, 80);
          return;
        }
        if (isPinchingRef.current) {
          pinchStartDistRef.current = 0; isPinchingRef.current = false;
          setDisplayScale(lastScale.current);
          setTimeout(() => { isDraggingRef.current = false; }, 80); return;
        }
        committedTX.current = committedTX.current + gs.dx;
        committedTY.current = committedTY.current + gs.dy;
        setTimeout(() => { isDraggingRef.current = false; }, 50);
      },
      // System cancelled the gesture (incoming call, notification, etc.) — always clean up
      onPanResponderTerminate: () => {
        if (draggingPinIdRef.current) {
          draggingPinIdRef.current = null;
          draggingPinPosRef.current = null;
          draggingPinMovedRef.current = false;
          setDraggingPinStateRef.current(null);
          suppressPlanTapUntilRef.current = 0;
        }
        isPinchingRef.current = false;
        pinchStartDistRef.current = 0;
        isDraggingRef.current = false;
      },
      onPanResponderTerminationRequest: () => true,
    })
  ).current;

  function zoomIn() {
    const next = Math.min(lastScale.current * 1.3, 4);
    lastScale.current = next; setDisplayScale(next);
    Animated.spring(scale, { toValue: next, useNativeDriver: true }).start();
  }
  function zoomOut() {
    const next = Math.max(lastScale.current / 1.3, 0.5);
    lastScale.current = next; setDisplayScale(next);
    Animated.spring(scale, { toValue: next, useNativeDriver: true }).start();
  }
  function resetView() {
    lastScale.current = 1; committedTX.current = 0; committedTY.current = 0;
    setDisplayScale(1);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }

  function handlePlanTap(e: any) {
    if (suppressNextPlanTapRef.current) { suppressNextPlanTapRef.current = false; return; }
    if (Date.now() < suppressPlanTapUntilRef.current) return;
    if (isDraggingRef.current) return;
    if (focusedPinId) { setFocusedPinId(null); return; }
    if (!permissions.canCreate) return;
    const { locationX, locationY, pageX, pageY } = e.nativeEvent;
    const totalMove = Math.abs((pageX ?? 0) - touchStartXRef.current) + Math.abs((pageY ?? 0) - touchStartYRef.current);
    if (totalMove > 8) return;
    if (locationX === undefined || locationY === undefined) return;
    const px = Math.min(100, Math.max(0, Math.round((locationX / dynW) * 100)));
    const py = Math.min(100, Math.max(0, Math.round((locationY / dynH) * 100)));
    router.push({
      pathname: '/reserve/new',
      params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '', planX: String(px), planY: String(py) },
    } as any);
  }

  function handleWebPlanClick(e: any) {
    if (suppressNextPlanTapRef.current) { suppressNextPlanTapRef.current = false; return; }
    if (Date.now() < suppressPlanTapUntilRef.current) return;
    if (isDraggingRef.current) return;
    if (focusedPinId) { setFocusedPinId(null); return; }
    if (!permissions.canCreate) return;
    const rect = e.currentTarget?.getBoundingClientRect?.();
    if (!rect) return;
    const locationX = e.clientX - rect.left;
    const locationY = e.clientY - rect.top;
    const px = Math.min(100, Math.max(0, Math.round((locationX / dynW) * 100)));
    const py = Math.min(100, Math.max(0, Math.round((locationY / dynH) * 100)));
    router.push({
      pathname: '/reserve/new',
      params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '', planX: String(px), planY: String(py) },
    } as any);
  }

  function handleSelectPlan(planId: string) {
    setActivePlanId(planId);
    setDisplayScale(1);
    lastScale.current = 1;
    committedTX.current = 0; committedTY.current = 0;
    scale.setValue(1); translateX.setValue(0); translateY.setValue(0);
    setCompanyFilter('all'); setLevelFilter('all'); setStatusFilter('all');
  }

  async function handleImportPlan() {
    if (!currentPlanId || !currentPlan) return;
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true, multiple: false,
        type: ['image/*', 'application/pdf', '*/*'],
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const docName = asset.name;
        const docExt = docName.split('.').pop()?.toLowerCase() ?? '';
        const isImg = isImage(docName);
        const isPdfFile = docExt === 'pdf';
        const isDxf = docExt === 'dxf';
        if (!isImg && !isPdfFile && !isDxf) {
          Alert.alert('Format non supporté', 'Importez une image (JPG, PNG), un PDF ou un fichier AutoCAD (.dxf).');
          return;
        }
        if (isDxf) {
          const dxfResp = await fetch(asset.uri);
          const dxfText = await dxfResp.text();
          const parsed = parseDxf(dxfText);
          if (parsed.entities.length === 0) {
            Alert.alert('DXF vide', "Le fichier DXF ne contient aucune entité reconnue.");
            return;
          }
          const storageUrl = await uploadDocument(asset.uri, `plan_dxf_${currentPlanId}_${docName}`, 'application/octet-stream');
          const dxfUri = storageUrl ?? asset.uri;
          setDxfData(prev => ({ ...prev, [currentPlanId]: parsed }));
          updateSitePlan({ ...currentPlan, uri: dxfUri, fileType: 'dxf', dxfName: docName, size: formatSize(asset.size) });
          if (storageUrl) {
            Alert.alert('Plan DXF importé ✓', `${parsed.entities.length} entités chargées depuis "${docName}".`);
          } else {
            Alert.alert('Plan DXF importé (local uniquement)', `${parsed.entities.length} entités chargées depuis "${docName}".\n\nLe fichier n'a pas pu être uploadé sur le serveur : le plan sera visible sur cet appareil uniquement.`, [{ text: 'OK' }]);
          }
          return;
        }
        const storageUrl = await uploadDocument(asset.uri, `plan_${currentPlanId}_${docName}`, asset.mimeType ?? undefined);
        const finalUri = storageUrl ?? asset.uri;
        updateSitePlan({ ...currentPlan, uri: finalUri, fileType: isPdfFile ? 'pdf' : 'image', size: formatSize(asset.size) });
        if (storageUrl) {
          Alert.alert('Plan importé ✓', 'Fichier uploadé sur le serveur. Il sera disponible sur tous vos appareils.');
        } else {
          Alert.alert('Plan importé (local uniquement)', 'Le fichier n\'a pas pu être uploadé sur le serveur. Le plan sera visible sur cet appareil uniquement et pourrait disparaître si le cache est effacé.\n\nVérifiez votre connexion ou les droits d\'accès Supabase.', [{ text: 'OK' }]);
        }
      }
    } catch {
      Alert.alert('Erreur', "Impossible d'importer le plan.");
    } finally {
      setImporting(false);
    }
  }

  function handleRemovePlan() {
    if (!currentPlan?.uri) return;
    Alert.alert('Remplacer le plan importé ?', 'Le plan actuel sera remplacé.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Remplacer', style: 'destructive', onPress: handleImportPlan },
    ]);
  }

  function openRevisionModal() {
    if (!currentPlan) return;
    const siblings = chantierPlans.filter(p => p.id === currentPlan.id || p.parentPlanId === currentPlan.id || currentPlan.parentPlanId === p.id);
    const nextCode = `R${String(siblings.length + 1).padStart(2, '0')}`;
    setRevisionModal({ visible: true, code: nextCode, note: '' });
    setShowVersionHistory(false);
  }

  async function handleCreateRevision() {
    if (!currentPlan || !revisionModal.code.trim()) return;
    setImporting(true);
    setRevisionModal(prev => ({ ...prev, visible: false }));
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: ['image/*', 'application/pdf', '*/*'] });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const docExt = asset.name.split('.').pop()?.toLowerCase() ?? '';
        if (!isImage(asset.name) && docExt !== 'pdf' && docExt !== 'dxf') {
          Alert.alert('Format non supporté', 'Importez une image, un PDF ou un DXF.');
          return;
        }
        const storageUrl = await uploadDocument(asset.uri, `plan_rev_${genId()}_${asset.name}`, asset.mimeType ?? undefined);
        if (!storageUrl) {
          Alert.alert('Attention — stockage local', 'Le fichier de révision n\'a pas pu être uploadé sur le serveur. Il sera visible sur cet appareil uniquement.\n\nVérifiez votre connexion ou les droits d\'accès Supabase.', [{ text: 'Continuer' }]);
        }
        const finalUri = storageUrl ?? asset.uri;
        const revDocExt = asset.name.split('.').pop()?.toLowerCase() ?? '';
        const newPlan: SitePlan = {
          id: genId(), chantierId: currentPlan.chantierId,
          name: `${currentPlan.name} — ${revisionModal.code.trim()}`,
          building: currentPlan.building, level: currentPlan.level,
          uri: finalUri, fileType: revDocExt === 'pdf' ? 'pdf' : isImage(asset.name) ? 'image' : 'dxf',
          size: formatSize(asset.size), uploadedAt: formatDateFR(new Date()),
          revisionCode: revisionModal.code.trim(),
          revisionNote: revisionModal.note.trim() || undefined,
          parentPlanId: currentPlan.id, isLatestRevision: true,
        };
        addSitePlanVersion(currentPlan.id, newPlan);
        setActivePlanId(newPlan.id);
        const openMarkersCount = reserves.filter(r => r.planId === currentPlan.id && r.status !== 'closed').length;
        if (openMarkersCount > 0) {
          Alert.alert('Révision créée ✓', `Révision ${revisionModal.code.trim()} créée.\n\n${openMarkersCount} marqueur${openMarkersCount > 1 ? 's' : ''} ouvert${openMarkersCount > 1 ? 's' : ''} détecté${openMarkersCount > 1 ? 's' : ''}.\n\nMigrer vers la nouvelle révision ?`, [
            { text: 'Ignorer', style: 'cancel' },
            { text: `Migrer (${openMarkersCount})`, onPress: () => {
              const count = migrateReservesToPlan(currentPlan.id, newPlan.id);
              Alert.alert('Migration terminée ✓', `${count} marqueur${count > 1 ? 's' : ''} migré${count > 1 ? 's' : ''}.`);
            }},
          ]);
        } else {
          Alert.alert('Révision créée ✓', `Révision ${revisionModal.code.trim()} créée.`);
        }
      }
    } catch { Alert.alert('Erreur', "Impossible de créer la révision."); }
    finally { setImporting(false); }
  }

  function handleAddPlan() {
    if (!activeChantierId) return;
    setNewPlanModal({ visible: true, name: '', building: '', level: '' });
  }

  function handleConfirmNewPlan() {
    if (!activeChantierId || !newPlanModal.name.trim()) return;
    const newPlan: SitePlan = {
      id: genId(), chantierId: activeChantierId,
      name: newPlanModal.name.trim(),
      building: newPlanModal.building.trim() || undefined,
      level: newPlanModal.level.trim() || undefined,
      uploadedAt: formatDateFR(new Date()),
    };
    addSitePlan(newPlan);
    setActivePlanId(newPlan.id);
    setNewPlanModal({ visible: false, name: '', building: '', level: '' });
  }

  const isPlanFile = !!(currentPlan?.uri) && currentPlan?.fileType !== 'dxf';
  const isPlanPdfPlan = isPlanPdf(currentPlan);
  const isImagePlan = currentPlan?.fileType === 'image' || (!!currentPlan?.uri && !isPlanPdfPlan && currentPlan?.fileType !== 'dxf' && isImage(currentPlan.uri!));
  const hasDxf = !!(currentPlanId && dxfData[currentPlanId]);
  const currentZoomPct = isPlanFile ? `${pdfZoomPct}%` : `${Math.round(displayScale * 100)}%`;

  function doZoom(type: 'in' | 'out' | 'reset') {
    if (isPlanFile) {
      if (type === 'in') pdfViewerRef.current?.zoomIn();
      else if (type === 'out') pdfViewerRef.current?.zoomOut();
      else pdfViewerRef.current?.resetView();
    } else {
      if (type === 'in') zoomIn();
      else if (type === 'out') zoomOut();
      else resetView();
    }
  }

  if (!activeChantierId || chantierPlans.length === 0) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: topPad + 12 }]}>
          <Text style={styles.title}>Plans</Text>
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="map-outline" size={52} color={C.textMuted} />
          <Text style={styles.emptyTitle}>
            {!activeChantierId ? 'Aucun chantier actif' : 'Aucun plan disponible'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {!activeChantierId
              ? 'Créez d\'abord un chantier pour accéder aux plans.'
              : 'Ajoutez des plans à ce chantier pour visualiser les réserves.'}
          </Text>
          {!activeChantierId ? (
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/chantier/new' as any)}>
              <Ionicons name="add-circle-outline" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>Créer un chantier</Text>
            </TouchableOpacity>
          ) : permissions.canCreate ? (
            <TouchableOpacity style={styles.emptyBtn} onPress={handleAddPlan}>
              <Ionicons name="add-circle-outline" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>Ajouter un plan</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Modal visible={newPlanModal.visible} transparent animationType="fade" onRequestClose={() => setNewPlanModal(p => ({ ...p, visible: false }))}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setNewPlanModal(p => ({ ...p, visible: false }))}>
            <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <View style={[styles.modalPin, { backgroundColor: C.primary }]}><Ionicons name="map-outline" size={14} color="#fff" /></View>
                <View style={{ flex: 1 }}><Text style={styles.modalTitle}>Nouveau plan</Text><Text style={styles.modalMeta}>Ajoutez un plan à ce chantier</Text></View>
                <TouchableOpacity onPress={() => setNewPlanModal(p => ({ ...p, visible: false }))}><Ionicons name="close" size={20} color={C.textMuted} /></TouchableOpacity>
              </View>
              <View style={styles.newPlanField}>
                <Text style={styles.newPlanLabel}>Nom du plan *</Text>
                <TextInput style={styles.newPlanInput} placeholder="ex : Plan électrique" placeholderTextColor={C.textMuted} value={newPlanModal.name} onChangeText={v => setNewPlanModal(p => ({ ...p, name: v }))} autoFocus />
              </View>
              <View style={styles.newPlanRow}>
                <View style={[styles.newPlanField, { flex: 1 }]}>
                  <Text style={styles.newPlanLabel}>Bâtiment</Text>
                  <TextInput style={styles.newPlanInput} placeholder="ex : Bât A" placeholderTextColor={C.textMuted} value={newPlanModal.building} onChangeText={v => setNewPlanModal(p => ({ ...p, building: v }))} />
                </View>
                <View style={[styles.newPlanField, { flex: 1 }]}>
                  <Text style={styles.newPlanLabel}>Niveau</Text>
                  <TextInput style={styles.newPlanInput} placeholder="ex : RDC, R+1" placeholderTextColor={C.textMuted} value={newPlanModal.level} onChangeText={v => setNewPlanModal(p => ({ ...p, level: v }))} />
                </View>
              </View>
              <TouchableOpacity style={[styles.modalOpenBtn, !newPlanModal.name.trim() && { opacity: 0.5 }]} onPress={handleConfirmNewPlan} disabled={!newPlanModal.name.trim()}>
                <Ionicons name="add-circle-outline" size={16} color={C.primary} />
                <Text style={styles.modalOpenText}>Créer le plan</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  }

  const allVersions = useMemo(() => {
    if (!currentPlan) return [];
    // Walk up to find the root of this version family
    let root = currentPlan;
    const visited = new Set<string>();
    while (root.parentPlanId && !visited.has(root.id)) {
      visited.add(root.id);
      const parent = chantierPlans.find(p => p.id === root.parentPlanId);
      if (!parent) break;
      root = parent;
    }
    // BFS from root to collect every version in the tree
    const family: typeof chantierPlans = [];
    const queue = [root.id];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const plan = chantierPlans.find(p => p.id === id);
      if (plan) {
        family.push(plan);
        chantierPlans.filter(p => p.parentPlanId === id).forEach(child => queue.push(child.id));
      }
    }
    return family.sort((a, b) => (b.revisionNumber ?? 0) - (a.revisionNumber ?? 0));
  }, [currentPlan, chantierPlans]);
  const hasVersions = allVersions.length > 0 || currentPlan?.revisionCode;

  return (
    <View style={styles.container}>
      {!fullscreen && (
        <View style={[styles.header, { paddingTop: topPad + 8 }]}>
          {/* Row 1: Title + filter button */}
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} accessibilityRole="header">Plans</Text>
              {activeChantier && (
                <TouchableOpacity style={styles.chantierLabelRow} onPress={openChantierSwitcher} activeOpacity={0.7} accessibilityLabel={`Chantier actif: ${activeChantier.name}`}>
                  <Text style={styles.chantierLabel} numberOfLines={1}>{activeChantier.name}</Text>
                  <Ionicons name="chevron-down" size={11} color={C.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={[styles.filterBtn, showFilters && styles.filterBtnActive]}
              onPress={() => setShowFilters(v => !v)}
              accessibilityLabel={`Filtres${activeFilters > 0 ? ` (${activeFilters} actifs)` : ''}`}
            >
              <Ionicons name="options-outline" size={15} color={showFilters || activeFilters > 0 ? C.primary : C.text} />
              <Text style={[styles.filterBtnText, (showFilters || activeFilters > 0) && { color: C.primary }]}>Filtres</Text>
              {activeFilters > 0 && (
                <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{activeFilters}</Text></View>
              )}
            </TouchableOpacity>
          </View>

          {/* Row 2: Plan tabs with thumbnails */}
          <View style={styles.planTabsBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              <View style={styles.planTabsRow}>
                {filteredPlans.map(plan => {
                  const isActive = currentPlanId === plan.id;
                  const planReserveCount = reserves.filter(r => r.planId === plan.id).length;
                  return (
                    <TouchableOpacity
                      key={plan.id}
                      style={[styles.planTab, isActive && styles.planTabActive]}
                      onPress={() => handleSelectPlan(plan.id)}
                      accessibilityLabel={`Plan ${plan.name}${planReserveCount > 0 ? `, ${planReserveCount} réserves` : ''}`}
                      accessibilityState={{ selected: isActive }}
                    >
                      <View style={styles.planTabThumb}>
                        {plan.fileType === 'image' || (plan.uri && plan.fileType !== 'dxf' && isImage(plan.uri)) ? (
                          <Image source={{ uri: plan.uri }} style={styles.planTabThumbImg} resizeMode="cover" />
                        ) : plan.fileType === 'dxf' || dxfData[plan.id] ? (
                          <Ionicons name="grid-outline" size={13} color={isActive ? C.primary : C.textMuted} />
                        ) : plan.fileType === 'pdf' || plan.uri ? (
                          <Ionicons name="document-text-outline" size={13} color={isActive ? C.primary : C.textMuted} />
                        ) : (
                          <Ionicons name="map-outline" size={13} color={isActive ? C.primary : C.textMuted} />
                        )}
                      </View>
                      <Text style={[styles.planTabText, isActive && styles.planTabTextActive]} numberOfLines={1}>
                        {(plan.level && selectedLevel === 'all') ? `${plan.level} — ${plan.name}` : plan.name}
                      </Text>
                      {planReserveCount > 0 && (
                        <View style={[styles.planTabBadge, isActive && { backgroundColor: C.primary }]}>
                          <Text style={[styles.planTabBadgeText, isActive && { color: '#fff' }]}>{planReserveCount}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={styles.planActions}>
              {hasVersions && (
                <TouchableOpacity
                  style={styles.versionBtn}
                  onPress={() => setShowVersionHistory(v => !v)}
                  accessibilityLabel={`Historique des révisions – révision ${currentPlan?.revisionCode ?? 'R01'}`}
                  accessibilityRole="button"
                >
                  <Ionicons name="git-branch-outline" size={13} color={C.primary} />
                  <Text style={styles.versionBtnText}>{currentPlan?.revisionCode ?? 'R01'}</Text>
                </TouchableOpacity>
              )}
              {permissions.canCreate && (
                <TouchableOpacity style={[styles.importBtn, importing && { opacity: 0.5 }]} onPress={handleImportPlan} disabled={importing || !currentPlanId} accessibilityLabel="Importer un plan">
                  {importing ? <ActivityIndicator size="small" color={C.primary} /> : (
                    <><Ionicons name="cloud-upload-outline" size={14} color={C.primary} /><Text style={styles.importBtnText}>Importer</Text></>
                  )}
                </TouchableOpacity>
              )}
              {permissions.canCreate && (
                <TouchableOpacity style={styles.addPlanBtn} onPress={handleAddPlan} accessibilityLabel="Ajouter un plan">
                  <Ionicons name="add" size={16} color={C.textSub} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {showVersionHistory && currentPlan && (
            <View style={styles.versionPanel}>
              <View style={styles.versionPanelHeader}>
                <Ionicons name="git-branch-outline" size={13} color={C.textSub} />
                <Text style={styles.versionPanelTitle}>Historique — {currentPlan.name}</Text>
                <TouchableOpacity onPress={() => setShowVersionHistory(false)} hitSlop={8}><Ionicons name="close" size={16} color={C.textMuted} /></TouchableOpacity>
              </View>
              {allVersions.length === 0 ? (
                <Text style={styles.versionEmpty}>Aucune révision · {permissions.canCreate ? 'Importez une nouvelle version' : ''}</Text>
              ) : allVersions.map(ver => (
                <TouchableOpacity key={ver.id} style={[styles.versionRow, ver.id === currentPlanId && styles.versionRowActive]} onPress={() => { handleSelectPlan(ver.id); setShowVersionHistory(false); }}>
                  <View style={[styles.versionBadge, ver.isLatestRevision && styles.versionBadgeLatest]}>
                    <Text style={[styles.versionBadgeText, ver.isLatestRevision && styles.versionBadgeTextLatest]}>{ver.revisionCode ?? 'R01'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.versionName}>{ver.name}</Text>
                    <Text style={styles.versionDate}>{ver.uploadedAt}{ver.revisionNote ? ' · ' + ver.revisionNote : ''}</Text>
                  </View>
                  {ver.isLatestRevision && <View style={styles.latestChip}><Text style={styles.latestChipText}>Actuelle</Text></View>}
                </TouchableOpacity>
              ))}
              {permissions.canCreate && (
                <TouchableOpacity style={styles.newVersionBtn} onPress={openRevisionModal}>
                  <Ionicons name="cloud-upload-outline" size={13} color={C.primary} />
                  <Text style={styles.newVersionBtnText}>Créer une révision</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

        </View>
      )}

      <View style={isTablet ? styles.tabletBodyRow : { flex: 1 }}>
        <View style={{ flex: 1 }}>
          {!fullscreen && (
            <View style={styles.planTitleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>{currentPlan?.name ?? 'Plan'}</Text>
                {currentPlan?.uri ? (
                  <Text style={styles.planSubtitle}>{currentPlan.fileType === 'pdf' ? 'PDF' : isImagePlan ? 'Image' : 'DXF'} · {currentPlan.uploadedAt}</Text>
                ) : (
                  <Text style={styles.planSubtitle}>Schématique · {currentPlan?.uploadedAt ?? ''}</Text>
                )}
              </View>
              <View style={styles.pinSizeRow}>
                {focusedPinId && (
                  <Text style={{ fontSize: 10, color: '#FBBF24', fontFamily: 'Inter_600SemiBold', marginRight: 2 }}>
                    #{pinNumberMap.get(focusedPinId) ?? '?'}
                  </Text>
                )}
                {(() => {
                  const indivScale = focusedPinId ? (pinSizes[focusedPinId] ?? 1.0) : null;
                  const minusDisabled = focusedPinId ? (indivScale! <= 0.4) : pinSizeScale <= 0.5;
                  const plusDisabled  = focusedPinId ? (indivScale! >= 3.0) : pinSizeScale >= 2.5;
                  return (
                    <>
                      <TouchableOpacity
                        style={[styles.pinSizeBtn, minusDisabled && { opacity: 0.35 }]}
                        onPress={() => changePinSize(-0.25)}
                        disabled={minusDisabled}
                        accessibilityLabel={focusedPinId ? 'Réduire cette pastille' : 'Réduire les pastilles'}
                      >
                        <Ionicons name="remove-circle-outline" size={18} color={focusedPinId ? '#FBBF24' : C.textSub} />
                      </TouchableOpacity>
                      <Ionicons name="ellipse" size={9} color={focusedPinId ? '#FBBF24' : C.primary} />
                      <TouchableOpacity
                        style={[styles.pinSizeBtn, plusDisabled && { opacity: 0.35 }]}
                        onPress={() => changePinSize(0.25)}
                        disabled={plusDisabled}
                        accessibilityLabel={focusedPinId ? 'Agrandir cette pastille' : 'Agrandir les pastilles'}
                      >
                        <Ionicons name="add-circle-outline" size={18} color={focusedPinId ? '#FBBF24' : C.textSub} />
                      </TouchableOpacity>
                    </>
                  );
                })()}
              </View>
              {currentPlan?.uri && permissions.canCreate && (
                <TouchableOpacity style={styles.removePlanBtn} onPress={handleRemovePlan} accessibilityLabel="Remplacer le plan">
                  <Ionicons name="swap-horizontal-outline" size={13} color={C.textSub} />
                  <Text style={styles.removePlanText}>Remplacer</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Plan viewport — takes all remaining space */}
          <View
            style={{ flex: 1, overflow: 'hidden' as any }}
            onLayout={e => {
              const { width, height } = e.nativeEvent.layout;
              if (width > 0 && height > 0) {
                setPlanDimensions({ width, height });
                dynWRef.current = width;
                dynHRef.current = height;
              }
            }}
          >
            {isPlanFile ? (
              <PdfPlanViewer
                ref={pdfViewerRef}
                planUri={currentPlan!.uri!}
                planId={currentPlanId!}
                isImagePlan={isImagePlan}
                annotations={currentPlan!.annotations ?? []}
                onAnnotationsChange={(drawings) => updateSitePlan({ ...currentPlan!, annotations: drawings })}
                reserves={planReserves}
                ghostReserves={ghostReserves}
                pinNumberMap={pinNumberMap}
                onReserveSelect={(r) => {
                  if (isTablet) { setHighlightedReserveId(r.id); setPanelView('detail'); }
                  else { setSelected(r); }
                }}
                onPlanTap={(px, py) => {
                  if (!permissions.canCreate) return;
                  router.push({ pathname: '/reserve/new', params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '', planX: String(Math.round(px)), planY: String(Math.round(py)) } } as any);
                }}
                onPinMove={(reserveId, planX, planY) => {
                  const reserve = reservesRef.current.find(r => r.id === reserveId);
                  if (reserve) updateReserveFieldsRef.current({ ...reserve, planX: Math.round(planX), planY: Math.round(planY) });
                }}
                canAnnotate={permissions.canCreate}
                canCreate={permissions.canCreate}
                pinSize={pinSize}
                onZoomChange={(z) => setPdfZoomPct(Math.round(z * 100))}
              />
            ) : (
              <Animated.View
                style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, { transform: [{ scale }, { translateX }, { translateY }] }]}
                {...panResponder.panHandlers}
              >
                <View
                  style={{ width: dynW, height: dynH, position: 'relative', borderRadius: 8, overflow: 'hidden', backgroundColor: '#0F1117' }}
                  onTouchEnd={handlePlanTap}
                  {...(Platform.OS === 'web' ? { onClick: handleWebPlanClick } : {})}
                >
                  {[1, 2, 3, 4].map(i => (
                    <View key={`h${i}`} style={{ position: 'absolute', left: 0, right: 0, top: `${i * 20}%` as any, height: 1, backgroundColor: '#1E293B', opacity: 0.6 }} />
                  ))}
                  {[1, 2, 3, 4].map(i => (
                    <View key={`v${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${i * 20}%` as any, width: 1, backgroundColor: '#1E293B', opacity: 0.6 }} />
                  ))}

                  {!hasDxf && (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 }}>
                      <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: '#0D2045', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1E3A5F' }}>
                        <Ionicons name="map-outline" size={36} color="#3B6FCC" />
                      </View>
                      <View style={{ alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: '#94A3B8', fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>Aucun plan importé</Text>
                        <Text style={{ color: '#475569', fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
                          Importez une image, un PDF ou un fichier DXF pour afficher votre plan et placer des réserves
                        </Text>
                      </View>
                      {permissions.canCreate && (
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#003082', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 }}
                          onPress={handleImportPlan}
                          disabled={importing}
                          accessibilityLabel="Importer un plan"
                          accessibilityRole="button"
                        >
                          <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Importer un plan</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {hasDxf && (
                    <DxfCanvasOverlay
                      dxf={dxfData[currentPlanId!]}
                      planW={dynW} planH={dynH}
                      visibleLayers={currentVisibleLayers}
                    />
                  )}

                  {dxfLoading && (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,17,23,0.75)' }}>
                      <ActivityIndicator size="large" color={C.primary} />
                      <Text style={{ color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 12 }}>Chargement du plan DXF…</Text>
                    </View>
                  )}

                  {ghostClusters.map((cluster, ci) => {
                    const isCluster = cluster.items.length > 1;
                    const baseId = cluster.items[0]?.id ?? '';
                    const sz = isCluster ? clusterSize : getPinDisplaySize(baseId, pinSize);
                    const color = getCompanyColor(cluster.dominantCompany, companies);
                    return (
                      <View key={`ghost-${ci}`} style={{
                        position: 'absolute', left: `${cluster.cx}%` as any, top: `${cluster.cy}%` as any,
                        backgroundColor: color, width: sz, height: sz, borderRadius: sz / 2,
                        transform: [{ translateX: -(sz / 2) }, { translateY: -(sz / 2) }],
                        opacity: 0.2, pointerEvents: 'none' as any, alignItems: 'center', justifyContent: 'center',
                        borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
                      }}>
                        <Text style={{ fontSize: Math.round((isTablet ? 14 : 11) * pinSizeScale * (pinSizes[baseId] ?? 1.0)), fontFamily: 'Inter_700Bold', color: '#fff' }}>{isCluster ? cluster.items.length : cluster.number}</Text>
                      </View>
                    );
                  })}

                  {pinClusters.map((cluster, ci) => {
                    const isCluster = cluster.items.length > 1;
                    const pinId = cluster.items[0]?.id ?? '';
                    const sz = isCluster ? clusterSize : getPinDisplaySize(pinId, pinSize);
                    const color = getCompanyColor(cluster.dominantCompany, companies);
                    const isHighlighted = !isCluster && highlightedReserveId === pinId;
                    const isFocused = !isCluster && focusedPinId === pinId;
                    const isDraggingThis = draggingPinState?.id === pinId;
                    return (
                      <TouchableOpacity
                        key={`cl-${ci}`}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        style={{
                          position: 'absolute', left: `${cluster.cx}%` as any, top: `${cluster.cy}%` as any,
                          backgroundColor: color, width: sz, height: sz, borderRadius: sz / 2,
                          transform: [{ translateX: -(sz / 2) }, { translateY: -(sz / 2) }],
                          borderWidth: isFocused ? 3 : isHighlighted ? 3 : 2,
                          borderColor: isFocused ? '#FBBF24' : isHighlighted ? '#fff' : 'rgba(255,255,255,0.35)',
                          shadowColor: isFocused ? '#FBBF24' : '#000',
                          shadowOpacity: isFocused ? 0.9 : isHighlighted ? 0.7 : 0.4,
                          shadowRadius: isFocused ? 6 : 3,
                          elevation: isFocused ? 12 : isHighlighted ? 8 : 4,
                          alignItems: 'center', justifyContent: 'center',
                          opacity: isDraggingThis ? 0.35 : 1,
                        }}
                        onPressIn={() => { suppressNextPlanTapRef.current = true; }}
                        onPressOut={() => {
                          // If the PanResponder didn't take over (no real drag movement),
                          // clear the stale drag pin reference so it doesn't block future gestures
                          if (draggingPinIdRef.current === pinId && !draggingPinMovedRef.current) {
                            draggingPinIdRef.current = null;
                          }
                        }}
                        onPress={() => {
                          if (focusedPinId === pinId) { setFocusedPinId(null); return; }
                          if (isCluster) {
                            const nextScale = Math.min(lastScale.current * 2, 4);
                            const targetTX = dynW * (0.5 - cluster.cx / 100) * nextScale;
                            const targetTY = dynH * (0.5 - cluster.cy / 100) * nextScale;
                            lastScale.current = nextScale;
                            committedTX.current = targetTX; committedTY.current = targetTY;
                            setDisplayScale(nextScale);
                            Animated.parallel([
                              Animated.spring(scale, { toValue: nextScale, useNativeDriver: true }),
                              Animated.spring(translateX, { toValue: targetTX, useNativeDriver: true }),
                              Animated.spring(translateY, { toValue: targetTY, useNativeDriver: true }),
                            ]).start();
                          } else {
                            const reserve = cluster.items[0];
                            if (isTablet) { setHighlightedReserveId(reserve.id); setPanelView('detail'); }
                            else { setSelected(reserve); }
                          }
                        }}
                        onLongPress={() => {
                          if (!isCluster) {
                            suppressNextPlanTapRef.current = true;
                            // Block plan tap for 1.2s so Android double touch-end doesn't clear focus
                            suppressPlanTapUntilRef.current = Date.now() + 1200;
                            // Haptic confirmation that drag/focus mode is active
                            if (Platform.OS !== 'web') {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                            }
                            // Immediately focus pin so +/− buttons work right away
                            setFocusedPinIdRef.current(pinId);
                            if (focusedPinTimerRef.current) clearTimeout(focusedPinTimerRef.current);
                            focusedPinTimerRef.current = setTimeout(() => setFocusedPinIdRef.current(null), 5000);
                            // Set up drag state in case user starts dragging
                            if (permissions.canCreate) {
                              longPressTimeRef.current = Date.now();
                              draggingPinIdRef.current = pinId;
                              draggingPinStartRef.current = { cx: cluster.cx, cy: cluster.cy };
                              draggingPinMovedRef.current = false;
                              draggingPinPosRef.current = null;
                            }
                          }
                        }}
                        delayLongPress={400}
                        accessibilityLabel={isCluster ? `Groupe de ${cluster.items.length} réserves` : `Réserve ${cluster.number}`}
                      >
                        <Text style={{ fontSize: Math.round((isTablet ? 14 : 11) * pinSizeScale * (isCluster ? 1.0 : (pinSizes[pinId] ?? 1.0))), fontFamily: 'Inter_700Bold', color: '#fff' }}>
                          {isCluster ? cluster.items.length : cluster.number}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  {draggingPinState && (() => {
                    const reserve = reserves.find(r => r.id === draggingPinState.id);
                    const num = pinNumberMap.get(draggingPinState.id) ?? '?';
                    const color = getCompanyColor(reserve?.company ?? '', companies);
                    const sz = getPinDisplaySize(draggingPinState.id, pinSize);
                    return (
                      <View
                        pointerEvents="none"
                        style={{
                          position: 'absolute',
                          left: `${draggingPinState.x}%` as any,
                          top: `${draggingPinState.y}%` as any,
                          width: sz, height: sz, borderRadius: sz / 2,
                          backgroundColor: color,
                          transform: [{ translateX: -(sz / 2) }, { translateY: -(sz / 2) }],
                          borderWidth: 3, borderColor: '#fff',
                          shadowColor: '#000', shadowOpacity: 0.8, shadowRadius: 8, elevation: 20,
                          alignItems: 'center', justifyContent: 'center',
                          opacity: 0.95,
                        }}
                      >
                        <Text style={{ fontSize: Math.round((isTablet ? 14 : 11) * pinSizeScale * (pinSizes[draggingPinState.id] ?? 1.0)), fontFamily: 'Inter_700Bold', color: '#fff' }}>{num}</Text>
                      </View>
                    );
                  })()}
                </View>
              </Animated.View>
            )}

            {/* Mini map overlay */}
            {allPlanReserves.length > 0 && !isPlanFile && (
              <View style={styles.miniMap} pointerEvents="none">
                <View style={styles.miniMapInner}>
                  {allPlanReserves.filter(r => r.planX != null && r.planY != null).map(r => {
                    const color = getCompanyColor(r.company, companies);
                    return (
                      <View key={r.id} style={[styles.miniMapDot, {
                        left: (r.planX! / 100) * 90 - 2,
                        top: (r.planY! / 100) * 68 - 2,
                        backgroundColor: color,
                      }]} />
                    );
                  })}
                </View>
              </View>
            )}

            {/* Dismissible hint overlay */}
            {!hintSeen && permissions.canCreate && !fullscreen && !isPlanFile && (
              <View style={styles.hintOverlay} pointerEvents="box-none">
                <View style={styles.hintBanner}>
                  <Ionicons name="finger-print-outline" size={14} color={C.textMuted} />
                  <Text style={styles.hintText}>Tapez sur le plan pour créer une réserve</Text>
                  <TouchableOpacity onPress={dismissHint} hitSlop={8} accessibilityLabel="Fermer ce conseil">
                    <Ionicons name="close" size={14} color={C.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Zoom controls overlay — bottom right (only for schematic/DXF, PDF viewer has its own) */}
            {!isPlanFile && (
              <View style={styles.zoomOverlay} pointerEvents="box-none">
                <View style={styles.zoomOverlayGroup}>
                  <TouchableOpacity style={styles.zoomOverlayBtn} onPress={() => doZoom('out')} accessibilityLabel="Dézoomer">
                    <Ionicons name="remove" size={14} color={C.text} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.zoomOverlayBtn} onPress={() => doZoom('reset')} accessibilityLabel="Réinitialiser le zoom">
                    <Ionicons name="scan-outline" size={12} color={C.text} />
                  </TouchableOpacity>
                  <Text style={styles.zoomOverlayPct}>{currentZoomPct}</Text>
                  <TouchableOpacity style={styles.zoomOverlayBtn} onPress={() => doZoom('in')} accessibilityLabel="Zoomer">
                    <Ionicons name="add" size={14} color={C.text} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Fullscreen toggle — top right */}
            <TouchableOpacity
              style={styles.fullscreenBtn}
              onPress={() => setFullscreen(v => !v)}
              accessibilityLabel={fullscreen ? 'Quitter le mode plein écran' : 'Mode plein écran'}
            >
              <Ionicons name={fullscreen ? 'contract-outline' : 'expand-outline'} size={17} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Tablet side panel */}
        {isTablet && (() => {
          const detailReserve = planReserves.find(r => r.id === highlightedReserveId)
            ?? allPlanReserves.find(r => r.id === highlightedReserveId);
          return (
            <View style={[styles.tabletPanel, { width: TABLET_RESERVE_PANEL_W }]}>
              {panelView === 'detail' && detailReserve ? (
                <>
                  <View style={styles.tabletPanelHdr}>
                    <TouchableOpacity style={styles.tabletBackBtn} onPress={() => { setHighlightedReserveId(null); setPanelView('list'); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Ionicons name="chevron-back" size={18} color={C.primary} />
                      <Text style={styles.tabletBackBtnText}>Réserves</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => router.push(`/reserve/${detailReserve.id}` as any)} style={styles.tabletDetailEditBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Ionicons name="open-outline" size={15} color={C.primary} />
                    </TouchableOpacity>
                  </View>
                  <ScrollView contentContainerStyle={styles.tabletDetailContent} showsVerticalScrollIndicator={false}>
                    <View style={styles.tabletDetailHeaderRow}>
                      <View style={[styles.pinBadge, { backgroundColor: getCompanyColor(detailReserve.company, companies), width: 40, height: 40, borderRadius: 20, marginRight: 10 }]}>
                        <Text style={[styles.pinBadgeText, { fontSize: 16 }]}>{pinNumberMap.get(detailReserve.id) ?? '—'}</Text>
                      </View>
                      <Text style={styles.tabletDetailTitle} numberOfLines={3}>{detailReserve.title}</Text>
                    </View>
                    <View style={styles.tabletDetailMeta}>
                      <Ionicons name="business-outline" size={12} color={C.textMuted} />
                      <Text style={styles.tabletDetailMetaText}>{detailReserve.company}</Text>
                      {detailReserve.level && (<><Text style={styles.tabletDetailMetaDot}>·</Text><Ionicons name="layers-outline" size={12} color={C.textMuted} /><Text style={styles.tabletDetailMetaText}>{detailReserve.level}</Text></>)}
                    </View>
                    {detailReserve.deadline && detailReserve.deadline !== '—' && (
                      <View style={styles.tabletDetailMeta}><Ionicons name="calendar-outline" size={12} color={C.textMuted} /><Text style={styles.tabletDetailMetaText}>Échéance : {detailReserve.deadline}</Text></View>
                    )}
                    {detailReserve.description ? <Text style={styles.tabletDetailDesc}>{detailReserve.description}</Text> : null}
                    <Text style={styles.tabletDetailSectionLabel}>Changer le statut</Text>
                    <View style={styles.tabletStatusGrid}>
                      {STATUS_ORDER.map(s => {
                        const cfg = STATUS_CONFIG[s];
                        const isActive = detailReserve.status === s;
                        return (
                          <TouchableOpacity key={s} style={[styles.tabletStatusBtn, { backgroundColor: isActive ? cfg.color : cfg.bg, borderColor: cfg.color }]}
                            onPress={() => { if (!isActive) updateReserveStatus(detailReserve.id, s, user?.name ?? 'Chef de chantier'); }}
                            accessibilityLabel={`Statut ${cfg.label}`}>
                            {isActive && <Ionicons name="checkmark" size={11} color="#fff" />}
                            <Text style={[styles.tabletStatusBtnText, { color: isActive ? '#fff' : cfg.color }]}>{cfg.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={styles.tabletDetailActions}>
                      <PriorityBadge priority={detailReserve.priority} small />
                      {permissions.canCreate && (
                        <TouchableOpacity style={styles.tabletDetailOpenBtn} onPress={() => router.push(`/reserve/${detailReserve.id}` as any)}>
                          <Ionicons name="create-outline" size={14} color="#fff" />
                          <Text style={styles.tabletDetailOpenBtnText}>Modifier</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </ScrollView>
                </>
              ) : (
                <>
                  <View style={styles.tabletPanelHdr}>
                    <Ionicons name="list-outline" size={14} color={C.primary} />
                    <Text style={styles.tabletPanelTitle}>{planReserves.length > 0 ? `${planReserves.length} réserve${planReserves.length > 1 ? 's' : ''}` : 'Réserves'}</Text>
                    <TouchableOpacity style={styles.exportBtn} onPress={() => exportPlanPDF(currentPlan?.name ?? 'Plan', activeChantier?.name ?? '', planReserves, pinNumberMap, currentPlan?.uri ?? null, currentPlan?.fileType ?? null, pinSizeScale, companies)} accessibilityLabel="Exporter en PDF">
                      <Ionicons name="document-text-outline" size={13} color={C.primary} />
                      <Text style={styles.exportBtnText}>PDF</Text>
                    </TouchableOpacity>
                  </View>
                  <FlatList
                    ref={reserveListRef}
                    data={planReserves}
                    keyExtractor={r => r.id}
                    contentContainerStyle={[styles.tabletPanelContent, planReserves.length === 0 && { flex: 1 }]}
                    showsVerticalScrollIndicator={false}
                    onScrollToIndexFailed={() => {}}
                    ListEmptyComponent={
                      <View style={[styles.noReservesCard, { marginTop: 16 }]}>
                        <Ionicons name="checkmark-circle-outline" size={28} color={C.closed} />
                        <Text style={styles.noReservesText}>Aucune réserve</Text>
                        {permissions.canCreate && (
                          <TouchableOpacity style={styles.addReserveFromPlanBtn} onPress={() => router.push({ pathname: '/reserve/new', params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '' } } as any)}>
                            <Ionicons name="add" size={14} color={C.primary} />
                            <Text style={styles.addReserveFromPlanText}>Ajouter</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    }
                    renderItem={({ item: r }) => (
                      <TouchableOpacity style={[styles.reserveRow, highlightedReserveId === r.id && styles.tabletReserveRowSelected]} onPress={() => { setHighlightedReserveId(r.id); setPanelView('detail'); }} activeOpacity={0.75} accessibilityLabel={`Réserve ${r.title}`}>
                        <View style={[styles.pinBadge, { backgroundColor: getCompanyColor(r.company, companies), width: 34, height: 34, borderRadius: 17 }]}>
                          <Text style={styles.pinBadgeText}>{pinNumberMap.get(r.id) ?? '—'}</Text>
                        </View>
                        <View style={styles.reserveInfo}>
                          <Text style={styles.reserveTitle} numberOfLines={2}>{r.title}</Text>
                          <Text style={styles.reserveMeta}>{r.company} · {r.level}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
                      </TouchableOpacity>
                    )}
                  />
                  {permissions.canCreate && (
                    <TouchableOpacity style={styles.tabletAddBtn} onPress={() => router.push({ pathname: '/reserve/new', params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '' } } as any)}>
                      <Ionicons name="add" size={18} color="#fff" />
                      <Text style={styles.tabletAddBtnText}>Nouvelle réserve</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          );
        })()}
      </View>

      {/* Mobile: reserve bottom sheet */}
      {!isTablet && !fullscreen && (
        <ReservesSheet
          reserves={planReserves}
          allReserves={allPlanReserves}
          pinNumberMap={pinNumberMap}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onReservePress={(r) => { setSelected(r); }}
          onExport={() => exportPlanPDF(currentPlan?.name ?? 'Plan', activeChantier?.name ?? '', planReserves, pinNumberMap, currentPlan?.uri ?? null, currentPlan?.fileType ?? null, pinSizeScale, companies)}
          canCreate={permissions.canCreate}
          currentPlan={currentPlan}
          activeChantierId={activeChantierId}
          highlightedReserveId={highlightedReserveId}
          sheetHeight={screenHeight}
          companies={companies}
        />
      )}

      {/* Mobile FAB */}
      {permissions.canCreate && !isTablet && !fullscreen && (
        <TouchableOpacity
          style={[styles.fab, { bottom: Platform.OS === 'web' ? 100 : insets.bottom + 80 }]}
          onPress={() => router.push({ pathname: '/reserve/new', params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '' } } as any)}
          activeOpacity={0.85}
          accessibilityLabel="Créer une nouvelle réserve"
        >
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Mobile reserve popup with status buttons */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelected(null)}>
          {selected && (
            <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <View style={[styles.modalPin, { backgroundColor: getCompanyColor(selected.company, companies) }]}>
                  <Text style={styles.modalPinText}>{pinNumberMap.get(selected.id) ?? '#'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle} numberOfLines={2}>{selected.title}</Text>
                  <Text style={styles.modalMeta}>{selected.company} · {selected.level}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelected(null)} accessibilityLabel="Fermer">
                  <Ionicons name="close" size={20} color={C.textMuted} />
                </TouchableOpacity>
              </View>
              {selected.description ? <Text style={styles.modalDesc} numberOfLines={3}>{selected.description}</Text> : null}
              <View style={styles.modalBadges}>
                <PriorityBadge priority={selected.priority} small />
                {selected.deadline && selected.deadline !== '—' && (
                  <View style={styles.deadlineBadge}>
                    <Ionicons name="calendar-outline" size={11} color={C.textMuted} />
                    <Text style={styles.deadlineText}>{selected.deadline}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.tabletDetailSectionLabel}>Changer le statut</Text>
              <View style={styles.tabletStatusGrid}>
                {STATUS_ORDER.map(s => {
                  const cfg = STATUS_CONFIG[s];
                  const isActive = selected.status === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[styles.tabletStatusBtn, { backgroundColor: isActive ? cfg.color : cfg.bg, borderColor: cfg.color }]}
                      onPress={() => {
                        if (!isActive) {
                          updateReserveStatus(selected.id, s, user?.name ?? 'Chef de chantier');
                          setSelected(prev => prev ? { ...prev, status: s } : null);
                        }
                      }}
                      accessibilityLabel={`Passer au statut ${cfg.label}`}
                    >
                      {isActive && <Ionicons name="checkmark" size={11} color="#fff" />}
                      <Text style={[styles.tabletStatusBtnText, { color: isActive ? '#fff' : cfg.color }]}>{cfg.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity style={styles.modalOpenBtn} onPress={() => { setSelected(null); router.push(`/reserve/${selected.id}` as any); }} accessibilityLabel="Ouvrir la réserve complète">
                <Text style={styles.modalOpenText}>Ouvrir la réserve</Text>
                <Ionicons name="arrow-forward" size={14} color={C.primary} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </Modal>

      {/* QR Modal */}
      <Modal visible={!!showQRModal} transparent animationType="fade" onRequestClose={() => setShowQRModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowQRModal(null)}>
          {showQRModal && currentPlan && (
            <TouchableOpacity activeOpacity={1} style={styles.qrModalCard} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <View style={styles.qrModalIconWrap}><Ionicons name="qr-code" size={16} color={C.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Code QR de position</Text>
                  <Text style={styles.modalMeta}>{currentPlan.name}</Text>
                </View>
                <TouchableOpacity onPress={() => setShowQRModal(null)}><Ionicons name="close" size={20} color={C.textMuted} /></TouchableOpacity>
              </View>
              <View style={styles.qrModalBody}>
                <QRCodeDisplay data={{ planId: currentPlan.id, planName: currentPlan.name, building: activeChantier?.name, x: showQRModal.x, y: showQRModal.y }} size={180} />
              </View>
              <Text style={styles.qrModalHint}>Scannez ce QR sur le chantier pour pré-remplir la création d'une réserve à cette position.</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </Modal>

      {/* Revision modal */}
      <Modal visible={revisionModal.visible} transparent animationType="fade" onRequestClose={() => setRevisionModal(p => ({ ...p, visible: false }))}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalPin, { backgroundColor: '#7C3AED' }]}><Ionicons name="git-branch-outline" size={14} color="#fff" /></View>
              <View style={{ flex: 1 }}><Text style={styles.modalTitle}>Nouvelle révision</Text><Text style={styles.modalMeta}>Plan : {currentPlan?.name}</Text></View>
              <TouchableOpacity onPress={() => setRevisionModal(p => ({ ...p, visible: false }))}><Ionicons name="close" size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <View style={styles.newPlanField}>
              <Text style={styles.newPlanLabel}>Code révision *</Text>
              <TextInput style={styles.newPlanInput} placeholder="Ex : R02, IND-B, V3..." placeholderTextColor={C.textMuted} value={revisionModal.code} onChangeText={v => setRevisionModal(p => ({ ...p, code: v }))} autoCapitalize="characters" />
            </View>
            <View style={styles.newPlanField}>
              <Text style={styles.newPlanLabel}>Note de révision (optionnel)</Text>
              <TextInput style={[styles.newPlanInput, { height: 72, textAlignVertical: 'top' }]} placeholder="Ex : Mise à jour suite à dérogation lot 03..." placeholderTextColor={C.textMuted} value={revisionModal.note} onChangeText={v => setRevisionModal(p => ({ ...p, note: v }))} multiline numberOfLines={3} />
            </View>
            <View style={[styles.newPlanField, { backgroundColor: '#F5F3FF', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#DDD6FE' }]}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: '#5B21B6' }}>Les réserves épinglées sur le plan actuel restent accessibles dans l'historique des révisions.</Text>
            </View>
            <View style={styles.newPlanBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setRevisionModal(p => ({ ...p, visible: false }))}><Text style={styles.cancelBtnText}>Annuler</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, !revisionModal.code.trim() && { opacity: 0.5 }]} onPress={handleCreateRevision} disabled={!revisionModal.code.trim()}>
                <Ionicons name="cloud-upload-outline" size={15} color="#fff" />
                <Text style={styles.confirmBtnText}>Importer fichier</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* New plan modal */}
      <Modal visible={newPlanModal.visible} transparent animationType="fade" onRequestClose={() => setNewPlanModal(p => ({ ...p, visible: false }))}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setNewPlanModal(p => ({ ...p, visible: false }))}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalPin, { backgroundColor: C.primary }]}><Ionicons name="map-outline" size={14} color="#fff" /></View>
              <View style={{ flex: 1 }}><Text style={styles.modalTitle}>Nouveau plan</Text><Text style={styles.modalMeta}>Ajoutez un plan à ce chantier</Text></View>
              <TouchableOpacity onPress={() => setNewPlanModal(p => ({ ...p, visible: false }))}><Ionicons name="close" size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <View style={styles.newPlanField}>
              <Text style={styles.newPlanLabel}>Nom du plan *</Text>
              <TextInput style={styles.newPlanInput} placeholder="ex : Plan électrique" placeholderTextColor={C.textMuted} value={newPlanModal.name} onChangeText={v => setNewPlanModal(p => ({ ...p, name: v }))} autoFocus />
            </View>
            <View style={styles.newPlanRow}>
              <View style={[styles.newPlanField, { flex: 1 }]}>
                <Text style={styles.newPlanLabel}>Bâtiment</Text>
                <TextInput style={styles.newPlanInput} placeholder="ex : Bât A" placeholderTextColor={C.textMuted} value={newPlanModal.building} onChangeText={v => setNewPlanModal(p => ({ ...p, building: v }))} />
              </View>
              <View style={[styles.newPlanField, { flex: 1 }]}>
                <Text style={styles.newPlanLabel}>Niveau</Text>
                <TextInput style={styles.newPlanInput} placeholder="ex : RDC, R+1" placeholderTextColor={C.textMuted} value={newPlanModal.level} onChangeText={v => setNewPlanModal(p => ({ ...p, level: v }))} />
              </View>
            </View>
            <TouchableOpacity style={[styles.modalOpenBtn, !newPlanModal.name.trim() && { opacity: 0.5 }]} onPress={handleConfirmNewPlan} disabled={!newPlanModal.name.trim()}>
              <Ionicons name="add-circle-outline" size={16} color={C.primary} />
              <Text style={styles.modalOpenText}>Créer le plan</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Filters sheet */}
      <FiltersSheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        buildings={buildings}
        selectedBuilding={selectedBuilding}
        onBuildingChange={(b) => { setSelectedBuilding(b); setSelectedLevel('all'); setActivePlanId(null); }}
        planLevels={planLevelsForBuilding}
        selectedLevel={selectedLevel}
        onLevelChange={(l) => { setSelectedLevel(l); setActivePlanId(null); }}
        companies={companies}
        companyFilter={companyFilter}
        onCompanyChange={setCompanyFilter}
        reserveLevels={planLevels}
        levelFilter={levelFilter}
        onLevelFilterChange={setLevelFilter}
        dxfLayers={currentDxfLayers}
        visibleLayers={currentVisibleLayers}
        onLayersChange={(layers) => {
          if (currentPlanId) setVisibleLayers(prev => ({ ...prev, [currentPlanId]: layers }));
        }}
        onReset={() => {
          setSelectedBuilding('all'); setSelectedLevel('all');
          setStatusFilter('all'); setCompanyFilter('all'); setLevelFilter('all');
          setActivePlanId(null);
        }}
        activeFiltersCount={activeFilters}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 0 },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingLeft: 24, paddingRight: 16, paddingBottom: 10, paddingTop: 4 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  chantierLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  chantierLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  filterBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary + '60' },
  filterBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  filterBadge: { width: 18, height: 18, borderRadius: 9, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },

  planTabsBar: { flexDirection: 'row', alignItems: 'center', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  planTabsRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 6 },
  planTab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1.5, borderColor: C.border, maxWidth: 180 },
  planTabActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  planTabThumb: { width: 24, height: 18, borderRadius: 4, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  planTabThumbImg: { width: 24, height: 18 },
  planTabText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, flexShrink: 1 },
  planTabTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  planTabBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, backgroundColor: C.border, minWidth: 18, alignItems: 'center' },
  planTabBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.textSub },

  planActions: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12 },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  importBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  addPlanBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },

  versionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.primaryBg, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9, borderWidth: 1, borderColor: C.primary + '30' },
  versionBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  versionPanel: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, padding: 12, gap: 2 },
  versionPanelHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  versionPanelTitle: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  versionEmpty: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic', paddingVertical: 8 },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  versionRowActive: { backgroundColor: C.primaryBg, marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 8, borderColor: 'transparent' },
  versionBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  versionBadgeLatest: { backgroundColor: C.closed + '18', borderColor: C.closed + '40' },
  versionBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.textSub },
  versionBadgeTextLatest: { color: C.closed },
  versionName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  versionDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  latestChip: { backgroundColor: C.closed + '15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  latestChipText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.closed },
  newVersionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingVertical: 10, marginTop: 6, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '30', backgroundColor: C.primaryBg },
  newVersionBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

  tabletBodyRow: { flex: 1, flexDirection: 'row' },
  tabletPanel: {
    flex: 0, backgroundColor: C.surface, borderLeftWidth: 1, borderLeftColor: C.border,
    ...Platform.select({ web: { boxShadow: '-2px 0 8px rgba(0,0,0,0.05)' } as any, default: { shadowColor: '#000', shadowOffset: { width: -2, height: 0 }, shadowOpacity: 0.05, shadowRadius: 6 } }),
  },
  tabletPanelHdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  tabletPanelTitle: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },
  tabletPanelContent: { padding: 10, paddingBottom: 80, gap: 6 },
  tabletReserveRowSelected: { backgroundColor: C.primaryBg, borderColor: C.primary + '60' },
  tabletAddBtn: { position: 'absolute', bottom: 16, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13 },
  tabletAddBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  tabletBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  tabletBackBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  tabletDetailEditBtn: { padding: 6 },
  tabletDetailContent: { padding: 14, gap: 10, paddingBottom: 40 },
  tabletDetailHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 0, marginBottom: 4 },
  tabletDetailTitle: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, lineHeight: 22 },
  tabletDetailMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tabletDetailMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  tabletDetailMetaDot: { fontSize: 12, color: C.textMuted, marginHorizontal: 2 },
  tabletDetailDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 19, backgroundColor: C.surface2, borderRadius: 8, padding: 10, marginTop: 2 },
  tabletDetailSectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  tabletStatusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tabletStatusBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, minHeight: 36 },
  tabletStatusBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  tabletDetailActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  tabletDetailOpenBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  tabletDetailOpenBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  planTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  planTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  planSubtitle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  pinSizeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: 8 },
  pinSizeBtn: { padding: 4 },
  removePlanBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  removePlanText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
  importHintBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 10, marginBottom: 0, backgroundColor: C.primaryBg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.primary + '30' },
  importHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, lineHeight: 16 },

  hintOverlay: { position: 'absolute', bottom: 64, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  hintBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(15,17,23,0.85)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: C.border },
  hintText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, flex: 1 },

  zoomOverlay: { position: 'absolute', bottom: 12, right: 12, zIndex: 20, pointerEvents: 'box-none' as any },
  zoomOverlayGroup: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(15,17,23,0.82)', borderRadius: 10, paddingHorizontal: 4, paddingVertical: 4, borderWidth: 1, borderColor: C.border },
  zoomOverlayBtn: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  zoomOverlayPct: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textMuted, minWidth: 34, textAlign: 'center' },

  fullscreenBtn: { position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 30, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },

  miniMap: { position: 'absolute', top: 10, left: 10, zIndex: 10 },
  miniMapInner: { width: 90, height: 68, backgroundColor: 'rgba(15,17,23,0.75)', borderRadius: 6, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  miniMapDot: { position: 'absolute', width: 5, height: 5, borderRadius: 3 },

  reserveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  pinBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pinBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  reserveInfo: { flex: 1 },
  reserveTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  reserveMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  noReservesCard: { backgroundColor: C.surface, borderRadius: 14, padding: 24, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border },
  noReservesText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  addReserveFromPlanBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  addReserveFromPlanText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  exportBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },

  fab: {
    position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0px 4px 16px rgba(0,48,130,0.30)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.30, shadowRadius: 10, elevation: 8 },
    }),
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', padding: 16 },
  modalCard: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  modalPin: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  modalPinText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  modalTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  modalMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  modalDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18 },
  modalBadges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  deadlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: C.surface2, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  deadlineText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  modalOpenBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, backgroundColor: C.primaryBg, borderRadius: 12, borderWidth: 1, borderColor: C.primary + '40' },
  modalOpenText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  qrModalCard: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12, maxHeight: '80%' },
  qrModalIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.primary + '30' },
  qrModalBody: { alignItems: 'center', paddingVertical: 8 },
  qrModalHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', lineHeight: 17 },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: C.text, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  newPlanField: { gap: 6 },
  newPlanRow: { flexDirection: 'row', gap: 10 },
  newPlanLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  newPlanInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, backgroundColor: C.surface2 },
  newPlanBtns: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  confirmBtn: { flex: 2, flexDirection: 'row', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
