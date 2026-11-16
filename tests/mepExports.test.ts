import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as XLSX from 'xlsx';
import {describe,expect,it} from 'vitest';

function exportsApi(allowed=true){
  const sent:any[]=[];
  const boot={nonce:'mep-test',projectName:'Tropicalia test',plan:{id:'p1',name:'Plomberie <RDC>',building:'Bâtiment A',level:'RDC',revision:'D',updatedAt:'2026-11-16T10:00:00Z'},people:[{id:'u1',name:'Responsable test'}],groups:[{id:'["c1","l1"]',companyId:'c1',name:'Plomberie',company:'Entreprise <A>',icon:'building',unit:'m',price:0}],document:{elements:[],billed:{}},permissions:{export:allowed}};
  const cache=new Map<string,any>();
  const load=(filename:string):any=>{
    if(filename==='bridge.js')return {boot,request:async(type:string,payload:unknown)=>{sent.push({type,payload});return {};}};
    if(cache.has(filename))return cache.get(filename);
    const api:any={};cache.set(filename,api);
    const source=ts.transpileModule(readFileSync(resolve('lib/plan-progress/editor',filename),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
    runInNewContext(source,{exports:api,require:(path:string)=>load(path.replace('./','')),globalThis:{XLSX},Intl,Date,Map,Set,TextEncoder,btoa:(s:string)=>Buffer.from(s,'binary').toString('base64')});
    return api;
  };
  return {api:load('mep-export.js'),sent,boot};
}
function work(overrides:any={}){return {id:'w1',docId:'p1',page:1,kind:'line',points:[{x:100,y:100},{x:600,y:100}],lotId:'["c1","l1"]',name:'Alimentation eau',reference:'EAU-001',status:'progress',progressPercent:30,price:100,note:'Note terrain',mep:{discipline:'plumbing',network:'Eau froide',subnetwork:'EF-01',zone:'Local 105',quantityMode:'manual',plannedQuantity:100,unit:'m',weight:1},...overrides};}
function state(elements=[work()]){return {documents:[{id:'p1',name:'Plomberie <RDC>',pages:1}],currentDoc:'p1',currentPage:1,elements,calibrations:{'p1:1':.02},billed:{},history:[]};}
function blocker(overrides:any={}){return {id:'b1',point:{x:300,y:100},description:'Attente réservations béton',photoRefs:['btmedia://a'],companyId:'c1',responsibleId:'u1',openedAt:'2026-11-14T10:00:00Z',dueDate:'2026-11-15',status:'open',blocksProgress:true,priority:'high',...overrides};}

describe('MEP exports',()=>{
  it.each([true,false])('labels history completeness honestly in the actual workbook (truncated=%s)',async(historyTruncated)=>{
    const {api,sent}=exportsApi(),s=state(),snapshot={plans:[{id:'p1',document:s}],history:[],historyTruncated};
    await api.exportMepWorkbook(s,snapshot,{});const book=XLSX.read(sent[0].payload.base64,{type:'base64'});
    const method=XLSX.utils.sheet_to_json<any[]>(book.Sheets['Méthode MEP'],{header:1}),history=XLSX.utils.sheet_to_json<any[]>(book.Sheets['Historique MEP'],{header:1});
    expect(method.find(row=>row[0]==='Limite atteinte')?.[1]).toBe(historyTruncated?'Oui — historique partiel':'Non');
    expect(String(history[0][0]).includes('HISTORIQUE PARTIEL')).toBe(historyTruncated);expect(book.Sheets['Réseaux MEP'].O2.v).toBe(30);
  });
  it('uses pending local update dates for every export scope without changing remote plans',()=>{
    const {api}=exportsApi(),s:any=state();s.history=[{planId:'p1',time:'2026-11-17T12:00:00Z',pending:true}];
    const snapshot={plans:[{id:'p1',updatedAt:'2026-11-16T10:00:00Z',document:s},{id:'p2',updatedAt:'2026-11-16T10:00:00Z',document:{...s,elements:[work({id:'w2',docId:'p2'})]}}]};
    expect(api.mepExportRows(s,snapshot,{dateFrom:'2026-11-17'}).works.map((r:any)=>r.el.id)).toEqual(['w1']);
    expect(api.mepExportRows(s,snapshot,{dateTo:'2026-11-16'}).works.map((r:any)=>r.el.id)).toEqual(['w2']);
    expect(snapshot.plans[0].updatedAt).toBe('2026-11-16T10:00:00Z');
  });
  it('exports 30m executed out of 100m without using the financial price',()=>{
    const {api}=exportsApi();const result=api.mepExportRows(state(),null,{});
    expect(result.works[0]).toMatchObject({planned:100,executed:30,percent:.3,validated:0,unit:'m'});
    expect(result.scope).toContain('PDF courant');
  });
  it('overlays only the current locally changed PDF on the complete project snapshot',()=>{
    const {api}=exportsApi();const remote={plans:[{id:'p1',name:'old',building:'Bâtiment A',document:{...state(),elements:[work({progressPercent:10})]}},{id:'p2',name:'CVC',building:'Bâtiment B',document:{elements:[work({id:'w2',docId:'p2'})],calibrations:{}}}],generatedAt:'2026-11-16T09:00:00Z'};
    const result=api.mepExportRows(state(),remote,{});
    expect(result.works.map((row:any)=>row.executed)).toEqual([30,30]);
    expect(remote.plans[0].document.elements[0].progressPercent).toBe(10);
    expect(result.scope).toContain('Chantier');
    expect(api.mepExportRows(state(),remote,{building:'Bâtiment B'}).works.map((row:any)=>row.plan.id)).toEqual(['p2']);
  });
  it('preserves closed blockers while the open filter excludes them and exports exact plan coordinates',()=>{
    const {api}=exportsApi();const s=state([work({blockers:[blocker(),blocker({id:'b2',status:'closed',blocksProgress:false})]})]);
    expect(api.mepExportRows(s,null,{}).blockers).toHaveLength(2);
    expect(api.mepExportRows(s,null,{openOnly:true}).blockers).toHaveLength(1);
    expect(api.mepExportRows(s,null,{status:'blocked'}).works).toHaveLength(1);
    const book=XLSX.utils.book_new();api.appendMepSheets(book,XLSX,s);
    const rows=XLSX.utils.sheet_to_json<any[]>(book.Sheets['Points bloquants'],{header:1});
    expect(rows[1].slice(-2)).toEqual([300,100]);
    expect(rows[2][14]).toBe('Vérifié / clos');
  });
  it('creates a physical workbook with independent quantities, percentages and method sheets',async()=>{
    const {api,sent}=exportsApi();await api.exportMepWorkbook(state(),null,{});
    expect(sent[0].type).toBe('download');expect(sent[0].payload.format).toBe('xlsx');
    const book=XLSX.read(sent[0].payload.base64,{type:'base64'});
    expect(book.SheetNames).toEqual(['Réseaux MEP','Points bloquants','Synthèse physique MEP','Historique MEP','Méthode MEP']);
    const sheet=book.Sheets['Réseaux MEP'];expect(sheet.N2.v).toBe(100);expect(sheet.O2.v).toBe(30);expect(sheet.Q2.v).toBe(.3);expect(sheet.Q2.z||sheet.Q2.w).toBeTruthy();
    expect(book.Sheets['Synthèse physique MEP'].M2.v).toBe(.3);
  });
  it('exports each work responsible and exact activity time without borrowing the plan update date',async()=>{
    const {api,sent}=exportsApi();const first=work({mep:{...work().mep,responsibleId:'u1'}}),second=work({id:'w2',reference:'EAU-002',name:'Retour eau'});
    const s=state([first,second]);
    const snapshot={plans:[{id:'p1',updatedAt:'2026-11-16T23:59:00.000Z',elementActivity:{w1:{time:'2026-11-15T10:12:13.000Z',author:'Chef A'},w2:{time:'2026-11-16T08:09:10.000Z',author:'Chef B'}},document:s}],history:[]};
    await api.exportMepWorkbook(s,snapshot,{});
    const book=XLSX.read(sent[0].payload.base64,{type:'base64'}),sheet=book.Sheets['Réseaux MEP'];
    expect(sheet.AA2.v).toBe('Responsable test');expect(sheet.AA3.v).toBe('Entreprise <A>');
    expect(sheet.AB2.v).toBe('2026-11-15T10:12:13.000Z');expect(sheet.AB3.v).toBe('2026-11-16T08:09:10.000Z');
    expect(sheet.AC2.v).toBe('Chef A');expect(sheet.AC3.v).toBe('Chef B');
    expect(sheet.AD2.v).toBe('Synchronisée');expect(sheet.U2.v).toBe('En cours');
    expect(sheet.N2.v).toBe(100);expect(sheet.O2.v).toBe(30);expect(sheet.Q2.v).toBe(.3);
    expect(sheet['!autofilter']?.ref).toBe('A1:AE3');expect(sheet.AE2.v).toContain('Chantier');
    const rows=api.mepExportRows(s,snapshot,{}),pdf=api.buildMepReportHtml(rows);
    expect(pdf).toContain('Responsable test');expect(pdf).toContain('2026-11-15T10:12:13.000Z');expect(pdf).toContain('2026-11-16T08:09:10.000Z');
    expect(pdf).not.toContain('2026-11-16T23:59:00.000Z');
    await api.exportMepCsv(s,snapshot,{});
    const csv=Buffer.from(sent[1].payload.base64,'base64').toString('utf8');
    expect(csv).toContain('"Responsable du tronçon"');expect(csv).toContain('"Dernière mise à jour du tronçon UTC"');
    expect(csv).toContain('Responsable test');expect(csv).toContain('2026-11-15T10:12:13.000Z');
  });
  it('shows unknown and pending local work activity explicitly while excluding unrelated updates',()=>{
    const {api}=exportsApi(),s:any=state([work(),work({id:'w2'})]);
    s.history=[{time:'2026-11-16T10:11:12.000Z',authorName:'Auteur local',pending:true,planId:'p1',changes:[{target:'elements',key:'w1',before:{progressPercent:10},after:{progressPercent:30}}]},
      {time:'2026-11-16T22:00:00.000Z',authorName:'Autre auteur',planId:'p1',changes:[{target:'elements',key:'w3',before:{note:''},after:{note:'Sans lien'}}]}];
    const data=api.mepExportRows(s,{plans:[{id:'p1',updatedAt:'2026-11-16T23:00:00.000Z',document:s}],history:[]});
    expect(data.works[0]).toMatchObject({updatedAt:'2026-11-16T10:11:12.000Z',updatedBy:'Auteur local',updatePending:true});
    expect(data.works[1].updatedAt).toBeNull();
    const html=api.buildMepReportHtml(data);expect(html).toContain('modification locale en attente');expect(html).toContain('non renseignée');
    expect(html).not.toContain('2026-11-16T22:00:00.000Z');expect(html).not.toContain('2026-11-16T23:00:00.000Z');
  });
  it('exports only active blockers and their works without reintroducing closed markers, photos or totals',async()=>{
    const {api,sent}=exportsApi();
    const open=blocker({id:'open',description:'ACTION-ACTIVE',photoRefs:['btmedia://open']}),resolved=blocker({id:'resolved',status:'resolved',description:'ACTION-RESOLVED',photoRefs:['btmedia://resolved']}),closed=blocker({id:'closed',status:'closed',description:'ACTION-CLOSED',photoRefs:['btmedia://closed']});
    const s=state([work({blockers:[open,resolved,closed]}),work({id:'closed-work',name:'OUVRAGE-FERME',mep:{...work().mep,plannedQuantity:900},blockers:[closed]})]);
    const data=api.mepExportRows(s,null,{openOnly:true});expect(data.works).toHaveLength(1);expect(data.blockers.map((r:any)=>r.blocker.id)).toEqual(['open']);expect(data.scope).toContain('points ouverts uniquement');
    await api.exportMepWorkbook(s,null,{openOnly:true});
    const book=XLSX.read(sent[0].payload.base64,{type:'base64'}),works=XLSX.utils.sheet_to_json<any>(book.Sheets['Réseaux MEP']),blockers=XLSX.utils.sheet_to_json<any>(book.Sheets['Points bloquants']);
    expect(works).toHaveLength(1);expect(blockers).toHaveLength(1);expect(blockers[0]['Description']).toBe('ACTION-ACTIVE');
    expect(book.Sheets['Synthèse physique MEP'].J2.v).toBe(100);expect(book.Sheets['Méthode MEP']).toBeTruthy();
    const png='data:image/png;base64,iVBORw0KGgo=';
    const html=api.buildMepReportHtml(data,{filters:{openOnly:true},pages:[{...data.plans[0],page:1,height:680,image:png,elements:data.works.map((r:any)=>r.el),blockers:data.blockers}],photos:{'btmedia://open':png}});
    expect(html).toContain('ACTION-ACTIVE');expect(html).toContain('Points ouverts uniquement');
    for(const hidden of ['ACTION-RESOLVED','ACTION-CLOSED','OUVRAGE-FERME','Photo 2 du point','>900<'])expect(html).not.toContain(hidden);
    expect((html.match(/alt="Photo /g)||[]).length).toBe(1);
    await api.exportMepCsv(s,null,{openOnly:true});
    const csv=Buffer.from(sent[1].payload.base64,'base64').toString('utf8');expect(csv).not.toContain('OUVRAGE-FERME');expect(csv).not.toContain('900');expect(csv).toContain('points ouverts uniquement');
    expect(csv.split('\r\n')).toHaveLength(2);
  });
  it('keeps resolved and verified points in unfiltered exports while excluding both from open-only exports',()=>{
    const {api}=exportsApi(),s=state([work({blockers:[blocker({id:'r',status:'resolved'}),blocker({id:'c',status:'closed'})]})]);
    expect(api.mepExportRows(s).blockers).toHaveLength(2);expect(api.mepExportRows(s,null,{openOnly:true}).works).toHaveLength(0);expect(api.mepExportRows(s,null,{openOnly:true}).blockers).toHaveLength(0);
  });
  it('keeps the audit of the selected open work, without importing the unrelated closed work history',async()=>{
    const {api,sent}=exportsApi(),s=state([work({blockers:[blocker()]}),work({id:'w2',name:'OUVRAGE-CLOS',blockers:[blocker({status:'closed'})]})]);
    const snapshot={plans:[{id:'p1',document:s}],history:[
      {id:'op-selected',planId:'p1',time:'2026-11-16T08:00:00Z',changes:[{target:'elements',key:'w1',before:{blockers:[blocker({status:'closed'})]},after:{blockers:[blocker()]}}]},
      {id:'op-other',planId:'p1',time:'2026-11-16T08:10:00Z',changes:[{target:'elements',key:'w2',before:{name:'Ancien'},after:{name:'OUVRAGE-CLOS'}}]},
    ]};
    await api.exportMepWorkbook(s,snapshot,{openOnly:true});
    const book=XLSX.read(sent[0].payload.base64,{type:'base64'}),history=XLSX.utils.sheet_to_json<any[]>(book.Sheets['Historique MEP'],{header:1});
    expect(history).toHaveLength(2);expect(history[1][5]).toBe('op-selected');
    expect(history[1][7]).toContain('"status":"closed"');expect(history[1][7]).not.toContain('OUVRAGE-CLOS');
    const current=XLSX.utils.sheet_to_json<any>(book.Sheets['Points bloquants']);expect(current).toHaveLength(1);expect(current[0]['Statut']).toBe('Ouvert');
  });
  it('keeps estimates explicit and refuses to manufacture a measured zero when scale is absent',()=>{
    const {api}=exportsApi();const s=state([work({mep:{...work().mep,quantityMode:'drawing'}})]);s.calibrations={} as any;
    expect(api.mepExportRows(s).works[0]).toMatchObject({planned:null,executed:null,method:'Mesure du tracé / échelle de la page'});
    expect(api.mepExportRows(state([work({mep:{...work().mep,quantityMode:'estimate'}})])).works[0].method).toBe('Estimation manuelle');
  });
  it('deduplicates server history and preserves large before/after payloads across Excel-safe cells',()=>{
    const {api}=exportsApi();const changes=[{before:'x'.repeat(70000),after:'checked'}],event={id:'op1',time:'2026-11-16T10:00:00Z',author:'Chef de chantier',changes};
    const rows=api.mepHistoryRows({history:[event]},{history:[event]});
    expect(rows).toHaveLength(3);expect(rows[0][2]).toBe('Chef de chantier');expect(rows.map((row:any)=>row[7]).join('')).toBe(JSON.stringify(changes));
    expect(rows.every((row:any)=>row[7].length<=30000)).toBe(true);
  });
  it('does not export hidden data after an access denial or a truncated project result',async()=>{
    const denied=exportsApi(false);await expect(denied.api.exportMepWorkbook(state())).rejects.toThrow('non autorisé');expect(denied.sent).toEqual([]);
    const {api,sent}=exportsApi();await expect(api.exportMepCsv(state(),{truncated:true})).rejects.toThrow('capacité');expect(sent).toEqual([]);
  });
  it('neutralises CSV formulas, preserves French accents and quotes semicolons and newlines',async()=>{
    const {api,sent}=exportsApi();expect(api.csvCell(' =HYPERLINK("bad")')).toBe('"\' =HYPERLINK(""bad"")"');
    await api.exportMepCsv(state([work({name:'=2+2;Étage\n2'})]));
    const csv=Buffer.from(sent[0].payload.base64,'base64').toString('utf8');
    expect(csv.startsWith('\uFEFF')).toBe(true);expect(csv).toContain('"\'=2+2;Étage\n2"');
  });
  it('draws only the executed portion in colour and keeps the remainder and blocker marker visible',()=>{
    const {api}=exportsApi();const el=work({blockers:[blocker()]});
    const svg=api.mepAnnotationSvg([el],[{blocker:blocker(),number:1}],680);
    expect(svg).toContain('data-executed="true" points="100,100 250,100"');
    expect(svg).toContain('stroke-dasharray="7 5"');expect(svg).toContain('cx="300" cy="100"');expect(svg).toContain('#bd2436');
  });
  it('exports the actual middle portion rather than painting the first 30 percent of a network',()=>{
    const {api}=exportsApi();const el=work({points:[{x:0,y:0},{x:1000,y:0}],executedRanges:[[.4,.7]],progressPercent:30});
    const svg=api.mepAnnotationSvg([el],[],680);
    expect(svg).toContain('data-executed="true" points="400,0 700,0"');
    expect(svg).toContain('data-executed="false" points="0,0 400,0"');
    expect(svg).toContain('data-executed="false" points="700,0 1000,0"');
    expect(svg).not.toContain('data-executed="true" points="0,0 300,0"');
    const book=XLSX.utils.book_new();api.appendMepSheets(book,XLSX,state([el]));
    expect(book.Sheets['Réseaux MEP'].Z2.v).toBe('[[0.4,0.7]]');expect(book.Sheets['Réseaux MEP'].O2.v).toBe(30);
  });
  it('escapes hostile text and keeps the printed report self-contained with long-content pagination rules',()=>{
    const {api}=exportsApi();const s=state([work({name:'<script>alert(1)</script>',note:'Longue note '.repeat(250),blockers:[blocker({description:'<img src=x onerror=alert(1)>'})]})]);const data=api.mepExportRows(s);
    const png='data:image/png;base64,iVBORw0KGgo=';
    const html=api.buildMepReportHtml(data,{pages:[{...data.plans[0],page:1,height:680,image:png,elements:s.elements,blockers:data.blockers}],photos:{'btmedia://a':png}});
    expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('print-color-adjust:exact');expect(html).toContain('page-break-inside:avoid');expect(html).toContain('class="work long"');
    expect(html).not.toContain('src="https:');expect(html).toContain('Les feuilles de plan annotées');
    expect(()=>api.buildMepReportHtml(data,{photos:{'btmedia://a':'https://example.test/leak'}})).toThrow('Image');
  });
});
