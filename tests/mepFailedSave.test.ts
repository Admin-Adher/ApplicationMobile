import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {mepTransitionProblem} from '../lib/plan-progress/editor/mep-transition';
import {describe,expect,it} from 'vitest';

// Use the actual editor save/rollback functions, not a parallel implementation.
function editor(){
  const source=ts.createSourceFile('app.js',readFileSync('lib/plan-progress/editor/app.js','utf8'),ts.ScriptTarget.ES2020,true);
  const names=new Set(['persist','record','flushPendingNote']);
  const functions=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name!.text)).map(node=>node.getText(source)).join('\n');
  const audit:any={};runInNewContext(ts.transpileModule(readFileSync('lib/plan-progress/editor/mep-audit.js','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:audit,Date});
  const writes:{payload:any;resolve:(value:unknown)=>void;reject:(error:Error)=>void}[]=[];
  const notices:string[]=[],attributes=new Set<string>(),inputs:Record<string,any>={savedState:{},storageNotice:{}};
  const api:any={};
  runInNewContext(`
    let state={currentDoc:'plan-1',currentPage:1,elements:[{id:'work-1',docId:'plan-1',name:'Gaine',reference:'CVC-001',note:'Note confirmée',status:'progress'}],calibrations:{},billed:{},undo:[],
      history:[{id:'server-event-1',time:'2026-11-16T10:00:00Z',author:'Auteur serveur',title:'Modification confirmée',changes:[{target:'elements',key:'work-1',before:{note:''},after:{note:'Note confirmée'}}]}],
      elementActivity:{'work-1':{time:'2026-11-16T10:00:00Z',author:'Auteur serveur',pending:false}}};
    let durableDocument=JSON.stringify({elements:state.elements,calibrations:state.calibrations,billed:state.billed});
    let durableHistory=JSON.stringify(state.history),durableActivity=JSON.stringify(state.elementActivity);
    let selected=new Set(['work-1']),saving=false,noteSave=null,unconfirmed=false,pendingNote=null,adjustingId=null,mode='select';
    const geometry={active:false};const sameDocument=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    ${functions}
    Object.assign(api,{
      editNote:value=>record('Note modifiée','Tronçon CVC-001',()=>state.elements[0].note=value,'file'),
      snapshot:()=>JSON.parse(JSON.stringify({state,saving,unconfirmed,durableHistory:JSON.parse(durableHistory),durableActivity:JSON.parse(durableActivity)})),
      activity:()=>audit.workActivity(state,{id:'plan-1'},state.elements[0]),
    });
  `,{
    api,audit,mepTransitionProblem,crypto:{randomUUID},
    boot:{userId:'local-user',people:[{id:'local-user',name:'Auteur local'}]},
    $:(id:string)=>inputs[id],document:{body:{setAttribute:(name:string)=>attributes.add(name),removeAttribute:(name:string)=>attributes.delete(name)}},
    request:(_type:string,payload:unknown)=>new Promise((resolve,reject)=>writes.push({payload:JSON.parse(JSON.stringify(payload)),resolve,reject})),
    render:()=>{},toast:()=>{},storageWarning:(message:string)=>notices.push(message),
  });
  const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  return {api,writes,notices,attributes,settle};
}

describe('editor audit after a failed durable save',()=>{
  it('rolls back the rejected edit and its invented pending history and activity on a definite local failure',async()=>{
    const e=editor(),initial=e.api.snapshot();e.api.editNote('Saisie refusée');
    expect(e.writes).toHaveLength(1);expect(e.api.snapshot().state.history).toHaveLength(2);
    expect(e.writes[0].payload.elements[0].note).toBe('Saisie refusée');
    e.writes[0].reject(Error('Stockage plein avant écriture'));await e.settle();
    const after=e.api.snapshot();
    expect(after.state.elements).toEqual(initial.state.elements);
    expect(after.state.history).toEqual(initial.state.history);expect(after.state.elementActivity).toEqual(initial.state.elementActivity);
    expect(e.api.activity()).toMatchObject({updatedAt:'2026-11-16T10:00:00Z',authorName:'Auteur serveur',pending:false});
    expect(after.saving).toBe(false);expect(after.unconfirmed).toBe(false);expect(e.attributes.has('data-progress-saving')).toBe(false);
    expect(e.notices.some(message=>message.includes('La modification n’a pas été conservée'))).toBe(true);
  });
  it('preserves the edit and local audit when the host cannot confirm whether the queue write succeeded',async()=>{
    const e=editor();e.api.editNote('Intention à contrôler');const pending=e.api.snapshot().state.history.at(-1);
    e.writes[0].reject(Object.assign(Error('Résultat local non confirmé'),{code:'LOCAL_SAVE_UNCONFIRMED'}));await e.settle();
    const after=e.api.snapshot();
    expect(after.state.elements[0].note).toBe('Intention à contrôler');expect(after.state.history.at(-1)).toEqual(pending);
    expect(after.state.history.at(-1)).toMatchObject({author:'Auteur local',pending:true,changes:[{target:'elements',key:'work-1'}]});
    expect(e.api.activity()).toMatchObject({updatedAt:pending.time,authorName:'Auteur local',pending:true});
    expect(after.unconfirmed).toBe(true);expect(e.attributes.has('data-progress-uncertain')).toBe(true);
    expect(after.saving).toBe(false);expect(e.notices).toContain('Résultat local non confirmé');
  });
  it('uses the acknowledged audit as the next rollback checkpoint rather than reverting past a successful edit',async()=>{
    const e=editor();e.api.editNote('Première note enregistrée');
    const acknowledgedHistory=[{id:'ack-1',time:'2026-11-16T11:00:00Z',author:'Auteur confirmé',title:'Note enregistrée',pending:false,changes:[{target:'elements',key:'work-1',before:{note:'Note confirmée'},after:{note:'Première note enregistrée'}}]}];
    const acknowledgedActivity={'work-1':{time:'2026-11-16T11:00:00Z',author:'Auteur confirmé',pending:false}};
    e.writes[0].resolve(structuredClone({text:'Enregistré',history:acknowledgedHistory,elementActivity:acknowledgedActivity}));await e.settle();
    const success=e.api.snapshot();expect(success.state.history).toEqual(acknowledgedHistory);expect(success.state.elementActivity).toEqual(acknowledgedActivity);
    expect(success.durableHistory).toEqual(acknowledgedHistory);expect(success.durableActivity).toEqual(acknowledgedActivity);
    e.api.editNote('Deuxième note refusée');e.writes[1].reject(Error('Stockage plein'));await e.settle();
    const after=e.api.snapshot();expect(after.state.elements[0].note).toBe('Première note enregistrée');
    expect(after.state.history).toEqual(acknowledgedHistory);expect(after.state.elementActivity).toEqual(acknowledgedActivity);
    expect(e.api.activity()).toMatchObject({updatedAt:'2026-11-16T11:00:00Z',authorName:'Auteur confirmé',pending:false});
  });
});
