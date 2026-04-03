import React, { useMemo } from 'react';
import { Platform, View, Text } from 'react-native';
import { DxfParseResult } from '@/lib/dxfParser';
import { C } from '@/constants/colors';

interface Props {
  dxf: DxfParseResult;
  visibleLayers?: string[];
  planW: number;
  planH: number;
}

function buildDxfHtml(dxf: DxfParseResult, visibleLayers: string[], W: number, H: number): string {
  const MAX_ENTITIES = 25000;
  const entities = dxf.entities.slice(0, MAX_ENTITIES);
  const bounds = {
    minX: dxf.minX, minY: dxf.minY,
    maxX: dxf.maxX, maxY: dxf.maxY,
    width: dxf.width, height: dxf.height,
  };
  const entitiesJson = JSON.stringify(entities);
  const boundsJson = JSON.stringify(bounds);
  const visJson = JSON.stringify(visibleLayers);

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>*{margin:0;padding:0;}html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent;}canvas{display:block;position:absolute;top:0;left:0;}</style>
</head><body>
<canvas id="c" style="width:${W}px;height:${H}px;"></canvas>
<script>
(function(){
var entities=${entitiesJson};
var b=${boundsJson};
var vis=${visJson};
var W=${W},H=${H};
var canvas=document.getElementById('c');
var dpr=window.devicePixelRatio||1;
canvas.width=Math.round(W*dpr);
canvas.height=Math.round(H*dpr);
var ctx=canvas.getContext('2d');
ctx.scale(dpr,dpr);

function norm(x,y){
  var pad=8;
  var scaleX=(W-pad*2)/(b.width||1);
  var scaleY=(H-pad*2)/(b.height||1);
  var s=Math.min(scaleX,scaleY);
  var dx=(W-(b.width||0)*s)/2;
  var dy=(H-(b.height||0)*s)/2;
  return{
    x:dx+(x-(b.minX||0))*s,
    y:dy+((b.maxY||0)-y)*s
  };
}

ctx.strokeStyle='rgba(96,165,250,0.9)';
ctx.fillStyle='rgba(147,197,253,0.85)';
ctx.lineWidth=0.7;
ctx.font='5px Arial';

entities.forEach(function(e){
  if(vis.length>0&&vis.indexOf(e.layer)<0)return;
  if(e.type==='LINE'){
    var p1=norm(e.x1,e.y1),p2=norm(e.x2,e.y2);
    var dx=p2.x-p1.x,dy=p2.y-p1.y;
    if(dx*dx+dy*dy<0.04)return;
    ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();
  }else if(e.type==='LWPOLYLINE'){
    var pts=e.closed?e.points.concat([e.points[0]]):e.points;
    if(pts.length<2)return;
    ctx.beginPath();
    var p0=norm(pts[0].x,pts[0].y);ctx.moveTo(p0.x,p0.y);
    for(var i=1;i<pts.length;i++){var p=norm(pts[i].x,pts[i].y);ctx.lineTo(p.x,p.y);}
    ctx.stroke();
  }else if(e.type==='CIRCLE'){
    var scX=(W-16)/(b.width||1);var scY=(H-16)/(b.height||1);
    var r=e.r*Math.min(scX,scY);
    if(r<0.3)return;
    var pc=norm(e.cx,e.cy);
    ctx.beginPath();ctx.arc(pc.x,pc.y,r,0,Math.PI*2);ctx.stroke();
  }else if(e.type==='ARC'){
    var scX2=(W-16)/(b.width||1);var scY2=(H-16)/(b.height||1);
    var r2=e.r*Math.min(scX2,scY2);
    if(r2<0.3)return;
    var pa=norm(e.cx,e.cy);
    var sa=(360-e.endAngle)*Math.PI/180;var ea=(360-e.startAngle)*Math.PI/180;
    ctx.beginPath();ctx.arc(pa.x,pa.y,r2,sa,ea);ctx.stroke();
  }else if(e.type==='TEXT'){
    var pt=norm(e.x,e.y);
    ctx.fillText(e.text||'',pt.x,pt.y);
  }
});
})();
</script>
</body></html>`;
}

export default function DxfCanvasOverlay({ dxf, visibleLayers = [], planW, planH }: Props) {
  const html = useMemo(
    () => buildDxfHtml(dxf, visibleLayers, Math.round(planW), Math.round(planH)),
    [dxf, visibleLayers, planW, planH]
  );

  if (planW < 10 || planH < 10) return null;

  if (Platform.OS === 'web') {
    return (
      <View style={{ position: 'absolute', top: 0, left: 0, width: planW, height: planH, pointerEvents: 'none' as any }}>
        {/* @ts-ignore */}
        <iframe
          srcDoc={html}
          style={{ width: planW, height: planH, border: 'none', background: 'transparent', pointerEvents: 'none' }}
          sandbox="allow-scripts"
          title="DXF overlay"
        />
        {dxf.entities.length > 25000 && (
          <View style={{ position: 'absolute', bottom: 4, left: 4, right: 4, backgroundColor: '#78350F', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
            <Text style={{ fontSize: 9, color: '#FDE68A', textAlign: 'center' }}>
              Plan tronqué — 25 000 entités max ({dxf.entities.length} au total)
            </Text>
          </View>
        )}
      </View>
    );
  }

  const WebView = require('react-native-webview').default;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, width: planW, height: planH, pointerEvents: 'none' as any }}>
      <WebView
        style={{ width: planW, height: planH, backgroundColor: 'transparent' }}
        source={{ html }}
        scrollEnabled={false}
        pointerEvents="none"
        javaScriptEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
        backgroundColor="transparent"
        scalesPageToFit={false}
      />
      {dxf.entities.length > 25000 && (
        <View style={{ position: 'absolute', bottom: 4, left: 4, right: 4, backgroundColor: '#78350F', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
          <Text style={{ fontSize: 9, color: '#FDE68A', textAlign: 'center' }}>
            Plan tronqué — 25 000 entités max ({dxf.entities.length} au total)
          </Text>
        </View>
      )}
    </View>
  );
}
