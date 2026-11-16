import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const api:any={};
runInNewContext(ts.transpileModule(readFileSync('lib/plan-progress/editor/mep-audit.js','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,Date,Map,Set,Number,JSON});
const el={id:'work-a',docId:'plan-a',mep:{responsibleId:'person-a'}};
describe('MEP element audit, independent of plan dates',()=>{
  it('uses exact element activity rather than the plan timestamp or an unrelated edit',()=>{
    const plan={id:'plan-a',updatedAt:'2026-11-16T20:00:00Z',elementActivity:{'work-a':{time:'2026-11-15T10:00:00Z',author:'Chef A'}}};
    const state={currentDoc:'plan-a',history:[{time:'2026-11-16T12:00:00Z',changes:[{target:'elements',key:'work-b'}]}]};
    expect(api.workActivity(state,plan,el)).toMatchObject({updatedAt:'2026-11-15T10:00:00Z',authorName:'Chef A',pending:false});
    expect(api.workActivity({}, {...plan,elementActivity:{}},el).updatedAt).toBeNull();
  });
  it('rejects history from another plan or revision and keeps the actual current edit',()=>{
    const history=[{planId:'plan-b',time:'2026-11-16T13:00:00Z',changes:[{target:'elements',key:'work-a'}]},{planId:'plan-a',sourceRef:'old',time:'2026-11-16T13:00:00Z',changes:[{target:'elements',key:'work-a'}]},{planId:'plan-a',sourceRef:'current',time:'2026-11-15T13:00:00Z',author:'Chef B',changes:[{target:'elements',key:'work-a'}]}];
    expect(api.workActivity({}, {id:'plan-a',sourceRef:'current'},el,history)).toMatchObject({updatedAt:'2026-11-15T13:00:00Z',authorName:'Chef B'});
  });
  it('marks a durable local edit as pending without changing a different PDF',()=>{
    const state={currentDoc:'plan-a',elementActivity:{'work-a':{time:'2026-11-16T10:00:00Z',author:'Chef local',pending:true}}};
    expect(api.workActivity(state,{id:'plan-a'},el)).toMatchObject({updatedAt:'2026-11-16T10:00:00Z',authorName:'Chef local',pending:true});
    expect(api.workActivity(state,{id:'plan-b'},{...el,docId:'plan-b'})).toMatchObject({updatedAt:null,pending:false});
  });
  it('does not invent a date when recovering an old queue with no trustworthy timestamp',()=>{
    expect(api.workActivity({currentDoc:'plan-a',elementActivity:{'work-a':{pending:true}}},{id:'plan-a'},el)).toMatchObject({updatedAt:null,pending:true});
  });
  it('shows a person or the assigned company without leaking raw identifiers',()=>{
    expect(api.responsibleLabel(el,[{id:'person-a',name:'Sofia — plomberie'}],{company:'Entreprise A'})).toBe('Sofia — plomberie');
    expect(api.responsibleLabel({...el,mep:{}},[],{company:'Entreprise A'})).toBe('Entreprise A');
    expect(api.responsibleLabel(el,[],{company:'Entreprise A'})).toBe('Responsable indisponible');
  });
  it('normalizes current server and legacy author representations',()=>{
    expect(api.eventAuthor({author:'Sofia'})).toBe('Sofia');
    expect(api.eventAuthor({authorName:'Marc'})).toBe('Marc');
    expect(api.eventAuthor({author:{name:'Lina'}})).toBe('Lina');
    expect(api.eventAuthor({userId:'private-id'})).toBe('Auteur non renseigné');
  });
});
