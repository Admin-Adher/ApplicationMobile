import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,it,expect} from 'vitest';
const cache=new Map<string,any>();
function load(file:string):any{if(cache.has(file))return cache.get(file);const api:any={};cache.set(file,api);runInNewContext(ts.transpileModule(readFileSync('lib/plan-progress/editor/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,require:(p:string)=>load(p.replace('./','')),Date,Map,Set});return api;}
const api=load('mep-calculations.js');
const work=(id:string,planned:number,percent:number,unit='m',weight=1)=>({id,docId:'p',page:1,kind:'line',points:[{x:0,y:0},{x:500,y:0}],lotId:'["c",null]',status:'progress',progressPercent:percent,mep:{discipline:'plumbing',network:'EF',subnetwork:'',zone:'Local',quantityMode:'manual',plannedQuantity:planned,unit,weight}});
const plan=(elements:any[])=>({id:'p',building:'A',level:'RDC',updatedAt:'2026-11-16T12:00:00Z',document:{elements,calibrations:{'p:1':.02},billed:{}}});
describe('physical MEP quantities and dated history',()=>{
  it('weights 100m at30% and900m at60% by quantity, independent of money',()=>{const p=plan([work('a',100,30),{...work('b',900,60),price:100000}]);const s=api.summarizeMep([p]);expect(s.percent).toBeCloseTo(57);expect(s.byUnit.m).toMatchObject({planned:1000,executed:570});});
  it('never adds equipment to metres and explains the cross-unit weights',()=>{const s=api.summarizeMep([plan([work('a',100,30,'m',3),work('b',10,50,'u',1)])]);expect(s.percent).toBeCloseTo(35);expect(s.byUnit.m.planned).toBe(100);expect(s.byUnit.u.planned).toBe(10);expect(s.method).toContain('poids');});
  it('includes explicit estimates by their defined weight without inventing a quantity',()=>{const el=work('estimated',0,50);el.mep.quantityMode='estimate';const s=api.summarizeMep([plan([el])]);expect(s.percent).toBe(50);expect(s.estimates).toBe(1);expect(s.method).toContain('estimations');expect(s.byUnit.m.planned).toBe(0);});
  it('does not manufacture a measured quantity without calibration',()=>{const w=work('a',100,30);w.mep.quantityMode='drawing';const p=plan([w]);p.document.calibrations={} as any;const s=api.summarizeMep([p]);expect(s.percent).toBeNull();expect(s.unmeasurable).toBe(1);expect(api.plannedQuantity(w,{calibrations:{'p:1':.02}})).toBe(10);});
  it('keeps a resolved blocker visible but no longer stops progress',()=>{const el={...work('a',100,30),blockers:[{id:'b',status:'resolved',blocksProgress:true}]};expect(api.isBlocking(el)).toBe(false);expect(api.summarizeMep([plan([el])]).blockers).toHaveLength(1);expect(api.summarizeMep([plan([el])]).openBlockers).toHaveLength(0);});
  it('reconstructs the beginning of the day using PostgreSQL microsecond order',()=>{const el=work('a',100,30),snapshot={plans:[plan([el])],history:[{planId:'p',time:'2026-11-16T10:00:00.000100Z',changes:[{target:'elements',key:'a',before:{progressPercent:0},after:{progressPercent:10}}]},{planId:'p',time:'2026-11-16T10:00:00.000900Z',changes:[{target:'elements',key:'a',before:{progressPercent:10},after:{progressPercent:30}}]}]};const old=api.projectMepAt(snapshot,'2026-11-15');expect(old.plans[0].document.elements[0].progressPercent).toBe(0);expect(snapshot.plans[0].document.elements[0].progressPercent).toBe(30);});
  it('refuses misleading comparisons for incomplete or ambiguous histories',()=>{for(const flag of ['historyTruncated','truncated','localPending'])expect(()=>api.projectMepAt({plans:[],history:[],[flag]:true},'2026-11-15')).toThrow();expect(()=>api.projectMepAt({plans:[],history:[],historyOrderingReliable:false},'2026-11-15')).toThrow();});
  it('detects a change in controlled physical quantities even with no financial price or scale',()=>{const el={...work('a',100,100),status:'checked',price:0},after={...el,mep:{...el.mep,plannedQuantity:200}};expect(api.physicalMeasurementImpact(el,after,{},{})).toMatchObject({before:{quantity:100,unit:'m'},after:{quantity:200,unit:'m'}});expect(api.physicalMeasurementImpact(el,{...el,name:'Nouveau nom'},{},{})).toBeNull();});
});
describe('measured installed portions on a bent route',()=>{
  const points=[{x:0,y:0},{x:50,y:0},{x:50,y:50}];
  it('projects taps onto arc length through elbows instead of a bounding box',()=>{expect(api.projectOnPath(points,{x:53,y:20})).toMatchObject({fraction:.7,point:{x:50,y:20},distance:3});});
  it('unions repeated strokes so overlapping installations are counted once',()=>{const ranges=api.mergeRanges([[.4,.7],[.5,.8],[.8,.9]]);expect(ranges).toEqual([[.4,.9]]);expect(api.rangePercent(ranges)).toBeCloseTo(50);});
  it('removes only a selected portion and preserves the rest',()=>{expect(api.subtractRanges([[.2,.8]],[.4,.6])).toEqual([[.2,.4],[.6,.8]]);});
  it('renders a middle portion on the correct sides of an elbow',()=>{const parts=api.splitPathRanges(points,[[.4,.7]]);expect(parts.map((p:any)=>p.executed)).toEqual([false,true,false]);expect(parts[1].points).toEqual([{x:40,y:0},{x:50,y:0},{x:50,y:20}]);expect(api.rangePercent([[.4,.7]])).toBeCloseTo(30);});
});
