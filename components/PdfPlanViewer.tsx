import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { PlanDrawing, PlanDrawingTool, Reserve } from '@/constants/types';
import { genId } from '@/lib/utils';
import * as FileSystem from 'expo-file-system';
import * as pdfjsLib from '@/lib/pdfjs';

const STATUS_COLORS: Record<string, string> = {
  open: '#EF4444', in_progress: '#F59E0B', waiting: '#6B7280',
  verification: '#8B5CF6', closed: '#10B981',
};

const PALETTE = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#3B82F6', '#8B5CF6', '#EC4899', '#1A2742', '#FFFFFF',
];

const WIDTHS = [1, 2, 3, 5, 8];

const TOOLS: { id: PlanDrawingTool; icon: string; label: string }[] = [
  { id: 'pen',       icon: 'pencil',        label: 'Crayon' },
  { id: 'line',      icon: 'remove',        label: 'Ligne' },
  { id: 'arrow',     icon: 'arrow-forward', label: 'Flèche' },
  { id: 'rect',      icon: 'square-outline',label: 'Rect.' },
  { id: 'ellipse',   icon: 'ellipse-outline',label: 'Ellipse' },
  { id: 'text',      icon: 'text',          label: 'Texte' },
  { id: 'cloud',     icon: 'cloud-outline', label: 'Nuage' },
  { id: 'highlight', icon: 'brush-outline', label: 'Surligneur' },
];

export interface PdfPlanViewerProps {
  planUri: string;
  planId: string;
  annotations?: PlanDrawing[];
  onAnnotationsChange: (drawings: PlanDrawing[]) => void;
  reserves: Reserve[];
  pinNumberMap: Map<string, number>;
  onReserveSelect: (reserve: Reserve) => void;
  onPlanTap: (planX: number, planY: number) => void;
  canAnnotate: boolean;
  canCreate: boolean;
}

export interface PdfPlanViewerHandle {
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
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

const PdfPlanViewer = forwardRef<PdfPlanViewerHandle, PdfPlanViewerProps>((props, ref) => {
  if (Platform.OS !== 'web') {
    return <MobileViewer {...props} ref={ref as any} />;
  }
  return <WebViewer {...props} ref={ref as any} />;
});
PdfPlanViewer.displayName = 'PdfPlanViewer';
export default PdfPlanViewer;

function buildMobileHtml(
  planUri: string,
  annotations: PlanDrawing[],
  reserves: Reserve[],
  pinMap: Map<string, number>,
  canAnnotate: boolean,
  canCreate: boolean,
): string {
  const pinsData = reserves
    .filter(r => r.planX != null && r.planY != null)
    .map(r => ({
      id: r.id,
      planX: r.planX,
      planY: r.planY,
      color: STATUS_COLORS[r.status] ?? '#003082',
      num: pinMap.get(r.id) ?? '?',
    }));

  const safeAnns = JSON.stringify(annotations ?? []);
  const safePins = JSON.stringify(pinsData);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body{width:100%;height:100%;overflow:hidden;background:#0F1117;touch-action:none;}
#container{width:100%;height:100%;position:relative;overflow:hidden;}
#inner{position:absolute;top:0;left:0;transform-origin:0 0;}
#pdf-canvas{display:block;box-shadow:0 4px 24px rgba(0,0,0,0.5);}
#ann-svg{position:absolute;top:0;left:0;pointer-events:none;}
#cur-svg{position:absolute;top:0;left:0;pointer-events:all;}
#pins-layer{position:absolute;top:0;left:0;}
.pin{position:absolute;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,0.85);box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:pointer;transition:transform 0.1s;}
.pin span{color:#fff;font-size:9px;font-weight:700;font-family:Arial;line-height:1;pointer-events:none;}
#loading{position:fixed;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0F1117;}
#loading-spinner{width:36px;height:36px;border:3px solid #1E3A5F;border-top-color:#003082;border-radius:50%;animation:spin 0.8s linear infinite;}
#loading-text{color:#94A3B8;font-family:Arial;font-size:13px;}
@keyframes spin{to{transform:rotate(360deg);}}
#error-msg{position:fixed;top:0;left:0;width:100%;height:100%;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#0F1117;color:#EF4444;font-family:Arial;font-size:13px;text-align:center;padding:24px;}
#text-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;z-index:999;}
#text-input{background:#1E293B;color:#fff;border:2px solid #003082;border-radius:8px;padding:10px 14px;font-size:15px;width:240px;outline:none;font-family:Arial;}
</style>
</head><body>
<div id="loading"><div id="loading-spinner"></div><div id="loading-text">Chargement du plan…</div></div>
<div id="error-msg">Impossible de charger le plan PDF.<br>Vérifiez votre connexion et réessayez.</div>
<div id="container" style="display:none">
  <div id="inner">
    <canvas id="pdf-canvas"></canvas>
    <svg id="ann-svg" xmlns="http://www.w3.org/2000/svg"></svg>
    <svg id="cur-svg" xmlns="http://www.w3.org/2000/svg"></svg>
    <div id="pins-layer"></div>
  </div>
</div>
<div id="text-overlay"><input id="text-input" type="text" placeholder="Saisir le texte…" maxlength="80"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
(function(){
var PLAN_URI=${JSON.stringify(planUri)};
var draws=${safeAnns};
var pinsData=${safePins};
var CAN_ANNOTATE=${canAnnotate};
var CAN_CREATE=${canCreate};

var mode='view',tool='pen',color='#EF4444',sw=2;
var live=null,undos=[];
var cw=0,ch=0,pageNum=1,pageCount=0,pdfDoc=null;
var zoom=1,panX=0,panY=0;
var panning=false,panSX=0,panSY=0,panSPX=0,panSPY=0;
var pinchDist0=0,pinchZoom0=1;
var touchSX=0,touchSY=0,isDragging=false,drawing=false;
var pendingTextPos=null;

var container=document.getElementById('container');
var inner=document.getElementById('inner');
var pdfCanvas=document.getElementById('pdf-canvas');
var annSvg=document.getElementById('ann-svg');
var curSvg=document.getElementById('cur-svg');
var pinsLayer=document.getElementById('pins-layer');
var loading=document.getElementById('loading');
var errMsg=document.getElementById('error-msg');
var textOverlay=document.getElementById('text-overlay');
var textInput=document.getElementById('text-input');

function post(obj){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(obj));}}

function applyT(){inner.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')';}

function screenToCanvas(sx,sy){
  var r=container.getBoundingClientRect();
  return{x:(sx-r.left-panX)/zoom,y:(sy-r.top-panY)/zoom};
}

function toPct(cx,cy){
  return{px:Math.min(100,Math.max(0,(cx/(cw||1))*100)),py:Math.min(100,Math.max(0,(cy/(ch||1))*100))};
}

function ns(tag,attrs){
  var el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(var k in attrs)el.setAttribute(k,attrs[k]);
  return el;
}

function cloudPath(x1,y1,x2,y2){
  var sx=Math.min(x1,x2),ex=Math.max(x1,x2),sy=Math.min(y1,y2),ey=Math.max(y1,y2);
  var w=ex-sx,h=ey-sy,nx=5,ny=Math.max(2,Math.round(h/(w/nx)));
  var bw=w/nx,bh=h/ny,rx=bw*0.55,ry=bh*0.55;
  var d='M '+(sx+bw/2)+' '+sy;
  for(var i=0;i<nx;i++)d+=' a '+rx+' '+ry+' 0 0 1 '+bw+' 0';
  for(var i=0;i<ny;i++)d+=' a '+rx+' '+ry+' 0 0 1 0 '+bh;
  for(var i=0;i<nx;i++)d+=' a '+rx+' '+ry+' 0 0 1 '+(-bw)+' 0';
  for(var i=0;i<ny;i++)d+=' a '+rx+' '+ry+' 0 0 1 0 '+(-bh);
  return d+' Z';
}

function drawingToEl(d){
  var ppx=function(v){return(v/100)*cw;};
  var ppy=function(v){return(v/100)*ch;};
  var pts=d.points.map(function(p){return{x:ppx(p.x),y:ppy(p.y)};});
  if(!pts.length)return null;
  if(d.tool==='pen'){
    if(pts.length<2)return null;
    var pd=pts.map(function(p,i){return(i===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ');
    return ns('path',{d:pd,stroke:d.color,'stroke-width':d.strokeWidth,fill:'none','stroke-linecap':'round','stroke-linejoin':'round'});
  }
  if(d.tool==='line'){
    var a=pts[0],b=pts[pts.length-1];
    return ns('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:d.color,'stroke-width':d.strokeWidth,'stroke-linecap':'round'});
  }
  if(d.tool==='arrow'){
    var a=pts[0],b=pts[pts.length-1];
    var dx=b.x-a.x,dy=b.y-a.y,len=Math.sqrt(dx*dx+dy*dy);
    if(len<1)return null;
    var ux=dx/len,uy=dy/len,as=Math.max(d.strokeWidth*4,12);
    var g=ns('g',{});
    g.appendChild(ns('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:d.color,'stroke-width':d.strokeWidth,'stroke-linecap':'round'}));
    var pStr=b.x+','+b.y+' '+(b.x-as*(ux-uy*0.4))+','+(b.y-as*(uy+ux*0.4))+' '+(b.x-as*(ux+uy*0.4))+','+(b.y-as*(uy-ux*0.4));
    g.appendChild(ns('polygon',{points:pStr,fill:d.color}));
    return g;
  }
  if(d.tool==='rect'){
    var a=pts[0],b=pts[pts.length-1];
    return ns('rect',{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y),stroke:d.color,'stroke-width':d.strokeWidth,fill:'none','stroke-linejoin':'round'});
  }
  if(d.tool==='ellipse'){
    var a=pts[0],b=pts[pts.length-1];
    return ns('ellipse',{cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,rx:Math.max(1,Math.abs(b.x-a.x)/2),ry:Math.max(1,Math.abs(b.y-a.y)/2),stroke:d.color,'stroke-width':d.strokeWidth,fill:'none'});
  }
  if(d.tool==='text'){
    var el=ns('text',{x:pts[0].x,y:pts[0].y,fill:d.color,'font-size':d.fontSize||14,'font-family':'Arial,sans-serif','font-weight':'600'});
    el.textContent=d.text||'';
    return el;
  }
  if(d.tool==='cloud'){
    var a=pts[0],b=pts[pts.length-1];
    return ns('path',{d:cloudPath(a.x,a.y,b.x,b.y),stroke:d.color,'stroke-width':d.strokeWidth,fill:'none'});
  }
  if(d.tool==='highlight'){
    var a=pts[0],b=pts[pts.length-1];
    return ns('rect',{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y),fill:d.color,opacity:'0.3',stroke:d.color,'stroke-width':'1'});
  }
  return null;
}

function renderAnns(){
  while(annSvg.firstChild)annSvg.removeChild(annSvg.firstChild);
  draws.forEach(function(d){var el=drawingToEl(d);if(el)annSvg.appendChild(el);});
}

function renderLive(){
  while(curSvg.firstChild)curSvg.removeChild(curSvg.firstChild);
  if(live){var el=drawingToEl(live);if(el)curSvg.appendChild(el);}
}

function renderPins(){
  pinsLayer.innerHTML='';
  pinsData.forEach(function(pin){
    var div=document.createElement('div');
    div.className='pin';
    div.style.width='22px';div.style.height='22px';
    div.style.left=((pin.planX/100)*cw-11)+'px';
    div.style.top=((pin.planY/100)*ch-11)+'px';
    div.style.backgroundColor=pin.color;
    div.style.pointerEvents=(mode==='annotate')?'none':'all';
    var span=document.createElement('span');
    span.textContent=String(pin.num);
    div.appendChild(span);
    div.addEventListener('touchstart',function(e){e.stopPropagation();},{passive:true});
    div.addEventListener('touchend',function(e){
      e.preventDefault();e.stopPropagation();
      post({type:'pinSelect',reserveId:pin.id});
    });
    pinsLayer.appendChild(div);
  });
}

function setSvgSize(){
  [annSvg,curSvg].forEach(function(s){
    s.setAttribute('width',cw);s.setAttribute('height',ch);
    s.style.width=cw+'px';s.style.height=ch+'px';
  });
  pinsLayer.style.width=cw+'px';pinsLayer.style.height=ch+'px';
}


pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function renderPage(num){
  return pdfDoc.getPage(num).then(function(page){
    var W=window.innerWidth||600;
    var vp1=page.getViewport({scale:1});
    var scale=W/vp1.width;
    var vp=page.getViewport({scale:scale});
    var dpr=window.devicePixelRatio||1;
    pdfCanvas.width=Math.round(vp.width*dpr);
    pdfCanvas.height=Math.round(vp.height*dpr);
    pdfCanvas.style.width=vp.width+'px';
    pdfCanvas.style.height=vp.height+'px';
    cw=vp.width;ch=vp.height;
    setSvgSize();
    var ctx=pdfCanvas.getContext('2d');
    ctx.scale(dpr,dpr);
    return page.render({canvasContext:ctx,viewport:vp}).promise.then(function(){
      var contW=window.innerWidth,contH=window.innerHeight;
      zoom=1;
      panX=Math.max(0,(contW-cw)/2);
      panY=Math.max(0,(contH-ch)/2);
      applyT();
      renderAnns();
      renderPins();
    });
  });
}

pdfjsLib.getDocument({url:PLAN_URI,withCredentials:false}).promise.then(function(doc){
  pdfDoc=doc;pageCount=doc.numPages;
  post({type:'pageCount',count:pageCount});
  return renderPage(1);
}).then(function(){
  loading.style.display='none';
  container.style.display='block';
}).catch(function(){
  loading.style.display='none';
  errMsg.style.display='flex';
});

container.addEventListener('touchstart',function(e){
  e.preventDefault();
  var t=e.touches;
  if(t.length===2){
    var dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY;
    pinchDist0=Math.sqrt(dx*dx+dy*dy);
    pinchZoom0=zoom;
    panning=false;drawing=false;live=null;renderLive();
  } else if(t.length===1){
    touchSX=t[0].clientX;touchSY=t[0].clientY;isDragging=false;
    if(mode==='annotate'){
      drawing=true;
      var c=screenToCanvas(t[0].clientX,t[0].clientY);
      var p=toPct(c.x,c.y);
      if(tool==='text'){
        pendingTextPos={pctX:p.px,pctY:p.py};
        textInput.value='';
        textOverlay.style.display='flex';
        setTimeout(function(){textInput.focus();},50);
        drawing=false;
      } else {
        live={id:'live',tool:tool,points:[{x:p.px,y:p.py}],color:color,strokeWidth:sw};
        renderLive();
      }
    } else {
      panning=true;
      panSX=t[0].clientX;panSY=t[0].clientY;panSPX=panX;panSPY=panY;
    }
  }
},{passive:false});

container.addEventListener('touchmove',function(e){
  e.preventDefault();
  var t=e.touches;
  if(t.length===2){
    var dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY;
    var dist=Math.sqrt(dx*dx+dy*dy);
    var midX=(t[0].clientX+t[1].clientX)/2;
    var midY=(t[0].clientY+t[1].clientY)/2;
    var r=container.getBoundingClientRect();
    var cx=midX-r.left,cy=midY-r.top;
    var newZ=Math.min(8,Math.max(0.2,pinchZoom0*(dist/pinchDist0)));
    panX=cx-(cx-panX)*newZ/zoom;
    panY=cy-(cy-panY)*newZ/zoom;
    zoom=newZ;applyT();
  } else if(t.length===1){
    var mx=Math.abs(t[0].clientX-touchSX),my=Math.abs(t[0].clientY-touchSY);
    if(mx>4||my>4)isDragging=true;
    if(mode==='annotate'&&drawing&&live){
      var c=screenToCanvas(t[0].clientX,t[0].clientY);
      var p=toPct(c.x,c.y);
      if(live.tool==='pen'){
        live=Object.assign({},live,{points:live.points.concat([{x:p.px,y:p.py}])});
      } else {
        live=Object.assign({},live,{points:[live.points[0],{x:p.px,y:p.py}]});
      }
      renderLive();
    } else if(panning){
      panX=panSPX+(t[0].clientX-panSX);
      panY=panSPY+(t[0].clientY-panSY);
      applyT();
    }
  }
},{passive:false});

container.addEventListener('touchend',function(e){
  e.preventDefault();
  if(mode==='annotate'&&drawing&&live){
    drawing=false;
    if(live.points.length>=1){
      var fin=Object.assign({},live,{id:genId()});
      undos.push(JSON.parse(JSON.stringify(draws)));
      if(undos.length>20)undos.shift();
      draws.push(fin);
      renderAnns();
      post({type:'annotationsChange',annotations:draws});
    }
    live=null;renderLive();
  } else if(!isDragging&&mode==='view'&&CAN_CREATE&&e.changedTouches.length===1){
    var ct=e.changedTouches[0];
    var c=screenToCanvas(ct.clientX,ct.clientY);
    var p=toPct(c.x,c.y);
    if(c.x>=0&&c.x<=cw&&c.y>=0&&c.y<=ch){
      post({type:'tap',planX:p.px,planY:p.py});
    }
  }
  panning=false;isDragging=false;
},{passive:false});

textInput.addEventListener('keydown',function(e){
  if(e.key==='Enter')commitText();
  if(e.key==='Escape'){textOverlay.style.display='none';pendingTextPos=null;}
});

document.getElementById('text-overlay').addEventListener('touchend',function(e){
  if(e.target===textOverlay)commitText();
});

function commitText(){
  var val=textInput.value.trim();
  if(val&&pendingTextPos){
    var d={id:genId(),tool:'text',points:[{x:pendingTextPos.pctX,y:pendingTextPos.pctY}],color:color,strokeWidth:sw,text:val,fontSize:14};
    undos.push(JSON.parse(JSON.stringify(draws)));
    draws.push(d);renderAnns();
    post({type:'annotationsChange',annotations:draws});
  }
  textOverlay.style.display='none';pendingTextPos=null;
}

window.setState=function(s){
  if(s.mode!==undefined){mode=s.mode;renderPins();}
  if(s.tool!==undefined)tool=s.tool;
  if(s.color!==undefined)color=s.color;
  if(s.strokeWidth!==undefined)sw=s.strokeWidth;
};
window.setAnnotations=function(anns){draws=anns;renderAnns();};
window.updatePins=function(newPins){pinsData=newPins;renderPins();};
window.undo=function(){
  if(!undos.length)return;
  draws=undos.pop();renderAnns();
  post({type:'annotationsChange',annotations:draws});
};
window.clearAll=function(){
  undos.push(JSON.parse(JSON.stringify(draws)));
  draws=[];renderAnns();
  post({type:'annotationsChange',annotations:draws});
};
window.goPage=function(n){
  if(n>=1&&n<=pageCount&&pdfDoc){pageNum=n;renderPage(n);}
};
window.zoomIn=function(){
  var cx=window.innerWidth/2,cy=window.innerHeight/2;
  var nz=Math.min(8,zoom*1.35);
  panX=cx-(cx-panX)*nz/zoom;panY=cy-(cy-panY)*nz/zoom;
  zoom=nz;applyT();
};
window.zoomOut=function(){
  var cx=window.innerWidth/2,cy=window.innerHeight/2;
  var nz=Math.max(0.2,zoom/1.35);
  panX=cx-(cx-panX)*nz/zoom;panY=cy-(cy-panY)*nz/zoom;
  zoom=nz;applyT();
};
window.resetView=function(){
  zoom=1;
  panX=Math.max(0,(window.innerWidth-cw)/2);
  panY=Math.max(0,(window.innerHeight-ch)/2);
  applyT();
};
})();
</script>
</body></html>`;
}

const MobileViewer = forwardRef<PdfPlanViewerHandle, PdfPlanViewerProps>(function MobileViewerInner({
  planUri, planId, annotations, onAnnotationsChange,
  reserves, pinNumberMap, onReserveSelect, onPlanTap,
  canAnnotate, canCreate,
}, ref) {
  const WebView = require('react-native-webview').default;
  const webViewRef = useRef<any>(null);

  const isLocalUri = planUri.startsWith('file://') || planUri.startsWith('content://');
  const [resolvedUri, setResolvedUri] = useState<string>(isLocalUri ? '' : planUri);
  const [uriLoading, setUriLoading] = useState(isLocalUri);

  const MAX_BASE64_SIZE = 10 * 1024 * 1024;

  useEffect(() => {
    let cancelled = false;
    if (planUri.startsWith('file://') || planUri.startsWith('content://')) {
      setUriLoading(true);
      setResolvedUri('');
      FileSystem.getInfoAsync(planUri)
        .then(info => {
          if (cancelled) return;
          const size = info.exists && 'size' in info ? (info.size as number) : 0;
          if (size > MAX_BASE64_SIZE) {
            setResolvedUri(planUri);
            setUriLoading(false);
            return;
          }
          return FileSystem.readAsStringAsync(planUri, { encoding: FileSystem.EncodingType.Base64 });
        })
        .then(b64 => {
          if (cancelled || !b64) return;
          setResolvedUri(`data:application/pdf;base64,${b64}`);
          setUriLoading(false);
        })
        .catch(() => {
          if (!cancelled) {
            setResolvedUri(planUri);
            setUriLoading(false);
          }
        });
    } else {
      setResolvedUri(planUri);
      setUriLoading(false);
    }
    return () => { cancelled = true; };
  }, [planUri]);

  const [mode, setMode] = useState<'view' | 'annotate'>('view');
  const [tool, setTool] = useState<PlanDrawingTool>('pen');
  const [color, setColor] = useState('#EF4444');
  const [sw, setSw] = useState(2);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [showPalette, setShowPalette] = useState(false);
  const [showWidths, setShowWidths] = useState(false);
  const [showTools, setShowTools] = useState(false);

  const inject = useCallback((js: string) => {
    webViewRef.current?.injectJavaScript(`(function(){${js}})(); true;`);
  }, []);

  useImperativeHandle(ref, () => ({
    zoomIn:    () => inject('window.zoomIn && window.zoomIn();'),
    zoomOut:   () => inject('window.zoomOut && window.zoomOut();'),
    resetView: () => inject('window.resetView && window.resetView();'),
  }), [inject]);

  useEffect(() => {
    inject(`window.setState(${JSON.stringify({ mode, tool, color, strokeWidth: sw })});`);
  }, [mode, tool, color, sw]);

  useEffect(() => {
    inject(`window.setAnnotations(${JSON.stringify(annotations ?? [])});`);
  }, [planId]);

  useEffect(() => {
    const pinsData = reserves
      .filter(r => r.planX != null && r.planY != null)
      .map(r => ({
        id: r.id, planX: r.planX, planY: r.planY,
        color: STATUS_COLORS[r.status] ?? '#003082',
        num: pinNumberMap.get(r.id) ?? '?',
      }));
    inject(`window.updatePins(${JSON.stringify(pinsData)});`);
  }, [reserves, pinNumberMap]);

  const onMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'tap') {
        onPlanTap(msg.planX, msg.planY);
      } else if (msg.type === 'pinSelect') {
        const r = reserves.find(rv => rv.id === msg.reserveId);
        if (r) onReserveSelect(r);
      } else if (msg.type === 'annotationsChange') {
        onAnnotationsChange(msg.annotations);
      } else if (msg.type === 'pageCount') {
        setPageCount(msg.count);
        setPage(1);
      }
    } catch {}
  }, [reserves, onPlanTap, onReserveSelect, onAnnotationsChange]);

  const html = resolvedUri
    ? buildMobileHtml(resolvedUri, annotations ?? [], reserves, pinNumberMap, canAnnotate, canCreate)
    : '';

  function changePage(n: number) {
    if (n < 1 || n > pageCount) return;
    setPage(n);
    inject(`window.goPage(${n});`);
  }

  const hasAnns = (annotations ?? []).length > 0;

  return (
    <View style={mob.root}>
      {uriLoading && (
        <View style={[mob.root, { alignItems: 'center', justifyContent: 'center', gap: 10 }]}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={{ color: C.textMuted, fontSize: 12 }}>Préparation du plan…</Text>
        </View>
      )}
      {!uriLoading && resolvedUri ? (
      <WebView
        ref={webViewRef}
        key={resolvedUri}
        source={{ html }}
        onMessage={onMessage}
        style={mob.webview}
        javaScriptEnabled
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        originWhitelist={['*']}
        allowFileAccess
        allowUniversalAccessFromFileURLs
      />
      ) : null}

      <View style={mob.bar}>
        {pageCount > 1 && (
          <View style={mob.pageNav}>
            <TouchableOpacity style={[mob.ib, page === 1 && mob.ibOff]} onPress={() => changePage(page - 1)} disabled={page === 1}>
              <Ionicons name="chevron-back" size={13} color={page === 1 ? C.textMuted : C.text} />
            </TouchableOpacity>
            <Text style={mob.pageLabel}>{page}/{pageCount}</Text>
            <TouchableOpacity style={[mob.ib, page === pageCount && mob.ibOff]} onPress={() => changePage(page + 1)} disabled={page === pageCount}>
              <Ionicons name="chevron-forward" size={13} color={page === pageCount ? C.textMuted : C.text} />
            </TouchableOpacity>
          </View>
        )}

        <View style={mob.zoomRow}>
          <TouchableOpacity style={mob.ib} onPress={() => inject('window.zoomOut();')}>
            <Ionicons name="remove" size={15} color={C.text} />
          </TouchableOpacity>
          <TouchableOpacity style={mob.ib} onPress={() => inject('window.resetView();')}>
            <Ionicons name="scan-outline" size={13} color={C.text} />
          </TouchableOpacity>
          <TouchableOpacity style={mob.ib} onPress={() => inject('window.zoomIn();')}>
            <Ionicons name="add" size={15} color={C.text} />
          </TouchableOpacity>
        </View>

        {canAnnotate && (
          <TouchableOpacity
            style={[mob.modeBtn, mode === 'annotate' && mob.modeBtnOn]}
            onPress={() => {
              const next = mode === 'view' ? 'annotate' : 'view';
              setMode(next);
              setShowPalette(false);
              setShowWidths(false);
              setShowTools(false);
            }}
          >
            <Ionicons
              name={mode === 'annotate' ? 'eye-outline' : 'pencil-outline'}
              size={13}
              color={mode === 'annotate' ? '#fff' : C.primary}
            />
            <Text style={[mob.modeTxt, mode === 'annotate' && mob.modeTxtOn]}>
              {mode === 'annotate' ? 'Vue' : 'Annoter'}
            </Text>
          </TouchableOpacity>
        )}

        {mode === 'annotate' && (
          <>
            <View style={mob.sep} />
            <TouchableOpacity
              style={[mob.ib, showTools && { backgroundColor: C.primaryBg }]}
              onPress={() => { setShowTools(v => !v); setShowPalette(false); setShowWidths(false); }}
            >
              <Ionicons name={TOOLS.find(t => t.id === tool)?.icon as any ?? 'pencil'} size={14} color={showTools ? C.primary : C.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={mob.colorBtn}
              onPress={() => { setShowPalette(v => !v); setShowWidths(false); setShowTools(false); }}
            >
              <View style={[mob.colorDot, { backgroundColor: color }]} />
            </TouchableOpacity>
            <TouchableOpacity
              style={mob.widthBtn}
              onPress={() => { setShowWidths(v => !v); setShowPalette(false); setShowTools(false); }}
            >
              <View style={[mob.widthLine, { height: sw + 2, backgroundColor: color }]} />
            </TouchableOpacity>
            <View style={mob.sep} />
            <TouchableOpacity style={mob.ib} onPress={() => inject('window.undo();')}>
              <Ionicons name="arrow-undo" size={13} color={C.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[mob.ib, !hasAnns && mob.ibOff]}
              onPress={() => inject('window.clearAll();')}
              disabled={!hasAnns}
            >
              <Ionicons name="trash-outline" size={13} color={hasAnns ? '#EF4444' : C.textMuted} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {showTools && mode === 'annotate' && (
        <View style={mob.toolPanel}>
          {TOOLS.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[mob.toolRow, tool === t.id && mob.toolRowOn]}
              onPress={() => { setTool(t.id); setShowTools(false); }}
            >
              <Ionicons name={t.icon as any} size={15} color={tool === t.id ? C.primary : C.text} />
              <Text style={[mob.toolLabel, tool === t.id && { color: C.primary }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {showPalette && mode === 'annotate' && (
        <View style={mob.palette}>
          {PALETTE.map(c => (
            <TouchableOpacity
              key={c}
              style={[mob.palSwatch, { backgroundColor: c }, color === c && mob.palSwatchOn]}
              onPress={() => { setColor(c); setShowPalette(false); }}
            >
              {color === c && <Ionicons name="checkmark" size={11} color={c === '#FFFFFF' ? '#000' : '#fff'} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {showWidths && mode === 'annotate' && (
        <View style={mob.widthPanel}>
          {WIDTHS.map(w => (
            <TouchableOpacity
              key={w}
              style={[mob.widthRow, sw === w && mob.widthRowOn]}
              onPress={() => { setSw(w); setShowWidths(false); }}
            >
              <View style={[mob.widthSample, { height: w + 2, backgroundColor: color }]} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
});

const mob = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F1117', position: 'relative' as any },
  webview: { flex: 1 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 5,
    backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, flexWrap: 'wrap' as any,
  },
  pageNav: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pageLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub, paddingHorizontal: 3 },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ib: { width: 27, height: 27, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  ibOff: { opacity: 0.35 },
  modeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1.5, borderColor: C.primary,
  },
  modeBtnOn: { backgroundColor: C.primary },
  modeTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  modeTxtOn: { color: '#fff' },
  sep: { width: 1, height: 18, backgroundColor: C.border, marginHorizontal: 2 },
  colorBtn: { width: 27, height: 27, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  colorDot: { width: 15, height: 15, borderRadius: 8, borderWidth: 1.5, borderColor: C.border },
  widthBtn: { width: 27, height: 27, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2, paddingHorizontal: 3 },
  widthLine: { width: 17, borderRadius: 3 },
  toolPanel: {
    position: 'absolute' as any, bottom: 46, left: 8, right: 8,
    backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    padding: 6, flexDirection: 'row', flexWrap: 'wrap' as any, gap: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 8, zIndex: 100,
  },
  toolRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8,
    width: '48%' as any,
  },
  toolRowOn: { backgroundColor: C.primaryBg },
  toolLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text },
  palette: {
    position: 'absolute' as any, bottom: 46, left: 8,
    flexDirection: 'row', gap: 5,
    backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    padding: 7, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6, zIndex: 100,
  },
  palSwatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  palSwatchOn: { borderColor: C.text },
  widthPanel: {
    position: 'absolute' as any, bottom: 46, left: 8,
    backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    padding: 6, gap: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6, zIndex: 100, minWidth: 70,
  },
  widthRow: { paddingVertical: 7, paddingHorizontal: 8, borderRadius: 6, alignItems: 'center' },
  widthRowOn: { backgroundColor: C.primaryBg },
  widthSample: { width: 46, borderRadius: 3 },
});

const WebViewer = forwardRef<PdfPlanViewerHandle, PdfPlanViewerProps>(function WebViewerInner({ planUri, planId, annotations, onAnnotationsChange, reserves, pinNumberMap, onReserveSelect, onPlanTap, canAnnotate, canCreate }, ref) {
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
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        const doc = await pdfjsLib.getDocument({ url: planUri, withCredentials: false }).promise;
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

  useImperativeHandle(ref, () => ({
    zoomIn:    () => doZoom(1.3),
    zoomOut:   () => doZoom(1 / 1.3),
    resetView: () => resetView(),
  }));

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
});

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
