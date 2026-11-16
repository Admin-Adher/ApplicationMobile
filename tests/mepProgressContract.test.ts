import { describe,expect,it } from 'vitest';
import { emptyProgress,overlayProgress,progressDiff,readProgress,validateMepElement } from '../lib/plan-progress/core';

const uuid='82000000-0000-4000-8000-000000000001';
const work=(): Record<string,unknown> => ({id:'work',docId:'pdf',page:1,kind:'line',name:'EF 105R',lotId:'["company",null]',status:'progress',progressPercent:30,points:[{x:10,y:20},{x:90,y:60}],
  mep:{discipline:'plumbing',network:'EF',subnetwork:'Alimentation',zone:'105R',quantityMode:'manual',plannedQuantity:100,unit:'m',weight:1},
  blockers:[{id:uuid,point:{x:45,y:38},description:'Réservation à reprendre',photoRefs:['btlocal://81000000-0000-4000-8000-000000000001'],companyId:'company',responsibleId:null,dueDate:'2026-12-01',openedAt:'2026-11-16T10:00:00Z',status:'open',blocksProgress:true,priority:'high'}]});
describe('durable MEP wire contract',()=>{
  it('round-trips an offline blocker without losing network or evidence identity',()=>{
    const doc={...emptyProgress(),elements:[work()]};
    const queued=JSON.parse(JSON.stringify(progressDiff(emptyProgress(),doc)));
    expect(readProgress(overlayProgress(emptyProgress(),queued))).toEqual(doc);
  });
  it('accepts private ready references after the host resolves a durable local photo',()=>{
    const el=work();(el.blockers as any[])[0].photoRefs=['btmedia://81000000-0000-4000-8000-000000000001'];
    expect(()=>validateMepElement(el)).not.toThrow();
  });
  it('keeps independent geometry edits while replaying a local MEP change',()=>{
    const before={...emptyProgress(),elements:[work()]};const after=structuredClone(before);(after.elements[0].mep as any).zone='106R';
    const server=structuredClone(before);server.elements[0].points=[{x:5,y:8},{x:95,y:62}];
    const overlaid=overlayProgress(server,progressDiff(before,after));
    expect(overlaid.elements[0].points).toEqual(server.elements[0].points);expect((overlaid.elements[0].mep as any).zone).toBe('106R');
  });
  it.each([0,-1,Infinity,NaN,null])('rejects an unusable manual reference quantity %s',value=>{
    const el=work();(el.mep as any).plannedQuantity=value;expect(()=>validateMepElement(el)).toThrow();
  });
  it('does not mistake a drawn line for a volume or unit count',()=>{
    const el=work();Object.assign(el.mep as object,{quantityMode:'drawing',plannedQuantity:null,unit:'u'});expect(()=>validateMepElement(el)).toThrow();
  });
  it.each(['https://example.test/private.jpg','file:///cache/photo.jpg','btmedia://not-an-id'])('rejects unstable or untrusted photo addresses %s',ref=>{
    const el=work();(el.blockers as any[])[0].photoRefs=[ref];expect(()=>validateMepElement(el)).toThrow();
  });
  it('rejects a blocker without photo, zone, unique identity or a valid date',()=>{
    for(const mutate of [(el:any)=>el.blockers[0].photoRefs=[],(el:any)=>el.mep.zone='',(el:any)=>el.blockers.push(structuredClone(el.blockers[0])),(el:any)=>el.blockers[0].dueDate='2026-02-31']){
      const el=work();mutate(el);expect(()=>validateMepElement(el)).toThrow();
    }
  });
  it('keeps legacy work documents valid without a MEP classification',()=>{
    const el=work();delete el.mep;delete el.blockers;expect(readProgress({...emptyProgress(),elements:[el]}).elements).toHaveLength(1);
  });
  it('cannot hide retained blockers by removing the network classification',()=>{const el=work();(el.blockers as any[])[0].status='closed';el.mep=null;el.executedRanges=null;expect(()=>validateMepElement(el)).toThrow(/Conservez le réseau/);});
  it('keeps disjoint installed portions and their exact total in a durable patch',()=>{
    const el=work();el.executedRanges=[[0,.2],[.8,.9]];
    const document={...emptyProgress(),elements:[el]};
    expect(readProgress(overlayProgress(emptyProgress(),progressDiff(emptyProgress(),document)))).toEqual(document);
  });
  it.each([[[0,.4],[.3,.5]],[[.7,.8],[.1,.3]],[[0,1.1]],[[.3,.3]],[[0,.2]]].map(ranges=>({ranges})))('rejects overlapping, unordered, invalid or incoherent installed portions $ranges',({ranges})=>{
    const el=work();el.executedRanges=ranges;expect(()=>validateMepElement(el)).toThrow();
  });
  it('only allows portions on classified lines and requires complete installation before control',()=>{
    const el=work();el.executedRanges=[[0,.3]];el.status='checked';expect(()=>validateMepElement(el)).toThrow();
    el.executedRanges=[[0,1]];el.progressPercent=null;expect(()=>validateMepElement(el)).not.toThrow();
    delete el.mep;expect(()=>validateMepElement(el)).toThrow();
  });
});
