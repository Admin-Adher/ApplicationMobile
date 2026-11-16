import {boot,request} from './bridge.js';
import {lotFor,STATUSES,escapeHtml as e} from './model.js';
import {plannedQuantity,executedQuantity,mepPercent,mepUnit,isBlocking,matchesMepFilters,summarizeMep,splitPathRanges} from './mep-calculations.js';
import {workActivity,responsibleLabel} from './mep-audit.js';
import {effectiveMepPlans} from './mep-plan-scope.js';

const disciplines={plumbing:'Plomberie / eau',hvac:'CVC / ventilation',cfo:'Électricité CFO',cfa:'Électricité CFA',sprinkler:'Sprinklers',other:'Autre réseau'};
const blockerStatuses={open:'Ouvert',assigned:'Affecté',in_progress:'En traitement',resolved:'Résolu',closed:'Vérifié / clos'};
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const format=value=>number(value)===null?'Non mesuré':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3}).format(value);
const active=blocker=>!['resolved','closed'].includes(blocker.status);
const person=id=>(boot.people||[]).find(person=>person.id===id)?.name||id||'Non désigné';
const generated=()=>new Date().toISOString();
const text=value=>String(value??'');

/** The current durable local document supersedes the remote snapshot for this PDF only. */
export function mepExportPlans(state,snapshot){return effectiveMepPlans(state,snapshot,boot.plan);}

export function matchesMepExportFilters(el,plan,filters={}){
  const mep=el.mep||{},lot=lotFor(el.lotId);
  const normalized=Object.fromEntries(Object.entries(filters).filter(([,value])=>value!=='all'));
  if(!matchesMepFilters(el,plan,normalized))return false;
  if(filters.page&&Number(filters.page)!==Number(el.page))return false;
  if(filters.openOnly&&!(el.blockers||[]).some(active))return false;
  if(filters.search&&!`${el.reference} ${el.name} ${mep.network} ${mep.subnetwork} ${mep.zone} ${lot.company}`.toLocaleLowerCase('fr').includes(text(filters.search).toLocaleLowerCase('fr')))return false;
  return true;
}

export function mepExportRows(state,snapshot,filters={}){
  const plans=mepExportPlans(state,snapshot),works=[],blockers=[];
  const scope=(snapshot?'Chantier — versions actuelles des plans':'PDF courant — toutes les pages')+(filters.openOnly?' · points ouverts uniquement et ouvrages concernés':'');
  for(const plan of plans){
    const document=plan.document||{elements:[],calibrations:{}};
    for(const el of document.elements||[]){
      if(!el.mep||!matchesMepExportFilters(el,plan,filters))continue;
      const mep=el.mep||{},lot=lotFor(el.lotId),measured=number(plannedQuantity(el,document)),planned=measured>0?measured:null,executed=planned===null?null:number(executedQuantity(el,document));
      const progress=number(mepPercent(el))??0;
      const activity=workActivity(state,plan,el,snapshot?.history||[]);
      const common={plan,el,building:plan.building||'Sans bâtiment',level:plan.level||`Page ${el.page}`,zone:mep.zone||el.room||'Non renseignée',discipline:disciplines[mep.discipline]||'Non classé MEP',network:mep.network||'Non renseigné',subnetwork:mep.subnetwork||'',company:lot.company,lot:lot.name,planned,executed,unit:mepUnit(el),percent:progress/100,validated:el.status==='checked'?executed:0,method:mep.quantityMode==='estimate'?'Estimation manuelle':mep.quantityMode==='manual'?'Quantité prévue saisie':'Mesure du tracé / échelle de la page',weight:number(mep.weight)??1,
        workResponsible:responsibleLabel(el,boot.people||[],lot.company),updatedAt:activity.updatedAt||null,updatedBy:activity.authorName||'',updatePending:Boolean(activity.pending),exportScope:scope};
      works.push(common);
      for(const blocker of el.blockers||[]){
        if(filters.openOnly&&!active(blocker))continue;
        const company=(boot.groups||[]).find(group=>group.companyId===blocker.companyId)?.company||blocker.companyId;
        blockers.push({...common,blocker,number:blockers.length+1,responsible:person(blocker.responsibleId),responsibleCompany:company||lot.company,overdue:active(blocker)&&Boolean(blocker.dueDate)&&blocker.dueDate<generated().slice(0,10)});
      }
    }
  }
  return {plans,works,blockers,scope,generatedAt:generated(),snapshotAt:snapshot?.generatedAt||null,truncated:Boolean(snapshot?.truncated),historyPartial:!snapshot||Boolean(snapshot.historyTruncated)};
}

const workColumns=['Bâtiment','Niveau','Zone / local','Plan','Indice / révision','Page','Discipline','Réseau','Sous-réseau','Référence','Ouvrage','Entreprise','Lot','Prévu','Exécuté','Unité','Avancement','Vérifié','Méthode de calcul','Poids de consolidation','État','Blocage actif','Note','Identifiant du plan','Identifiant du tronçon','Portions exécutées normalisées (JSON)','Responsable du tronçon','Dernière mise à jour du tronçon UTC','Auteur de mise à jour','Source de mise à jour','Périmètre de l’export'];
function workCells(row){return [row.building,row.level,row.zone,row.plan.name,row.plan.revision||'',row.el.page,row.discipline,row.network,row.subnetwork,row.el.reference||'',row.el.name,row.company,row.lot,row.planned,row.executed,row.unit,row.percent,row.validated,row.method,row.weight,STATUSES[row.el.status]?.label||row.el.status,isBlocking(row.el)?'Oui':'Non',row.el.note||'',row.plan.id,row.el.id,row.el.executedRanges?JSON.stringify(row.el.executedRanges):'',row.workResponsible,row.updatedAt||'',row.updatedBy,row.updatePending?'Locale — synchronisation en attente':row.updatedAt?'Synchronisée':'Non renseignée',row.exportScope];}
const blockerColumns=['Repère','Bâtiment','Niveau','Zone / local','Plan','Indice / révision','Page','Réseau','Tronçon','Description','Entreprise responsable','Responsable','Ouverture UTC','Échéance','Statut','Bloque la progression','Priorité','En retard','Nombre de photos','Identifiant du blocage','Identifiant du tronçon','Position X','Position Y'];
function blockerCells(row){const b=row.blocker;return [row.number,row.building,row.level,row.zone,row.plan.name,row.plan.revision||'',row.el.page,row.network,row.el.reference||row.el.name,b.description,row.responsibleCompany,row.responsible,b.openedAt,b.dueDate||'',blockerStatuses[b.status]||b.status,b.blocksProgress?'Oui':'Non',b.priority,row.overdue?'Oui':'Non',(b.photoRefs||[]).length,b.id,row.el.id,b.point?.x,b.point?.y];}

export function appendMepSheets(book,XLSX,state,snapshot=null,filters={}){
  const data=mepExportRows(state,snapshot,filters);
  const works=XLSX.utils.aoa_to_sheet([workColumns,...data.works.map(workCells)]);
  works['!cols']=workColumns.map((_,index)=>({wch:[0,1,2,3,6,7,8,9,10,11,12,18,22].includes(index)?32:20}));
  works['!autofilter']={ref:`A1:${XLSX.utils.encode_col(workColumns.length-1)}${Math.max(1,data.works.length+1)}`};
  for(let i=2;i<=data.works.length+1;i++){
    if(works[`Q${i}`])works[`Q${i}`].z='0.0%';
    for(const column of ['N','O','R'])if(works[`${column}${i}`])works[`${column}${i}`].z='0.######';
  }
  XLSX.utils.book_append_sheet(book,works,'Réseaux MEP');
  const blockers=XLSX.utils.aoa_to_sheet([blockerColumns,...data.blockers.map(blockerCells)]);
  blockers['!cols']=blockerColumns.map((_,i)=>({wch:i===9?80:[1,3,4,7,8,10,11].includes(i)?32:22}));
  blockers['!autofilter']={ref:`A1:W${Math.max(1,data.blockers.length+1)}`};
  XLSX.utils.book_append_sheet(book,blockers,'Points bloquants');
  return data;
}

function addMepSummary(book,XLSX,data){
  const plans=data.plans.map(plan=>({...plan,document:{...plan.document,elements:data.works.filter(row=>row.plan.id===plan.id).map(row=>row.el)}}));
  const summary=summarizeMep(plans,{}),rows=[['Bâtiment','Niveau','Zone','Entreprise','Lot','Discipline','Réseau','Sous-réseau','Unité','Prévu','Exécuté','Vérifié','Avancement','Contrôlé','Méthode']];
  for(const group of summary.groups){const first=group.rows[0],el=first.element,mep=el.mep,lot=lotFor(el.lotId),q=group.byUnit[first.unit];rows.push([first.plan.building||'Sans bâtiment',first.plan.level||'',mep.zone||el.room||'',lot.company,lot.name,disciplines[mep.discipline]||mep.discipline,mep.network,mep.subnetwork||'',first.unit,q.planned,q.executed,q.validated,group.percent===null?null:group.percent/100,group.checkedPercent===null?null:group.checkedPercent/100,group.method]);}
  rows.push(['TOTAL PONDÉRÉ','','','','','','','','—',null,null,null,summary.percent===null?null:summary.percent/100,summary.checkedPercent===null?null:summary.checkedPercent/100,summary.method]);
  const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=rows[0].map((_,i)=>({wch:i===14?80:24}));
  for(let i=2;i<=rows.length;i++){for(const col of ['M','N'])if(sheet[`${col}${i}`])sheet[`${col}${i}`].z='0.0%';for(const col of ['J','K','L'])if(sheet[`${col}${i}`])sheet[`${col}${i}`].z='0.######';}
  XLSX.utils.book_append_sheet(book,sheet,'Synthèse physique MEP');
}

function exportNotes(data,filters){return [
  ['BuildTrack — suivi physique MEP'],['Périmètre',data.scope],['Généré le',data.generatedAt],['Lecture serveur',data.snapshotAt||'Sans instantané chantier'],
  ['Version',"Seules les versions actuelles figurent dans l’instantané chantier. Un plan remplacé ne reprend pas les anciens tracés automatiquement."],
  ['État local','Les modifications du PDF ouvert, y compris en attente de synchronisation, remplacent son instantané serveur. Les autres plans reflètent la lecture serveur indiquée.'],
  ['Pourcentage','Exécuté / prévu × 100. Le statut Terminé ou Contrôlé représente 100 %. Une estimation est explicitement signalée.'],
  ['Unité','Les mètres, unités, m² et m³ restent séparés. Aucune somme inter-unités.'],
  ['Poids','Les poids de consolidation explicites sont indépendants des prix HT. Les quantités homogènes sont totalisées par unité.'],
  ['Vérifié','Seuls les ouvrages Contrôlés alimentent la quantité vérifiée. Résolu est distinct de Vérifié / clos pour un blocage.'],
  ['Responsable','Personne désignée sur le tronçon, sinon entreprise affectée. Un nom de personne indisponible ne remplace pas arbitrairement la responsabilité entreprise.'],
  ['Mise à jour du tronçon','Dernière opération affectant cet ouvrage, sans reprendre la date globale du plan. Une date inconnue reste vide ; les modifications locales en attente sont identifiées.'],
  ['Points bloquants',filters.openOnly?'Points non résolus uniquement (Ouvert, Affecté, En traitement), avec leurs ouvrages concernés. Les preuves et repères des points Résolu ou Vérifié / clos sont exclus de la liste et du rapport.':'Tous les points du périmètre, y compris Résolu et Vérifié / clos.'],
  ['Historique','La trace avant / après reste conservée, y compris les anciens statuts des ouvrages du périmètre ; elle ne constitue pas une liste de points actuellement ouverts.'],
  ['Filtres',JSON.stringify(filters)],['Limite atteinte',data.truncated?'Oui — export incomplet, réduire le périmètre':data.historyPartial?'Oui — historique partiel':'Non'],
  ['Couverture de l’historique',data.historyPartial?'Historique partiel : seules les opérations chargées sont présentes. Les quantités du périmètre restent complètes. Ne pas présenter cette feuille comme l’historique exhaustif du chantier.':'Historique synchronisé complet dans le périmètre chargé, avec les modifications locales du plan ouvert.'],
  ['Finances','Ce fichier est un suivi physique, sans émission de facture. L’export financier reste distinct.'],
];}

function checkExport(snapshot){
  if(!boot.permissions.export)throw Error('Export non autorisé.');
  if(snapshot?.truncated)throw Error('Le chantier dépasse la capacité de cet export. Réduisez le périmètre avant de réessayer.');
}

export async function exportMepWorkbook(state,snapshot=null,filters={}){
  checkExport(snapshot);
  const XLSX=globalThis.XLSX;if(!XLSX)throw Error('Le moteur Excel est indisponible.');
  const book=XLSX.utils.book_new(),data=appendMepSheets(book,XLSX,state,snapshot,filters);
  addMepSummary(book,XLSX,data);
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([...(data.historyPartial?[['HISTORIQUE PARTIEL — seules les opérations chargées sont présentes']]:[]),['Date UTC','Plan','Auteur','Action','Détail','Identifiant de modification','Partie JSON','Modifications avant / après (JSON)'],...mepHistoryRows(state,snapshot,data.works)]),'Historique MEP');
  const notes=XLSX.utils.aoa_to_sheet(exportNotes(data,filters));notes['!cols']=[{wch:28},{wch:130}];XLSX.utils.book_append_sheet(book,notes,'Méthode MEP');
  book.Props={Title:'BuildTrack — suivi physique MEP',Author:'BuildTrack',Subject:data.scope};
  await request('download',{base64:XLSX.write(book,{type:'base64',bookType:'xlsx',compression:true}),format:'xlsx',filename:'BuildTrack-suivi-MEP.xlsx'});
  return {elements:data.works.length,blockers:data.blockers.length,plans:data.plans.length};
}

/** Excel limits text cells to 32767 characters; chunks preserve the complete audit. */
export function mepHistoryRows(state,snapshot,works=null){
  const events=new Map();
  for(const original of [...(snapshot?.history||[]),...(state.history||[])]){
    let event=original;
    if(works){
      const planId=event.planId||boot.plan.id,related=works.filter(row=>row.plan.id===planId);
      if(!related.length)continue;
      if(Array.isArray(event.changes)){
        const ids=new Set(related.map(row=>row.el.id)),pages=new Set(related.map(row=>`${row.el.docId}:${row.el.page}`));
        const changes=event.changes.filter(change=>change.target==='elements'&&ids.has(change.key)||change.target==='calibrations'&&pages.has(change.key));
        if(!changes.length)continue;event={...event,changes};
      }
    }
    const key=event.id||JSON.stringify([event.time,event.planId,event.title,event.detail]);if(!events.has(key))events.set(key,event);
  }
  const rows=[];
  for(const event of [...events.values()].sort((a,b)=>text(a.time).localeCompare(text(b.time)))){
    const json=event.changes?JSON.stringify(event.changes):'',chunks=Math.max(1,Math.ceil(json.length/30000));
    const common=[event.time||event.createdAt||event.created_at||'',event.planName||event.planId||'',text(typeof event.author==='string'?event.author:event.author?.name||event.authorName||event.actorName||event.userId||''),event.title||'Avancement du plan modifié',event.detail||'',event.id||''];
    for(let part=0;part<chunks;part++)rows.push([...common,`${part+1}/${chunks}`,json.slice(part*30000,(part+1)*30000)]);
  }
  return rows;
}

/** Quotes and neutralises formulas before a CSV is opened in a spreadsheet. */
export function csvCell(value){
  let string=value===null||value===undefined?'':String(value);
  if(typeof value==='string'&&/^[\s\uFEFF]*[=+@\-\t\r]/.test(string))string="'"+string;
  return '"'+string.replace(/"/g,'""')+'"';
}
export function mepCsv(data){return '\uFEFF'+[workColumns,...data.works.map(workCells)].map(row=>row.map(csvCell).join(';')).join('\r\n');}
function base64Utf8(value){const bytes=new TextEncoder().encode(value);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
export async function exportMepCsv(state,snapshot=null,filters={}){
  checkExport(snapshot);const data=mepExportRows(state,snapshot,filters);
  await request('download',{base64:base64Utf8(mepCsv(data)),format:'csv',filename:'BuildTrack-reseaux-MEP.csv'});
  return {elements:data.works.length,blockers:data.blockers.length};
}

export function mepAnnotationSvg(elements,blockers,height=680){
  const colours={todo:'#718096',progress:'#b7770c',installed:'#2766ae',checked:'#087f5b'};
  const shapes=elements.map(el=>{
    const colour=isBlocking(el)?'#bd2436':colours[el.status]||colours.todo,points=(el.points||[]).map(p=>`${Number(p.x)},${Number(p.y)}`).join(' '),first=el.points?.[0];if(!first)return '';
    const label=`${el.reference||el.name} · ${format(mepPercent(el))} %`;
    let shape='';
    if(el.kind==='line'){
      const ranges=el.status==='todo'?[]:['installed','checked'].includes(el.status)?[[0,1]]:el.executedRanges??[[0,Math.max(0,Math.min(1,mepPercent(el)/100))]];
      shape=splitPathRanges(el.points,ranges).map(part=>`<polyline data-executed="${part.executed}" points="${part.points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${part.executed?colour:'#64748b'}" stroke-width="${part.executed?7:6}" ${part.executed?'stroke-linecap="round"':'stroke-dasharray="7 5"'}/>`).join('');
    }
    else if(el.kind==='area')shape=`<polygon points="${points}" fill="${colour}" fill-opacity=".18" stroke="${colour}" stroke-width="3"/>`;
    else shape=`<circle cx="${first.x}" cy="${first.y}" r="10" fill="${colour}" stroke="white" stroke-width="2"/>`;
    return `${shape}<text x="${first.x+12}" y="${Math.max(16,first.y-12)}" fill="#10243e" stroke="white" stroke-width="3" paint-order="stroke" font-size="15">${e(label)}</text>`;
  }).join('');
  const pins=blockers.map(row=>{const point=row.blocker.point;if(!point)return '';return `<g><circle cx="${point.x}" cy="${point.y}" r="14" fill="${active(row.blocker)?'#bd2436':'#087f5b'}" stroke="white" stroke-width="2"/><text x="${point.x}" y="${point.y+5}" text-anchor="middle" font-size="14" fill="white">${row.number}</text></g>`;}).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${Number(height)}" aria-label="Tracés MEP et points bloquants">${shapes}${pins}</svg>`;
}

export function buildMepReportHtml(data,{pages=[],photos={},filters={},projectName=boot.projectName||'Chantier'}={}){
  const open=data.blockers.filter(row=>active(row.blocker)).length,overdue=data.blockers.filter(row=>row.overdue).length;
  const physical=summarizeMep(data.plans.map(plan=>({...plan,document:{...plan.document,elements:data.works.filter(row=>row.plan.id===plan.id).map(row=>row.el)}})),{});
  const quantities=Object.entries(physical.byUnit).map(([unit,q])=>`${format(q.executed)} / ${format(q.planned)} ${e(unit)} exécutés ; ${format(q.validated)} ${e(unit)} vérifiés`).join(' · ');
  const cards=data.works.map(row=>`<article class="work ${text(row.el.note).length>1800?'long':''}"><div class="work-intro"><header><strong>${e(row.el.reference||row.el.name)}</strong><span class="percent">${format(row.percent*100)} %</span></header><h3>${e(row.el.name)}</h3><p>${e(row.building)} · ${e(row.level)} · ${e(row.zone)}<br>${e(row.discipline)} · ${e(row.network)}${row.subnetwork?' / '+e(row.subnetwork):''}<br>${e(row.company)} · ${e(row.lot)}</p><p class="work-activity">Responsable du tronçon : <b>${e(row.workResponsible)}</b><br>Dernière mise à jour : ${e(row.updatedAt||'non renseignée')}${row.updatedAt?' (UTC)':''}${row.updatedBy?' · '+e(row.updatedBy):''}${row.updatePending?' · modification locale en attente':''}</p><p class="measure"><b>${format(row.executed)} / ${format(row.planned)} ${e(row.unit)}</b> · vérifié : ${format(row.validated)} ${e(row.unit)}</p><p>${e(row.method)} · ${e(STATUSES[row.el.status]?.label||row.el.status)}${isBlocking(row.el)?' · <b class="danger">Progression bloquée</b>':''}</p></div>${row.el.note?'<p class="note">'+e(row.el.note)+'</p>':''}<small>${e(row.plan.name)} · page ${row.el.page} · indice ${e(row.plan.revision||'non renseigné')}</small></article>`).join('');
  const blockers=data.blockers.map(row=>`<article class="blocker ${text(row.blocker.description).length>1400||(row.blocker.photoRefs||[]).length>2?'long':''}"><div class="work-intro"><header><b>Point ${row.number} — ${e(blockerStatuses[row.blocker.status]||row.blocker.status)}</b>${row.overdue?'<strong class="danger">Échéance dépassée</strong>':''}</header><h3>${e(row.el.reference||row.el.name)} · ${e(row.network)}</h3><p>${e(row.building)} · ${e(row.level)} · ${e(row.zone)} · page ${row.el.page}</p></div><p class="note">${e(row.blocker.description)}</p><p>Responsable : <b>${e(row.responsibleCompany)} · ${e(row.responsible)}</b><br>Ouvert le ${e(row.blocker.openedAt)} · échéance ${e(row.blocker.dueDate||'non définie')}<br>${row.blocker.blocksProgress?'Empêche la progression':'Réserve à traiter, sans arrêt du tronçon'} · priorité ${e(row.blocker.priority)}</p><div class="photos">${(row.blocker.photoRefs||[]).map((ref,i)=>photos[ref]?`<figure><img src="${safeImageData(photos[ref])}" alt="Photo ${i+1} du point ${row.number}"><figcaption>Point ${row.number} · photo ${i+1}</figcaption></figure>`:'<p>Photo indisponible — réouvrir le média en ligne avant export.</p>').join('')}</div><small>Blocage ${e(row.blocker.id)} · tronçon ${e(row.el.id)}</small></article>`).join('');
  const pageHtml=pages.map(page=>`<section class="plan-page"><header><h2>${e(page.name)} · page ${page.page}</h2><p>${e(page.building||'Sans bâtiment')} · ${e(page.level||'')} · indice ${e(page.revision||'non renseigné')}</p></header><div class="plan-image" style="width:${Math.min(270,149*1000/Number(page.height))}mm;aspect-ratio:1000/${Number(page.height)}"><img src="${safeImageData(page.image)}" alt="Fond de plan PDF complet">${mepAnnotationSvg(page.elements,page.blockers,page.height)}</div><p class="legend"><span style="color:#718096">● À faire</span><span style="color:#b7770c">● En cours</span><span style="color:#2766ae">● Terminé</span><span style="color:#087f5b">● Contrôlé / clos</span><span style="color:#bd2436">● Bloqué / point ouvert</span></p></section>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>BuildTrack — suivi MEP</title><style>
@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font:11px Arial,sans-serif;color:#12233d;margin:0;line-height:1.45}h1{font-size:24px;margin:0 0 8px}h2{font-size:18px;margin:0 0 6px}h3{font-size:13px;margin:6px 0}p{margin:6px 0;overflow-wrap:anywhere}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px}section>header{display:block}.cover{margin-bottom:18px}.scope{background:#edf3fa;padding:12px;border-left:4px solid #003582}.summary{display:flex;gap:20px;margin:14px 0}.summary strong{display:block;font-size:20px}.plan-page{break-before:page;page-break-before:always;break-inside:avoid;page-break-inside:avoid}.plan-page h2{font-size:15px}.plan-image{position:relative;width:100%;margin:auto}.plan-image>img{width:100%;height:100%;object-fit:contain;display:block}.plan-image>svg{position:absolute;inset:0;width:100%;height:100%}.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:10px}.work,.blocker{border:1px solid #d5deeb;border-radius:6px;padding:12px;margin:10px 0;break-inside:avoid;page-break-inside:avoid;overflow-wrap:anywhere}.work header,.blocker header{font-size:12px}.long{break-inside:auto;page-break-inside:auto}.long header,.long h3{break-after:avoid;page-break-after:avoid}.percent{font-weight:bold;font-size:18px;color:#003582}.measure{background:#f3f6fb;padding:8px}.danger{color:#b21d32}.work-intro{break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}.note{white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}.photos{display:flex;gap:10px;flex-wrap:wrap}figure{margin:4px 0;width:31%;break-inside:avoid;page-break-inside:avoid}figure img{display:block;width:100%;max-height:80mm;object-fit:contain}figcaption,small{font-size:9px;color:#52627a}footer{margin-top:18px;padding-top:8px;border-top:1px solid #d5deeb;font-size:9px}.section-title{break-after:avoid;page-break-after:avoid;margin-top:20px}img{max-width:100%}</style></head><body><section class="cover"><h1>Suivi MEP — ${e(projectName)}</h1><p>Généré le ${e(data.generatedAt)} · ${e(data.scope)}</p><div class="scope">${e(data.snapshotAt?'Instantané chantier du '+data.snapshotAt:'PDF courant')} · Les modifications locales du plan ouvert sont incluses. Les autres plans reflètent l’instantané serveur. Les anciennes révisions ne sont pas superposées ni déplacées automatiquement.</div><div class="summary"><div><strong>${data.works.length}</strong>tronçons / ouvrages</div><div><strong>${open}</strong>points ouverts</div><div><strong>${overdue}</strong>échéances dépassées</div></div><p><b>Avancement consolidé : ${physical.percent===null?'non calculable':format(physical.percent)+' %'}</b> · ${e(physical.method)}</p><p>${quantities||'Aucune quantité mesurable dans ce périmètre.'}</p><p><b>Calcul physique :</b> exécuté / prévu × 100. Les unités restent séparées. Les estimations manuelles sont identifiées ; seuls les ouvrages Contrôlés sont vérifiés. Les pourcentages physiques sont indépendants de la valorisation HT.</p><p>Filtres : ${e(Object.entries(filters).filter(([,v])=>v&&v!=='all').map(([k,v])=>k+' = '+v).join(' · ')||'aucun')}</p><p>${filters.openOnly?'Points ouverts uniquement : les points Résolu et Vérifié / clos, leurs repères et leurs photos sont exclus.':'Points bloquants : tous les statuts du périmètre sont inclus.'}</p><p>Les feuilles de plan annotées ci-après concernent le PDF ouvert. Les ouvrages des autres plans du chantier sont repris dans la liste.</p></section><h2 class="section-title">Réseaux et quantités</h2>${cards||'<p>Aucun ouvrage dans ce périmètre.</p>'}${pageHtml}<h2 class="section-title">Points bloquants et actions</h2>${blockers||'<p>Aucun point bloquant dans ce périmètre.</p>'}<footer>Généré par BuildTrack · Suivi physique, sans émission de facture · ${e(data.generatedAt)}</footer></body></html>`;
}

function safeImageData(value){if(typeof value!=='string'||!/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(value))throw Error('Image du rapport invalide.');return value;}
async function imageAsData(url){
  if(typeof url!=='string')throw Error('Photo indisponible.');if(url.startsWith('data:'))return safeImageData(url);
  if(!/^https:\/\//.test(url))throw Error('Lien de photo invalide.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch(url,{signal:controller.signal,credentials:'omit'});if(!response.ok)throw Error('Photo inaccessible.');const blob=await response.blob();if(blob.size>8_000_000||!/^image\/(png|jpeg|webp)$/.test(blob.type))throw Error('Photo trop lourde ou format non pris en charge.');return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(safeImageData(reader.result));reader.onerror=()=>reject(Error('Photo illisible.'));reader.readAsDataURL(blob);});}finally{clearTimeout(timer);}
}

export async function exportMepPdf(state,snapshot=null,filters={}){
  checkExport(snapshot);const data=mepExportRows(state,snapshot,filters);
  const refs=[...new Set(data.blockers.flatMap(row=>row.blocker.photoRefs||[]))];
  if(refs.length>80)throw Error('Plus de 80 photos dans ce rapport. Filtrez les réseaux ou les blocages avant de réessayer.');
  const photos={};
  if(refs.length){const resolved=await request('resolveMepPhotos',{refs});if(!Array.isArray(resolved?.urls)||resolved.urls.length!==refs.length)throw Error('Les photos ne sont pas toutes disponibles. Reconnectez-vous avant l’export.');for(let i=0;i<refs.length;i++)photos[refs[i]]=await imageAsData(resolved.urls[i]);}
  const {loadPdf}=await import('./pdf-viewer.js');const pdf=await loadPdf(boot.pdfSource),pages=[];
  try{
    const pageNumbers=[...new Set(data.works.filter(row=>row.plan.id===boot.plan.id).map(row=>row.el.page))].sort((a,b)=>a-b);
    if(!pageNumbers.length)pageNumbers.push(state.currentPage||1);
    if(pageNumbers.length>30)throw Error('Plus de 30 pages annotées. Exportez le niveau souhaité avec le filtre de page.');
    for(const pageNumber of pageNumbers){
      const page=await pdf.getPage(pageNumber),original=page.getViewport({scale:1});
      const scale=Math.min(2,Math.sqrt(3_000_000/(original.width*original.height)));
      const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      const rows=data.works.filter(row=>row.plan.id===boot.plan.id&&row.el.page===pageNumber),plan=rows[0]?.plan||boot.plan;
      pages.push({...plan,page:pageNumber,height:original.height/original.width*1000,image:canvas.toDataURL('image/jpeg',.88),elements:rows.map(row=>row.el),blockers:data.blockers.filter(row=>row.plan.id===boot.plan.id&&row.el.page===pageNumber)});
      canvas.width=1;canvas.height=1;
    }
  }finally{if(typeof pdf.loadingTask?.destroy==='function')await pdf.loadingTask.destroy();else if(typeof pdf.destroy==='function')await pdf.destroy();else await pdf.cleanup?.();}
  const html=buildMepReportHtml(data,{pages,photos,filters});
  if(html.length>18_000_000)throw Error('Le rapport dépasse 18 Mo. Réduisez le périmètre ou le nombre de photos.');
  await request('mepPdf',{html});return {elements:data.works.length,blockers:data.blockers.length,pages:pages.length};
}
