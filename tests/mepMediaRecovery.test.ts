import {describe,expect,it,vi} from 'vitest';
import {hasLocalMepPhotos,isLocalMepPhoto,isManagedMepPhoto,prepareMepPhotoOperation} from '../lib/plan-progress/media-refs';
import {validateMepReportHtml} from '../lib/plan-progress/print-contract';
import type {ProgressOperation} from '../lib/plan-progress/core';

const local='btlocal://11111111-1111-4111-8111-111111111111';
const other='btlocal://22222222-2222-4222-8222-222222222222';
const managed='btmedia://aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const managedOther='btmedia://bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const blocker=(refs:string[])=>({id:'blocker-1',photoRefs:refs,description:'Point bloquant'});
const operation=():ProgressOperation=>({id:'operation-1',planId:'plan-1',sourceRef:'btmedia://cccccccc-cccc-4ccc-8ccc-cccccccccccc',changes:[{target:'elements',key:'w1',before:{blockers:[blocker([local])]},after:{blockers:[blocker([local,other])]}}]});
const html=(body:string)=>'<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{font:12px Arial}p{color:#003582}</style></head><body>'+body+'</body></html>';

describe('durable MEP photo preparation',()=>{
  it('recognises only declared UUID media references, including CAS before-only references',()=>{
    expect(isLocalMepPhoto(local)).toBe(true);expect(isManagedMepPhoto(managed)).toBe(true);
    for(const ref of ['btlocal://not-an-id',local+'/../other','https://example.test/a.jpg',managed+'?token=secret']){expect(isLocalMepPhoto(ref)).toBe(false);expect(isManagedMepPhoto(ref)).toBe(false);}
    const beforeOnly=operation();beforeOnly.changes[0].after={note:'Texte sans preuve'};
    expect(hasLocalMepPhotos(beforeOnly)).toBe(true);
    beforeOnly.changes[0].before={note:local};expect(hasLocalMepPhotos(beforeOnly)).toBe(false);
  });
  it('maps identical before/after proofs once while preserving operation identity and the original offline intent',async()=>{
    const original=operation(),snapshot=structuredClone(original),resolve=vi.fn(async(ref:string)=>ref===local?managed:managedOther);
    const result=await prepareMepPhotoOperation(original,resolve);
    expect(result).toMatchObject({id:original.id,planId:original.planId,sourceRef:original.sourceRef});
    expect(result.changes[0]).toMatchObject({before:{blockers:[{photoRefs:[managed]}]},after:{blockers:[{photoRefs:[managed,managedOther]}]}});
    expect(resolve).toHaveBeenCalledTimes(2);expect(original).toEqual(snapshot);
    expect(hasLocalMepPhotos(result)).toBe(false);
  });
  it('does not rewrite arbitrary notes or calibration/billing values which happen to contain a local reference',async()=>{
    const original=operation();original.changes[0].after={blockers:[blocker([local])],note:'La preuve '+local};
    original.changes.push({target:'billed',key:'plan:1:lot',before:null,after:local});
    const result=await prepareMepPhotoOperation(original,async()=>managed);
    expect(result.changes[0].after).toMatchObject({note:'La preuve '+local});expect(result.changes[1].after).toBe(local);
  });
  it('keeps both sides intact if a second upload fails and never returns a partly prepared operation',async()=>{
    const original=operation(),snapshot=structuredClone(original);
    await expect(prepareMepPhotoOperation(original,async ref=>{if(ref===other)throw Error('Réseau coupé');return managed;})).rejects.toThrow('Réseau coupé');
    expect(original).toEqual(snapshot);expect(hasLocalMepPhotos(original)).toBe(true);
  });
  it('refuses an unregistered upload result instead of acknowledging a local path as a server proof',async()=>{
    for(const value of ['file:///photo.jpg',local,'https://example.test/photo.jpg','btmedia://invalid'])await expect(prepareMepPhotoOperation(operation(),async()=>value)).rejects.toThrow('non téléversée');
  });
  it('can replay an already prepared fingerprint without uploading or changing its receipt payload',async()=>{
    const prepared=await prepareMepPhotoOperation(operation(),async ref=>ref===local?managed:managedOther),resolve=vi.fn(async()=>managedOther);
    const replay=await prepareMepPhotoOperation(prepared,resolve);expect(replay).toEqual(prepared);expect(resolve).not.toHaveBeenCalled();
    expect(JSON.stringify(replay)).toBe(JSON.stringify(prepared));
  });
  it('refuses malformed blocker evidence rather than silently dropping it',async()=>{
    const original=operation();original.changes[0].after={blockers:[{photoRefs:null}]};
    await expect(prepareMepPhotoOperation(original,async()=>managed)).rejects.toThrow('Preuves');
  });
});

describe('static private MEP print boundary',()=>{
  it('keeps colours and embedded photos but inserts a trusted no-network policy before report styles',()=>{
    const result=validateMepReportHtml(html('<h1>Rapport</h1><img src="data:image/jpeg;base64,/9j/AAAA"><svg viewBox="0 0 1000 680"><polyline points="0,0 100,100" stroke="#003582"/></svg>'));
    expect(result).toContain('default-src \'none\'');expect(result).toContain('img-src data:');expect(result).toContain('connect-src \'none\'');
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<style>'));
    expect(result).toContain('stroke="#003582"');expect(result).toContain('data:image/jpeg;base64,/9j/AAAA');
  });
  it('rejects active elements, remote sources and supplied security policies',()=>{
    for(const body of [
      '<script>alert(1)</script>','<img src="https://example.test/pixel">','<img srcset="https://example.test/pixel 2x">',
      '<svg><image href="https://example.test/pixel"/></svg>','<iframe src="data:text/html,x"></iframe>',
      '<object data="https://example.test/private"></object>','<img src="data:image/png;base64,AAAA" onerror="alert(1)">',
      '<svg><foreignObject><p>Texte</p></foreignObject></svg>',
      '<svg><image href="data:image/png;base64,AAAA"><animate attributeName="href" values="https://example.test/pixel"/></image></svg>',
      '<meta http-equiv="Content-Security-Policy" content="default-src *">',
    ])expect(()=>validateMepReportHtml(html(body))).toThrow();
  });
  it('still contains a restrictive network policy when CSS escaped url syntax passes static validation',()=>{
    const result=validateMepReportHtml(html('<div style="background:u\\72l(https://example.test/pixel)">Blocage</div>'));
    expect(result).toContain("default-src 'none'");expect(result).toContain('img-src data:');
  });
  it('does not let a commented or malformed head turn the injected policy into inert markup',()=>{
    for(const source of [
      '<!doctype html><html><!--<head>--><head></head><body>Rapport</body></html>',
      '<!doctype html><html><head title=">"></head><body>Rapport</body></html>',
      '<!doctype html><html><body>Rapport sans head</body></html>',
    ])expect(()=>validateMepReportHtml(source)).toThrow();
  });
  it('rejects oversized or non-HTML messages before opening an operating system print/share UI',()=>{
    for(const source of [null,{},'Rapport sans HTML',html('a'.repeat(19_000_000))])expect(()=>validateMepReportHtml(source)).toThrow();
  });
});
