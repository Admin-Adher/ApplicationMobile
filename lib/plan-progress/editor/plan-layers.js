import {request} from './bridge.js';
import {loadPdf} from './pdf-viewer.js';
export function disposeLayerPdf(pdf){
  try{const result=typeof pdf?.loadingTask?.destroy==='function'?pdf.loadingTask.destroy():typeof pdf?.destroy==='function'?pdf.destroy():pdf?.cleanup?.();Promise.resolve(result).catch(()=>{});}catch{}
}

/** Visual references only. They never modify the measuring scale or work geometry. */
export function attachMepLayers({getState,getViewer,toast,isBusy=()=>false}) {
  const paper=document.getElementById('planPaper'),overlay=document.getElementById('planOverlay');
  const dialog=document.createElement('dialog');dialog.className='modal mep-layer-dialog';dialog.id='mepLayersDialog';dialog.setAttribute('aria-labelledby','mepLayersTitle');
  dialog.innerHTML=`<div class="modal-top"><span class="eyebrow">RÉFÉRENCE VISUELLE</span><button type="button" class="terrain-icon-button" data-mep-layer-close aria-label="Fermer les calques">×</button></div><h2 id="mepLayersTitle">Superposer un plan</h2><p>Comparez les réseaux de deux PDF du chantier. Vérifiez leur indice et leur alignement avant de mesurer sur le plan principal.</p><div role="status" id="mepLayerStatus"></div><label class="field-label" for="mepLayerPlan">Plan de référence</label><select class="input" id="mepLayerPlan"><option value="">Choisir un PDF…</option></select><div class="mep-layer-actions"><button type="button" class="button primary" data-mep-layer-load>Afficher le calque</button><button type="button" class="button secondary" data-mep-layer-remove>Retirer</button></div><section id="mepLayerSettings" hidden><label class="field-label" for="mepLayerPage">Page du calque</label><select class="input" id="mepLayerPage"></select><label class="field-label" for="mepLayerOpacity">Opacité <output id="mepLayerOpacityValue">45 %</output></label><input id="mepLayerOpacity" type="range" min="10" max="90" step="5" value="45"><details><summary>Ajuster l’alignement</summary><p class="field-hint">Les déplacements sont exprimés en pourcentage de la largeur du plan, pas en centimètres. Le calque ne sert pas de référence de métrage.</p><div class="mep-layer-alignment"><label for="mepLayerX">Horizontal (%)<input class="input" id="mepLayerX" type="number" min="-100" max="100" step="0.1" value="0" inputmode="decimal"></label><label for="mepLayerY">Vertical (%)<input class="input" id="mepLayerY" type="number" min="-100" max="100" step="0.1" value="0" inputmode="decimal"></label><label for="mepLayerScale">Taille (%)<input class="input" id="mepLayerScale" type="number" min="10" max="400" step="0.1" value="100" inputmode="decimal"></label><label for="mepLayerRotation">Rotation (°)<input class="input" id="mepLayerRotation" type="number" min="-180" max="180" step="0.1" value="0" inputmode="decimal"></label></div><button type="button" class="button secondary" data-mep-layer-reset>Réinitialiser l’alignement</button></details><p class="field-hint">Calque local et temporaire : il est retiré lorsque vous changez de plan ou de page. Les ouvrages et l’échelle restent inchangés.</p></section><button type="button" class="terrain-button full" data-mep-layer-close>Revenir au plan</button>`;
  document.body.append(dialog);
  const button=document.createElement('button');button.type='button';button.className='terrain-button';button.dataset.mepLayers='';button.textContent='Superposer un plan';
  document.querySelector('#planMenuDialog .plan-menu-list')?.append(button);
  const $=id=>dialog.querySelector('#'+id),status=$('mepLayerStatus');
  let scope='',pdf=null,canvas=null,task=null,revision=0,requestToken=0,pageNumber=1,loading=false,plans=[];
  const stateKey=()=>`${getState().currentDoc}:${getState().currentPage}`;
  const controls=['mepLayerX','mepLayerY','mepLayerScale','mepLayerRotation'];
  const setStatus=(text,error=false)=>{status.textContent=text;status.setAttribute('role',error?'alert':'status');};
  function transform() {
    if(!canvas)return;
    const n=id=>Number($(id).value),width=paper.clientWidth;
    const x=Number.isFinite(n('mepLayerX'))?Math.max(-100,Math.min(100,n('mepLayerX'))):0;
    const y=Number.isFinite(n('mepLayerY'))?Math.max(-100,Math.min(100,n('mepLayerY'))):0;
    const scale=Number.isFinite(n('mepLayerScale'))?Math.max(10,Math.min(400,n('mepLayerScale'))):100;
    const rotation=Number.isFinite(n('mepLayerRotation'))?Math.max(-180,Math.min(180,n('mepLayerRotation'))):0;
    canvas.style.opacity=String(Number($('mepLayerOpacity').value)/100);
    canvas.style.transform=`translate(${width*x/100}px,${width*y/100}px) rotate(${rotation}deg) scale(${scale/100})`;
    $('mepLayerOpacityValue').textContent=$('mepLayerOpacity').value+' %';
  }
  function clear() {
    revision++;requestToken++;task?.cancel();task=null;disposeLayerPdf(pdf);pdf=null;canvas?.remove();canvas=null;loading=false;
    $('mepLayerPlan').disabled=false;dialog.querySelector('[data-mep-layer-load]').disabled=false;
    $('mepLayerSettings').hidden=true;scope=stateKey();
    if(dialog.open)setStatus('Aucun calque affiché.');
  }
  async function paint() {
    const generation=++revision,current=pdf;if(!current)return;
    task?.cancel();task=null;loading=true;setStatus('Ouverture de la page du calque…');
    try{
      const page=await current.getPage(pageNumber);if(generation!==revision)return;
      const base=page.getViewport({scale:1});
      // Bound memory on A0 PDFs and high DPI tablets. The CSS transform follows
      // the primary paper's zoom; no whole-sheet 8x bitmap is allocated.
      const targetWidth=Math.min(2400,Math.sqrt(4_000_000*base.width/base.height));
      const viewport=page.getViewport({scale:targetWidth/base.width});
      const buffer=document.createElement('canvas');buffer.width=Math.ceil(viewport.width);buffer.height=Math.ceil(viewport.height);
      const render=page.render({canvasContext:buffer.getContext('2d'),viewport});task=render;await render.promise;if(generation!==revision)return;
      buffer.className='mep-reference-layer';buffer.setAttribute('aria-label','Calque PDF de référence, page '+pageNumber);buffer.dataset.page=String(pageNumber);
      Object.assign(buffer.style,{position:'absolute',left:'0',top:'0',width:'100%',height:'auto',pointerEvents:'none',transformOrigin:'0 0'});
      canvas?.remove();canvas=buffer;paper.insertBefore(canvas,overlay);transform();
      const plan=plans.find(p=>p.id===$('mepLayerPlan').value);setStatus(`${plan?.name||'Plan de référence'} · ${plan?.revision?'Indice '+plan.revision+' · ':''}Page ${pageNumber}. Vérifiez l’alignement.`);
    }catch(error){if(generation!==revision||error?.name==='RenderingCancelledException')return;setStatus(error?.message||'Le calque n’a pas pu être affiché. Réessayez.',true);}
    finally{if(generation===revision){loading=false;task=null;}}
  }
  async function open() {
    if(isBusy()){toast('Terminez ou annulez le tracé en cours avant de comparer les plans.');return;}
    render();document.getElementById('planMenuDialog')?.close();dialog.showModal();
    const generation=revision,previous=$('mepLayerPlan').value;setStatus('Chargement des plans du chantier…');
    try{
      const rows=await request('mepLayerPlans',{});if(!dialog.open||generation!==revision)return;
      plans=(Array.isArray(rows)?rows:[]).filter(p=>p&&typeof p.id==='string'&&p.id!==getState().currentDoc);
      $('mepLayerPlan').replaceChildren(new Option('Choisir un PDF…',''),...plans.map(p=>new Option([p.name,p.building,p.level,p.revision?'Indice '+p.revision:''].filter(Boolean).join(' · '),p.id)));
      if(plans.some(p=>p.id===previous))$('mepLayerPlan').value=previous;
      setStatus(plans.length?'Sélectionnez un PDF de référence du chantier.':'Aucun autre PDF disponible sur ce chantier.');
    }catch(error){setStatus(error?.message||'Les plans de référence sont indisponibles.',true);}
  }
  dialog.addEventListener('click',async event=>{
    const action=event.target.closest('button');if(!action)return;
    if(action.hasAttribute('data-mep-layer-close')){dialog.close();return;}
    if(action.hasAttribute('data-mep-layer-remove')){clear();return;}
    if(action.hasAttribute('data-mep-layer-reset')){for(const id of controls)$(id).value=id==='mepLayerScale'?'100':'0';transform();return;}
    if(!action.hasAttribute('data-mep-layer-load'))return;
    if(loading){toast('Le calque est en cours de chargement.');return;}
    const id=$('mepLayerPlan').value;if(!plans.some(p=>p.id===id)){setStatus('Choisissez un plan de référence.',true);return;}
    clear();const generation=revision,token=requestToken;loading=true;action.disabled=true;$('mepLayerPlan').disabled=true;setStatus('Téléchargement du PDF de référence…');
    try{
      const result=await request('mepLayerPdf',{planId:id});
      if(generation!==revision||!dialog.open)return;
      if(typeof result?.source!=='string'||!result.source.startsWith('data:application/pdf;base64,')||result.source.length>36_000_000)throw Error('PDF de référence invalide ou trop volumineux.');
      const loaded=await loadPdf(result.source);if(generation!==revision||!dialog.open){disposeLayerPdf(loaded);return;}
      pdf=loaded;scope=stateKey();pageNumber=1;
      $('mepLayerPage').replaceChildren(...Array.from({length:Math.min(pdf.numPages,2000)},(_,i)=>new Option('Page '+(i+1),String(i+1))));
      for(const key of controls)$(key).value=key==='mepLayerScale'?'100':'0';
      $('mepLayerSettings').hidden=false;await paint();
    }catch(error){if(generation===revision)setStatus(error?.message||'Impossible d’ouvrir ce calque.',true);}
    finally{if(token===requestToken){loading=false;action.disabled=false;$('mepLayerPlan').disabled=false;}}
  });
  dialog.addEventListener('input',event=>{if(event.target.id==='mepLayerOpacity'||controls.includes(event.target.id))transform();});
  $('mepLayerPage').addEventListener('change',()=>{pageNumber=Number($('mepLayerPage').value);void paint();});
  button.addEventListener('click',()=>void open());
  function render(){if(scope&&scope!==stateKey())clear();else transform();}
  return {open,render,clear};
}
