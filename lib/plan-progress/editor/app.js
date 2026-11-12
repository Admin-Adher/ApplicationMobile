import {boot,request,applyPermissions,canChangeStatus} from './bridge.js';
import {fillIcons,icon} from './icons.js';
import {LOTS,STATUSES,loadState,summary,currentElements,quantity,geometricQuantity,shapeQuantity,lotFor,unitFor,documentPageName,num,money,escapeHtml as e,floorName,scaleKey,billedKey,roundMoney} from './model.js';
import {DimensionForm} from './dimension-form.js';
import {attachMobileViewport} from './mobile-viewport.js';
import {dimensionsFor} from './dimensions.js';
import {nearbyElements} from './selection.js';
import {renderTerrainInspector,workRows,terrainLabel} from './terrain-view.js';
import {PdfViewer,loadPdf} from './pdf-viewer.js';
import {DrawingController} from './drawing.js';
import {attachPlanNavigation} from './plan-navigation.js';
import {renderMetrics,renderLotFilters,renderElements,renderInspector,renderTracking,renderHistory} from './views.js';

const $=id=>document.getElementById(id);
attachMobileViewport();
let state=loadState(),view='plan',filter='all',mode='select',multi=false,selected=new Set(),currentPdf=null,loadId=0;
let pendingGeometry=null,calibrationPoints=null,pendingTool=null,toastTimer;
let editingTargetId=null,editingMetaId=null;
let annotationWidth=0;
let workCandidates=null;
const variants={area:'polygon',line:'segment'};
let rightAngles=true;
const doc=()=>state.documents.find(d=>d.id===state.currentDoc)||state.documents[0];
const pageLabel=()=>documentPageName(doc(),state.currentPage);
const dimensionForm=new DimensionForm({root:$('elementForm'),getBase:()=>pendingGeometry?shapeQuantity(pendingGeometry.kind,pendingGeometry.points,state.calibrations[scaleKey(state.currentDoc,state.currentPage)]):0});

function storageWarning(message){$('storageNotice').textContent=message;$('storageNotice').hidden=false;}
let durableDocument=JSON.stringify({elements:state.elements,calibrations:state.calibrations,billed:state.billed});
let saving=false;
let unconfirmed=false;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const sameDocument=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
let refreshAvailable=false;
window.addEventListener('bt-progress-refresh',()=>{refreshAvailable=true;});
setInterval(async()=>{
  if(!refreshAvailable||saving||unconfirmed||drawing.isDrawing()||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,select'))return;
  refreshAvailable=false;saving=true;document.body.setAttribute('data-progress-saving','');
  try{
    const value=await request('reload',{});
    if(value?.document){
      const next=JSON.stringify(value.document);
      if(!sameDocument(value.document,JSON.parse(durableDocument))){Object.assign(state,value.document);state.undo=[];selected.clear();}
      state.history=value.history||state.history;durableDocument=next;render();
      $('savedState').textContent='Synchronisé avec le chantier';
    }
  }catch(error){
    if(error.code==='LOCAL_SAVE_UNCONFIRMED'){unconfirmed=true;document.body.setAttribute('data-progress-uncertain','');storageWarning(error.message);}
    $('savedState').textContent='Actualisation indisponible · données locales conservées';
  }
  finally{saving=false;document.body.removeAttribute('data-progress-saving');}
},800);
function persist(){
  const next=JSON.stringify({elements:state.elements,calibrations:state.calibrations,billed:state.billed});
  if(sameDocument(JSON.parse(next),JSON.parse(durableDocument)))return;
  if(saving)return;
  const before=durableDocument;
  saving=true;document.body.setAttribute('data-progress-saving','');$('savedState').textContent='Enregistrement sur cet appareil…';
  request('save',JSON.parse(next)).then(result=>{
    durableDocument=next;$('storageNotice').hidden=true;$('savedState').textContent=result.text;
  }).catch(error=>{
    if(error.code==='LOCAL_SAVE_UNCONFIRMED'){
      unconfirmed=true;document.body.setAttribute('data-progress-uncertain','');storageWarning(error.message);$('savedState').textContent='Enregistrement à vérifier';return;
    }
    Object.assign(state,JSON.parse(before));state.undo=[];selected.clear();render();
    storageWarning(error.message+' La modification n’a pas été conservée.');$('savedState').textContent='Échec de l’enregistrement';
  }).finally(()=>{saving=false;document.body.removeAttribute('data-progress-saving');});
}

function toast(message,undoable=false){
  clearTimeout(toastTimer);
  $('toast').innerHTML=`<span>${e(message)}</span>${undoable?'<button data-undo>Annuler</button>':''}`;
  $('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true;},5500);
}
function record(title,detail,mutate,eventIcon='checkCircle'){
  if(saving)return;
  state.undo.push({title,snapshot:JSON.stringify({elements:state.elements,calibrations:state.calibrations,billed:state.billed,currentDoc:state.currentDoc,currentPage:state.currentPage})});
  if(state.undo.length>12)state.undo.shift();
  mutate();state.history.push({id:crypto.randomUUID(),time:new Date().toISOString(),title,detail,icon:eventIcon});
  state.history=state.history.slice(-80);persist();render();toast(title,true);
}
async function undo(){
  if(saving||!boot.permissions.edit)return;
  const action=state.undo.pop();if(!action)return;
  const previousDoc=state.currentDoc,previousPage=state.currentPage;
  Object.assign(state,JSON.parse(action.snapshot));selected.clear();
  state.history.push({id:crypto.randomUUID(),time:new Date().toISOString(),title:'Dernière modification annulée',detail:action.title,icon:'undo'});
  persist();render();toast('Modification annulée.');
  if(previousDoc!==state.currentDoc)await openDocument();else if(previousPage!==state.currentPage)await viewer.setPage(state.currentPage);
}

function renderDocumentControls(){
  $('documentSelect').innerHTML=state.documents.map(d=>`<option value="${e(d.id)}" ${d.id===state.currentDoc?'selected':''}>${e(d.name)}${state.documents.filter(other=>other.name===d.name).length>1?` — copie ${state.documents.filter(other=>other.name===d.name).findIndex(other=>other.id===d.id)+1}`:''}</option>`).join('');
  $('documentSelect').title=doc().name;
  $('pageSelect').innerHTML=Array.from({length:doc().pages},(_,i)=>`<option value="${i+1}" ${state.currentPage===i+1?'selected':''}>${documentPageName(doc(),i+1)}</option>`).join('');
  const scale=state.calibrations[scaleKey(state.currentDoc,state.currentPage)];
  $('documentDetail').textContent=`${doc().pages} page${doc().pages>1?'s':''} · ${pageLabel()} · PDF BuildTrack · ${scale?'Échelle définie':'Échelle à définir'}`;
  $('projectName').textContent=boot.projectName;
  $('sourceContext').hidden=true;
  $('focusBuilding').hidden=!doc().viewRegion;$('focusDetail').hidden=!doc().detailRegion;
}
function render(){
  const oldFinancialTable=$('trackingView').querySelector('.table-scroll');
  const financialScroll=oldFinancialTable?{left:oldFinancialTable.scrollLeft,top:oldFinancialTable.scrollTop}:null;
  renderDocumentControls();renderMetrics($('metrics'),state,state.currentDoc,state.currentPage);
  renderLotFilters($('lotFilters'),filter);
  $('terrainLotSelect').value=filter;
  renderElements($('elementsLayer'),state,state.currentDoc,state.currentPage,filter,selected);
  if(editingTargetId)document.querySelector(`[data-element="${CSS.escape(editingTargetId)}"]`)?.classList.add('redraw-target');
  renderTerrainInspector($('inspector'),state,state.currentDoc,state.currentPage,selected);
  renderTracking($('trackingView'),state,state.currentDoc,state.currentPage);
  const financialTable=$('trackingView').querySelector('.table-scroll');
  if(financialTable){const hint=document.createElement('p');hint.className='table-touch-hint';hint.textContent='Glissez le tableau de gauche à droite pour voir tous les montants.';financialTable.before(hint);}
  if(view==='tracking'&&financialScroll&&financialTable)financialTable.scrollTo({...financialScroll,behavior:'instant'});
  $('trackingView').querySelectorAll('input[type="number"]').forEach(input=>input.inputMode='decimal');
  renderHistory($('historyView'),state);
  $('historyCount').textContent=state.history.length;
  $('terrainUndo').disabled=!state.undo.length;
  $('terrainHint').textContent=multi?'Sélection multiple · touchez les ouvrages':currentElements(state,state.currentDoc,state.currentPage,filter).length?'Touchez un ouvrage · glissez pour déplacer':'Aucun ouvrage dans ce lot';
  $('menuMultiButton').innerHTML=icon('select')+(multi?'Terminer la sélection multiple':'Sélectionner plusieurs ouvrages');
  $('menuMultiButton').setAttribute('aria-pressed',String(multi));
  $('finishMultiSelection').hidden=!multi;
  $('multiButton').setAttribute('aria-pressed',String(multi));
  $('legend').innerHTML=Object.values(STATUSES).map(s=>`<span><b class="status-dot" style="background:${s.color}"></b>${s.label}</span>`).join('');
  fillIcons();updateMode();applyPermissions(state.elements.filter(el=>selected.has(el.id)));
}
function setView(next){
  if(next!=='plan'&&drawing.isDrawing()){toast('Terminez ou annulez le tracé avant de quitter le plan.');return;}
  document.body.dataset.view=next;
  view=next;for(const name of ['plan','tracking','history'])$(`${name}View`).hidden=name!==view;
  document.querySelectorAll('[data-view]').forEach(button=>{
    if(!button.classList.contains('tab')&&!button.classList.contains('rail-button'))return;
    button.classList.toggle('active',button.dataset.view===view);
    if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  if(view==='plan')setTimeout(()=>viewer.render(),0);
}
function updateMode(pointCount=drawing?.points.length||0){
  const tracing=['point','line','area','calibrate','focus'].includes(mode);
  document.body.classList.toggle('is-drawing',tracing);
  $('addWorkButton').disabled=tracing;$('planMenuButton').disabled=tracing;
  for(const id of ['documentSelect','pageSelect','terrainLotSelect'])$(id).disabled=tracing;
  document.querySelectorAll('[data-tool]').forEach(button=>{const active=button.dataset.tool===mode&&(!button.dataset.lineVariant||button.dataset.lineVariant===variants.line);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  $('planPaper').classList.toggle('drawing',['point','line','area','calibrate','focus'].includes(mode));
  $('planViewport').classList.toggle('pan-mode',mode==='pan');
  const instructions={point:'Touchez le plan pour placer votre équipement.',pan:'Glissez pour déplacer le plan. Ctrl + molette pour zoomer.',line:variants.line==='path'?'Placez le départ, les coudes et l’arrivée, puis « Terminer ».':'Placez le départ, puis l’arrivée du segment droit.',area:variants.area==='rectangle'?'Touchez deux coins opposés : le rectangle se ferme tout seul.':'Touchez les coins, puis « Terminer la surface ».',calibrate:'Placez deux points aux extrémités d’une distance connue.',focus:'Touchez deux coins opposés de la zone à agrandir.'};
  $('drawingMessage').hidden=mode==='select';
  $('drawingMessage').innerHTML=mode==='select'?'':`<span><strong>${editingTargetId?'Corriger le tracé':{point:'Placer un équipement',line:'Tracer un cheminement',area:'Délimiter une surface',calibrate:'Régler l’échelle',focus:'Agrandir une zone',pan:'Déplacer le plan'}[mode]}</strong>${instructions[mode]}<small class="touch-plan-hint">Deux doigts pour déplacer et zoomer.</small></span>${['area','line'].includes(mode)?'':'<button data-cancel-drawing>Annuler</button>'}`;
  $('shapeOptions').hidden=!['area','line'].includes(mode);
  const options=mode==='area'?[['polygon','Contour libre'],['rectangle','Rectangle · 2 clics']]:[['segment','Segment · 2 clics'],['path','Cheminement']];
  $('shapeOptions').innerHTML=['area','line'].includes(mode)?options.map(([value,label])=>`<button data-variant="${value}" aria-pressed="${variants[mode]===value}" class="${variants[mode]===value?'active':''}">${label}</button>`).join('')+(mode==='line'&&variants.line==='path'?`<label class="right-angle-option"><input type="checkbox" id="rightAngles" ${rightAngles?'checked':''}>Angles à 90°</label>`:''):'';
  updateDraftUI();
}
function updateDraftUI(){
  const active=['area','line'].includes(mode),points=drawing.points,count=points.length,canFinish=drawing.canFinish(),minimum=mode==='area'?3:2;
  $('drawingDock').hidden=!active;
  $('draftCount').textContent=`${count} point${count>1?'s':''}`;
  $('draftMeasure').textContent=count>=minimum?`${num(shapeQuantity(mode,points,state.calibrations[scaleKey(state.currentDoc,state.currentPage)]),2)} ${mode==='area'?'m²':'m'} · référence mesurée`:mode==='area'&&variants.area==='rectangle'?'Deux coins opposés suffisent':`Placez au moins ${minimum} points`;
  $('finishDrawing').hidden=!canFinish;$('finishDrawing').disabled=count<minimum;
  $('finishDrawing').innerHTML=icon('check')+(mode==='area'?'Terminer la surface':'Terminer le cheminement');
  if(canFinish&&count>=minimum)$('draftCount').textContent=`${count} points placés — prêt à terminer`;
  $('removeLastPoint').disabled=!count;
  $('nearFinish').hidden=!(canFinish&&count>=minimum)||Boolean(document.querySelector('dialog[open]'))||!$('planOverlay').getClientRects().length;
  if($('nearFinish').hidden)return;
  const panel=$('planView').querySelector('.plan-panel').getBoundingClientRect(),v=$('planViewport').getBoundingClientRect(),p=$('planOverlay').createSVGPoint();
  p.x=points.at(-1).x;p.y=points.at(-1).y;const screen=p.matrixTransform($('planOverlay').getScreenCTM());
  $('nearFinish').style.left=`${Math.max(v.left+10,Math.min(screen.x+22,v.right-195))-panel.left}px`;
  $('nearFinish').style.top=`${Math.max(v.top+10,Math.min(screen.y+18,v.bottom-75))-panel.top}px`;
  $('nearFinish').querySelector('button').innerHTML=icon('check')+(mode==='area'?'Fermer la surface':'Valider le cheminement');
  $('nearFinish').querySelector('span').textContent=mode==='area'?'ou touchez le premier point':'ou appuyez sur Entrée';
}
function setTool(next){
  if(['point','line','area','calibrate'].includes(next)&&(!boot.permissions.edit||saving||!LOTS.length))return;
  multi=false;
  selected.clear();drawing.clear();pendingGeometry=null;calibrationPoints=null;editingTargetId=null;editingMetaId=null;
  if((next==='line'||next==='area')&&!state.calibrations[scaleKey(state.currentDoc,state.currentPage)]){
    pendingTool=next;mode='calibrate';toast('Définissez d’abord une distance connue pour mesurer ce plan.');
  }else{pendingTool=null;mode=next;}
  render();
}
function clearSelection(){selected.clear();render();}
function selectElement(id,additive=false){
  const el=state.elements.find(item=>item.id===id);
  if(!el||el.docId!==state.currentDoc||el.page!==state.currentPage||(filter!=='all'&&el.lotId!==filter))return;
  if(multi||additive){if(selected.has(id))selected.delete(id);else selected.add(id);}else selected=new Set([id]);
  render();
}
function changeStatus(status){
  const elements=state.elements.filter(el=>selected.has(el.id));if(!elements.length)return;
  if(!canChangeStatus(elements,status)||saving){toast('Vous ne pouvez pas modifier cet avancement.');return;}
  if(elements.every(el=>el.status===status)){toast('Cet état est déjà renseigné.');return;}
  const title=`${elements.length===1?elements[0].name:`${elements.length} ouvrages`} → ${terrainLabel(status)}`;
  record(title,`${doc().name} · ${pageLabel()} · ${elements.map(el=>el.reference).join(', ')}`,()=>{for(const el of elements)el.status=status;});
  toast(`${terrainLabel(status)} · enregistrement en cours`);
  ($('inspector').querySelector(`[data-status="${status}"]`)||$('inspector').querySelector('[data-open-details]'))?.focus({preventScroll:true});
}
function showGeometry(kind,points){
  const lot=filter!=='all'?lotFor(filter):(LOTS.find(lot=>lot.kind===kind)||LOTS[0]),q=shapeQuantity(kind,points,state.calibrations[scaleKey(state.currentDoc,state.currentPage)]);
  if(!q||!Number.isFinite(q)){toast('Ce tracé ne permet pas de calculer une quantité. Recommencez.');drawing.clear();return;}
  if(editingTargetId){
    const el=state.elements.find(el=>el.id===editingTargetId);if(!el)return;
    record('Tracé de l’ouvrage corrigé',`${el.reference} · ${num(q,2)} ${unitFor(kind)}`,()=>{el.points=points;},'edit');
    drawing.clear();editingTargetId=null;mode='select';selected=new Set([el.id]);render();return;
  }
  editingMetaId=null;
  pendingGeometry={kind,points,lotId:lot.id};
  $('newElementTitle').textContent=kind==='point'?'Nouvel équipement':kind==='line'?(variants.line==='path'?'Nouveau cheminement':'Nouvelle longueur'):'Nouvelle surface';
  $('elementName').value={point:'Équipement à poser',line:variants.line==='path'?'Cheminement à réaliser':'Longueur à réaliser',area:'Surface à réaliser'}[kind];$('elementPrice').value=lot.price;
  $('elementDialogEyebrow').textContent='NOUVEL OUVRAGE';$('elementSubmit').textContent='Ajouter au plan';
  $('elementLot').innerHTML=LOTS.map(item=>`<option value="${e(item.id)}" ${item.id===lot.id?'selected':''}>${e(item.company)} · ${e(item.name)}</option>`).join('');
  $('newElementInfo').innerHTML=`<strong>Mesure du tracé : ${num(q,2)} ${unitFor(kind)}</strong><br>${kind==='area'?'Surface du contour':kind==='line'?'Longueur totale du tracé':'Équipement à l’unité'}`;
  dimensionForm.setElement({kind});
  $('advancedElementOptions').open=false;updateSimplePrice();
  $('elementDialog').showModal();
}
const drawing=new DrawingController({overlay:$('planOverlay'),layer:$('draftLayer'),getMode:()=>mode,getVariant:()=>variants[mode],getRightAngles:()=>rightAngles,getScale:()=>state.calibrations[scaleKey(state.currentDoc,state.currentPage)],onGeometry:showGeometry,onCalibration:points=>{calibrationPoints=points;$('realDistance').value='';$('calibrationDialog').showModal();},onFocus:async region=>{drawing.clear();mode='select';render();await viewer.focus(region);updateZoom();},onPoints:updateMode,onPreview:updateDraftUI,onError:message=>toast(message)});
function refreshAnnotations(){
  const width=$('planPaper').getBoundingClientRect().width;
  $('planPaper').classList.toggle('real-overview',Boolean(doc().real&&width<1600));
  if(Math.abs(width-annotationWidth)>.1){
    annotationWidth=width;renderElements($('elementsLayer'),state,state.currentDoc,state.currentPage,filter,selected);
    if(editingTargetId)document.querySelector(`[data-element="${CSS.escape(editingTargetId)}"]`)?.classList.add('redraw-target');
  }
}
const viewer=new PdfViewer({canvas:$('pdfCanvas'),paper:$('planPaper'),viewport:$('planViewport'),overlay:$('planOverlay'),loading:$('planLoading'),onPageSize:()=>{},onViewChange:()=>{refreshAnnotations();drawing.paint();updateZoom();},onError:error=>{$('planError').textContent=`Le plan n’a pas pu être affiché. ${error.message||''}`;$('planError').hidden=false;}});
attachPlanNavigation({viewport:$('planViewport'),overlay:$('planOverlay'),viewer,getMode:()=>mode,getTerrain:()=>true,onChange:updateZoom});

function updateSimplePrice(){
  const data=dimensionForm.element();
  $('simplePriceHint').textContent=`Prix d’essai : ${money(Number($('elementPrice').value)||0)} par ${unitFor(data)==='u'?'unité':unitFor(data)}. Modifiable dans « Dimensions et prix ».`;
}
function fillWorkList(){
  const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const search=normalize($('workSearch').value.trim());
  const available=currentElements(state,state.currentDoc,state.currentPage,filter).filter(el=>!workCandidates||workCandidates.includes(el.id));
  const matches=available.filter(el=>normalize(`${el.name} ${el.reference} ${lotFor(el.lotId).company} ${el.room||''}`).includes(search));
  $('worksList').innerHTML=workRows(matches,state);$('worksEmpty').hidden=matches.length>0;fillIcons();
}
function openWorks(ids=null){
  workCandidates=ids;$('workSearch').value='';
  $('worksTitle').textContent=ids?'Plusieurs ouvrages ici':'Retrouver un ouvrage';
  $('worksHelp').textContent=ids?'Choisissez l’ouvrage à mettre à jour. Aucun état n’a été modifié.':'Ouvrages de la page et du lot affichés. Vous pouvez chercher par nom, repère ou entreprise.';
  fillWorkList();$('worksDialog').showModal();
}
$('workSearch').addEventListener('input',fillWorkList);
$('terrainLotSelect').addEventListener('change',event=>{filter=event.target.value;selected.clear();render();});

async function openDocument(loaded=null){
  const id=++loadId;$('planError').hidden=true;$('planLoading').hidden=false;
  try{
    let pdf=loaded;
    if(!pdf){
      const source=doc().source;
      if(!source)throw new Error('Le PDF n’est plus disponible dans ce navigateur. Réimportez-le avec le bouton « Importer un PDF ».');
      pdf=await loadPdf(source);
    }
    if(id!==loadId){await pdf.loadingTask.destroy();return;}
    const previous=currentPdf;currentPdf=pdf;
    doc().pages=pdf.numPages;state.currentPage=Math.min(state.currentPage,pdf.numPages);
    await viewer.setDocument(pdf,state.currentPage);
    if(doc().viewRegion)await viewer.focus(doc().viewRegion);
    if(previous&&previous!==pdf)await previous.loadingTask.destroy();
    updateZoom();render();
    return true;
  }catch(error){
    if(id!==loadId)return;
    $('planLoading').hidden=true;$('planError').innerHTML=`<strong>Impossible d’ouvrir ce PDF</strong><p>${e(error.message||'Essayez un autre document PDF.')}</p><button class="button secondary" data-retry-pdf>Réessayer</button>`;$('planError').hidden=false;
    return false;
  }
}
async function setPage(page){
  state.currentPage=Math.max(1,Math.min(doc().pages,page));selected.clear();drawing.clear();mode='select';editingTargetId=null;editingMetaId=null;persist();render();
  $('planError').hidden=true;await viewer.setPage(state.currentPage);updateZoom();
}
function updateZoom(){$('zoomValue').textContent=`${Math.round(viewer.zoom*100)} %`;}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if(!button)return;
  if(button.hasAttribute('data-open-add')){setView('plan');$('addWorkDialog').showModal();return;}
  if(button.hasAttribute('data-open-menu')){$('planMenuDialog').showModal();return;}
  if(button.dataset.addKind){$('addWorkDialog').close();multi=false;variants.line='path';variants.area='polygon';setTool(button.dataset.addKind);return;}
  if(button.closest('#planMenuDialog')&&!button.hasAttribute('data-close-dialog'))$('planMenuDialog').close();
  if(button.dataset.proxy){$(button.dataset.proxy).click();return;}
  if(button.hasAttribute('data-open-works')){openWorks();return;}
  if(button.dataset.pickElement){
    $('worksDialog').close();selectElement(button.dataset.pickElement);
    $('terrainSelectionTitle')?.focus({preventScroll:true});
    const el=state.elements.find(el=>el.id===button.dataset.pickElement);
    if(el){
      const xs=el.points.map(p=>p.x),ys=el.points.map(p=>p.y),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys),pad=Math.max(12,Math.max(w,h)*.2);
      await viewer.focus({x:Math.min(...xs)-pad,y:Math.min(...ys)-pad,w:w+2*pad,h:h+2*pad});updateZoom();
    }
    return;
  }
  if(button.hasAttribute('data-open-details')){renderInspector($('detailsContent'),state,state.currentDoc,state.currentPage,selected);applyPermissions(state.elements.filter(el=>selected.has(el.id)));$('detailsDialog').showModal();return;}
  if(button.closest('#detailsDialog')&&!button.hasAttribute('data-close-dialog'))$('detailsDialog').close();
  if(button.dataset.view){setView(button.dataset.view);return;}
  if(button.dataset.filter){filter=button.dataset.filter;selected.clear();render();return;}
  if(button.dataset.tool){if(button.dataset.lineVariant)variants.line=button.dataset.lineVariant;setTool(button.dataset.tool);return;}
  if(button.dataset.variant){variants[mode]=button.dataset.variant;drawing.clear();render();return;}
  if(button.dataset.status){changeStatus(button.dataset.status);return;}
  if(button.hasAttribute('data-undo')){await undo();return;}
  if(button.hasAttribute('data-clear-selection')){clearSelection();return;}
  if(button.hasAttribute('data-edit-element')){editSelected();return;}
  if(button.hasAttribute('data-edit-dimensions')){editSelected();$('advancedElementOptions').open=true;$('dimensionFields').scrollIntoView({block:'nearest'});(pendingGeometry?.kind==='area'?$('dimensionThickness'):$('dimensionWidth')).focus();return;}
  if(button.hasAttribute('data-redraw-element')){redrawSelected();return;}
  if(button.hasAttribute('data-delete-element')){deleteSelected();return;}
  if(button.hasAttribute('data-finish')){drawing.finish();return;}
  if(button.hasAttribute('data-cancel-drawing')){setTool('select');return;}
  if(button.hasAttribute('data-close-dialog')){button.closest('dialog').close();return;}
  if(button.hasAttribute('data-retry-pdf')){await openDocument();return;}
});
$('planOverlay').addEventListener('click',event=>{
  if(mode!=='select'){drawing.click(event);return;}
  {
    const matrix=$('planOverlay').getScreenCTM();if(!matrix)return;
    const toScreen=p=>({x:matrix.a*p.x+matrix.c*p.y+matrix.e,y:matrix.b*p.x+matrix.d*p.y+matrix.f});
    const scale=state.calibrations[scaleKey(state.currentDoc,state.currentPage)];
    const candidates=nearbyElements(currentElements(state,state.currentDoc,state.currentPage,filter),{x:event.clientX,y:event.clientY},toScreen,{widthFor:el=>scale?(dimensionsFor(el).widthM||0)/scale*Math.hypot(matrix.a,matrix.b):0});
    if(candidates.length>1)openWorks(candidates.map(hit=>hit.element.id));
    else if(candidates.length===1)selectElement(candidates[0].element.id);
    else if(!multi)clearSelection();
    return;
  }
});
$('planOverlay').addEventListener('keydown',event=>{
  if(mode==='select'&&(event.key==='Enter'||event.key===' ')){
    const target=event.target.closest('[data-element]');if(target){event.preventDefault();event.stopPropagation();selectElement(target.dataset.element,event.shiftKey);}
  }
});
$('multiButton').addEventListener('click',()=>{multi=!multi;mode='select';drawing.clear();render();toast(multi?'Sélectionnez plusieurs ouvrages sur le plan.':'Sélection simple activée.');});
$('documentSelect').addEventListener('change',async event=>{state.currentDoc=event.target.value;state.currentPage=1;selected.clear();drawing.clear();mode='select';filter='all';persist();render();await openDocument();});
$('pageSelect').addEventListener('change',event=>setPage(Number(event.target.value)));
$('trackingView').addEventListener('change',event=>{
  if(event.target.id==='trackingPage'){setPage(Number(event.target.value));return;}
  const lotId=event.target.dataset.billed;if(!lotId||!boot.permissions.export||!boot.permissions.edit||saving)return;
  const value=Number(event.target.value);if(!Number.isFinite(value)||value<0||value>1e9){toast('Saisissez un montant positif valide.');render();return;}
  const key=billedKey(state.currentDoc,state.currentPage,lotId),previous=state.billed[key]||0;
  if(roundMoney(value)===previous)return;
  record('Montant déjà facturé mis à jour',`${lotFor(lotId).company} · ${pageLabel()} · ${money(previous)} → ${money(value)}`,()=>{state.billed[key]=roundMoney(value);},'wallet');
});
document.addEventListener('focusout',event=>{
  if(event.target.id!=='elementNote'||selected.size!==1||saving||!canChangeStatus(state.elements.filter(el=>selected.has(el.id)),'progress'))return;
  const el=state.elements.find(el=>selected.has(el.id));const value=event.target.value.trim();
  if(el&&el.note!==value)setTimeout(()=>{
    const current=state.elements.find(item=>item.id===el.id);
    if(current&&current.note!==value)record('Note de terrain enregistrée',`${current.reference} · ${current.name}`,()=>{current.note=value;},'file');
  },0);
});
$('zoomIn').addEventListener('click',async()=>{await viewer.changeZoom(.5);updateZoom();});
$('zoomOut').addEventListener('click',async()=>{await viewer.changeZoom(-.5);updateZoom();});
$('fitButton').addEventListener('click',async()=>{await viewer.fit();updateZoom();});
$('focusBuilding').addEventListener('click',async()=>{await viewer.focus(doc().viewRegion);updateZoom();});
$('focusDetail').addEventListener('click',async()=>{await viewer.focus(doc().detailRegion);updateZoom();});
$('removeLastPoint').addEventListener('click',()=>drawing.removeLast());
$('elementLot').addEventListener('change',()=>{if(!editingMetaId)$('elementPrice').value=lotFor($('elementLot').value).price;updateSimplePrice();});
$('elementForm').addEventListener('input',updateSimplePrice);$('elementForm').addEventListener('change',updateSimplePrice);
$('shapeOptions').addEventListener('change',event=>{if(event.target.id==='rightAngles'){rightAngles=event.target.checked;drawing.hover=null;drawing.paint();}});
$('exportButton').addEventListener('click',async()=>{
  const button=$('exportButton');button.disabled=true;
  try{if(!boot.permissions.export)throw Error('Export non autorisé');const {exportWorkbook}=await import('./export.js');const result=await exportWorkbook(state);toast(`Excel téléchargé : ${result.elements} ouvrages, sur toutes les pages de ce PDF.`);}catch(error){toast(`Export impossible : ${error.message}`);}finally{button.disabled=false;}
});
$('helpButton').addEventListener('click',()=>$('helpDialog').showModal());
document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();setView('plan');});
$('calibrationForm').addEventListener('submit',event=>{
  event.preventDefault();if(!boot.permissions.edit||saving)return;const meters=Number($('realDistance').value);
  if(!calibrationPoints||!Number.isFinite(meters)||meters<=0||meters>10000)return;
  const [a,b]=calibrationPoints,distance=Math.hypot(a.x-b.x,a.y-b.y);if(distance<1){toast('Les deux points sont trop proches.');return;}
  const nextTool=pendingTool;
  record('Échelle du plan définie',`${doc().name} · ${pageLabel()} · distance de référence ${num(meters,2)} m`,()=>{state.calibrations[scaleKey(state.currentDoc,state.currentPage)]=meters/distance;},'ruler');
  $('calibrationDialog').dataset.completed='true';$('calibrationDialog').close();pendingTool=null;drawing.clear();mode=nextTool||'select';render();
});
$('elementForm').addEventListener('submit',event=>{
  event.preventDefault();if(!pendingGeometry||!boot.permissions.edit||saving)return;
  const invalid=$('elementForm').querySelector(':invalid');
  if(invalid){invalid.closest('details')?.setAttribute('open','');$('elementForm').reportValidity();return;}
  const dimensionData=dimensionForm.read();if(!dimensionData)return;
  const name=$('elementName').value.trim(),price=Number($('elementPrice').value);if(!name||!Number.isFinite(price)||price<0||price>1e6)return;
  const geometry=pendingGeometry,lot=lotFor($('elementLot').value),id=editingMetaId||crypto.randomUUID();
  const prefix={point:'ELE',line:'CVC',area:'PEI'}[geometry.kind];
  const references=new Set(state.elements.filter(el=>el.docId===state.currentDoc&&el.page===state.currentPage).map(el=>el.reference));
  let next=1;while(references.has(`${prefix}-${String(next).padStart(3,'0')}`))next++;
  const element={id,docId:state.currentDoc,page:state.currentPage,lotId:lot.id,kind:geometry.kind,points:geometry.points,name,price,reference:`${prefix}-${String(next).padStart(3,'0')}`,status:'todo',note:'',room:'',dimensions:dimensionData.dimensions,priceBasis:dimensionData.priceBasis};
  if(editingMetaId){
    const current=state.elements.find(el=>el.id===editingMetaId);
    if(current)record('Ouvrage modifié',`${current.reference} · ${name}`,()=>Object.assign(current,{name,price,lotId:lot.id,dimensions:dimensionData.dimensions,priceBasis:dimensionData.priceBasis}),'edit');
  }else record('Un ouvrage a été ajouté au plan',`${name} · ${num(quantity(element,state),2)} ${unitFor(element)} · ${pageLabel()}`,()=>state.elements.push(element),'pin');
  $('elementDialog').dataset.completed='true';$('elementDialog').close();drawing.clear();pendingGeometry=null;editingMetaId=null;mode='select';filter=lot.id;selected=new Set([id]);render();
});
for(const dialog of document.querySelectorAll('dialog')){
  dialog.addEventListener('close',()=>{
    if(dialog.dataset.completed){delete dialog.dataset.completed;return;}
    if(dialog.id==='elementDialog'||dialog.id==='calibrationDialog'){drawing.clear();pendingGeometry=null;editingMetaId=null;calibrationPoints=null;pendingTool=null;editingTargetId=null;mode='select';render();}
  });
}
document.addEventListener('keydown',event=>{
  if(event.target.matches('input,textarea,select')||document.querySelector('dialog[open]'))return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(drawing.isDrawing()&&drawing.points.length)drawing.removeLast();else undo();}
  if(event.key==='Escape'){selected.clear();drawing.clear();editingTargetId=null;mode='select';render();}
  if((event.key==='Backspace'||event.key==='Delete')&&drawing.isDrawing()&&drawing.points.length){event.preventDefault();drawing.removeLast();}
  if(event.key==='Enter'&&drawing.canFinish()){event.preventDefault();drawing.finish();}
});
function editSelected(){
  if(!boot.permissions.edit||saving)return;
  if(selected.size!==1)return;const el=state.elements.find(el=>selected.has(el.id));if(!el)return;
  editingMetaId=el.id;pendingGeometry={kind:el.kind,points:el.points,lotId:el.lotId};
  $('elementDialogEyebrow').textContent=el.reference;$('newElementTitle').textContent='Modifier l’ouvrage';$('elementSubmit').textContent='Enregistrer';
  $('elementName').value=el.name;$('elementPrice').value=el.price;
  $('elementLot').innerHTML=LOTS.map(lot=>`<option value="${e(lot.id)}" ${el.lotId===lot.id?'selected':''}>${e(lot.company)} · ${e(lot.name)}</option>`).join('');
  $('newElementInfo').textContent=`Mesure du tracé : ${num(geometricQuantity(el,state),2)} ${unitFor(el.kind)}`;dimensionForm.setElement(el);$('elementDialog').showModal();
  $('advancedElementOptions').open=false;updateSimplePrice();
}
function redrawSelected(){
  if(!boot.permissions.edit||saving)return;
  if(selected.size!==1)return;const el=state.elements.find(el=>selected.has(el.id));if(!el)return;
  if(el.kind==='line')variants.line=el.points.length>2?'path':'segment';
  setTool(el.kind);editingTargetId=el.id;filter='all';render();toast('Redessinez l’ouvrage. Son ancien tracé sera remplacé à la validation.');
}
function deleteSelected(){
  if(!boot.permissions.delete||saving)return;
  const ids=new Set(selected);if(!ids.size)return;
  record(`${ids.size} ouvrage${ids.size>1?'s':''} retiré${ids.size>1?'s':''}`,`${pageLabel()} · suppression annulable`,()=>{state.elements=state.elements.filter(el=>!ids.has(el.id));selected.clear();},'trash');
}
$('terrainLotSelect').innerHTML='<option value="all">Toutes les entreprises / lots</option>'+LOTS.map(lot=>`<option value="${e(lot.id)}">${e(lot.company)} · ${e(lot.name)}</option>`).join('');
fillIcons();render();$('savedState').textContent=boot.syncText;if(!LOTS.length)storageWarning('Ajoutez une entreprise au chantier pour pouvoir affecter vos ouvrages.');openDocument();

// Disable mutation shortcuts while waiting for the durable host acknowledgement.
for(const type of ['click','submit','change','keydown'])document.addEventListener(type,event=>{
  if(saving||unconfirmed){event.preventDefault();event.stopImmediatePropagation();}
},true);
