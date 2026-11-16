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
