import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, Image, Modal, ActivityIndicator, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo, useRef, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { Reserve, ReservePriority, ReserveStatus, ReservePhoto, SitePlan } from '@/constants/types';
import {
  loadPhotoAsDataUrl,
  loadFileAsDataUrl,
  exportPDF as exportPDFHelper,
  buildPhotoGrid,
  PDF_BASE_CSS,
  PDF_MUTED,
  PDF_BRAND_COLOR,
  svgStringToDataUrl,
  preRenderPdfPageToDataUrl,
} from '@/lib/pdfBase';
import PdfPlanViewer, { type PdfPlanViewerHandle } from '@/components/PdfPlanViewer';
import StatusBadge, { STATUS_CONFIG } from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { uploadPhoto } from '@/lib/storage';
import { isSupabaseConfigured } from '@/lib/supabase';
import { genId, formatDateFR } from '@/lib/utils';
import {
  RESERVE_BUILDINGS, RESERVE_ZONES, RESERVE_LEVELS, RESERVE_PRIORITIES,
  isOverdue, formatDate, validateDeadline,
} from '@/lib/reserveUtils';
import SignaturePad, { SignaturePadRef } from '@/components/SignaturePad';
import { PhotoAnnotationOverlay } from '@/components/PhotoAnnotator';

const STATUS_ORDER: ReserveStatus[] = ['open', 'in_progress', 'waiting', 'verification', 'closed'];

const PRIORITY_LABEL = Object.fromEntries(
  RESERVE_PRIORITIES.map(p => [p.value, p.label])
) as Record<ReservePriority, string>;

function ChipSelect<T extends string>({
  options, value, onChange, colorFn, labelMap,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  colorFn?: (v: T) => string;
  labelMap?: Partial<Record<T, string>>;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
      <View style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
        {options.map(opt => {
          const col = colorFn ? colorFn(opt) : C.primary;
          const active = value === opt;
          return (
            <TouchableOpacity
              key={opt}
              style={[mStyles.chip, active && { borderColor: col, backgroundColor: col + '20' }]}
              onPress={() => onChange(opt)}
            >
              <Text style={[mStyles.chipText, active && { color: col }]}>
                {labelMap?.[opt] ?? opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

const PRIORITY_COLORS: Record<string, string> = {
  low: '#22C55E', medium: '#F59E0B', high: '#F97316', critical: '#EF4444',
};

interface PlanData {
  planUri: string;
  fileType: 'pdf' | 'image' | 'dxf' | undefined;
  planX: number;
  planY: number;
  planName: string;
  preRenderedDataUrl?: string;
}

function buildReservePDF(
  reserve: Reserve,
  projectName: string,
  company: { color?: string } | undefined,
  resolvedPhotoSrcs?: string[],
  planData?: PlanData,
  pinNum: number = 1,
): string {
  const statusColors: Record<string, string> = {
    open: '#DC2626', in_progress: '#F59E0B', waiting: '#3B82F6',
    verification: '#8B5CF6', closed: '#059669',
  };
  const statusLabels: Record<string, string> = {
    open: 'Ouverte', in_progress: 'En cours', waiting: 'En attente',
    verification: 'Vérification', closed: 'Clôturée',
  };
  const priorityLabels: Record<string, string> = {
    low: 'Faible', medium: 'Moyenne', high: 'Haute', critical: 'Critique',
  };
  const priorityColors: Record<string, string> = {
    low: '#22C55E', medium: '#F59E0B', high: '#F97316', critical: '#EF4444',
  };

  const sColor = statusColors[reserve.status] ?? '#6B7280';
  const sLabel = statusLabels[reserve.status] ?? reserve.status;
  const pColor = priorityColors[reserve.priority] ?? '#6B7280';
  const pLabel = priorityLabels[reserve.priority] ?? reserve.priority;
  const pinColor = company?.color ?? '#003082';

  const rawPhotos = reserve.photos && reserve.photos.length > 0
    ? reserve.photos
    : reserve.photoUri
      ? [{ id: 'legacy', uri: reserve.photoUri, kind: 'defect' as const, takenAt: reserve.createdAt, takenBy: '' }]
      : [];

  const MAX_PHOTOS = 3;
  const photosToShow = rawPhotos.slice(0, MAX_PHOTOS);
  const photoRowHtml = photosToShow.length > 0
    ? `<div style="margin-top:10px">
        <div style="font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #DDE4EE">
          Photos (${photosToShow.length}${rawPhotos.length > MAX_PHOTOS ? ` sur ${rawPhotos.length}` : ''})
        </div>
        <div style="display:flex;gap:8px;flex-wrap:nowrap">
          ${photosToShow.map((p, i) => {
            const src = resolvedPhotoSrcs?.[i] ?? p.uri;
            const isDefect = p.kind === 'defect';
            return `<div style="flex:1;min-width:0;text-align:center">
              <img src="${src}" onerror="this.style.opacity='0.15'"
                style="width:100%;height:110px;object-fit:cover;border-radius:6px;border:1.5px solid #DDE4EE;display:block" />
              <span style="display:inline-block;margin-top:4px;padding:1px 7px;border-radius:8px;font-size:9px;font-weight:700;
                background:${isDefect ? '#FEF2F2' : '#ECFDF5'};color:${isDefect ? '#DC2626' : '#059669'}">
                ${isDefect ? '● Constat' : '● Levée'}
              </span>
            </div>`;
          }).join('')}
        </div>
      </div>`
    : '';

  const PLAN_RENDER_W = 520;
  const PIN_R = 12;
  const PIN_FONT = 10;

  // ── Plan section: use static <img> + SVG pin overlay when possible ────────
  // This avoids the async timing bug where Print.printAsync captures the page
  // before the canvas+pdfjs script finishes rendering (leaving a black box).
  // Strategy:
  //   • Image plans  → planUri is already a data URL → <img> synchronous, always works
  //   • PDF plans with preRenderedDataUrl → pre-rendered JPEG → <img> synchronous
  //   • PDF plans without preRenderedDataUrl (native fallback) → canvas + pdfjs script

  const isPdfPlan = planData?.fileType === 'pdf';
  const imgSrc = planData
    ? (planData.preRenderedDataUrl ?? (!isPdfPlan ? planData.planUri : null))
    : null;

  // SVG pin drawn over the plan image
  const svgPin = planData ? (
    `<circle cx="${planData.planX}%" cy="${planData.planY}%" r="${PIN_R}" fill="${pinColor}" stroke="#fff" stroke-width="2.5"/>` +
    `<text x="${planData.planX}%" y="${planData.planY}%" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="${PIN_FONT}" font-weight="bold" font-family="Arial,sans-serif">${pinNum}</text>`
  ) : '';

  // Fallback canvas+script (only for native PDF plans that couldn't pre-render)
  const PLAN_CANVAS_ID = 'reserve-plan-canvas';
  const planCanvasScript = (planData && isPdfPlan && !planData.preRenderedDataUrl)
    ? `(function(){
var canvas=document.getElementById('${PLAN_CANVAS_ID}');
var ctx=canvas.getContext('2d');
var planUri=${JSON.stringify(planData.planUri)};
var pctX=${planData.planX};
var pctY=${planData.planY};
var PIN_R=${PIN_R};
var PIN_FONT=${PIN_FONT};
function drawPin(W,H){
  var x=(pctX/100)*W,y=(pctY/100)*H;
  ctx.beginPath();ctx.arc(x,y,PIN_R,0,Math.PI*2);
  ctx.fillStyle='${pinColor}';ctx.fill();
  ctx.strokeStyle='#fff';ctx.lineWidth=2.5;ctx.stroke();
  ctx.fillStyle='#fff';ctx.font='bold '+PIN_FONT+'px Arial';
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('${pinNum}',x,y);
}
function drawFallback(){
  ctx.fillStyle='#1E3A5F';ctx.fillRect(0,0,canvas.width,canvas.height);
  drawPin(canvas.width,canvas.height);
}
if(!planUri){drawFallback();return;}
var s=document.createElement('script');
s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
s.onload=function(){
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var docSrc=planUri.startsWith('data:')?{data:atob(planUri.split(',')[1])}:{url:planUri,withCredentials:false};
  pdfjsLib.getDocument(docSrc).promise.then(function(doc){
    doc.getPage(1).then(function(page){
      var vp1=page.getViewport({scale:1});
      var scale=${PLAN_RENDER_W}/vp1.width;
      var vp=page.getViewport({scale:scale});
      canvas.width=Math.round(vp.width);canvas.height=Math.round(vp.height);
      page.render({canvasContext:ctx,viewport:vp}).promise.then(function(){drawPin(canvas.width,canvas.height);});
    });
  }).catch(drawFallback);
};
s.onerror=drawFallback;
document.head.appendChild(s);
})();`
    : '';

  const planSection = planData
    ? (imgSrc
      // Static <img> + SVG pin overlay — synchronous, no timing issues
      ? `<div style="position:relative;border-radius:8px;overflow:hidden;border:1.5px solid #DDE4EE">
          <img src="${imgSrc}" style="width:100%;height:auto;display:block" />
          <svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible">${svgPin}</svg>
          <div style="padding:3px 8px;background:rgba(0,0,0,0.45);font-size:9px;color:#fff;font-weight:600">
            📐 ${planData.planName} — pastille de localisation
          </div>
        </div>`
      // Fallback: canvas + async pdfjs script (native PDF, best effort)
      : `<div style="border-radius:8px;overflow:hidden;border:1.5px solid #DDE4EE;background:#1E3A5F">
          <canvas id="${PLAN_CANVAS_ID}" width="${PLAN_RENDER_W}" height="${Math.round(PLAN_RENDER_W * 0.55)}"
            style="width:100%;height:auto;display:block"></canvas>
          <div style="padding:3px 8px;background:rgba(0,0,0,0.35);font-size:9px;color:#fff;font-weight:600">
            📐 ${planData.planName} — pastille de localisation
          </div>
        </div>`)
    : `<div style="width:100%;height:140px;border-radius:8px;border:1.5px dashed #DDE4EE;background:#F9FAFB;
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
        <span style="font-size:22px">📐</span>
        <span style="font-size:10px;color:#9CA3AF">Aucun plan associé</span>
      </div>`;

  const commentsHtml = reserve.comments.length > 0
    ? reserve.comments.slice(-3).map(c =>
        `<div style="padding:6px 10px;background:#F9FAFB;border-radius:6px;margin-bottom:5px;border-left:3px solid #1A6FD8">
          <div style="font-size:9px;color:#5E738A;margin-bottom:2px"><strong>${c.author}</strong> · ${c.createdAt}</div>
          <div style="font-size:11px;color:#1A2742">${c.content}</div>
        </div>`
      ).join('')
    : '';

  const historyRows = [...reserve.history].reverse().slice(0, 5).map(h =>
    `<tr>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;white-space:nowrap">${h.createdAt}</td>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;font-weight:600">${h.action}</td>
      <td style="padding:4px 8px;font-size:10px;border-bottom:1px solid #EEF3FA;color:#6B7280">${h.author}</td>
      ${h.oldValue && h.newValue
        ? `<td style="padding:4px 8px;font-size:9px;color:#6B7280;border-bottom:1px solid #EEF3FA">${h.oldValue} → ${h.newValue}</td>`
        : '<td></td>'}
    </tr>`
  ).join('');

  const sigSection = reserve.enterpriseSignature
    ? `<div style="display:flex;gap:12px;align-items:flex-start">
        <div style="flex:1;border:1.5px solid #DDE4EE;border-radius:8px;padding:10px 14px;background:#FAFBFF">
          <div style="font-size:9px;color:#5E738A;text-transform:uppercase;letter-spacing:0.6px;font-weight:700;margin-bottom:6px">Signature de levée</div>
          <div style="font-size:10px;color:#5E738A;margin-bottom:6px">Signataire : <strong>${reserve.enterpriseSignataire ?? 'N/A'}</strong></div>
          <img src="${svgStringToDataUrl(reserve.enterpriseSignature!)}" style="width:180px;height:55px;object-fit:contain;border-bottom:2px solid #1A2742;display:block;margin-bottom:4px" />
          ${reserve.enterpriseAcknowledgedAt ? `<div style="font-size:9px;color:#059669">✓ Levée reconnue le ${reserve.enterpriseAcknowledgedAt}</div>` : ''}
        </div>
      </div>`
    : `<div style="display:flex;gap:20px">
        <div style="flex:1;text-align:center">
          <div style="height:50px;border-bottom:2px solid #1A2742;margin-bottom:5px"></div>
          <div style="font-size:10px;color:#5E738A">Conducteur de travaux</div>
        </div>
        <div style="flex:1;text-align:center">
          <div style="height:50px;border-bottom:2px solid #1A2742;margin-bottom:5px"></div>
          <div style="font-size:10px;color:#5E738A">${(reserve.companies && reserve.companies.length > 0 ? reserve.companies : reserve.company ? [reserve.company] : ['Entreprise']).join(', ')}</div>
        </div>
      </div>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <title>Fiche réserve ${reserve.id}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #1A2742; font-size: 11px; line-height: 1.4; }
    @page { size: A4 portrait; margin: 10mm 12mm; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { page-break-inside: avoid; }
    }
    .container { padding: 0; max-width: 780px; margin: 0 auto; }
    .top-bar { display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 3px solid #003082; padding-bottom: 10px; margin-bottom: 10px; }
    .badge { display: inline-block; padding: 2px 9px; border-radius: 10px; font-size: 9px; font-weight: 700; }
    .col2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
    .col3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px; }
    .info-cell { background: #F4F7FB; border-radius: 6px; padding: 7px 10px; border: 1px solid #DDE4EE; }
    .lbl { font-size: 8px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 2px; }
    .val { font-size: 11px; color: #1A2742; font-weight: 600; }
    .desc-box { background: #F4F7FB; border-radius: 6px; padding: 8px 12px; border-left: 3px solid #003082; margin-bottom: 10px; font-size: 11px; line-height: 1.5; }
    .sh { font-size: 9px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.6px;
      padding-bottom: 4px; border-bottom: 1px solid #DDE4EE; margin-bottom: 6px; margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    thead th { background: #003082; color: #fff; padding: 5px 8px; text-align: left; font-size: 9px; text-transform: uppercase; }
    tbody td { padding: 4px 8px; border-bottom: 1px solid #EEF3FA; vertical-align: top; }
    tbody tr:nth-child(even) { background: #F9FAFB; }
    .doc-footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #DDE4EE;
      display: flex; justify-content: space-between; font-size: 8px; color: #9CA3AF; }
  </style></head>
  <body><div class="container">

    <div class="top-bar">
      <div>
        <div style="font-size:8px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Fiche de réserve · BuildTrack</div>
        <div style="font-size:22px;font-weight:900;color:#003082;line-height:1">${reserve.id}</div>
        <div style="font-size:14px;font-weight:700;color:#1A2742;margin-top:2px">${reserve.title}</div>
        <div style="font-size:10px;color:#6B7280">${projectName}</div>
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap">
          <span class="badge" style="background:${sColor}22;color:${sColor}">${sLabel}</span>
          <span class="badge" style="background:${pColor}18;color:${pColor}">${pLabel}</span>
          ${reserve.kind === 'observation' ? '<span class="badge" style="background:#0EA5E915;color:#0EA5E9">Observation</span>' : ''}
        </div>
      </div>
      <div style="text-align:right;font-size:10px;color:#6B7280;flex-shrink:0;margin-left:16px">
        <div>Créé le <strong style="color:#1A2742">${reserve.createdAt}</strong></div>
        ${reserve.closedAt ? `<div style="color:#059669;margin-top:2px;font-weight:700">✓ Clôturé le ${reserve.closedAt}</div>` : ''}
        <div style="margin-top:4px">Échéance : <strong style="color:${reserve.closedAt ? '#059669' : '#DC2626'}">${reserve.deadline}</strong></div>
        <div style="font-size:9px;color:#9CA3AF;margin-top:4px">${new Date().toLocaleDateString('fr-FR')}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        <div class="col2" style="margin-bottom:8px">
          <div class="info-cell">
            <div class="lbl">Entreprise</div>
            <div class="val" style="color:${company?.color ?? '#003082'}">${reserve.company ?? '—'}</div>
          </div>
          <div class="info-cell">
            <div class="lbl">Localisation</div>
            <div class="val">Bât. ${reserve.building} · ${reserve.level}</div>
          </div>
          <div class="info-cell">
            <div class="lbl">Zone</div>
            <div class="val">${reserve.zone}</div>
          </div>
          <div class="info-cell">
            <div class="lbl">Créé par</div>
            <div class="val">${reserve.history[0]?.author ?? 'N/A'}</div>
          </div>
        </div>
        <div class="desc-box">
          <div class="lbl" style="margin-bottom:4px">Description</div>
          ${reserve.description}
        </div>
      </div>
      <div>
        <div class="lbl" style="margin-bottom:6px">Plan de localisation</div>
        ${planSection}
      </div>
    </div>

    ${photoRowHtml}

    ${reserve.comments.length > 0 || reserve.history.length > 0 ? `
    <div style="display:grid;grid-template-columns:${reserve.comments.length > 0 && reserve.history.length > 0 ? '1fr 1fr' : '1fr'};gap:10px;margin-top:10px">
      ${reserve.comments.length > 0 ? `
      <div>
        <div class="sh">Commentaires (${Math.min(reserve.comments.length, 3)})</div>
        ${commentsHtml}
      </div>` : ''}
      ${reserve.history.length > 0 ? `
      <div>
        <div class="sh">Historique (${Math.min(reserve.history.length, 5)} dernières actions)</div>
        <table>
          <thead><tr><th>Date</th><th>Action</th><th>Auteur</th><th>Détail</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>` : ''}
    </div>` : ''}

    <div class="sh" style="margin-top:10px">Signatures</div>
    ${sigSection}

    <div class="doc-footer">
      <span>Fiche réserve générée par BuildTrack — ${projectName}</span>
      <span>Document confidentiel</span>
    </div>

  </div>
  ${planCanvasScript ? `<script>${planCanvasScript}<\/script>` : ''}
  </body></html>`;
}

export default function ReserveDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { reserves, tasks, updateReserveStatus, updateReserveFields, deleteReserve, addComment, companies, channels, addPhoto, sitePlans } = useApp();
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();
  const [comment, setComment] = useState('');
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [photoFullScreen, setPhotoFullScreen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [signatureModalVisible, setSignatureModalVisible] = useState(false);
  const [signataireName, setSignataireName] = useState('');
  const sigPadRef = useRef<SignaturePadRef>(null);
  const [annotatorPhoto, setAnnotatorPhoto] = useState<ReservePhoto | null>(null);
  const [editPhotos, setEditPhotos] = useState<ReservePhoto[]>([]);
  const [editPhotoUploading, setEditPhotoUploading] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [signingForCompany, setSigningForCompany] = useState<string | null>(null);

  const planViewerRef = useRef<PdfPlanViewerHandle>(null);
  const captureResolveRef = useRef<((url: string | null) => void) | null>(null);
  const [captureViewerUri, setCaptureViewerUri] = useState<string | null>(null);
  const [captureViewerIsImage, setCaptureViewerIsImage] = useState(false);

  const onCaptureViewerReady = useCallback(() => {
    const resolve = captureResolveRef.current;
    if (!resolve) return;
    captureResolveRef.current = null;
    setTimeout(async () => {
      const url = await planViewerRef.current?.captureImageDataUrl() ?? null;
      resolve(url);
      setCaptureViewerUri(null);
    }, 400);
  }, []);

  function captureHiddenPlan(uri: string, fileType: 'pdf' | 'image' | 'dxf' | undefined): Promise<string | null> {
    return new Promise((resolve) => {
      captureResolveRef.current = resolve;
      setCaptureViewerIsImage(fileType !== 'pdf');
      setCaptureViewerUri(uri);
      setTimeout(() => {
        if (captureResolveRef.current) {
          captureResolveRef.current(null);
          captureResolveRef.current = null;
          setCaptureViewerUri(null);
        }
      }, 15000);
    });
  }

  const reserve = reserves.find(r => r.id === id);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editBuilding, setEditBuilding] = useState<string>(reserve?.building ?? RESERVE_BUILDINGS[0]);
  const [editZone, setEditZone] = useState<string>(RESERVE_ZONES[0]);
  const [editLevel, setEditLevel] = useState<string>('RDC');
  const [editCompanies, setEditCompanies] = useState<string[]>([]);
  const [editPriority, setEditPriority] = useState<ReservePriority>('medium');
  const [editDeadline, setEditDeadline] = useState('');

  const overdue = useMemo(
    () => reserve ? isOverdue(reserve.deadline, reserve.status) : false,
    [reserve]
  );

  if (!reserve) {
    return (
      <View style={styles.container}>
        <Header title="Réserve introuvable" showBack />
        <View style={styles.notFound}>
          <Ionicons name="search-outline" size={48} color={C.textMuted} />
          <Text style={styles.notFoundText}>Réserve non trouvée</Text>
        </View>
      </View>
    );
  }

  const allPhotos: ReservePhoto[] = reserve.photos && reserve.photos.length > 0
    ? reserve.photos
    : reserve.photoUri
      ? [{ id: 'legacy', uri: reserve.photoUri, kind: 'defect', takenAt: reserve.createdAt, takenBy: '' }]
      : [];

  const defectCount = allPhotos.filter(p => p.kind === 'defect').length;
  const resolutionCount = allPhotos.filter(p => p.kind === 'resolution').length;

  const reserveCompanyNames = [...new Set(reserve.companies ?? (reserve.company ? [reserve.company] : []))];
  const reserveCompanyObjects = companies
    .filter(c => reserveCompanyNames.includes(c.name))
    .filter((c, i, arr) => arr.findIndex(x => x.name === c.name) === i);
  const company = reserveCompanyObjects[0] ?? null;

  function openEdit() {
    if (!reserve) return;
    setEditTitle(reserve.title);
    setEditDescription(reserve.description);
    setEditBuilding(reserve.building);
    setEditZone(reserve.zone);
    setEditLevel(reserve.level);
    setEditCompanies(reserve.companies ?? (reserve.company ? [reserve.company] : []));
    setEditPriority(reserve.priority);
    setEditDeadline(reserve.deadline === '—' ? '' : reserve.deadline);
    setEditPhotos(reserve.photos ?? (reserve.photoUri ? [{ id: 'legacy', uri: reserve.photoUri, kind: 'defect', takenAt: reserve.createdAt, takenBy: '' }] : []));
    setEditModalVisible(true);
  }

  function handleSignatureSave() {
    if (!reserve) return;
    if (sigPadRef.current?.isEmpty()) {
      Alert.alert('Signature requise', 'Veuillez apposer votre signature avant de valider.');
      return;
    }
    const dataUrl = sigPadRef.current?.getSVGData() ?? null;
    if (!dataUrl) return;
    const today = formatDateFR(new Date());
    const author = user?.name ?? 'Conducteur de travaux';
    const signataire = signataireName.trim() || author;

    let updated: Reserve;
    if (signingForCompany && reserveCompanyNames.length > 1) {
      const existing = reserve.companySignatures ?? {};
      updated = {
        ...reserve,
        companySignatures: {
          ...existing,
          [signingForCompany]: { signature: dataUrl, signataire, signedAt: today },
        },
        enterpriseAcknowledgedAt: reserve.enterpriseAcknowledgedAt ?? today,
        history: [...reserve.history, {
          id: genId(),
          action: `Levée signée (${signingForCompany})`,
          author: signataire,
          createdAt: today,
        }],
      };
    } else {
      updated = {
        ...reserve,
        enterpriseSignature: dataUrl,
        enterpriseSignataire: signataire,
        enterpriseAcknowledgedAt: reserve.enterpriseAcknowledgedAt ?? today,
        history: [...reserve.history, {
          id: genId(),
          action: 'Levée signée',
          author: signataire,
          createdAt: today,
        }],
      };
    }
    updateReserveFields(updated);
    setSignatureModalVisible(false);
    setSigningForCompany(null);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  }

  function handleEnterpriseAck() {
    if (!reserve) return;
    Alert.alert(
      'Accuser réception',
      `Confirmer que vous avez bien pris connaissance de la réserve ${reserve.id} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: () => {
            const today = formatDateFR(new Date());
            const author = user?.name ?? 'Entreprise';
            const updated: Reserve = {
              ...reserve,
              enterpriseAcknowledgedAt: reserve.enterpriseAcknowledgedAt ?? today,
              history: [...reserve.history, {
                id: genId(),
                action: 'Réception accusée',
                author,
                createdAt: today,
              }],
            };
            updateReserveFields(updated);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2500);
          },
        },
      ]
    );
  }

  function handleAnnotationSave(photoId: string, annotations: any[]) {
    if (!reserve) return;
    const updatedPhotos: ReservePhoto[] = allPhotos.map(p =>
      p.id === photoId ? { ...p, annotations } : p
    );
    updateReserveFields({ ...reserve, photos: updatedPhotos });
    setAnnotatorPhoto(null);
  }

  async function handleAddEditPhoto(fromCamera = false) {
    if (editPhotos.length >= 6) { Alert.alert('Limite atteinte', 'Maximum 6 photos par réserve.'); return; }
    if (fromCamera) {
      if (Platform.OS === 'web') { Alert.alert('Info', 'La prise de photo directe est disponible sur mobile.'); return; }
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à l'appareil photo est nécessaire."); return; }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
      if (!result.canceled && result.assets[0]) await saveEditPhoto(result.assets[0].uri);
    } else {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à la galerie est nécessaire."); return; }
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
      if (!result.canceled && result.assets[0]) await saveEditPhoto(result.assets[0].uri);
    }
  }

  async function saveEditPhoto(uri: string) {
    setEditPhotoUploading(true);
    try {
      const filename = `reserve_photo_${Date.now()}.jpg`;
      const storageUrl = await uploadPhoto(uri, filename);
      const finalUri = storageUrl ?? uri;
      const today = formatDateFR(new Date());
      const newPhoto: ReservePhoto = { id: genId(), uri: finalUri, kind: 'defect', takenAt: today, takenBy: user?.name ?? '' };
      setEditPhotos(prev => [...prev, newPhoto]);
    } catch {
      const today = formatDateFR(new Date());
      const newPhoto: ReservePhoto = { id: genId(), uri, kind: 'defect', takenAt: today, takenBy: user?.name ?? '' };
      setEditPhotos(prev => [...prev, newPhoto]);
      if (isSupabaseConfigured) {
        Alert.alert(
          'Upload échoué',
          "La photo a été ajoutée localement mais n'a pas pu être envoyée au serveur. Elle pourrait être perdue si le cache est effacé.",
        );
      }
    } finally {
      setEditPhotoUploading(false);
    }
  }

  function toggleEditPhotoKind(photoId: string) {
    setEditPhotos(prev => prev.map(p => p.id === photoId ? { ...p, kind: p.kind === 'defect' ? 'resolution' : 'defect' } : p));
  }

  function removeEditPhoto(photoId: string) {
    setEditPhotos(prev => prev.filter(p => p.id !== photoId));
  }

  function buildChangeSummary(r: Reserve): { label: string; oldVal: string; newVal: string }[] {
    const changes: { label: string; oldVal: string; newVal: string }[] = [];
    if (editTitle.trim() !== r.title) changes.push({ label: 'Titre', oldVal: r.title, newVal: editTitle.trim() });
    if (editBuilding !== r.building) changes.push({ label: 'Bâtiment', oldVal: r.building, newVal: editBuilding });
    if (editZone !== r.zone) changes.push({ label: 'Zone', oldVal: r.zone, newVal: editZone });
    if (editLevel !== r.level) changes.push({ label: 'Niveau', oldVal: r.level, newVal: editLevel });
    const oldNames = (r.companies ?? (r.company ? [r.company] : [])).join(', ');
    const newNames = editCompanies.join(', ');
    if (oldNames !== newNames) changes.push({ label: 'Entreprises', oldVal: oldNames, newVal: newNames });
    if (editPriority !== r.priority) changes.push({ label: 'Priorité', oldVal: PRIORITY_LABEL[r.priority], newVal: PRIORITY_LABEL[editPriority] });
    const newDl = editDeadline || '—';
    if (newDl !== r.deadline) changes.push({ label: 'Échéance', oldVal: r.deadline, newVal: newDl });
    return changes;
  }

  function handleSaveEdit() {
    if (!reserve) return;
    if (!editTitle.trim()) {
      Alert.alert('Champ obligatoire', 'Le titre est requis.');
      return;
    }
    if (editDeadline && !validateDeadline(editDeadline)) {
      Alert.alert('Date invalide', "Vérifiez que le jour, le mois et l'année sont corrects (ex : 30/04/2026).");
      return;
    }
    const author = user?.name ?? 'Conducteur de travaux';
    const today = formatDateFR(new Date());
    const changes = buildChangeSummary(reserve);
    const historyEntry = {
      id: genId(),
      action: 'Réserve modifiée',
      author,
      createdAt: today,
      oldValue: changes.length > 0 ? changes.map(c => c.oldVal).join(', ') : undefined,
      newValue: changes.length > 0 ? changes.map(c => c.newVal).join(', ') : undefined,
    };
    const updated: Reserve = {
      ...reserve,
      title: editTitle.trim(),
      description: editDescription.trim() || reserve.description,
      building: editBuilding,
      zone: editZone,
      level: editLevel,
      companies: editCompanies,
      company: editCompanies[0] ?? reserve.company,
      priority: editPriority,
      deadline: editDeadline || '—',
      photoUri: editPhotos[0]?.uri ?? undefined,
      photos: editPhotos.length > 0 ? editPhotos : undefined,
      history: changes.length > 0 ? [...reserve.history, historyEntry] : reserve.history,
    };
    updateReserveFields(updated);
    const existingPhotoIds = new Set((reserve.photos ?? []).map(p => p.id));
    editPhotos.filter(p => !existingPhotoIds.has(p.id)).forEach(p => {
      addPhoto({
        id: genId(),
        comment: `Photo réserve ${reserve.id} — ${editTitle.trim()}`,
        location: `Bât. ${editBuilding} - ${editLevel}`,
        takenAt: today,
        takenBy: author,
        colorCode: '#EF4444',
        uri: p.uri,
      });
    });
    setEditModalVisible(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  }

  async function handleExportPDF() {
    if (!reserve) return;
    if (!permissions.canExport) return;
    try {
      const rawPhotos = reserve.photos && reserve.photos.length > 0
        ? reserve.photos
        : reserve.photoUri
          ? [{ id: 'legacy', uri: reserve.photoUri, kind: 'defect' as const, takenAt: reserve.createdAt, takenBy: '' }]
          : [];
      const resolvedSrcs = await Promise.all(rawPhotos.slice(0, 3).map(p => loadPhotoAsDataUrl(p.uri)));

      let planData: PlanData | undefined;
      if (reserve.planId && reserve.planX !== undefined && reserve.planY !== undefined) {
        const matchedPlan = sitePlans.find(p => p.id === reserve.planId);
        if (matchedPlan && matchedPlan.uri) {
          // Convert to data URL so Print.printAsync's sandboxed WebView can access it
          // (file:// URIs are blocked in the WebView sandbox on mobile).
          const resolvedPlanUri = await loadFileAsDataUrl(matchedPlan.uri, matchedPlan.fileType);

          // For PDF plans: pre-render first page as JPEG so Print.printAsync
          // gets a static <img> — avoids CDN PDF.js timing / sandbox issues.
          // On web: PDF.js runs in the DOM context. On native: capture the
          // already-rendered PdfPlanViewer canvas via a hidden viewer.
          let preRenderedDataUrl: string | undefined;
          if (matchedPlan.fileType === 'pdf') {
            if (Platform.OS === 'web') {
              const rendered = await preRenderPdfPageToDataUrl(resolvedPlanUri, 520);
              if (rendered) preRenderedDataUrl = rendered;
            } else {
              const captured = await captureHiddenPlan(resolvedPlanUri, 'pdf');
              if (captured) preRenderedDataUrl = captured;
            }
          }

          planData = {
            planUri: resolvedPlanUri,
            fileType: matchedPlan.fileType,
            planX: reserve.planX,
            planY: reserve.planY,
            planName: matchedPlan.name ?? 'Plan',
            preRenderedDataUrl,
          };
        }
      }

      // Compute this reserve's sequential pin number (same logic as plans.tsx pinNumberMap)
      const planReservesForNum = reserves
        .filter(r => r.planId === reserve.planId && r.planX != null && r.planY != null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const pinNumInPlan = (planReservesForNum.findIndex(r => r.id === reserve.id) + 1) || 1;

      const html = buildReservePDF(reserve, projectName, company, resolvedSrcs, planData, pinNumInPlan);
      await exportPDFHelper(html, `Fiche ${reserve.id}`);
    } catch {
      Alert.alert('Erreur', "Impossible de générer le PDF.");
    }
  }

  function handleDelete() {
    if (!reserve) return;
    Alert.alert(
      'Supprimer la réserve',
      `Supprimer définitivement ${reserve.id} — "${reserve.title}" ?\n\nCette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            deleteReserve(reserve.id);
            router.back();
          },
        },
      ]
    );
  }

  function handleContactCompany(targetCompany?: typeof company) {
    if (!reserve) return;
    const co = targetCompany ?? company;
    if (!co) { Alert.alert('Aucune entreprise', 'Aucune entreprise associée à cette réserve.'); return; }
    const ch = channels.find(c => c.id === `company-${co.id}`);
    if (!ch) {
      Alert.alert('Canal indisponible', `Le canal de "${co.name}" n'existe pas encore. Ajoutez d'abord l'entreprise dans l'onglet Équipes.`);
      return;
    }
    router.push({
      pathname: '/channel/[id]',
      params: {
        id: ch.id,
        name: ch.name,
        color: ch.color,
        icon: ch.icon,
        isDM: '0',
        isGroup: '0',
        members: '',
      },
    } as any);
  }

  function handleStatusChange(newStatus: ReserveStatus) {
    if (!reserve) return;
    const companyCount = reserveCompanyNames.length;
    const doUpdate = () => {
      updateReserveStatus(reserve.id, newStatus, user?.name ?? 'Conducteur de travaux');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    };
    if (companyCount > 1) {
      Alert.alert(
        'Changer le statut',
        `${companyCount} entreprises seront notifiées de ce changement.\n\nContinuer ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Confirmer', onPress: doUpdate },
        ]
      );
    } else {
      doUpdate();
    }
  }

  function handleApproveVerification() {
    if (!reserve) return;
    const companyCount = reserveCompanyNames.length;
    const notifLine = companyCount > 1
      ? `\n\n${companyCount} entreprises seront notifiées.`
      : '';
    Alert.alert(
      'Approuver la levée',
      `Confirmer la levée définitive de la réserve ${reserve.id} ?\n\nCette action clôture la réserve.${notifLine}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Approuver',
          onPress: () => {
            updateReserveStatus(reserve.id, 'closed', user?.name ?? 'Conducteur de travaux');
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2500);
          },
        },
      ]
    );
  }

  function handleRejectVerification() {
    if (!reserve) return;
    const reason = rejectReason.trim();
    const companyCount = reserveCompanyNames.length;
    const doReject = () => {
      updateReserveStatus(reserve.id, 'in_progress', user?.name ?? 'Conducteur de travaux');
      if (reason) {
        addComment(reserve.id, `Levée rejetée : ${reason}`);
      }
      setShowRejectModal(false);
      setRejectReason('');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    };
    if (companyCount > 1) {
      Alert.alert(
        'Rejeter la levée',
        `${companyCount} entreprises seront notifiées du rejet.\n\nContinuer ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Rejeter', style: 'destructive', onPress: doReject },
        ]
      );
    } else {
      doReject();
    }
  }

  function handleAddComment() {
    if (!reserve) return;
    if (comment.trim().length === 0) return;
    addComment(reserve.id, comment.trim());
    setComment('');
    setShowCommentBox(false);
  }

  const ackDone = !!reserve.enterpriseAcknowledgedAt;
  const signDone = !!reserve.enterpriseSignature;
  const isMultiCompany = reserveCompanyNames.length > 1;
  const allCompaniesSignedInMulti = isMultiCompany &&
    reserveCompanyNames.every(name => !!reserve.companySignatures?.[name]);
  const multiSignCount = isMultiCompany ? Object.keys(reserve.companySignatures ?? {}).length : 0;

  return (
    <View style={styles.container}>
      {captureViewerUri ? (
        <View
          style={{ position: 'absolute', width: 600, height: 450, opacity: 0.01, zIndex: -10, pointerEvents: 'none' as any }}
        >
          <PdfPlanViewer
            ref={planViewerRef}
            planUri={captureViewerUri}
            planId="__capture__"
            isImagePlan={captureViewerIsImage}
            annotations={[]}
            onAnnotationsChange={() => {}}
            reserves={[]}
            pinNumberMap={new Map()}
            onReserveSelect={() => {}}
            onPlanTap={() => {}}
            canAnnotate={false}
            canCreate={false}
            onZoomChange={() => {}}
            onReady={onCaptureViewerReady}
            companies={companies}
          />
        </View>
      ) : null}
      <Header
        title={reserve.id}
        subtitle={reserve.title}
        showBack
        rightLabel={permissions.canEdit ? 'Modifier' : undefined}
        onRightPress={permissions.canEdit ? openEdit : undefined}
      />

      {saveSuccess && (
        <View style={styles.toastBanner}>
          <Ionicons name="checkmark-circle" size={16} color={C.closed} />
          <Text style={styles.toastText}>Modifications enregistrées</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {overdue && (
          <View style={styles.overdueBanner}>
            <Ionicons name="warning" size={16} color={C.open} />
            <Text style={styles.overdueBannerText}>
              Délai dépassé — Échéance : {formatDate(reserve.deadline)}
            </Text>
          </View>
        )}

        <View style={styles.badgeRow}>
          <StatusBadge status={reserve.status} />
          <PriorityBadge priority={reserve.priority} />
        </View>

        {/* PHOTO GALLERY — multi-photo with defect/resolution badges */}
        {allPhotos.length > 0 && (
          <View style={styles.card}>
            <View style={styles.photoGalleryHeader}>
              <Text style={styles.sectionTitle}>Photos ({allPhotos.length})</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {defectCount > 0 && (
                  <View style={styles.photoBadgeDefect}>
                    <View style={[styles.photoBadgeDot, { backgroundColor: '#EF4444' }]} />
                    <Text style={[styles.photoBadgeText, { color: '#EF4444' }]}>{defectCount} constat{defectCount > 1 ? 's' : ''}</Text>
                  </View>
                )}
                {resolutionCount > 0 && (
                  <View style={styles.photoBadgeResolution}>
                    <View style={[styles.photoBadgeDot, { backgroundColor: '#22C55E' }]} />
                    <Text style={[styles.photoBadgeText, { color: '#22C55E' }]}>{resolutionCount} levée{resolutionCount > 1 ? 's' : ''}</Text>
                  </View>
                )}
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {allPhotos.map((photo, idx) => (
                  <View key={photo.id} style={styles.photoThumb}>
                    <TouchableOpacity
                      onPress={() => { setSelectedPhotoIndex(idx); setPhotoFullScreen(true); }}
                      activeOpacity={0.85}
                    >
                      <Image source={{ uri: photo.uri }} style={styles.photoThumbImg} resizeMode="cover" onError={() => {}} />
                      <View style={[styles.photoKindBadge, { backgroundColor: photo.kind === 'defect' ? '#EF444488' : '#22C55E88' }]}>
                        <Text style={styles.photoKindBadgeText}>{photo.kind === 'defect' ? 'Constat' : 'Levée'}</Text>
                      </View>
                    </TouchableOpacity>
                    {permissions.canEdit && photo.id !== 'legacy' && (
                      <TouchableOpacity style={styles.annotateBtn} onPress={() => setAnnotatorPhoto(photo)}>
                        <Ionicons name="pencil" size={11} color="#fff" />
                      </TouchableOpacity>
                    )}
                    {photo.annotations && photo.annotations.length > 0 && (
                      <View style={styles.annotatedIndicator}>
                        <Ionicons name="brush-outline" size={9} color="#fff" />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </ScrollView>
            <Text style={styles.photoHintSmall}>Appuyer pour agrandir · Crayon pour annoter</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informations</Text>
          <InfoRow icon="business-outline" label="Bâtiment" value={`Bâtiment ${reserve.building}`} />
          <InfoRow icon="location-outline" label="Zone" value={reserve.zone} />
          <InfoRow icon="layers-outline" label="Niveau" value={reserve.level} />
          <InfoRow icon="people-outline" label={reserveCompanyNames.length > 1 ? 'Entreprises' : 'Entreprise'} value={reserveCompanyNames.join(', ') || '—'} />
          {reserve.responsableNom ? (
            <InfoRow icon="person-circle-outline" label="Responsable" value={reserve.responsableNom} />
          ) : null}
          <InfoRow icon="calendar-outline" label="Créé le" value={formatDate(reserve.createdAt)} />
          <InfoRow
            icon="timer-outline"
            label="Échéance"
            value={reserve.deadline === '—' ? 'Aucune échéance' : formatDate(reserve.deadline)}
            valueColor={overdue ? C.open : undefined}
            last={!reserve.closedAt}
          />
          {reserve.closedAt && (
            <InfoRow
              icon="checkmark-circle-outline"
              label="Date de levée"
              value={formatDate(reserve.closedAt)}
              valueColor={C.closed}
            />
          )}
          {reserve.closedBy && (
            <InfoRow
              icon="person-outline"
              label="Clôturé par"
              value={reserve.closedBy}
              last
            />
          )}
          {reserveCompanyObjects.length === 0 ? null : reserveCompanyObjects.map(co => (
            <TouchableOpacity
              key={co.id}
              style={[styles.contactBtn, { borderColor: co.color, backgroundColor: co.color + '12', marginTop: 4 }]}
              onPress={() => handleContactCompany(co)}
              activeOpacity={0.75}
            >
              <Ionicons name="chatbubbles" size={16} color={co.color} />
              <Text style={[styles.contactBtnText, { color: co.color }]}>
                Contacter {co.name}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={co.color} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>{reserve.description}</Text>
        </View>

        {user?.role === 'sous_traitant' && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Ionicons name="construct-outline" size={15} color={C.textSub} />
              <Text style={styles.sectionTitle}>Votre action</Text>
            </View>
            {reserve.status === 'verification' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F5F3FF', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#7C3AED40' }}>
                <Ionicons name="time-outline" size={16} color="#7C3AED" />
                <Text style={{ flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: '#7C3AED' }}>
                  Demande de levée envoyée — en attente de validation
                </Text>
              </View>
            ) : reserve.status === 'closed' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ECFDF5', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#6EE7B7' }}>
                <Ionicons name="checkmark-circle" size={16} color="#059669" />
                <Text style={{ flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: '#059669' }}>
                  Réserve levée et approuvée
                </Text>
              </View>
            ) : (
              <>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 10 }}>
                  Statut actuel : <Text style={{ fontFamily: 'Inter_600SemiBold', color: STATUS_CONFIG[reserve.status]?.color }}>{STATUS_CONFIG[reserve.status]?.label}</Text>
                  {'\n'}Une fois les travaux réalisés, déclarez la levée pour validation par le conducteur.
                </Text>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#7C3AED', borderRadius: 12, paddingVertical: 13, opacity: reserve.status === 'open' || reserve.status === 'in_progress' || reserve.status === 'waiting' ? 1 : 0.5 }}
                  onPress={() => {
                    Alert.alert(
                      'Demander la levée',
                      `Confirmer que les travaux de la réserve ${reserve.id} ont été réalisés ?\n\nLe conducteur de travaux sera notifié pour vérification.`,
                      [
                        { text: 'Annuler', style: 'cancel' },
                        { text: 'Confirmer', onPress: () => handleStatusChange('verification') },
                      ]
                    );
                  }}
                  disabled={!['open', 'in_progress', 'waiting'].includes(reserve.status)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="checkmark-done-outline" size={16} color="#fff" />
                  <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Demander la levée</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {permissions.canEdit && user?.role !== 'sous_traitant' && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Modifier le statut</Text>
            <View style={styles.statusGrid}>
              {STATUS_ORDER.map(s => {
                const cfg = STATUS_CONFIG[s];
                const isActive = reserve.status === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.statusBtn, { borderColor: cfg.color, backgroundColor: isActive ? cfg.bg : 'transparent' }]}
                    onPress={() => !isActive && handleStatusChange(s)}
                    disabled={isActive}
                  >
                    <View style={[styles.statusDot, { backgroundColor: cfg.color }]} />
                    <Text style={[styles.statusBtnText, { color: cfg.color }]}>{cfg.label}</Text>
                    {isActive && <Ionicons name="checkmark" size={12} color={cfg.color} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {permissions.canEdit && user?.role !== 'sous_traitant' && reserve.status === 'verification' && (
          <View style={[styles.card, { borderColor: '#7C3AED40', borderWidth: 1.5 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#7C3AED20', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="shield-checkmark-outline" size={15} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sectionTitle, { color: '#7C3AED' }]}>Approbation de levée</Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 }}>
                  L'entreprise a déclaré cette réserve levée. Votre décision est requise.
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#ECFDF5', borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: '#6EE7B7' }}
                onPress={handleApproveVerification}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark-circle" size={16} color="#059669" />
                <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#059669' }}>Approuver</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FEF2F2', borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: '#FCA5A5' }}
                onPress={() => { setRejectReason(''); setShowRejectModal(true); }}
                activeOpacity={0.8}
              >
                <Ionicons name="close-circle" size={16} color="#DC2626" />
                <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#DC2626' }}>Rejeter</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ENTERPRISE WORKFLOW — Accusé de réception + Signature de levée */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Workflow entreprise</Text>

          {/* Étape 1 : Accusé de réception */}
          <View style={styles.workflowStep}>
            <View style={[styles.workflowStepNum, ackDone && styles.workflowStepNumDone]}>
              {ackDone
                ? <Ionicons name="checkmark" size={13} color="#fff" />
                : <Text style={styles.workflowStepNumText}>1</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.workflowStepTitle}>Accusé de réception</Text>
              {ackDone ? (
                <Text style={styles.workflowStepDone}>Accusé le {formatDate(reserve.enterpriseAcknowledgedAt!)}</Text>
              ) : (
                <>
                  <Text style={styles.workflowStepDesc}>L'entreprise confirme avoir pris connaissance de cette réserve.</Text>
                  {permissions.canEdit && (
                    <TouchableOpacity style={styles.workflowBtn} onPress={handleEnterpriseAck} activeOpacity={0.8}>
                      <Ionicons name="mail-open-outline" size={14} color={C.primary} />
                      <Text style={styles.workflowBtnText}>Accuser réception</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>

          <View style={styles.workflowDivider} />

          {/* Étape 2 : Signature de levée — par entreprise si multi-company, sinon globale */}
          {isMultiCompany ? (
            <View style={{ marginBottom: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <View style={[styles.workflowStepNum, allCompaniesSignedInMulti && styles.workflowStepNumDone, !ackDone && styles.workflowStepNumLocked]}>
                  {allCompaniesSignedInMulti
                    ? <Ionicons name="checkmark" size={13} color="#fff" />
                    : <Text style={styles.workflowStepNumText}>2</Text>}
                </View>
                <Text style={[styles.workflowStepTitle, !ackDone && { color: C.textMuted }]}>
                  Signatures de levée ({multiSignCount}/{reserveCompanyNames.length})
                </Text>
              </View>
              {!ackDone ? (
                <Text style={[styles.workflowStepDesc, { paddingLeft: 36 }]}>Disponible après accusé de réception.</Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {reserveCompanyNames.map(coName => {
                    const co = companies.find(c => c.name === coName);
                    const sig = reserve.companySignatures?.[coName];
                    return (
                      <View key={coName} style={[styles.companySignRow, { borderLeftColor: co?.color ?? C.primary }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: sig ? 6 : 4 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: co?.color ?? C.primary }} />
                          <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, flex: 1 }}>{coName}</Text>
                          {sig ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Ionicons name="checkmark-circle" size={14} color="#059669" />
                              <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: '#059669' }}>Signé</Text>
                            </View>
                          ) : (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Ionicons name="ellipse-outline" size={13} color={C.textMuted} />
                              <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted }}>En attente</Text>
                            </View>
                          )}
                        </View>
                        {sig ? (
                          <View>
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 4 }}>
                              Signé par {sig.signataire} le {sig.signedAt}
                            </Text>
                            <Image source={{ uri: sig.signature }} style={styles.signaturePreview} resizeMode="contain" />
                          </View>
                        ) : (permissions.canEdit || user?.role === 'sous_traitant') ? (
                          <TouchableOpacity
                            style={[styles.workflowBtn, { borderColor: co?.color ?? C.primary }]}
                            onPress={() => {
                              setSigningForCompany(coName);
                              setSignataireName('');
                              setSignatureModalVisible(true);
                            }}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="pencil-outline" size={14} color={co?.color ?? C.primary} />
                            <Text style={[styles.workflowBtnText, { color: co?.color ?? C.primary }]}>
                              Signer pour {co?.shortName ?? coName}
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          ) : (
            <View style={[styles.workflowStep, { marginBottom: 0 }]}>
              <View style={[styles.workflowStepNum, signDone && styles.workflowStepNumDone, !ackDone && styles.workflowStepNumLocked]}>
                {signDone
                  ? <Ionicons name="checkmark" size={13} color="#fff" />
                  : <Text style={styles.workflowStepNumText}>2</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.workflowStepTitle, !ackDone && { color: C.textMuted }]}>Signature de levée</Text>
                {signDone ? (
                  <View>
                    <Text style={styles.workflowStepDone}>
                      Signé par {reserve.enterpriseSignataire}
                    </Text>
                    <Image
                      source={{ uri: svgStringToDataUrl(reserve.enterpriseSignature!) }}
                      style={styles.signaturePreview}
                      resizeMode="contain"
                    />
                  </View>
                ) : ackDone ? (
                  <>
                    <Text style={styles.workflowStepDesc}>L'entreprise certifie avoir levé la réserve. Signature numérique requise.</Text>
                    {(permissions.canEdit || user?.role === 'sous_traitant') && (
                      <TouchableOpacity
                        style={styles.workflowBtn}
                        onPress={() => { setSigningForCompany(null); setSignatureModalVisible(true); }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="pencil-outline" size={14} color={C.primary} />
                        <Text style={styles.workflowBtnText}>Signer la levée</Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <Text style={styles.workflowStepDesc}>Disponible après accusé de réception.</Text>
                )}
              </View>
            </View>
          )}
        </View>

        {(() => {
          const linkedTask = reserve.linkedTaskId ? tasks.find(t => t.id === reserve.linkedTaskId) : null;
          const TASK_STATUS_COLORS: Record<string, string> = {
            todo: C.textMuted, in_progress: C.inProgress, done: C.closed, delayed: C.waiting,
          };
          const TASK_STATUS_LABELS: Record<string, string> = {
            todo: 'À faire', in_progress: 'En cours', done: 'Terminé', delayed: 'En retard',
          };
          return (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Tâche corrective</Text>
              {linkedTask ? (
                <TouchableOpacity
                  style={styles.taskLink}
                  onPress={() => router.push(`/task/${linkedTask.id}` as any)}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <View style={[styles.taskStatusDot, { backgroundColor: TASK_STATUS_COLORS[linkedTask.status] }]} />
                      <Text style={[styles.taskStatusText, { color: TASK_STATUS_COLORS[linkedTask.status] }]}>
                        {TASK_STATUS_LABELS[linkedTask.status]}
                      </Text>
                      <Text style={styles.taskProgressText}>{linkedTask.progress}%</Text>
                    </View>
                    <Text style={styles.taskTitle}>{linkedTask.title}</Text>
                    <Text style={styles.taskMeta}>Responsable : {linkedTask.assignee} · Éch. : {linkedTask.deadline}</Text>
                    <View style={styles.taskProgressBar}>
                      <View style={[styles.taskProgressFill, { width: `${linkedTask.progress}%` as any, backgroundColor: TASK_STATUS_COLORS[linkedTask.status] }]} />
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.textMuted} style={{ marginLeft: 8 }} />
                </TouchableOpacity>
              ) : permissions.canCreate ? (
                <TouchableOpacity
                  style={styles.createTaskBtn}
                  onPress={() => router.push({ pathname: '/task/new', params: { reserveId: reserve.id } } as any)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add-circle-outline" size={18} color={C.primary} />
                  <Text style={styles.createTaskBtnText}>Créer une tâche corrective</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.emptyText}>Aucune tâche corrective associée à cette réserve.</Text>
              )}
            </View>
          );
        })()}

        <View style={styles.card}>
          <View style={styles.commentHeader}>
            <Text style={styles.sectionTitle}>
              Commentaires ({reserve.comments.length})
            </Text>
            {permissions.canCreate && (
              <TouchableOpacity
                onPress={() => setShowCommentBox(!showCommentBox)}
                style={styles.addCommentBtn}
              >
                <Ionicons name={showCommentBox ? 'close' : 'add'} size={18} color={C.primary} />
              </TouchableOpacity>
            )}
          </View>

          {showCommentBox && (
            <View style={styles.commentBox}>
              <TextInput
                style={styles.commentInput}
                placeholder="Ajouter un commentaire..."
                placeholderTextColor={C.textMuted}
                value={comment}
                onChangeText={setComment}
                multiline
                maxLength={500}
                autoFocus
              />
              <TouchableOpacity style={styles.sendBtn} onPress={handleAddComment}>
                <Ionicons name="send" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {reserve.comments.length === 0 && !showCommentBox && (
            <Text style={styles.emptyText}>Aucun commentaire — appuyez sur + pour en ajouter</Text>
          )}

          {[...reserve.comments].reverse().map(c => (
            <View key={c.id} style={styles.commentCard}>
              <View style={styles.commentTop}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>{c.author.charAt(0)}</Text>
                </View>
                <View>
                  <Text style={styles.commentAuthor}>{c.author}</Text>
                  <Text style={styles.commentDate}>{formatDate(c.createdAt)}</Text>
                </View>
              </View>
              <Text style={styles.commentContent}>{c.content}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Historique ({reserve.history.length})</Text>
          {[...reserve.history].reverse().map(h => (
            <View key={h.id} style={styles.historyItem}>
              <View style={styles.historyDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.historyAction}>{h.action}</Text>
                {h.oldValue && h.newValue && (
                  <Text style={styles.historyValues}>{h.oldValue} → {h.newValue}</Text>
                )}
                <Text style={styles.historyMeta}>{h.author} — {formatDate(h.createdAt)}</Text>
              </View>
            </View>
          ))}
        </View>

        {permissions.canExport && (
          <TouchableOpacity style={styles.exportPdfBtn} onPress={handleExportPDF}>
            <Ionicons name="document-text-outline" size={16} color={C.primary} />
            <Text style={styles.exportPdfBtnText}>Exporter fiche PDF</Text>
          </TouchableOpacity>
        )}

        {permissions.canDelete && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={16} color={C.open} />
            <Text style={styles.deleteBtnText}>Supprimer cette réserve</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Modal d'édition */}
      <Modal visible={editModalVisible} transparent animationType="slide" onRequestClose={() => setEditModalVisible(false)}>
        <View style={mStyles.overlay}>
          <View style={mStyles.sheet}>
            <View style={mStyles.sheetHeader}>
              <TouchableOpacity onPress={() => setEditModalVisible(false)} style={mStyles.closeBtn}>
                <Ionicons name="close" size={20} color={C.textSub} />
              </TouchableOpacity>
              <Text style={mStyles.sheetTitle}>Modifier la réserve</Text>
              <TouchableOpacity onPress={handleSaveEdit} style={mStyles.saveBtn}>
                <Text style={mStyles.saveBtnText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={[mStyles.content, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={mStyles.label}>TITRE *</Text>
              <TextInput style={mStyles.input} value={editTitle} onChangeText={setEditTitle} placeholder="Titre..." placeholderTextColor={C.textMuted} />

              <Text style={mStyles.label}>DESCRIPTION</Text>
              <TextInput
                style={[mStyles.input, mStyles.textArea]}
                value={editDescription}
                onChangeText={setEditDescription}
                placeholder="Description..."
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={4}
              />

              <Text style={mStyles.label}>PHOTOS ({editPhotos.length}/6)</Text>
              {editPhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {editPhotos.map(p => (
                      <View key={p.id} style={mStyles.photoThumb}>
                        <TouchableOpacity onPress={() => toggleEditPhotoKind(p.id)} activeOpacity={0.85}>
                          <Image source={{ uri: p.uri }} style={mStyles.photoThumbImg} resizeMode="cover" onError={() => {}} />
                          <View style={[mStyles.photoKindBadge, { backgroundColor: p.kind === 'defect' ? '#EF444488' : '#22C55E88' }]}>
                            <Text style={mStyles.photoKindText}>{p.kind === 'defect' ? 'Constat' : 'Levée'}</Text>
                          </View>
                        </TouchableOpacity>
                        <TouchableOpacity style={mStyles.photoRemoveBtn} onPress={() => removeEditPhoto(p.id)}>
                          <Ionicons name="close" size={10} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              )}
              {editPhotos.length < 6 && (
                <View style={mStyles.photoRow}>
                  <TouchableOpacity style={mStyles.photoBtn} onPress={() => handleAddEditPhoto(true)} disabled={editPhotoUploading}>
                    <Ionicons name="camera" size={16} color={C.primary} />
                    <Text style={mStyles.photoBtnText}>Photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[mStyles.photoBtn, { flex: 1 }]} onPress={() => handleAddEditPhoto(false)} disabled={editPhotoUploading}>
                    <Ionicons name="images-outline" size={16} color={C.inProgress} />
                    <Text style={[mStyles.photoBtnText, { color: C.inProgress }]}>Galerie</Text>
                  </TouchableOpacity>
                </View>
              )}
              {editPhotoUploading && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <ActivityIndicator size="small" color={C.primary} />
                  <Text style={{ fontSize: 12, color: C.textMuted, fontFamily: 'Inter_400Regular' }}>Upload en cours...</Text>
                </View>
              )}

              <Text style={mStyles.label}>BÂTIMENT</Text>
              <ChipSelect options={RESERVE_BUILDINGS} value={editBuilding} onChange={setEditBuilding} />

              <Text style={mStyles.label}>ZONE</Text>
              <ChipSelect options={RESERVE_ZONES} value={editZone} onChange={setEditZone} />

              <Text style={mStyles.label}>NIVEAU</Text>
              <ChipSelect options={RESERVE_LEVELS} value={editLevel} onChange={setEditLevel} />

              <Text style={mStyles.label}>ENTREPRISES</Text>
              {companies.length === 0 ? (
                <Text style={mStyles.hint}>Aucune entreprise configurée.</Text>
              ) : (
                <>
                  {companies.map(co => {
                    const sel = editCompanies.includes(co.name);
                    return (
                      <TouchableOpacity
                        key={co.id}
                        style={[mStyles.coRow, sel && { borderColor: co.color, backgroundColor: co.color + '15' }]}
                        onPress={() => setEditCompanies(prev => sel ? prev.filter(n => n !== co.name) : [...prev, co.name])}
                        activeOpacity={0.7}
                      >
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: co.color, flexShrink: 0 }} />
                        <Text style={[mStyles.coRowText, sel && { color: co.color, fontFamily: 'Inter_600SemiBold' }]}>{co.name}</Text>
                        <View style={[mStyles.coCheck, sel && { backgroundColor: co.color, borderColor: co.color }]}>
                          {sel && <Ionicons name="checkmark" size={11} color="#fff" />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {editCompanies.length > 1 && (
                    <Text style={[mStyles.hint, { color: C.primary, marginTop: 4 }]}>
                      {editCompanies.length} entreprises sélectionnées — toutes seront notifiées lors d'un changement de statut.
                    </Text>
                  )}
                </>
              )}

              <Text style={mStyles.label}>PRIORITÉ</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {RESERVE_PRIORITIES.map(p => (
                  <TouchableOpacity
                    key={p.value}
                    style={[mStyles.chip, editPriority === p.value && { borderColor: p.color, backgroundColor: p.color + '20' }]}
                    onPress={() => setEditPriority(p.value)}
                  >
                    <Text style={[mStyles.chipText, editPriority === p.value && { color: p.color }]}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={mStyles.label}>DATE LIMITE</Text>
              <DateInput value={editDeadline} onChange={setEditDeadline} optional />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Photo plein écran — galerie multi-photos */}
      <Modal visible={photoFullScreen} transparent animationType="fade" onRequestClose={() => setPhotoFullScreen(false)}>
        <View style={styles.photoModal}>
          <TouchableOpacity
            style={[styles.photoCloseBtn, { top: insets.top + 12 }]}
            onPress={() => setPhotoFullScreen(false)}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          {allPhotos.length > 0 && (
            <>
              <Image
                source={{ uri: allPhotos[selectedPhotoIndex]?.uri }}
                style={styles.photoFull}
                resizeMode="contain"
                onError={() => {}}
              />
              <View style={[styles.photoNavRow, { bottom: insets.bottom + 24 }]}>
                <TouchableOpacity
                  onPress={() => setSelectedPhotoIndex(i => Math.max(0, i - 1))}
                  disabled={selectedPhotoIndex === 0}
                  style={[styles.photoNavBtn, selectedPhotoIndex === 0 && { opacity: 0.3 }]}
                >
                  <Ionicons name="chevron-back" size={22} color="#fff" />
                </TouchableOpacity>
                <View style={[styles.photoKindBadge, { backgroundColor: allPhotos[selectedPhotoIndex]?.kind === 'defect' ? '#EF444488' : '#22C55E88', paddingHorizontal: 14, paddingVertical: 5 }]}>
                  <Text style={styles.photoKindBadgeText}>
                    {allPhotos[selectedPhotoIndex]?.kind === 'defect' ? 'Constat' : 'Levée'} · {selectedPhotoIndex + 1}/{allPhotos.length}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedPhotoIndex(i => Math.min(allPhotos.length - 1, i + 1))}
                  disabled={selectedPhotoIndex === allPhotos.length - 1}
                  style={[styles.photoNavBtn, selectedPhotoIndex === allPhotos.length - 1 && { opacity: 0.3 }]}
                >
                  <Ionicons name="chevron-forward" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>

      {/* Modal signature de levée */}
      <Modal visible={signatureModalVisible} transparent animationType="slide" onRequestClose={() => setSignatureModalVisible(false)}>
        <View style={mStyles.overlay}>
          <View style={mStyles.sheet}>
            <View style={mStyles.sheetHeader}>
              <TouchableOpacity onPress={() => setSignatureModalVisible(false)} style={mStyles.closeBtn}>
                <Ionicons name="close" size={20} color={C.textSub} />
              </TouchableOpacity>
              <Text style={mStyles.sheetTitle}>
                {signingForCompany ? `Signature — ${signingForCompany}` : 'Signature de levée'}
              </Text>
              <TouchableOpacity onPress={handleSignatureSave} style={mStyles.saveBtn}>
                <Text style={mStyles.saveBtnText}>Valider</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={[mStyles.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
              <View style={styles.sigInfoBox}>
                <Ionicons name="information-circle-outline" size={16} color={C.primary} />
                <Text style={styles.sigInfoText}>
                  En signant, l'entreprise certifie avoir levé la réserve <Text style={{ fontFamily: 'Inter_700Bold' }}>{reserve.id}</Text>.
                </Text>
              </View>
              <Text style={mStyles.label}>NOM DU SIGNATAIRE</Text>
              <TextInput
                style={mStyles.input}
                placeholder={user?.name ?? 'Nom du représentant...'}
                placeholderTextColor={C.textMuted}
                value={signataireName}
                onChangeText={setSignataireName}
              />
              <Text style={[mStyles.label, { marginTop: 16 }]}>SIGNATURE *</Text>
              <View style={styles.sigPadWrap}>
                <SignaturePad ref={sigPadRef} />
              </View>
              <TouchableOpacity
                onPress={() => sigPadRef.current?.clear()}
                style={styles.clearSigBtn}
              >
                <Ionicons name="refresh-outline" size={14} color={C.textSub} />
                <Text style={styles.clearSigText}>Effacer la signature</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Annotateur photo */}
      {annotatorPhoto && (
        <PhotoAnnotationOverlay
          photoUri={annotatorPhoto.uri}
          annotations={annotatorPhoto.annotations ?? []}
          editable
          visible
          onSave={(annotations) => handleAnnotationSave(annotatorPhoto!.id, annotations)}
          onClose={() => setAnnotatorPhoto(null)}
        />
      )}
    </View>
  );
}

function InfoRow({ icon, label, value, last, valueColor }: {
  icon: string; label: string; value: string; last?: boolean; valueColor?: string;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Ionicons name={icon as any} size={15} color={C.textMuted} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFoundText: { fontSize: 16, color: C.textSub, fontFamily: 'Inter_400Regular' },
  content: { padding: 16, paddingBottom: 40 },
  toastBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.closed + '15', paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.closed + '30',
  },
  toastText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.closed },
  overdueBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.open + '12', borderRadius: 10, padding: 12,
    marginBottom: 14, borderWidth: 1, borderColor: C.open + '30',
  },
  overdueBannerText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.open, flex: 1 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  infoValue: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  description: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 22 },
  photoGalleryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  photoBadgeDefect: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EF444415', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  photoBadgeResolution: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#22C55E15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  photoBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  photoBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  photoThumb: { width: 110, height: 90, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  photoThumbImg: { width: 110, height: 90 },
  photoKindBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 3, alignItems: 'center' },
  photoKindBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  annotateBtn: {
    position: 'absolute', top: 5, right: 5,
    backgroundColor: 'rgba(0,0,0,0.55)', width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  annotatedIndicator: {
    position: 'absolute', top: 5, left: 5,
    backgroundColor: C.primary + 'CC', width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  photoHintSmall: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 8 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  workflowStep: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 4 },
  workflowStepNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.border, alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  workflowStepNumDone: { backgroundColor: C.closed },
  workflowStepNumLocked: { backgroundColor: C.border, opacity: 0.5 },
  workflowStepNumText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.textSub },
  workflowStepTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  workflowStepDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 8 },
  workflowStepDone: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.closed },
  workflowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primaryBg, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: C.primary + '40', alignSelf: 'flex-start',
  },
  workflowBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  workflowDivider: { height: 1, backgroundColor: C.border, marginVertical: 14, marginLeft: 40 },
  signaturePreview: { height: 54, width: 180, marginTop: 6, borderRadius: 6, backgroundColor: C.surface2 },
  companySignRow: {
    paddingLeft: 12, paddingVertical: 10, borderLeftWidth: 3, borderRadius: 4,
    backgroundColor: C.surface2, paddingRight: 12,
  },
  sigInfoBox: {
    flexDirection: 'row', gap: 10, backgroundColor: C.primaryBg, borderRadius: 10,
    padding: 12, marginBottom: 16, borderWidth: 1, borderColor: C.primary + '30',
  },
  sigInfoText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20 },
  sigPadWrap: { borderRadius: 10, overflow: 'hidden', borderWidth: 1.5, borderColor: C.border, marginBottom: 10 },
  clearSigBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 6 },
  clearSigText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addCommentBtn: { padding: 4 },
  commentBox: { flexDirection: 'row', gap: 8, marginBottom: 12, alignItems: 'flex-end' },
  commentInput: {
    flex: 1, backgroundColor: C.surface2, borderRadius: 10, padding: 10,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    maxHeight: 100, borderWidth: 1, borderColor: C.border,
  },
  sendBtn: { backgroundColor: C.primary, width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  commentCard: { backgroundColor: C.surface2, borderRadius: 10, padding: 12, marginTop: 8 },
  commentTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  avatarCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary },
  commentAuthor: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  commentDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  commentContent: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 20 },
  historyItem: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary, marginTop: 4 },
  historyAction: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  historyValues: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  historyMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 3 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5 },
  contactBtnText: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  exportPdfBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: C.primary + '50', backgroundColor: C.primary + '08', marginBottom: 10 },
  exportPdfBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: C.open + '50', backgroundColor: C.open + '08' },
  deleteBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.open },
  taskLink: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface2, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  taskStatusDot: { width: 8, height: 8, borderRadius: 4 },
  taskStatusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  taskProgressText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  taskTitle: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text, marginBottom: 4 },
  taskMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 8 },
  taskProgressBar: { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  taskProgressFill: { height: 4, borderRadius: 2 },
  createTaskBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primaryBg, borderRadius: 10, paddingVertical: 13, borderWidth: 1, borderColor: C.primary + '40' },
  createTaskBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  photoModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  photoCloseBtn: { position: 'absolute', top: 52, right: 20, zIndex: 10, padding: 8, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20 },
  photoFull: { width: '100%', height: '70%' },
  photoNavRow: { flexDirection: 'row', alignItems: 'center', gap: 16, position: 'absolute', bottom: 60 },
  photoNavBtn: { padding: 10, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20 },
});

const mStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  sheetTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  closeBtn: { padding: 4 },
  saveBtn: { backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  saveBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  content: { padding: 16, paddingBottom: 32 },
  label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 14 },
  hint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4 },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2, flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  photoRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.surface2, borderRadius: 10, paddingVertical: 12, borderWidth: 1.5, borderColor: C.border },
  photoBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  photoThumb: { width: 88, height: 72, borderRadius: 8, overflow: 'hidden', position: 'relative' },
  photoThumbImg: { width: 88, height: 72 },
  photoKindBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 2, alignItems: 'center' },
  photoKindText: { fontSize: 9, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  photoRemoveBtn: {
    position: 'absolute', top: 3, right: 3,
    backgroundColor: 'rgba(0,0,0,0.55)', width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  coRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2, marginBottom: 6 },
  coRowText: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  coCheck: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
