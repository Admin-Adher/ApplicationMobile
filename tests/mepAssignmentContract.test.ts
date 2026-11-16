import { describe,expect,it } from 'vitest';
import {emptyProgress,progressGroups,readProgress,validateMepTransition,type ProgressDocument} from '../lib/plan-progress/core';

const person='71000000-0000-4000-8000-000000000002';
const element=():Record<string,unknown>=>({id:'work',docId:'plan',page:1,lotId:'["company",null]',kind:'point',name:'Équipement EF',status:'todo',points:[{x:10,y:20}],
  mep:{discipline:'plumbing',network:'EF',subnetwork:'',zone:'105R',quantityMode:'drawing',plannedQuantity:null,unit:'u',weight:1}});
const document=(el:Record<string,unknown>):ProgressDocument=>({...emptyProgress(),elements:[el]});
const blocker=()=>({id:'82000000-0000-4000-8000-000000000001',point:{x:10,y:20},description:'Accès à libérer',photoRefs:['btlocal://81000000-0000-4000-8000-000000000001'],companyId:'company',responsibleId:null,dueDate:null,openedAt:'2026-11-16T18:00:00Z',status:'assigned',blocksProgress:true,priority:'normal'});
describe('MEP responsible person and real lot transition',()=>{
  it.each([undefined,null,person])('accepts the optional responsible person shape %s',responsibleId=>{
    const el=element();if(responsibleId!==undefined)(el.mep as any).responsibleId=responsibleId;
    expect(readProgress(document(el)).elements[0]).toEqual(el);
  });
  it.each(['',42,'member-id','other@example.test'])('refuses an invalid responsible identity %s',responsibleId=>{
    const el=element();(el.mep as any).responsibleId=responsibleId;expect(()=>readProgress(document(el))).toThrow();
  });
  it('requires an explicit lot when a new MEP work is enqueued',()=>{
    const el=element();expect(()=>validateMepTransition(emptyProgress(),document(el))).toThrow(/véritable lot/);
    el.lotId='["company","lot-plomberie"]';expect(()=>validateMepTransition(emptyProgress(),document(el))).not.toThrow();
  });
  it('requires the lot when classifying existing generic unclassified work',()=>{
    const before=element();delete before.mep;const after={...before,mep:element().mep};
    expect(()=>validateMepTransition(document(before),document(after))).toThrow(/véritable lot/);
  });
  it('keeps reading and updating old generic MEP work without a new marker',()=>{
    const before=element();before.blockers=[blocker()];const after=structuredClone(before);after.status='progress';after.progressPercent=35;(after.blockers as any[])[0].status='in_progress';
    expect(()=>readProgress(document(before))).not.toThrow();expect(()=>validateMepTransition(document(before),document(after))).not.toThrow();
  });
  it('requires the lot only when another marker is added to a legacy MEP work',()=>{
    const before=element();before.blockers=[blocker()];const after=structuredClone(before);(after.blockers as any[]).push({...blocker(),id:'82000000-0000-4000-8000-000000000002'});
    expect(()=>validateMepTransition(document(before),document(after))).toThrow(/véritable lot/);
    after.lotId='["company","lot-plomberie"]';expect(()=>validateMepTransition(document(before),document(after))).not.toThrow();
  });
  it('retains generic-company assignment for work outside the MEP module',()=>{
    const el=element();delete el.mep;expect(()=>validateMepTransition(emptyProgress(),document(el))).not.toThrow();
  });
  it('offers real common lots to each executing company without borrowing another company’s lot',()=>{
    const groups=progressGroups([{id:'a',name:'A'},{id:'b',name:'B'}],[{id:'shared',name:'CVC',companyId:null},{id:'owned-a',name:'EF',companyId:'a'}]);
    expect(groups.map(group=>JSON.parse(group.id))).toEqual([['a','shared'],['a','owned-a'],['b','shared']]);
    expect(groups.every(group=>JSON.parse(group.id)[1]!==null)).toBe(true);
  });
  it('excludes common and owned lots of another chantier when the active chantier is provided',()=>{
    const groups=progressGroups([{id:'a',name:'A'}],[{id:'current',name:'CVC',chantierId:'active'},{id:'org',name:'Plomberie'},{id:'other-common',name:'Autre CVC',chantierId:'other'},{id:'other-owned',name:'Autre EF',companyId:'a',chantierId:'other'}],'active');
    expect(groups.map(group=>JSON.parse(group.id))).toEqual([['a','current'],['a','org']]);
  });
});
