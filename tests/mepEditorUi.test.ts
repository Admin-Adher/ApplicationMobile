import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {describe,it,expect} from 'vitest';

class Control {
  value:any='';checked=false;hidden=false;disabled=false;required=false;open=false;textContent='';dataset:any={};
  options:any[]=[];attributes=new Map<string,string>();events:Record<string,Function>={};html='';children:unknown[]=[];
  controls:Control[]=[];submit=new ControlPlaceholder();
  get innerHTML(){return this.html;}
  set innerHTML(value:string){this.html=value;const selected=/<option value="([^"]*)" selected/.exec(value),first=/<option value="([^"]*)"/.exec(value);if(selected||first)this.value=(selected||first)![1];}
  addEventListener(type:string,handler:Function){this.events[type]=handler;}
  dispatchEvent(event:any){this.events[event.type]?.(event);return true;}
  setAttribute(key:string,value:string){this.attributes.set(key,value);}
  querySelectorAll(){return this.controls;}
  querySelector(){return this.submit;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  reportValidity(){return true;}
  append(child:unknown){this.children.push(child);}
  getBoundingClientRect(){return {width:1000};}
  classList={add:()=>{},remove:()=>{},toggle:()=>{}};
}
class ControlPlaceholder{disabled=false;}

function setup(permissions={edit:true,editOwn:false,export:true},ownResponsible=true){
  const controls=new Map<string,Control>();
  const $=(id:string)=>{if(!controls.has(id))controls.set(id,new Control());return controls.get(id)!;};
  const work:any={id:'a',docId:'plan',page:1,lotId:'["company","lot-a"]',kind:'line',points:[{x:100,y:100},{x:300,y:200}],reference:'EAU-001',name:'Eau froide local 105R',status:'progress',progressPercent:30,price:0,room:'105R',mep:{discipline:'plumbing',network:'Eau froide',subnetwork:'Distribution',zone:'105R',quantityMode:'manual',plannedQuantity:100,unit:'m',weight:1},blockers:[]};
  const groups:any[]=[{id:work.lotId,companyId:'company',company:'Entreprise test',name:'Plomberie'}];
  const doc:any={elements:[work],calibrations:{'plan:1':.1},billed:{},currentDoc:'plan',currentPage:1,history:[]};
  const boot:any={permissions,userId:'user',companyId:'company',people:[{id:'user',name:'Responsable test',companyId:'company'}],plan:{id:'plan',name:'Plan test',building:'Bâtiment A'},groups:[]};
  const state:any={photoResult:{refs:['btlocal://11111111-1111-4111-8111-111111111111']},photoError:null,positioning:false,writes:[],toasts:[],requests:[],exports:[],located:[],projectSnapshot:{plans:[],history:[],generatedAt:'2026-11-17T10:00:00.000Z'}};
  const exportButtons=[new Control(),new Control(),new Control()];
  const context:any={exports:{},module:{exports:{}},console,Intl,Date,JSON,Number,Map,Set,Event:class{constructor(public type:string,public options?:unknown){}},crypto:{randomUUID},window:{BT_BOOT:boot},document:{getElementById:$,querySelectorAll:(selector:string)=>selector==='[data-mep-export]'?exportButtons:[],createElement:()=>new Control(),body:{dataset:{view:'plan'}}}};
  const calc:any={};runInNewContext(ts.transpileModule(readFileSync('lib/plan-progress/editor/mep-calculations.js','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:calc,require:()=>({progressWeight:(el:any)=>el.status==='todo'?0:['installed','checked'].includes(el.status)?1:(el.progressPercent??50)/100}),Date,Map,Set,Number,JSON});
  const audit:any={};runInNewContext(ts.transpileModule(readFileSync('lib/plan-progress/editor/mep-audit.js','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:audit,Date,JSON});
  const request=async(type:string,payload:any)=>{state.requests.push({type,payload});if(type==='pickMepPhotos'){if(state.photoError)throw state.photoError;return state.photoResult;}if(type==='resolveMepPhotos')return {urls:[]};if(type==='projectMep')return state.projectSnapshot;return {};};
  const canChangeStatus=(els:any[],status:string)=>boot.permissions.edit||boot.permissions.editOwn&&status!=='checked'&&els.every(el=>el.status!=='checked'&&JSON.parse(el.lotId)[0]===boot.companyId);
  const captureExport=async(_doc:any,_snapshot:any,filters:any)=>state.exports.push(filters);
  context.require=(name:string)=>name==='./bridge.js'?{boot,request,canChangeStatus}:name==='./model.js'?{LOTS:groups,lotFor:(id:string)=>groups.find(g=>g.id===id)||{company:'Entreprise test',name:'Lot à réaffecter'},escapeHtml:(v:any)=>String(v??'').replace(/[<>&"]/g,(c:string)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]!)),num:(n:number)=>String(n)}:name==='./mep-calculations.js'?calc:name==='./mep-audit.js'?audit:name==='./mep-export.js'?{exportMepWorkbook:captureExport,exportMepCsv:captureExport,exportMepPdf:captureExport}:{};
  runInNewContext(ts.transpileModule(readFileSync('lib/plan-progress/editor/mep-ui.js','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  $('mepBlockerStatus').options=['open','assigned','in_progress','resolved','closed'].map(value=>({value,disabled:false}));
  $('mepBlockerForm').controls=['mepBlockerDescription','mepBlockerCompany','mepBlockerPerson','mepBlockerDue','mepBlockerStatus','mepBlockerPriority','mepBlocksProgress'].map($);
  $('elementLot').value=work.lotId;
  const api=context.exports.createMepUI({getState:()=>doc,getSelected:()=>new Set(['a']),record:(title:string,detail:string,mutate:Function)=>{state.writes.push({title,detail});mutate();},toast:(value:string)=>state.toasts.push(value),render:()=>{},setView:(view:string)=>context.document.body.dataset.view=view,isBusy:()=>false,clearSelection:()=>{},locateWork:(el:any)=>state.located.push(el.id),beginPositioning:()=>state.positioning=true,endPositioning:()=>state.positioning=false,beginPortion:()=>state.positioning=true,endPortion:()=>state.positioning=false});
  const button=(attribute:string,dataset={})=>({hasAttribute:(name:string)=>name===attribute,dataset});
  const blocker=(status='open')=>({id:randomUUID(),point:{x:130,y:170},description:'Support en attente',photoRefs:['btmedia://22222222-2222-4222-8222-222222222222'],companyId:'company',responsibleId:ownResponsible?'user':'other',dueDate:'2026-11-20',openedAt:'2026-11-16T09:00:00.000Z',status,blocksProgress:true,priority:'normal'});
  const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  return {$,doc,work,boot,state,api,button,blocker,settle,groups,exportButtons};
}

describe('shared MEP editor behavior',()=>{
  it('preserves a legacy work without adding a new null MEP field',()=>{
    const q=setup();q.api.setElement({kind:'line',room:'105R'});
    expect(q.api.readElement('line')).toEqual({room:'105R'});
  });
  it('edits network, room, explicit planned quantity and weight without inventing executed quantities',()=>{
    const q=setup();q.api.setElement(q.work);q.$('mepPlanned').value='120';q.$('mepWeight').value='3';
    const value=q.api.readElement('line');
    expect(value).toMatchObject({room:'105R',mep:{network:'Eau froide',plannedQuantity:120,quantityMode:'manual',unit:'m',weight:3}});
    expect(value.mep).not.toHaveProperty('executedQuantity');
    q.$('mepPlanned').value='0';expect(()=>q.api.readElement('line')).toThrow('strictement positifs');
  });
  it('keeps diagram measurement separate from manual quantity input',()=>{
    const q=setup();q.api.setElement(q.work);q.$('mepQuantityMode').value='drawing';q.$('mepPlanned').value='999';q.$('mepUnit').value='m³';
    expect(q.api.readElement('line').mep).toMatchObject({quantityMode:'drawing',plannedQuantity:null,unit:'m'});
  });
  it('requires an explicit quantity or estimate after opting to trace without a scale',()=>{
    const q=setup();q.api.setElement({kind:'line'});q.api.setUnscaled();
    expect(q.$('mepEnabled').checked).toBe(true);expect(q.$('mepQuantityMode').value).toBe('manual');expect(q.$('mepPlanned').required).toBe(true);
    expect(()=>q.api.readElement('line')).toThrow();q.$('mepNetwork').value='Eau froide';q.$('mepZone').value='105R';q.$('mepPlanned').value='100';
    expect(q.api.readElement('line').mep).toMatchObject({quantityMode:'manual',plannedQuantity:100});
    q.$('mepQuantityMode').value='estimate';q.$('mepQuantityMode').events.change();
    expect(q.$('mepPlanned').required).toBe(false);expect(q.api.readElement('line').mep).toMatchObject({quantityMode:'estimate',plannedQuantity:null});
  });
  it('applies independent network and blocked filters and can reset them',()=>{
    const q=setup();q.$('mepDisciplineFilter').value='plumbing';q.$('mepNetworkFilter').value=JSON.stringify(['plumbing','Eau froide','Distribution']);q.$('mepOnlyBlocked').checked=true;
    q.$('mepFiltersForm').events.submit({preventDefault(){}});
    expect(q.api.matches(q.work)).toBe(false);q.work.blockers=[q.blocker()];expect(q.api.matches(q.work)).toBe(true);
    expect(q.api.matches({...q.work,mep:{...q.work.mep,network:'Eau chaude'}})).toBe(false);
    q.$('mepResetFilters').events.click();expect(q.api.matches({...q.work,mep:null,blockers:[]})).toBe(true);
  });
  it('places a blocker at the selected PDF coordinates and saves photo intent through the durable port',async()=>{
    const q=setup();q.api.handleClick(q.button('data-mep-add-blocker'));await q.settle();
    q.$('mepBlockerDescription').value='Gaine traversée par la structure';q.$('mepBlockerCompany').value='company';q.$('mepBlockerPerson').value='user';q.$('mepBlockerStatus').value='open';q.$('mepBlockerPriority').value='high';
    q.api.handleClick(q.button('data-mep-position'));expect(q.state.positioning).toBe(true);
    const overlay:any=q.$('planOverlay');overlay.getScreenCTM=()=>({inverse:()=>({})});overlay.viewBox={baseVal:{height:700}};overlay.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return {x:this.x/2,y:this.y/2};}});
    expect(q.api.handlePlanClick({clientX:380,clientY:460})).toBe(true);await q.settle();expect(q.state.positioning).toBe(false);
    await q.$('mepPickPhotos').events.click();q.$('mepBlockerForm').events.submit({preventDefault(){}});
    expect(q.work.blockers).toHaveLength(1);expect(q.work.blockers[0]).toMatchObject({point:{x:190,y:230},description:'Gaine traversée par la structure',responsibleId:'user',photoRefs:['btlocal://11111111-1111-4111-8111-111111111111']});
    expect(q.state.writes).toHaveLength(1);
  });
  it('does not create a blocker when a photo is missing or its preparation failed',async()=>{
    const q=setup();q.api.handleClick(q.button('data-mep-add-blocker'));await q.settle();q.$('mepBlockerDescription').value='Attente';q.$('mepBlockerCompany').value='company';
    q.state.photoError=new Error('Hors ligne : photo non préparée');await q.$('mepPickPhotos').events.click();q.$('mepBlockerForm').events.submit({preventDefault(){}});
    expect(q.work.blockers).toHaveLength(0);expect(q.state.writes).toHaveLength(0);expect(q.state.toasts[0]).toContain('photo non préparée');
  });
  it('preserves a closed blocker and its identity when consulting or editing it',async()=>{
    const q=setup(),block=q.blocker('closed');q.work.blockers=[block];q.api.handleClick(q.button('',{mepEditBlocker:block.id,mepWork:'a'}));await q.settle();
    expect(q.$('mepBlockerStatus').value).toBe('closed');q.$('mepBlockerDescription').value='Support réparé et contrôlé';q.$('mepBlockerForm').events.submit({preventDefault(){}});
    expect(q.work.blockers).toHaveLength(1);expect(q.work.blockers[0]).toMatchObject({id:block.id,status:'closed',openedAt:block.openedAt,description:'Support réparé et contrôlé'});
  });
  it('allows a responsible own-company user to treat without changing assignment, location or closing',async()=>{
    const q=setup({edit:false,editOwn:true,export:false}),block=q.blocker();q.work.blockers=[block];q.api.handleClick(q.button('',{mepEditBlocker:block.id,mepWork:'a'}));await q.settle();
    expect(q.$('mepBlockerDescription').disabled).toBe(true);expect(q.$('mepBlockerCompany').disabled).toBe(true);expect(q.$('mepBlockerStatus').disabled).toBe(false);
    expect(q.$('mepBlockerStatus').options.find(o=>o.value==='closed').disabled).toBe(true);
    q.$('mepBlockerStatus').value='resolved';q.$('mepBlockerForm').events.submit({preventDefault(){}});
    expect(q.work.blockers[0]).toMatchObject({id:block.id,status:'resolved',companyId:block.companyId,point:block.point});
  });
  it('does not allow an own-company user to treat a blocker assigned to another person',async()=>{
    const q=setup({edit:false,editOwn:true,export:false},false),block=q.blocker();q.work.blockers=[block];q.api.handleClick(q.button('',{mepEditBlocker:block.id,mepWork:'a'}));await q.settle();
    expect(q.$('mepBlockerStatus').disabled).toBe(true);q.$('mepBlockerForm').events.submit({preventDefault(){}});expect(q.state.writes).toHaveLength(0);
  });
  it('marks actual disconnected portions and removes only the requested span without double counting overlaps',()=>{
    const q=setup();q.work.points=[{x:0,y:0},{x:1000,y:0}];q.work.status='todo';q.work.progressPercent=null;
    const overlay:any=q.$('planOverlay');overlay.getScreenCTM=()=>({a:1,b:0,inverse:()=>({})});overlay.viewBox={baseVal:{height:700}};overlay.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}});
    const mark=(from:number,to:number,remove=false)=>{q.api.handleClick(q.button(remove?'data-mep-portion-remove':'data-mep-portion-add'));q.api.handlePlanClick({clientX:from,clientY:0});q.api.handlePlanClick({clientX:to,clientY:0});q.api.handleClick(q.button('data-mep-portion-apply'));};
    mark(400,700);expect(q.work.executedRanges).toEqual([[.4,.7]]);expect(q.work.progressPercent).toBeCloseTo(30);expect(q.state.positioning).toBe(false);
    mark(100,200);expect(q.work.executedRanges).toEqual([[.1,.2],[.4,.7]]);expect(q.work.progressPercent).toBeCloseTo(40);
    mark(500,650);expect(q.work.progressPercent).toBeCloseTo(40);
    mark(500,600,true);expect(q.work.executedRanges).toEqual([[.1,.2],[.4,.5],[.6,.7]]);expect(q.work.progressPercent).toBeCloseTo(30);
    expect(q.work.status).toBe('progress');
  });
  it('keeps a portion gesture separate from saved data until validation and cancels it cleanly',()=>{
    const q=setup();q.work.points=[{x:0,y:0},{x:1000,y:0}];const overlay:any=q.$('planOverlay');overlay.getScreenCTM=()=>({a:1,b:0,inverse:()=>({})});overlay.viewBox={baseVal:{height:700}};overlay.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}});
    q.api.handleClick(q.button('data-mep-portion-add'));q.api.handlePlanClick({clientX:500,clientY:200});expect(q.$('mepPortionApply').disabled).toBe(true);expect(q.state.toasts.at(-1)).toContain('plus près');
    q.api.handlePlanClick({clientX:300,clientY:0});q.api.handlePlanClick({clientX:500,clientY:0});expect(q.state.writes).toHaveLength(0);expect(q.api.placing).toBe(true);
    q.api.cancelGesture();expect(q.api.placing).toBe(false);expect(q.state.writes).toHaveLength(0);expect(q.work).not.toHaveProperty('executedRanges');
  });
  it('cannot finish a blocked tronçon by marking all its portions',()=>{
    const q=setup();q.work.points=[{x:0,y:0},{x:1000,y:0}];q.work.status='todo';q.work.progressPercent=null;q.work.blockers=[q.blocker()];const overlay:any=q.$('planOverlay');overlay.getScreenCTM=()=>({a:1,b:0,inverse:()=>({})});overlay.viewBox={baseVal:{height:700}};overlay.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}});
    q.api.handleClick(q.button('data-mep-portion-add'));q.api.handlePlanClick({clientX:0,clientY:0});q.api.handlePlanClick({clientX:1000,clientY:0});q.api.handleClick(q.button('data-mep-portion-apply'));
    expect(q.state.writes).toHaveLength(0);expect(q.state.toasts.at(-1)).toContain('bloquant');expect(q.work.status).toBe('todo');
  });
  it('scopes real lots and responsible people to the chosen company',()=>{
    const q=setup();q.groups.push({id:'["other-company","lot-b"]',companyId:'other-company',company:'Autre entreprise',name:'CVC'});
    q.boot.people.push({id:'other-person',name:'Responsable autre entreprise',companyId:'other-company'});
    q.api.setElement(q.work);expect(q.$('elementLot').innerHTML).toContain('Plomberie');expect(q.$('elementLot').innerHTML).not.toContain('CVC');
    expect(q.$('mepWorkResponsible').innerHTML).toContain('Responsable test');expect(q.$('mepWorkResponsible').innerHTML).not.toContain('Responsable autre entreprise');
    q.$('mepWorkResponsible').value='user';expect(q.api.readElement('line').mep.responsibleId).toBe('user');
    q.$('elementCompany').value='other-company';q.$('elementCompany').events.change();
    expect(q.$('elementLot').value).toBe('["other-company","lot-b"]');expect(q.$('elementLot').innerHTML).not.toContain('Plomberie');
    expect(q.$('mepWorkResponsible').value).toBe('');expect(q.$('mepWorkResponsible').innerHTML).toContain('Responsable autre entreprise');expect(q.$('mepWorkResponsible').innerHTML).not.toContain('Responsable test');
  });
  it('retains an unchanged unavailable responsible person without silently clearing the assignment',()=>{
    const q=setup();q.work.mep.responsibleId='unavailable';q.api.setElement(q.work);
    expect(q.$('mepWorkResponsible').value).toBe('unavailable');expect(q.$('mepWorkResponsible').innerHTML).toContain('précédemment affecté');
    expect(q.api.readElement('line').mep.responsibleId).toBe('unavailable');
    q.$('mepWorkResponsible').value='';expect(q.api.readElement('line').mep.responsibleId).toBeNull();
  });
  it('refuses a newly assigned responsible person from another company',()=>{
    const q=setup();q.boot.people.push({id:'wrong-company',name:'Membre autre entreprise',companyId:'other'});q.api.setElement(q.work);q.$('mepWorkResponsible').value='wrong-company';
    expect(()=>q.api.readElement('line')).toThrow('entreprise affectée');
  });
  it('requires a real lot for a new network while preserving a legacy generic selection and treatment',async()=>{
    const q=setup();const generic={id:'["company",null]',companyId:'company',company:'Entreprise test',name:'Ouvrages'};q.groups.push(generic);q.work.lotId=generic.id;
    q.api.setElement(q.work);expect(q.$('elementLot').value).toBe(generic.id);expect(q.api.readElement('line').mep.network).toBe('Eau froide');expect(q.$('mepLotGuidance').hidden).toBe(false);
    q.api.handleClick(q.button('data-mep-add-blocker'));await q.settle();expect(q.$('mepBlockerDialog').open).toBe(false);expect(q.state.toasts.at(-1)).toContain('sans lot précis');
    q.api.setElement({kind:'line'});q.$('elementLot').value=generic.id;q.api.setUnscaled();q.$('mepNetwork').value='Nouveau réseau';q.$('mepZone').value='Zone A';q.$('mepPlanned').value='10';
    expect(()=>q.api.readElement('line')).toThrow('lot réel');
    const block=q.blocker();q.work.blockers=[block];q.api.handleClick(q.button('',{mepEditBlocker:block.id,mepWork:'a'}));await q.settle();q.$('mepBlockerStatus').value='resolved';q.$('mepBlockerForm').events.submit({preventDefault(){}});
    expect(q.work.blockers[0].status).toBe('resolved');
  });
  it('guides setup when no real lot exists instead of presenting a dead end',()=>{
    const q=setup();q.groups.splice(0,1,{id:'["company",null]',companyId:'company',company:'Entreprise test',name:'Ouvrages'});q.$('elementLot').value=q.groups[0].id;q.api.setElement({kind:'line'});q.api.setUnscaled();
    expect(q.$('mepLotGuidance').textContent).toContain('Terrain → Équipes → Gestion des lots');expect(q.$('mepLotGuidance').textContent).toContain('Rouvrez ensuite ce plan');
  });
  it('renders true work status, assigned person and element-specific activity in desktop and mobile presentations',async()=>{
    const q=setup();q.work.mep.responsibleId='user';q.work.blockers=[q.blocker()];q.doc.elementActivity={a:{updatedAt:'2026-11-16T10:00:00.000Z',authorName:'Auteur du tronçon',userId:'writer-a'}};
    q.doc.history=[{time:'2027-01-01T18:00:00.000Z',authorName:'Auteur autre ouvrage',changes:[{target:'elements',key:'other-work',after:{note:'Autre saisie'}}]}];
    q.api.handleClick(q.button('data-mep-project'));await q.settle();const html=q.$('mepProjectTable').innerHTML;
    expect(html).toContain('mep-desktop-works');expect(html).toContain('mep-mobile-works');expect(html).toContain('En cours · Bloqué');expect(html).toContain('Responsable test');expect(html).toContain('2026-11-16T10:00:00.000Z');expect(html).toContain('Auteur du tronçon');expect(html).not.toContain('2027-01-01');expect(html).not.toContain('Auteur autre ouvrage');
    expect(html).toContain('Voir sur le plan');
  });
  it('uses the company as responsible fallback and labels missing activity without inventing a date',async()=>{
    const q=setup();q.api.handleClick(q.button('data-mep-project'));await q.settle();const html=q.$('mepProjectTable').innerHTML;
    expect(html).toContain('Entreprise test');expect(html).toContain('Non renseignée');expect(html).not.toContain('<time');
  });
  it('sends open-only scope to the export without changing dashboard quantities or metrics',async()=>{
    const q=setup();q.work.blockers=[q.blocker(),q.blocker('closed')];q.api.handleClick(q.button('data-mep-project'));await q.settle();
    const metrics=q.$('mepProjectMetrics').innerHTML,document=JSON.stringify(q.doc);q.$('mepOpenOnlyExport').checked=true;q.$('mepOpenOnlyExport').events.change();
    expect(q.$('mepExportScopeHelp').textContent).toContain('ouvrages concernés');expect(q.$('mepExportScopeCount').textContent).toContain('1 point');expect(q.api.exportFilters.openOnly).toBe(true);
    expect(q.$('mepProjectMetrics').innerHTML).toBe(metrics);expect(JSON.stringify(q.doc)).toBe(document);
    q.api.handleClick(q.button('',{mepExport:'xlsx'}));await q.settle();expect(q.state.exports).toHaveLength(1);expect(q.state.exports[0].openOnly).toBe(true);
  });
  it('makes an empty open-only export scope explicit and disables export actions',async()=>{
    const q=setup();q.work.blockers=[q.blocker('closed')];q.api.handleClick(q.button('data-mep-project'));await q.settle();q.$('mepOpenOnlyExport').checked=true;q.$('mepOpenOnlyExport').events.change();
    expect(q.$('mepExportScopeCount').textContent).toContain('Aucun point ouvert');expect(q.exportButtons.every(button=>button.disabled)).toBe(true);
    q.$('mepOpenOnlyExport').checked=false;q.$('mepOpenOnlyExport').events.change();expect(q.exportButtons.every(button=>!button.disabled)).toBe(true);
  });
  it('clears presentation filters before locating a filtered work on its plan',async()=>{
    const q=setup();q.$('mepDisciplineFilter').value='hvac';q.$('mepNetworkFilter').value='unmatched';q.$('mepOnlyBlocked').checked=true;q.$('mepFiltersForm').events.submit({preventDefault(){}});expect(q.api.matches(q.work)).toBe(false);
    q.api.handleClick(q.button('',{mepLocateWork:'a'}));await q.settle();expect(q.api.matches(q.work)).toBe(true);expect(q.state.located).toEqual(['a']);
  });
});

describe('explicit unscaled drawing fallback',()=>{
  const loadDrawing=()=>{
    const cache=new Map<string,any>(),boot={groups:[],document:{elements:[],billed:{}},plan:{id:'plan'}};
    const load=(name:string):any=>{if(name==='bridge.js')return {boot};if(cache.has(name))return cache.get(name);const exports:any={};cache.set(name,exports);runInNewContext(ts.transpileModule(readFileSync('lib/plan-progress/editor/'+name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(specifier:string)=>load(specifier.replace('./','')),Intl});return exports;};
    return load('drawing.js').DrawingController;
  };
  it.each([false,true])('keeps missing-scale tracing opt-in (enabled=%s)',enabled=>{
    const Drawing=loadDrawing(),saved:any[]=[],errors:string[]=[];
    const overlay:any={addEventListener(){},getBoundingClientRect:()=>({width:1000}),viewBox:{baseVal:{width:1000,height:700}}};
    const drawing=new Drawing({overlay,layer:{innerHTML:''},getMode:()=>'line',getVariant:()=>'path',getRightAngles:()=>false,getScale:()=>undefined,getAllowUnscaled:()=>enabled,onGeometry:(kind:string,points:unknown)=>saved.push({kind,points}),onPoints(){},onError:(message:string)=>errors.push(message)});
    drawing.points=[{x:100,y:100},{x:400,y:250}];drawing.finish();
    expect(saved).toHaveLength(enabled?1:0);expect(errors).toHaveLength(enabled?0:1);
  });
  it('still rejects crossed surfaces even after explicitly skipping scale measurement',()=>{
    const Drawing=loadDrawing(),saved:any[]=[],errors:string[]=[];
    const overlay:any={addEventListener(){},getBoundingClientRect:()=>({width:1000}),viewBox:{baseVal:{width:1000,height:700}}};
    const drawing=new Drawing({overlay,layer:{innerHTML:''},getMode:()=>'area',getVariant:()=>'polygon',getRightAngles:()=>false,getScale:()=>undefined,getAllowUnscaled:()=>true,onGeometry:(kind:string)=>saved.push(kind),onPoints(){},onError:(message:string)=>errors.push(message)});
    drawing.points=[{x:100,y:100},{x:400,y:400},{x:100,y:400},{x:400,y:100}];drawing.finish();
    expect(saved).toHaveLength(0);expect(errors).toHaveLength(1);
  });
});
