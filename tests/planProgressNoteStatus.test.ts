import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Exercise the real editor's save/status functions with manually acknowledged
// host writes. In particular, the note acknowledgement must remain pending
// when the user's status activation arrives.
function editor() {
  const source = ts.createSourceFile('app.js', readFileSync('lib/plan-progress/editor/app.js', 'utf8'), ts.ScriptTarget.ES2020, true);
  const names = new Set(['persist', 'record', 'flushPendingNote', 'changeStatus', 'isNoteStatusActivation']);
  const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name!.text)).map(node => node.getText(source)).join('\n');
  const writes: { payload: any; resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  const attributes = new Set<string>();
  const notices: string[] = [];
  const inputs: Record<string, any> = { detailsDialog: { open: true }, elementNote: { value: 'Note saisie' }, savedState: {}, storageNotice: {} };
  let permitted = true;
  const api: any = {};
  runInNewContext(`
    let state={elements:[{id:'a',name:'A',reference:'A-1',status:'todo',note:''},{id:'b',name:'B',reference:'B-1',status:'todo',note:''}],calibrations:{},billed:{},undo:[],history:[]};
    let durableDocument=JSON.stringify({elements:state.elements,calibrations:state.calibrations,billed:state.billed});
    let selected=new Set(['a']),saving=false,noteSave=null,changingStatus=false,unconfirmed=false,pendingNote=null;
    const sameDocument=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    ${functions}
    Object.assign(api,{changeStatus,isNoteStatusActivation,
      startNote:()=>{pendingNote={id:'a',value:inputs.elementNote.value.trim()};flushPendingNote();},
      select:(id)=>{selected=new Set([id]);},
      snapshot:()=>JSON.parse(JSON.stringify({state,saving,unconfirmed})),
    });
  `, {
    api, inputs, crypto: { randomUUID },
    $: (id: string) => inputs[id],
    document: { body: { setAttribute: (name: string) => attributes.add(name), removeAttribute: (name: string) => attributes.delete(name) } },
    request: (_type: string, payload: unknown) => new Promise((resolve, reject) => writes.push({ payload: JSON.parse(JSON.stringify(payload)), resolve, reject })),
    canChangeStatus: () => permitted,
    render: () => {}, toast: (message: string) => notices.push(message), storageWarning: (message: string) => notices.push(message),
    doc: () => ({ name: 'PDF' }), pageLabel: () => 'Page 1', terrainLabel: (status: string) => status,
  });
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { api, writes, attributes, notices, inputs, settle, revoke: () => { permitted = false; } };
}

describe('note followed by a status activation', () => {
  it('includes the focused note and the requested status in one write when blur has not saved it yet', async () => {
    const e = editor();
    expect(await e.api.changeStatus('installed')).toBe(true);
    expect(e.writes).toHaveLength(1);
    expect(e.writes[0].payload.elements[0]).toMatchObject({ note: 'Note saisie', status: 'installed' });
    e.writes[0].resolve({ text: 'Saved' }); await e.settle();
  });
  it('waits for the note acknowledgement, then records the first status activation exactly once', async () => {
    const e = editor(); e.api.startNote();
    const action = e.api.changeStatus('checked');
    await e.settle();
    expect(e.writes).toHaveLength(1);
    expect(e.writes[0].payload.elements[0].status).toBe('todo');
    e.writes[0].resolve({ text: 'Note saved' });
    expect(await action).toBe(true);
    expect(e.writes).toHaveLength(2);
    expect(e.writes[1].payload.elements[0]).toMatchObject({ note: 'Note saisie', status: 'checked' });
    e.writes[1].resolve({ text: 'Status saved' }); await e.settle();
    expect(e.attributes.has('data-progress-saving')).toBe(false);
  });
  it('does not execute a second activation while the first is waiting', async () => {
    const e = editor(); e.api.startNote();
    const first = e.api.changeStatus('installed');
    expect(await e.api.changeStatus('checked')).toBe(false);
    e.writes[0].resolve({ text: 'Saved' }); await first;
    expect(e.writes).toHaveLength(2);
    expect(e.writes[1].payload.elements[0].status).toBe('installed');
    e.writes[1].resolve({ text: 'Saved' }); await e.settle();
  });
  it('keeps the requested work identity if the selection changes during the wait', async () => {
    const e = editor(); e.api.startNote(); const action = e.api.changeStatus('installed');
    e.api.select('b'); e.writes[0].resolve({ text: 'Saved' }); await action;
    expect(e.writes[1].payload.elements).toMatchObject([{ id: 'a', status: 'installed' }, { id: 'b', status: 'todo' }]);
    e.writes[1].resolve({ text: 'Saved' }); await e.settle();
  });
  it('rechecks permission after waiting instead of applying an obsolete authorization', async () => {
    const e = editor(); e.api.startNote(); const action = e.api.changeStatus('checked'); e.revoke();
    e.writes[0].resolve({ text: 'Saved' }); expect(await action).toBe(false);
    expect(e.writes).toHaveLength(1);
    expect(e.api.snapshot().state.elements[0].status).toBe('todo');
  });
  it.each([false, true])('does not apply the status after a failed note save (uncertain=%s)', async uncertain => {
    const e = editor(); e.api.startNote(); const action = e.api.changeStatus('installed');
    e.writes[0].reject(Object.assign(new Error('Storage failure'), uncertain ? { code: 'LOCAL_SAVE_UNCONFIRMED' } : {}));
    expect(await action).toBe(false); await e.settle();
    expect(e.writes).toHaveLength(1);
    expect(e.api.snapshot().state.elements[0].status).toBe('todo');
    expect(e.api.snapshot().unconfirmed).toBe(uncertain);
    expect(e.notices).toContain('L’état n’a pas été enregistré. Vérifiez la note avant de réessayer.');
    expect(e.attributes.has('data-progress-status-waiting')).toBe(false);
  });
  it('preserves the saved note if the following status write fails', async () => {
    const e = editor(); e.api.startNote(); const action = e.api.changeStatus('installed');
    e.writes[0].resolve({ text: 'Saved' }); await action;
    e.writes[1].reject(new Error('Status storage failure')); await e.settle();
    expect(e.api.snapshot().state.elements[0]).toMatchObject({ note: 'Note saisie', status: 'todo' });
  });
  it('admits only status click/keyboard activation during a note save and keeps other mutations locked', async () => {
    const e = editor();
    const target = { closest: () => ({ disabled: false }) };
    expect(e.api.isNoteStatusActivation({ type: 'click', target })).toBeFalsy();
    e.api.startNote();
    expect(e.api.isNoteStatusActivation({ type: 'click', target })).toBeTruthy();
    expect(e.api.isNoteStatusActivation({ type: 'keydown', key: 'Enter', target })).toBeTruthy();
    expect(e.api.isNoteStatusActivation({ type: 'keydown', key: ' ', target })).toBeTruthy();
    expect(e.api.isNoteStatusActivation({ type: 'change', target })).toBeFalsy();
    expect(e.api.isNoteStatusActivation({ type: 'click', target: { closest: () => null } })).toBeFalsy();
    expect(e.api.isNoteStatusActivation({ type: 'click', target: { closest: () => ({ disabled: true }) } })).toBeFalsy();
    e.writes[0].resolve({ text: 'Saved' }); await e.settle();
  });
});
