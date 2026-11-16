import {progressWeight} from './geometry.js';

export const DISCIPLINES={plumbing:'Plomberie',hvac:'Ventilation / CVC',cfo:'Électricité CFO',cfa:'Électricité CFA',sprinkler:'Sprinklers',other:'Autre réseau'};
export const BLOCKER_STATUSES={open:'Ouvert',assigned:'Affecté',in_progress:'En traitement',resolved:'Résolu',closed:'Vérifié / clos'};
export const mepPercent=el=>progressWeight(el)*100;
export const mepUnit=el=>el.mep?.quantityMode==='manual'||el.mep?.quantityMode==='estimate'?el.mep.unit:({point:'u',line:'m',area:'m²'}[el.kind]||'u');
export const isOpenBlocker=b=>!['resolved','closed'].includes(b.status);
export const isBlocking=el=>(el.blockers||[]).some(b=>b.blocksProgress&&isOpenBlocker(b));
export function plannedQuantity(el,state){
  if(el.mep?.quantityMode==='manual'||el.mep?.quantityMode==='estimate')return Number(el.mep.plannedQuantity)>0?Number(el.mep.plannedQuantity):0;
  if(el.kind==='point')return 1;
  const scale=state.calibrations?.[`${el.docId}:${el.page}`];if(!Number.isFinite(scale)||scale<=0)return 0;
  const pts=el.points||[];
  if(el.kind==='line')return pts.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-pts[i].x,p.y-pts[i].y),0)*scale;
  return Math.abs(pts.reduce((sum,p,i)=>{const q=pts[(i+1)%pts.length];return sum+p.x*q.y-q.x*p.y;},0))/2*scale*scale;
}
export const executedQuantity=(el,state)=>plannedQuantity(el,state)*progressWeight(el);
export function physicalMeasurementImpact(before,after,previousState,nextState){
  if(!before.mep&&!after.mep)return null;
  const a={quantity:before.mep?plannedQuantity(before,previousState):null,unit:before.mep?mepUnit(before):'',mode:before.mep?.quantityMode||''};
  const b={quantity:after.mep?plannedQuantity(after,nextState):null,unit:after.mep?mepUnit(after):'',mode:after.mep?.quantityMode||''};
  return a.unit!==b.unit||a.mode!==b.mode||Math.abs((a.quantity||0)-(b.quantity||0))>1e-8?{before:a,after:b}:null;
}
export function mergeRanges(ranges){
  const sorted=ranges.map(([a,b])=>[Math.max(0,Math.min(a,b)),Math.min(1,Math.max(a,b))]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b-a>1e-10).sort((a,b)=>a[0]-b[0]);
  const result=[];for(const range of sorted){const last=result.at(-1);if(last&&range[0]<=last[1]+1e-10)last[1]=Math.max(last[1],range[1]);else result.push([...range]);}return result;
}
export const rangePercent=ranges=>mergeRanges(ranges).reduce((sum,[a,b])=>sum+b-a,0)*100;
export function subtractRanges(ranges,range){
  const [cut]=mergeRanges([range]);if(!cut)return mergeRanges(ranges);const [a,b]=cut;
  return mergeRanges(ranges.flatMap(([x,y])=>y<=a||x>=b?[[x,y]]:[...(x<a?[[x,a]]:[]),...(y>b?[[b,y]]:[])]));
}
function pathMetrics(points){const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));return {distances,length:distances.at(-1)||0};}
export function projectOnPath(points,p){
  const {distances,length}=pathMetrics(points);let best={fraction:0,point:points[0]||{x:0,y:0},distance:Infinity};
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,squared=dx*dx+dy*dy;const t=squared?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/squared)):0,point={x:a.x+t*dx,y:a.y+t*dy},distance=Math.hypot(p.x-point.x,p.y-point.y);if(distance<best.distance)best={fraction:length?(distances[i-1]+t*Math.sqrt(squared))/length:0,point,distance};}return best;
}
export function splitPathRanges(points,ranges){
  const {distances,length}=pathMetrics(points);if(!length)return [];
  const slice=(start,end)=>{const at=f=>{const d=f*length;let i=1;while(i<distances.length-1&&distances[i]<d)i++;const t=(d-distances[i-1])/(distances[i]-distances[i-1]||1);return {x:points[i-1].x+(points[i].x-points[i-1].x)*t,y:points[i-1].y+(points[i].y-points[i-1].y)*t};};return [at(start),...points.filter((_,i)=>distances[i]>start*length+1e-9&&distances[i]<end*length-1e-9),at(end)];};
  const result=[];let last=0;for(const [a,b] of mergeRanges(ranges)){if(a>last)result.push({points:slice(last,a),executed:false});result.push({points:slice(a,b),executed:true});last=b;}if(last<1)result.push({points:slice(last,1),executed:false});return result;
}
export function matchesMepFilters(el,plan,filters={}){
  let companyId='',lotId='';try{[companyId,lotId]=JSON.parse(el.lotId);}catch{}
  if(filters.building&&filters.building!==plan.building||filters.level&&filters.level!==plan.level||filters.zone&&filters.zone!==(el.mep?.zone||el.room||''))return false;
  if(filters.discipline&&filters.discipline!==el.mep?.discipline||filters.network&&filters.network!==el.mep?.network||filters.companyId&&filters.companyId!==companyId||filters.lotId&&![el.lotId,lotId].includes(filters.lotId))return false;
  if(filters.networkKey&&filters.networkKey!==JSON.stringify([el.mep?.discipline,el.mep?.network,el.mep?.subnetwork||'']))return false;
  if(filters.status&&filters.status!==(isBlocking(el)?'blocked':el.status))return false;
  if(filters.openOnly&&!(el.blockers||[]).some(isOpenBlocker))return false;
  // Date filtering is the last synchronised plan update, never a claimed work date.
  const updated=plan.updatedAt?.slice(0,10);
  if(filters.dateFrom&&(!updated||updated<filters.dateFrom)||filters.dateTo&&(!updated||updated>filters.dateTo))return false;
  return true;
}
function aggregate(rows){
  const units=[...new Set(rows.map(r=>r.unit))];const byUnit={};
  for(const row of rows){const u=byUnit[row.unit]||(byUnit[row.unit]={planned:0,executed:0,validated:0});u.planned+=row.planned;u.executed+=row.executed;u.validated+=row.validated;}
  const measured=rows.filter(r=>r.planned>0||r.element.mep?.quantityMode==='estimate'),mixed=units.length>1||rows.some(r=>r.element.mep?.quantityMode==='estimate');
  const denominator=measured.reduce((n,r)=>n+(mixed?r.weight:r.planned),0);
  const ratio=(key)=>denominator?measured.reduce((n,r)=>n+(mixed?r.weight*(key==='executed'?r.percent/100:r.element.status==='checked'?1:0):r[key]),0)/denominator*100:null;
  return {byUnit,percent:ratio('executed'),checkedPercent:ratio('validated'),method:mixed?'Moyenne pondérée par les poids des ouvrages (unités différentes ou estimations)':'Quantité exécutée / quantité prévue',unmeasurable:rows.length-measured.length,estimates:rows.filter(r=>r.element.mep?.quantityMode==='estimate').length,count:rows.length};
}
export function summarizeMep(plans,filters={}){
  const rows=plans.flatMap(plan=>(plan.document?.elements||[]).filter(el=>el.mep&&matchesMepFilters(el,plan,filters)).map(element=>{
    const planned=plannedQuantity(element,plan.document),percent=mepPercent(element);
    return {element,plan,planned,executed:planned*percent/100,validated:element.status==='checked'?planned:0,percent,unit:mepUnit(element),weight:Number(element.mep.weight)||1,blocking:isBlocking(element)};
  }));
  const buckets=new Map();for(const row of rows){const el=row.element,key=JSON.stringify([row.plan.building||'',row.plan.level||'',el.mep.zone||el.room||'',el.lotId,el.mep.discipline,el.mep.network,el.mep.subnetwork||'',row.unit]);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(row);}
  const groups=[...buckets.entries()].map(([key,items])=>({key,rows:items,...aggregate(items)}));
  const blockers=rows.flatMap(row=>(row.element.blockers||[]).map(blocker=>({...row,blocker})));
  const today=new Date().toISOString().slice(0,10),openBlockers=blockers.filter(r=>isOpenBlocker(r.blocker)),lateBlockers=openBlockers.filter(r=>r.blocker.dueDate&&r.blocker.dueDate<today);
  const totals=aggregate(rows);return {...totals,totals,rows,groups,blockers,openBlockers,lateBlockers};
}
/** Reverse complete operation history to obtain a dated physical snapshot. */
export function projectMepAt(snapshot,isoDate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)||snapshot.truncated||snapshot.historyTruncated||snapshot.historyOrderingReliable===false||snapshot.localPending)throw Error('Comparaison indisponible : synchronisez le plan et chargez un historique complet et ordonné.');
  const limit=Date.parse(isoDate+'T23:59:59.999Z');if(!Number.isFinite(limit))throw Error('Date invalide.');
  const next=JSON.parse(JSON.stringify(snapshot));
  for(const op of [...(next.history||[])].reverse().sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||String(b.time).localeCompare(String(a.time)))){
    if(Date.parse(op.time)<=limit)continue;
    const plan=next.plans.find(p=>p.id===op.planId&&(!op.sourceRef||p.sourceRef===op.sourceRef));if(!plan)continue;
    for(const change of [...(op.changes||[])].reverse()){
      if(change.target==='elements'){
        const index=plan.document.elements.findIndex(e=>e.id===change.key);
        if(change.before===null){if(index>=0)plan.document.elements.splice(index,1);}
        else if(index<0)plan.document.elements.push(change.before);
        else plan.document.elements[index]={...plan.document.elements[index],...change.before};
      }else if(['calibrations','billed'].includes(change.target)){
        if(change.before===null)delete plan.document[change.target][change.key];else plan.document[change.target][change.key]=change.before;
      }
    }
  }
  next.generatedAt=isoDate+'T23:59:59.999Z';return next;
}
