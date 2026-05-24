import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList, Platform,
  Modal, PanResponder, Animated, Image, KeyboardAvoidingView, Keyboard,
  ActivityIndicator, Alert, TextInput, useWindowDimensions, Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { TABLET_RESERVE_PANEL_W } from '@/lib/useTablet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Reserve, SitePlan, ReserveStatus } from '@/constants/types';
import StatusBadge from '@/components/StatusBadge';
import { STATUS_CONFIG } from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import { uploadDocumentDetailed, isLocalUri } from '@/lib/storage';
import { genId, formatDateFR } from '@/lib/utils';
import { loadFileAsDataUrl, loadPhotoAsDataUrl, loadPhotoAsDataUrlForPdf, preRenderPdfPageToDataUrl, exportPDF as exportPDFHelper, printPDF as printPDFHelper, escapeHtml } from '@/lib/pdfBase';
import { generateAndSendPdfReport } from '@/lib/email/client';
import { compareLevels } from '@/lib/reserveUtils';
import { parseDxf, DxfParseResult } from '@/lib/dxfParser';
import { openChantierSwitcher } from '@/components/ChantierSwitcherSheet';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import PdfPlanViewer, { type PdfPlanViewerHandle } from '@/components/PdfPlanViewer';
import DxfCanvasOverlay from '@/components/plans/DxfCanvasOverlay';
import FiltersSheet from '@/components/plans/FiltersSheet';
import ReservesSheet from '@/components/plans/ReservesSheet';
import BuildingPickerSheet, { type BuildingItem } from '@/components/BuildingPickerSheet';
import LevelPickerSheet, { type LevelItem } from '@/components/LevelPickerSheet';
import { ensurePlanCached } from '@/lib/planCache';
import { loadBundledPdfJsSources } from '@/lib/pdfjsAsset';
import {
  countLocalOnlyReservePhotos,
  enrichReservesForPdf as enrichReserveListForPdf,
  getRemoteReservePhotosForPdf,
  getReservePdfPhotos,
  isRemotePdfAssetUri,
} from '@/lib/pdfReserveHelpers';
import { buildPdfFilename } from '@/lib/pdfFilename';
import {
  RESERVE_PRIORITY_COLORS,
  RESERVE_PRIORITY_LABELS,
  RESERVE_STATUS_COLORS,
  RESERVE_STATUS_LABELS,
} from '@/lib/reserveLabels';
import { getReserveDescriptionText } from '@/lib/reserveDescription';

const HINT_KEY = 'plans_hint_seen';
const PIN_SIZE_KEY = 'plans_pin_size_scale';
const PIN_SIZES_KEY = 'plans_pin_sizes_v2';
const RECENT_BUILDINGS_KEY = 'plans_recent_buildings_v1';
const RECENT_LEVELS_KEY = 'plans_recent_levels_v1';
const RECENT_FAMILY_KEY = 'plans_recent_family_v1';
const LAST_VIEW_KEY = 'plans_last_view_v1';
type PlansLastView = { planId: string | null; buildingId: string; levelId: string };
const HYBRID_PICKER_THRESHOLD = 5;
const HYBRID_LEVEL_THRESHOLD = 6;
const VISIBLE_RECENT_CHIPS = 3;
const VISIBLE_RECENT_LEVEL_CHIPS = 3;

const STATUS_ORDER: ReserveStatus[] = ['open', 'in_progress', 'waiting', 'verification', 'closed'];
type TFunc = (key: string, options?: Record<string, any>) => string;
type BuildingRailItem = {
  id: string;
  kind: 'building' | 'orphans';
  name: string;
  planCount: number;
  reserveCount: number;
};

interface PinCluster {
  cx: number; cy: number;
  items: Reserve[];
  dominantStatus: string;
  dominantCompany: string;
  number: number;
}

function computeClusters(reserves: Reserve[], scale: number, numberMap: Map<string, number>, focusedId?: string | null): PinCluster[] {
  const threshold = 8.33 / Math.max(scale, 0.3);
  const allPins = reserves.filter(r => r.planX != null && r.planY != null);
  if (allPins.length === 0) return [];
  const focusedPin = focusedId ? allPins.find(r => r.id === focusedId) : undefined;
  const pins = focusedPin ? allPins.filter(r => r.id !== focusedPin.id) : allPins;
  const cellSize = threshold;
  const grid = new Map<string, Reserve[]>();
  const cellKey = (gx: number, gy: number) => `${gx},${gy}`;
  for (const r of pins) {
    const gx = Math.floor(r.planX! / cellSize);
    const gy = Math.floor(r.planY! / cellSize);
    const k = cellKey(gx, gy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)?.push(r);
  }
  const assigned = new Set<string>();
  const clusters: PinCluster[] = [];
  const STO: Record<string, number> = { open: 0, in_progress: 1, waiting: 2, verification: 3, closed: 4 };
  if (pins.length > 0) {
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
      const dominantCompany = getClusterCompanyKey(group);
      clusters.push({ cx, cy, items: group, dominantStatus: dominant.status, dominantCompany, number: numberMap.get(r.id) ?? clusters.length + 1 });
    }
  }
  if (focusedPin) {
    clusters.push({
      cx: focusedPin.planX!,
      cy: focusedPin.planY!,
      items: [focusedPin],
      dominantStatus: focusedPin.status,
      dominantCompany: getClusterCompanyKey([focusedPin]),
      number: numberMap.get(focusedPin.id) ?? clusters.length + 1,
    });
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

function getReserveCompanies(r: Reserve | null | undefined): string[] {
  if (!r) return [];
  const names: string[] = [];
  if (r.company && r.company.trim()) names.push(r.company.trim());
  const arr = (r as any).companies;
  if (Array.isArray(arr)) {
    for (const c of arr) {
      if (typeof c !== 'string') continue;
      const name = c.trim();
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

function getReserveCompanyLabel(r: Reserve | null | undefined): string {
  const names = getReserveCompanies(r);
  return names.length > 0 ? names.join(', ') : '—';
}

function reserveMatchesCompany(r: Reserve, filter: string | null | undefined): boolean {
  if (!filter || filter === 'all') return true;
  const names = getReserveCompanies(r);
  if (filter === '—') return names.length === 0;
  return names.includes(filter);
}

function getClusterCompanyKey(group: Reserve[]): string {
  const names = new Set<string>();
  for (const r of group) getReserveCompanies(r).forEach(name => names.add(name));
  if (names.size === 0) return '';
  if (names.size === 1) return Array.from(names)[0];
  return '__mixed__';
}

function getReservePinColor(r: Reserve | null | undefined, companies: Array<{ name: string; color: string }>): string {
  const names = getReserveCompanies(r);
  if (names.length > 1) return '#6B7280';
  return getCompanyColor(names[0] ?? '', companies);
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

function localeFromLanguage(language?: string): string {
  if (language?.startsWith('es')) return 'es-ES';
  if (language?.startsWith('en')) return 'en-US';
  return 'fr-FR';
}

function tOr(t: TFunc | undefined, key: string, fallback: string, options?: Record<string, any>): string {
  const applyFallback = () => Object.entries(options ?? {}).reduce(
    (text, [name, value]) => text.replace(new RegExp(`{{\\s*${name}\\s*}}`, 'g'), String(value)),
    fallback,
  );
  if (!t) return applyFallback();
  const translated = t(key, options);
  return translated && translated !== key ? translated : applyFallback();
}

function reserveStatusLabelForPdf(status: string, t?: TFunc): string {
  return tOr(t, `reserveLabels.status.${status}`, RESERVE_STATUS_LABELS[status as keyof typeof RESERVE_STATUS_LABELS] ?? status);
}

function reservePriorityLabelForPdf(priority: string, t?: TFunc): string {
  return tOr(t, `reserveLabels.priority.${priority}`, RESERVE_PRIORITY_LABELS[priority as keyof typeof RESERVE_PRIORITY_LABELS] ?? priority);
}

function countLabel(t: TFunc | undefined, key: string, count: number, fallbackSingular: string, fallbackPlural: string): string {
  return tOr(t, key, `${count} ${count === 1 ? fallbackSingular : fallbackPlural}`, { count });
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
  planBuilding: string | null | undefined,
  planLevel: string | null | undefined,
  reserves: Reserve[],
  numberMap: Map<string, number>,
  planUri?: string | null,
  fileType?: 'pdf' | 'image' | 'dxf' | null,
  pinSizeScale: number = 1.0,
  companiesForColor: Array<{ name: string; color: string }> = [],
  captureRef?: React.RefObject<PdfPlanViewerHandle | null> | null,
  action: 'share' | 'print' = 'share',
  t?: TFunc,
  locale: string = 'fr-FR',
) {
  const displayBuilding = planBuilding || reserves.find(r => !!r.building)?.building || '';
  const displayLevel = planLevel || reserves.find(r => !!r.level)?.level || '';
  const planLocationParts = [
    displayBuilding ? `${escapeHtml(tOr(t, 'plansScreen.pdfReport.building', 'Building'))}: <strong>${escapeHtml(displayBuilding)}</strong>` : '',
    displayLevel ? `${escapeHtml(tOr(t, 'plansScreen.pdfReport.level', 'Level'))}: <strong>${escapeHtml(displayLevel)}</strong>` : '',
  ].filter(Boolean);
  const planLocationHtml = planLocationParts.length > 0
    ? `<div class="meta plan-location">${planLocationParts.join(' &nbsp;&middot;&nbsp; ')}</div>`
    : `<div class="meta plan-location">${escapeHtml(tOr(t, 'plansScreen.pdfReport.planLocation', 'Plan location'))}: <strong>${escapeHtml(tOr(t, 'plansScreen.pdfReport.notProvided', 'Not provided'))}</strong></div>`;
  const pinsWithCoords = reserves.filter(r => r.planX != null && r.planY != null);

  // Pass raw percentages so canvas script can apply them to the actual rendered dimensions
  const pinData = pinsWithCoords.map(r => ({
    pctX: r.planX!,
    pctY: r.planY!,
    n: numberMap.get(r.id) ?? 0,
    color: getReservePinColor(r, companiesForColor),
  }));

  // Photos: same limit logic as exportGlobalReport (≤150 total, max 2 per reserve)
  const MAX_TOTAL_PHOTOS = 150;
  const maxPhotosPerReserve = reserves.length === 0
    ? 0
    : Math.min(2, Math.floor(MAX_TOTAL_PHOTOS / reserves.length));

  const rowsAndPhotos = await Promise.all(reserves.map(async (r) => {
    const n = numberMap.get(r.id) ?? '-';
    const color = getReservePinColor(r, companiesForColor);
    const companyLabel = getReserveCompanyLabel(r);
    const row = `<tr>
      <td style="text-align:center;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:11px;">${n}</span></td>
      <td style="font-weight:600;">${escapeHtml(r.title)}</td>
      <td>${escapeHtml(companyLabel)}</td>
      <td>${escapeHtml(r.building || displayBuilding || '-')}</td>
      <td>${escapeHtml(r.level || displayLevel || '-')}</td>
      <td><span style="color:${color};font-weight:600;">${escapeHtml(reserveStatusLabelForPdf(r.status, t))}</span></td>
      <td>${escapeHtml(reservePriorityLabelForPdf(r.priority, t))}</td>
      <td>${escapeHtml(r.deadline || '-')}</td>
    </tr>`;
    const rawPhotos = getReservePdfPhotos(r);
    const photosToShow = rawPhotos.slice(0, maxPhotosPerReserve);
    let photoHtml = '';
    if (photosToShow.length > 0) {
      const resolvedSrcs = await Promise.all(photosToShow.map(p => loadPhotoAsDataUrlForPdf(p.uri)));
      photoHtml = `<div style="padding:8px 16px 12px 16px;border-bottom:1px solid #f1f5f9;background:#fff;">
        <div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:6px;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:9px;margin-right:5px;">${n}</span>
          ${escapeHtml(r.title)} - ${escapeHtml(tOr(t, 'plansScreen.pdfReport.photos', 'Photos'))} (${photosToShow.length}${rawPhotos.length > maxPhotosPerReserve ? ` ${escapeHtml(tOr(t, 'plansScreen.pdfReport.of', 'of'))} ${rawPhotos.length}` : ''})
        </div>
        <div style="display:flex;gap:8px;flex-wrap:nowrap;">
          ${photosToShow.map((p, idx) => {
            const src = resolvedSrcs[idx] ?? p.uri;
            const isDefect = p.kind === 'defect';
            return `<div style="flex:1;min-width:0;text-align:center;max-width:200px;">
              <img src="${escapeHtml(src)}" onerror="this.style.opacity='0.15'"
                style="width:100%;height:auto;max-height:160px;object-fit:contain;background:#F9FAFB;border-radius:6px;border:1.5px solid #DDE4EE;display:block;" />
              <span style="display:inline-block;margin-top:3px;padding:1px 7px;border-radius:8px;font-size:9px;font-weight:700;
                background:${isDefect ? '#FEF2F2' : '#ECFDF5'};color:${isDefect ? '#DC2626' : '#059669'};">
                ${isDefect ? tOr(t, 'plansScreen.pdfReport.defectPhoto', 'Defect') : tOr(t, 'plansScreen.pdfReport.resolvedPhoto', 'Resolved')}
              </span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }
    return { row, photoHtml, rawPhotoCount: rawPhotos.length, shownPhotoCount: photosToShow.length };
  }));
  const rows = rowsAndPhotos.map(rp => rp.row).join('');
  const photosSection = rowsAndPhotos.map(rp => rp.photoHtml).filter(Boolean).join('');
  const rawPhotoCount = rowsAndPhotos.reduce((sum, rp) => sum + rp.rawPhotoCount, 0);
  const shownPhotoCount = rowsAndPhotos.reduce((sum, rp) => sum + rp.shownPhotoCount, 0);
  const photosBlock = photosSection
    ? `<div style="padding:8px 16px 4px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">${escapeHtml(tOr(t, 'plansScreen.pdfReport.reservePhotos', 'Issue photos'))} (${shownPhotoCount}${rawPhotoCount > shownPhotoCount ? ` ${escapeHtml(tOr(t, 'plansScreen.pdfReport.of', 'of'))} ${rawPhotoCount}` : ''})</div>${photosSection}`
    : rawPhotoCount > 0
      ? `<div style="margin-top:12px;padding:12px 16px;border:1px dashed #DDE4EE;border-radius:8px;background:#F8FAFC;color:#64748B;font-size:11px;">${escapeHtml(tOr(t, 'plansScreen.pdfReport.photosOmitted', '{{count}} linked photo(s) were not included in this export to keep the PDF lightweight.', { count: rawPhotoCount }))}</div>`
    : `<div style="margin-top:12px;padding:12px 16px;border:1px dashed #DDE4EE;border-radius:8px;background:#F8FAFC;color:#64748B;font-size:11px;">${escapeHtml(tOr(t, 'plansScreen.pdfReport.noPhotos', 'No photo linked to the issues on this plan.'))}</div>`;

  // Convert plan URI to a data URL on all platforms.
  // On mobile, file:// paths are inaccessible from Print.printAsync's sandboxed WebView,
  // so we must read and base64-encode the file first (expo-file-system).
  // On web, we fetch via XHR/FileReader as before.
  let exportUri = planUri ?? null;
  if (planUri) {
    exportUri = await loadFileAsDataUrl(planUri, fileType);
  }

  const hasPins = pinsWithCoords.length > 0;
  const hasPlan = !!exportUri;
  const isPdf = fileType === 'pdf';
  const RENDER_W = 720;
  // Pin radius and font scale with the user's chosen pinSizeScale (base radius = 10px at 720px wide)
  const PIN_R = Math.max(3, Math.round(10 * pinSizeScale));
  const PIN_FONT = Math.max(5, Math.round(9 * pinSizeScale));

  // ── Pre-render PDF page to JPEG data URL ─────────────────────────────────
  // On web: use PDF.js directly (has DOM access). On native: capture the
  // already-rendered WebView canvas via captureRef — avoids CDN PDF.js call
  // which is blocked in Print.printAsync's sandboxed WebView (→ dark rectangle).
  let preRenderedPdfDataUrl: string | null = null;
  if (hasPlan && isPdf && exportUri) {
    if (Platform.OS === 'web') {
      preRenderedPdfDataUrl = await preRenderPdfPageToDataUrl(exportUri, RENDER_W);
    } else if (captureRef?.current) {
      preRenderedPdfDataUrl = await captureRef.current.captureImageDataUrl();
    }
  }

  // ── Build plan image section HTML ─────────────────────────────────────────
  // For image plans and pre-rendered PDF plans, use a static <img> + SVG pin
  // overlay so everything is synchronous — no timing issues in the WebView.
  // For PDF plans that could not be pre-rendered (native), fall back to the
  // canvas + pdfjs script approach.
  const buildSvgPins = (imgDataUrl: string): string => {
    const safeImgDataUrl = escapeHtml(imgDataUrl);
    if (!hasPins) return `<img src="${safeImgDataUrl}" style="width:100%;height:auto;display:block;border-radius:8px;border:1px solid #e5e7eb" />`;
    const circles = pinData.map(p =>
      `<circle cx="${p.pctX}%" cy="${p.pctY}%" r="${PIN_R}" fill="${p.color}" stroke="rgba(255,255,255,0.85)" stroke-width="${Math.max(1, PIN_R * 0.18)}"/>` +
      `<text x="${p.pctX}%" y="${p.pctY}%" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="${PIN_FONT}" font-weight="bold" font-family="Arial,sans-serif">${p.n}</text>`
    ).join('');
    return `<div style="position:relative;width:100%">` +
      `<img src="${safeImgDataUrl}" style="width:100%;height:auto;display:block;border-radius:8px;border:1px solid #e5e7eb" />` +
      `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible">${circles}</svg>` +
      `</div>`;
  };

  const useStaticImg = hasPlan && (!isPdf || !!preRenderedPdfDataUrl);
  const staticImgSrc = isPdf ? (preRenderedPdfDataUrl ?? '') : (exportUri ?? '');

  // Fallback canvas+script for native PDF plans that couldn't pre-render
  const fallbackCanvasScript = (!useStaticImg && hasPins) ? `(function(){
var canvas=document.getElementById('plan-canvas');
var ctx=canvas.getContext('2d');
var RENDER_W=${RENDER_W};
var planUri=${hasPlan ? JSON.stringify(exportUri) : 'null'};
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
  ctx.fillStyle='#1E3A5F';ctx.fillRect(0,0,canvas.width,canvas.height);
  drawPins(canvas.width,canvas.height);
}
if(!planUri){drawFallback();return;}
function renderWithPdfjs(pdfjsLib){
  var docSrc=planUri.startsWith('data:')?{data:atob(planUri.split(',')[1])}:{url:planUri,withCredentials:false};
  pdfjsLib.getDocument(docSrc).promise.then(function(doc){
    doc.getPage(1).then(function(page){
      var vp1=page.getViewport({scale:1});
      var scale=RENDER_W/vp1.width;
      var vp=page.getViewport({scale:scale});
      canvas.width=Math.round(vp.width);canvas.height=Math.round(vp.height);
      page.render({canvasContext:ctx,viewport:vp}).promise.then(function(){drawPins(canvas.width,canvas.height);});
    });
  }).catch(drawFallback);
}
var s=document.createElement('script');
s.type='module';
s.textContent="import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/legacy/build/pdf.min.mjs'; pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/legacy/build/pdf.worker.min.mjs'; window.__btPdfjs=pdfjsLib; window.dispatchEvent(new Event('bt-pdfjs-ready'));";
window.addEventListener('bt-pdfjs-ready',function(){renderWithPdfjs(window.__btPdfjs);},{once:true});
s.onerror=drawFallback;
document.head.appendChild(s);
})();` : '';

  const planAnnotatedSection = (hasPins || hasPlan) ? `
<div class="sec">
  <div class="stitle">${escapeHtml(tOr(t, 'plansScreen.pdfReport.annotatedPlan', 'Annotated plan'))}${displayBuilding || displayLevel ? ` - ${escapeHtml([displayBuilding, displayLevel].filter(Boolean).join(' - '))}` : ''}</div>
  ${useStaticImg && staticImgSrc
    ? buildSvgPins(staticImgSrc)
    : `<canvas id="plan-canvas" width="${RENDER_W}" height="${Math.round(RENDER_W * 0.6)}" style="width:100%;height:auto;border-radius:8px;display:block;border:1px solid #e5e7eb;background:#1E3A5F"></canvas>`
  }
  <div class="leg">${escapeHtml(tOr(t, 'plansScreen.pdfReport.legend', 'Numbers match the issues in the table below.'))}</div>
</div>` : '';

  const safePlanName = escapeHtml(planName);
  const safeChantierName = escapeHtml(chantierName);
  const html = `<!DOCTYPE html>
<html lang="${locale.split('-')[0]}"><head><meta charset="UTF-8"><title>${escapeHtml(tOr(t, 'plansScreen.pdfReport.planTitle', 'Plan'))}: ${safePlanName}</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;padding:28px;color:#111;background:#fff;}.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;}.hdr-l h1{color:#003082;font-size:20px;margin-bottom:4px;}.hdr-l .meta{color:#666;font-size:12px;}.hdr-r{text-align:right;font-size:11px;color:#999;}.sec{margin-bottom:24px;}.leg{font-size:11px;color:#888;margin-top:6px;}table{width:100%;border-collapse:collapse;font-size:12px;}th{background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}td{padding:7px 10px;border-bottom:1px solid #f0f0f0;vertical-align:middle;}tr:nth-child(even) td{background:#f8fafc;}.stitle{font-size:13px;font-weight:700;color:#003082;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;border-bottom:2px solid #003082;padding-bottom:4px;}.footer{margin-top:28px;font-size:10px;color:#bbb;text-align:center;border-top:1px solid #eee;padding-top:12px;}@media print{body{padding:0;}@page{margin:16mm;}}</style>
</head><body>
<div class="hdr"><div class="hdr-l"><h1>${escapeHtml(tOr(t, 'plansScreen.pdfReport.planTitle', 'Plan'))}: ${safePlanName}</h1><div class="meta">${escapeHtml(tOr(t, 'plansScreen.pdfReport.project', 'Project'))}: <strong>${safeChantierName}</strong> &nbsp;&middot;&nbsp; ${escapeHtml(countLabel(t, 'plansScreen.pdfReport.reserveCount', reserves.length, 'issue', 'issues'))}</div>${planLocationHtml}</div>
<div class="hdr-r">${escapeHtml(tOr(t, 'plansScreen.pdfReport.exportedOn', 'Exported on {{date}}', { date: new Date().toLocaleDateString(locale) }))}<br>BuildTrack</div></div>
${planAnnotatedSection}
<div class="stitle">${escapeHtml(tOr(t, 'plansScreen.pdfReport.reserveList', 'Issue list'))}</div>
<table><thead><tr><th>#</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.itemTitle', 'Title'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.company', 'Company'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.building', 'Building'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.level', 'Level'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.status', 'Status'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.priority', 'Priority'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.deadline', 'Due date'))}</th></tr></thead>
<tbody>${rows || `<tr><td colspan="8" style="text-align:center;color:#999;padding:20px;">${escapeHtml(tOr(t, 'plansScreen.pdfReport.noReserveOnPlan', 'No issue on this plan'))}</td></tr>`}</tbody></table>
${photosBlock}
<div class="footer">BuildTrack - ${escapeHtml(tOr(t, 'plansScreen.pdfReport.tagline', 'Digital construction management'))} - ${new Date().toLocaleDateString(locale)}</div>
${fallbackCanvasScript ? `<script>${fallbackCanvasScript}<\/script>` : ''}
</body></html>`;

  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    if (win) {
      win.document.open(); win.document.write(html); win.document.close();
      if (action === 'print') {
        // Open the browser's print dialog so the user can save as PDF.
        setTimeout(() => { try { win.print(); } catch {} }, (!useStaticImg && isPdf) ? 2500 : 600);
      }
      // 'share' on web simply opens the document in a new tab.
    }
  } else {
    try {
      if (action === 'print') {
        // Native: open the OS print/save dialog (no share sheet).
        await printPDFHelper(html, buildPdfFilename('Plan', [planLevel, planName, planBuilding, chantierName]));
      } else {
        // Native: open the OS share sheet (WhatsApp, Mail, Drive, etc.).
        await exportPDFHelper(html, buildPdfFilename('Plan', [planLevel, planName, planBuilding, chantierName]));
      }
    } catch {
      Alert.alert(t?.('common.error') ?? 'Erreur', t?.('plansScreen.alerts.pdfFailed') ?? "Impossible de générer le PDF.");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Global chantier report — all buildings × all plans for a selected company
// ─────────────────────────────────────────────────────────────────────────────
async function exportGlobalReport(
  chantierName: string,
  chantierPlans: SitePlan[],
  allChantierReserves: Reserve[],
  companyFilter: string | null,
  companiesForColor: Array<{ name: string; color: string }>,
  action: 'share' | 'print' = 'share',
  onProgress?: (current: number, total: number, planName: string) => void,
  statusFilter?: Set<string>,
  preRenderedImages?: Map<string, string>,
  t?: TFunc,
  locale: string = 'fr-FR',
): Promise<void> {
  const STATUS_COLORS = RESERVE_STATUS_COLORS as Record<string, string>;
  const PRIORITY_COLORS = RESERVE_PRIORITY_COLORS as Record<string, string>;

  // 1. Filter reserves by company + status
  // Match against r.company (single string) OR r.companies (multi-company array).
  const matchesCompany = (r: Reserve, filter: string | null): boolean => {
    if (filter === null) return true;
    if ((r.company ?? '').trim() === filter) return true;
    const arr = (r as any).companies;
    if (Array.isArray(arr) && arr.some((c: any) => typeof c === 'string' && c.trim() === filter)) return true;
    return false;
  };
  const filteredReserves = allChantierReserves
    .filter(r => matchesCompany(r, companyFilter))
    .filter(r => !statusFilter || statusFilter.size === 0 || statusFilter.has(r.status));

  // Photos are now compressed via loadPhotoAsDataUrlForPdf (800px / JPEG 0.55)
  // before being embedded → ~40–80 KB each instead of 500 KB–2 MB.
  // Target at most 150 compressed photos total (≈ 6–12 MB HTML, safe on all devices).
  //   1–75 reserves  → 2 photos each   (total ≤ 150)
  //   76–150 reserves → 1 photo each   (total ≤ 150)
  //   151+ reserves   → 0 photos       (plan pin-overlay images still identify reserves)
  const MAX_TOTAL_PHOTOS = 150;
  const maxPhotosPerReserve = filteredReserves.length === 0
    ? 0
    : Math.min(2, Math.floor(MAX_TOTAL_PHOTOS / filteredReserves.length));

  // 2. Group reserves by planId — reserves with no planId are "orphans"
  const reservesByPlan = new Map<string, Reserve[]>();
  const orphanReserves: Reserve[] = [];
  for (const r of filteredReserves) {
    if (!r.planId) {
      orphanReserves.push(r);
      continue;
    }
    if (!reservesByPlan.has(r.planId)) reservesByPlan.set(r.planId, []);
    reservesByPlan.get(r.planId)!.push(r);
  }

  // 3. Keep only plans that have at least one filtered reserve, then derive buildings
  const activePlanIds = new Set(reservesByPlan.keys());
  const plansWithReserves = chantierPlans.filter(p => activePlanIds.has(p.id));

  const buildingNames = Array.from(
    new Set(plansWithReserves.map(p => p.building ?? ''))
  ).sort((a, b) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, 'fr');
  });

  // 4. Build one HTML section per building — skip buildings and plans with 0 reserves
  const totalPdfPlans = plansWithReserves.filter(
    p => isPlanPdf(p) && p.uri
  ).length;
  let processedPdfPlans = 0;
  const buildingSections: string[] = [];

  for (const building of buildingNames) {
    const buildingPlans = plansWithReserves.filter(p => (p.building ?? '') === building);
    const buildingLabel = building || 'Sans bâtiment';
    let buildingReserveCount = 0;
    const planBlocks: string[] = [];

    for (const plan of buildingPlans) {
      const planReserves = reservesByPlan.get(plan.id) ?? [];

      // Skip plans with no reserves after filtering
      if (planReserves.length === 0) continue;

      buildingReserveCount += planReserves.length;

      // Build plan image HTML with SVG pin overlay (supports both image and PDF plans)
      const PIN_R_G = 10;
      const PIN_FONT_G = 9;
      const buildGlobalPlanImg = (imgDataUrl: string): string => {
        const pinsWithCoords = planReserves.filter(r => r.planX != null && r.planY != null);
        const circles = pinsWithCoords.map((r, i) => {
          const color = getReservePinColor(r, companiesForColor);
          const n = i + 1;
          return (
            `<circle cx="${r.planX}%" cy="${r.planY}%" r="${PIN_R_G}" fill="${color}" stroke="rgba(255,255,255,0.85)" stroke-width="1.5"/>` +
            `<text x="${r.planX}%" y="${r.planY}%" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="${PIN_FONT_G}" font-weight="bold" font-family="Arial,sans-serif">${n}</text>`
          );
        }).join('');
        return (
          `<div class="plan-image-wrap"><div style="position:relative;width:100%">` +
          `<img src="${imgDataUrl}" style="width:100%;height:auto;display:block;border-radius:6px;border:1px solid #e2e8f0"/>` +
          (circles
            ? `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible">${circles}</svg>`
            : '') +
          `</div></div>`
        );
      };

      let planImgHtml = '';
      if (plan.uri) {
        // Use isPlanPdf() so plans without an explicit fileType (fileType===undefined,
        // which happens when the DB column is NULL for older records) are still handled.
        // Without this, both branches below would be skipped and no image would appear.
        const planIsPdf = isPlanPdf(plan);
        const planIsImage = !planIsPdf && plan.fileType !== 'dxf';

        if (planIsImage) {
          try {
            const dataUrl = await loadFileAsDataUrl(plan.uri, 'image');
            if (dataUrl) planImgHtml = buildGlobalPlanImg(dataUrl);
          } catch { /* skip if loading fails */ }
        } else if (planIsPdf) {
          processedPdfPlans++;
          onProgress?.(processedPdfPlans, totalPdfPlans, plan.name);
          // On native: use pre-rendered JPEG captured from the hidden PdfPlanViewer.
          // On web: render the first PDF page via PDF.js (has DOM + canvas access).
          const nativePreview = preRenderedImages?.get(plan.id);
          if (nativePreview) {
            planImgHtml = buildGlobalPlanImg(nativePreview);
          } else if (Platform.OS === 'web') {
            try {
              const pdfDataUrl = await loadFileAsDataUrl(plan.uri, 'pdf');
              if (pdfDataUrl) {
                const preRendered = await preRenderPdfPageToDataUrl(pdfDataUrl, 720);
                if (preRendered) {
                  planImgHtml = buildGlobalPlanImg(preRendered);
                }
              }
            } catch { /* skip if PDF rendering fails */ }
          }
        }
      }

      // Build reserve rows (numbered 1..N per plan) + photo strips per reserve
      const MAX_PHOTOS_GLOBAL = maxPhotosPerReserve;
      const rowsAndPhotos = await Promise.all(planReserves.map(async (r, i) => {
        const n = i + 1;
        const color = getReservePinColor(r, companiesForColor);
        const statusColor = STATUS_COLORS[r.status] ?? '#6b7280';
        const priorityColor = PRIORITY_COLORS[r.priority] ?? '#6b7280';
        const companyLabel = getReserveCompanyLabel(r);
        const row = `<tr>
          <td style="text-align:center;width:36px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:11px;">${n}</span></td>
          <td style="font-weight:600;">${escapeHtml(r.title)}</td>
          <td>${escapeHtml(companyLabel)}</td>
          <td>${escapeHtml(r.level || '-')}</td>
          <td><span style="color:${statusColor};font-weight:600;">${escapeHtml(reserveStatusLabelForPdf(r.status, t))}</span></td>
          <td><span style="color:${priorityColor};font-weight:600;">${escapeHtml(reservePriorityLabelForPdf(r.priority, t))}</span></td>
          <td>${escapeHtml(r.deadline || '-')}</td>
        </tr>`;
        const rawPhotos = getReservePdfPhotos(r);
        const photosToShow = rawPhotos.slice(0, MAX_PHOTOS_GLOBAL);
        let photoHtml = '';
        if (photosToShow.length > 0) {
          const resolvedSrcs = await Promise.all(photosToShow.map(p => loadPhotoAsDataUrlForPdf(p.uri)));
          photoHtml = `<div style="padding:8px 16px 12px 16px;border-bottom:1px solid #f1f5f9;background:#fff;">
            <div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:6px;">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:9px;margin-right:5px;">${n}</span>
              ${escapeHtml(r.title)} - ${escapeHtml(tOr(t, 'plansScreen.pdfReport.photos', 'Photos'))} (${photosToShow.length}${rawPhotos.length > MAX_PHOTOS_GLOBAL ? ` ${escapeHtml(tOr(t, 'plansScreen.pdfReport.of', 'of'))} ${rawPhotos.length}` : ''})
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
                    ${isDefect ? tOr(t, 'plansScreen.pdfReport.defectPhoto', 'Defect') : tOr(t, 'plansScreen.pdfReport.resolvedPhoto', 'Resolved')}
                  </span>
                </div>`;
              }).join('')}
            </div>
          </div>`;
        }
        return { row, photoHtml };
      }));
      const rows = rowsAndPhotos.map(rp => rp.row).join('');
      const photosSection = rowsAndPhotos.map(rp => rp.photoHtml).filter(Boolean).join('');

      const levelBadge = plan.level
        ? `<span style="font-size:11px;font-weight:600;background:#e2e8f0;color:#64748b;padding:2px 8px;border-radius:10px;margin-left:6px;">${plan.level}</span>`
        : '';

      planBlocks.push(`
        <div class="plan-section">
          <div class="plan-header">${escapeHtml(plan.name)}${levelBadge}<span style="margin-left:auto;font-size:11px;color:#94a3b8;">${escapeHtml(countLabel(t, 'plansScreen.pdfReport.reserveCount', planReserves.length, 'issue', 'issues'))}</span></div>
          ${planImgHtml}
          <table><thead><tr><th>#</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.itemTitle', 'Title'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.company', 'Company'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.level', 'Level'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.status', 'Status'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.priority', 'Priority'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.deadline', 'Due date'))}</th></tr></thead><tbody>${rows}</tbody></table>
          ${photosSection ? `<div style="padding:8px 16px 4px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(tOr(t, 'plansScreen.pdfReport.reservePhotos', 'Issue photos'))}</div>${photosSection}` : ''}
        </div>`);
    }

    // Skip buildings where all plans ended up empty after filtering
    if (buildingReserveCount === 0) continue;

    buildingSections.push(`
      <div class="building-section">
        <div class="building-header">
          <span style="font-size:22px;">🏗️</span>
          ${buildingLabel}
          <span class="building-reserve-count">${buildingReserveCount} réserve${buildingReserveCount !== 1 ? 's' : ''}</span>
        </div>
        ${planBlocks.join('')}
      </div>`);
  }

  // 4b. "Réserves hors plan" section — reserves not placed on any plan
  let orphanSectionHtml = '';
  if (orphanReserves.length > 0) {
    const MAX_PHOTOS_ORPHAN = maxPhotosPerReserve;
    const orphanRowsAndPhotos = await Promise.all(orphanReserves.map(async (r, i) => {
      const n = i + 1;
      const color = getReservePinColor(r, companiesForColor);
      const statusColor = STATUS_COLORS[r.status] ?? '#6b7280';
      const priorityColor = PRIORITY_COLORS[r.priority] ?? '#6b7280';
      const companyLabel = getReserveCompanyLabel(r);
      const row = `<tr>
        <td style="text-align:center;width:36px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:11px;">${n}</span></td>
        <td style="font-weight:600;">${escapeHtml(r.title)}</td>
        <td>${escapeHtml(companyLabel)}</td>
        <td>${escapeHtml(r.building || '-')}</td>
        <td>${escapeHtml(r.level || '-')}</td>
        <td><span style="color:${statusColor};font-weight:600;">${escapeHtml(reserveStatusLabelForPdf(r.status, t))}</span></td>
        <td><span style="color:${priorityColor};font-weight:600;">${escapeHtml(reservePriorityLabelForPdf(r.priority, t))}</span></td>
        <td>${escapeHtml(r.deadline || '-')}</td>
      </tr>`;
      const rawPhotos = getReservePdfPhotos(r);
      const photosToShow = rawPhotos.slice(0, MAX_PHOTOS_ORPHAN);
      let photoHtml = '';
      if (photosToShow.length > 0) {
        const resolvedSrcs = await Promise.all(photosToShow.map(p => loadPhotoAsDataUrlForPdf(p.uri)));
        photoHtml = `<div style="padding:8px 16px 12px 16px;border-bottom:1px solid #f1f5f9;background:#fff;">
          <div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:6px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:9px;margin-right:5px;">${n}</span>
            ${escapeHtml(r.title)} - ${escapeHtml(tOr(t, 'plansScreen.pdfReport.photos', 'Photos'))} (${photosToShow.length}${rawPhotos.length > MAX_PHOTOS_ORPHAN ? ` ${escapeHtml(tOr(t, 'plansScreen.pdfReport.of', 'of'))} ${rawPhotos.length}` : ''})
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
                  ${isDefect ? tOr(t, 'plansScreen.pdfReport.defectPhoto', 'Defect') : tOr(t, 'plansScreen.pdfReport.resolvedPhoto', 'Resolved')}
                </span>
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }
      return { row, photoHtml };
    }));
    const orphanRows = orphanRowsAndPhotos.map(rp => rp.row).join('');
    const orphanPhotosSection = orphanRowsAndPhotos.map(rp => rp.photoHtml).filter(Boolean).join('');
    orphanSectionHtml = `
      <div class="building-section">
        <div class="building-header" style="background:linear-gradient(135deg,#475569 0%,#64748b 100%);">
          <span style="font-size:22px;">📍</span>
          ${escapeHtml(tOr(t, 'plansScreen.pdfReport.orphanTitle', 'Issues without plan'))}
          <span class="building-reserve-count">${escapeHtml(countLabel(t, 'plansScreen.pdfReport.orphanCount', orphanReserves.length, 'issue without location', 'issues without location'))}</span>
        </div>
        <div class="plan-section" style="border-radius:0 0 8px 8px;">
          <div class="plan-header" style="color:#64748b;font-style:italic;">${escapeHtml(tOr(t, 'plansScreen.pdfReport.orphanHint', 'These issues are not positioned on a plan'))}</div>
          <table><thead><tr><th>#</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.itemTitle', 'Title'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.company', 'Company'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.building', 'Building'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.level', 'Level'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.status', 'Status'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.priority', 'Priority'))}</th><th>${escapeHtml(tOr(t, 'reservesScreen.report.deadline', 'Due date'))}</th></tr></thead><tbody>${orphanRows}</tbody></table>
          ${orphanPhotosSection ? `<div style="padding:8px 16px 4px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(tOr(t, 'plansScreen.pdfReport.reservePhotos', 'Issue photos'))}</div>${orphanPhotosSection}` : ''}
        </div>
      </div>`;
  }

  // 5. Summary table grouped by status
  const totalReserves = filteredReserves.length;
  const byStatus = new Map<string, Reserve[]>();
  for (const r of filteredReserves) {
    if (!byStatus.has(r.status)) byStatus.set(r.status, []);
    byStatus.get(r.status)!.push(r);
  }
  const statusOrder = ['open', 'in_progress', 'waiting', 'verification', 'closed'];
  const summaryRows = statusOrder.map(s => {
    const rs = byStatus.get(s) ?? [];
    if (rs.length === 0) return '';
    const color = STATUS_COLORS[s] ?? '#6b7280';
    const pct = totalReserves > 0 ? Math.round((rs.length / totalReserves) * 100) : 0;
    return `<tr>
      <td><span style="color:${color};font-weight:600;">${escapeHtml(reserveStatusLabelForPdf(s, t))}</span></td>
      <td style="text-align:right;font-weight:700;">${rs.length}</td>
      <td style="text-align:right;color:#94a3b8;">${pct}%</td>
      <td><div style="background:#e2e8f0;border-radius:4px;height:8px;width:100%;overflow:hidden;"><div style="background:${color};height:8px;width:${pct}%;border-radius:4px;"></div></div></td>
    </tr>`;
  }).join('');

  const dateStr = new Date().toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });
  const companyLabel = companyFilter ?? tOr(t, 'plansScreen.pdf.allCompanies', 'All companies');
  const statusLabel = (!statusFilter || statusFilter.size === 0)
    ? null
    : Array.from(statusFilter).map(s => reserveStatusLabelForPdf(s, t)).join(', ');
  // Cover stats: only count buildings/plans that actually contain reserves
  // buildingSections is already populated (only sections with reserves were pushed)
  const totalBuildings = buildingSections.length;
  const totalPlans = plansWithReserves.filter(p => (reservesByPlan.get(p.id) ?? []).length > 0).length;
  const totalOrphans = orphanReserves.length;

  const html = `<!DOCTYPE html>
<html lang="${locale.split('-')[0]}">
<head><meta charset="UTF-8"/>
<title>${escapeHtml(tOr(t, 'plansScreen.pdfReport.globalTitle', 'Issues report'))} - ${escapeHtml(chantierName)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;}
body{background:#fff;color:#1a1a2e;}
.cover-page{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:90vh;padding:60px 40px;text-align:center;page-break-after:always;break-after:page;}
.cover-logo{font-size:64px;margin-bottom:32px;}
.cover-title{font-size:36px;font-weight:800;color:#1E3A5F;margin-bottom:16px;letter-spacing:-0.5px;}
.cover-chantier{font-size:22px;font-weight:600;color:#334155;margin-bottom:12px;}
.cover-company{font-size:15px;color:#64748b;background:#f1f5f9;padding:7px 22px;border-radius:20px;display:inline-block;}
.cover-divider{width:80px;height:4px;background:#1E3A5F;margin:28px auto;border-radius:2px;}
.cover-stats{display:flex;gap:48px;justify-content:center;margin-top:36px;}
.stat-block{text-align:center;}
.stat-num{display:block;font-size:42px;font-weight:800;color:#1E3A5F;line-height:1;}
.stat-lbl{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1.2px;margin-top:5px;display:block;}
.cover-date{font-size:12px;color:#94a3b8;margin-top:52px;}
.building-section{page-break-before:always;break-before:page;padding-bottom:4px;}
.building-header{background:linear-gradient(135deg,#1E3A5F 0%,#2d5282 100%);color:#fff;padding:18px 24px;font-size:20px;font-weight:700;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:12px;}
.building-reserve-count{font-size:13px;font-weight:400;opacity:0.65;margin-left:auto;}
.plan-section{border:1px solid #e2e8f0;border-top:none;background:#fafafa;}
.plan-section:last-child{border-radius:0 0 8px 8px;}
.plan-header{background:#f1f5f9;padding:10px 18px;font-size:13px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:6px;}
.plan-image-wrap{padding:12px 16px;background:#fff;border-bottom:1px solid #e2e8f0;}
.plan-no-image{padding:12px 16px;text-align:center;color:#94a3b8;font-size:12px;background:#fff;border-bottom:1px solid #e2e8f0;}
.no-reserves{padding:14px 16px;text-align:center;color:#b0b8c8;font-size:12px;}
table{width:100%;border-collapse:collapse;font-size:12px;}
thead th{background:#f8fafc;color:#475569;font-weight:600;text-align:left;padding:8px 10px;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;}
tbody tr{border-bottom:1px solid #f1f5f9;}
tbody td{padding:7px 10px;vertical-align:middle;}
.summary-section{page-break-before:always;break-before:page;padding:36px 28px;}
.summary-title{font-size:22px;font-weight:700;color:#1E3A5F;margin-bottom:24px;padding-bottom:12px;border-bottom:2px solid #e2e8f0;}
.summary-table thead th{font-size:11px;}
.summary-table tbody td{font-size:13px;padding:10px;}
.footer{margin-top:28px;font-size:10px;color:#bbb;text-align:center;border-top:1px solid #eee;padding-top:12px;}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}@page{margin:14mm;}}
</style>
</head>
<body>
<div class="cover-page">
  <div class="cover-logo">📋</div>
  <div class="cover-title">${escapeHtml(tOr(t, 'plansScreen.pdfReport.globalTitle', 'Issues report'))}</div>
  <div class="cover-chantier">${escapeHtml(chantierName)}</div>
  <div class="cover-divider"></div>
  <div class="cover-company">🏢 ${escapeHtml(companyLabel)}</div>
  ${statusLabel ? `<div style="font-size:13px;color:#1E3A5F;background:#e8f0fe;padding:5px 18px;border-radius:16px;display:inline-block;margin-top:8px;">${escapeHtml(tOr(t, 'plansScreen.pdfReport.statuses', 'Statuses'))}: ${escapeHtml(statusLabel)}</div>` : ''}
  <div class="cover-stats">
    <div class="stat-block"><span class="stat-num">${totalReserves}</span><span class="stat-lbl">${escapeHtml(tOr(t, 'plansScreen.pdfReport.reservesStat', 'issues'))}</span></div>
    <div class="stat-block"><span class="stat-num">${totalBuildings}</span><span class="stat-lbl">${escapeHtml(tOr(t, 'plansScreen.pdfReport.buildingsStat', 'buildings'))}</span></div>
    <div class="stat-block"><span class="stat-num">${totalPlans}</span><span class="stat-lbl">${escapeHtml(tOr(t, 'plansScreen.pdfReport.plansStat', 'plans'))}</span></div>
    ${totalOrphans > 0 ? `<div class="stat-block"><span class="stat-num" style="color:#64748b;">${totalOrphans}</span><span class="stat-lbl">${escapeHtml(tOr(t, 'plansScreen.pdfReport.offPlanStat', 'off plan'))}</span></div>` : ''}
  </div>
  <div class="cover-date">${escapeHtml(tOr(t, 'reservesScreen.report.generatedOn', 'Generated on {{date}}', { date: dateStr }))} - BuildTrack</div>
</div>
${buildingSections.join('\n')}
${orphanSectionHtml}
<div class="summary-section">
  <div class="summary-title">${escapeHtml(tOr(t, 'plansScreen.pdfReport.summaryTitle', 'Summary table'))}</div>
  <table class="summary-table">
    <thead><tr><th>${escapeHtml(tOr(t, 'reservesScreen.report.status', 'Status'))}</th><th style="text-align:right;">${escapeHtml(tOr(t, 'plansScreen.pdfReport.count', 'Count'))}</th><th style="text-align:right;">%</th><th>${escapeHtml(tOr(t, 'plansScreen.pdfReport.distribution', 'Distribution'))}</th></tr></thead>
    <tbody>${summaryRows || `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px;">${escapeHtml(tOr(t, 'reservesScreen.empty.noReserve', 'No issue'))}</td></tr>`}</tbody>
  </table>
  <div class="footer">BuildTrack - ${escapeHtml(tOr(t, 'plansScreen.pdfReport.tagline', 'Digital construction management'))} - ${dateStr}</div>
</div>
</body>
</html>`;

  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    if (win) {
      win.document.open(); win.document.write(html); win.document.close();
      if (action === 'print') {
        setTimeout(() => { try { win.print(); } catch {} }, 800);
      }
    }
  } else {
    if (action === 'print') {
      await printPDFHelper(html, buildPdfFilename('Rapport_Plans', [chantierName]));
    } else {
      await exportPDFHelper(html, buildPdfFilename('Rapport_Plans', [chantierName]));
    }
  }
}

export default function PlansScreen() {
  const { t, i18n } = useTranslation();
  const pdfLocale = useMemo(() => localeFromLanguage(i18n.language), [i18n.language]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { focusPlanId: focusPlanIdParam, focusReserveId: focusReserveIdParam } = useLocalSearchParams<{ focusPlanId?: string; focusReserveId?: string }>();
  const {
    reserves, companies, sitePlans, photos, activeChantierId, activeChantier, isLoading,
    addSitePlan, updateSitePlan, deleteSitePlan, addSitePlanVersion, migrateReservesToPlan,
    updateReserveStatus, updateReserveFields,
  } = useApp();
  const { permissions, user } = useAuth();
  const canMovePins: boolean = Object.prototype.hasOwnProperty.call(permissions, 'canMovePins')
    ? (permissions as any).canMovePins
    : true;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const topPad = insets.top;
  const commonPlanText = useCallback(
    (count: number) => t(count === 1 ? 'plansUi.plan_one' : 'plansUi.plan_other', { count }),
    [t]
  );
  const commonReserveText = useCallback(
    (count: number) => t(count === 1 ? 'plansUi.reserves_one' : 'plansUi.reserves_other', { count }),
    [t]
  );
  const getStatusLabel = useCallback(
    (status: string) => t(`reserveLabels.status.${status}`, { defaultValue: RESERVE_STATUS_LABELS[status as ReserveStatus] ?? status }),
    [t]
  );

  const chantierPlans = useMemo(
    () => sitePlans.filter(p => p.chantierId === activeChantierId),
    [sitePlans, activeChantierId]
  );
  const chantierPlanById = useMemo(() => {
    const map = new Map<string, SitePlan>();
    chantierPlans.forEach(plan => map.set(plan.id, plan));
    return map;
  }, [chantierPlans]);
  const reserveCountByPlanId = useMemo(() => {
    const map = new Map<string, number>();
    reserves.forEach(reserve => {
      if (!reserve.planId) return;
      map.set(reserve.planId, (map.get(reserve.planId) ?? 0) + 1);
    });
    return map;
  }, [reserves]);

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
  const [newPlanModal, setNewPlanModal] = useState<{
    visible: boolean; name: string; building: string; level: string;
    buildingId?: string; levelId?: string;
    uri?: string; size?: string; fileType?: 'pdf' | 'image' | 'dxf'; uploading?: boolean;
  }>({ visible: false, name: '', building: '', level: '' });
  const [kbHeight, setKbHeight] = useState(0);
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

  // PDF export modal state
  const [pdfModalVisible, setPdfModalVisible] = useState(false);
  const [pdfScope, setPdfScope] = useState<'plan' | 'global'>('plan');
  const [pdfMode, setPdfMode] = useState<'all' | 'company_single' | 'company_multi' | 'company_none' | 'manual'>('all');
  const [pdfCompanySingle, setPdfCompanySingle] = useState<string | null>(null);
  const [pdfCompaniesMulti, setPdfCompaniesMulti] = useState<Set<string>>(new Set());
  const [pdfManualSelection, setPdfManualSelection] = useState<Set<string>>(new Set());
  const [pdfLoading, setPdfLoading] = useState(false);
  const [globalReportProgress, setGlobalReportProgress] = useState<{ current: number; total: number; planName: string } | null>(null);
  // Global report state
  const [globalReportCompany, setGlobalReportCompany] = useState<string | null>(null);
  const [globalReportStatusFilter, setGlobalReportStatusFilter] = useState<Set<string>>(new Set());
  const [globalReportEmailTo, setGlobalReportEmailTo] = useState('');
  const [globalReportEmailLoading, setGlobalReportEmailLoading] = useState(false);
  const [pinSizes, setPinSizes] = useState<Record<string, number>>({});
  const [focusedPinId, setFocusedPinId] = useState<string | null>(null);
  const [draggingPinId, setDraggingPinId] = useState<string | null>(null);
  const draggingAnimX = useRef(new Animated.Value(0)).current;
  const draggingAnimY = useRef(new Animated.Value(0)).current;
  const draggingAnimSzHalf = useRef(12);
  const draggingFirstMoveRef = useRef(false);
  const [dxfLoading, setDxfLoading] = useState(false);
  const [buildingPickerOpen, setBuildingPickerOpen] = useState(false);
  const [buildingRailQuery, setBuildingRailQuery] = useState('');
  const [recentBuildingsByChantier, setRecentBuildingsByChantier] = useState<Record<string, string[]>>({});
  const [levelPickerOpen, setLevelPickerOpen] = useState(false);
  const [recentLevelsByBuilding, setRecentLevelsByBuilding] = useState<Record<string, string[]>>({});
  // Mémorise la dernière famille de bâtiments choisie dans le picker, par chantier.
  // Permet de retomber directement sur la bonne catégorie à la réouverture.
  const [recentFamilyByChantier, setRecentFamilyByChantier] = useState<Record<string, string>>({});

  const pdfViewerRef = useRef<PdfPlanViewerHandle>(null);
  const reserveListRef = useRef<FlatList<Reserve> | null>(null);

  // Hidden PDF viewer for pre-rendering plan images in the global report on native.
  // On web, preRenderPdfPageToDataUrl() handles this directly.
  const preRenderRef = useRef<PdfPlanViewerHandle>(null);
  const [preRenderState, setPreRenderState] = useState<{ uri: string; planId: string } | null>(null);
  const preRenderReadyRef = useRef<(() => void) | null>(null);

  const onPreRenderReady = useCallback(() => {
    preRenderReadyRef.current?.();
    preRenderReadyRef.current = null;
  }, []);

  const capturePreRenderPlan = useCallback(
    (planUri: string, planId: string): Promise<string | null> => {
      if (Platform.OS === 'web') return Promise.resolve(null);
      return new Promise<string | null>((resolve) => {
        const done = (dataUrl: string | null) => {
          preRenderReadyRef.current = null;
          setPreRenderState(null);
          resolve(dataUrl);
        };
        const timeout = setTimeout(() => done(null), 30000);
        preRenderReadyRef.current = async () => {
          clearTimeout(timeout);
          try {
            const dataUrl = await preRenderRef.current?.captureImageDataUrl() ?? null;
            done(dataUrl);
          } catch {
            done(null);
          }
        };
        setPreRenderState({ uri: planUri, planId });
      });
    },
    []
  );

  // Declared early so it can be used as a proper dependency in the effect below.
  // (Babel transpiles const→var; declaring after the useEffect would leave the
  //  deps array capturing `undefined` at evaluation time.)
  const chantierHierarchyBuildingsEarly = useMemo(
    () => activeChantier?.buildings ?? [],
    [activeChantier]
  );

  // Ref used by the unified chantier/building effect below
  const prevChantierIdRef = useRef<string | null | undefined>(undefined);
  const hasAutoSelectedBuildingRef = useRef(false);

  // Last view persistence (selected plan / building / level per chantier)
  const [lastViewByChantier, setLastViewByChantier] = useState<Record<string, PlansLastView>>({});
  const lastViewLoadedRef = useRef(false);
  const [lastViewHydrated, setLastViewHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(HINT_KEY).then(v => { if (v === '1') setHintSeen(true); });
    AsyncStorage.getItem(PIN_SIZE_KEY).then(v => { if (v) { const n = parseFloat(v); if (!isNaN(n)) setPinSizeScale(n); } });
    AsyncStorage.getItem(PIN_SIZES_KEY).then(v => { if (v) { try { setPinSizes(JSON.parse(v)); } catch {} } });
    AsyncStorage.getItem(RECENT_BUILDINGS_KEY).then(v => {
      if (v) { try { setRecentBuildingsByChantier(JSON.parse(v)); } catch {} }
    });
    AsyncStorage.getItem(RECENT_LEVELS_KEY).then(v => {
      if (v) { try { setRecentLevelsByBuilding(JSON.parse(v)); } catch {} }
    });
    AsyncStorage.getItem(RECENT_FAMILY_KEY).then(v => {
      if (v) { try { setRecentFamilyByChantier(JSON.parse(v)); } catch {} }
    });
    AsyncStorage.getItem(LAST_VIEW_KEY).then(v => {
      let parsed: Record<string, PlansLastView> = {};
      if (v) { try { parsed = JSON.parse(v); } catch {} }
      lastViewLoadedRef.current = true;
      setLastViewByChantier(parsed);
      setLastViewHydrated(true);
    }).catch(() => {
      lastViewLoadedRef.current = true;
      setLastViewHydrated(true);
    });
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => setKbHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKbHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Unified effect: resets/restores state on chantier change AND auto-selects
  // the first building as soon as hierarchy data is available.
  // On cold start (or when re-visiting a chantier), restore the previously
  // selected plan / building / level from persisted storage.
  useEffect(() => {
    if (!lastViewHydrated) return; // wait for persisted view to load
    const isNewChantier = prevChantierIdRef.current !== activeChantierId;
    prevChantierIdRef.current = activeChantierId ?? null;
    const saved = activeChantierId ? lastViewByChantier[activeChantierId] : null;

    if (isNewChantier) {
      hasAutoSelectedBuildingRef.current = false;
      setStatusFilter('all');
      setCompanyFilter('all');
      setLevelFilter('all');
      if (saved) {
        // Restore previous plan / building / level for this chantier
        setActivePlanId(saved.planId ?? null);
        setSelectedBuilding(saved.buildingId ?? 'all');
        setSelectedLevel(saved.levelId ?? 'all');
        // Don't auto-override the restored building selection
        hasAutoSelectedBuildingRef.current = true;
      } else {
        setActivePlanId(null);
        setSelectedBuilding('all');
        setSelectedLevel('all');
      }
    }

    // Auto-select the first building once hierarchy data is available.
    // Only runs for first-time chantier visits (no saved view).
    if (!hasAutoSelectedBuildingRef.current && chantierHierarchyBuildingsEarly.length > 0) {
      hasAutoSelectedBuildingRef.current = true;
      setSelectedBuilding(chantierHierarchyBuildingsEarly[0].id);
    }
  }, [activeChantierId, chantierHierarchyBuildingsEarly, lastViewHydrated, lastViewByChantier]);

  // Persist the current view (plan / building / level) for the active chantier
  // so a cold restart returns the user to where they were.
  useEffect(() => {
    if (!activeChantierId || !lastViewLoadedRef.current) return;
    // Don't save until after the initial restore for this chantier has run
    if (prevChantierIdRef.current !== activeChantierId) return;
    const cur = lastViewByChantier[activeChantierId];
    if (
      cur
      && cur.planId === activePlanId
      && cur.buildingId === selectedBuilding
      && cur.levelId === selectedLevel
    ) {
      return; // unchanged
    }
    const next: Record<string, PlansLastView> = {
      ...lastViewByChantier,
      [activeChantierId]: {
        planId: activePlanId,
        buildingId: selectedBuilding,
        levelId: selectedLevel,
      },
    };
    setLastViewByChantier(next);
    AsyncStorage.setItem(LAST_VIEW_KEY, JSON.stringify(next)).catch(() => {});
  }, [activePlanId, selectedBuilding, selectedLevel, activeChantierId, lastViewByChantier]);

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
        const next = Math.min(3.0, Math.max(0.25, parseFloat((current + delta).toFixed(2))));
        const updated = { ...prev, [pinId]: next };
        AsyncStorage.setItem(PIN_SIZES_KEY, JSON.stringify(updated));
        return updated;
      });
      if (focusedPinTimerRef.current) clearTimeout(focusedPinTimerRef.current);
      focusedPinTimerRef.current = setTimeout(() => setFocusedPinIdRef.current(null), 5000);
    } else {
      setPinSizeScale(prev => {
        const next = Math.min(2.5, Math.max(0.25, parseFloat((prev + delta).toFixed(2))));
        AsyncStorage.setItem(PIN_SIZE_KEY, String(next));
        return next;
      });
    }
  }

  function getPinDisplaySize(id: string, base: number): number {
    const individualScale = pinSizes[id] ?? 1.0;
    return Math.max(10, Math.round(base * individualScale));
  }

  function getPinLabelSize(size: number): number {
    return Math.max(7, Math.min(12, Math.round(size * 0.42)));
  }

  const buildings = useMemo(() => {
    const b = Array.from(new Set(chantierPlans.map(p => p.building).filter(Boolean))) as string[];
    return b.sort();
  }, [chantierPlans]);

  // Alias to the early declaration — all downstream code uses this name.
  const chantierHierarchyBuildings = chantierHierarchyBuildingsEarly;

  // Renvoie le dernier niveau visité pour ce bâtiment s'il existe encore
  // dans la hiérarchie. Sinon, retombe sur 'all'. On utilise la 1ère entrée
  // de `recentLevelsByBuilding` qui est toujours le plus récent (cf. effet
  // qui maintient cette liste).
  const pickInitialLevelForBuilding = (buildingId: string): string => {
    const building = chantierHierarchyBuildings.find(b => b.id === buildingId);
    if (!building || !building.levels?.length) return 'all';
    const recents = recentLevelsByBuilding[buildingId];
    if (!recents?.length) return 'all';
    const lastVisited = recents[0];
    if (building.levels.some(l => l.id === lastVisited)) return lastVisited;
    return 'all';
  };

  const orphanPlans = useMemo(
    () => chantierPlans.filter(p => !p.buildingId && !p.building),
    [chantierPlans]
  );
  const hasOrphanPlans = orphanPlans.length > 0;

  const showBuildingChips = chantierHierarchyBuildings.length > 1 || hasOrphanPlans;
  const useHybridPicker = chantierHierarchyBuildings.length >= HYBRID_PICKER_THRESHOLD;
  const showBuildingRail = showBuildingChips && useHybridPicker && isTablet && !fullscreen;

  const handleSelectAllBuildings = () => {
    setSelectedBuilding('all');
    setSelectedLevel('all');
    setActivePlanId(null);
  };

  const handleSelectBuilding = (id: string) => {
    setSelectedBuilding(id);
    setSelectedLevel(pickInitialLevelForBuilding(id));
    setActivePlanId(null);
  };

  const handleSelectOrphanPlans = () => {
    setSelectedBuilding('__none__');
    setSelectedLevel('all');
    setActivePlanId(null);
  };

  const buildingCounters = useMemo(() => {
    const planById = new Map<string, number>();
    const planByName = new Map<string, number>();
    const reserveById = new Map<string, number>();
    const reserveByName = new Map<string, number>();

    chantierPlans.forEach(plan => {
      if (plan.buildingId) {
        planById.set(plan.buildingId, (planById.get(plan.buildingId) ?? 0) + 1);
      } else if (plan.building) {
        planByName.set(plan.building, (planByName.get(plan.building) ?? 0) + 1);
      }
    });

    reserves.forEach(reserve => {
      if (reserve.archivedAt || reserve.status === 'closed') return;
      if (reserve.buildingId) {
        reserveById.set(reserve.buildingId, (reserveById.get(reserve.buildingId) ?? 0) + 1);
      } else if (reserve.building) {
        reserveByName.set(reserve.building, (reserveByName.get(reserve.building) ?? 0) + 1);
      }
    });

    return { planById, planByName, reserveById, reserveByName };
  }, [chantierPlans, reserves]);

  const buildingItems = useMemo<BuildingItem[]>(() => {
    return chantierHierarchyBuildings.map(b => {
      const planCount = (buildingCounters.planById.get(b.id) ?? 0) + (buildingCounters.planByName.get(b.name) ?? 0);
      const reserveCount = (buildingCounters.reserveById.get(b.id) ?? 0) + (buildingCounters.reserveByName.get(b.name) ?? 0);
      return { id: b.id, name: b.name, planCount, reserveCount };
    });
  }, [chantierHierarchyBuildings, buildingCounters]);

  const activeReserveCountForRail = useMemo(
    () => reserves.filter(r => !r.archivedAt && r.status !== 'closed').length,
    [reserves]
  );

  const orphanReserveCountForRail = useMemo(
    () => reserves.filter(r => !r.archivedAt && r.status !== 'closed' && !r.buildingId && !r.building).length,
    [reserves]
  );

  const buildingRailItems = useMemo<BuildingRailItem[]>(() => {
    const items: BuildingRailItem[] = [];
    if (hasOrphanPlans) {
      items.push({
        id: '__none__',
        kind: 'orphans',
        name: t('plansScreen.general'),
        planCount: orphanPlans.length,
        reserveCount: orphanReserveCountForRail,
      });
    }
    return [
      ...items,
      ...buildingItems.map(b => ({ ...b, kind: 'building' as const })),
    ];
  }, [buildingItems, hasOrphanPlans, orphanPlans.length, orphanReserveCountForRail, t]);

  const filteredBuildingRailItems = useMemo(() => {
    const query = buildingRailQuery.trim().toLowerCase();
    if (!query) return buildingRailItems;
    return buildingRailItems.filter(item => item.name.toLowerCase().includes(query));
  }, [buildingRailItems, buildingRailQuery]);

  const recentBuildingIds = useMemo(
    () => (activeChantierId ? recentBuildingsByChantier[activeChantierId] ?? [] : []),
    [recentBuildingsByChantier, activeChantierId]
  );

  // Track recently consulted buildings (per chantier) — most recent first, max 8.
  useEffect(() => {
    if (!activeChantierId) return;
    if (selectedBuilding === 'all' || selectedBuilding === '__none__') return;
    if (!chantierHierarchyBuildings.some(b => b.id === selectedBuilding)) return;
    setRecentBuildingsByChantier(prev => {
      const current = prev[activeChantierId] ?? [];
      if (current[0] === selectedBuilding) return prev;
      const next = [selectedBuilding, ...current.filter(id => id !== selectedBuilding)].slice(0, 8);
      const updated = { ...prev, [activeChantierId]: next };
      AsyncStorage.setItem(RECENT_BUILDINGS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, [selectedBuilding, activeChantierId, chantierHierarchyBuildings]);

  // Visible chips for hybrid mode: always include the active building, then fill with recents.
  const visibleRecentChips = useMemo<BuildingItem[]>(() => {
    if (!useHybridPicker) return [];
    const order: string[] = [];
    if (
      selectedBuilding !== 'all' &&
      selectedBuilding !== '__none__' &&
      chantierHierarchyBuildings.some(b => b.id === selectedBuilding)
    ) {
      order.push(selectedBuilding);
    }
    for (const id of recentBuildingIds) {
      if (!order.includes(id)) order.push(id);
      if (order.length >= VISIBLE_RECENT_CHIPS) break;
    }
    if (order.length < VISIBLE_RECENT_CHIPS) {
      for (const b of chantierHierarchyBuildings) {
        if (!order.includes(b.id)) order.push(b.id);
        if (order.length >= VISIBLE_RECENT_CHIPS) break;
      }
    }
    const map = new Map(buildingItems.map(b => [b.id, b]));
    return order.map(id => map.get(id)).filter(Boolean) as BuildingItem[];
  }, [useHybridPicker, selectedBuilding, recentBuildingIds, chantierHierarchyBuildings, buildingItems]);

  // ----- Level picker (per active building) -----
  const activeBuildingForLevels = useMemo(() => {
    if (selectedBuilding === 'all' || selectedBuilding === '__none__') return null;
    return chantierHierarchyBuildings.find(b => b.id === selectedBuilding) ?? null;
  }, [chantierHierarchyBuildings, selectedBuilding]);

  const levelItems = useMemo<LevelItem[]>(() => {
    if (!activeBuildingForLevels) return [];
    const bldg = activeBuildingForLevels;
    const planByLevelId = new Map<string, number>();
    const planByLevelName = new Map<string, number>();
    const reserveByLevelId = new Map<string, number>();
    const reserveByLevelName = new Map<string, number>();

    chantierPlans.forEach(plan => {
      const matchesBuilding =
        plan.buildingId === bldg.id ||
        (!plan.buildingId && plan.building === bldg.name);
      if (!matchesBuilding) return;
      if (plan.levelId) {
        planByLevelId.set(plan.levelId, (planByLevelId.get(plan.levelId) ?? 0) + 1);
      } else if (plan.level) {
        planByLevelName.set(plan.level, (planByLevelName.get(plan.level) ?? 0) + 1);
      }
    });

    reserves.forEach(reserve => {
      if (reserve.archivedAt || reserve.status === 'closed') return;
      const matchesBuilding =
        (reserve.buildingId && reserve.buildingId === bldg.id) ||
        (!reserve.buildingId && reserve.building === bldg.name);
      if (!matchesBuilding) return;
      if (reserve.levelId) {
        reserveByLevelId.set(reserve.levelId, (reserveByLevelId.get(reserve.levelId) ?? 0) + 1);
      } else if (reserve.level) {
        reserveByLevelName.set(reserve.level, (reserveByLevelName.get(reserve.level) ?? 0) + 1);
      }
    });

    return bldg.levels.map(l => {
      const planCount = (planByLevelId.get(l.id) ?? 0) + (planByLevelName.get(l.name) ?? 0);
      const reserveCount = (reserveByLevelId.get(l.id) ?? 0) + (reserveByLevelName.get(l.name) ?? 0);
      return { id: l.id, name: l.name, planCount, reserveCount };
    });
  }, [activeBuildingForLevels, chantierPlans, reserves]);

  const useHybridLevelPicker = levelItems.length >= HYBRID_LEVEL_THRESHOLD;

  const recentLevelIds = useMemo(
    () => (activeBuildingForLevels ? recentLevelsByBuilding[activeBuildingForLevels.id] ?? [] : []),
    [recentLevelsByBuilding, activeBuildingForLevels]
  );

  // Track recently consulted levels per building.
  useEffect(() => {
    if (!activeBuildingForLevels) return;
    if (selectedLevel === 'all') return;
    if (!activeBuildingForLevels.levels.some(l => l.id === selectedLevel)) return;
    const bid = activeBuildingForLevels.id;
    setRecentLevelsByBuilding(prev => {
      const current = prev[bid] ?? [];
      if (current[0] === selectedLevel) return prev;
      const next = [selectedLevel, ...current.filter(id => id !== selectedLevel)].slice(0, 8);
      const updated = { ...prev, [bid]: next };
      AsyncStorage.setItem(RECENT_LEVELS_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, [selectedLevel, activeBuildingForLevels]);

  const visibleRecentLevelChips = useMemo<LevelItem[]>(() => {
    if (!useHybridLevelPicker || !activeBuildingForLevels) return [];
    const order: string[] = [];
    if (selectedLevel !== 'all' && activeBuildingForLevels.levels.some(l => l.id === selectedLevel)) {
      order.push(selectedLevel);
    }
    for (const id of recentLevelIds) {
      if (!order.includes(id)) order.push(id);
      if (order.length >= VISIBLE_RECENT_LEVEL_CHIPS) break;
    }
    if (order.length < VISIBLE_RECENT_LEVEL_CHIPS) {
      for (const l of activeBuildingForLevels.levels) {
        if (!order.includes(l.id)) order.push(l.id);
        if (order.length >= VISIBLE_RECENT_LEVEL_CHIPS) break;
      }
    }
    const map = new Map(levelItems.map(l => [l.id, l]));
    return order.map(id => map.get(id)).filter(Boolean) as LevelItem[];
  }, [useHybridLevelPicker, activeBuildingForLevels, selectedLevel, recentLevelIds, levelItems]);

  const levelsForNewPlanBuilding = useMemo(() => {
    if (!newPlanModal.buildingId && !newPlanModal.building) return [];
    const bldg = chantierHierarchyBuildings.find(b =>
      newPlanModal.buildingId ? b.id === newPlanModal.buildingId : b.name === newPlanModal.building
    );
    return bldg?.levels ?? [];
  }, [chantierHierarchyBuildings, newPlanModal.building, newPlanModal.buildingId]);

  const planLevelsForBuilding = useMemo(() => {
    const scope = selectedBuilding === 'all' ? chantierPlans : chantierPlans.filter(p => (p.building ?? '') === selectedBuilding);
    const lvls = Array.from(new Set(scope.map(p => p.level).filter(Boolean))) as string[];
    return lvls.sort(compareLevels);
  }, [chantierPlans, selectedBuilding]);

  const filteredPlans = useMemo(() => {
    let plans = chantierPlans;
    if (chantierHierarchyBuildings.length > 0) {
      if (selectedBuilding !== 'all') {
        if (selectedBuilding === '__none__') {
          plans = plans.filter(p => !p.buildingId && !p.building);
        } else {
          const bldgName = chantierHierarchyBuildings.find(b => b.id === selectedBuilding)?.name;
          plans = plans.filter(p =>
            p.buildingId === selectedBuilding ||
            (p.buildingId === undefined && p.building === bldgName)
          );
        }
      }
      if (selectedLevel !== 'all' && selectedBuilding !== '__none__') {
        let lvlName: string | undefined;
        for (const b of chantierHierarchyBuildings) {
          const found = b.levels.find(l => l.id === selectedLevel);
          if (found) { lvlName = found.name; break; }
        }
        plans = plans.filter(p =>
          p.levelId === selectedLevel ||
          (p.levelId === undefined && p.level === lvlName)
        );
      }
    } else {
      if (selectedBuilding !== 'all' && buildings.length >= 2) plans = plans.filter(p => (p.building ?? '') === selectedBuilding);
      if (selectedLevel !== 'all' && planLevelsForBuilding.length >= 2) plans = plans.filter(p => (p.level ?? '') === selectedLevel);
    }
    return plans;
  }, [chantierPlans, selectedBuilding, chantierHierarchyBuildings, selectedLevel, buildings, planLevelsForBuilding]);

  const hasActiveHierarchyFilter =
    selectedLevel !== 'all' ||
    (selectedBuilding !== 'all' && selectedBuilding !== '__none__' && chantierHierarchyBuildings.length > 0);
  const currentPlanId = activePlanId ?? filteredPlans[0]?.id ?? (hasActiveHierarchyFilter ? null : chantierPlans[0]?.id) ?? null;
  const currentPlan = currentPlanId ? chantierPlanById.get(currentPlanId) ?? null : null;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!chantierPlans.some(plan => !!plan.uri && isPlanPdf(plan))) return;
    loadBundledPdfJsSources().catch(() => {});
  }, [chantierPlans]);

  useEffect(() => {
    if (Platform.OS === 'web' || !currentPlan?.uri || !isPlanPdf(currentPlan)) return;
    const isRemote = (uri: string) => uri.startsWith('http://') || uri.startsWith('https://');
    if (!isRemote(currentPlan.uri)) return;

    ensurePlanCached(currentPlan.uri).catch(() => {});

    const currentIndex = filteredPlans.findIndex(plan => plan.id === currentPlan.id);
    const adjacentPlans = [filteredPlans[currentIndex - 1], filteredPlans[currentIndex + 1]];
    adjacentPlans.forEach(plan => {
      if (plan?.uri && isPlanPdf(plan) && isRemote(plan.uri)) {
        ensurePlanCached(plan.uri).catch(() => {});
      }
    });
  }, [currentPlan?.id, currentPlan?.uri, currentPlan?.fileType, filteredPlans]);

  const isSousTraitant = user?.role === 'sous_traitant';
  const sousTraitantCompanyName = isSousTraitant && user?.companyId
    ? companies.find(c => c.id === user.companyId)?.name ?? null
    : null;

  const allPlanReserves = useMemo(() => {
    // Filtres systématiques du plan :
    //  - réserves archivées (archivedAt non null) : masquées,
    //    sauf lorsqu'une navigation directe demande explicitement leur pin
    //  - réserves clôturées (statut 'closed') : masquées par défaut, mais
    //    affichées si l'utilisateur sélectionne explicitement le filtre
    //    "Clôturé" ou lorsqu'un focus direct cible cette réserve
    //  - réserves supprimées : déjà absentes (suppression définitive en BD)
    let list = reserves.filter(r => r.planId === currentPlanId && (!r.archivedAt || r.id === focusedPinId));
    if (statusFilter !== 'closed') {
      list = list.filter(r => r.status !== 'closed' || r.id === focusedPinId);
    }
    if (isSousTraitant && sousTraitantCompanyName) {
      list = list.filter(r => {
        const names = getReserveCompanies(r);
        return names.includes(sousTraitantCompanyName!);
      });
    }
    return list;
  }, [reserves, currentPlanId, isSousTraitant, sousTraitantCompanyName, statusFilter, focusedPinId]);
  const pinNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    const sorted = [...allPlanReserves].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    sorted.forEach((r, i) => map.set(r.id, i + 1));
    return map;
  }, [allPlanReserves]);

  const planReserves = useMemo(() => {
    let list = allPlanReserves;
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter || r.id === focusedPinId);
    if (companyFilter !== 'all') list = list.filter(r => reserveMatchesCompany(r, companyFilter) || r.id === focusedPinId);
    if (levelFilter !== 'all') list = list.filter(r => r.level === levelFilter || r.id === focusedPinId);
    return list;
  }, [allPlanReserves, statusFilter, companyFilter, levelFilter, focusedPinId]);

  // PDF export: groupings & filtered list based on chosen mode
  const pdfGroupedByCompany = useMemo(() => {
    const groups = new Map<string, { key: string; title: string; data: Reserve[] }>();
    planReserves.forEach(r => {
      const names = getReserveCompanies(r);
      const keys = names.length > 0 ? names : ['—'];
      for (const key of keys) {
        const title = key === '—' ? 'Sans entreprise' : key;
        if (!groups.has(key)) groups.set(key, { key, title, data: [] });
        groups.get(key)!.data.push(r);
      }
    });
    return Array.from(groups.values()).sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  }, [planReserves]);

  const pdfFilteredList = useMemo<Reserve[]>(() => {
    if (pdfMode === 'all') return planReserves;
    if (pdfMode === 'company_none') return planReserves.filter(r => getReserveCompanies(r).length === 0);
    if (pdfMode === 'company_single') {
      if (!pdfCompanySingle) return [];
      return planReserves.filter(r => reserveMatchesCompany(r, pdfCompanySingle));
    }
    if (pdfMode === 'company_multi') {
      if (pdfCompaniesMulti.size === 0) return [];
      return planReserves.filter(r => {
        const keys = getReserveCompanies(r);
        if (keys.length === 0) return pdfCompaniesMulti.has('—');
        return keys.some(key => pdfCompaniesMulti.has(key));
      });
    }
    if (pdfMode === 'manual') {
      return planReserves.filter(r => pdfManualSelection.has(r.id));
    }
    return planReserves;
  }, [planReserves, pdfMode, pdfCompanySingle, pdfCompaniesMulti, pdfManualSelection]);

  const pdfPreviewCount = pdfFilteredList.length;

  // All reserves for the current chantier (used by the global report)
  const chantierReserves = useMemo(
    () => (activeChantierId
      ? reserves.filter(r => r.chantierId === activeChantierId && !r.archivedAt)
      : []),
    [reserves, activeChantierId],
  );

  const enrichReservesForPdf = useCallback(
    (items: Reserve[]): Reserve[] => enrichReserveListForPdf(items, photos),
    [photos],
  );

  // Unique companies across the whole chantier (for the global report company picker).
  // Checks both r.company (single string) and r.companies (multi-company array) so
  // reserves created via either pathway are counted.
  const globalReportCompanies = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const r of chantierReserves) {
      const names: string[] = [];
      if (r.company && r.company.trim()) names.push(r.company.trim());
      const arr = (r as any).companies;
      if (Array.isArray(arr)) {
        for (const c of arr) {
          if (c && typeof c === 'string' && c.trim() && !names.includes(c.trim())) names.push(c.trim());
        }
      }
      for (const key of names) countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }
    return Array.from(countMap.entries())
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }, [chantierReserves]);

  // How many reserves will appear in the global report with the current company + status filters.
  // Matches r.company (string) OR r.companies (array) for consistency with exportGlobalReport.
  const globalReportPreviewCount = useMemo(() => {
    let rs = chantierReserves;
    if (globalReportCompany !== null) {
      rs = rs.filter(r => {
        if ((r.company ?? '').trim() === globalReportCompany) return true;
        const arr = (r as any).companies;
        return Array.isArray(arr) && arr.some((c: any) => typeof c === 'string' && c.trim() === globalReportCompany);
      });
    }
    if (globalReportStatusFilter.size > 0) rs = rs.filter(r => globalReportStatusFilter.has(r.status));
    return rs.length;
  }, [chantierReserves, globalReportCompany, globalReportStatusFilter]);

  const openPdfModal = useCallback(() => {
    setPdfScope('plan');
    setPdfMode('all');
    setPdfCompanySingle(null);
    setPdfCompaniesMulti(new Set());
    setPdfManualSelection(new Set());
    setGlobalReportCompany(null);
    setGlobalReportStatusFilter(new Set());
    setPdfModalVisible(true);
  }, []);

  const handleConfirmPdfExport = useCallback(async (action: 'share' | 'print' = 'share') => {
    // ── Global report mode ──────────────────────────────────────────────────
    if (pdfScope === 'global') {
      if (globalReportPreviewCount === 0) {
        Alert.alert(t('plansScreen.alerts.noReserveTitle'), t('plansScreen.alerts.noReserveSelection'));
        return;
      }
      setPdfLoading(true);
      setGlobalReportProgress(null);
      try {
        const exportChantierReserves = enrichReservesForPdf(chantierReserves);
        // ── Native: pre-render each PDF plan image using the hidden PdfPlanViewer ──
        // On web, PDF.js renders plans directly inside exportGlobalReport.
        // On native, preRenderPdfPageToDataUrl() returns null (no DOM), so we must
        // pre-render each plan in a hidden WebView and capture it as a JPEG.
        const preRenderedImages = new Map<string, string>();
        if (Platform.OS !== 'web') {
          const filteredReserves = exportChantierReserves
            .filter(r => {
              if (globalReportCompany === null) return true;
              if ((r.company ?? '').trim() === globalReportCompany) return true;
              const arr = (r as any).companies;
              return Array.isArray(arr) && arr.some((c: any) => typeof c === 'string' && c.trim() === globalReportCompany);
            })
            .filter(r => !globalReportStatusFilter || globalReportStatusFilter.size === 0 || globalReportStatusFilter.has(r.status));
          const reservedPlanIds = new Set(filteredReserves.map(r => r.planId).filter(Boolean) as string[]);
          const pdfPlansWithReserves = chantierPlans.filter(
            p => isPlanPdf(p) && !!p.uri && reservedPlanIds.has(p.id)
          );
          for (let i = 0; i < pdfPlansWithReserves.length; i++) {
            const plan = pdfPlansWithReserves[i];
            setGlobalReportProgress({ current: i + 1, total: pdfPlansWithReserves.length, planName: plan.name });
            const dataUrl = await capturePreRenderPlan(plan.uri!, plan.id);
            if (dataUrl) preRenderedImages.set(plan.id, dataUrl);
          }
          setGlobalReportProgress(null);
        }

        await exportGlobalReport(
          activeChantier?.name ?? '',
          chantierPlans,
          exportChantierReserves,
          globalReportCompany,
          companies,
          action,
          (current, total, planName) => setGlobalReportProgress({ current, total, planName }),
          globalReportStatusFilter,
          preRenderedImages,
          t,
          pdfLocale,
        );
        setPdfModalVisible(false);
      } catch {
        Alert.alert(t('common.error'), t('plansScreen.alerts.globalPdfFailed'));
      } finally {
        setPdfLoading(false);
        setGlobalReportProgress(null);
      }
      return;
    }
    // ── Per-plan mode (existing behaviour) ──────────────────────────────────
    if (pdfFilteredList.length === 0) {
      Alert.alert(t('plansScreen.alerts.noReserveTitle'), t('plansScreen.alerts.noReserveSelection'));
      return;
    }
    setPdfLoading(true);
    try {
      const exportFilteredList = enrichReservesForPdf(pdfFilteredList);
      await exportPlanPDF(
        currentPlan?.name ?? 'Plan',
        activeChantier?.name ?? '',
        currentPlan?.building ?? null,
        currentPlan?.level ?? null,
        exportFilteredList,
        pinNumberMap,
        currentPlan?.uri ?? null,
        currentPlan?.fileType ?? null,
        pinSizeScale,
        companies,
        pdfViewerRef,
        action,
        t,
        pdfLocale,
      );
      setPdfModalVisible(false);
    } catch {
      Alert.alert(t('common.error'), t('plansScreen.alerts.pdfFailed'));
    } finally {
      setPdfLoading(false);
    }
  }, [pdfScope, globalReportPreviewCount, activeChantier, chantierPlans, chantierReserves, globalReportCompany, globalReportStatusFilter, companies, pdfFilteredList, currentPlan, pinNumberMap, pinSizeScale, capturePreRenderPlan, enrichReservesForPdf, t]);

  const handleEmailReport = useCallback(async () => {
    const emails = globalReportEmailTo
      .split(/[,;\s]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => e.includes('@') && e.includes('.'));

    if (emails.length === 0) {
      Alert.alert(t('plansScreen.alerts.emailRequiredTitle'), t('plansScreen.alerts.emailRequired'));
      return;
    }
    if (globalReportPreviewCount === 0) {
      Alert.alert(t('plansScreen.alerts.noReserveTitle'), t('plansScreen.alerts.noReserveSelection'));
      return;
    }

    setGlobalReportEmailLoading(true);
    try {
      const exportChantierReserves = enrichReservesForPdf(chantierReserves);
      const filteredReserves = exportChantierReserves.filter(r => {
        if (globalReportCompany !== null) {
          const mainMatch = (r.company ?? '').trim() === globalReportCompany;
          const arrMatch = Array.isArray((r as any).companies) &&
            (r as any).companies.some((c: any) => typeof c === 'string' && c.trim() === globalReportCompany);
          if (!mainMatch && !arrMatch) return false;
        }
        if (globalReportStatusFilter.size > 0 && !globalReportStatusFilter.has(r.status)) return false;
        return true;
      });

      const localOnlyPhotoCount = countLocalOnlyReservePhotos(filteredReserves);
      const localOnlyPlanCount = chantierPlans.filter(p => p.uri && !isRemotePdfAssetUri(p.uri)).length;
      if (localOnlyPhotoCount > 0 || localOnlyPlanCount > 0) {
        const shouldContinue = await new Promise<boolean>((resolve) => {
          Alert.alert(
            t('plansScreen.alerts.unsyncedItemsTitle'),
            [
              localOnlyPhotoCount > 0 ? t(localOnlyPhotoCount === 1 ? 'plansScreen.alerts.localPhoto_one' : 'plansScreen.alerts.localPhoto_other', { count: localOnlyPhotoCount }) : null,
              localOnlyPlanCount > 0 ? t(localOnlyPlanCount === 1 ? 'plansScreen.alerts.localPlan_one' : 'plansScreen.alerts.localPlan_other', { count: localOnlyPlanCount }) : null,
            ].filter(Boolean).join(` ${t('common.and')} `) + t('plansScreen.alerts.unsyncedEmailSuffix'),
            [
              { text: t('plansScreen.alerts.waitSync'), style: 'cancel', onPress: () => resolve(false) },
              { text: t('plansScreen.alerts.sendAnyway'), onPress: () => resolve(true) },
            ],
          );
        });
        if (!shouldContinue) return;
      }

      const reservesPayload = filteredReserves.map((r, i) => {
        const remotePhotos = getRemoteReservePhotosForPdf(r, 2);
        return {
          id: r.id,
          num: i + 1,
          title: r.title,
          company: r.company ?? '',
          building: r.building ?? undefined,
          level: r.level ?? undefined,
          status: r.status,
          priority: r.priority,
          deadline: r.deadline ?? undefined,
          description: getReserveDescriptionText(r.description, r.title, ''),
          planId: r.planId ?? undefined,
          planX: r.planX ?? undefined,
          planY: r.planY ?? undefined,
          photos: remotePhotos.photos.map(p => ({ uri: p.uri })),
        };
      });

      const plansPayload = chantierPlans.map(p => ({
        id: p.id,
        name: p.name,
        building: p.building ?? undefined,
        level: p.level ?? undefined,
        uri: isRemotePdfAssetUri(p.uri) ? p.uri : undefined,
        fileType: (p as any).fileType ?? undefined,
      }));

      const result = await generateAndSendPdfReport({
        chantierName: activeChantier?.name ?? '',
        companyFilter: globalReportCompany,
        generatedAt: new Date().toISOString(),
        language: i18n.resolvedLanguage ?? i18n.language,
        plans: plansPayload,
        reserves: reservesPayload,
        recipients: emails,
        sendByEmail: true,
      });

      if (!result.success) {
        Alert.alert(t('plansScreen.alerts.sendErrorTitle'), result.error ?? t('plansScreen.alerts.sendReportFailed'));
        return;
      }

      const count = filteredReserves.length;
      const filename = buildPdfFilename('Rapport_Plans', [activeChantier?.name ?? 'rapport']);

      if (result.pdfBase64) {
        try {
          const fileUri = (FileSystem.cacheDirectory ?? '') + filename;
          await FileSystem.writeAsStringAsync(fileUri, result.pdfBase64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const canShare = await Sharing.isAvailableAsync();
          if (canShare) {
            setGlobalReportEmailTo('');
            setPdfModalVisible(false);
            await Sharing.shareAsync(fileUri, {
              mimeType: 'application/pdf',
              dialogTitle: t('plansScreen.pdf.shareDialogTitle', { chantier: activeChantier?.name ?? '' }),
              UTI: 'com.adobe.pdf',
            });
            return;
          }
        } catch (saveErr) {
          console.warn('[Email Report] Erreur sauvegarde locale:', saveErr);
        }
      }

      Alert.alert(
        t('plansScreen.alerts.reportSentTitle'),
        t('plansScreen.alerts.reportSentMessage', { count, reserveText: commonReserveText(count), emails: emails.join('\n') })
      );
      setGlobalReportEmailTo('');
      setPdfModalVisible(false);
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.message ?? t('plansScreen.alerts.sendReportFailed'));
    } finally {
      setGlobalReportEmailLoading(false);
    }
  }, [globalReportEmailTo, globalReportPreviewCount, chantierReserves, chantierPlans, globalReportCompany, globalReportStatusFilter, activeChantier, enrichReservesForPdf, t, commonReserveText]);

  const pinSize = Math.max(10, Math.round((isTablet ? 18 : 14) * pinSizeScale));
  const clusterSize = Math.max(18, Math.round((isTablet ? 28 : 22) * pinSizeScale));
  const dynW = planDimensions.width;
  const dynH = planDimensions.height;

  const pinClusters = useMemo(
    () => computeClusters(planReserves, displayScale, pinNumberMap, focusedPinId),
    [planReserves, displayScale, pinNumberMap, focusedPinId]
  );
  const ghostReserves = useMemo(() => {
    const activeIds = new Set(planReserves.map(r => r.id));
    return allPlanReserves.filter(r => !activeIds.has(r.id));
  }, [allPlanReserves, planReserves]);
  const ghostClusters = useMemo(
    () => computeClusters(ghostReserves, displayScale, pinNumberMap),
    [ghostReserves, displayScale, pinNumberMap]
  );
  const hasPlanPins = useMemo(
    () => allPlanReserves.some(r => r.planX != null && r.planY != null),
    [allPlanReserves]
  );
  const miniMapPins = useMemo(
    () => allPlanReserves
      .filter(r => r.planX != null && r.planY != null)
      .map(r => ({
        id: r.id,
        x: r.planX!,
        y: r.planY!,
        color: getReservePinColor(r, companies),
      })),
    [allPlanReserves, companies]
  );

  const activeFilters = [statusFilter, companyFilter, levelFilter].filter(f => f !== 'all').length
    + (chantierHierarchyBuildings.length === 0 && selectedBuilding !== 'all' ? 1 : 0)
    + (chantierHierarchyBuildings.length === 0 && selectedLevel !== 'all' ? 1 : 0);

  const planLevels = useMemo(() => {
    const lvls = reserves.filter(r => r.planId === currentPlanId).map(r => r.level);
    return Array.from(new Set(lvls)).filter(Boolean).sort(compareLevels) as string[];
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
  const pendingPlanFocusRef = useRef<{ planId: string; reserveId: string } | null>(null);
  const readyPlanIdRef = useRef<string | null>(null);
  const setDraggingPinIdRef = useRef(setDraggingPinId);
  const setFocusedPinIdRef = useRef(setFocusedPinId);
  const setPinSizesRef = useRef(setPinSizes);
  const pinSizesRef = useRef(pinSizes);
  // Always-current mirror of focusedPinId state — used inside callbacks to avoid stale closures
  const focusedPinIdRef = useRef<string | null>(null);

  React.useEffect(() => { reservesRef.current = reserves; }, [reserves]);
  React.useEffect(() => { updateReserveFieldsRef.current = updateReserveFields; }, [updateReserveFields]);
  React.useEffect(() => { pinSizesRef.current = pinSizes; }, [pinSizes]);
  React.useEffect(() => { focusedPinIdRef.current = focusedPinId; }, [focusedPinId]);
  React.useEffect(() => {
    readyPlanIdRef.current = null;
  }, [currentPlanId, currentPlan?.uri]);

  // Clear the focused-pin auto-dismiss timer on unmount to avoid state updates on unmounted component
  React.useEffect(() => {
    return () => {
      if (focusedPinTimerRef.current) clearTimeout(focusedPinTimerRef.current);
    };
  }, []);

  const startFocusedPinTimer = useCallback((reserveId: string, durationMs = 5000) => {
    setFocusedPinIdRef.current(reserveId);
    if (focusedPinTimerRef.current) clearTimeout(focusedPinTimerRef.current);
    focusedPinTimerRef.current = setTimeout(() => {
      setFocusedPinIdRef.current(null);
    }, durationMs);
  }, []);

  const holdFocusedPinUntilPlanReady = useCallback((planId: string, reserveId: string) => {
    pendingPlanFocusRef.current = { planId, reserveId };
    setFocusedPinIdRef.current(reserveId);
    if (focusedPinTimerRef.current) {
      clearTimeout(focusedPinTimerRef.current);
      focusedPinTimerRef.current = null;
    }
  }, []);

  const releaseFocusedPinWhenPlanReady = useCallback((planId: string | null) => {
    const pending = pendingPlanFocusRef.current;
    if (!pending || !planId || pending.planId !== planId) return;
    pendingPlanFocusRef.current = null;
    startFocusedPinTimer(pending.reserveId, 6000);
  }, [startFocusedPinTimer]);

  function focusReserveOnPlanFromModal(reserve: Reserve) {
    if (!reserve.planId || reserve.planX == null || reserve.planY == null) {
      Alert.alert(
        t('plansScreen.alerts.missingPinTitle'),
        t('plansScreen.alerts.missingPin')
      );
      return;
    }

    const targetPlan = chantierPlans.find(p => p.id === reserve.planId);
    const targetNeedsViewerReady = !!targetPlan?.uri && targetPlan.fileType !== 'dxf';
    setSelected(null);
    setActivePlanId(reserve.planId);
    setCompanyFilter('all');
    setLevelFilter('all');
    setStatusFilter(reserve.status === 'closed' ? 'closed' : 'all');
    setHighlightedReserveId(reserve.id);

    if (targetPlan?.buildingId) {
      setSelectedBuilding(targetPlan.buildingId);
    } else if (targetPlan?.building) {
      const bldg = chantierHierarchyBuildingsEarly.find(b => b.name === targetPlan.building);
      setSelectedBuilding(bldg?.id ?? 'all');
    } else {
      setSelectedBuilding('all');
    }

    if (targetPlan?.levelId) {
      setSelectedLevel(targetPlan.levelId);
    } else if (targetPlan?.level) {
      let resolvedLevelId: string | null = null;
      for (const b of chantierHierarchyBuildingsEarly) {
        const lvl = b.levels?.find(l => l.name === targetPlan.level);
        if (lvl) {
          resolvedLevelId = lvl.id;
          break;
        }
      }
      setSelectedLevel(resolvedLevelId ?? 'all');
    } else {
      setSelectedLevel('all');
    }

    if (focusedPinTimerRef.current) clearTimeout(focusedPinTimerRef.current);
    holdFocusedPinUntilPlanReady(reserve.planId, reserve.id);
    if (!targetNeedsViewerReady || readyPlanIdRef.current === reserve.planId) {
      const delay = reserve.planId === currentPlanId ? 80 : 450;
      setTimeout(() => releaseFocusedPinWhenPlanReady(reserve.planId!), delay);
    }
  }

  // Handle deep-link navigation from the Reserves tab:
  // When the user taps the "Plan" chip on a reserve card, we receive
  // focusPlanId (which plan to open) and focusReserveId (which pin to highlight).
  // We track the last handled pair to avoid re-firing on unrelated re-renders.
  const handledFocusParamsRef = useRef<string>('');
  React.useEffect(() => {
    if (!focusPlanIdParam) return;
    const key = `${focusPlanIdParam}|${focusReserveIdParam ?? ''}`;
    if (handledFocusParamsRef.current === key) return;
    if (focusReserveIdParam && reserves.length === 0) return;

    // Wait until plans are loaded before trying to resolve building/level
    const targetPlan = chantierPlans.find(p => p.id === focusPlanIdParam);
    if (chantierPlans.length === 0) return; // not yet loaded, wait for next render

    // If the target plan has building info, also wait for hierarchy to load so we
    // can resolve buildingId → building chip.  Marking the key as handled too early
    // (before hierarchy is ready) caused the restoration effect to override
    // selectedBuilding with the last-viewed building (e.g. GuestBlock 1).
    const planNeedsBuilding = targetPlan && (targetPlan.buildingId || targetPlan.building);
    if (planNeedsBuilding && chantierHierarchyBuildingsEarly.length === 0) return;

    handledFocusParamsRef.current = key;

    // Switch to the target plan
    setActivePlanId(focusPlanIdParam);
    setCompanyFilter('all');
    setLevelFilter('all');

    const targetReserve = focusReserveIdParam
      ? reserves.find(r => r.id === focusReserveIdParam)
      : null;
    setStatusFilter(targetReserve?.status === 'closed' ? 'closed' : 'all');

    // Resolve and set the building filter
    if (targetPlan?.buildingId) {
      setSelectedBuilding(targetPlan.buildingId);
    } else if (targetPlan?.building) {
      const bldg = chantierHierarchyBuildingsEarly.find(b => b.name === targetPlan.building);
      if (bldg) setSelectedBuilding(bldg.id);
      else setSelectedBuilding('all'); // name mismatch fallback — show all plans
    } else {
      setSelectedBuilding('all'); // plan has no building info — show all plans
    }

    // Resolve and set the level filter
    if (targetPlan?.levelId) {
      setSelectedLevel(targetPlan.levelId);
    } else if (targetPlan?.level) {
      for (const b of chantierHierarchyBuildingsEarly) {
        const lvl = b.levels?.find(l => l.name === targetPlan?.level);
        if (lvl) { setSelectedLevel(lvl.id); break; }
      }
    }

    // Highlight the target pin after a short delay to let the plan render
    if (focusReserveIdParam) {
      const pinId = focusReserveIdParam;
      setHighlightedReserveId(pinId);
      holdFocusedPinUntilPlanReady(focusPlanIdParam, pinId);
      const targetNeedsViewerReady = !!targetPlan?.uri && targetPlan.fileType !== 'dxf';
      if (!targetNeedsViewerReady || readyPlanIdRef.current === focusPlanIdParam) {
        setTimeout(() => releaseFocusedPinWhenPlanReady(focusPlanIdParam), 400);
      }
    }
  }, [focusPlanIdParam, focusReserveIdParam, chantierPlans, chantierHierarchyBuildingsEarly, reserves, holdFocusedPinUntilPlanReady, releaseFocusedPinWhenPlanReady]);

  // Auto-load DXF when plan has fileType=dxf and is not yet parsed in memory
  React.useEffect(() => {
    if (!currentPlanId || !currentPlan?.uri || currentPlan.fileType !== 'dxf') return;
    if (dxfData[currentPlanId]) return;
    const controller = new AbortController();
    setDxfLoading(true);
    fetch(currentPlan.uri, { signal: controller.signal })
      .then(r => r.text())
      .then(text => {
        const parsed = parseDxf(text);
        if (parsed.entities.length > 0) {
          setDxfData(prev => ({ ...prev, [currentPlanId]: parsed }));
        }
      })
      .catch(err => { if (err?.name !== 'AbortError') console.warn('[DXF] fetch error:', err); })
      .finally(() => setDxfLoading(false));
    return () => { controller.abort(); };
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
          if (draggingPinMovedRef.current && draggingPinStartRef.current) {
            isDraggingRef.current = true;
            const s = lastScale.current;
            const newX = Math.min(100, Math.max(0, draggingPinStartRef.current.cx + (gs.dx / dynWRef.current / s) * 100));
            const newY = Math.min(100, Math.max(0, draggingPinStartRef.current.cy + (gs.dy / dynHRef.current / s) * 100));
            draggingPinPosRef.current = { x: newX, y: newY };
            draggingAnimX.setValue((newX / 100) * dynWRef.current);
            draggingAnimY.setValue((newY / 100) * dynHRef.current);
            if (!draggingFirstMoveRef.current) {
              draggingFirstMoveRef.current = true;
              setDraggingPinIdRef.current(draggingPinIdRef.current);
            }
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
          draggingFirstMoveRef.current = false;
          setDraggingPinIdRef.current(null);
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
          draggingFirstMoveRef.current = false;
          setDraggingPinIdRef.current(null);
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
      params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '', planX: String(px), planY: String(py), building: currentPlan?.building ?? '', level: currentPlan?.level ?? '', buildingId: currentPlan?.buildingId ?? '', levelId: currentPlan?.levelId ?? '' },
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
      params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '', planX: String(px), planY: String(py), building: currentPlan?.building ?? '', level: currentPlan?.level ?? '', buildingId: currentPlan?.buildingId ?? '', levelId: currentPlan?.levelId ?? '' },
    } as any);
  }

  function handleSelectPlan(planId: string) {
    pendingPlanFocusRef.current = null;
    readyPlanIdRef.current = null;
    if (focusedPinTimerRef.current) {
      clearTimeout(focusedPinTimerRef.current);
      focusedPinTimerRef.current = null;
    }
    setFocusedPinId(null);
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
          Alert.alert(t('plansScreen.alerts.unsupportedFormatTitle'), t('plansScreen.alerts.unsupportedImportFormat'));
          return;
        }
        if (isDxf) {
          const dxfResp = await fetch(asset.uri);
          const dxfText = await dxfResp.text();
          const parsed = parseDxf(dxfText);
          if (parsed.entities.length === 0) {
            Alert.alert(t('plansScreen.alerts.emptyDxfTitle'), t('plansScreen.alerts.emptyDxf'));
            return;
          }
          const { url: dxfStorageUrl, error: dxfUploadError } = await uploadDocumentDetailed(asset.uri, `plan_dxf_${currentPlanId}_${docName}`, 'application/octet-stream');
          const dxfUri = dxfStorageUrl ?? asset.uri;
          setDxfData(prev => ({ ...prev, [currentPlanId]: parsed }));
          updateSitePlan({ ...currentPlan, uri: dxfUri, fileType: 'dxf', dxfName: docName, size: formatSize(asset.size) });
          if (dxfStorageUrl) {
            Alert.alert(t('plansScreen.alerts.dxfImportedTitle'), t('plansScreen.alerts.dxfImported', { count: parsed.entities.length, name: docName }));
          } else {
            Alert.alert(
              t('plansScreen.alerts.dxfImportedLocalTitle'),
              t('plansScreen.alerts.dxfImportedLocal', { count: parsed.entities.length, name: docName, error: dxfUploadError ?? t('common.unknown') }),
              [{ text: t('common.ok') }]
            );
          }
          return;
        }
        const { url: storageUrl, error: uploadError } = await uploadDocumentDetailed(asset.uri, `plan_${currentPlanId}_${docName}`, asset.mimeType ?? undefined);
        const finalUri = storageUrl ?? asset.uri;
        setDxfData(prev => {
          const next = { ...prev };
          delete next[currentPlanId];
          return next;
        });
        updateSitePlan({ ...currentPlan, uri: finalUri, fileType: isPdfFile ? 'pdf' : 'image', size: formatSize(asset.size) });
        if (storageUrl) {
          Alert.alert(t('plansScreen.alerts.planImportedTitle'), t('plansScreen.alerts.planImported'));
        } else {
          Alert.alert(
            t('plansScreen.alerts.planImportedLocalTitle'),
            t('plansScreen.alerts.planImportedLocal', { error: uploadError ?? t('common.unknown') }),
            [{ text: t('common.ok') }]
          );
        }
      }
    } catch {
      Alert.alert(t('common.error'), t('plansScreen.alerts.importPlanFailed'));
    } finally {
      setImporting(false);
    }
  }

  function handleRemovePlan() {
    if (!currentPlan?.uri) return;
    Alert.alert(t('plansScreen.alerts.replacePlanTitle'), t('plansScreen.alerts.replacePlanMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('plansScreen.actions.replace'), style: 'destructive', onPress: handleImportPlan },
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
          Alert.alert(t('plansScreen.alerts.unsupportedFormatTitle'), t('plansScreen.alerts.unsupportedRevisionFormat'));
          return;
        }
        const revDocExt = asset.name.split('.').pop()?.toLowerCase() ?? '';
        const { url: storageUrl, error: revUploadError } = await uploadDocumentDetailed(
          asset.uri,
          `plan_rev_${genId()}_${asset.name}`,
          revDocExt === 'dxf' ? 'application/octet-stream' : asset.mimeType ?? undefined,
        );
        if (!storageUrl) {
          Alert.alert(
            t('plansScreen.alerts.localStorageTitle'),
            t('plansScreen.alerts.revisionLocalOnly', { error: revUploadError ?? t('common.unknown') }),
            [{ text: t('common.continue') }]
          );
        }
        const finalUri = storageUrl ?? asset.uri;
        const newPlan: SitePlan = {
          id: genId(), chantierId: currentPlan.chantierId,
          name: `${currentPlan.name} — ${revisionModal.code.trim()}`,
          building: currentPlan.building, level: currentPlan.level,
          buildingId: currentPlan.buildingId, levelId: currentPlan.levelId,
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
          Alert.alert(t('plansScreen.alerts.revisionCreatedTitle'), t('plansScreen.alerts.revisionCreatedWithMarkers', { code: revisionModal.code.trim(), count: openMarkersCount }), [
            { text: t('plansScreen.actions.ignore'), style: 'cancel' },
            { text: t('plansScreen.actions.migrateCount', { count: openMarkersCount }), onPress: () => {
              const count = migrateReservesToPlan(currentPlan.id, newPlan.id);
              Alert.alert(t('plansScreen.alerts.migrationDoneTitle'), t('plansScreen.alerts.migrationDone', { count }));
            }},
          ]);
        } else {
          Alert.alert(t('plansScreen.alerts.revisionCreatedTitle'), t('plansScreen.alerts.revisionCreated', { code: revisionModal.code.trim() }));
        }
      }
    } catch { Alert.alert(t('common.error'), t('plansScreen.alerts.createRevisionFailed')); }
    finally { setImporting(false); }
  }

  function handleAddPlan() {
    if (!activeChantierId) return;
    const bldg = chantierHierarchyBuildings.find(b => b.id === selectedBuilding);
    const lvl = bldg?.levels.find(l => l.id === selectedLevel);
    setNewPlanModal({
      visible: true, name: '',
      building: bldg?.name ?? '',
      buildingId: bldg?.id,
      level: lvl?.name ?? '',
      levelId: lvl?.id,
    });
  }

  function handleDeletePlanFile() {
    if (!currentPlan?.uri) return;
    Alert.alert(
      t('plansScreen.alerts.removeFileTitle'),
      t('plansScreen.alerts.removeFileMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('plansScreen.actions.remove'),
          style: 'destructive',
          onPress: () => {
            setDxfData(prev => {
              const next = { ...prev };
              delete next[currentPlan!.id];
              return next;
            });
            updateSitePlan({
              ...currentPlan!,
              uri: undefined,
              fileType: undefined,
              dxfName: undefined,
              size: undefined,
            });
          },
        },
      ]
    );
  }

  function handleDeletePlan() {
    if (!currentPlanId || !currentPlan) return;
    const linkedReserves = reserves.filter(r => r.planId === currentPlanId);
    const msg = linkedReserves.length > 0
      ? t('plansScreen.alerts.deletePlanWithReserves', { name: currentPlan.name, count: linkedReserves.length })
      : t('plansScreen.alerts.deletePlanMessage', { name: currentPlan.name });
    Alert.alert(t('plansScreen.alerts.deletePlanTitle'), msg, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          linkedReserves.forEach(r => {
            updateReserveFields({ ...r, planId: undefined, planX: undefined, planY: undefined });
          });
          deleteSitePlan(currentPlanId);
          setDxfData(prev => {
            const next = { ...prev };
            delete next[currentPlanId];
            return next;
          });
          setActivePlanId(null);
          setSelected(null);
        },
      },
    ]);
  }

  async function importFileForNewPlan() {
    setNewPlanModal(p => ({ ...p, uploading: true }));
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true, multiple: false,
        type: ['image/*', 'application/pdf', '*/*'],
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const docName = asset.name ?? `plan_${genId()}`;
        const ext = docName.split('.').pop()?.toLowerCase() ?? '';
        const isDxf = ext === 'dxf';
        const isPdfFile = ext === 'pdf' || asset.mimeType === 'application/pdf';
        const fileType: 'pdf' | 'image' | 'dxf' = isDxf ? 'dxf' : isPdfFile ? 'pdf' : 'image';
        const mimeType = isDxf ? 'application/octet-stream' : (asset.mimeType ?? undefined);
        const { url: storageUrl } = await uploadDocumentDetailed(asset.uri, `plan_new_${genId()}_${docName}`, mimeType);
        const finalUri = storageUrl ?? asset.uri;
        const autoName = docName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
        setNewPlanModal(p => ({
          ...p, uploading: false,
          uri: finalUri, size: formatSize(asset.size), fileType,
          name: p.name.trim() ? p.name : autoName,
        }));
      } else {
        setNewPlanModal(p => ({ ...p, uploading: false }));
      }
    } catch {
      setNewPlanModal(p => ({ ...p, uploading: false }));
      Alert.alert(t('common.error'), t('plansScreen.alerts.importFileFailed'));
    }
  }

  function handleConfirmNewPlan() {
    if (!activeChantierId || !newPlanModal.name.trim() || !newPlanModal.uri) return;
    const newPlan: SitePlan = {
      id: genId(), chantierId: activeChantierId,
      name: newPlanModal.name.trim(),
      building: newPlanModal.building.trim() || undefined,
      level: newPlanModal.level.trim() || undefined,
      buildingId: newPlanModal.buildingId || undefined,
      levelId: newPlanModal.levelId || undefined,
      uploadedAt: formatDateFR(new Date()),
      uri: newPlanModal.uri,
      size: newPlanModal.size,
      fileType: newPlanModal.fileType,
    };
    addSitePlan(newPlan);
    setActivePlanId(newPlan.id);
    if (newPlanModal.buildingId) {
      setSelectedBuilding(newPlanModal.buildingId);
      if (newPlanModal.levelId) setSelectedLevel(newPlanModal.levelId);
    }
    setNewPlanModal({ visible: false, name: '', building: '', level: '' });
  }

  const isPlanFile = !!(currentPlan?.uri) && currentPlan?.fileType !== 'dxf';
  const isPlanPdfPlan = isPlanPdf(currentPlan);
  const isImagePlan = currentPlan?.fileType === 'image' || (!!currentPlan?.uri && !isPlanPdfPlan && currentPlan?.fileType !== 'dxf' && isImage(currentPlan.uri!));
  const hasDxf = !!(currentPlanId && dxfData[currentPlanId]);
  const currentZoomPct = isPlanFile ? `${pdfZoomPct}%` : `${Math.round(displayScale * 100)}%`;

  useEffect(() => {
    if (isPlanFile || !focusedPinId) return;
    const target = planReserves.find(r => r.id === focusedPinId && r.planX != null && r.planY != null);
    if (!target) return;
    const nextScale = Math.min(4, Math.max(lastScale.current, 2));
    const targetTX = dynW * (0.5 - target.planX! / 100) * nextScale;
    const targetTY = dynH * (0.5 - target.planY! / 100) * nextScale;
    lastScale.current = nextScale;
    committedTX.current = targetTX;
    committedTY.current = targetTY;
    setDisplayScale(nextScale);
    Animated.parallel([
      Animated.spring(scale, { toValue: nextScale, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: targetTX, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: targetTY, useNativeDriver: true }),
    ]).start();
  }, [dynH, dynW, focusedPinId, isPlanFile, planReserves, scale, translateX, translateY]);

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

  if (isLoading && (!activeChantierId || chantierPlans.length === 0)) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (!activeChantierId || chantierPlans.length === 0) {
    const noChantier = !activeChantierId;
    const hasStructure = chantierHierarchyBuildings.length > 0;

    const newPlanModalJSX = (
      <Modal visible={newPlanModal.visible} transparent animationType="fade" onRequestClose={() => setNewPlanModal({ visible: false, name: '', building: '', level: '' })}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setNewPlanModal({ visible: false, name: '', building: '', level: '' })}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalCard, { marginBottom: kbHeight }]} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalPin, { backgroundColor: C.primary }]}><Ionicons name="map-outline" size={14} color="#fff" /></View>
              <View style={{ flex: 1 }}><Text style={styles.modalTitle}>{t('plansScreen.newPlan.title')}</Text><Text style={styles.modalMeta}>{t('plansScreen.newPlan.subtitle')}</Text></View>
              <TouchableOpacity onPress={() => setNewPlanModal({ visible: false, name: '', building: '', level: '' })}><Ionicons name="close" size={20} color={C.textMuted} /></TouchableOpacity>
            </View>

            {/* Import en premier — B1 */}
            {newPlanModal.uri ? (
              <View style={styles.newPlanFileChip}>
                <View style={styles.newPlanFileChipIcon}>
                  <Ionicons
                    name={newPlanModal.fileType === 'pdf' ? 'document-text-outline' : newPlanModal.fileType === 'dxf' ? 'cube-outline' : 'image-outline'}
                    size={18} color={C.closed}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.newPlanFileChipName}>
                    {newPlanModal.fileType === 'pdf' ? 'PDF' : newPlanModal.fileType === 'dxf' ? 'DXF' : t('plansScreen.fileTypes.image')} {t('plansScreen.newPlan.imported')}{newPlanModal.size ? ` · ${newPlanModal.size}` : ''}
                  </Text>
                  <Text style={styles.newPlanFileChipSub}>{t('plansScreen.newPlan.tapToChange')}</Text>
                </View>
                <TouchableOpacity onPress={importFileForNewPlan}>
                  <Ionicons name="swap-horizontal-outline" size={18} color={C.textMuted} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.newPlanImportBtn} onPress={importFileForNewPlan} disabled={!!newPlanModal.uploading}>
                {newPlanModal.uploading ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={22} color={C.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.newPlanImportBtnText}>{t('plansScreen.newPlan.importTypes')}</Text>
                      <Text style={styles.newPlanImportBtnSub}>{t('plansScreen.newPlan.importRequiredHint')}</Text>
                    </View>
                    <View style={styles.newPlanImportRequired}><Text style={styles.newPlanImportRequiredText}>{t('plansScreen.newPlan.required')}</Text></View>
                  </>
                )}
              </TouchableOpacity>
            )}

            <View style={styles.newPlanField}>
              <Text style={styles.newPlanLabel}>{t('plansScreen.newPlan.nameLabel')}</Text>
              <TextInput style={styles.newPlanInput} placeholder={t('plansScreen.newPlan.namePlaceholder')} placeholderTextColor={C.textMuted} value={newPlanModal.name} onChangeText={v => setNewPlanModal(p => ({ ...p, name: v }))} />
            </View>

            {chantierHierarchyBuildings.length > 0 ? (
              <>
                <View style={styles.newPlanField}>
                  <Text style={styles.newPlanLabel}>{t('plansUi.building')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                      {chantierHierarchyBuildings.map(b => (
                        <TouchableOpacity
                          key={b.id}
                          style={[styles.newPlanChip, newPlanModal.building === b.name && styles.newPlanChipActive]}
                          onPress={() => setNewPlanModal(p => ({ ...p, building: b.name, buildingId: b.id, level: '', levelId: undefined }))}
                        >
                          <Text style={[styles.newPlanChipText, newPlanModal.building === b.name && styles.newPlanChipTextActive]}>{b.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
                {levelsForNewPlanBuilding.length > 0 && (
                  <View style={styles.newPlanField}>
                    <Text style={styles.newPlanLabel}>{t('plansUi.planLevel')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                        {levelsForNewPlanBuilding.map(l => (
                          <TouchableOpacity
                            key={l.id}
                            style={[styles.newPlanChip, newPlanModal.level === l.name && styles.newPlanChipActive]}
                            onPress={() => setNewPlanModal(p => ({ ...p, level: l.name, levelId: l.id }))}
                          >
                            <Text style={[styles.newPlanChipText, newPlanModal.level === l.name && styles.newPlanChipTextActive]}>{l.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.newPlanRow}>
                <View style={[styles.newPlanField, { flex: 1 }]}>
                  <Text style={styles.newPlanLabel}>{t('plansUi.building')}</Text>
                  <TextInput style={styles.newPlanInput} placeholder={t('plansScreen.newPlan.buildingPlaceholder')} placeholderTextColor={C.textMuted} value={newPlanModal.building} onChangeText={v => setNewPlanModal(p => ({ ...p, building: v }))} />
                </View>
                <View style={[styles.newPlanField, { flex: 1 }]}>
                  <Text style={styles.newPlanLabel}>{t('plansUi.planLevel')}</Text>
                  <TextInput style={styles.newPlanInput} placeholder={t('plansScreen.newPlan.levelPlaceholder')} placeholderTextColor={C.textMuted} value={newPlanModal.level} onChangeText={v => setNewPlanModal(p => ({ ...p, level: v }))} />
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.modalOpenBtn, (!newPlanModal.name.trim() || !newPlanModal.uri) && { opacity: 0.5 }]}
              onPress={handleConfirmNewPlan}
              disabled={!newPlanModal.name.trim() || !newPlanModal.uri || !!newPlanModal.uploading}
            >
              <Ionicons name="add-circle-outline" size={16} color={C.primary} />
              <Text style={styles.modalOpenText}>{t('plansScreen.actions.createPlan')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );

    // ── Cas 1 : Aucun chantier actif → écran marketing ──────────────────────
    if (noChantier) {
      return (
        <View style={styles.container}>
          <View style={[styles.header, { paddingTop: topPad + 12, paddingLeft: 24, paddingRight: 16, paddingBottom: 6 }]}>
            <Text style={styles.title}>{t('tabs.plans')}</Text>
          </View>
          <ScrollView contentContainerStyle={styles.emptyState} showsVerticalScrollIndicator={false}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="business-outline" size={44} color={C.primary} />
            </View>
            <Text style={styles.emptyTitle}>{t('plansScreen.empty.noChantierTitle')}</Text>
            <Text style={styles.emptySubtitle}>{t('plansScreen.empty.noChantierSubtitle')}</Text>
            <View style={styles.emptyFeatures}>
              <View style={styles.emptyFeatureRow}>
                <View style={[styles.emptyFeatureDot, { backgroundColor: '#003082' }]}><Ionicons name="map-outline" size={14} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.emptyFeatureTitle}>{t('plansScreen.empty.visualizeTitle')}</Text>
                  <Text style={styles.emptyFeatureDesc}>{t('plansScreen.empty.visualizeDesc')}</Text>
                </View>
              </View>
              <View style={styles.emptyFeatureRow}>
                <View style={[styles.emptyFeatureDot, { backgroundColor: '#059669' }]}><Ionicons name="layers-outline" size={14} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.emptyFeatureTitle}>{t('plansScreen.empty.hierarchyTitle')}</Text>
                  <Text style={styles.emptyFeatureDesc}>{t('plansScreen.empty.hierarchyDesc')}</Text>
                </View>
              </View>
              <View style={styles.emptyFeatureRow}>
                <View style={[styles.emptyFeatureDot, { backgroundColor: '#7C3AED' }]}><Ionicons name="print-outline" size={14} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.emptyFeatureTitle}>{t('plansScreen.empty.exportTitle')}</Text>
                  <Text style={styles.emptyFeatureDesc}>{t('plansScreen.empty.exportDesc')}</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/chantier/new' as any)}>
              <Ionicons name="add-circle-outline" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>{t('plansScreen.actions.createChantier')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }

    // ── Cas 2 : Chantier actif + structure définie + 0 plans → arborescence ─
    if (hasStructure) {
      return (
        <View style={styles.container}>
          <View style={[styles.header, { paddingTop: topPad + 8 }]}>
            <View style={styles.headerTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{t('tabs.plans')}</Text>
                {activeChantier && (
                  <TouchableOpacity style={styles.chantierLabelRow} onPress={openChantierSwitcher} activeOpacity={0.7}>
                    <Text style={styles.chantierLabel} numberOfLines={1}>{activeChantier.name}</Text>
                    <Ionicons name="chevron-down" size={11} color={C.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              {permissions.canCreate && (
                <TouchableOpacity style={styles.structureHeaderAddBtn} onPress={handleAddPlan}>
                  <Ionicons name="add" size={15} color={C.primary} />
                  <Text style={styles.structureHeaderAddText}>{t('plansScreen.actions.addPlan')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.structureHint}>
              {t('plansScreen.empty.structureHint')}
            </Text>
            {chantierHierarchyBuildings.map(b => (
              <View key={b.id} style={styles.structureBuilding}>
                <View style={styles.structureBuildingHeader}>
                  <Ionicons name="business-outline" size={15} color={C.text} />
                  <Text style={styles.structureBuildingName}>{b.name}</Text>
                </View>
                {b.levels.map(l => (
                  <View key={l.id} style={styles.structureLevelRow}>
                    <Ionicons name="layers-outline" size={13} color={C.textSub} />
                    <Text style={styles.structureLevelName}>{l.name}</Text>
                    {permissions.canCreate && (
                      <TouchableOpacity
                        style={styles.structureLevelAddBtn}
                        onPress={() => setNewPlanModal({ visible: true, name: '', building: b.name, buildingId: b.id, level: l.name, levelId: l.id })}
                      >
                        <Ionicons name="add" size={14} color={C.primary} />
                        <Text style={styles.structureLevelAddText}>{t('plansScreen.actions.addPlanHere')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
          {newPlanModalJSX}
        </View>
      );
    }

    // ── Cas 3 : Chantier actif + pas de structure + 0 plans → configurer ────
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: topPad + 12, paddingLeft: 24, paddingRight: 16, paddingBottom: 6 }]}>
          <Text style={styles.title}>{t('tabs.plans')}</Text>
          {activeChantier && (
            <TouchableOpacity style={styles.chantierLabelRow} onPress={openChantierSwitcher} activeOpacity={0.7}>
              <Text style={styles.chantierLabel} numberOfLines={1}>{activeChantier.name}</Text>
              <Ionicons name="chevron-down" size={11} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <ScrollView contentContainerStyle={styles.emptyState} showsVerticalScrollIndicator={false}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="business-outline" size={44} color={C.primary} />
          </View>
          <Text style={styles.emptyTitle}>{t('plansScreen.empty.configureStructureTitle')}</Text>
          <Text style={styles.emptySubtitle}>
            {t('plansScreen.empty.configureStructureSubtitle')}
          </Text>
          <View style={styles.emptyFeatures}>
            <View style={styles.emptyFeatureRow}>
              <View style={[styles.emptyFeatureDot, { backgroundColor: '#003082' }]}><Ionicons name="git-branch-outline" size={14} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.emptyFeatureTitle}>{t('plansScreen.empty.structureFeatureTitle')}</Text>
                <Text style={styles.emptyFeatureDesc}>{t('plansScreen.empty.structureFeatureDesc')}</Text>
              </View>
            </View>
            <View style={styles.emptyFeatureRow}>
              <View style={[styles.emptyFeatureDot, { backgroundColor: '#059669' }]}><Ionicons name="map-outline" size={14} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.emptyFeatureTitle}>{t('plansScreen.empty.locationTitle')}</Text>
                <Text style={styles.emptyFeatureDesc}>{t('plansScreen.empty.locationDesc')}</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/settings' as any)}>
            <Ionicons name="settings-outline" size={16} color="#fff" />
            <Text style={styles.emptyBtnText}>{t('plansScreen.actions.configureSettings')}</Text>
          </TouchableOpacity>
        </ScrollView>
        {newPlanModalJSX}
      </View>
    );
  }

  const hasVersions = allVersions.length > 0 || currentPlan?.revisionCode;

  return (
    <View style={styles.container}>
      {!fullscreen && (
        <View style={[styles.header, { paddingTop: topPad + 8 }]}>
          {/* Row 1: Title + filter button */}
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} accessibilityRole="header">{t('tabs.plans')}</Text>
              {activeChantier && (
                <TouchableOpacity style={styles.chantierLabelRow} onPress={openChantierSwitcher} activeOpacity={0.7} accessibilityLabel={t('plansScreen.a11y.activeChantier', { name: activeChantier.name })}>
                  <Text style={styles.chantierLabel} numberOfLines={1}>{activeChantier.name}</Text>
                  <Ionicons name="chevron-down" size={11} color={C.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={[styles.filterBtn, showFilters && styles.filterBtnActive]}
              onPress={() => setShowFilters(v => !v)}
              accessibilityLabel={t('plansScreen.a11y.filters', { count: activeFilters })}
            >
              <Ionicons name="options-outline" size={15} color={showFilters || activeFilters > 0 ? C.primary : C.text} />
              <Text style={[styles.filterBtnText, (showFilters || activeFilters > 0) && { color: C.primary }]}>{t('plansUi.filters')}</Text>
              {activeFilters > 0 && (
                <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{activeFilters}</Text></View>
              )}
            </TouchableOpacity>
          </View>

          {/* Hierarchy navigation — building chips (masqué si 1 seul bâtiment et aucun plan orphelin) */}
          {showBuildingChips && !showBuildingRail && !useHybridPicker && (
            <View style={styles.hierarchyRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hierarchyChips}>
                {chantierHierarchyBuildings.map(b => (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.hierarchyChip, selectedBuilding === b.id && styles.hierarchyChipActive]}
                    onPress={() => handleSelectBuilding(b.id)}
                  >
                    <Ionicons name="business-outline" size={11} color={selectedBuilding === b.id ? C.primary : C.textSub} />
                    <Text style={[styles.hierarchyChipText, selectedBuilding === b.id && styles.hierarchyChipTextActive]}>{b.name}</Text>
                  </TouchableOpacity>
                ))}
                {hasOrphanPlans && (
                  <TouchableOpacity
                    style={[styles.hierarchyChip, selectedBuilding === '__none__' && styles.hierarchyChipActive]}
                    onPress={handleSelectOrphanPlans}
                  >
                    <Ionicons name="layers-outline" size={11} color={selectedBuilding === '__none__' ? C.primary : C.textSub} />
                    <Text style={[styles.hierarchyChipText, selectedBuilding === '__none__' && styles.hierarchyChipTextActive]}>{t('plansScreen.general')}</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </View>
          )}

          {/* Hierarchy navigation — hybrid (récents + Tous · N) pour chantiers à plusieurs bâtiments */}
          {showBuildingChips && !showBuildingRail && useHybridPicker && (
            <View style={styles.hierarchyRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hierarchyChips}>
                {visibleRecentChips.map(b => {
                  const isActive = selectedBuilding === b.id;
                  return (
                    <TouchableOpacity
                      key={b.id}
                      style={[styles.hierarchyChip, isActive && styles.hierarchyChipActive]}
                      onPress={() => handleSelectBuilding(b.id)}
                    >
                      <Ionicons name="business-outline" size={11} color={isActive ? C.primary : C.textSub} />
                      <Text
                        style={[styles.hierarchyChipText, isActive && styles.hierarchyChipTextActive]}
                        numberOfLines={1}
                      >
                        {b.name}
                      </Text>
                      {b.reserveCount > 0 && (
                        <View style={styles.hierarchyChipBadge}>
                          <Text style={styles.hierarchyChipBadgeText}>{b.reserveCount}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
                {hasOrphanPlans && (
                  <TouchableOpacity
                    style={[styles.hierarchyChip, selectedBuilding === '__none__' && styles.hierarchyChipActive]}
                    onPress={handleSelectOrphanPlans}
                  >
                    <Ionicons name="layers-outline" size={11} color={selectedBuilding === '__none__' ? C.primary : C.textSub} />
                    <Text style={[styles.hierarchyChipText, selectedBuilding === '__none__' && styles.hierarchyChipTextActive]}>{t('plansScreen.general')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.hierarchyChipAll, selectedBuilding === 'all' && styles.hierarchyChipAllActive]}
                  onPress={() => setBuildingPickerOpen(true)}
                  accessibilityLabel={t('plansScreen.a11y.viewAllBuildings', { count: chantierHierarchyBuildings.length })}
                >
                  <Text style={styles.hierarchyChipAllText}>
                    {t('plansScreen.allCount', { count: chantierHierarchyBuildings.length })}
                  </Text>
                  <Ionicons name="chevron-down" size={12} color="#fff" />
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}
          {/* Hierarchy navigation — level chips (uniquement si un bâtiment réel est sélectionné) */}
          {activeBuildingForLevels && activeBuildingForLevels.levels.length > 0 && !useHybridLevelPicker && (
            <View style={styles.hierarchyRowLevel}>
              <View style={styles.hierarchyChipsLevel}>
                <TouchableOpacity
                  style={[styles.hierarchyChipLevel, selectedLevel === 'all' && styles.hierarchyChipLevelActive]}
                  onPress={() => { setSelectedLevel('all'); setActivePlanId(null); }}
                >
                  <Text style={[styles.hierarchyChipLevelText, selectedLevel === 'all' && { color: C.primary, fontFamily: 'Inter_600SemiBold' }]}>{t('plansUi.allLevels', { defaultValue: t('levelPicker.allLevels') })}</Text>
                </TouchableOpacity>
                {activeBuildingForLevels.levels.map(l => (
                  <TouchableOpacity
                    key={l.id}
                    style={[styles.hierarchyChipLevel, selectedLevel === l.id && styles.hierarchyChipLevelActive]}
                    onPress={() => { setSelectedLevel(l.id); setActivePlanId(null); }}
                  >
                    <Text style={[styles.hierarchyChipLevelText, selectedLevel === l.id && { color: C.primary, fontFamily: 'Inter_600SemiBold' }]}>{l.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Hierarchy navigation — level chips hybrides (récents + Tous · N) pour bâtiments avec ≥6 niveaux */}
          {activeBuildingForLevels && useHybridLevelPicker && (
            <View style={styles.hierarchyRowLevel}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hierarchyChipsLevel}>
                <TouchableOpacity
                  style={[styles.hierarchyChipLevel, selectedLevel === 'all' && styles.hierarchyChipLevelActive]}
                  onPress={() => { setSelectedLevel('all'); setActivePlanId(null); }}
                >
                  <Text style={[styles.hierarchyChipLevelText, selectedLevel === 'all' && { color: C.primary, fontFamily: 'Inter_600SemiBold' }]}>{t('plansUi.allLevels', { defaultValue: t('levelPicker.allLevels') })}</Text>
                </TouchableOpacity>
                {visibleRecentLevelChips.map(l => {
                  const isActive = selectedLevel === l.id;
                  return (
                    <TouchableOpacity
                      key={l.id}
                      style={[styles.hierarchyChipLevel, isActive && styles.hierarchyChipLevelActive]}
                      onPress={() => { setSelectedLevel(l.id); setActivePlanId(null); }}
                    >
                      <Text
                        style={[styles.hierarchyChipLevelText, isActive && { color: C.primary, fontFamily: 'Inter_600SemiBold' }]}
                        numberOfLines={1}
                      >
                        {l.name}
                      </Text>
                      {l.reserveCount > 0 && (
                        <View style={styles.hierarchyChipBadge}>
                          <Text style={styles.hierarchyChipBadgeText}>{l.reserveCount}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={styles.hierarchyChipAll}
                  onPress={() => setLevelPickerOpen(true)}
                  accessibilityLabel={t('plansScreen.a11y.viewAllLevels', { count: activeBuildingForLevels.levels.length })}
                >
                  <Text style={styles.hierarchyChipAllText}>
                    {t('plansScreen.allCount', { count: activeBuildingForLevels.levels.length })}
                  </Text>
                  <Ionicons name="chevron-down" size={12} color="#fff" />
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}

          {/* Row 2: Plan tabs with thumbnails */}
          <View style={styles.planTabsBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              <View style={styles.planTabsRow}>
                {filteredPlans.length === 0 ? (
                  <View style={styles.planTabsEmpty}>
                    <Ionicons name="map-outline" size={13} color={C.textMuted} />
                    <Text style={styles.planTabsEmptyText}>{t('plansScreen.empty.noPlanForLevel')}</Text>
                  </View>
                ) : filteredPlans.map(plan => {
                  const isActive = currentPlanId === plan.id;
                  const planReserveCount = reserveCountByPlanId.get(plan.id) ?? 0;
                  const isUnsynced = !!(plan.uri && isLocalUri(plan.uri));
                  return (
                    <TouchableOpacity
                      key={plan.id}
                      style={[styles.planTab, isActive && styles.planTabActive, { position: 'relative' }]}
                      onPress={() => handleSelectPlan(plan.id)}
                      accessibilityLabel={t('plansScreen.a11y.planTab', { name: plan.name, reserves: planReserveCount > 0 ? commonReserveText(planReserveCount) : '', unsynced: isUnsynced ? t('plansScreen.a11y.unsynced') : '' })}
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
                      {isUnsynced && (
                        <View style={styles.planTabSyncDot} accessibilityLabel={t('plansScreen.a11y.fileNotSynced')}>
                          <Ionicons name="cloud-offline" size={9} color="#fff" />
                        </View>
                      )}
                      <Text style={[styles.planTabText, isActive && styles.planTabTextActive]} numberOfLines={1} ellipsizeMode="tail">
                        {plan.name}
                      </Text>
                      {plan.level && selectedLevel === 'all' && (
                        <Text style={styles.planTabLevelBadge} numberOfLines={1}>{plan.level}</Text>
                      )}
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
              {permissions.canCreate && !currentPlan?.uri && (
                <TouchableOpacity style={[styles.importBtn, importing && { opacity: 0.5 }]} onPress={handleImportPlan} disabled={importing || !currentPlanId} accessibilityLabel={t('plansScreen.actions.importPlan')}>
                  {importing ? <ActivityIndicator size="small" color={C.primary} /> : (
                    <><Ionicons name="cloud-upload-outline" size={14} color={C.primary} /><Text style={styles.importBtnText}>{t('plansScreen.actions.import')}</Text></>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>

        </View>
      )}

      <View style={isTablet ? styles.tabletBodyRow : { flex: 1 }}>
        {showBuildingRail && (
          <View style={styles.buildingRail}>
            <View style={styles.buildingRailHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.buildingRailTitle}>{t('plansScreen.buildingRail.title')}</Text>
                <Text style={styles.buildingRailSubtitle}>
                  {t('plansScreen.buildingRail.fixedHint')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.buildingRailPickerBtn}
                onPress={() => setBuildingPickerOpen(true)}
                accessibilityLabel={t('plansScreen.a11y.viewAllBuildings', { count: chantierHierarchyBuildings.length })}
              >
                <Ionicons name="search-outline" size={15} color={C.primary} />
              </TouchableOpacity>
            </View>

            <View style={styles.buildingRailSearch}>
              <Ionicons name="search-outline" size={14} color={C.textMuted} />
              <TextInput
                style={styles.buildingRailSearchInput}
                placeholder={t('plansScreen.buildingRail.search')}
                placeholderTextColor={C.textMuted}
                value={buildingRailQuery}
                onChangeText={setBuildingRailQuery}
                returnKeyType="search"
              />
              {buildingRailQuery.length > 0 && (
                <TouchableOpacity onPress={() => setBuildingRailQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={15} color={C.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={[styles.buildingRailAllRow, selectedBuilding === 'all' && styles.buildingRailRowActive]}
              onPress={handleSelectAllBuildings}
              accessibilityState={{ selected: selectedBuilding === 'all' }}
            >
              <View style={[styles.buildingRailIcon, selectedBuilding === 'all' && styles.buildingRailIconActive]}>
                <Ionicons name="grid-outline" size={16} color={selectedBuilding === 'all' ? '#fff' : C.primary} />
              </View>
              <View style={styles.buildingRailTextWrap}>
                <Text style={[styles.buildingRailName, selectedBuilding === 'all' && styles.buildingRailNameActive]} numberOfLines={1}>
                  {t('plansScreen.buildingRail.allBuildings')}
                </Text>
                <Text style={styles.buildingRailMeta} numberOfLines={1}>
                  {commonPlanText(chantierPlans.length)} · {commonReserveText(activeReserveCountForRail)}
                </Text>
              </View>
            </TouchableOpacity>

            <FlatList
              data={filteredBuildingRailItems}
              keyExtractor={item => item.id}
              style={styles.buildingRailList}
              contentContainerStyle={styles.buildingRailListContent}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.buildingRailEmpty}>
                  <Ionicons name="search-outline" size={18} color={C.textMuted} />
                  <Text style={styles.buildingRailEmptyText}>{t('plansScreen.buildingRail.empty')}</Text>
                </View>
              }
              renderItem={({ item }) => {
                const isActive = selectedBuilding === item.id;
                const isOrphan = item.kind === 'orphans';
                return (
                  <TouchableOpacity
                    style={[styles.buildingRailRow, isActive && styles.buildingRailRowActive]}
                    onPress={isOrphan ? handleSelectOrphanPlans : () => handleSelectBuilding(item.id)}
                    activeOpacity={0.78}
                    accessibilityState={{ selected: isActive }}
                  >
                    <View style={[styles.buildingRailIcon, isActive && styles.buildingRailIconActive]}>
                      <Ionicons name={isOrphan ? 'layers-outline' : 'business-outline'} size={16} color={isActive ? '#fff' : C.textSub} />
                    </View>
                    <View style={styles.buildingRailTextWrap}>
                      <Text style={[styles.buildingRailName, isActive && styles.buildingRailNameActive]} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.buildingRailMeta} numberOfLines={1}>
                        {commonPlanText(item.planCount)} · {commonReserveText(item.reserveCount)}
                      </Text>
                    </View>
                    {item.reserveCount > 0 && (
                      <View style={[styles.buildingRailBadge, isActive && styles.buildingRailBadgeActive]}>
                        <Text style={[styles.buildingRailBadgeText, isActive && styles.buildingRailBadgeTextActive]}>{item.reserveCount}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}
        <View style={{ flex: 1 }}>
          {!fullscreen && (
            <>
            <View style={styles.planTitleRow}>
              <View style={styles.planTitleTopRow}>
                <View style={{ flex: 1, minWidth: 0, overflow: 'hidden' as any }}>
                  <Text style={styles.planTitle} numberOfLines={1} ellipsizeMode="tail">
                    {currentPlan?.name ?? t('plansScreen.plan')}
                  </Text>
                  {currentPlan?.uri ? (
                    <Text style={styles.planSubtitle}>{currentPlan.fileType === 'pdf' ? 'PDF' : isImagePlan ? t('plansScreen.fileTypes.image') : 'DXF'} · {currentPlan.uploadedAt}</Text>
                  ) : (
                    <Text style={styles.planSubtitle}>{t('plansScreen.fileTypes.schematic')} · {currentPlan?.uploadedAt ?? ''}</Text>
                  )}
                </View>
                {hasPlanPins && (
                <View style={styles.pinSizeRow}>
                  {focusedPinId && (
                    <Text style={{ fontSize: 10, color: '#FBBF24', fontFamily: 'Inter_600SemiBold', marginRight: 2 }}>
                      #{pinNumberMap.get(focusedPinId) ?? '?'}
                    </Text>
                  )}
                  {(() => {
                    const indivScale = focusedPinId ? (pinSizes[focusedPinId] ?? 1.0) : null;
                    const minusDisabled = focusedPinId ? (indivScale! <= 0.25) : pinSizeScale <= 0.25;
                    const plusDisabled  = focusedPinId ? (indivScale! >= 3.0) : pinSizeScale >= 2.5;
                    return (
                      <>
                        <TouchableOpacity
                          style={[styles.pinSizeBtn, minusDisabled && { opacity: 0.35 }]}
                          onPress={() => changePinSize(-0.25)}
                          disabled={minusDisabled}
                          accessibilityLabel={focusedPinId ? t('plansScreen.a11y.decreasePin') : t('plansScreen.a11y.decreasePins')}
                        >
                          <Ionicons name="remove-circle-outline" size={18} color={focusedPinId ? '#FBBF24' : C.textSub} />
                        </TouchableOpacity>
                        <Ionicons name="ellipse" size={9} color={focusedPinId ? '#FBBF24' : C.primary} />
                        <TouchableOpacity
                          style={[styles.pinSizeBtn, plusDisabled && { opacity: 0.35 }]}
                          onPress={() => changePinSize(0.25)}
                          disabled={plusDisabled}
                          accessibilityLabel={focusedPinId ? t('plansScreen.a11y.increasePin') : t('plansScreen.a11y.increasePins')}
                        >
                          <Ionicons name="add-circle-outline" size={18} color={focusedPinId ? '#FBBF24' : C.textSub} />
                        </TouchableOpacity>
                      </>
                    );
                  })()}
                </View>
                )}
              </View>
              {(hasVersions || (currentPlan?.uri && permissions.canCreate) || (permissions.canDelete && (currentPlan?.uri || currentPlanId))) && (
                <View style={styles.planActionsRow}>
                  {hasVersions && (
                    <TouchableOpacity
                      style={[styles.versionBtn, showVersionHistory && styles.versionBtnActive]}
                      onPress={() => setShowVersionHistory(v => !v)}
                      accessibilityLabel={t('plansScreen.a11y.revisionHistory', { code: currentPlan?.revisionCode ?? 'R01' })}
                      accessibilityRole="button"
                    >
                      <Ionicons name="time-outline" size={13} color={showVersionHistory ? C.primary : C.textSub} />
                      <Text style={[styles.versionBtnText, showVersionHistory && { color: C.primary }]}>
                        {currentPlan?.revisionCode ?? 'R01'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {currentPlan?.uri && permissions.canCreate && (
                    <TouchableOpacity style={[styles.removePlanBtn, importing && { opacity: 0.5 }]} onPress={handleRemovePlan} disabled={importing} accessibilityLabel={t('plansScreen.actions.replacePlan')}>
                      {importing
                        ? <ActivityIndicator size="small" color={C.primary} />
                        : <><Ionicons name="swap-horizontal-outline" size={13} color={C.textSub} /><Text style={styles.removePlanText}>{t('plansScreen.actions.replace')}</Text></>
                      }
                    </TouchableOpacity>
                  )}
                  {permissions.canDelete && (currentPlan?.uri || currentPlanId) && (
                    <>
                      {currentPlan?.uri && (
                        <TouchableOpacity
                          style={styles.removePlanBtn}
                          onPress={handleDeletePlanFile}
                          accessibilityLabel={t('plansScreen.actions.removePlanFile')}
                        >
                          <Ionicons name="document-outline" size={13} color="#F59E0B" />
                          <Text style={[styles.removePlanText, { color: '#F59E0B' }]}>{t('plansScreen.actions.remove')}</Text>
                        </TouchableOpacity>
                      )}
                      {currentPlanId && (
                        <TouchableOpacity
                          style={styles.removePlanBtn}
                          onPress={handleDeletePlan}
                          accessibilityLabel={t('plansScreen.actions.deletePlan')}
                        >
                          <Ionicons name="trash-outline" size={13} color="#EF4444" />
                          <Text style={[styles.removePlanText, { color: '#EF4444' }]}>{t('plansScreen.plan')}</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>
              )}
            </View>

            {showVersionHistory && currentPlan && (
              <View style={styles.versionPanel}>
                <View style={styles.versionPanelHeader}>
                  <Ionicons name="time-outline" size={13} color={C.textSub} />
                  <Text style={styles.versionPanelTitle} numberOfLines={1} ellipsizeMode="tail">{t('plansScreen.revisions.title', { name: currentPlan.name })}</Text>
                  <TouchableOpacity onPress={() => setShowVersionHistory(false)} hitSlop={8}>
                    <Ionicons name="close" size={16} color={C.textMuted} />
                  </TouchableOpacity>
                </View>
                {allVersions.length === 0 ? (
                  <Text style={styles.versionEmpty}>{permissions.canCreate ? t('plansScreen.revisions.emptyCanCreate') : t('plansScreen.revisions.empty')}</Text>
                ) : allVersions.map(ver => (
                  <TouchableOpacity key={ver.id} style={[styles.versionRow, ver.id === currentPlanId && styles.versionRowActive]} onPress={() => { handleSelectPlan(ver.id); setShowVersionHistory(false); }}>
                    <View style={[styles.versionBadge, ver.isLatestRevision && styles.versionBadgeLatest]}>
                      <Text style={[styles.versionBadgeText, ver.isLatestRevision && styles.versionBadgeTextLatest]}>{ver.revisionCode ?? 'R01'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.versionName}>{ver.name}</Text>
                      <Text style={styles.versionDate}>{ver.uploadedAt}{ver.revisionNote ? ' · ' + ver.revisionNote : ''}</Text>
                    </View>
                    {ver.isLatestRevision && <View style={styles.latestChip}><Text style={styles.latestChipText}>{t('plansScreen.revisions.current')}</Text></View>}
                  </TouchableOpacity>
                ))}
                {permissions.canCreate && (
                  <TouchableOpacity style={styles.newVersionBtn} onPress={openRevisionModal}>
                    <Ionicons name="cloud-upload-outline" size={13} color={C.primary} />
                    <Text style={styles.newVersionBtnText}>{t('plansScreen.actions.createRevision')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            </>
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
            {filteredPlans.length === 0 && hasActiveHierarchyFilter ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
                <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: '#0D2045', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1E3A5F' }}>
                  <Ionicons name="layers-outline" size={36} color="#3B6FCC" />
                </View>
                <View style={{ alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: '#94A3B8', fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>
                    {selectedLevel === 'all' ? t('plansScreen.empty.noPlanForBuilding') : t('plansScreen.empty.noPlanForLevel')}
                  </Text>
                  <Text style={{ color: '#475569', fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
                    {selectedLevel === 'all' && chantierHierarchyBuildings.length > 0
                      ? t('plansScreen.empty.selectLevelToAdd')
                      : t('plansScreen.empty.levelNoPlan')}
                  </Text>
                </View>
                {permissions.canCreate && selectedLevel !== 'all' && (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#003082', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 }}
                    onPress={handleAddPlan}
                    accessibilityLabel={t('plansScreen.actions.addPlanForLevel')}
                    accessibilityRole="button"
                  >
                    <Ionicons name="add-circle-outline" size={16} color="#fff" />
                    <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{t('plansScreen.actions.addPlan')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : isPlanFile ? (
              <PdfPlanViewer
                key={currentPlanId}
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
                  if (focusedPinId) { setFocusedPinId(null); return; }
                  if (!permissions.canCreate) return;
                  router.push({ pathname: '/reserve/new', params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '', planX: String(Math.round(px)), planY: String(Math.round(py)), building: currentPlan?.building ?? '', level: currentPlan?.level ?? '', buildingId: currentPlan?.buildingId ?? '', levelId: currentPlan?.levelId ?? '' } } as any);
                }}
                onPinMove={(reserveId, planX, planY) => {
                  const reserve = reservesRef.current.find(r => r.id === reserveId);
                  if (reserve) updateReserveFieldsRef.current({ ...reserve, planX: Math.round(planX), planY: Math.round(planY) });
                }}
                onPinFocus={(reserveId) => {
                  setFocusedPinIdRef.current(reserveId);
                  if (focusedPinTimerRef.current) clearTimeout(focusedPinTimerRef.current);
                  focusedPinTimerRef.current = setTimeout(() => setFocusedPinIdRef.current(null), 5000);
                }}
                pinSizes={pinSizes}
                focusedPinId={focusedPinId}
                canAnnotate={permissions.canCreate}
                canCreate={permissions.canCreate}
                canMovePins={canMovePins}
                pinSize={pinSize}
                onZoomChange={(z) => setPdfZoomPct(Math.round(z * 100))}
                onReady={() => {
                  if (currentPlanId) {
                    readyPlanIdRef.current = currentPlanId;
                    releaseFocusedPinWhenPlanReady(currentPlanId);
                  }
                }}
                companies={companies}
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
                        <Text style={{ color: '#94A3B8', fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>{t('plansScreen.empty.noImportedPlan')}</Text>
                        <Text style={{ color: '#475569', fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
                          {t('plansScreen.empty.importPlanHelp')}
                        </Text>
                      </View>
                      {permissions.canCreate && (
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#003082', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 }}
                          onPress={handleImportPlan}
                          disabled={importing}
                          accessibilityLabel={t('plansScreen.actions.importPlan')}
                          accessibilityRole="button"
                        >
                          <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{t('plansScreen.actions.importPlan')}</Text>
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
                      <Text style={{ color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 12 }}>{t('plansScreen.loadingDxf')}</Text>
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
                        <Text style={{ fontSize: getPinLabelSize(sz), fontFamily: 'Inter_700Bold', color: '#fff' }}>{isCluster ? cluster.items.length : cluster.number}</Text>
                      </View>
                    );
                  })}

                  {pinClusters.map((cluster, ci) => {
                    const isCluster = cluster.items.length > 1;
                    const pinId = cluster.items[0]?.id ?? '';
                    const color = getCompanyColor(cluster.dominantCompany, companies);
                    const isHighlighted = !isCluster && highlightedReserveId === pinId;
                    const isFocused = !isCluster && focusedPinId === pinId;
                    const baseSz = isCluster ? clusterSize : getPinDisplaySize(pinId, pinSize);
                    const sz = isFocused ? Math.round(baseSz * 1.1) : baseSz;
                    const isDraggingThis = draggingPinId === pinId;
                    return (
                      <TouchableOpacity
                        key={`cl-${ci}`}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        style={{
                          position: 'absolute', left: `${cluster.cx}%` as any, top: `${cluster.cy}%` as any,
                          backgroundColor: color, width: sz, height: sz, borderRadius: sz / 2,
                          transform: [{ translateX: -(sz / 2) }, { translateY: -(sz / 2) }],
                          borderWidth: isFocused ? 2 : isHighlighted ? 2 : 1.5,
                          borderColor: isFocused ? '#FBBF24' : isHighlighted ? '#fff' : 'rgba(255,255,255,0.35)',
                          shadowColor: isFocused ? '#FBBF24' : '#000',
                          shadowOpacity: isFocused ? 0.9 : isHighlighted ? 0.7 : 0.4,
                          shadowRadius: isFocused ? 7 : 3,
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
                              draggingFirstMoveRef.current = false;
                              const initSz = isCluster ? clusterSize : getPinDisplaySize(pinId, pinSize);
                              draggingAnimSzHalf.current = initSz / 2;
                              draggingAnimX.setValue((cluster.cx / 100) * dynWRef.current);
                              draggingAnimY.setValue((cluster.cy / 100) * dynHRef.current);
                            }
                          }
                        }}
                        delayLongPress={400}
                        accessibilityLabel={isCluster ? t('plansScreen.a11y.reserveGroup', { count: cluster.items.length }) : t('plansScreen.a11y.reservePin', { number: cluster.number })}
                      >
                        <Text style={{ fontSize: getPinLabelSize(sz), fontFamily: 'Inter_700Bold', color: '#fff' }}>
                          {isCluster ? cluster.items.length : cluster.number}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  {draggingPinId && (() => {
                    const reserve = reserves.find(r => r.id === draggingPinId);
                    const num = pinNumberMap.get(draggingPinId) ?? '?';
                    const color = getReservePinColor(reserve, companies);
                    const sz = getPinDisplaySize(draggingPinId, pinSize);
                    const half = sz / 2;
                    return (
                      <Animated.View
                        style={{
                          position: 'absolute',
                          left: 0, top: 0,
                          width: sz, height: sz, borderRadius: sz / 2,
                          backgroundColor: color,
                          transform: [
                            { translateX: Animated.subtract(draggingAnimX, half) as any },
                            { translateY: Animated.subtract(draggingAnimY, half) as any },
                          ],
                          borderWidth: 2, borderColor: '#fff',
                          shadowColor: '#000', shadowOpacity: 0.8, shadowRadius: 8, elevation: 20,
                          alignItems: 'center', justifyContent: 'center',
                          opacity: 0.95,
                          pointerEvents: 'none' as any,
                        }}
                      >
                        <Text style={{ fontSize: getPinLabelSize(sz), fontFamily: 'Inter_700Bold', color: '#fff' }}>{num}</Text>
                      </Animated.View>
                    );
                  })()}
                </View>
              </Animated.View>
            )}

            {/* Mini map overlay */}
            {miniMapPins.length > 0 && !isPlanFile && (
              <View style={styles.miniMap}>
                <View style={styles.miniMapInner}>
                  {miniMapPins.map(pin => (
                    <View key={pin.id} style={[styles.miniMapDot, {
                      left: (pin.x / 100) * 90 - 2,
                      top: (pin.y / 100) * 68 - 2,
                      backgroundColor: pin.color,
                    }]} />
                  ))}
                </View>
              </View>
            )}

            {/* Dismissible hint overlay — uniquement si un fichier est importé */}
            {!hintSeen && permissions.canCreate && !fullscreen && !!currentPlan?.uri && !isPlanFile && (
              <View style={styles.hintOverlay}>
                <View style={styles.hintBanner}>
                  <Ionicons name="finger-print-outline" size={14} color={C.textMuted} />
                  <Text style={styles.hintText}>{t('plansScreen.hint.tapToCreateReserve')}</Text>
                  <TouchableOpacity onPress={dismissHint} hitSlop={8} accessibilityLabel={t('plansScreen.hint.closeA11y')}>
                    <Ionicons name="close" size={14} color={C.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Zoom controls overlay — bottom right (only for schematic/DXF, PDF viewer has its own) */}
            {!isPlanFile && !!currentPlanId && (
              <View style={styles.zoomOverlay}>
                <View style={styles.zoomOverlayGroup}>
                  <TouchableOpacity style={styles.zoomOverlayBtn} onPress={() => doZoom('out')} accessibilityLabel={t('plansScreen.a11y.zoomOut')}>
                    <Ionicons name="remove" size={14} color={C.text} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.zoomOverlayBtn} onPress={() => doZoom('reset')} accessibilityLabel={t('plansScreen.a11y.resetZoom')}>
                    <Ionicons name="scan-outline" size={12} color={C.text} />
                  </TouchableOpacity>
                  <Text style={styles.zoomOverlayPct}>{currentZoomPct}</Text>
                  <TouchableOpacity style={styles.zoomOverlayBtn} onPress={() => doZoom('in')} accessibilityLabel={t('plansScreen.a11y.zoomIn')}>
                    <Ionicons name="add" size={14} color={C.text} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Fullscreen toggle — top right */}
            {!!currentPlanId && (
              <TouchableOpacity
                style={[styles.fullscreenBtn, fullscreen && { top: insets.top + 10 }]}
                onPress={() => setFullscreen(v => !v)}
                accessibilityLabel={fullscreen ? t('plansScreen.a11y.exitFullscreen') : t('plansScreen.a11y.fullscreen')}
              >
                <Ionicons name={fullscreen ? 'contract-outline' : 'expand-outline'} size={17} color="#fff" />
              </TouchableOpacity>
            )}
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
                      <Text style={styles.tabletBackBtnText}>{t('plansUi.reserves')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => router.push(`/reserve/${detailReserve.id}` as any)} style={styles.tabletDetailEditBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Ionicons name="open-outline" size={15} color={C.primary} />
                    </TouchableOpacity>
                  </View>
                  <ScrollView contentContainerStyle={styles.tabletDetailContent} showsVerticalScrollIndicator={false}>
                    <View style={styles.tabletDetailHeaderRow}>
                      <View style={[styles.pinBadge, { backgroundColor: getReservePinColor(detailReserve, companies), width: 40, height: 40, borderRadius: 20, marginRight: 10 }]}>
                        <Text style={[styles.pinBadgeText, { fontSize: 16 }]}>{pinNumberMap.get(detailReserve.id) ?? '—'}</Text>
                      </View>
                      <Text style={styles.tabletDetailTitle} numberOfLines={3}>{detailReserve.title}</Text>
                    </View>
                    <View style={styles.tabletDetailMeta}>
                      <Ionicons name="business-outline" size={12} color={C.textMuted} />
                      <Text style={styles.tabletDetailMetaText}>{getReserveCompanyLabel(detailReserve)}</Text>
                      {detailReserve.level && (<><Text style={styles.tabletDetailMetaDot}>·</Text><Ionicons name="layers-outline" size={12} color={C.textMuted} /><Text style={styles.tabletDetailMetaText}>{detailReserve.level}</Text></>)}
                    </View>
                    {detailReserve.deadline && detailReserve.deadline !== '—' && (
                      <View style={styles.tabletDetailMeta}><Ionicons name="calendar-outline" size={12} color={C.textMuted} /><Text style={styles.tabletDetailMetaText}>{t('plansScreen.deadline', { date: detailReserve.deadline })}</Text></View>
                    )}
                    <Text style={styles.tabletDetailDesc}>{getReserveDescriptionText(detailReserve.description, detailReserve.title)}</Text>
                    <Text style={styles.tabletDetailSectionLabel}>{t('plansScreen.changeStatus')}</Text>
                    <View style={styles.tabletStatusGrid}>
                      {STATUS_ORDER.map(s => {
                        const cfg = STATUS_CONFIG[s];
                        const isActive = detailReserve.status === s;
                        return (
                          <TouchableOpacity key={s} style={[styles.tabletStatusBtn, { backgroundColor: isActive ? cfg.color : cfg.bg, borderColor: cfg.color }]}
                            onPress={() => { if (!isActive) updateReserveStatus(detailReserve.id, s, user?.name ?? 'Chef de chantier'); }}
                            accessibilityLabel={t('plansScreen.a11y.status', { status: getStatusLabel(s) })}>
                            {isActive && <Ionicons name="checkmark" size={11} color="#fff" />}
                            <Text style={[styles.tabletStatusBtnText, { color: isActive ? '#fff' : cfg.color }]}>{getStatusLabel(s)}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={styles.tabletDetailActions}>
                      <PriorityBadge priority={detailReserve.priority} small />
                      {permissions.canCreate && (
                        <TouchableOpacity style={styles.tabletDetailOpenBtn} onPress={() => router.push(`/reserve/${detailReserve.id}` as any)}>
                          <Ionicons name="create-outline" size={14} color="#fff" />
                          <Text style={styles.tabletDetailOpenBtnText}>{t('common.edit')}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </ScrollView>
                </>
              ) : (
                <>
                  <View style={styles.tabletPanelHdr}>
                    <Ionicons name="list-outline" size={14} color={C.primary} />
                    <Text style={styles.tabletPanelTitle}>{planReserves.length > 0 ? commonReserveText(planReserves.length) : t('plansUi.reserves')}</Text>
                    <TouchableOpacity style={styles.exportBtn} onPress={openPdfModal} accessibilityLabel={t('plansUi.exportPdf')}>
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
                        <Text style={styles.noReservesText}>{t('plansUi.noReserveOnPlan')}</Text>
                        {permissions.canCreate && (
                          <TouchableOpacity style={styles.addReserveFromPlanBtn} onPress={() => router.push({ pathname: '/reserve/new', params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '', building: currentPlan?.building ?? '', level: currentPlan?.level ?? '', buildingId: currentPlan?.buildingId ?? '', levelId: currentPlan?.levelId ?? '' } } as any)}>
                            <Ionicons name="add" size={14} color={C.primary} />
                            <Text style={styles.addReserveFromPlanText}>{t('common.add')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    }
                    renderItem={({ item: r }) => (
                      <TouchableOpacity style={[styles.reserveRow, highlightedReserveId === r.id && styles.tabletReserveRowSelected]} onPress={() => { setHighlightedReserveId(r.id); setPanelView('detail'); }} activeOpacity={0.75} accessibilityLabel={t('plansUi.reserveAccessibility', { title: r.title })}>
                        <View style={[styles.pinBadge, { backgroundColor: getReservePinColor(r, companies), width: 34, height: 34, borderRadius: 17 }]}>
                          <Text style={styles.pinBadgeText}>{pinNumberMap.get(r.id) ?? '—'}</Text>
                        </View>
                        <View style={styles.reserveInfo}>
                          <Text style={styles.reserveTitle} numberOfLines={2}>{r.title}</Text>
                          <Text style={styles.reserveMeta}>{getReserveCompanyLabel(r)} · {r.level || '—'}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
                      </TouchableOpacity>
                    )}
                  />
                  {permissions.canCreate && (
                    <TouchableOpacity style={styles.tabletAddBtn} onPress={() => router.push({ pathname: '/reserve/new', params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '', building: currentPlan?.building ?? '', level: currentPlan?.level ?? '', buildingId: currentPlan?.buildingId ?? '', levelId: currentPlan?.levelId ?? '' } } as any)}>
                      <Ionicons name="add" size={18} color="#fff" />
                      <Text style={styles.tabletAddBtnText}>{t('plansScreen.actions.newReserve')}</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          );
        })()}
      </View>

      {/* Mobile: reserve bottom sheet */}
      {!isTablet && !fullscreen && !!currentPlanId && (
        <ReservesSheet
          reserves={planReserves}
          allReserves={allPlanReserves}
          pinNumberMap={pinNumberMap}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onReservePress={(r) => { setSelected(r); }}
          onExport={openPdfModal}
          canCreate={permissions.canCreate}
          currentPlan={currentPlan}
          activeChantierId={activeChantierId}
          highlightedReserveId={highlightedReserveId}
          sheetHeight={screenHeight}
          companies={companies}
        />
      )}

      {/* Mobile FAB */}
      {permissions.canCreate && !isTablet && !fullscreen && !!currentPlanId && (
        <TouchableOpacity
          style={[styles.fab, { bottom: Platform.OS === 'web' ? 100 : insets.bottom + (isPlanFile ? 150 : 80) }]}
          onPress={() => router.push({ pathname: '/reserve/new', params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '', building: currentPlan?.building ?? '', level: currentPlan?.level ?? '', buildingId: currentPlan?.buildingId ?? '', levelId: currentPlan?.levelId ?? '' } } as any)}
          activeOpacity={0.85}
          accessibilityLabel={t('plansScreen.actions.createNewReserve')}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      )}

      {/* PDF export modal */}
      <Modal
        visible={pdfModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPdfModalVisible(false)}
      >
        <Pressable style={styles.pdfModalOverlay} onPress={() => setPdfModalVisible(false)}>
          <Pressable style={styles.pdfModalCard} onPress={() => {}}>
            <View style={styles.pdfModalHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{t('plansScreen.pdf.title')}</Text>
                <Text style={styles.modalMeta}>
                  {pdfScope === 'plan'
                    ? t('plansScreen.pdf.planMeta', { name: currentPlan?.name ?? '—' })
                    : t('plansScreen.pdf.chantierMeta', { name: activeChantier?.name ?? '—' })}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setPdfModalVisible(false)} accessibilityLabel={t('common.close')}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }} keyboardShouldPersistTaps="handled">
            {/* Scope toggle: Ce plan / Rapport global */}
            <View style={styles.pdfScopeRow}>
              <TouchableOpacity
                style={[styles.pdfScopeBtn, pdfScope === 'plan' && styles.pdfScopeBtnActive]}
                onPress={() => setPdfScope('plan')}
              >
                <Ionicons name="map-outline" size={13} color={pdfScope === 'plan' ? '#fff' : C.textMuted} />
                <Text style={[styles.pdfScopeBtnText, pdfScope === 'plan' && styles.pdfScopeBtnTextActive]}>
                  {t('plansScreen.pdf.thisPlan')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pdfScopeBtn, pdfScope === 'global' && styles.pdfScopeBtnActive]}
                onPress={() => setPdfScope('global')}
              >
                <Ionicons name="layers-outline" size={13} color={pdfScope === 'global' ? '#fff' : C.textMuted} />
                <Text style={[styles.pdfScopeBtnText, pdfScope === 'global' && styles.pdfScopeBtnTextActive]}>
                  {t('plansScreen.pdf.globalReport')}
                </Text>
              </TouchableOpacity>
            </View>

            {pdfScope === 'plan' && (
              <View style={styles.pdfOptionGroup}>
                <TouchableOpacity
                  style={[styles.pdfOption, pdfMode === 'all' && styles.pdfOptionActive]}
                  onPress={() => setPdfMode('all')}
                >
                  <Ionicons name="albums-outline" size={14} color={pdfMode === 'all' ? '#fff' : C.text} />
                  <Text style={[styles.pdfOptionText, pdfMode === 'all' && styles.pdfOptionTextActive]}>
                    {t('plansScreen.pdf.allPlanReserves')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.pdfOption, pdfMode === 'company_single' && styles.pdfOptionActive]}
                  onPress={() => setPdfMode('company_single')}
                >
                  <Ionicons name="business-outline" size={14} color={pdfMode === 'company_single' ? '#fff' : C.text} />
                  <Text style={[styles.pdfOptionText, pdfMode === 'company_single' && styles.pdfOptionTextActive]}>
                    {t('plansScreen.pdf.oneCompany')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.pdfOption, pdfMode === 'company_multi' && styles.pdfOptionActive]}
                  onPress={() => setPdfMode('company_multi')}
                >
                  <Ionicons name="people-outline" size={14} color={pdfMode === 'company_multi' ? '#fff' : C.text} />
                  <Text style={[styles.pdfOptionText, pdfMode === 'company_multi' && styles.pdfOptionTextActive]}>
                    {t('plansScreen.pdf.multipleCompanies')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.pdfOption, pdfMode === 'manual' && styles.pdfOptionActive]}
                  onPress={() => setPdfMode('manual')}
                >
                  <Ionicons name="checkbox-outline" size={14} color={pdfMode === 'manual' ? '#fff' : C.text} />
                  <Text style={[styles.pdfOptionText, pdfMode === 'manual' && styles.pdfOptionTextActive]}>
                    {t('plansScreen.pdf.manualSelection')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {pdfScope === 'global' && (
              <View>
                <Text style={styles.globalReportDesc}>
                  {t('plansScreen.pdf.globalReportDesc')}
                </Text>
                <View style={styles.pdfPickerWrap}>
                  <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
                  {/* All companies option */}
                  <TouchableOpacity
                    style={[styles.pdfPickRow, globalReportCompany === null && styles.pdfPickRowActive]}
                    onPress={() => setGlobalReportCompany(null)}
                  >
                    <View style={[styles.pdfRadio, globalReportCompany === null && styles.pdfRadioActive]}>
                      {globalReportCompany === null && <View style={styles.pdfRadioDot} />}
                    </View>
                    <Text style={[styles.pdfPickRowText, globalReportCompany === null && styles.pdfPickRowTextActive]}>
                      {t('plansScreen.pdf.allCompanies')}
                    </Text>
                    <Text style={styles.pdfPickRowCount}>{chantierReserves.length}</Text>
                  </TouchableOpacity>
                  {globalReportCompanies.map(c => {
                    const active = globalReportCompany === c.key;
                    return (
                      <TouchableOpacity
                        key={c.key}
                        style={[styles.pdfPickRow, active && styles.pdfPickRowActive]}
                        onPress={() => setGlobalReportCompany(c.key)}
                      >
                        <View style={[styles.pdfRadio, active && styles.pdfRadioActive]}>
                          {active && <View style={styles.pdfRadioDot} />}
                        </View>
                        <Text style={[styles.pdfPickRowText, active && styles.pdfPickRowTextActive]} numberOfLines={1}>
                          {c.label}
                        </Text>
                        <Text style={styles.pdfPickRowCount}>{c.count}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {globalReportCompanies.length === 0 && (
                    <Text style={styles.pdfEmptyHint}>{t('plansScreen.pdf.noReserveOnChantier')}</Text>
                  )}
                  </ScrollView>
                </View>

                {/* Status filter chips */}
                {(() => {
                  const STATUS_OPTIONS = [
                    { key: 'open',         label: getStatusLabel('open'),         color: RESERVE_STATUS_COLORS.open },
                    { key: 'in_progress',  label: getStatusLabel('in_progress'),  color: RESERVE_STATUS_COLORS.in_progress },
                    { key: 'waiting',      label: getStatusLabel('waiting'),      color: RESERVE_STATUS_COLORS.waiting },
                    { key: 'verification', label: getStatusLabel('verification'), color: RESERVE_STATUS_COLORS.verification },
                    { key: 'closed',       label: getStatusLabel('closed'),       color: RESERVE_STATUS_COLORS.closed },
                  ];
                  const allSelected = globalReportStatusFilter.size === 0;
                  const toggleStatus = (key: string) => {
                    setGlobalReportStatusFilter(prev => {
                      const next = new Set(prev);
                      if (next.has(key)) { next.delete(key); } else { next.add(key); }
                      return next;
                    });
                  };
                  return (
                    <View style={{ marginTop: 12 }}>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>
                        {t('plansScreen.pdf.filterByStatus')}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => setGlobalReportStatusFilter(new Set())}
                          style={{
                            paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
                            backgroundColor: allSelected ? C.primary : '#F1F5F9',
                            borderWidth: 1, borderColor: allSelected ? C.primary : '#E2E8F0',
                          }}
                        >
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: allSelected ? '#fff' : C.textSub }}>
                            {t('plansUi.all')}
                          </Text>
                        </TouchableOpacity>
                        {STATUS_OPTIONS.map(s => {
                          const active = globalReportStatusFilter.has(s.key);
                          return (
                            <TouchableOpacity
                              key={s.key}
                              onPress={() => toggleStatus(s.key)}
                              style={{
                                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
                                backgroundColor: active ? s.color : '#F1F5F9',
                                borderWidth: 1, borderColor: active ? s.color : '#E2E8F0',
                              }}
                            >
                              <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: active ? '#fff' : C.textSub }}>
                                {s.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                })()}
              </View>
            )}

            {pdfScope === 'plan' && pdfMode === 'company_single' && (
              <View style={styles.pdfPickerWrap}>
                <ScrollView>
                  {pdfGroupedByCompany.length === 0 && (
                    <Text style={styles.pdfEmptyHint}>{t('plansUi.noReserveOnPlan')}</Text>
                  )}
                  {pdfGroupedByCompany.map(g => {
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
                          {g.title}
                        </Text>
                        <Text style={styles.pdfPickRowCount}>{g.data.length}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {pdfScope === 'plan' && pdfMode === 'company_multi' && (
              <View style={styles.pdfPickerWrap}>
                <View style={styles.pdfPickActions}>
                  <TouchableOpacity
                    style={styles.pdfPickActionBtn}
                    onPress={() => setPdfCompaniesMulti(new Set(pdfGroupedByCompany.map(g => g.key)))}
                  >
                    <Text style={styles.pdfPickActionBtnText}>{t('plansScreen.pdf.all')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pdfPickActionBtn}
                    onPress={() => setPdfCompaniesMulti(new Set())}
                  >
                    <Text style={styles.pdfPickActionBtnText}>{t('sharedPicker.none')}</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView>
                  {pdfGroupedByCompany.length === 0 && (
                    <Text style={styles.pdfEmptyHint}>{t('plansUi.noReserveOnPlan')}</Text>
                  )}
                  {pdfGroupedByCompany.map(g => {
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
                        <Text style={styles.pdfPickRowText} numberOfLines={1}>{g.title}</Text>
                        <Text style={styles.pdfPickRowCount}>{g.data.length}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {pdfScope === 'plan' && pdfMode === 'manual' && (
              <View style={styles.pdfPickerWrap}>
                <View style={styles.pdfPickActions}>
                  <TouchableOpacity
                    style={styles.pdfPickActionBtn}
                    onPress={() => setPdfManualSelection(new Set(planReserves.map(r => r.id)))}
                  >
                    <Text style={styles.pdfPickActionBtnText}>{t('plansScreen.pdf.all')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pdfPickActionBtn}
                    onPress={() => setPdfManualSelection(new Set())}
                  >
                    <Text style={styles.pdfPickActionBtnText}>{t('sharedPicker.none')}</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView>
                  {planReserves.length === 0 && (
                    <Text style={styles.pdfEmptyHint}>{t('plansUi.noReserveOnPlan')}</Text>
                  )}
                  {planReserves.map(r => {
                    const checked = pdfManualSelection.has(r.id);
                    const num = pinNumberMap.get(r.id);
                    return (
                      <TouchableOpacity
                        key={r.id}
                        style={styles.pdfPickRow}
                        onPress={() => {
                          setPdfManualSelection(prev => {
                            const next = new Set(prev);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          });
                        }}
                      >
                        <View style={[styles.pdfCheckbox, checked && styles.pdfCheckboxChecked]}>
                          {checked && <Ionicons name="checkmark" size={12} color="#fff" />}
                        </View>
                        <View style={[styles.pdfPinBadge, { backgroundColor: getReservePinColor(r, companies) }]}>
                          <Text style={styles.pdfPinBadgeText}>{num ?? '—'}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pdfPickRowText} numberOfLines={1}>{r.title}</Text>
                          <Text style={styles.pdfPickRowSub} numberOfLines={1}>
                            {getReserveCompanyLabel(r)} · {r.level || '—'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {(() => {
              const count = pdfScope === 'global' ? globalReportPreviewCount : pdfPreviewCount;
              const suffix = pdfScope === 'global'
                ? ` · ${commonPlanText(chantierPlans.length)}`
                : '';
              const statusHint = pdfScope === 'global' && globalReportStatusFilter.size > 0
                ? ` (${t(globalReportStatusFilter.size === 1 ? 'plansScreen.pdf.statusSelected_one' : 'plansScreen.pdf.statusSelected_other', { count: globalReportStatusFilter.size })})`
                : '';
              return (
                <Text style={styles.pdfPreview}>
                  {t(count === 1 ? 'plansScreen.pdf.preview_one' : 'plansScreen.pdf.preview_other', { count })}{suffix}{statusHint}.
                </Text>
              );
            })()}

            <View style={styles.pdfModalActions}>
              {(() => {
                const count = pdfScope === 'global' ? globalReportPreviewCount : pdfPreviewCount;
                const disabled = pdfLoading || count === 0;
                return (
                  <>
                    <TouchableOpacity
                      style={[styles.pdfDownloadBtn, disabled && { opacity: 0.5 }]}
                      onPress={() => { void handleConfirmPdfExport('print'); }}
                      disabled={disabled}
                    >
                      <Ionicons name="download-outline" size={15} color={C.primary} />
                      <Text style={styles.pdfDownloadBtnText}>{t('plansScreen.pdf.download')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pdfConfirmBtn, disabled && { opacity: 0.5 }]}
                      onPress={() => { void handleConfirmPdfExport('share'); }}
                      disabled={disabled}
                    >
                      {pdfLoading
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Ionicons name="share-social-outline" size={15} color="#fff" />}
                      <Text style={styles.pdfConfirmBtnText}>{t('plansScreen.pdf.share')}</Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
            </View>

            {pdfScope === 'global' && (
              <View style={{ marginTop: 14 }}>
                <View style={{ height: 1, backgroundColor: C.border, marginBottom: 14 }} />
                <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6 }}>
                  {t('plansScreen.pdf.sendByEmail')}
                </Text>
                <TextInput
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    fontSize: 13,
                    fontFamily: 'Inter_400Regular',
                    color: C.text,
                    backgroundColor: C.surface,
                    marginBottom: 8,
                  }}
                  placeholder="chef@entreprise.fr, direction@chantier.fr"
                  placeholderTextColor={C.textMuted}
                  value={globalReportEmailTo}
                  onChangeText={setGlobalReportEmailTo}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={{ fontSize: 10, color: C.textMuted, fontFamily: 'Inter_400Regular', marginBottom: 10 }}>
                  {t('plansScreen.pdf.emailHint')}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.pdfConfirmBtn,
                    { backgroundColor: '#0f766e' },
                    (globalReportEmailLoading || globalReportPreviewCount === 0 || !globalReportEmailTo.trim()) && { opacity: 0.4 },
                  ]}
                  onPress={() => { void handleEmailReport(); }}
                  disabled={globalReportEmailLoading || globalReportPreviewCount === 0 || !globalReportEmailTo.trim()}
                >
                  {globalReportEmailLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="mail-outline" size={15} color="#fff" />}
                  <Text style={styles.pdfConfirmBtnText}>
                    {globalReportEmailLoading ? t('plansScreen.pdf.generating') : t('plansScreen.pdf.sendByEmail')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {pdfLoading && pdfScope === 'global' && (
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
                {globalReportProgress && globalReportProgress.total > 0 ? (
                  <>
                    <Text style={{ fontSize: 11, color: C.textSub, fontFamily: 'Inter_500Medium', marginBottom: 6 }}>
                      {t('plansScreen.pdf.renderingPlan', { current: globalReportProgress.current, total: globalReportProgress.total })}
                    </Text>
                    <View style={{ width: '100%', height: 4, backgroundColor: '#E8F0FE', borderRadius: 4, overflow: 'hidden' }}>
                      <View style={{
                        height: 4,
                        borderRadius: 4,
                        backgroundColor: C.primary,
                        width: `${Math.round((globalReportProgress.current / globalReportProgress.total) * 100)}%`,
                      }} />
                    </View>
                    <Text style={{ fontSize: 10, color: C.textMuted, fontFamily: 'Inter_400Regular', marginTop: 4 }} numberOfLines={1}>
                      {globalReportProgress.planName}
                    </Text>
                  </>
                ) : (
                  <Text style={{ fontSize: 11, color: C.textSub, fontFamily: 'Inter_400Regular' }}>
                    {t('plansScreen.pdf.preparingReport')}
                  </Text>
                )}
              </View>
            )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Mobile reserve popup with status buttons */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelected(null)}>
          {selected && (
            <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <View style={[styles.modalPin, { backgroundColor: getReservePinColor(selected, companies) }]}>
                  <Text style={styles.modalPinText}>{pinNumberMap.get(selected.id) ?? '#'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle} numberOfLines={2}>{selected.title}</Text>
                  <Text style={styles.modalMeta}>{getReserveCompanyLabel(selected)} · {selected.level || '—'}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelected(null)} accessibilityLabel={t('common.close')}>
                  <Ionicons name="close" size={20} color={C.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalDesc} numberOfLines={3}>{getReserveDescriptionText(selected.description, selected.title)}</Text>
              <View style={styles.modalBadges}>
                <PriorityBadge priority={selected.priority} small />
                {selected.deadline && selected.deadline !== '—' && (
                  <View style={styles.deadlineBadge}>
                    <Ionicons name="calendar-outline" size={11} color={C.textMuted} />
                    <Text style={styles.deadlineText}>{selected.deadline}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.tabletDetailSectionLabel}>{t('plansScreen.changeStatus')}</Text>
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
                      accessibilityLabel={t('plansScreen.a11y.changeToStatus', { status: getStatusLabel(s) })}
                    >
                      {isActive && <Ionicons name="checkmark" size={11} color="#fff" />}
                      <Text style={[styles.tabletStatusBtnText, { color: isActive ? '#fff' : cfg.color }]}>{getStatusLabel(s)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.modalActionStack}>
                {(() => {
                  const hasPin = !!selected.planId && selected.planX != null && selected.planY != null;
                  return (
                    <TouchableOpacity
                      style={[styles.modalPlanBtn, !hasPin && styles.modalPlanBtnDisabled]}
                      onPress={() => focusReserveOnPlanFromModal(selected)}
                      disabled={!hasPin}
                      accessibilityLabel={hasPin ? t('plansScreen.reserveModal.viewOnPlanA11y') : t('plansScreen.reserveModal.noPinA11y')}
                    >
                      <Ionicons name={hasPin ? 'map-outline' : 'location-outline'} size={15} color={hasPin ? '#fff' : C.textMuted} />
                      <Text style={[styles.modalPlanText, !hasPin && styles.modalPlanTextDisabled]}>
                        {hasPin ? t('plansScreen.reserveModal.viewOnPlan') : t('plansScreen.reserveModal.noPin')}
                      </Text>
                    </TouchableOpacity>
                  );
                })()}
                <TouchableOpacity style={styles.modalOpenBtn} onPress={() => { setSelected(null); router.push(`/reserve/${selected.id}` as any); }} accessibilityLabel={t('plansScreen.reserveModal.openA11y')}>
                  <Text style={styles.modalOpenText}>{t('plansScreen.reserveModal.open')}</Text>
                  <Ionicons name="arrow-forward" size={14} color={C.primary} />
                </TouchableOpacity>
              </View>
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
                  <Text style={styles.modalTitle}>{t('plansScreen.qr.title')}</Text>
                  <Text style={styles.modalMeta}>{currentPlan.name}</Text>
                </View>
                <TouchableOpacity onPress={() => setShowQRModal(null)}><Ionicons name="close" size={20} color={C.textMuted} /></TouchableOpacity>
              </View>
              <View style={styles.qrModalBody}>
                <QRCodeDisplay data={{ planId: currentPlan.id, planName: currentPlan.name, building: activeChantier?.name, x: showQRModal.x, y: showQRModal.y }} size={180} />
              </View>
              <Text style={styles.qrModalHint}>{t('plansScreen.qr.hint')}</Text>
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
              <View style={{ flex: 1 }}><Text style={styles.modalTitle}>{t('plansScreen.revisionModal.title')}</Text><Text style={styles.modalMeta}>{t('plansScreen.pdf.planMeta', { name: currentPlan?.name })}</Text></View>
              <TouchableOpacity onPress={() => setRevisionModal(p => ({ ...p, visible: false }))}><Ionicons name="close" size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <View style={styles.newPlanField}>
              <Text style={styles.newPlanLabel}>{t('plansScreen.revisionModal.codeLabel')}</Text>
              <TextInput style={styles.newPlanInput} placeholder={t('plansScreen.revisionModal.codePlaceholder')} placeholderTextColor={C.textMuted} value={revisionModal.code} onChangeText={v => setRevisionModal(p => ({ ...p, code: v }))} autoCapitalize="characters" />
            </View>
            <View style={styles.newPlanField}>
              <Text style={styles.newPlanLabel}>{t('plansScreen.revisionModal.noteLabel')}</Text>
              <TextInput style={[styles.newPlanInput, { height: 72, textAlignVertical: 'top' }]} placeholder={t('plansScreen.revisionModal.notePlaceholder')} placeholderTextColor={C.textMuted} value={revisionModal.note} onChangeText={v => setRevisionModal(p => ({ ...p, note: v }))} multiline numberOfLines={3} />
            </View>
            <View style={[styles.newPlanField, { backgroundColor: '#F5F3FF', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#DDD6FE' }]}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: '#5B21B6' }}>{t('plansScreen.revisionModal.pinnedHint')}</Text>
            </View>
            <View style={styles.newPlanBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setRevisionModal(p => ({ ...p, visible: false }))}><Text style={styles.cancelBtnText}>{t('common.cancel')}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, !revisionModal.code.trim() && { opacity: 0.5 }]} onPress={handleCreateRevision} disabled={!revisionModal.code.trim()}>
                <Ionicons name="cloud-upload-outline" size={15} color="#fff" />
                <Text style={styles.confirmBtnText}>{t('plansScreen.actions.importFile')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* New plan modal */}
      <Modal visible={newPlanModal.visible} transparent animationType="fade" onRequestClose={() => setNewPlanModal({ visible: false, name: '', building: '', level: '' })}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setNewPlanModal({ visible: false, name: '', building: '', level: '' })}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalCard, { marginBottom: kbHeight }]} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalPin, { backgroundColor: C.primary }]}><Ionicons name="map-outline" size={14} color="#fff" /></View>
              <View style={{ flex: 1 }}><Text style={styles.modalTitle}>{t('plansScreen.newPlan.title')}</Text><Text style={styles.modalMeta}>{t('plansScreen.newPlan.subtitle')}</Text></View>
              <TouchableOpacity onPress={() => setNewPlanModal({ visible: false, name: '', building: '', level: '' })}><Ionicons name="close" size={20} color={C.textMuted} /></TouchableOpacity>
            </View>

            {/* Import en premier — B1 */}
            {newPlanModal.uri ? (
              <View style={styles.newPlanFileChip}>
                <View style={styles.newPlanFileChipIcon}>
                  <Ionicons
                    name={newPlanModal.fileType === 'pdf' ? 'document-text-outline' : newPlanModal.fileType === 'dxf' ? 'cube-outline' : 'image-outline'}
                    size={18} color={C.closed}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.newPlanFileChipName}>
                    {newPlanModal.fileType === 'pdf' ? 'PDF' : newPlanModal.fileType === 'dxf' ? 'DXF' : t('plansScreen.fileTypes.image')} {t('plansScreen.newPlan.imported')}{newPlanModal.size ? ` · ${newPlanModal.size}` : ''}
                  </Text>
                  <Text style={styles.newPlanFileChipSub}>{t('plansScreen.newPlan.tapToChange')}</Text>
                </View>
                <TouchableOpacity onPress={importFileForNewPlan}>
                  <Ionicons name="swap-horizontal-outline" size={18} color={C.textMuted} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.newPlanImportBtn} onPress={importFileForNewPlan} disabled={!!newPlanModal.uploading}>
                {newPlanModal.uploading ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={22} color={C.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.newPlanImportBtnText}>{t('plansScreen.newPlan.importTypes')}</Text>
                      <Text style={styles.newPlanImportBtnSub}>{t('plansScreen.newPlan.importRequiredHint')}</Text>
                    </View>
                    <View style={styles.newPlanImportRequired}><Text style={styles.newPlanImportRequiredText}>{t('plansScreen.newPlan.required')}</Text></View>
                  </>
                )}
              </TouchableOpacity>
            )}

            <View style={styles.newPlanField}>
              <Text style={styles.newPlanLabel}>{t('plansScreen.newPlan.nameLabel')}</Text>
              <TextInput style={styles.newPlanInput} placeholder={t('plansScreen.newPlan.namePlaceholder')} placeholderTextColor={C.textMuted} value={newPlanModal.name} onChangeText={v => setNewPlanModal(p => ({ ...p, name: v }))} />
            </View>

            {chantierHierarchyBuildings.length > 0 ? (
              <>
                <View style={styles.newPlanField}>
                  <Text style={styles.newPlanLabel}>{t('plansUi.building')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                      {chantierHierarchyBuildings.map(b => (
                        <TouchableOpacity
                          key={b.id}
                          style={[styles.newPlanChip, newPlanModal.building === b.name && styles.newPlanChipActive]}
                          onPress={() => setNewPlanModal(p => ({ ...p, building: b.name, buildingId: b.id, level: '', levelId: undefined }))}
                        >
                          <Text style={[styles.newPlanChipText, newPlanModal.building === b.name && styles.newPlanChipTextActive]}>{b.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
                {levelsForNewPlanBuilding.length > 0 && (
                  <View style={styles.newPlanField}>
                    <Text style={styles.newPlanLabel}>{t('plansUi.planLevel')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                        {levelsForNewPlanBuilding.map(l => (
                          <TouchableOpacity
                            key={l.id}
                            style={[styles.newPlanChip, newPlanModal.level === l.name && styles.newPlanChipActive]}
                            onPress={() => setNewPlanModal(p => ({ ...p, level: l.name, levelId: l.id }))}
                          >
                            <Text style={[styles.newPlanChipText, newPlanModal.level === l.name && styles.newPlanChipTextActive]}>{l.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.newPlanRow}>
                <View style={[styles.newPlanField, { flex: 1 }]}>
                  <Text style={styles.newPlanLabel}>{t('plansUi.building')}</Text>
                  <TextInput style={styles.newPlanInput} placeholder={t('plansScreen.newPlan.buildingPlaceholder')} placeholderTextColor={C.textMuted} value={newPlanModal.building} onChangeText={v => setNewPlanModal(p => ({ ...p, building: v }))} />
                </View>
                <View style={[styles.newPlanField, { flex: 1 }]}>
                  <Text style={styles.newPlanLabel}>{t('plansUi.planLevel')}</Text>
                  <TextInput style={styles.newPlanInput} placeholder={t('plansScreen.newPlan.levelPlaceholder')} placeholderTextColor={C.textMuted} value={newPlanModal.level} onChangeText={v => setNewPlanModal(p => ({ ...p, level: v }))} />
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.modalOpenBtn, (!newPlanModal.name.trim() || !newPlanModal.uri) && { opacity: 0.5 }]}
              onPress={handleConfirmNewPlan}
              disabled={!newPlanModal.name.trim() || !newPlanModal.uri || !!newPlanModal.uploading}
            >
              <Ionicons name="add-circle-outline" size={16} color={C.primary} />
              <Text style={styles.modalOpenText}>{t('plansScreen.actions.createPlan')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Building picker sheet (récents + recherche dans tous les bâtiments) */}
      <BuildingPickerSheet
        visible={buildingPickerOpen}
        onClose={() => setBuildingPickerOpen(false)}
        buildings={buildingItems}
        selectedId={selectedBuilding}
        recentIds={recentBuildingIds}
        onSelect={handleSelectBuilding}
        hasOrphanPlans={hasOrphanPlans}
        onSelectOrphans={handleSelectOrphanPlans}
        orphansSelected={selectedBuilding === '__none__'}
        initialFamily={activeChantierId ? recentFamilyByChantier[activeChantierId] : undefined}
        onFamilyChange={(famKey) => {
          if (!activeChantierId) return;
          setRecentFamilyByChantier(prev => {
            if (prev[activeChantierId] === famKey) return prev;
            const updated = { ...prev, [activeChantierId]: famKey };
            AsyncStorage.setItem(RECENT_FAMILY_KEY, JSON.stringify(updated)).catch(() => {});
            return updated;
          });
        }}
      />

      {/* Level picker sheet (récents + recherche pour bâtiments à plusieurs niveaux) */}
      {activeBuildingForLevels && (
        <LevelPickerSheet
          visible={levelPickerOpen}
          onClose={() => setLevelPickerOpen(false)}
          buildingName={activeBuildingForLevels.name}
          levels={levelItems}
          selectedId={selectedLevel}
          recentIds={recentLevelIds}
          onSelect={(id) => {
            setSelectedLevel(id);
            setActivePlanId(null);
          }}
        />
      )}

      {/* Filters sheet */}
      <FiltersSheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        buildings={buildings}
        selectedBuilding={selectedBuilding}
        onBuildingChange={(b) => {
          if (b === 'all') handleSelectAllBuildings();
          else if (b === '__none__') handleSelectOrphanPlans();
          else handleSelectBuilding(b);
        }}
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

      {/* Hidden PDF plan viewer — pre-renders each PDF plan page to JPEG for the
          global report on native. On web, PDF.js in preRenderPdfPageToDataUrl()
          handles this directly without needing a mounted WebView component. */}
      {Platform.OS !== 'web' && preRenderState !== null && (
        <View style={{ position: 'absolute', left: -9999, width: 720, height: 540, opacity: 0, pointerEvents: 'none' }}>
          <PdfPlanViewer
            ref={preRenderRef}
            planUri={preRenderState.uri}
            planId={preRenderState.planId}
            isImagePlan={false}
            reserves={[]}
            ghostReserves={[]}
            pinNumberMap={new Map()}
            annotations={[]}
            onPlanTap={() => {}}
            onReserveSelect={() => {}}
            onAnnotationsChange={() => {}}
            onReady={onPreRenderReady}
            companies={[]}
            canAnnotate={false}
            canCreate={false}
          />
        </View>
      )}
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

  hierarchyRow: { paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border + '60' },
  hierarchyRowLevel: { paddingVertical: 8, paddingHorizontal: 0, borderBottomWidth: 1, borderBottomColor: C.border + '60' },
  hierarchyChips: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  hierarchyChipsLevel: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 2 },
  hierarchyChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  hierarchyChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  hierarchyChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  hierarchyChipTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  hierarchyChipBadge: {
    minWidth: 16, height: 16, paddingHorizontal: 4, marginLeft: 2,
    borderRadius: 8, backgroundColor: C.open,
    alignItems: 'center', justifyContent: 'center',
  },
  hierarchyChipBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  hierarchyChipAll: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16,
    backgroundColor: C.primary,
  },
  hierarchyChipAllActive: { backgroundColor: C.primaryDark ?? C.primary },
  hierarchyChipAllText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  hierarchyChipLevel: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  hierarchyChipLevelActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  hierarchyChipLevelText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
  planTabsBar: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  planTabsRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 6 },
  planTab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, maxWidth: 155, minWidth: 60 },
  planTabActive: { backgroundColor: C.primaryBg, borderColor: C.primary + 'A0' },
  planTabThumb: { width: 20, height: 16, borderRadius: 3, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  planTabSyncDot: { position: 'absolute', top: 2, left: 16, width: 12, height: 12, borderRadius: 6, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#fff' },
  planTabThumbImg: { width: 20, height: 16 },
  planTabText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, flex: 1, minWidth: 0 },
  planTabTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  planTabLevelBadge: { fontSize: 9, fontFamily: 'Inter_500Medium', color: C.textMuted, backgroundColor: C.surface, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, overflow: 'hidden', flexShrink: 0 },
  planTabBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8, backgroundColor: C.border, minWidth: 17, alignItems: 'center', flexShrink: 0 },
  planTabBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.textSub },
  planTabsEmpty: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingVertical: 6 },
  planTabsEmptyText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic' },

  planActions: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12 },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  importBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  addPlanBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },

  versionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surface2, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9, borderWidth: 1, borderColor: C.border },
  versionBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary + '60' },
  versionBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub },
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
  buildingRail: {
    width: 260,
    flexShrink: 0,
    backgroundColor: C.surface,
    borderRightWidth: 1,
    borderRightColor: C.border,
  },
  buildingRailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  buildingRailTitle: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: C.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  buildingRailSubtitle: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
    marginTop: 2,
  },
  buildingRailPickerBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: C.primaryBg,
    borderWidth: 1,
    borderColor: C.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buildingRailSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 10,
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 11,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  buildingRailSearchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.text,
  },
  buildingRailAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 10,
    borderRadius: 13,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  buildingRailList: { flex: 1 },
  buildingRailListContent: { paddingHorizontal: 10, paddingBottom: 18, gap: 6 },
  buildingRailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 13,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  buildingRailRowActive: { backgroundColor: C.primaryBg, borderColor: C.primary + '70' },
  buildingRailIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  buildingRailIconActive: { backgroundColor: C.primary, borderColor: C.primary },
  buildingRailTextWrap: { flex: 1, minWidth: 0 },
  buildingRailName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.text, lineHeight: 16 },
  buildingRailNameActive: { color: C.primary },
  buildingRailMeta: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  buildingRailBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buildingRailBadgeActive: { backgroundColor: C.primary, borderColor: C.primary },
  buildingRailBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.textSub },
  buildingRailBadgeTextActive: { color: '#fff' },
  buildingRailEmpty: { alignItems: 'center', gap: 8, paddingVertical: 22, paddingHorizontal: 10 },
  buildingRailEmptyText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
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

  planTitleRow: { flexDirection: 'column', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  planTitleTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, overflow: 'hidden' as any },
  planActionsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  planTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  planSubtitle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  pinSizeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: 8 },
  pinSizeBtn: { padding: 4 },
  removePlanBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  removePlanText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
  importHintBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 10, marginBottom: 0, backgroundColor: C.primaryBg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.primary + '30' },
  importHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, lineHeight: 16 },

  hintOverlay: { position: 'absolute', bottom: 64, left: 0, right: 0, alignItems: 'center', zIndex: 10, pointerEvents: 'box-none' as any },
  hintBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(15,17,23,0.85)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: C.border },
  hintText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, flex: 1 },

  zoomOverlay: { position: 'absolute', bottom: 12, left: 12, zIndex: 20, pointerEvents: 'box-none' as any },
  zoomOverlayGroup: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(15,17,23,0.82)', borderRadius: 10, paddingHorizontal: 4, paddingVertical: 4, borderWidth: 1, borderColor: C.border },
  zoomOverlayBtn: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  zoomOverlayPct: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textMuted, minWidth: 34, textAlign: 'center' },

  fullscreenBtn: { position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 30, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },

  miniMap: { position: 'absolute', top: 10, left: 10, zIndex: 10, pointerEvents: 'none' as any },
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

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', padding: 16, alignItems: 'center' },
  modalCard: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12, maxHeight: '90%', width: '100%', maxWidth: 560 },
  modalHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  modalPin: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  modalPinText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  modalTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  modalMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  modalDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18 },
  modalBadges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  deadlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: C.surface2, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  deadlineText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  modalActionStack: { gap: 8, marginTop: 2 },
  modalPlanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, backgroundColor: C.primary, borderRadius: 12, borderWidth: 1, borderColor: C.primary },
  modalPlanBtnDisabled: { backgroundColor: C.surface2, borderColor: C.border },
  modalPlanText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  modalPlanTextDisabled: { color: C.textMuted },
  modalOpenBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, backgroundColor: C.primaryBg, borderRadius: 12, borderWidth: 1, borderColor: C.primary + '40' },
  modalOpenText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  qrModalCard: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12, maxHeight: '80%', width: '100%', maxWidth: 400 },
  qrModalIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.primary + '30' },
  qrModalBody: { alignItems: 'center', paddingVertical: 8 },
  qrModalHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', lineHeight: 17 },

  emptyState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  emptyIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '25',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  emptyFeatures: { width: '100%', gap: 0, marginVertical: 8, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  emptyFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  emptyFeatureDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  emptyFeatureTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 2 },
  emptyFeatureDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 17 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14, marginTop: 4 },
  emptyBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  newPlanField: { gap: 6 },
  newPlanRow: { flexDirection: 'row', gap: 10 },
  newPlanLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  newPlanInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, backgroundColor: C.surface2 },
  newPlanChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2 },
  newPlanChipActive: { borderColor: C.primary, backgroundColor: C.primary + '15' },
  newPlanChipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  newPlanChipTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  newPlanBtns: { flexDirection: 'row', gap: 10 },
  newPlanImportBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: C.primary + '50', backgroundColor: C.primaryBg },
  newPlanImportBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  newPlanImportBtnSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.primary + 'AA', marginTop: 2 },
  newPlanImportRequired: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: C.open + '15', borderWidth: 1, borderColor: C.open + '35' },
  newPlanImportRequiredText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.open },
  newPlanFileChip: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: C.closedBg, borderWidth: 1.5, borderColor: C.closed + '40' },
  newPlanFileChipIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.closed + '25', alignItems: 'center', justifyContent: 'center' },
  newPlanFileChipName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.closed },
  newPlanFileChipSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.closed + 'AA', marginTop: 1 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  confirmBtn: { flex: 2, flexDirection: 'row', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  structureHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 19, marginBottom: 16, textAlign: 'center' },
  structureHeaderAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  structureHeaderAddText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  structureBuilding: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, marginBottom: 12, overflow: 'hidden' },
  structureBuildingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: C.surface2, borderBottomWidth: 1, borderBottomColor: C.border },
  structureBuildingName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, flex: 1 },
  structureLevelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border + '80' },
  structureLevelName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub, flex: 1 },
  structureLevelAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  structureLevelAddText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

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
  pdfPickRowSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  pdfPickRowCount: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: C.surface, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  pdfRadio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  pdfRadioActive: { borderColor: C.primary },
  pdfRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  pdfCheckbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  pdfCheckboxChecked: { backgroundColor: C.primary, borderColor: C.primary },
  pdfPinBadge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pdfPinBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  pdfEmptyHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', padding: 16 },
  pdfPreview: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, textAlign: 'center' },
  pdfModalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  pdfCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  pdfCancelBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  pdfDownloadBtn: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: C.primary, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pdfDownloadBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  pdfConfirmBtn: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  pdfConfirmBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  // Scope toggle (Ce plan / Rapport global)
  pdfScopeRow: { flexDirection: 'row', gap: 8, padding: 4, backgroundColor: C.surface2, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  pdfScopeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 9 },
  pdfScopeBtnActive: { backgroundColor: C.primary, shadowColor: C.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 },
  pdfScopeBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textMuted },
  pdfScopeBtnTextActive: { color: '#fff', fontFamily: 'Inter_600SemiBold' },
  // Global report description text
  globalReportDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17, paddingHorizontal: 2, paddingBottom: 6 },
});
