import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList, Platform,
  Modal, PanResponder, Animated, Image, KeyboardAvoidingView,
  ActivityIndicator, Alert, Linking, TextInput, useWindowDimensions,
} from 'react-native';
import { TABLET_SIDEBAR_W, TABLET_RESERVE_PANEL_W } from '@/lib/useTablet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ReactElement } from 'react';
import { useState, useRef, useMemo } from 'react';
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
import { parseDxf, normalizeDxfPoint, DxfParseResult, DxfEntity } from '@/lib/dxfParser';
import { openChantierSwitcher } from '@/components/ChantierSwitcherSheet';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import PdfPlanViewer from '@/components/PdfPlanViewer';

interface Room {
  id: string; label: string;
  x: number; y: number; w: number; h: number; dark?: boolean;
}

const DEMO_FLOOR_PLANS: Record<string, Room[]> = {
  'sp-A': [
    { id: 'ha', label: 'Hall', x: 0, y: 0, w: 30, h: 25 },
    { id: 'b101', label: 'Bureau 101', x: 30, y: 0, w: 40, h: 25 },
    { id: 'sr', label: 'Salle Réunion', x: 70, y: 0, w: 30, h: 50 },
    { id: 'coul', label: 'Couloir', x: 0, y: 25, w: 70, h: 12, dark: true },
    { id: 'b102', label: 'Bureau 102', x: 0, y: 37, w: 35, h: 30 },
    { id: 'b103', label: 'Bureau 103', x: 35, y: 37, w: 35, h: 30 },
    { id: 'lt', label: 'Local Technique', x: 70, y: 50, w: 30, h: 25 },
    { id: 'wc', label: 'Sanitaires', x: 0, y: 67, w: 70, h: 18, dark: true },
    { id: 'esc', label: 'Escaliers', x: 70, y: 75, w: 30, h: 25 },
  ],
  'sp-B': [
    { id: 'accb', label: 'Accueil B', x: 0, y: 0, w: 100, h: 18 },
    { id: 'zt', label: 'Zone Technique', x: 0, y: 18, w: 50, h: 40 },
    { id: 'atel', label: 'Atelier', x: 50, y: 18, w: 50, h: 40 },
    { id: 'stock', label: 'Stockage', x: 0, y: 58, w: 40, h: 42 },
    { id: 'lsoc', label: 'Locaux Sociaux', x: 40, y: 58, w: 60, h: 42 },
  ],
  'sp-C': [
    { id: 'ail1', label: 'Aile Nord', x: 0, y: 0, w: 30, h: 60 },
    { id: 'hc', label: 'Hall C', x: 30, y: 0, w: 40, h: 25 },
    { id: 'ail2', label: 'Aile Sud', x: 70, y: 0, w: 30, h: 60 },
    { id: 'corp', label: 'Corps Principal', x: 30, y: 25, w: 40, h: 40 },
    { id: 'ss', label: 'Sous-sol', x: 0, y: 60, w: 100, h: 40, dark: true },
  ],
};

const GENERIC_FLOOR_PLAN: Room[] = [
  { id: 'g1', label: 'Zone A', x: 0, y: 0, w: 50, h: 50 },
  { id: 'g2', label: 'Zone B', x: 50, y: 0, w: 50, h: 50 },
  { id: 'g3', label: 'Zone C', x: 0, y: 50, w: 50, h: 50 },
  { id: 'g4', label: 'Zone D', x: 50, y: 50, w: 50, h: 50 },
];

const PLAN_W = 360;
const PLAN_H = 270;

function DxfOverlay({ dxf, visibleLayers, planW, planH }: { dxf: DxfParseResult; visibleLayers?: string[]; planW: number; planH: number }) {
  const MAX_ENTITIES = 2000;
  const elements: ReactElement[] = [];
  let entityIdx = 0;
  const filterLayers = visibleLayers && visibleLayers.length > 0;

  function addLine(x1: number, y1: number, x2: number, y2: number, key: string) {
    const p1 = normalizeDxfPoint(x1, y1, dxf, planW, planH, 8);
    const p2 = normalizeDxfPoint(x2, y2, dxf, planW, planH, 8);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.3) return;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    elements.push(
      <View
        key={key}
        style={{
          position: 'absolute',
          left: cx - len / 2,
          top: cy - 0.5,
          width: len,
          height: 1,
          backgroundColor: '#60A5FA',
          opacity: 0.9,
          transform: [{ rotate: `${angle}deg` }],
        }}
      />
    );
  }

  for (const e of dxf.entities) {
    if (entityIdx >= MAX_ENTITIES) break;
    if (filterLayers && !visibleLayers!.includes(e.layer)) { entityIdx++; continue; }
    if (e.type === 'LINE') {
      addLine(e.x1, e.y1, e.x2, e.y2, `l-${entityIdx}`);
      entityIdx++;
    } else if (e.type === 'LWPOLYLINE') {
      const pts = e.closed ? [...e.points, e.points[0]] : e.points;
      for (let i = 0; i < pts.length - 1 && entityIdx < MAX_ENTITIES; i++) {
        addLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, `pl-${entityIdx}`);
        entityIdx++;
      }
    } else if (e.type === 'CIRCLE') {
      const pc = normalizeDxfPoint(e.cx, e.cy, dxf, planW, planH, 8);
      const scaleX = (planW - 16) / dxf.width;
      const scaleY = (planH - 16) / dxf.height;
      const rPx = e.r * Math.min(scaleX, scaleY);
      elements.push(
        <View
          key={`ci-${entityIdx}`}
          style={{
            position: 'absolute',
            left: pc.x - rPx,
            top: pc.y - rPx,
            width: rPx * 2,
            height: rPx * 2,
            borderRadius: rPx,
            borderWidth: 1,
            borderColor: '#60A5FA',
            opacity: 0.85,
          }}
        />
      );
      entityIdx++;
    } else if (e.type === 'TEXT') {
      const pt = normalizeDxfPoint(e.x, e.y, dxf, planW, planH, 8);
      elements.push(
        <Text
          key={`tx-${entityIdx}`}
          numberOfLines={1}
          style={{
            position: 'absolute',
            left: pt.x,
            top: pt.y - 5,
            fontSize: 5,
            fontFamily: 'Inter_400Regular',
            color: '#93C5FD',
            opacity: 0.85,
          }}
        >
          {e.text}
        </Text>
      );
      entityIdx++;
    }
  }

  const isTruncated = entityIdx >= MAX_ENTITIES;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, width: planW, height: planH, pointerEvents: 'none' as any }}>
      {elements}
      {isTruncated && (
        <View style={{ position: 'absolute', bottom: 4, left: 4, right: 4, backgroundColor: '#78350F', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
          <Text style={{ fontSize: 9, color: '#FDE68A', textAlign: 'center' }}>
            Plan tronqué — {MAX_ENTITIES} entités max affichées ({dxf.entities.length} au total)
          </Text>
        </View>
      )}
    </View>
  );
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

const MINI_W = 90;
const MINI_H = Math.round(MINI_W * PLAN_H / PLAN_W);

interface PinCluster {
  cx: number;
  cy: number;
  items: Reserve[];
  dominantStatus: string;
  number: number;
}

function computeClusters(reserves: Reserve[], scale: number, numberMap: Map<string, number>): PinCluster[] {
  const threshold = 8.33 / Math.max(scale, 0.3);
  const pins = reserves.filter(r => r.planX != null && r.planY != null);
  const assigned = new Set<string>();
  const clusters: PinCluster[] = [];
  let clusterIdx = 0;

  for (const r of pins) {
    if (assigned.has(r.id)) continue;
    const group: Reserve[] = [r];
    assigned.add(r.id);
    for (const r2 of pins) {
      if (assigned.has(r2.id)) continue;
      const d = Math.sqrt(Math.pow(r.planX! - r2.planX!, 2) + Math.pow(r.planY! - r2.planY!, 2));
      if (d < threshold) { group.push(r2); assigned.add(r2.id); }
    }
    const cx = group.reduce((s, g) => s + g.planX!, 0) / group.length;
    const cy = group.reduce((s, g) => s + g.planY!, 0) / group.length;
    const dominantStatus = group.reduce((prev, cur) => {
      const order: Record<string, number> = { open: 0, in_progress: 1, waiting: 2, verification: 3, closed: 4 };
      return (order[cur.status] ?? 9) < (order[prev.status] ?? 9) ? cur : prev;
    }).status;
    clusters.push({ cx, cy, items: group, dominantStatus, number: numberMap.get(r.id) ?? (clusterIdx + 1) });
    clusterIdx++;
  }
  return clusters;
}

const STATUS_COLORS: Record<string, string> = {
  open: '#EF4444', in_progress: '#F59E0B', waiting: '#6B7280',
  verification: '#8B5CF6', closed: '#10B981',
};

function exportPlanPDF(
  planName: string,
  chantierName: string,
  reserves: Reserve[],
  numberMap: Map<string, number>,
  planUri?: string | null,
) {
  const STATUS_FR: Record<string, string> = {
    open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente',
    verification: 'Vérification', closed: 'Clôturé',
  };
  const PRIORITY_FR: Record<string, string> = {
    critical: 'Critique', high: 'Haute', medium: 'Moyenne', low: 'Basse',
  };

  const pinsWithCoords = reserves.filter(r => r.planX != null && r.planY != null);
  const CANVAS_W = 720;
  const CANVAS_H = 480;

  const pinData = pinsWithCoords.map(r => ({
    x: Math.round((r.planX! / 100) * CANVAS_W),
    y: Math.round((r.planY! / 100) * CANVAS_H),
    n: numberMap.get(r.id) ?? 0,
    color: STATUS_COLORS[r.status] ?? '#003082',
  }));

  const rows = reserves.map(r => {
    const n = numberMap.get(r.id) ?? '—';
    const color = STATUS_COLORS[r.status] ?? '#003082';
    return `<tr>
      <td style="text-align:center;">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:11px;">${n}</span>
      </td>
      <td style="font-weight:600;">${r.title}</td>
      <td>${r.company || '—'}</td>
      <td>${r.level || '—'}</td>
      <td><span style="color:${color};font-weight:600;">${STATUS_FR[r.status] || r.status}</span></td>
      <td>${PRIORITY_FR[r.priority] || r.priority}</td>
      <td>${r.deadline || '—'}</td>
    </tr>`;
  }).join('');

  const canvasScript = `
    (function() {
      const canvas = document.getElementById('plan-canvas');
      const ctx = canvas.getContext('2d');
      const W = ${CANVAS_W}, H = ${CANVAS_H};
      const planUri = ${planUri ? JSON.stringify(planUri) : 'null'};
      const pins = ${JSON.stringify(pinData)};

      function drawPins() {
        pins.forEach(function(p) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 11px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(p.n), p.x, p.y);
        });
      }

      if (planUri) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() {
          ctx.drawImage(img, 0, 0, W, H);
          drawPins();
        };
        img.onerror = function() {
          ctx.fillStyle = '#0F1825';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#1E2D42';
          for (var i = 0; i < 4; i++) {
            for (var j = 0; j < 3; j++) {
              ctx.strokeStyle = '#2A3D56';
              ctx.strokeRect(i * W/4 + 8, j * H/3 + 8, W/4 - 16, H/3 - 16);
            }
          }
          drawPins();
        };
        img.src = planUri;
      } else {
        ctx.fillStyle = '#0F1825';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#1E2D42';
        ctx.lineWidth = 1;
        for (var i = 0; i < 4; i++) {
          for (var j = 0; j < 3; j++) {
            ctx.strokeRect(i * W/4 + 8, j * H/3 + 8, W/4 - 16, H/3 - 16);
          }
        }
        ctx.fillStyle = '#2A3D56';
        ctx.font = '13px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Plan schématique', W / 2, H / 2);
        drawPins();
      }
    })();
  `;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Plan : ${planName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; padding: 28px; color: #111; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    .header-left h1 { color: #003082; font-size: 20px; margin-bottom: 4px; }
    .header-left .meta { color: #666; font-size: 12px; }
    .header-right { text-align: right; font-size: 11px; color: #999; }
    .plan-section { margin-bottom: 24px; }
    canvas { width: 100%; height: auto; border-radius: 8px; display: block; border: 1px solid #e5e7eb; }
    .legend-note { font-size: 11px; color: #888; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #003082; color: #fff; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
    tr:nth-child(even) td { background: #f8fafc; }
    .section-title { font-size: 13px; font-weight: 700; color: #003082; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; border-bottom: 2px solid #003082; padding-bottom: 4px; }
    .footer { margin-top: 28px; font-size: 10px; color: #bbb; text-align: center; border-top: 1px solid #eee; padding-top: 12px; }
    @media print { body { padding: 0; } @page { margin: 16mm; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>Plan : ${planName}</h1>
      <div class="meta">Chantier : <strong>${chantierName}</strong> &nbsp;·&nbsp; ${reserves.length} réserve${reserves.length !== 1 ? 's' : ''} positionnée${reserves.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="header-right">
      Exporté le ${new Date().toLocaleDateString('fr-FR')}<br>
      BuildTrack
    </div>
  </div>

  ${pinsWithCoords.length > 0 ? `
  <div class="plan-section">
    <div class="section-title">Plan annoté</div>
    <canvas id="plan-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
    <div class="legend-note">Les numéros correspondent aux réserves du tableau ci-dessous.</div>
  </div>
  ` : ''}

  <div class="section-title">Liste des réserves</div>
  <table>
    <thead>
      <tr><th>#</th><th>Titre</th><th>Entreprise</th><th>Niveau</th><th>Statut</th><th>Priorité</th><th>Échéance</th></tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#999;padding:20px;">Aucune réserve sur ce plan</td></tr>'}</tbody>
  </table>
  <div class="footer">BuildTrack — Gestion de chantier numérique — ${new Date().toLocaleDateString('fr-FR')}</div>
  ${pinsWithCoords.length > 0 ? `<script>${canvasScript}</script>` : ''}
</body>
</html>`;

  if (Platform.OS === 'web') {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open(); doc.write(html); doc.close();
      setTimeout(() => {
        try { iframe.contentWindow?.print(); } catch {}
        setTimeout(() => document.body.removeChild(iframe), 5000);
      }, 300);
    }
  } else {
    Alert.alert(
      'Export PDF',
      'L\'export PDF est disponible sur la version web. Ouvrez BuildTrack dans votre navigateur pour l\'utiliser.',
      [{ text: 'OK' }]
    );
  }
}

function PlanImageLayer({ uri, isPdfFile }: { uri: string; isPdfFile: boolean }) {
  const [imgError, setImgError] = useState(false);

  if (isPdfFile) {
    if (Platform.OS === 'web') {
      return (
        <View style={planImgStyles.pdfContainer}>
          {/* @ts-ignore — web only */}
          <iframe
            src={uri}
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, pointerEvents: 'none' }}
            title="Plan PDF"
          />
        </View>
      );
    }
    const WebView = require('react-native-webview').default;
    const encodedUri = encodeURI(uri);
    const mobileHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:100%;height:100%;background:#0F1117;overflow:hidden;position:relative;}
#loading{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0F1117;z-index:10;}
#spinner{width:32px;height:32px;border:3px solid #1E3A5F;border-top-color:#003082;border-radius:50%;animation:spin 0.8s linear infinite;}
#loading-text{color:#94A3B8;font-family:Arial;font-size:13px;}
@keyframes spin{to{transform:rotate(360deg);}}
iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none;}
</style></head><body>
<div id="loading"><div id="spinner"></div><div id="loading-text">Chargement du plan\u2026</div></div>
<iframe src="${encodedUri}#toolbar=0&navpanes=0" onload="document.getElementById('loading').style.display='none';"></iframe>
</body></html>`;
    return (
      <WebView
        style={StyleSheet.absoluteFillObject}
        source={{ html: mobileHtml }}
        originWhitelist={['*']}
        javaScriptEnabled
        allowFileAccess
        allowUniversalAccessFromFileURLs
        allowingReadAccessToURL={uri}
      />
    );
  }

  if (imgError) {
    return (
      <View style={planImgStyles.errorContainer}>
        <Ionicons name="image-outline" size={32} color={C.textMuted} />
        <Text style={planImgStyles.errorText}>Image inaccessible</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={planImgStyles.image}
      resizeMode="contain"
      onError={() => setImgError(true)}
    />
  );
}

const planImgStyles = StyleSheet.create({
  image: { ...StyleSheet.absoluteFillObject, borderRadius: 8 },
  pdfContainer: StyleSheet.absoluteFillObject,
  pdfMobile: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface2 },
  pdfText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  pdfBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  errorContainer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface2 },
  errorText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
});

export default function PlansScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    reserves, companies, sitePlans, activeChantierId, activeChantier,
    addSitePlan, updateSitePlan, deleteSitePlan, addSitePlanVersion, migrateReservesToPlan,
    updateReserveStatus,
  } = useApp();
  const { permissions, user } = useAuth();

  const chantierPlans = useMemo(
    () => sitePlans.filter(p => p.chantierId === activeChantierId),
    [sitePlans, activeChantierId]
  );

  const [activePlanId, setActivePlanId] = useState<string | null>(null);

  const [selectedBuilding, setSelectedBuilding] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');

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

  const [selected, setSelected] = useState<Reserve | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [importing, setImporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [dxfData, setDxfData] = useState<Record<string, DxfParseResult>>({});
  const [showLayers, setShowLayers] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<Record<string, string[]>>({});
  const [showQRModal, setShowQRModal] = useState<{ x: number; y: number } | null>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const [newPlanModal, setNewPlanModal] = useState<{ visible: boolean; name: string; building: string; level: string }>({
    visible: false, name: '', building: '', level: '',
  });
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [revisionModal, setRevisionModal] = useState<{ visible: boolean; code: string; note: string }>({ visible: false, code: '', note: '' });
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const { width: screenWidth } = useWindowDimensions();
  const isTablet = screenWidth >= 768;

  const PLAN_RATIO = PLAN_H / PLAN_W;
  const planAreaW = isTablet
    ? screenWidth - TABLET_SIDEBAR_W - TABLET_RESERVE_PANEL_W - 32
    : screenWidth - 32;
  const dynW = Math.max(Math.floor(planAreaW), 260);
  const dynH = Math.round(dynW * PLAN_RATIO);
  const pinSize = isTablet ? 44 : 22;
  const clusterSize = isTablet ? 56 : 30;

  const [highlightedReserveId, setHighlightedReserveId] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<'list' | 'detail'>('list');
  const reserveListRef = useRef<FlatList<Reserve> | null>(null);

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
  const isPinchingRef = useRef(false);
  const pinchStartDistRef = useRef(0);
  const pinchStartScaleRef = useRef(1);

  const vectorPlan = currentPlanId
    ? (DEMO_FLOOR_PLANS[currentPlanId] ?? GENERIC_FLOOR_PLAN)
    : GENERIC_FLOOR_PLAN;

  const allPlanReserves = useMemo(
    () => reserves.filter(r => r.planId === currentPlanId),
    [reserves, currentPlanId]
  );

  const pinNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    allPlanReserves.forEach((r, i) => map.set(r.id, i + 1));
    return map;
  }, [allPlanReserves]);

  const planReserves = useMemo(() => {
    let list = allPlanReserves;
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter);
    if (companyFilter !== 'all') list = list.filter(r => r.company === companyFilter);
    if (levelFilter !== 'all') list = list.filter(r => r.level === levelFilter);
    return list;
  }, [allPlanReserves, statusFilter, companyFilter, levelFilter]);

  const pinClusters = useMemo(
    () => computeClusters(planReserves, displayScale, pinNumberMap),
    [planReserves, displayScale, pinNumberMap]
  );

  const ghostClusters = useMemo(() => {
    const activeIds = new Set(planReserves.map(r => r.id));
    const ghosts = allPlanReserves.filter(r => !activeIds.has(r.id));
    return computeClusters(ghosts, displayScale, pinNumberMap);
  }, [allPlanReserves, planReserves, displayScale, pinNumberMap]);

  const activeFilters = [statusFilter, companyFilter, levelFilter].filter(f => f !== 'all').length;

  const planLevels = useMemo(() => {
    const lvls = reserves.filter(r => r.planId === currentPlanId).map(r => r.level);
    return Array.from(new Set(lvls)).sort();
  }, [reserves, currentPlanId]);

  function getPinchDist(touches: any[]) {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (e, gs) => {
        if (e.nativeEvent.touches.length === 2) return true;
        return Math.abs(gs.dx) + Math.abs(gs.dy) > 4;
      },
      onPanResponderGrant: (e) => {
        touchStartXRef.current = e.nativeEvent.pageX;
        touchStartYRef.current = e.nativeEvent.pageY;
        isDraggingRef.current = false;
        isPinchingRef.current = false;
        pinchStartDistRef.current = 0;
      },
      onPanResponderMove: (e, gs) => {
        const touches = e.nativeEvent.touches;
        if (touches.length === 2) {
          isPinchingRef.current = true;
          isDraggingRef.current = true;
          const dist = getPinchDist(touches);
          if (pinchStartDistRef.current === 0) {
            pinchStartDistRef.current = dist;
            pinchStartScaleRef.current = lastScale.current;
            return;
          }
          const rawScale = (dist / pinchStartDistRef.current) * pinchStartScaleRef.current;
          const clamped = Math.min(4, Math.max(0.4, rawScale));
          lastScale.current = clamped;
          scale.setValue(clamped);
          return;
        }
        pinchStartDistRef.current = 0;
        const moved = Math.abs(gs.dx) + Math.abs(gs.dy);
        if (moved > 6) isDraggingRef.current = true;
        translateX.setValue(committedTX.current + gs.dx);
        translateY.setValue(committedTY.current + gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (isPinchingRef.current) {
          pinchStartDistRef.current = 0;
          isPinchingRef.current = false;
          setDisplayScale(lastScale.current);
          setTimeout(() => { isDraggingRef.current = false; }, 80);
          return;
        }
        committedTX.current = committedTX.current + gs.dx;
        committedTY.current = committedTY.current + gs.dy;
        setTimeout(() => { isDraggingRef.current = false; }, 50);
      },
    })
  ).current;

  function zoomIn() {
    const next = Math.min(lastScale.current * 1.3, 4);
    lastScale.current = next;
    setDisplayScale(next);
    Animated.spring(scale, { toValue: next, useNativeDriver: true }).start();
  }
  function zoomOut() {
    const next = Math.max(lastScale.current / 1.3, 0.5);
    lastScale.current = next;
    setDisplayScale(next);
    Animated.spring(scale, { toValue: next, useNativeDriver: true }).start();
  }
  function resetView() {
    lastScale.current = 1;
    committedTX.current = 0;
    committedTY.current = 0;
    setDisplayScale(1);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }

  function handlePlanTap(e: any) {
    if (suppressNextPlanTapRef.current) {
      suppressNextPlanTapRef.current = false;
      return;
    }
    if (isDraggingRef.current) return;
    if (!permissions.canCreate) return;
    const { locationX, locationY, pageX, pageY } = e.nativeEvent;
    const totalMove = Math.abs((pageX ?? 0) - touchStartXRef.current) + Math.abs((pageY ?? 0) - touchStartYRef.current);
    if (totalMove > 8) return;
    if (locationX === undefined || locationY === undefined) return;
    const px = Math.min(100, Math.max(0, Math.round((locationX / dynW) * 100)));
    const py = Math.min(100, Math.max(0, Math.round((locationY / dynH) * 100)));
    router.push({
      pathname: '/reserve/new',
      params: {
        planId: currentPlanId ?? '',
        chantierId: activeChantierId ?? '',
        planX: String(px),
        planY: String(py),
      },
    } as any);
  }

  function handleSelectPlan(planId: string) {
    setActivePlanId(planId);
    resetView();
    setCompanyFilter('all');
    setLevelFilter('all');
    setStatusFilter('all');
  }

  async function handleImportPlan() {
    if (!currentPlanId) return;
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
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
            Alert.alert('DXF vide', "Le fichier DXF ne contient aucune entité reconnue. Vérifiez qu'il s'agit d'un plan AutoCAD valide.");
            return;
          }
          setDxfData(prev => ({ ...prev, [currentPlanId]: parsed }));
          updateSitePlan({ ...currentPlan!, dxfName: docName, size: formatSize(asset.size) });
          Alert.alert(
            'Plan DXF importé ✓',
            `${parsed.entities.length} entités chargées depuis "${docName}". Le plan vectoriel AutoCAD est maintenant affiché.`
          );
          return;
        }

        const storageUrl = await uploadDocument(asset.uri, `plan_${currentPlanId}_${docName}`, asset.mimeType ?? undefined);
        const finalUri = storageUrl ?? asset.uri;

        updateSitePlan({
          ...currentPlan!,
          uri: finalUri,
          fileType: isPdfFile ? 'pdf' : 'image',
          size: formatSize(asset.size),
        });

        Alert.alert(
          'Plan importé',
          storageUrl
            ? `Plan "${currentPlan?.name}" uploadé sur Supabase Storage.`
            : `Plan "${currentPlan?.name}" importé localement.`
        );
      }
    } catch {
      Alert.alert('Erreur', "Impossible d'importer le plan.");
    } finally {
      setImporting(false);
    }
  }

  function handleRemovePlan() {
    if (!currentPlan?.uri) return;
    Alert.alert(
      'Remplacer le plan importé ?',
      `Le plan actuel sera remplacé. Vous pourrez immédiatement en importer un nouveau.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Remplacer', style: 'destructive', onPress: handleImportPlan },
      ]
    );
  }

  function openRevisionModal() {
    if (!currentPlan) return;
    const siblings = chantierPlans.filter(p => p.id === currentPlan.id || p.parentPlanId === currentPlan.id || currentPlan.parentPlanId === p.id);
    const revCount = siblings.length;
    const nextCode = `R${String(revCount + 1).padStart(2, '0')}`;
    setRevisionModal({ visible: true, code: nextCode, note: '' });
    setShowVersionHistory(false);
  }

  async function handleCreateRevision() {
    if (!currentPlan || !revisionModal.code.trim()) return;
    setImporting(true);
    setRevisionModal(prev => ({ ...prev, visible: false }));
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['image/*', 'application/pdf', '*/*'],
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const docExt = asset.name.split('.').pop()?.toLowerCase() ?? '';
        if (!isImage(asset.name) && docExt !== 'pdf' && docExt !== 'dxf') {
          Alert.alert('Format non supporté', 'Importez une image, un PDF ou un DXF.');
          return;
        }
        const storageUrl = await uploadDocument(asset.uri, `plan_rev_${genId()}_${asset.name}`, asset.mimeType ?? undefined);
        const finalUri = storageUrl ?? asset.uri;
        const revDocExt = asset.name.split('.').pop()?.toLowerCase() ?? '';
        const newPlan: SitePlan = {
          id: genId(),
          chantierId: currentPlan.chantierId,
          name: `${currentPlan.name} — ${revisionModal.code.trim()}`,
          building: currentPlan.building,
          level: currentPlan.level,
          uri: finalUri,
          fileType: revDocExt === 'pdf' ? 'pdf' : isImage(asset.name) ? 'image' : 'dxf',
          size: formatSize(asset.size),
          uploadedAt: formatDateFR(new Date()),
          revisionCode: revisionModal.code.trim(),
          revisionNote: revisionModal.note.trim() || undefined,
          parentPlanId: currentPlan.id,
          isLatestRevision: true,
        };
        addSitePlanVersion(currentPlan.id, newPlan);
        setActivePlanId(newPlan.id);

        const openMarkersCount = reserves.filter(r => r.planId === currentPlan.id && r.status !== 'closed').length;
        if (openMarkersCount > 0) {
          Alert.alert(
            'Révision créée ✓',
            `Révision ${revisionModal.code.trim()} créée.\n\n${openMarkersCount} marqueur${openMarkersCount > 1 ? 's' : ''} de réserve ouvert${openMarkersCount > 1 ? 's' : ''} détecté${openMarkersCount > 1 ? 's' : ''} sur le plan précédent.\n\nMigrer ces marqueurs vers la nouvelle révision ?`,
            [
              {
                text: 'Ignorer',
                style: 'cancel',
                onPress: () => {},
              },
              {
                text: `Migrer (${openMarkersCount})`,
                onPress: () => {
                  const count = migrateReservesToPlan(currentPlan.id, newPlan.id);
                  Alert.alert(
                    'Migration terminée ✓',
                    `${count} marqueur${count > 1 ? 's' : ''} migré${count > 1 ? 's' : ''} vers la révision ${revisionModal.code.trim()}.`,
                  );
                },
              },
            ],
          );
        } else {
          Alert.alert('Révision créée ✓', `Révision ${revisionModal.code.trim()} créée.${revisionModal.note.trim() ? `\n${revisionModal.note.trim()}` : ''}`);
        }
      }
    } catch {
      Alert.alert('Erreur', "Impossible de créer la révision.");
    } finally {
      setImporting(false);
    }
  }

  function handleAddPlan() {
    if (!activeChantierId) return;
    setNewPlanModal({ visible: true, name: '', building: '', level: '' });
  }

  function handleConfirmNewPlan() {
    if (!activeChantierId || !newPlanModal.name.trim()) return;
    const newPlan: SitePlan = {
      id: genId(),
      chantierId: activeChantierId,
      name: newPlanModal.name.trim(),
      building: newPlanModal.building.trim() || undefined,
      level: newPlanModal.level.trim() || undefined,
      uploadedAt: formatDateFR(new Date()),
    };
    addSitePlan(newPlan);
    setActivePlanId(newPlan.id);
    setNewPlanModal({ visible: false, name: '', building: '', level: '' });
  }

  if (!activeChantierId || chantierPlans.length === 0) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: topPad + 12 }]}>
          <Text style={styles.title}>Plans interactifs</Text>
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
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => router.push('/chantier/new' as any)}
            >
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
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Plans interactifs</Text>
            {activeChantier && (
              <TouchableOpacity style={styles.chantierLabelRow} onPress={openChantierSwitcher} activeOpacity={0.7}>
                <Text style={styles.chantierLabel} numberOfLines={1}>{activeChantier.name}</Text>
                <Ionicons name="chevron-down" size={11} color={C.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.zoomBtns}>
            <TouchableOpacity
              style={[styles.zoomBtn, showFilters && styles.filterToggleActive]}
              onPress={() => setShowFilters(v => !v)}
            >
              <Ionicons name="options-outline" size={14} color={showFilters ? C.primary : C.text} />
              {activeFilters > 0 && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeFilters}</Text>
                </View>
              )}
            </TouchableOpacity>
            {currentPlanId && dxfData[currentPlanId] && (
              <TouchableOpacity
                style={[styles.zoomBtn, showLayers && styles.filterToggleActive]}
                onPress={() => setShowLayers(v => !v)}
              >
                <Ionicons name="layers-outline" size={14} color={showLayers ? C.primary : C.text} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.zoomBtn} onPress={zoomOut}><Ionicons name="remove" size={16} color={C.text} /></TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn} onPress={resetView}><Ionicons name="scan-outline" size={14} color={C.text} /></TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn} onPress={zoomIn}><Ionicons name="add" size={16} color={C.text} /></TouchableOpacity>
          </View>
        </View>

        {buildings.length >= 2 && (
          <View style={styles.buildingHierarchyRow}>
            <View style={styles.hierarchyLabelWrap}>
              <Ionicons name="business-outline" size={10} color={C.textMuted} />
              <Text style={styles.hierarchyLabel}>Bâtiment</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
              <TouchableOpacity
                style={[styles.buildingHierarchyChip, selectedBuilding === 'all' && styles.buildingHierarchyChipActive]}
                onPress={() => { setSelectedBuilding('all'); setSelectedLevel('all'); setActivePlanId(null); }}
              >
                <Ionicons name="grid-outline" size={11} color={selectedBuilding === 'all' ? '#fff' : C.textSub} />
                <Text style={[styles.buildingHierarchyChipText, selectedBuilding === 'all' && styles.buildingHierarchyChipTextActive]}>Tous</Text>
              </TouchableOpacity>
              {buildings.map(b => (
                <TouchableOpacity
                  key={b}
                  style={[styles.buildingHierarchyChip, selectedBuilding === b && styles.buildingHierarchyChipActive]}
                  onPress={() => { setSelectedBuilding(b); setSelectedLevel('all'); setActivePlanId(null); }}
                >
                  <Ionicons name="business-outline" size={11} color={selectedBuilding === b ? '#fff' : C.textSub} />
                  <Text style={[styles.buildingHierarchyChipText, selectedBuilding === b && styles.buildingHierarchyChipTextActive]} numberOfLines={1}>{b}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {planLevelsForBuilding.length >= 2 && (
          <View style={styles.levelHierarchyRow}>
            <View style={styles.hierarchyLabelWrap}>
              <Ionicons name="layers-outline" size={10} color={C.textMuted} />
              <Text style={styles.hierarchyLabel}>Niveau</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
              <TouchableOpacity
                style={[styles.levelHierarchyChip, selectedLevel === 'all' && styles.levelHierarchyChipActive]}
                onPress={() => { setSelectedLevel('all'); setActivePlanId(null); }}
              >
                <Text style={[styles.levelHierarchyChipText, selectedLevel === 'all' && styles.levelHierarchyChipTextActive]}>Tous</Text>
              </TouchableOpacity>
              {planLevelsForBuilding.map(lvl => (
                <TouchableOpacity
                  key={lvl}
                  style={[styles.levelHierarchyChip, selectedLevel === lvl && styles.levelHierarchyChipActive]}
                  onPress={() => { setSelectedLevel(lvl); setActivePlanId(null); }}
                >
                  <Text style={[styles.levelHierarchyChipText, selectedLevel === lvl && styles.levelHierarchyChipTextActive]} numberOfLines={1}>{lvl}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.buildingBarRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={styles.buildingRow}>
              {filteredPlans.map(plan => (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.buildingBtn, currentPlanId === plan.id && styles.buildingBtnActive]}
                  onPress={() => handleSelectPlan(plan.id)}
                >
                  <Text style={[styles.buildingText, currentPlanId === plan.id && styles.buildingTextActive]} numberOfLines={1}>
                    {(plan.level && selectedLevel === 'all') ? `${plan.level} — ${plan.name}` : plan.name}
                  </Text>
                  {plan.uri && <View style={styles.planDot} />}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <View style={styles.planActions}>
            {currentPlan && (() => {
              const versions = chantierPlans.filter(p =>
                p.parentPlanId === currentPlanId || p.id === currentPlan.parentPlanId ||
                (currentPlan.parentPlanId && p.parentPlanId === currentPlan.parentPlanId)
              );
              const hasVersions = versions.length > 0 || currentPlan.revisionCode;
              return hasVersions ? (
                <TouchableOpacity style={styles.versionBtn} onPress={() => setShowVersionHistory(v => !v)}>
                  <Ionicons name="git-branch-outline" size={13} color={C.primary} />
                  <Text style={styles.versionBtnText}>
                    {currentPlan.revisionCode ?? 'R01'} · Versions
                  </Text>
                </TouchableOpacity>
              ) : null;
            })()}
            {permissions.canCreate && (
              <TouchableOpacity
                style={[styles.importBtn, importing && styles.importBtnDisabled]}
                onPress={handleImportPlan}
                disabled={importing || !currentPlanId}
              >
                {importing ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={15} color={C.primary} />
                    <Text style={styles.importBtnText}>Importer</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
            {permissions.canCreate && (
              <TouchableOpacity style={styles.addPlanBtn} onPress={handleAddPlan}>
                <Ionicons name="add" size={16} color={C.textSub} />
              </TouchableOpacity>
            )}
          </View>

          {showVersionHistory && currentPlan && (() => {
            const allVersions = chantierPlans.filter(p =>
              p.id === currentPlanId ||
              p.parentPlanId === currentPlanId ||
              p.id === currentPlan.parentPlanId ||
              (currentPlan.parentPlanId && (p.parentPlanId === currentPlan.parentPlanId || p.id === currentPlan.parentPlanId))
            ).sort((a, b) => (b.revisionNumber ?? 0) - (a.revisionNumber ?? 0));
            return (
              <View style={styles.versionPanel}>
                <View style={styles.versionPanelHeader}>
                  <Ionicons name="git-branch-outline" size={13} color={C.textSub} />
                  <Text style={styles.versionPanelTitle}>Historique des révisions — {currentPlan.name}</Text>
                  <TouchableOpacity onPress={() => setShowVersionHistory(false)} hitSlop={8}>
                    <Ionicons name="close" size={16} color={C.textMuted} />
                  </TouchableOpacity>
                </View>
                {allVersions.length === 0 ? (
                  <Text style={styles.versionEmpty}>Aucune révision antérieure · {permissions.canCreate ? 'Importez une nouvelle version via "Importer"' : ''}</Text>
                ) : (
                  allVersions.map(ver => (
                    <TouchableOpacity
                      key={ver.id}
                      style={[styles.versionRow, ver.id === currentPlanId && styles.versionRowActive]}
                      onPress={() => { handleSelectPlan(ver.id); setShowVersionHistory(false); }}
                    >
                      <View style={[styles.versionBadge, ver.isLatestRevision && styles.versionBadgeLatest]}>
                        <Text style={[styles.versionBadgeText, ver.isLatestRevision && styles.versionBadgeTextLatest]}>
                          {ver.revisionCode ?? 'R01'}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.versionName}>{ver.name}</Text>
                        <Text style={styles.versionDate}>{ver.uploadedAt}{ver.revisionNote ? ' · ' + ver.revisionNote : ''}</Text>
                      </View>
                      {ver.isLatestRevision && (
                        <View style={styles.latestChip}>
                          <Text style={styles.latestChipText}>Actuelle</Text>
                        </View>
                      )}
                      {ver.id === currentPlanId && !ver.isLatestRevision && (
                        <View style={styles.viewingChip}>
                          <Text style={styles.viewingChipText}>En vue</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))
                )}
                {permissions.canCreate && (
                  <TouchableOpacity
                    style={styles.newVersionBtn}
                    onPress={openRevisionModal}
                  >
                    <Ionicons name="cloud-upload-outline" size={13} color={C.primary} />
                    <Text style={styles.newVersionBtnText}>Créer une nouvelle révision</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })()}
        </View>

        <View style={styles.statusFilterRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5, paddingHorizontal: 16, paddingVertical: 6 }}>
            {[
              { key: 'all', label: 'Tout', color: C.primary, icon: 'list-outline' },
              { key: 'open', label: 'Ouvert', color: '#EF4444', icon: 'alert-circle' },
              { key: 'in_progress', label: 'En cours', color: '#F59E0B', icon: 'time' },
              { key: 'waiting', label: 'Attente', color: '#6B7280', icon: 'pause-circle' },
              { key: 'verification', label: 'Vérif.', color: '#8B5CF6', icon: 'eye' },
              { key: 'closed', label: 'Clôturé', color: '#10B981', icon: 'checkmark-circle' },
            ].map(s => {
              const isActive = statusFilter === s.key;
              const count = s.key === 'all' ? allPlanReserves.length : allPlanReserves.filter(r => r.status === s.key).length;
              return (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.statusChip, isActive && { backgroundColor: s.color + '20', borderColor: s.color }]}
                  onPress={() => setStatusFilter(s.key)}
                >
                  <View style={[styles.statusChipDot, { backgroundColor: s.color }]} />
                  <Text style={[styles.statusChipText, isActive && { color: s.color, fontFamily: 'Inter_600SemiBold' }]}>{s.label}</Text>
                  {count > 0 && (
                    <View style={[styles.statusChipCount, { backgroundColor: isActive ? s.color : C.border }]}>
                      <Text style={[styles.statusChipCountText, isActive && { color: '#fff' }]}>{count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {showFilters && (
        <>
          <View style={styles.companyFilterWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
              <TouchableOpacity
                style={[styles.filterChip, companyFilter === 'all' && styles.filterChipActive]}
                onPress={() => setCompanyFilter('all')}
              >
                <Text style={[styles.filterChipText, companyFilter === 'all' && styles.filterChipTextActive]}>Toutes</Text>
              </TouchableOpacity>
              {companies.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.filterChip, companyFilter === c.name && { backgroundColor: c.color + '20', borderColor: c.color }]}
                  onPress={() => setCompanyFilter(companyFilter === c.name ? 'all' : c.name)}
                >
                  <View style={[styles.filterDot, { backgroundColor: c.color }]} />
                  <Text style={[styles.filterChipText, companyFilter === c.name && { color: c.color }]}>{c.shortName}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {planLevels.length > 0 && (
            <View style={styles.zoneFilterWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
                <TouchableOpacity
                  style={[styles.filterChip, levelFilter === 'all' && styles.levelChipActive]}
                  onPress={() => setLevelFilter('all')}
                >
                  <Ionicons name="albums-outline" size={11} color={levelFilter === 'all' ? '#8B5CF6' : C.textMuted} />
                  <Text style={[styles.filterChipText, levelFilter === 'all' && { color: '#8B5CF6' }]}>Tous niveaux</Text>
                </TouchableOpacity>
                {planLevels.map(lvl => (
                  <TouchableOpacity
                    key={lvl}
                    style={[styles.filterChip, levelFilter === lvl && styles.levelChipActive]}
                    onPress={() => setLevelFilter(levelFilter === lvl ? 'all' : lvl)}
                  >
                    <Text style={[styles.filterChipText, levelFilter === lvl && { color: '#8B5CF6' }]}>{lvl}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </>
      )}

      {showLayers && currentPlanId && dxfData[currentPlanId] && (
        <View style={styles.layersPanel}>
          <View style={styles.layersPanelHeader}>
            <Ionicons name="layers" size={13} color={C.primary} />
            <Text style={styles.layersPanelTitle}>Calques DXF</Text>
            <Text style={styles.layersPanelCount}>{dxfData[currentPlanId].layers.length} calque{dxfData[currentPlanId].layers.length !== 1 ? 's' : ''}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
            <TouchableOpacity
              style={[styles.layerChip, !(visibleLayers[currentPlanId]?.length) && styles.layerChipActive]}
              onPress={() => setVisibleLayers(prev => ({ ...prev, [currentPlanId]: [] }))}
            >
              <Text style={[styles.layerChipText, !(visibleLayers[currentPlanId]?.length) && styles.layerChipTextActive]}>
                Tous
              </Text>
            </TouchableOpacity>
            {dxfData[currentPlanId].layers.map(layer => {
              const isActive = visibleLayers[currentPlanId]?.includes(layer);
              return (
                <TouchableOpacity
                  key={layer}
                  style={[styles.layerChip, isActive && styles.layerChipActive]}
                  onPress={() => {
                    setVisibleLayers(prev => {
                      const curr = prev[currentPlanId] ?? [];
                      const next = curr.includes(layer)
                        ? curr.filter(l => l !== layer)
                        : [...curr, layer];
                      return { ...prev, [currentPlanId]: next };
                    });
                  }}
                >
                  <View style={[styles.layerDot, { backgroundColor: isActive ? C.primary : C.textMuted }]} />
                  <Text style={[styles.layerChipText, isActive && styles.layerChipTextActive]} numberOfLines={1}>
                    {layer || '(défaut)'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={isTablet ? styles.tabletBodyRow : { flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.planContainer}>
          <View style={styles.planTitleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>{currentPlan?.name ?? 'Plan'}</Text>
              {currentPlan?.uri ? (
                <Text style={styles.planSubtitle}>Plan importé · {currentPlan.uploadedAt}</Text>
              ) : (
                <Text style={styles.planSubtitle}>Plan schématique · {currentPlan?.uploadedAt}</Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {currentPlan?.uri && permissions.canCreate && (
                <TouchableOpacity style={styles.removePlanBtn} onPress={handleRemovePlan}>
                  <Ionicons name="swap-horizontal-outline" size={13} color={C.textSub} />
                  <Text style={styles.removePlanText}>Remplacer</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {!currentPlan?.uri && permissions.canCreate && (
            <TouchableOpacity style={styles.importHintBanner} onPress={handleImportPlan} disabled={importing}>
              <Ionicons name="cloud-upload-outline" size={16} color={C.primary} />
              <Text style={styles.importHintText}>
                Importez votre vrai plan (image ou PDF) pour ce chantier
              </Text>
              <Ionicons name="chevron-forward" size={14} color={C.primary} />
            </TouchableOpacity>
          )}

          {permissions.canCreate && (
            <View style={styles.addingHint}>
              <Ionicons name="finger-print-outline" size={14} color={C.textMuted} />
              <Text style={styles.addingHintText}>Tapez sur le plan pour créer une réserve à cet endroit</Text>
            </View>
          )}

          <View style={[styles.planViewport, isPlanPdf(currentPlan) ? styles.planViewportPdf : { height: dynH + 20 }]}>
            {isPlanPdf(currentPlan) && currentPlan?.uri ? (
              <PdfPlanViewer
                planUri={currentPlan.uri}
                planId={currentPlanId!}
                annotations={currentPlan.annotations ?? []}
                onAnnotationsChange={(drawings) => updateSitePlan({ ...currentPlan!, annotations: drawings })}
                reserves={allPlanReserves}
                pinNumberMap={pinNumberMap}
                onReserveSelect={setSelected}
                onPlanTap={(px, py) => {
                  if (!permissions.canCreate) return;
                  router.push({
                    pathname: '/reserve/new',
                    params: {
                      planId: currentPlanId ?? '',
                      chantierId: activeChantierId ?? '',
                      planX: String(Math.round(px)),
                      planY: String(Math.round(py)),
                    },
                  } as any);
                }}
                canAnnotate={permissions.canCreate}
                canCreate={permissions.canCreate}
              />
            ) : (
            <>
            <Animated.View
              style={[styles.planAnimated, { transform: [{ scale }, { translateX }, { translateY }] }]}
              {...panResponder.panHandlers}
            >
              <View style={[styles.planView, { width: dynW, height: dynH }]} onTouchEnd={handlePlanTap}>

                {currentPlan?.uri ? (
                  <PlanImageLayer uri={currentPlan.uri} isPdfFile={isPdf(currentPlan.uri)} />
                ) : (
                  vectorPlan.map(room => (
                    <View
                      key={room.id}
                      style={[styles.room, {
                        left: `${room.x}%` as any,
                        top: `${room.y}%` as any,
                        width: `${room.w}%` as any,
                        height: `${room.h}%` as any,
                        backgroundColor: room.dark ? '#0D1520' : '#141D2E',
                      }]}
                    >
                      <Text style={styles.roomLabel} numberOfLines={2}>{room.label}</Text>
                    </View>
                  ))
                )}

                {currentPlanId && dxfData[currentPlanId] && (
                  <DxfOverlay
                    dxf={dxfData[currentPlanId]}
                    planW={dynW}
                    planH={dynH}
                    visibleLayers={
                      visibleLayers[currentPlanId]?.length
                        ? visibleLayers[currentPlanId]
                        : undefined
                    }
                  />
                )}

                {ghostClusters.map((cluster, ci) => {
                  const isCluster = cluster.items.length > 1;
                  const sz = isCluster ? clusterSize : pinSize;
                  const color = STATUS_CONFIG[cluster.dominantStatus as keyof typeof STATUS_CONFIG]?.color ?? C.primary;
                  return (
                    <View
                      key={`ghost-${ci}`}
                      style={[
                        isCluster ? styles.clusterMarker : styles.marker,
                        {
                          left: `${cluster.cx}%` as any,
                          top: `${cluster.cy}%` as any,
                          backgroundColor: color,
                          width: sz,
                          height: sz,
                          borderRadius: sz / 2,
                          transform: [{ translateX: -(sz / 2) }, { translateY: -(sz / 2) }],
                          opacity: 0.2,
                          pointerEvents: 'none' as any,
                        },
                      ]}
                    >
                      {isCluster ? (
                        <View style={styles.clusterInner}>
                          <Text style={[styles.clusterText, isTablet && { fontSize: 14 }]}>{cluster.items.length}</Text>
                        </View>
                      ) : (
                        <Text style={[styles.markerText, isTablet && { fontSize: 14 }]}>{cluster.number}</Text>
                      )}
                    </View>
                  );
                })}

                {pinClusters.map((cluster, ci) => {
                  const isCluster = cluster.items.length > 1;
                  const sz = isCluster ? clusterSize : pinSize;
                  const color = STATUS_CONFIG[cluster.dominantStatus as keyof typeof STATUS_CONFIG]?.color ?? C.primary;
                  const isHighlighted = !isCluster && highlightedReserveId === cluster.items[0]?.id;
                  return (
                    <TouchableOpacity
                      key={`cl-${ci}`}
                      style={[
                        isCluster ? styles.clusterMarker : styles.marker,
                        {
                          left: `${cluster.cx}%` as any,
                          top: `${cluster.cy}%` as any,
                          backgroundColor: color,
                          width: sz,
                          height: sz,
                          borderRadius: sz / 2,
                          transform: [{ translateX: -(sz / 2) }, { translateY: -(sz / 2) }],
                          borderWidth: isHighlighted ? 3 : 2,
                          borderColor: isHighlighted ? '#fff' : 'rgba(255,255,255,0.35)',
                          shadowOpacity: isHighlighted ? 0.7 : 0.4,
                          elevation: isHighlighted ? 8 : 4,
                        },
                      ]}
                      onPressIn={() => { suppressNextPlanTapRef.current = true; }}
                      onPress={() => {
                        if (isCluster) {
                          setStatusFilter('all');
                        } else {
                          const reserve = cluster.items[0];
                          if (isTablet) {
                            setHighlightedReserveId(reserve.id);
                            setPanelView('detail');
                          } else {
                            setSelected(reserve);
                          }
                        }
                      }}
                    >
                      {isCluster ? (
                        <View style={styles.clusterInner}>
                          <Text style={[styles.clusterText, isTablet && { fontSize: 14 }]}>{cluster.items.length}</Text>
                        </View>
                      ) : (
                        <Text style={[styles.markerText, isTablet && { fontSize: 14 }]}>{cluster.number}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Animated.View>

            {(allPlanReserves.length > 0 || displayScale !== 1) && (
              <View style={[styles.miniMap, { pointerEvents: 'none' as any }]}>
                <View style={styles.miniMapInner}>
                  {allPlanReserves.filter(r => r.planX != null && r.planY != null).map(r => {
                    const color = STATUS_CONFIG[r.status as keyof typeof STATUS_CONFIG]?.color ?? C.primary;
                    return (
                      <View
                        key={r.id}
                        style={[styles.miniMapDot, {
                          left: (r.planX! / 100) * MINI_W - 2,
                          top: (r.planY! / 100) * MINI_H - 2,
                          backgroundColor: color,
                        }]}
                      />
                    );
                  })}
                  <View
                    style={[styles.miniMapViewport, {
                      left: Math.max(0, (-committedTX.current / displayScale) * (MINI_W / dynW)),
                      top: Math.max(0, (-committedTY.current / displayScale) * (MINI_H / dynH)),
                      width: Math.min(MINI_W, (MINI_W / displayScale)),
                      height: Math.min(MINI_H, (MINI_H / displayScale)),
                    }]}
                  />
                </View>
              </View>
            )}
            </>
            )}
          </View>

        </View>

        {!isTablet && planReserves.length > 0 && (
          <View style={styles.listSection}>
            <View style={styles.listTitleRow}>
              <Text style={styles.listTitle}>
                Réserves sur ce plan ({planReserves.length})
              </Text>
              <TouchableOpacity
                style={styles.exportBtn}
                onPress={() => exportPlanPDF(
                  currentPlan?.name ?? 'Plan',
                  activeChantier?.name ?? '',
                  planReserves,
                  pinNumberMap,
                  currentPlan?.uri ?? null,
                )}
              >
                <Ionicons name="document-text-outline" size={13} color={C.primary} />
                <Text style={styles.exportBtnText}>Export PDF</Text>
              </TouchableOpacity>
            </View>
            {planReserves.map(r => (
              <TouchableOpacity
                key={r.id}
                style={styles.reserveRow}
                onPress={() => router.push(`/reserve/${r.id}` as any)}
              >
                <View style={[styles.pinBadge, { backgroundColor: STATUS_CONFIG[r.status].color }]}>
                  <Text style={styles.pinBadgeText}>{pinNumberMap.get(r.id) ?? '—'}</Text>
                </View>
                <View style={styles.reserveInfo}>
                  <Text style={styles.reserveTitle} numberOfLines={1}>{r.title}</Text>
                  <Text style={styles.reserveMeta}>{r.company} · {r.level}</Text>
                </View>
                <View style={{ gap: 4, alignItems: 'flex-end' }}>
                  <StatusBadge status={r.status} small />
                  <PriorityBadge priority={r.priority} small />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!isTablet && planReserves.length === 0 && (
          <View style={styles.noReservesCard}>
            <Ionicons name="checkmark-circle-outline" size={32} color={C.closed} />
            <Text style={styles.noReservesText}>Aucune réserve sur ce plan</Text>
            {permissions.canCreate && (
              <TouchableOpacity
                style={styles.addReserveFromPlanBtn}
                onPress={() => router.push({
                  pathname: '/reserve/new',
                  params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '' },
                } as any)}
              >
                <Ionicons name="add" size={14} color={C.primary} />
                <Text style={styles.addReserveFromPlanText}>Ajouter une réserve</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {isTablet && (() => {
        const detailReserve = planReserves.find(r => r.id === highlightedReserveId)
          ?? allPlanReserves.find(r => r.id === highlightedReserveId);
        const STATUS_ORDER: ReserveStatus[] = ['open', 'in_progress', 'waiting', 'verification', 'closed'];
        return (
          <View style={[styles.tabletPanel, { width: TABLET_RESERVE_PANEL_W }]}>

            {panelView === 'detail' && detailReserve ? (
              <>
                <View style={styles.tabletPanelHdr}>
                  <TouchableOpacity
                    style={styles.tabletBackBtn}
                    onPress={() => { setHighlightedReserveId(null); setPanelView('list'); }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="chevron-back" size={18} color={C.primary} />
                    <Text style={styles.tabletBackBtnText}>Réserves</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push(`/reserve/${detailReserve.id}` as any)}
                    style={styles.tabletDetailEditBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="open-outline" size={15} color={C.primary} />
                  </TouchableOpacity>
                </View>

                <ScrollView contentContainerStyle={styles.tabletDetailContent} showsVerticalScrollIndicator={false}>
                  <View style={styles.tabletDetailHeaderRow}>
                    <View style={[styles.pinBadge, { backgroundColor: STATUS_CONFIG[detailReserve.status].color, width: 40, height: 40, borderRadius: 20, marginRight: 10 }]}>
                      <Text style={[styles.pinBadgeText, { fontSize: 16 }]}>{pinNumberMap.get(detailReserve.id) ?? '—'}</Text>
                    </View>
                    <Text style={styles.tabletDetailTitle} numberOfLines={3}>{detailReserve.title}</Text>
                  </View>

                  <View style={styles.tabletDetailMeta}>
                    <Ionicons name="business-outline" size={12} color={C.textMuted} />
                    <Text style={styles.tabletDetailMetaText}>{detailReserve.company}</Text>
                    {detailReserve.level ? (
                      <>
                        <Text style={styles.tabletDetailMetaDot}>·</Text>
                        <Ionicons name="layers-outline" size={12} color={C.textMuted} />
                        <Text style={styles.tabletDetailMetaText}>{detailReserve.level}</Text>
                      </>
                    ) : null}
                  </View>

                  {detailReserve.deadline && detailReserve.deadline !== '—' && (
                    <View style={styles.tabletDetailMeta}>
                      <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
                      <Text style={styles.tabletDetailMetaText}>Échéance : {detailReserve.deadline}</Text>
                    </View>
                  )}

                  {detailReserve.description ? (
                    <Text style={styles.tabletDetailDesc}>{detailReserve.description}</Text>
                  ) : null}

                  <Text style={styles.tabletDetailSectionLabel}>Changer le statut</Text>
                  <View style={styles.tabletStatusGrid}>
                    {STATUS_ORDER.map(s => {
                      const cfg = STATUS_CONFIG[s];
                      const isActive = detailReserve.status === s;
                      return (
                        <TouchableOpacity
                          key={s}
                          style={[styles.tabletStatusBtn, { backgroundColor: isActive ? cfg.color : cfg.bg, borderColor: cfg.color }]}
                          onPress={() => {
                            if (!isActive) updateReserveStatus(detailReserve.id, s, user?.name ?? 'Chef de chantier');
                          }}
                          activeOpacity={0.75}
                        >
                          {isActive && <Ionicons name="checkmark" size={11} color="#fff" />}
                          <Text style={[styles.tabletStatusBtnText, { color: isActive ? '#fff' : cfg.color }]}>{cfg.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={styles.tabletDetailActions}>
                    <PriorityBadge priority={detailReserve.priority} small />
                    {permissions.canCreate && (
                      <TouchableOpacity
                        style={styles.tabletDetailOpenBtn}
                        onPress={() => router.push(`/reserve/${detailReserve.id}` as any)}
                      >
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
                  <Text style={styles.tabletPanelTitle}>
                    {planReserves.length > 0
                      ? `${planReserves.length} réserve${planReserves.length > 1 ? 's' : ''}`
                      : 'Réserves'}
                  </Text>
                  <TouchableOpacity
                    style={styles.exportBtn}
                    onPress={() => exportPlanPDF(
                      currentPlan?.name ?? 'Plan',
                      activeChantier?.name ?? '',
                      planReserves,
                      pinNumberMap,
                      currentPlan?.uri ?? null,
                    )}
                  >
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
                        <TouchableOpacity
                          style={styles.addReserveFromPlanBtn}
                          onPress={() => router.push({
                            pathname: '/reserve/new',
                            params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '' },
                          } as any)}
                        >
                          <Ionicons name="add" size={14} color={C.primary} />
                          <Text style={styles.addReserveFromPlanText}>Ajouter</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  }
                  renderItem={({ item: r }) => (
                    <TouchableOpacity
                      style={[styles.reserveRow, highlightedReserveId === r.id && styles.tabletReserveRowSelected]}
                      onPress={() => {
                        setHighlightedReserveId(r.id);
                        setPanelView('detail');
                      }}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.pinBadge, { backgroundColor: STATUS_CONFIG[r.status].color, width: 34, height: 34, borderRadius: 17 }]}>
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
                  <TouchableOpacity
                    style={styles.tabletAddBtn}
                    onPress={() => router.push({
                      pathname: '/reserve/new',
                      params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '' },
                    } as any)}
                  >
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

      {permissions.canCreate && !isTablet && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push({
            pathname: '/reserve/new',
            params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '' },
          } as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      )}

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelected(null)}>
          {selected && (
            <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <View style={[styles.modalPin, { backgroundColor: STATUS_CONFIG[selected.status].color }]}>
                  <Text style={styles.modalPinText}>{pinNumberMap.get(selected.id) ?? '#'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle} numberOfLines={2}>{selected.title}</Text>
                  <Text style={styles.modalMeta}>{selected.company} · {selected.level}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelected(null)}>
                  <Ionicons name="close" size={20} color={C.textMuted} />
                </TouchableOpacity>
              </View>
              {selected.description ? (
                <Text style={styles.modalDesc} numberOfLines={3}>{selected.description}</Text>
              ) : null}
              <View style={styles.modalBadges}>
                <StatusBadge status={selected.status} small />
                <PriorityBadge priority={selected.priority} small />
                {selected.deadline && selected.deadline !== '—' && (
                  <View style={styles.deadlineBadge}>
                    <Ionicons name="calendar-outline" size={11} color={C.textMuted} />
                    <Text style={styles.deadlineText}>{selected.deadline}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                style={styles.modalOpenBtn}
                onPress={() => {
                  setSelected(null);
                  router.push(`/reserve/${selected.id}` as any);
                }}
              >
                <Text style={styles.modalOpenText}>Ouvrir la réserve</Text>
                <Ionicons name="arrow-forward" size={14} color={C.primary} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!showQRModal} transparent animationType="fade" onRequestClose={() => setShowQRModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowQRModal(null)}>
          {showQRModal && currentPlan && (
            <TouchableOpacity activeOpacity={1} style={styles.qrModalCard} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <View style={styles.qrModalIconWrap}>
                  <Ionicons name="qr-code" size={16} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Code QR de position</Text>
                  <Text style={styles.modalMeta}>{currentPlan.name}</Text>
                </View>
                <TouchableOpacity onPress={() => setShowQRModal(null)}>
                  <Ionicons name="close" size={20} color={C.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.qrModalBody}>
                <QRCodeDisplay
                  data={{
                    planId: currentPlan.id,
                    planName: currentPlan.name,
                    building: activeChantier?.name,
                    x: showQRModal.x,
                    y: showQRModal.y,
                  }}
                  size={180}
                />
              </View>
              <Text style={styles.qrModalHint}>
                Scannez ce QR sur le chantier pour pré-remplir automatiquement la création d'une réserve à cette position.
              </Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </Modal>

      {/* Revision modal */}
      <Modal visible={revisionModal.visible} transparent animationType="fade" onRequestClose={() => setRevisionModal(p => ({ ...p, visible: false }))}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalPin, { backgroundColor: '#7C3AED' }]}>
                <Ionicons name="git-branch-outline" size={14} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Nouvelle révision</Text>
                <Text style={styles.modalMeta}>Plan : {currentPlan?.name}</Text>
              </View>
              <TouchableOpacity onPress={() => setRevisionModal(p => ({ ...p, visible: false }))}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.newPlanField}>
              <Text style={styles.newPlanLabel}>Code révision *</Text>
              <TextInput
                style={styles.newPlanInput}
                placeholder="Ex : R02, IND-B, V3..."
                placeholderTextColor={C.textMuted}
                value={revisionModal.code}
                onChangeText={v => setRevisionModal(p => ({ ...p, code: v }))}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.newPlanField}>
              <Text style={styles.newPlanLabel}>Note de révision (optionnel)</Text>
              <TextInput
                style={[styles.newPlanInput, { height: 72, textAlignVertical: 'top' }]}
                placeholder="Ex : Mise à jour suite à dérogation lot 03..."
                placeholderTextColor={C.textMuted}
                value={revisionModal.note}
                onChangeText={v => setRevisionModal(p => ({ ...p, note: v }))}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={[styles.newPlanField, { backgroundColor: '#F5F3FF', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#DDD6FE' }]}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: '#5B21B6' }}>
                Les réserves épinglées sur le plan actuel restent accessibles dans l'historique des révisions.
              </Text>
            </View>

            <View style={styles.newPlanBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setRevisionModal(p => ({ ...p, visible: false }))}>
                <Text style={styles.cancelBtnText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, !revisionModal.code.trim() && { opacity: 0.5 }]}
                onPress={handleCreateRevision}
                disabled={!revisionModal.code.trim()}
              >
                <Ionicons name="cloud-upload-outline" size={15} color="#fff" />
                <Text style={styles.confirmBtnText}>Importer fichier</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={newPlanModal.visible} transparent animationType="fade" onRequestClose={() => setNewPlanModal(p => ({ ...p, visible: false }))}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setNewPlanModal(p => ({ ...p, visible: false }))}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalPin, { backgroundColor: C.primary }]}>
                <Ionicons name="map-outline" size={14} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Nouveau plan</Text>
                <Text style={styles.modalMeta}>Ajoutez un plan à ce chantier</Text>
              </View>
              <TouchableOpacity onPress={() => setNewPlanModal(p => ({ ...p, visible: false }))}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.newPlanField}>
              <Text style={styles.newPlanLabel}>Nom du plan *</Text>
              <TextInput
                style={styles.newPlanInput}
                placeholder="ex : Plan électrique"
                placeholderTextColor={C.textMuted}
                value={newPlanModal.name}
                onChangeText={v => setNewPlanModal(p => ({ ...p, name: v }))}
                autoFocus
              />
            </View>
            <View style={styles.newPlanRow}>
              <View style={[styles.newPlanField, { flex: 1 }]}>
                <Text style={styles.newPlanLabel}>Bâtiment</Text>
                <TextInput
                  style={styles.newPlanInput}
                  placeholder="ex : Bât A"
                  placeholderTextColor={C.textMuted}
                  value={newPlanModal.building}
                  onChangeText={v => setNewPlanModal(p => ({ ...p, building: v }))}
                />
              </View>
              <View style={[styles.newPlanField, { flex: 1 }]}>
                <Text style={styles.newPlanLabel}>Niveau</Text>
                <TextInput
                  style={styles.newPlanInput}
                  placeholder="ex : RDC, R+1"
                  placeholderTextColor={C.textMuted}
                  value={newPlanModal.level}
                  onChangeText={v => setNewPlanModal(p => ({ ...p, level: v }))}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.modalOpenBtn, !newPlanModal.name.trim() && { opacity: 0.5 }]}
              onPress={handleConfirmNewPlan}
              disabled={!newPlanModal.name.trim()}
            >
              <Ionicons name="add-circle-outline" size={16} color={C.primary} />
              <Text style={styles.modalOpenText}>Créer le plan</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 0 },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  chantierLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  chantierLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  zoomBtns: { flexDirection: 'row', gap: 6 },
  zoomBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  filterToggleActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  filterBadge: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  buildingBarRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 10 },
  buildingRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8 },
  buildingBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1.5, borderColor: C.border, flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 160 },
  buildingBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  buildingText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  buildingTextActive: { color: C.primary },
  planDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.closed },
  planActions: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12 },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  importBtnDisabled: { opacity: 0.5 },
  importBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  addPlanBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },

  versionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, borderWidth: 1, borderColor: C.primary + '30' },
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
  viewingChip: { backgroundColor: C.primaryBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '30' },
  viewingChipText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.primary },
  newVersionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingVertical: 10, marginTop: 6, borderRadius: 10, borderWidth: 1, borderColor: C.primary + '30', backgroundColor: C.primaryBg },
  newVersionBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

  companyFilterWrap: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  zoneFilterWrap: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  filterChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  filterChipTextActive: { color: C.primary },
  filterDot: { width: 7, height: 7, borderRadius: 4 },
  levelChipActive: { backgroundColor: '#8B5CF620', borderColor: '#8B5CF6' },
  content: { padding: 16, paddingBottom: 48 },
  tabletContent: { padding: 16, paddingBottom: 48, paddingRight: TABLET_RESERVE_PANEL_W + 16 },
  tabletBodyRow: {
    flex: 1,
    flexDirection: 'row',
  },
  tabletPanel: {
    flex: 0,
    backgroundColor: C.surface,
    borderLeftWidth: 1,
    borderLeftColor: C.border,
    ...Platform.select({
      web: { boxShadow: '-2px 0 8px rgba(0,0,0,0.05)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: -2, height: 0 }, shadowOpacity: 0.05, shadowRadius: 6 },
    }),
  },
  tabletPanelHdr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  tabletPanelTitle: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },
  tabletPanelContent: { padding: 10, paddingBottom: 80, gap: 6 },
  tabletReserveRowSelected: { backgroundColor: C.primaryBg, borderColor: C.primary + '60' },
  tabletAddBtn: {
    position: 'absolute',
    bottom: 16,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 13,
  },
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

  planContainer: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16, overflow: 'hidden' },
  planTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 14, paddingBottom: 10 },
  planTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  planSubtitle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  removePlanBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  removePlanText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
  addMarkerBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '50' },
  addMarkerBtnActive: { backgroundColor: '#EF444420', borderColor: C.open },
  addMarkerText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  importHintBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 10, backgroundColor: C.primaryBg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.primary + '30' },
  importHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, lineHeight: 16 },
  addingHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 14, marginBottom: 8, backgroundColor: C.surface2, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  addingHintText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, flex: 1 },
  planViewport: { overflow: 'hidden', height: PLAN_H + 20, alignItems: 'center', justifyContent: 'center', marginHorizontal: 14, marginBottom: 14, borderRadius: 10, backgroundColor: C.surface2 },
  planViewportPdf: { height: 500, alignItems: 'stretch', justifyContent: 'flex-start' },
  planAnimated: { alignItems: 'center', justifyContent: 'center' },
  planView: { position: 'relative', borderRadius: 8, overflow: 'hidden', backgroundColor: '#0F1825' },
  room: { position: 'absolute', borderWidth: 1, borderColor: '#1E2D42', alignItems: 'center', justifyContent: 'center', padding: 3 },
  roomLabel: { fontSize: 8, fontFamily: 'Inter_500Medium', color: '#4A6080', textAlign: 'center' },
  marker: { position: 'absolute', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: -11 }, { translateY: -11 }], borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 3, elevation: 4 },
  markerText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  pendingMarker: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: C.inProgress, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: -12 }, { translateY: -12 }], borderWidth: 2, borderColor: '#fff' },
  pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 14, backgroundColor: C.inProgress + '15', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.inProgress + '30' },
  pendingText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress },
  pendingCreateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pendingCreateText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  listSection: { marginBottom: 12 },
  listTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', padding: 16 },
  modalCard: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12, maxHeight: '88%' },
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
  fab: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 100 : 24,
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
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: C.text, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  pendingQrBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  layersPanel: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingVertical: 8,
    backgroundColor: C.surface,
  },
  layersPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  layersPanelTitle: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
    flex: 1,
  },
  layersPanelCount: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
  layerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  layerChipActive: {
    backgroundColor: C.primaryBg,
    borderColor: C.primary + '60',
  },
  layerChipText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.textSub,
    maxWidth: 120,
  },
  layerChipTextActive: {
    color: C.primary,
  },
  layerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  qrModalCard: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 20,
    gap: 16,
  },
  qrModalIconWrap: {
    width: 36, height: 36,
    borderRadius: 10,
    backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  qrModalBody: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  qrModalHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  buildingHierarchyRow: {
    paddingTop: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  levelHierarchyRow: {
    paddingTop: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface2 + '60',
  },
  hierarchyLabelWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 16, paddingBottom: 5,
  },
  hierarchyLabel: {
    fontSize: 10, fontFamily: 'Inter_600SemiBold',
    color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  buildingHierarchyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, backgroundColor: C.surface2,
    borderWidth: 1.5, borderColor: C.border,
  },
  buildingHierarchyChipActive: {
    backgroundColor: C.primary, borderColor: C.primary,
  },
  buildingHierarchyChipText: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
  },
  buildingHierarchyChipTextActive: {
    color: '#fff',
  },
  levelHierarchyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 16, backgroundColor: C.surface2,
    borderWidth: 1.5, borderColor: C.border,
  },
  levelHierarchyChipActive: {
    backgroundColor: '#8B5CF620', borderColor: '#8B5CF6',
  },
  levelHierarchyChipText: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
  },
  levelHierarchyChipTextActive: {
    color: '#8B5CF6',
  },

  statusFilterRow: {
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: 16, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
  },
  statusChipDot: { width: 6, height: 6, borderRadius: 3 },
  statusChipText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
  statusChipCount: {
    minWidth: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3, backgroundColor: C.border,
  },
  statusChipCountText: {
    fontSize: 9, fontFamily: 'Inter_700Bold', color: C.textSub,
  },

  clusterMarker: {
    position: 'absolute',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.5)',
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 4, elevation: 6,
  },
  clusterInner: { alignItems: 'center', justifyContent: 'center' },
  clusterText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },

  miniMap: {
    position: 'absolute',
    bottom: 8, right: 8,
    width: MINI_W + 4,
    height: MINI_H + 4,
    borderRadius: 6,
    backgroundColor: 'rgba(15,24,37,0.80)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: 2,
  },
  miniMapInner: {
    width: MINI_W, height: MINI_H,
    position: 'relative', overflow: 'hidden',
  },
  miniMapDot: {
    position: 'absolute',
    width: 4, height: 4, borderRadius: 2,
  },
  miniMapViewport: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.7)',
    backgroundColor: 'rgba(96,165,250,0.08)',
    borderRadius: 2,
  },

  listTitleRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, backgroundColor: C.primaryBg,
    borderWidth: 1, borderColor: C.primary + '40',
  },
  exportBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },

  newPlanField: { gap: 5 },
  newPlanRow: { flexDirection: 'row', gap: 10 },
  newPlanLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  newPlanInput: {
    backgroundColor: C.surface2, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular',
    color: C.text, borderWidth: 1, borderColor: C.border,
  },
  newPlanBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: C.border },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  confirmBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 12, backgroundColor: '#7C3AED' },
  confirmBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
