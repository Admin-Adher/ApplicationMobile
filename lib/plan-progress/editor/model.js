import {progressWeight} from './geometry.js';
export {progressWeight} from './geometry.js';
import {boot} from './bridge.js';
import {pricedUnit,pricedQuantity,measureDimensions,quantityText} from './dimensions.js';
export const LOTS=[...boot.groups];
// Keep historical quantities in the export even if a company/lot is no longer
// assignable. An authorised editor can reassign the work explicitly.
for(const el of boot.document.elements)if(!LOTS.some(lot=>lot.id===el.lotId))LOTS.push({id:el.lotId,name:'Lot à réaffecter',company:'Entreprise indisponible',icon:'building',unit:'u',price:0});
for(const [key,value] of Object.entries(boot.document.billed)){
  const prefix=boot.plan.id+':';if(!value||!key.startsWith(prefix))continue;
  const rest=key.slice(prefix.length),id=rest.slice(rest.indexOf(':')+1);
  if(!LOTS.some(lot=>lot.id===id))LOTS.push({id,name:'Lot archivé',company:'Entreprise indisponible',icon:'building',unit:'u',price:0});
}
export const STATUSES = {
  todo:{ label:'À faire', color:'#8291a3', mark:'−', weight:0, hint:'0 % réalisé' },
  progress:{ label:'En cours', color:'#d2922b', mark:'◐', weight:.5, hint:'50 % réalisé' },
  installed:{ label:'Terminé', color:'#3775bb', mark:'✓', weight:1, hint:'100 % réalisé' },
  checked:{ label:'Contrôlé', color:'#168b69', mark:'✓', weight:1, hint:'100 % validé' },
};
export const floorName=page=>`Page ${page}`;
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const num = (value, decimals=1) => new Intl.NumberFormat('fr-FR',{maximumFractionDigits:decimals}).format(value);
export const money = value => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(value);
export const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
export const lotFor = id => LOTS.find(lot=>lot.id===id) || {id,name:'Lot à réaffecter',company:'Entreprise indisponible',icon:'building',price:0,unit:'u'};
export const geometryUnitFor = element => ({point:'u',line:'m',area:'m²'}[typeof element==='string'?element:element.kind]);
export const unitFor = element => typeof element==='string'?geometryUnitFor(element):pricedUnit(element);
export const documentPageName = (doc,page) => `Page ${page}`;
export const scaleKey = (docId,page) => `${docId}:${page}`;
export const billedKey = (docId,page,lotId) => `${docId}:${page}:${lotId}`;
export function shapeQuantity(kind,points,scale) {
  if(kind==='point') return 1;
  if(!scale) return 0;
  if(kind==='line') return points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0)*scale;
  return Math.abs(points.reduce((sum,p,i)=>{const n=points[(i+1)%points.length];return sum+p.x*n.y-n.x*p.y;},0))/2*scale*scale;
}
export function geometricQuantity(element,state) {
  return shapeQuantity(element.kind,element.points,state.calibrations[scaleKey(element.docId,element.page)]);
}
export function quantity(element,state){return pricedQuantity(element,geometricQuantity(element,state));}
export function dimensionalMeasures(element,state){return measureDimensions(element,geometricQuantity(element,state));}
export function currentElements(state,docId,page,filter='all') {
  return state.elements.filter(el=>el.docId===docId && el.page===page && (filter==='all'||el.lotId===filter));
}
export function lotSummary(state,elements,lot,docId,page) {
  const group=elements.filter(el=>el.lotId===lot.id);
  let total=0,done=0,controlled=0,contract=0,realized=0,validated=0;
  const quantities={};
  for(const el of group){
    const q=quantity(el,state), weight=progressWeight(el), value=q*el.price;
    const unit=unitFor(el);quantities[unit]=(quantities[unit]||0)+q;
    total+=q;done+=q*weight;controlled+=el.status==='checked'?q:0;
    contract+=value;realized+=value*weight;validated+=el.status==='checked'?value:0;
  }
  const billed=state.billed[billedKey(docId,page,lot.id)] || 0;
  const mixed=Object.keys(quantities).length>1;
  return {lot,count:group.length,total:mixed?group.length:total,unit:mixed?'ouvrages':Object.keys(quantities)[0]||lot.unit,referenceLabel:Object.entries(quantities).map(([unit,q])=>quantityText(q,unit)).join(' · '),mixed,quantities,done,controlled,contract:roundMoney(contract),realized:roundMoney(realized),validated:roundMoney(validated),billed,
    percent:contract?realized/contract*100:(!mixed&&total?done/total*100:0),checkedPercent:contract?validated/contract*100:(!mixed&&total?controlled/total*100:0),
    proposal:roundMoney(Math.max(0,validated-billed)),overbilled:billed>roundMoney(validated)+.01};
}
export function summary(state,docId,page) {
  const elements=currentElements(state,docId,page);
  const rows=LOTS.map(lot=>lotSummary(state,elements,lot,docId,page));
  const totals=rows.reduce((sum,row)=>{for(const key of ['contract','realized','validated','billed','proposal'])sum[key]+=row[key];return sum;},{contract:0,realized:0,validated:0,billed:0,proposal:0});
  return {...totals,rows,elements,percent:totals.contract?totals.realized/totals.contract*100:0,checkedCount:elements.filter(el=>el.status==='checked').length};
}

export function initialState(){return {version:1,documents:[{...boot.plan,source:boot.pdfSource,pages:boot.plan.pages||1}],currentDoc:boot.plan.id,currentPage:1,...boot.document,history:boot.history||[],undo:[]};}
export const loadState=initialState;
