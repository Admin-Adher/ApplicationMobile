import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function bridge(native: boolean) {
  const listeners = new Map<string,(event: unknown) => void>();
  const sent: any[] = [];
  const dispatched: string[] = [];
  const parent = { postMessage: (value: unknown) => sent.push(value) };
  const window = {
    BT_BOOT: { nonce:'private-channel',document:{},plan:{id:'p'},permissions:{edit:false,editOwn:true},companyId:'company-a' },
    parent, ReactNativeWebView:native?{postMessage:(value: string) => sent.push(JSON.parse(value))}:undefined,
    addEventListener:(name: string, fn: (value: unknown) => void) => listeners.set('window:'+name,fn),
    dispatchEvent:(event: {type: string}) => dispatched.push(event.type),
  };
  const document = { addEventListener:(name: string,fn: (value: unknown) => void) => listeners.set('document:'+name,fn) };
  const exports: any = {};
  const source = ts.transpileModule(readFileSync('lib/plan-progress/editor/bridge.js','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  runInNewContext(source,{window,document,exports,crypto:{randomUUID},setTimeout,clearTimeout,Event:class{type: string;constructor(type: string){this.type=type;}}});
  return {api:exports,sent,parent,dispatched,receive:(surface: string,data: unknown,source?: unknown) => listeners.get(surface+':message')!({data,source})};
}
describe('shared PDF progress transport',() => {
  it('accepts close requests only from the owning host so notes can be flushed before exit',() => {
    const b=bridge(false);const message={channel:'bt-plan-progress',nonce:'private-channel',type:'closeEditor'};
    b.receive('window',message,{});expect(b.dispatched).toEqual([]);
    b.receive('window',message,b.parent);expect(b.dispatched).toEqual(['bt-progress-close']);
  });
  it('uses the Android WebView bridge and accepts its document message acknowledgement',async () => {
    const b=bridge(true);const pending=b.api.request('save',{elements:[]});
    expect(b.sent[0]).toMatchObject({type:'save',channel:'bt-plan-progress',nonce:'private-channel',payload:{elements:[]}});
    b.receive('document',JSON.stringify({...b.sent[0],payload:{text:'Durable'}}));
    await expect(pending).resolves.toEqual({text:'Durable'});
  });
  it('accepts only the owning parent and matching nonce on the web',async () => {
    const b=bridge(false);const pending=b.api.request('save',{});let settled=false;void pending.then(()=>{settled=true;});
    const message={...b.sent[0],payload:{text:'Saved'}};
    b.receive('window',message,{});b.receive('window',{...message,nonce:'other-channel'},b.parent);
    await Promise.resolve();expect(settled).toBe(false);
    b.receive('window',message,b.parent);await expect(pending).resolves.toEqual({text:'Saved'});
  });
  it('reports a storage rejection instead of manufacturing a successful save',async () => {
    const b=bridge(true);const pending=b.api.request('save',{});
    b.receive('window',{...b.sent[0],error:'Disque plein'});
    await expect(pending).rejects.toThrow('Disque plein');
  });
  it('marks an ambiguous native storage result so the editor can require recovery',async () => {
    const b=bridge(true);const pending=b.api.request('save',{});
    b.receive('window',{...b.sent[0],error:'Enregistrement à vérifier',uncertain:true});
    await expect(pending).rejects.toMatchObject({code:'LOCAL_SAVE_UNCONFIRMED'});
  });
  it('restricts subcontractor status controls to their own unvalidated works',() => {
    const {api}=bridge(true);
    expect(api.canChangeStatus([{lotId:'["company-a",null]',status:'todo'}],'installed')).toBe(true);
    expect(api.canChangeStatus([{lotId:'["company-b",null]',status:'todo'}],'installed')).toBe(false);
    expect(api.canChangeStatus([{lotId:'["company-a",null]',status:'todo'}],'checked')).toBe(false);
    expect(api.canChangeStatus([{lotId:'["company-a",null]',status:'checked'}],'progress')).toBe(false);
  });
  it('does not offer undoing a creation to an editor without deletion rights',() => {
    const {api}=bridge(true);api.boot.permissions.edit=true;api.boot.permissions.delete=false;
    const state={elements:[{id:'new'}],undo:[{snapshot:JSON.stringify({elements:[]})}]};
    expect(api.canUndo(state)).toBe(false);
    state.undo[0].snapshot=JSON.stringify({elements:[{id:'new',status:'todo'}]});
    expect(api.canUndo(state)).toBe(true);
    api.boot.permissions.delete=true;state.undo[0].snapshot=JSON.stringify({elements:[]});
    expect(api.canUndo(state)).toBe(true);
  });
});
