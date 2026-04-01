import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  ActivityIndicator, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { PlanDrawing, PlanDrawingTool, Reserve } from '@/constants/types';
import { genId } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  open: '#EF4444', in_progress: '#F59E0B', waiting: '#6B7280',
  verification: '#8B5CF6', closed: '#10B981',
};

const PALETTE = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#3B82F6', '#8B5CF6', '#EC4899', '#1A2742', '#FFFFFF',
];

const WIDTHS = [1, 2, 3, 5, 8];

const TOOLS: { id: PlanDrawingTool; icon: string }[] = [
  { id: 'pen',       icon: 'pencil' },
  { id: 'line',      icon: 'remove' },
  { id: 'arrow',     icon: 'arrow-forward' },
  { id: 'rect',      icon: 'square-outline' },
  { id: 'ellipse',   icon: 'ellipse-outline' },
  { id: 'text',      icon: 'text' },
  { id: 'cloud',     icon: 'cloud-outline' },
  { id: 'highlight', icon: 'brush-outline' },
];

export interface PdfPlanViewerProps {
  planUri: string;
  planId: string;
  annotations: PlanDrawing[];
  onAnnotationsChange: (drawings: PlanDrawing[]) => void;
  reserves: Reserve[];
  pinNumberMap: Map<string, number>;
  onReserveSelect: (reserve: Reserve) => void;
  onPlanTap: (planX: number, planY: number) => void;
  canAnnotate: boolean;
  canCreate: boolean;
}

function cloudPath(x1: number, y1: number, x2: number, y2: number): string {
  const sx = Math.min(x1, x2), ex = Math.max(x1, x2);
  const sy = Math.min(y1, y2), ey = Math.max(y1, y2);
  const w = ex - sx, h = ey - sy;
  const nx = 5, ny = Math.max(2, Math.round(h / (w / nx)));
  const bw = w / nx, bh = h / ny;
  const rx = bw * 0.55, ry = bh * 0.55;
  let d = `M ${sx + bw / 2} ${sy}`;
  for (let i = 0; i < nx; i++) d += ` a ${rx} ${ry} 0 0 1 ${bw} 0`;
  for (let i = 0; i < ny; i++) d += ` a ${rx} ${ry} 0 0 1 0 ${bh}`;
  for (let i = 0; i < nx; i++) d += ` a ${rx} ${ry} 0 0 1 ${-bw} 0`;
  for (let i = 0; i < ny; i++) d += ` a ${rx} ${ry} 0 0 1 0 ${-bh}`;
  return d + ' Z';
}

function annSvg(d: PlanDrawing, cw: number, ch: number): React.ReactElement | null {
  const px = (v: number) => (v / 100) * cw;
  const py = (v: number) => (v / 100) * ch;
  const pts = d.points.map(p => ({ x: px(p.x), y: py(p.y) }));
  if (!pts.length) return null;
  const c = d.color, sw = d.strokeWidth;
  const k = d.id;

  if (d.tool === 'pen') {
    if (pts.length < 2) return null;
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return <path key={k} d={path} stroke={c} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (d.tool === 'line') {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    return <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c} strokeWidth={sw} strokeLinecap="round" />;
  }
  if (d.tool === 'arrow') {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return null;
    const ux = dx / len, uy = dy / len, as = Math.max(sw * 4, 12);
    const ax1 = b.x - as * (ux - uy * 0.4), ay1 = b.y - as * (uy + ux * 0.4);
    const ax2 = b.x - as * (ux + uy * 0.4), ay2 = b.y - as * (uy - ux * 0.4);
    return (
      <g key={k}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c} strokeWidth={sw} strokeLinecap="round" />
        <polygon points={`${b.x},${b.y} ${ax1},${ay1} ${ax2},${ay2}`} fill={c} />
      </g>
    );
  }
  if (d.tool === 'rect') {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    return <rect key={k} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)}
      width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)}
      stroke={c} strokeWidth={sw} fill="none" strokeLinejoin="round" />;
  }
  if (d.tool === 'ellipse') {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    return <ellipse key={k} cx={cx} cy={cy}
      rx={Math.max(1, Math.abs(b.x - a.x) / 2)} ry={Math.max(1, Math.abs(b.y - a.y) / 2)}
      stroke={c} strokeWidth={sw} fill="none" />;
  }
  if (d.tool === 'text') {
    return <text key={k} x={pts[0].x} y={pts[0].y} fill={c}
      fontSize={d.fontSize ?? 14} fontFamily="Arial,sans-serif" fontWeight="600">
      {d.text ?? ''}
    </text>;
  }
  if (d.tool === 'cloud') {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    return <path key={k} d={cloudPath(a.x, a.y, b.x, b.y)} stroke={c} strokeWidth={sw} fill="none" />;
  }
  if (d.tool === 'highlight') {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    return <rect key={k} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)}
      width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)}
      fill={c} opacity={0.3} stroke={c} strokeWidth={1} />;
  }
  return null;
}

function MobileFallback({ planUri, reserves, pinNumberMap, onReserveSelect }: {
  planUri: string; reserves: Reserve[]; pinNumberMap: Map<string, number>; onReserveSelect: (r: Reserve) => void;
}) {
  const pinned = reserves.filter(r => r.planX != null);
  return (
    <View style={fb.root}>
      <View style={fb.icon}><Ionicons name="document-text" size={40} color={C.primary} /></View>
      <Text style={fb.title}>Plan PDF</Text>
      <Text style={fb.sub}>Annotation vectorielle disponible sur navigateur web</Text>
      <TouchableOpacity style={fb.btn} onPress={() => Linking.openURL(planUri)}>
        <Ionicons name="open-outline" size={14} color="#fff" />
        <Text style={fb.btnText}>Ouvrir</Text>
      </TouchableOpacity>
      {pinned.length > 0 && <Text style={fb.count}>{pinned.length} réserve{pinned.length > 1 ? 's' : ''} positionnée{pinned.length > 1 ? 's' : ''}</Text>}
    </View>
  );
}
const fb = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#1A2742' },
  icon: { width: 64, height: 64, borderRadius: 16, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  sub: { fontSize: 12, color: C.textMuted, textAlign: 'center', paddingHorizontal: 24, fontFamily: 'Inter_400Regular' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8 },
  btnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  count: { fontSize: 11, color: C.textMuted, fontFamily: 'Inter_400Regular' },
});

export default function PdfPlanViewer(props: PdfPlanViewerProps) {
  if (Platform.OS !== 'web') {
    return <MobileFallback planUri={props.planUri} reserves={props.reserves} pinNumberMap={props.pinNumberMap} onReserveSelect={props.onReserveSelect} />;
  }
  return <WebViewer {...props} />;
}

function WebViewer({ planUri, planId, annotations, onAnnotationsChange, reserves, pinNumberMap, onReserveSelect, onPlanTap, canAnnotate, canCreate }: PdfPlanViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [cw, setCw] = useState(0);
  const [ch, setCh] = useState(0);

  const [mode, setMode] = useState<'view' | 'annotate'>('view');
  const [tool, setTool] = useState<PlanDrawingTool>('pen');
  const [color, setColor] = useState('#EF4444');
  const [sw, setSw] = useState(2);
  const [draws, setDraws] = useState<PlanDrawing[]>(annotations ?? []);
  const [live, setLive] = useState<PlanDrawing | null>(null);
  const [undos, setUndos] = useState<PlanDrawing[][]>([]);
  const [textPos, setTextPos] = useState<{ px: number; py: number; pctX: number; pctY: number } | null>(null);
  const [textVal, setTextVal] = useState('');
  const [showPalette, setShowPalette] = useState(false);
  const [showWidths, setShowWidths] = useState(false);

  const zoomRef = useRef(1);
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const panning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const downPos = useRef({ x: 0, y: 0 });
  const pinchDist = useRef(0);
  const pinchZoom = useRef(1);

  const applyT = useCallback(() => {
    if (!innerRef.current) return;
    innerRef.current.style.transform = `translate(${panXRef.current}px,${panYRef.current}px) scale(${zoomRef.current})`;
  }, []);

  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (screenX - rect.left - panXRef.current) / zoomRef.current,
      y: (screenY - rect.top - panYRef.current) / zoomRef.current,
    };
  }, []);

  const toPercent = (canvasX: number, canvasY: number) => ({
    px: Math.min(100, Math.max(0, (canvasX / (cw || 1)) * 100)),
    py: Math.min(100, Math.max(0, (canvasY / (ch || 1)) * 100)),
  });

  useEffect(() => { setDraws(annotations ?? []); }, [planId]);

  useEffect(() => {
    if (!planUri) return;
    let dead = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const lib = await import('pdfjs-dist');
        if (!lib.GlobalWorkerOptions.workerSrc) {
          lib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
        }
        const doc = await lib.getDocument({ url: planUri, withCredentials: false }).promise;
        if (dead) return;
        pdfDocRef.current = doc;
        setPageCount(doc.numPages);
        setPage(1);
      } catch {
        if (!dead) setError('Impossible de charger le PDF.');
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [planUri]);

  useEffect(() => {
    if (!pdfDocRef.current || !canvasRef.current) return;
    let dead = false;
    (async () => {
      try {
        renderTaskRef.current?.cancel();
        const pg = await pdfDocRef.current.getPage(page);
        if (dead) return;
        const el = containerRef.current;
        const w = el ? el.clientWidth || 600 : 600;
        const vp1 = pg.getViewport({ scale: 1 });
        const scale = w / vp1.width;
        const vp = pg.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;
        const canvas = canvasRef.current!;
        canvas.width = Math.round(vp.width * dpr);
        canvas.height = Math.round(vp.height * dpr);
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;
        const newW = vp.width, newH = vp.height;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(dpr, dpr);
        const task = pg.render({ canvasContext: ctx, viewport: vp });
        renderTaskRef.current = task;
        await task.promise;
        if (!dead) {
          renderTaskRef.current = null;
          setCw(newW); setCh(newH);
          const cont = containerRef.current;
          if (cont) {
            const cRect = cont.getBoundingClientRect();
            panXRef.current = Math.max(0, (cRect.width - newW) / 2);
            panYRef.current = Math.max(0, (cRect.height - newH) / 2);
            applyT();
          }
        }
      } catch (e: any) {
        if (!dead && e?.name !== 'RenderingCancelledException') setError('Erreur de rendu.');
      }
    })();
    return () => { dead = true; };
  }, [page, planUri, pdfDocRef.current]);

  const onSvgDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode !== 'annotate') return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    const { px, py } = toPercent(x, y);
    if (tool === 'text') { setTextPos({ px: x, py: y, pctX: px, pctY: py }); setTextVal(''); return; }
    setLive({ id: 'live', tool, points: [{ x: px, y: py }], color, strokeWidth: sw, page });
  };

  const onSvgMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!live || mode !== 'annotate') return;
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    const { px, py } = toPercent(x, y);
    setLive(prev => {
      if (!prev) return null;
      return prev.tool === 'pen'
        ? { ...prev, points: [...prev.points, { x: px, y: py }] }
        : { ...prev, points: [prev.points[0], { x: px, y: py }] };
    });
  };

  const onSvgUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!live || mode !== 'annotate') return;
    const fin = { ...live, id: genId() };
    setLive(null);
    const moved = Math.abs(e.clientX - downPos.current.x) + Math.abs(e.clientY - downPos.current.y);
    if (fin.tool !== 'pen' && moved < 3) return;
    if (fin.points.length < 1) return;
    setUndos(u => [...u.slice(-19), [...draws]]);
    const next = [...draws, fin];
    setDraws(next);
    onAnnotationsChange(next);
  };

  const onContainerDown = (e: React.MouseEvent<HTMLDivElement>) => {
    downPos.current = { x: e.clientX, y: e.clientY };
    if (mode === 'annotate') return;
    if ((e.target as HTMLElement).closest('[data-pin]')) return;
    panning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, px: panXRef.current, py: panYRef.current };
    e.currentTarget.style.cursor = 'grabbing';
  };

  const onContainerMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!panning.current) return;
    panXRef.current = panStart.current.px + (e.clientX - panStart.current.x);
    panYRef.current = panStart.current.py + (e.clientY - panStart.current.y);
    applyT();
  };

  const onContainerUp = (e: React.MouseEvent<HTMLDivElement>) => {
    panning.current = false;
    e.currentTarget.style.cursor = mode === 'annotate' ? 'crosshair' : 'grab';
    if (mode === 'view' && canCreate && cw > 0) {
      const moved = Math.abs(e.clientX - downPos.current.x) + Math.abs(e.clientY - downPos.current.y);
      if (moved < 6 && !(e.target as HTMLElement).closest('[data-pin]')) {
        const { x, y } = screenToCanvas(e.clientX, e.clientY);
        const { px, py } = toPercent(x, y);
        if (px >= 0 && px <= 100 && py >= 0 && py <= 100) {
          onPlanTap(px, py);
        }
      }
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const newZ = Math.min(8, Math.max(0.2, zoomRef.current * delta));
    panXRef.current = cx - (cx - panXRef.current) * newZ / zoomRef.current;
    panYRef.current = cy - (cy - panYRef.current) * newZ / zoomRef.current;
    zoomRef.current = newZ;
    applyT();
  };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDist.current = Math.sqrt(dx * dx + dy * dy);
      pinchZoom.current = zoomRef.current;
    } else if (e.touches.length === 1 && mode === 'view') {
      panning.current = true;
      panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, px: panXRef.current, py: panYRef.current };
    }
  };

  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      const newZ = Math.min(8, Math.max(0.2, pinchZoom.current * (dist / pinchDist.current)));
      panXRef.current = cx - (cx - panXRef.current) * newZ / zoomRef.current;
      panYRef.current = cy - (cy - panYRef.current) * newZ / zoomRef.current;
      zoomRef.current = newZ;
      applyT();
    } else if (e.touches.length === 1 && panning.current) {
      panXRef.current = panStart.current.px + (e.touches[0].clientX - panStart.current.x);
      panYRef.current = panStart.current.py + (e.touches[0].clientY - panStart.current.y);
      applyT();
    }
  };

  const onTouchEnd = () => { panning.current = false; };

  function doZoom(factor: number) {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const newZ = Math.min(8, Math.max(0.2, zoomRef.current * factor));
    panXRef.current = cx - (cx - panXRef.current) * newZ / zoomRef.current;
    panYRef.current = cy - (cy - panYRef.current) * newZ / zoomRef.current;
    zoomRef.current = newZ;
    applyT();
  }

  function resetView() {
    if (!containerRef.current || cw === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const fitW = rect.width / cw, fitH = rect.height / ch;
    zoomRef.current = Math.min(fitW, fitH, 1);
    panXRef.current = (rect.width - cw * zoomRef.current) / 2;
    panYRef.current = (rect.height - ch * zoomRef.current) / 2;
    applyT();
  }

  function undo() {
    if (!undos.length) return;
    const prev = undos[undos.length - 1];
    setUndos(u => u.slice(0, -1));
    setDraws(prev);
    onAnnotationsChange(prev);
  }

  function clearAll() {
    setUndos(u => [...u.slice(-19), [...draws]]);
    setDraws([]); onAnnotationsChange([]);
  }

  function commitText() {
    if (!textPos || !textVal.trim()) { setTextPos(null); return; }
    const d: PlanDrawing = {
      id: genId(), tool: 'text',
      points: [{ x: textPos.pctX, y: textPos.pctY }],
      color, strokeWidth: sw, text: textVal.trim(), fontSize: 14, page,
    };
    setUndos(u => [...u.slice(-19), [...draws]]);
    const next = [...draws, d];
    setDraws(next); onAnnotationsChange(next);
    setTextPos(null); setTextVal('');
  }

  const pageAnns = draws.filter(d => !d.page || d.page === page);
  const pinsOnPage = reserves.filter(r => r.planX != null && r.planY != null);

  return (
    <View style={s.root}>
      {loading && (
        <View style={s.overlay}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={s.overlayText}>Chargement…</Text>
        </View>
      )}
      {error && !loading && (
        <View style={s.overlay}>
          <Ionicons name="warning-outline" size={32} color="#EF4444" />
          <Text style={[s.overlayText, { color: '#EF4444', textAlign: 'center', paddingHorizontal: 24 }]}>{error}</Text>
        </View>
      )}
      {!loading && !error && (
        <div
          ref={containerRef as any}
          onMouseDown={onContainerDown as any}
          onMouseMove={onContainerMove as any}
          onMouseUp={onContainerUp as any}
          onMouseLeave={onContainerUp as any}
          onWheel={onWheel as any}
          onTouchStart={onTouchStart as any}
          onTouchMove={onTouchMove as any}
          onTouchEnd={onTouchEnd as any}
          style={{
            flex: 1, overflow: 'hidden', position: 'relative',
            cursor: mode === 'annotate' ? 'crosshair' : 'grab',
            userSelect: 'none', backgroundColor: '#1A2742',
            width: '100%', height: '100%',
          } as any}
        >
          <div
            ref={innerRef as any}
            style={{
              position: 'absolute', top: 0, left: 0,
              transformOrigin: '0 0',
              transform: 'translate(0px,0px) scale(1)',
            } as any}
          >
            <canvas ref={canvasRef as any}
              style={{ display: 'block', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' } as any}
            />
            {cw > 0 && ch > 0 && (
              <svg
                width={cw} height={ch}
                style={{
                  position: 'absolute', top: 0, left: 0, width: cw, height: ch,
                  pointerEvents: mode === 'annotate' ? 'all' : 'none',
                  cursor: mode === 'annotate' ? 'crosshair' : 'default',
                } as any}
                onPointerDown={onSvgDown as any}
                onPointerMove={onSvgMove as any}
                onPointerUp={onSvgUp as any}
              >
                {pageAnns.map(d => annSvg(d, cw, ch))}
                {live && annSvg(live, cw, ch)}
              </svg>
            )}
            {cw > 0 && pinsOnPage.map(r => {
              const col = STATUS_COLORS[r.status] ?? C.primary;
              const num = pinNumberMap.get(r.id) ?? '?';
              return (
                <div
                  key={r.id}
                  data-pin
                  onClick={(e: any) => { e.stopPropagation(); onReserveSelect(r); }}
                  style={{
                    position: 'absolute',
                    left: (r.planX! / 100) * cw - 11,
                    top: (r.planY! / 100) * ch - 11,
                    width: 22, height: 22, borderRadius: 11,
                    backgroundColor: col,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                    border: '2px solid rgba(255,255,255,0.85)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    zIndex: 10,
                    pointerEvents: mode === 'annotate' ? 'none' : 'all',
                    transition: 'transform 0.12s',
                    userSelect: 'none',
                  } as any}
                  onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'scale(1.25)'; }}
                  onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  <span style={{ color: '#fff', fontSize: 9, fontWeight: '700', fontFamily: 'Arial' } as any}>
                    {num}
                  </span>
                </div>
              );
            })}
            {textPos && cw > 0 && (
              <div style={{ position: 'absolute', left: textPos.px, top: textPos.py, zIndex: 20 } as any}>
                <input
                  autoFocus
                  value={textVal}
                  onChange={(e: any) => setTextVal(e.target.value)}
                  onKeyDown={(e: any) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextPos(null); }}
                  onBlur={commitText}
                  placeholder="Texte…"
                  style={{
                    background: 'rgba(255,255,255,0.95)', border: `2px solid ${color}`,
                    borderRadius: 4, padding: '2px 8px', fontSize: 14, color: color,
                    fontWeight: 600, outline: 'none', minWidth: 90,
                  } as any}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <View style={s.bar}>
        {pageCount > 1 && (
          <View style={s.pageNav}>
            <TouchableOpacity style={[s.ib, page === 1 && s.ibOff]} onPress={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <Ionicons name="chevron-back" size={13} color={page === 1 ? C.textMuted : C.text} />
            </TouchableOpacity>
            <Text style={s.pageLabel}>{page}/{pageCount}</Text>
            <TouchableOpacity style={[s.ib, page === pageCount && s.ibOff]} onPress={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page === pageCount}>
              <Ionicons name="chevron-forward" size={13} color={page === pageCount ? C.textMuted : C.text} />
            </TouchableOpacity>
          </View>
        )}

        <View style={s.zoomRow}>
          <TouchableOpacity style={s.ib} onPress={() => doZoom(1 / 1.3)}><Ionicons name="remove" size={15} color={C.text} /></TouchableOpacity>
          <TouchableOpacity style={s.ib} onPress={resetView}><Ionicons name="scan-outline" size={13} color={C.text} /></TouchableOpacity>
          <TouchableOpacity style={s.ib} onPress={() => doZoom(1.3)}><Ionicons name="add" size={15} color={C.text} /></TouchableOpacity>
        </View>

        {canAnnotate && (
          <TouchableOpacity
            style={[s.modeBtn, mode === 'annotate' && s.modeBtnOn]}
            onPress={() => { setMode(m => m === 'view' ? 'annotate' : 'view'); setShowPalette(false); setShowWidths(false); }}
          >
            <Ionicons name={mode === 'annotate' ? 'eye-outline' : 'pencil-outline'} size={13} color={mode === 'annotate' ? '#fff' : C.primary} />
            <Text style={[s.modeTxt, mode === 'annotate' && s.modeTxtOn]}>{mode === 'annotate' ? 'Vue' : 'Annoter'}</Text>
          </TouchableOpacity>
        )}

        {mode === 'annotate' && (
          <>
            <View style={s.sep} />
            <View style={s.toolRow}>
              {TOOLS.map(t => (
                <TouchableOpacity key={t.id} style={[s.tb, tool === t.id && s.tbOn]} onPress={() => { setTool(t.id); setShowPalette(false); setShowWidths(false); }}>
                  <Ionicons name={t.icon as any} size={14} color={tool === t.id ? '#fff' : C.text} />
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.sep} />
            <TouchableOpacity style={s.colorBtn} onPress={() => { setShowPalette(v => !v); setShowWidths(false); }}>
              <View style={[s.colorDot, { backgroundColor: color }]} />
            </TouchableOpacity>
            <TouchableOpacity style={s.widthBtn} onPress={() => { setShowWidths(v => !v); setShowPalette(false); }}>
              <View style={[s.widthLine, { height: sw + 2, backgroundColor: color }]} />
            </TouchableOpacity>
            <View style={s.sep} />
            <TouchableOpacity style={[s.ib, !undos.length && s.ibOff]} onPress={undo} disabled={!undos.length}>
              <Ionicons name="arrow-undo" size={13} color={!undos.length ? C.textMuted : C.text} />
            </TouchableOpacity>
            <TouchableOpacity style={[s.ib, !draws.length && s.ibOff]} onPress={clearAll} disabled={!draws.length}>
              <Ionicons name="trash-outline" size={13} color={!draws.length ? C.textMuted : '#EF4444'} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {showPalette && mode === 'annotate' && (
        <View style={s.palette}>
          {PALETTE.map(c => (
            <TouchableOpacity key={c} style={[s.palSwatch, { backgroundColor: c }, color === c && s.palSwatchOn]}
              onPress={() => { setColor(c); setShowPalette(false); }}>
              {color === c && <Ionicons name="checkmark" size={11} color={c === '#FFFFFF' ? '#000' : '#fff'} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {showWidths && mode === 'annotate' && (
        <View style={s.widthPanel}>
          {WIDTHS.map(w => (
            <TouchableOpacity key={w} style={[s.widthRow, sw === w && s.widthRowOn]} onPress={() => { setSw(w); setShowWidths(false); }}>
              <View style={[s.widthSample, { height: w + 2, backgroundColor: color }]} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1A2742', position: 'relative' as any, overflow: 'hidden' as any },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#1A2742', zIndex: 50 },
  overlayText: { fontSize: 12, color: C.textMuted, fontFamily: 'Inter_400Regular' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, flexWrap: 'wrap' as any },
  pageNav: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pageLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub, paddingHorizontal: 3 },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ib: { width: 27, height: 27, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  ibOff: { opacity: 0.35 },
  modeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5, borderColor: C.primary },
  modeBtnOn: { backgroundColor: C.primary },
  modeTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  modeTxtOn: { color: '#fff' },
  sep: { width: 1, height: 18, backgroundColor: C.border, marginHorizontal: 2 },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tb: { width: 27, height: 27, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  tbOn: { backgroundColor: C.primary },
  colorBtn: { width: 27, height: 27, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  colorDot: { width: 15, height: 15, borderRadius: 8, borderWidth: 1.5, borderColor: C.border },
  widthBtn: { width: 27, height: 27, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2, paddingHorizontal: 3 },
  widthLine: { width: 17, borderRadius: 3 },
  palette: { position: 'absolute' as any, bottom: 46, left: 8, flexDirection: 'row', gap: 5, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 7, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6, zIndex: 100 },
  palSwatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  palSwatchOn: { borderColor: C.text },
  widthPanel: { position: 'absolute' as any, bottom: 46, left: 8, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 6, gap: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6, zIndex: 100, minWidth: 70 },
  widthRow: { paddingVertical: 7, paddingHorizontal: 8, borderRadius: 6, alignItems: 'center' },
  widthRowOn: { backgroundColor: C.primaryBg },
  widthSample: { width: 46, borderRadius: 3 },
});
