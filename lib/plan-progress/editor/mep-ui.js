import {boot,request,canChangeStatus} from './bridge.js';
import {LOTS,lotFor,escapeHtml as e,num} from './model.js';
import {workActivity,responsibleLabel} from './mep-audit.js';
import {plannedQuantity,executedQuantity,mepPercent,isBlocking,mepUnit,summarizeMep,projectMepAt,projectOnPath,mergeRanges,subtractRanges,rangePercent,splitPathRanges} from './mep-calculations.js';

export const DISCIPLINES={plumbing:'Plomberie / eau / évacuations',hvac:'CVC / ventilation',cfo:'Électricité CFO',cfa:'Électricité CFA',sprinkler:'Sprinklers',other:'Autre réseau technique'};
export const BLOCKER_STATUSES={open:'Ouvert',assigned:'Affecté',in_progress:'En traitement',resolved:'Résolu',closed:'Vérifié / clos'};
export const WORK_STATUSES={todo:'À faire',progress:'En cours',installed:'Terminé',checked:'Contrôlé'};
export const workStatus=el=>`${WORK_STATUSES[el.status]||'Statut à vérifier'}${isBlocking(el)?' · Bloqué':''}`;
export const networkKey=el=>el.mep?JSON.stringify([el.mep.discipline,el.mep.network,el.mep.subnetwork||'']):'';
const active=b=>b.status!=='closed'&&b.status!=='resolved';
const $=id=>document.getElementById(id);
const number=value=>String(value??'').trim()===''?null:Number(String(value).replace(',','.'));
const options=(rows,value,empty='Tous')=>`<option value="">${e(empty)}</option>`+rows.map(([id,label])=>`<option value="${e(id)}"${id===value?' selected':''}>${e(label)}</option>`).join('');
const isoDay=()=>new Date().toISOString().slice(0,10);

/** Only view state lives here. All business edits use the host's durable record(). */
export function createMepUI(ports){
  let network='',discipline='',onlyBlocked=false,projectSnapshot=null,projectError='',projectBusy=false;
  let blockerElementId=null,blockerId=null,blockerPoint=null,photoRefs=[],placing=false,photoBusy=false,photoUrls=[];
  let actionStatus='open',actionSearch='';
  let formHadMep=false;
  let originalWorkResponsible=null,originalWorkCompany='',workRowsLimit=40;
  let portionMode='',portionElementId=null,portionPoints=[];
  let dashboardFilters={building:'',level:'',discipline:'',zone:'',lotId:'',network:'',updatedAfter:'',updatedBefore:''};
  const state=ports.getState;
  const selected=()=>state().elements.filter(el=>ports.getSelected().has(el.id));
  const current=()=>state().elements.filter(el=>el.docId===state().currentDoc&&el.page===state().currentPage);
  const matches=el=>(!discipline||el.mep?.discipline===discipline)&&(!network||networkKey(el)===network)&&(!onlyBlocked||isBlocking(el));
  const canTreat=b=>Boolean(b&&boot.permissions.editOwn&&b.status!=='closed'&&(b.responsibleId?b.responsibleId===boot.userId:b.companyId===boot.companyId));
  const currentBlocker=()=>state().elements.find(el=>el.id===blockerElementId)?.blockers?.find(b=>b.id===blockerId);
  function realGroup(id){try{const [companyId,lotId]=JSON.parse(id);return typeof companyId==='string'&&typeof lotId==='string'&&Boolean(lotId.trim())&&LOTS.some(lot=>lot.id===id&&lot.companyId===companyId);}catch{return false;}}
  const groupCompany=lot=>{try{return JSON.parse(lot.id)[0]||'';}catch{return lot.companyId||'';}};
  function scopeFormLots(companyId,preferred){
    const lots=LOTS.filter(lot=>groupCompany(lot)===companyId),chosen=lots.some(lot=>lot.id===preferred)?preferred:(lots.find(lot=>realGroup(lot.id))||lots[0])?.id||'';
    $('elementLot').innerHTML=lots.map(lot=>`<option value="${e(lot.id)}"${lot.id===chosen?' selected':''}>${e(realGroup(lot.id)?lot.name:'Entreprise seule · lot à préciser')}</option>`).join('');
    $('elementLot').value=chosen;
  }
  function prepareCompanyAndLot(el){
    const preferred=el.lotId||$('elementLot').value||LOTS[0]?.id||'';
    let companyId='';try{[companyId]=JSON.parse(preferred);}catch{}
    const companyMap=new Map();for(const lot of LOTS){const id=groupCompany(lot);if(id&&!companyMap.has(id))companyMap.set(id,[id,lot.company]);}
    const companies=[...companyMap.values()];
    $('elementCompany').innerHTML=options(companies,companyId,'Choisir une entreprise');$('elementCompany').value=companyId;
    scopeFormLots(companyId,!el.id&&!realGroup(preferred)?null:preferred);
  }
  function renderWorkPeople(value=$('mepWorkResponsible').value){
    let companyId='';try{[companyId]=JSON.parse($('elementLot').value);}catch{}
    const people=(boot.people||[]).filter(person=>person.companyId===companyId).map(person=>[person.id,person.name||'Membre du chantier']);
    if(value&&!people.some(([id])=>id===value)&&value===originalWorkResponsible&&companyId===originalWorkCompany)people.push([value,'Responsable précédemment affecté · indisponible']);
    const keep=value&&people.some(([id])=>id===value)?value:'';
    $('mepWorkResponsible').innerHTML=options(people,keep,'Entreprise du lot (par défaut)');
    $('mepWorkResponsible').value=keep;
    $('mepLotGuidance').hidden=realGroup($('elementLot').value)||!$('mepEnabled').checked;
    const noRealLots=!LOTS.some(lot=>realGroup(lot.id));
    $('mepLotGuidance').textContent=noRealLots?'Aucun lot du chantier n’est disponible. Un responsable peut en créer un sur BuildTrack Web : Terrain → Équipes → Gestion des lots. Rouvrez ensuite ce plan pour le sélectionner.':formHadMep?'Ce réseau ancien est rattaché à une entreprise sans lot précis. Sa lecture et son avancement restent disponibles. Dans la fiche, choisissez un lot du chantier avant de créer un nouveau blocage.':'Choisissez un lot du chantier dans le champ « Lot ». Une entreprise seule ne suffit pas pour préparer un nouveau réseau MEP.';
  }
  function setElement(el={}){
    const m=el.mep;
    formHadMep=Boolean(m);
    originalWorkResponsible=m?.responsibleId||null;
    prepareCompanyAndLot(el);
    try{[originalWorkCompany]=JSON.parse(el.lotId||$('elementLot').value);}catch{originalWorkCompany='';}
    $('mepEnabled').checked=Boolean(m);$('mepFields').hidden=!m;
    $('mepDiscipline').value=m?.discipline||'plumbing';$('mepNetwork').value=m?.network||'';
    $('mepSubnetwork').value=m?.subnetwork||'';$('mepZone').value=m?.zone||el.room||'';
    $('mepQuantityMode').value=m?.quantityMode||'drawing';$('mepPlanned').value=m?.plannedQuantity??'';
    $('mepUnit').value=m?.unit||({point:'u',line:'m',area:'m²'}[el.kind]||'m');$('mepWeight').value=m?.weight??1;
    renderWorkPeople(m?.responsibleId||'');formMode();
  }
  function formMode(){
    const enabled=$('mepEnabled').checked,manual=$('mepQuantityMode').value==='manual';
    $('mepFields').hidden=!enabled;
    $('mepNetwork').required=enabled;$('mepZone').required=enabled;
    $('mepPlanned').required=enabled&&manual;$('mepPlannedField').hidden=!manual;
    $('mepUnitField').hidden=!manual;
    renderWorkPeople();
    $('mepQuantityHelp').textContent=$('mepQuantityMode').value==='estimate'?'Estimation manuelle : le pourcentage sera identifié comme une estimation. Le poids sert à la consolidation entre réseaux.':manual?'Le prévu vient du quantitatif renseigné. Le réalisé se calcule à partir du pourcentage ou de la quantité saisie.':'Le prévu vient du tracé et de l’échelle de la page, en m, m² ou unités. Définissez l’échelle avant de mesurer.';
  }
  function readElement(kind){
    if(!$('mepEnabled').checked)return {...(formHadMep?{mep:null}:{}),room:$('mepZone').value.trim()};
    if(!formHadMep&&!realGroup($('elementLot').value))throw Error('Choisissez une entreprise, puis un lot réel du chantier dans la fiche pour préparer ce réseau MEP.');
    let companyId='';try{[companyId]=JSON.parse($('elementLot').value);}catch{}
    const responsibleId=$('mepWorkResponsible').value,unchangedResponsible=responsibleId===originalWorkResponsible&&companyId===originalWorkCompany;
    if(responsibleId&&!unchangedResponsible&&!(boot.people||[]).some(person=>person.id===responsibleId&&person.companyId===companyId))throw Error('Choisissez un responsable de l’entreprise affectée, ou gardez l’entreprise du lot.');
    const value={discipline:$('mepDiscipline').value,network:$('mepNetwork').value.trim(),subnetwork:$('mepSubnetwork').value.trim(),zone:$('mepZone').value.trim(),quantityMode:$('mepQuantityMode').value,plannedQuantity:$('mepQuantityMode').value==='manual'?number($('mepPlanned').value):null,unit:$('mepQuantityMode').value==='manual'?$('mepUnit').value:({point:'u',line:'m',area:'m²'}[kind]),weight:number($('mepWeight').value)};
    if($('mepWorkResponsible').value||originalWorkResponsible)value.responsibleId=$('mepWorkResponsible').value||null;
    if(!value.network||!value.zone||!Number.isFinite(value.weight)||value.weight<=0||value.weight>1e9||value.quantityMode==='manual'&&(!Number.isFinite(value.plannedQuantity)||value.plannedQuantity<=0||value.plannedQuantity>1e9))throw Error('Renseignez le réseau, la zone et des quantités / poids strictement positifs.');
    return {mep:value,room:value.zone};
  }
  function renderFilters(){
    const rows=[...new Map(current().filter(el=>el.mep).map(el=>[networkKey(el),[networkKey(el),`${DISCIPLINES[el.mep.discipline]||el.mep.discipline} · ${el.mep.network}${el.mep.subnetwork?' / '+el.mep.subnetwork:''}`]])).values()];
    if(network&&!rows.some(row=>row[0]===network)){let label='Réseau filtré, absent de cette page';try{const [,name,subnetwork]=JSON.parse(network);label=`${name}${subnetwork?' / '+subnetwork:''} · absent de cette page`;}catch{}rows.push([network,label]);}
    $('mepNetworkFilter').innerHTML=options(rows,network,'Tous les réseaux');
    $('mepDisciplineFilter').value=discipline;$('mepOnlyBlocked').checked=onlyBlocked;
    $('mepFilterSummary').textContent=`${current().filter(matches).length} / ${current().length} ouvrages visibles sur cette page`;
    $('mepToolsButton').textContent=network||discipline||onlyBlocked?'MEP · filtré':'Réseaux / MEP';
    $('mepToolsButton').setAttribute('aria-pressed',String(Boolean(network||discipline||onlyBlocked)));
  }
  function renderSelection(){
    const els=selected();if(els.length!==1)return;
    const el=els[0],root=$('inspector');
    const fragment=document.createElement('div');fragment.className='mep-selection';
    const m=el.mep,blocks=(el.blockers||[]).filter(active);
    fragment.innerHTML=`${m?`<p class="mep-caption"><strong>${e(m.network)}</strong>${m.subnetwork?' / '+e(m.subnetwork):''} · ${e(m.zone)}<br>${m.quantityMode==='estimate'?'Estimation manuelle':plannedQuantity(el,state())>0?`${num(executedQuantity(el,state()),3)} / ${num(plannedQuantity(el,state()),3)} ${e(mepUnit(el))}`:'Échelle / quantité à définir'} · ${num(mepPercent(el),1)} %${isBlocking(el)?' · <strong class="mep-warning">Progression bloquée</strong>':''}</p>`:''}${m&&el.kind==='line'&&canChangeStatus([el],'progress')?'<div class="mep-selection-actions mep-portion-actions"><button class="terrain-text-button" data-mep-portion-add>Marquer une portion réalisée</button><button class="terrain-text-button" data-mep-portion-remove>Corriger une portion réalisée</button></div>':''}<div class="mep-selection-actions"><button class="terrain-text-button" data-mep-work-actions>${blocks.length?blocks.length+' blocage(s) actif(s)':'Points bloquants'}</button>${boot.permissions.edit?(m?(realGroup(el.lotId)?'<button class="terrain-text-button" data-mep-add-blocker>Signaler un blocage</button>':'<button class="terrain-text-button" data-edit-element>Choisir un lot pour ce réseau</button>'):'<button class="terrain-text-button" data-edit-element>Préparer le réseau MEP</button>'):''}</div>`;
    root.append(fragment);
  }
  function actionRows(){
    const selectedOnly=$('mepActionsDialog').dataset.work;
    const search=actionSearch.toLocaleLowerCase('fr');
    return state().elements.flatMap(el=>(el.blockers||[]).map(b=>({el,b}))).filter(({el,b})=>(!selectedOnly||el.id===selectedOnly)&&(!actionStatus||actionStatus==='open'&&active(b)||actionStatus==='closed'&&!active(b)||b.status===actionStatus)&&(!search||`${el.name} ${el.reference} ${el.mep?.network||''} ${el.mep?.zone||el.room||''} ${b.description} ${lotFor(el.lotId).company}`.toLocaleLowerCase('fr').includes(search)));
  }
  function renderActions(){
    const rows=actionRows();
    $('mepActionList').innerHTML=rows.length?rows.map(({el,b})=>`<article class="mep-action-row"><div><strong>${e(BLOCKER_STATUSES[b.status])}${b.blocksProgress&&active(b)?' · Bloquant':''}${b.dueDate&&b.dueDate<isoDay()&&active(b)?' · En retard':''}</strong><p>${e(b.description)}</p><small>${e(el.reference)} · ${e(el.mep?.network||el.name)} · ${e(el.mep?.zone||el.room||'')}<br>${e(LOTS.find(lot=>lot.companyId===b.companyId)?.company||lotFor(el.lotId).company)}${b.dueDate?' · Échéance '+e(b.dueDate):''}</small></div><button class="terrain-button" data-mep-edit-blocker="${e(b.id)}" data-mep-work="${e(el.id)}">${boot.permissions.edit||canTreat(b)?'Ouvrir / traiter':'Consulter'}</button></article>`).join(''):'<p class="mep-empty">Aucun point bloquant ne correspond à ces filtres.</p>';
    $('mepActionsCount').textContent=`${rows.length} point(s) · les points clos restent conservés`;
  }
  function showActions(workId=''){
    $('mepActionsDialog').dataset.work=workId;actionStatus='open';$('mepActionStatus').value='open';actionSearch='';$('mepActionSearch').value='';
    renderActions();$('mepActionsDialog').showModal();
  }
  function blockerCompanyOptions(value){
    const companies=[...new Map(LOTS.filter(lot=>lot.companyId).map(lot=>[lot.companyId,[lot.companyId,lot.company]])).values()];
    $('mepBlockerCompany').innerHTML=options(companies,value,'Choisir une entreprise');
    renderPeople();
  }
  function renderPeople(value=''){
    const company=$('mepBlockerCompany').value;
    $('mepBlockerPerson').innerHTML=options((boot.people||[]).filter(p=>!company||p.companyId===company).map(p=>[p.id,p.name]),value,'Responsable : entreprise');
  }
  function renderPhotoState(){
    $('mepPhotoSummary').textContent=photoBusy?'Préparation des photos…':`${photoRefs.length} photo(s) jointe(s)${photoRefs.length?'':' · au moins une photo est obligatoire'}`;
    $('mepBlockerPhotos').innerHTML=photoUrls.filter(Boolean).map((url,i)=>`<figure><img src="${e(url)}" alt="Preuve du point bloquant ${i+1}"><figcaption>Photo ${i+1}</figcaption></figure>`).join('');
    $('mepPickPhotos').disabled=photoBusy||!(boot.permissions.edit||canTreat(currentBlocker()))||photoRefs.length>=10;
  }
  async function openBlocker(el,id=null,preserve=false){
    if(!el)return;
    if(!id&&!el.mep){ports.toast('Ouvrez « Modifier » et renseignez le réseau technique ainsi que la zone avant de signaler un blocage MEP.');return;}
    if(!id&&!realGroup(el.lotId)){ports.toast('Ce réseau est rattaché à une entreprise sans lot précis. Dans « Modifier », choisissez un lot du chantier avant de créer ce blocage.');return;}
    if(!preserve){
      const b=(el.blockers||[]).find(item=>item.id===id);blockerElementId=el.id;blockerId=b?.id||null;
      blockerPoint=b?.point?{...b.point}:{...el.points[Math.floor((el.points.length-1)/2)]};photoRefs=[...(b?.photoRefs||[])];photoUrls=[];
      $('mepBlockerDescription').value=b?.description||'';$('mepBlockerDue').value=b?.dueDate||'';
      $('mepBlockerStatus').value=b?.status||'open';$('mepBlockerPriority').value=b?.priority||'normal';$('mepBlocksProgress').checked=b?.blocksProgress??true;
      blockerCompanyOptions(b?.companyId||lotFor(el.lotId).companyId||JSON.parse(el.lotId)[0]);renderPeople(b?.responsibleId||'');
    }
    $('mepBlockerTitle').textContent=blockerId?'Point bloquant · '+el.reference:'Signaler un point bloquant';
    $('mepBlockerContext').textContent=`${el.name} · ${el.mep?.network||'Ouvrage'} · ${el.mep?.zone||el.room||'Zone à renseigner dans Modifier'}`;
    $('mepBlockerPosition').textContent=`Repère sur le plan : X ${num(blockerPoint.x,1)} · Y ${num(blockerPoint.y,1)}`;
    const treatment=canTreat(currentBlocker());
    $('mepBlockerReadonly').hidden=boot.permissions.edit||treatment;
    $('mepBlockerForm').querySelectorAll('input,textarea,select,button[type=submit],[data-mep-position]').forEach(input=>input.disabled=!boot.permissions.edit);
    if(treatment){$('mepBlockerStatus').disabled=false;$('mepBlockerForm').querySelector('button[type=submit]').disabled=false;}
    for(const option of $('mepBlockerStatus').options)option.disabled=option.value==='closed'&&!boot.permissions.edit;
    renderPhotoState();$('mepBlockerDialog').showModal();
    if(photoRefs.length){
      const target=blockerId,element=blockerElementId;
      try{const result=await request('resolveMepPhotos',{refs:photoRefs});if(target===blockerId&&element===blockerElementId){photoUrls=result.urls||[];renderPhotoState();}}catch{$('mepPhotoSummary').textContent=`${photoRefs.length} photo(s) jointe(s) · aperçu indisponible sur cet appareil`;}
    }
  }
  function pickPosition(){
    for(const id of ['mepBlockerDialog','mepActionsDialog','mepFiltersDialog','detailsDialog'])if($(id).open)$(id).close();
    placing=true;ports.beginPositioning();
    $('mepPositionToolbar').hidden=false;ports.toast('Touchez le plan à l’emplacement exact du point bloquant. Deux doigts pour zoomer.');
  }
  function stopPosition(){placing=false;$('mepPositionToolbar').hidden=true;ports.endPositioning();}
  function startPortion(remove=false){
    const el=selected()[0];if(!el?.mep||el.kind!=='line'||!canChangeStatus([el],'progress')||ports.isBusy())return;
    for(const id of ['detailsDialog','mepFiltersDialog','mepActionsDialog'])if($(id).open)$(id).close();
    portionMode=remove?'remove':'add';portionElementId=el.id;portionPoints=[];
    ports.beginPortion();$('mepPortionToolbar').hidden=false;paintPortion();
    ports.toast('Touchez le début puis la fin de la portion, directement sur le cheminement.');
  }
  function stopPortion(){portionMode='';portionElementId=null;portionPoints=[];$('mepPortionToolbar').hidden=true;$('mepPortionLayer').innerHTML='';ports.endPortion();}
  function paintPortion(){
    if(!portionMode)return;
    const el=state().elements.find(item=>item.id===portionElementId);if(!el){stopPortion();return;}
    $('mepPortionTitle').textContent=(portionMode==='remove'?'Corriger une portion réalisée':'Marquer une portion réalisée')+' · '+el.reference;
    const complete=portionPoints.length===2,span=complete?[Math.min(...portionPoints.map(p=>p.fraction)),Math.max(...portionPoints.map(p=>p.fraction))]:null;
    $('mepPortionHint').textContent=complete?`${num((span[1]-span[0])*plannedQuantity(el,state()),3)} ${mepUnit(el)} sélectionné(s). Vérifiez, puis validez.`:portionPoints.length?'Début repéré. Touchez la fin de cette portion sur le cheminement.':'Touchez le début de la portion sur le cheminement.';
    $('mepPortionApply').disabled=!complete||span[1]-span[0]<1e-8;
    const s=1000/Math.max(1,$('planOverlay').getBoundingClientRect().width),preview=span?splitPathRanges(el.points,[span]).filter(p=>p.executed).map(part=>`<polyline points="${part.points.map(p=>`${p.x},${p.y}`).join(' ')}" stroke="#168b69" stroke-width="${10*s}" fill="none" stroke-linecap="round"/>`).join(''):'';
    $('mepPortionLayer').innerHTML=preview+portionPoints.map((p,i)=>`<circle cx="${p.point.x}" cy="${p.point.y}" r="${12*s}" fill="white" stroke="#003582" stroke-width="${3*s}"/><text x="${p.point.x}" y="${p.point.y}" text-anchor="middle" dominant-baseline="central" style="font-size:${12*s}px;fill:#003582;font-weight:700">${i+1}</text>`).join('');
  }
  function savePortion(){
    const el=state().elements.find(item=>item.id===portionElementId);if(!el||portionPoints.length!==2||ports.isBusy()||!canChangeStatus([el],'progress'))return;
    const span=[Math.min(...portionPoints.map(p=>p.fraction)),Math.max(...portionPoints.map(p=>p.fraction))];if(span[1]-span[0]<1e-8)return;
    const previous=el.executedRanges??(mepPercent(el)>0?[[0,mepPercent(el)/100]]:[]),ranges=portionMode==='remove'?subtractRanges(previous,span):mergeRanges([...previous,span]),percent=rangePercent(ranges);
    if(percent>=100-1e-7&&isBlocking(el)){ports.toast('Un point bloquant est encore actif. Résolvez-le avant de terminer le tronçon.');return;}
    ports.record(portionMode==='remove'?'Portion réalisée corrigée':'Portion réalisée repérée',`${el.reference} · ${num(percent,3)} % · ${num(plannedQuantity(el,state())*percent/100,3)} ${mepUnit(el)} réalisés`,()=>{el.executedRanges=ranges;el.status=percent<=1e-8?'todo':percent>=100-1e-7?'installed':'progress';el.progressPercent=el.status==='progress'?percent:null;},'checkCircle');
    stopPortion();
  }
  function handlePlanClick(event){
    if(!placing&&!portionMode)return false;
    const svg=$('planOverlay'),matrix=svg.getScreenCTM();if(!matrix)return true;
    const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    const local=point.matrixTransform(matrix.inverse()),box=svg.viewBox.baseVal;
    if(portionMode){
      const el=state().elements.find(item=>item.id===portionElementId);if(!el)return true;
      const projected=projectOnPath(el.points,local),distancePx=projected.distance*Math.hypot(matrix.a||1,matrix.b||0);
      if(distancePx>44){ports.toast('Touchez plus près du cheminement sélectionné.');return true;}
      if(portionPoints.length===2)portionPoints=[];portionPoints.push(projected);paintPortion();return true;
    }
    blockerPoint={x:Math.max(0,Math.min(1000,local.x)),y:Math.max(0,Math.min(box.height,local.y))};
    stopPosition();void openBlocker(state().elements.find(el=>el.id===blockerElementId),blockerId,true);return true;
  }
  async function pickPhotos(){
    if(photoBusy||!(boot.permissions.edit||canTreat(currentBlocker())))return;photoBusy=true;renderPhotoState();
    try{const response=await request('pickMepPhotos',{remaining:10-photoRefs.length});const refs=(response.refs||[]).filter(ref=>typeof ref==='string'&&/^(btmedia|btlocal):\/\//.test(ref));photoRefs=[...new Set([...photoRefs,...refs])].slice(0,10);if(photoRefs.length){const result=await request('resolveMepPhotos',{refs:photoRefs}).catch(()=>({urls:[]}));photoUrls=result.urls||[];}}
    catch(error){ports.toast(error.message||'Les photos n’ont pas été ajoutées.');}
    finally{photoBusy=false;renderPhotoState();}
  }
  function saveBlocker(event){
    event.preventDefault();if(ports.isBusy()||photoBusy||!(boot.permissions.edit||canTreat(currentBlocker())))return;
    const el=state().elements.find(item=>item.id===blockerElementId);if(!el)return;
    const description=$('mepBlockerDescription').value.trim(),companyId=$('mepBlockerCompany').value;
    if(!description||!photoRefs.length||!companyId||!(el.mep?.zone||el.room)||!$('mepBlockerForm').reportValidity()){ports.toast('Renseignez la description, une photo, une entreprise et la zone de l’ouvrage.');return;}
    const old=(el.blockers||[]).find(b=>b.id===blockerId);
    if(!old&&!realGroup(el.lotId)){ports.toast('Choisissez d’abord un lot du chantier dans la fiche de l’ouvrage.');return;}
    const blocker={id:old?.id||crypto.randomUUID(),point:blockerPoint,description,photoRefs:[...photoRefs],companyId,responsibleId:$('mepBlockerPerson').value||null,dueDate:$('mepBlockerDue').value||null,openedAt:old?.openedAt||new Date().toISOString(),status:$('mepBlockerStatus').value,blocksProgress:$('mepBlocksProgress').checked,priority:$('mepBlockerPriority').value};
    if((el.status==='checked'||el.status==='installed')&&blocker.blocksProgress&&active(blocker)){ports.toast('Cet ouvrage est terminé ou contrôlé. Repassez-le en cours avant de déclarer une progression bloquée, ou signalez une réserve non bloquante.');return;}
    ports.record(old?'Point bloquant mis à jour':'Point bloquant signalé',`${el.reference} · ${BLOCKER_STATUSES[blocker.status]} · ${description.slice(0,160)}`,()=>{el.blockers=old?el.blockers.map(b=>b.id===old.id?blocker:b):[...(el.blockers||[]),blocker];},'pin');
    $('mepBlockerDialog').close();if($('mepActionsDialog').open)renderActions();
  }
  function effectivePlans(){
    const previous=projectSnapshot?.plans?.find(plan=>plan.id===state().currentDoc);
    const local={...previous,...boot.plan,id:state().currentDoc,document:state(),updatedAt:state().history?.at(-1)?.time||previous?.updatedAt||boot.plan.updatedAt||null};
    const others=projectSnapshot?.plans?.filter(plan=>plan.id!==local.id)||[];return [...others,local];
  }
  function filteredProjectRows(){
    return effectivePlans().flatMap(plan=>plan.document.elements.filter(el=>el.mep).map(el=>({plan,el,document:plan.document}))).filter(({plan,el})=>
      (!dashboardFilters.building||(plan.building||'')===dashboardFilters.building)&&(!dashboardFilters.level||(plan.level||'')===dashboardFilters.level)&&(!dashboardFilters.discipline||el.mep.discipline===dashboardFilters.discipline)&&(!dashboardFilters.zone||el.mep.zone===dashboardFilters.zone)&&(!dashboardFilters.lotId||el.lotId===dashboardFilters.lotId)&&(!dashboardFilters.network||networkKey(el)===dashboardFilters.network)&&
      (!dashboardFilters.updatedAfter||(plan.updatedAt||'').slice(0,10)>=dashboardFilters.updatedAfter)&&(!dashboardFilters.updatedBefore||(plan.updatedAt||'').slice(0,10)<=dashboardFilters.updatedBefore));
  }
  const calcFilters=()=>({building:dashboardFilters.building,level:dashboardFilters.level,discipline:dashboardFilters.discipline,zone:dashboardFilters.zone,lotId:dashboardFilters.lotId,networkKey:dashboardFilters.network,dateFrom:dashboardFilters.updatedAfter,dateTo:dashboardFilters.updatedBefore});
  const exportFilters=()=>({...calcFilters(),openOnly:Boolean($('mepOpenOnlyExport').checked)});
  function activityHtml(el,plan){
    const activity=workActivity(state(),plan,el,projectSnapshot?.history||[]),timestamp=Date.parse(activity?.updatedAt||'');
    const date=Number.isFinite(timestamp)?`<time datetime="${e(activity.updatedAt)}" title="${e(activity.updatedAt)}">${e(new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(timestamp)))}</time>`:'<span>Non renseignée</span>';
    return `${date}${activity?.authorName?`<small>${e(activity.authorName)}</small>`:''}${activity?.pending?'<small class="mep-local-activity">Enregistré sur cet appareil · à synchroniser</small>':''}`;
  }
  function quantityHtml(el,document,type){
    if(el.mep.quantityMode==='estimate')return '<span class="mep-estimate">Estimation manuelle</span>';
    const planned=plannedQuantity(el,document);if(!(planned>0))return '<span class="mep-muted">Quantité à définir</span>';
    const q=type==='planned'?planned:type==='verified'?(el.status==='checked'?planned:0):executedQuantity(el,document);
    return `${num(q,3)} <span class="mep-unit">${e(mepUnit(el))}</span>`;
  }
  function workAction(el,plan){
    return plan.id===state().currentDoc&&ports.locateWork?`<button class="terrain-button mep-locate-work" data-mep-locate-work="${e(el.id)}">Voir sur le plan</button>`:`<small class="mep-open-plan-hint">À consulter depuis Plans${plan.id!==state().currentDoc?' · '+e(plan.name):''}</small>`;
  }
  function renderWorkTable(rows){
    const visible=rows.slice(0,workRowsLimit);
    $('mepWorksCount').textContent=`${visible.length} / ${rows.length} tronçon(s) affiché(s) · statut, responsable et mise à jour propres à chaque ouvrage`;
    $('mepMoreWorks').hidden=visible.length>=rows.length;
    if(!rows.length){$('mepProjectTable').innerHTML='<div class="mep-empty"><strong>Aucun tronçon dans ce périmètre</strong><p>Modifiez les filtres pour retrouver vos réseaux. Pour commencer un suivi, activez « Réseau technique MEP » dans la fiche d’un ouvrage.</p></div>';return;}
    const presentation=({el,plan,document})=>({el,plan,document,status:workStatus(el),responsible:responsibleLabel(el,boot.people||[],lotFor(el.lotId).company),activity:activityHtml(el,plan),planned:quantityHtml(el,document,'planned'),executed:quantityHtml(el,document,'executed'),verified:quantityHtml(el,document,'verified'),percent:num(mepPercent(el),1)+' %',action:workAction(el,plan)});
    const workRows=visible.map(presentation);
    const table=`<div class="mep-table-scroll mep-desktop-works" tabindex="0" role="region" aria-label="Tableau détaillé des tronçons MEP"><table class="mep-work-table"><caption class="sr-only">Tronçons, quantités, avancement, responsable et dernière mise à jour</caption><thead><tr><th scope="col">Tronçon / réseau</th><th scope="col">Statut</th><th scope="col">Prévu</th><th scope="col">Réalisé</th><th scope="col">Vérifié</th><th scope="col">Responsable</th><th scope="col">Dernière mise à jour</th><th scope="col">Action</th></tr></thead><tbody>${workRows.map(row=>`<tr><td><strong>${e(row.el.reference||row.el.name)}</strong><span>${e(row.el.name)}</span><small>${e(row.el.mep.network)}${row.el.mep.subnetwork?' / '+e(row.el.mep.subnetwork):''}<br>${e(row.plan.building||'Sans bâtiment')} · ${e(row.plan.level||'Niveau non renseigné')} · ${e(row.el.mep.zone)}<br>${e(lotFor(row.el.lotId).company)} · ${e(lotFor(row.el.lotId).name)}</small></td><td><span class="mep-work-status ${isBlocking(row.el)?'is-blocked':row.el.status}">${e(row.status)}</span></td><td>${row.planned}</td><td><strong>${row.executed}</strong><small>${row.percent}</small></td><td>${row.verified}</td><td>${e(row.responsible)}</td><td>${row.activity}</td><td>${row.action}</td></tr>`).join('')}</tbody></table></div>`;
    const cards=`<div class="mep-mobile-works" aria-label="Tronçons MEP en fiches">${workRows.map(row=>`<article class="mep-work-card"><header><div><span class="mep-work-reference">${e(row.el.reference||'Tronçon')}</span><h4>${e(row.el.name)}</h4></div><span class="mep-work-status ${isBlocking(row.el)?'is-blocked':row.el.status}">${e(row.status)}</span></header><p class="mep-work-location"><strong>${e(row.el.mep.network)}</strong>${row.el.mep.subnetwork?' / '+e(row.el.mep.subnetwork):''}<br>${e(row.plan.building||'Sans bâtiment')} · ${e(row.plan.level||'Niveau non renseigné')} · ${e(row.el.mep.zone)}<br>${e(lotFor(row.el.lotId).company)} · ${e(lotFor(row.el.lotId).name)}</p><dl class="mep-work-quantities"><div><dt>Prévu</dt><dd>${row.planned}</dd></div><div><dt>Réalisé</dt><dd>${row.executed}<small>${row.percent}</small></dd></div><div><dt>Vérifié</dt><dd>${row.verified}</dd></div></dl><dl class="mep-work-ownership"><div><dt>Responsable</dt><dd>${e(row.responsible)}</dd></div><div><dt>Dernière mise à jour</dt><dd>${row.activity}</dd></div></dl>${row.action}</article>`).join('')}</div>`;
    $('mepProjectTable').innerHTML=table+cards;
  }
  function renderExportScope(physical){
    const openOnly=$('mepOpenOnlyExport').checked,count=openOnly?physical.openBlockers.length:physical.blockers.length;
    $('mepExportScope').hidden=!boot.permissions.export;
    $('mepExportScopeHelp').textContent=openOnly?'L’export contient les ouvrages concernés et leurs points non résolus. Le tableau à l’écran reste inchangé.':'Tous les points sont inclus, y compris les points résolus et clos. Le tableau à l’écran reste inchangé.';
    $('mepExportScopeCount').textContent=openOnly&&!count?'Aucun point ouvert dans ce périmètre. Ajustez les filtres ou choisissez tous les points.':`${count} point(s) dans le périmètre de l’export`;
    document.querySelectorAll('[data-mep-export]').forEach(button=>{button.disabled=openOnly&&!count;button.hidden=!boot.permissions.export;});
  }
  function renderProject(){
    const plans=effectivePlans(),rows=filteredProjectRows();
    const all=plans.flatMap(plan=>plan.document.elements.filter(el=>el.mep));
    const unique=values=>[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr')).map(v=>[v,v]);
    $('mepBuildingFilter').innerHTML=options(unique(plans.map(plan=>plan.building)),dashboardFilters.building,'Tous les bâtiments');
    $('mepLevelFilter').innerHTML=options(unique(plans.map(plan=>plan.level)),dashboardFilters.level,'Tous les niveaux');
    $('mepZoneFilter').innerHTML=options(unique(all.map(el=>el.mep.zone)),dashboardFilters.zone,'Toutes les zones');
    $('mepLotFilter').innerHTML=options(LOTS.map(lot=>[lot.id,`${lot.company} · ${lot.name}`]),dashboardFilters.lotId,'Toutes les entreprises / lots');
    $('mepProjectNetworkFilter').innerHTML=options([...new Map(all.map(el=>[networkKey(el),[networkKey(el),el.mep.network+(el.mep.subnetwork?' / '+el.mep.subnetwork:'')]])).values()],dashboardFilters.network,'Tous les réseaux');
    const groups=new Map();
    for(const row of rows){const {plan,el,document}=row,key=JSON.stringify([plan.building||'',el.lotId,networkKey(el),mepUnit(el),el.mep.quantityMode==='estimate']);let g=groups.get(key);if(!g){g={building:plan.building||'Sans bâtiment',network:el.mep.network,zone:el.mep.zone,lot:lotFor(el.lotId),unit:mepUnit(el),estimate:el.mep.quantityMode==='estimate',planned:0,executed:0,verified:0,weighted:0,weight:0,blocks:0,late:0,count:0};groups.set(key,g);}const q=plannedQuantity(el,document);g.count++;g.planned+=q;g.executed+=executedQuantity(el,document);if(el.status==='checked')g.verified+=q;g.weighted+=mepPercent(el)*(el.mep.weight||1);g.weight+=el.mep.weight||1;g.blocks+=(el.blockers||[]).filter(active).length;g.late+=(el.blockers||[]).filter(b=>active(b)&&b.dueDate&&b.dueDate<isoDay()).length;}
    const physical=summarizeMep(plans,calcFilters()),percent=physical.percent;
    const blockers=rows.flatMap(({el})=>el.blockers||[]),opened=blockers.filter(active).length;
    $('mepProjectStatus').textContent=projectBusy?'Actualisation du chantier…':projectError?projectError:projectSnapshot?`${plans.length} plan(s) · relevé du ${new Date(projectSnapshot.generatedAt||Date.now()).toLocaleString('fr-FR')}${projectSnapshot.truncated?' · résultat incomplet, limitez le périmètre':''}`:'Plan courant uniquement · chargez le chantier pour consolider les autres plans';
    $('mepProjectMetrics').innerHTML=`<div><span>Avancement déclaré / vérifié</span><strong>${percent===null?'—':num(percent,1)+' %'} / ${physical.checkedPercent===null?'—':num(physical.checkedPercent,1)+' %'}</strong><small>${e(physical.method)}${physical.unmeasurable?' · '+physical.unmeasurable+' tronçon(s) sans quantité fiable exclus du total':''}</small></div><div><span>Blocages ouverts</span><strong>${opened}</strong><small>${blockers.filter(b=>b.status==='closed').length} vérifiés / clos</small></div><div><span>Tronçons</span><strong>${rows.length}</strong><small>${rows.filter(({el})=>el.mep.quantityMode==='estimate').length} estimation(s) manuelle(s)</small></div>`;
    $('mepNetworkSummary').innerHTML=groups.size?`<div class="mep-table-scroll" tabindex="0" role="region" aria-label="Avancement physique des réseaux"><table><thead><tr><th>Bâtiment / réseau / entreprise</th><th>Prévu</th><th>Réalisé</th><th>Vérifié</th><th>Déclaré</th><th>Blocages / retards</th></tr></thead><tbody>${[...groups.values()].map(g=>`<tr><td><strong>${e(g.network)}</strong><small>${e(g.building)} · ${e(g.lot.company)} · ${e(g.lot.name)}${g.estimate?'<br>Estimation manuelle':''}</small></td><td>${g.estimate?'—':num(g.planned,3)+' '+e(g.unit)}</td><td>${g.estimate?'—':num(g.executed,3)+' '+e(g.unit)}</td><td>${g.estimate?'—':num(g.verified,3)+' '+e(g.unit)}</td><td>${!g.estimate&&!g.planned?'—':num(g.estimate?g.weighted/g.weight:g.executed/g.planned*100,1)+' %'}</td><td>${g.blocks} / ${g.late}</td></tr>`).join('')}</tbody></table></div>`:'<p class="mep-empty">Aucun réseau MEP ne correspond à ces filtres. Renseignez « Réseau technique MEP » dans la fiche d’un ouvrage.</p>';
    renderWorkTable(rows);renderExportScope(physical);
    $('mepProjectDetails').textContent='La dernière mise à jour est celle du tronçon, avec son auteur quand l’historique le permet. Une saisie non synchronisée reste identifiée sur cet appareil. La clôture d’un blocage ne contrôle pas automatiquement l’ouvrage.';
    $('mepProjectBlockers').innerHTML=physical.blockers.length?physical.blockers.map(({plan,element:el,blocker:b})=>`<article class="mep-action-row"><div><strong>${e(BLOCKER_STATUSES[b.status])}${b.blocksProgress&&active(b)?' · Bloquant':''}</strong><p>${e(b.description)}</p><small>${e(plan.name)} · ${e(plan.building||'Sans bâtiment')} · ${e(el.mep.zone)} · ${e(el.mep.network)}<br>${e(LOTS.find(lot=>lot.companyId===b.companyId)?.company||lotFor(el.lotId).company)}${b.dueDate?' · Échéance '+e(b.dueDate):''}</small></div>${plan.id===state().currentDoc?`<button class="terrain-button" data-mep-edit-blocker="${e(b.id)}" data-mep-work="${e(el.id)}">Ouvrir / traiter</button>`:'<small>Ouvrez ce PDF depuis Plans pour traiter ce point.</small>'}</article>`).join(''):'<p class="mep-empty">Aucun point bloquant sur les réseaux de ce périmètre.</p>';
    const notifications=(projectSnapshot?.notifications||[]).filter(n=>!n.readAt&&!n.read_at);
    $('mepNotifications').innerHTML=notifications.length?`<h3>Actions qui vous concernent</h3>${notifications.map(n=>`<article class="mep-troncon"><strong>${e(n.title||'Point bloquant affecté')}</strong><span>${e(n.body||n.message||'Une action MEP vous est affectée.')}</span></article>`).join('')}<button class="terrain-button" data-mep-mark-notifications>Marquer ces alertes comme lues</button>`:'';
  }
  async function loadProject(){
    if(projectBusy)return;projectBusy=true;projectError='';renderProject();
    try{const snapshot=await request('projectMep',{});if(!Array.isArray(snapshot?.plans))throw Error('La synthèse du chantier n’est pas disponible.');projectSnapshot=snapshot;}
    catch(error){projectError=error.message+' · données disponibles conservées';}
    finally{projectBusy=false;renderProject();}
  }
  function showProject(){ports.setView('mep');renderProject();if(!projectSnapshot&&!projectBusy)void loadProject();}
  async function doExport(kind){
    if(!boot.permissions.export)return;const busy=$('mepExportStatus');busy.textContent='Préparation de l’export…';
    try{const tools=await import('./mep-export.js'),fn={xlsx:tools.exportMepWorkbook,csv:tools.exportMepCsv,pdf:tools.exportMepPdf}[kind];await fn(state(),projectSnapshot,exportFilters());busy.textContent='Export prêt.';}
    catch(error){busy.textContent='Export impossible : '+error.message;}
  }
  function handleClick(button){
    if(button.hasAttribute('data-mep-open-filters')){renderFilters();$('mepFiltersDialog').showModal();return true;}
    if(button.hasAttribute('data-mep-project')){showProject();return true;}
    if(button.hasAttribute('data-mep-actions')){showActions();return true;}
    if(button.hasAttribute('data-mep-work-actions')){showActions(selected()[0]?.id||'');return true;}
    if(button.hasAttribute('data-mep-add-blocker')){void openBlocker(selected()[0]);return true;}
    if(button.dataset.mepEditBlocker){void openBlocker(state().elements.find(el=>el.id===button.dataset.mepWork),button.dataset.mepEditBlocker);return true;}
    if(button.hasAttribute('data-mep-position')){pickPosition();return true;}
    if(button.hasAttribute('data-mep-cancel-position')){stopPosition();void openBlocker(state().elements.find(el=>el.id===blockerElementId),blockerId,true);return true;}
    if(button.hasAttribute('data-mep-more-works')){workRowsLimit+=40;renderProject();return true;}
    if(button.dataset.mepLocateWork){const el=state().elements.find(item=>item.id===button.dataset.mepLocateWork);if(el&&ports.locateWork){network='';discipline='';onlyBlocked=false;void Promise.resolve(ports.locateWork(el)).catch(error=>ports.toast(error.message));}return true;}
    if(button.hasAttribute('data-mep-reload')){void loadProject();return true;}
    if(button.hasAttribute('data-mep-portion-add')){startPortion(false);return true;}
    if(button.hasAttribute('data-mep-portion-remove')){startPortion(true);return true;}
    if(button.hasAttribute('data-mep-portion-cancel')){stopPortion();return true;}
    if(button.hasAttribute('data-mep-portion-restart')){portionPoints=[];paintPortion();return true;}
    if(button.hasAttribute('data-mep-portion-apply')){savePortion();return true;}
    if(button.hasAttribute('data-mep-mark-notifications')){button.disabled=true;void request('markMepNotificationsRead',{}).then(()=>loadProject()).catch(error=>ports.toast(error.message)).finally(()=>button.disabled=false);return true;}
    if(button.dataset.mepExport){void doExport(button.dataset.mepExport);return true;}
    return false;
  }
  $('elementCompany').addEventListener('change',()=>{scopeFormLots($('elementCompany').value,null);renderWorkPeople();$('elementLot').dispatchEvent(new Event('change',{bubbles:true}));});
  $('elementLot').addEventListener('change',()=>renderWorkPeople());
  $('mepOpenOnlyExport').addEventListener('change',()=>renderExportScope(summarizeMep(effectivePlans(),calcFilters())));
  $('mepEnabled').addEventListener('change',formMode);$('mepQuantityMode').addEventListener('change',formMode);
  $('mepDisciplineFilter').addEventListener('change',()=>{const chosen=$('mepDisciplineFilter').value;let previous='';try{[previous]=JSON.parse($('mepNetworkFilter').value);}catch{}if(chosen&&previous!==chosen)$('mepNetworkFilter').value='';});
  $('mepFiltersForm').addEventListener('submit',event=>{event.preventDefault();discipline=$('mepDisciplineFilter').value;network=$('mepNetworkFilter').value;onlyBlocked=$('mepOnlyBlocked').checked;ports.clearSelection();$('mepFiltersDialog').close();ports.render();});
  $('mepResetFilters').addEventListener('click',()=>{discipline='';network='';onlyBlocked=false;ports.clearSelection();renderFilters();ports.render();$('mepFiltersDialog').close();});
  $('mepActionStatus').addEventListener('change',()=>{actionStatus=$('mepActionStatus').value;renderActions();});
  $('mepActionSearch').addEventListener('input',()=>{actionSearch=$('mepActionSearch').value;renderActions();});
  $('mepBlockerCompany').addEventListener('change',()=>renderPeople());$('mepBlockerForm').addEventListener('submit',saveBlocker);$('mepPickPhotos').addEventListener('click',pickPhotos);
  const dashboardIds={mepBuildingFilter:'building',mepLevelFilter:'level',mepProjectDiscipline:'discipline',mepZoneFilter:'zone',mepLotFilter:'lotId',mepProjectNetworkFilter:'network',mepUpdatedAfter:'updatedAfter',mepUpdatedBefore:'updatedBefore'};
  for(const [id,key] of Object.entries(dashboardIds))$(id).addEventListener('change',()=>{dashboardFilters[key]=$(id).value;workRowsLimit=40;renderProject();});
  $('mepCompareDates').addEventListener('click',()=>{
    const from=$('mepCompareFrom').value,to=$('mepCompareTo').value;
    const history=projectSnapshot?.history||[];
    if(!from||!to||from>to){$('mepComparison').textContent='Choisissez deux dates dans le bon ordre.';return;}
    const events=history.filter(event=>{const day=String(event.time||event.createdAt||'').slice(0,10);return day>=from&&day<=to;});
    try{
      if(!projectSnapshot)throw Error('Chargez le chantier pour comparer deux dates.');
      const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value??null;
      const signature=document=>JSON.stringify(canonical({elements:(document?.elements||[]).map(el=>({...el,price:el.price??0})),calibrations:document?.calibrations||{},billed:document?.billed||{}}));
      const serverCurrent=projectSnapshot.plans.find(plan=>plan.id===state().currentDoc);
      const historical={...projectSnapshot,localPending:projectSnapshot.localPending||signature(serverCurrent?.document)!==signature(state())};
      const a=summarizeMep(projectMepAt(historical,from).plans,calcFilters()),b=summarizeMep(projectMepAt(historical,to).plans,calcFilters());
      const qa=Object.entries(a.byUnit).map(([unit,q])=>`${num(q.executed,3)} ${unit}`).join(' · ')||'Aucune quantité',qb=Object.entries(b.byUnit).map(([unit,q])=>`${num(q.executed,3)} ${unit}`).join(' · ')||'Aucune quantité';
      $('mepComparison').textContent=`Du ${from} : ${a.percent===null?'non calculable':num(a.percent,1)+' %'} (${qa}) au ${to} : ${b.percent===null?'non calculable':num(b.percent,1)+' %'} (${qb}). ${events.length} modification(s) synchronisée(s). Instantanés en fin de journée UTC ; déclarations locales non synchronisées exclues.`;
    }catch(error){$('mepComparison').textContent=error.message;}
    $('mepComparisonHistory').innerHTML=events.slice(-100).reverse().map(event=>`<article class="mep-troncon"><strong>${e(event.title||'Suivi modifié')}</strong><span>${e(event.time||event.createdAt||'')} · ${e(event.authorName||event.author||'Membre du chantier')}</span><span>${e(event.detail||'Modification du suivi')}</span></article>`).join('');
  });
  return {setElement,readElement,setUnscaled(){ $('mepEnabled').checked=true;$('mepQuantityMode').value='manual';formMode();},matches,handleClick,handlePlanClick,paintPortion,cancelGesture(){if(portionMode)stopPortion();else if(placing){stopPosition();void openBlocker(state().elements.find(el=>el.id===blockerElementId),blockerId,true);}},get placing(){return placing||Boolean(portionMode);},get snapshot(){return projectSnapshot;},get filters(){return {...dashboardFilters};},get exportFilters(){return exportFilters();},
    render(){renderFilters();renderSelection();document.querySelectorAll('[data-mep-export]').forEach(button=>button.hidden=!boot.permissions.export);if($('mepActionsDialog').open)renderActions();if(document.body.dataset.view==='mep')renderProject();},
    async openMarker(id,workId){await openBlocker(state().elements.find(el=>el.id===workId),id);},
  };
}
