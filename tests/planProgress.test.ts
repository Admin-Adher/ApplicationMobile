import { describe, expect, it, vi } from 'vitest';
import { canTrackPdfPlan, editorHtml, emptyProgress, overlayProgress, progressDiff, progressGroups, progressScope, type ProgressDocument, type ProgressOperation } from '../lib/plan-progress/core';
import { ProgressSession, type ProgressSessionPorts } from '../lib/plan-progress/session';
import { progressReplayBarrier } from '../lib/plan-progress/replay-order';

const element = { id: 'work-1', docId: 'plan-1', page: 1, lotId: '["company-1",null]', kind: 'line', name: 'Gaine', price: 12, status: 'todo', points: [{ x: 10,y:10 },{ x:110,y:10 }] };
const document = (): ProgressDocument => ({ elements:[{...element}],calibrations:{'plan-1:1':0.05},billed:{} });
function ports(overrides: Partial<ProgressSessionPorts> = {}) {
  return { planId:'plan-1',sourceRef:'btmedia:pdf-v1',cacheRead:vi.fn(async () => null),cacheWrite:vi.fn(async () => {}),
    read:vi.fn(async () => document()),pending:vi.fn(async (): Promise<ProgressOperation[]> => []),enqueue:vi.fn(async () => {}),
    newId:() => 'operation-1',owned:() => true,...overrides };
}
describe('PDF progress integration',() => {
  it('supports legacy PDF plans while excluding image and DXF viewers',() => {
    expect(canTrackPdfPlan({uri:'btmedia:legacy-plan'})).toBe(true);
    expect(canTrackPdfPlan({uri:'btmedia:pdf',file_type:'application/pdf'})).toBe(true);
    expect(canTrackPdfPlan({uri:'btmedia:image',fileType:'image'})).toBe(false);
    expect(canTrackPdfPlan({uri:'https://example.test/plan.jpg?signature=test'})).toBe(false);
    expect(canTrackPdfPlan({uri:'btmedia:dxf',file_type:'dxf'})).toBe(false);
  });
  it('merges independent fields without replacing geometry or another user’s change',() => {
    const previous = document();
    const next = document();next.elements[0].status = 'installed';
    const changes = progressDiff(previous,next);
    expect(changes).toEqual([{target:'elements',key:'work-1',before:{status:'todo'},after:{status:'installed'}}]);
    const remote = document();remote.elements[0].name = 'Gaine renommée';
    expect(overlayProgress(remote,changes).elements[0]).toMatchObject({name:'Gaine renommée',status:'installed',price:12,points:element.points});
  });
  it('waits for an earlier failed edit without blocking another PDF or another domain',() => {
    const a={rpc:{fn:'apply_plan_progress',args:{p_plan_id:'p1',p_source_ref:'v1'}}};
    const later={kind:'plan_progress',payload:{planId:'p1',sourceRef:'v1'}};
    const barrier=progressReplayBarrier(1000);barrier.block(a);
    expect(barrier.deadline(later)).toBe(new Date(31_000).toISOString());
    expect(barrier.deadline({kind:'plan_progress',payload:{planId:'p1',sourceRef:'v2'}})).toBeUndefined();
    expect(barrier.deadline({kind:'send_message',payload:{planId:'p1',sourceRef:'v1'}})).toBeUndefined();
    expect(progressReplayBarrier(2000).deadline(later)).toBeUndefined();
    expect(progressReplayBarrier(2000,[a]).deadline(later)).toBeDefined();
  });
  it('does not invent an incomplete work when a queued edit loses its creation parent',() => {
    expect(overlayProgress(emptyProgress(),[{target:'elements',key:'missing',before:{status:'todo'},after:{status:'installed'}}])).toEqual(emptyProgress());
  });
  it('represents creation, deletion, page scales and billing independently',() => {
    const created = document();created.billed['plan-1:1:["company-1",null]'] = 25;
    const changes = progressDiff(emptyProgress(),created);
    expect(changes).toHaveLength(3);
    expect(overlayProgress(emptyProgress(),changes)).toEqual(created);
    expect(overlayProgress(created,progressDiff(created,emptyProgress()))).toEqual(emptyProgress());
  });
  it('ignores JSONB object-key ordering when comparing dimensions',() => {
    const a=document(),b=document();a.elements[0].dimensions={widthM:0.2,heightM:0.4};b.elements[0].dimensions={heightM:0.4,widthM:0.2};
    expect(progressDiff(a,b)).toEqual([]);
  });
  it('refreshes rejected local state only after pending operations have been resolved',async () => {
    let queued=true;
    const p=ports({cacheRead:async () => JSON.stringify(emptyProgress()),pending:async () => queued?[{id:'op',planId:'plan-1',sourceRef:'btmedia:pdf-v1',changes:[]}]:[]});
    const session=new ProgressSession(p);await session.open();expect(await session.refresh()).toBeNull();
    queued=false;expect((await session.refresh())?.document).toEqual(document());
  });
  it('separates user, organisation, PDF and file revision caches',() => {
    const keys = [progressScope('u1','o1','p1','v1'),progressScope('u2','o1','p1','v1'),progressScope('u1','o2','p1','v1'),progressScope('u1','o1','p2','v1'),progressScope('u1','o1','p1','v2')];
    expect(new Set(keys).size).toBe(5);
  });
  it('does not use prototype companies or prices and keeps collision-free group IDs',() => {
    const groups = progressGroups([{id:'a:b',name:'A'},{id:'a',name:'B'}],[{id:'b:c',name:'Lot B',companyId:'a'}]);
    expect(groups.map(row => row.price)).toEqual([0,0]);
    expect(groups.map(row => JSON.parse(row.id))).toEqual([['a:b',null],['a','b:c']]);
  });
  it('treats document names as JSON rather than executable HTML',() => {
    expect(editorHtml('<script>/* BUILDTRACK_BOOT */</script>',{name:'</script><img onerror=alert(1)>'})).not.toContain('</script><img');
  });
  it('preserves dollar replacement sequences in PDF.js and user data',() => {
    const value = "$& $` $' $$";
    expect(editorHtml('before /* BUILDTRACK_BOOT */ after',{value})).toBe('before window.BT_BOOT='+JSON.stringify({value})+'; after');
  });
  it('waits for durable enqueue before acknowledging a save',async () => {
    let release!: () => void;
    const p = ports({enqueue:vi.fn(() => new Promise<void>(resolve => { release = resolve; }))});
    const session = new ProgressSession(p);await session.open();
    const next = document();next.elements[0].status = 'installed';
    let settled = false;const save = session.save(next).then(() => { settled=true; });
    expect(settled).toBe(false);expect(session.document.elements[0].status).toBe('todo');
    release();await save;
    expect(session.document.elements[0].status).toBe('installed');
    expect(p.enqueue).toHaveBeenCalledWith({id:'operation-1',planId:'plan-1',sourceRef:'btmedia:pdf-v1',changes:progressDiff(document(),next)});
  });
  it('keeps the last durable state when queue storage fails',async () => {
    const session = new ProgressSession(ports({enqueue:async () => { throw Error('disk full'); }}));await session.open();
    const next = document();next.elements[0].status='checked';
    await expect(session.save(next)).rejects.toThrow('disk full');
    expect(session.document).toEqual(document());
  });
  it('recovers from the queue even if the secondary cache was not written',async () => {
    const next = document();next.elements[0].status='installed';
    const pending = [{id:'op',planId:'plan-1',sourceRef:'btmedia:pdf-v1',changes:progressDiff(document(),next)}];
    const session = new ProgressSession(ports({pending:async () => pending}));
    expect(await session.open()).toEqual(next);
  });
  it('does not rewind pending work to a stale remote snapshot',async () => {
    const next = document();next.elements[0].status='installed';
    const p=ports({cacheRead:async () => JSON.stringify(next),pending:async () => [{id:'op',planId:'plan-1',sourceRef:'btmedia:pdf-v1',changes:progressDiff(document(),next)}]});
    const session=new ProgressSession(p);expect(await session.open()).toEqual(next);expect(p.read).not.toHaveBeenCalled();
  });
  it('reads other users’ changes when reopening a fully synchronised plan',async () => {
    const p=ports({cacheRead:async () => JSON.stringify(emptyProgress())});
    expect(await new ProgressSession(p).open()).toEqual(document());expect(p.read).toHaveBeenCalled();
  });
  it('keeps the cached plan when reopening offline with an empty queue',async () => {
    const p=ports({cacheRead:async () => JSON.stringify(document()),online:() => false,read:vi.fn(async () => emptyProgress())});
    expect(await new ProgressSession(p).open()).toEqual(document());expect(p.read).not.toHaveBeenCalled();
  });
  it('does not use a cached document after an explicit access denial',async () => {
    const p=ports({cacheRead:async () => JSON.stringify(document()),read:async () => { throw {code:'42501'}; }});
    await expect(new ProgressSession(p).open()).rejects.toMatchObject({code:'42501'});
  });
  it('does not report a failed save after the durable queue committed',async () => {
    const p=ports();const session=new ProgressSession(p);await session.open();vi.mocked(p.cacheWrite).mockRejectedValueOnce(Error('quota'));
    const next=document();next.elements[0].status='installed';await expect(session.save(next)).resolves.toBeUndefined();
    expect(session.document).toEqual(next);
  });
  it('refuses late callbacks after switching accounts',async () => {
    const session = new ProgressSession(ports({owned:() => false}));
    await expect(session.open()).rejects.toThrow('compte');
    await expect(session.save(document())).rejects.toThrow('session');
  });
  it('does not turn a hidden price into an update of the server price',async () => {
    const redacted=document();delete redacted.elements[0].price;
    const p=ports({read:async () => redacted});const session=new ProgressSession(p);const initial=await session.open();
    const next=structuredClone(initial);next.elements[0].status='installed';await session.save(next);
    const operation=vi.mocked(p.enqueue).mock.calls[0][0];
    expect(operation.changes[0].after).toEqual({status:'installed'});
  });
});
