import type {ProgressOperation} from './core';

export const isLocalMepPhoto=(value:unknown):value is `btlocal://${string}`=>typeof value==='string'&&/^btlocal:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const isManagedMepPhoto=(value:unknown):value is `btmedia://${string}`=>typeof value==='string'&&/^btmedia:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function hasLocalMepPhotos(operation:ProgressOperation){return operation.changes.some(change=>change.target==='elements'&&['before','after'].some(side=>{
  const value=change[side as 'before'|'after'] as {blockers?:{photoRefs?:unknown[]}[]}|null;
  return Array.isArray(value?.blockers)&&value.blockers.some(b=>Array.isArray(b.photoRefs)&&b.photoRefs.some(isLocalMepPhoto));
}));}
/** Translate only declared blocker photo fields, in both CAS sides. No arbitrary JSON replacement. */
export async function prepareMepPhotoOperation(operation:ProgressOperation,resolve:(ref:string)=>Promise<string>):Promise<ProgressOperation>{
  const result=JSON.parse(JSON.stringify(operation)) as ProgressOperation;
  const resolved=new Map<string,string>();
  for(const change of result.changes){
    if(change.target!=='elements')continue;
    for(const side of ['before','after'] as const){
      const element=change[side] as {blockers?:{photoRefs:unknown[]}[]}|null;
      if(!element||!Array.isArray(element.blockers))continue;
      for(const blocker of element.blockers){
        if(!Array.isArray(blocker.photoRefs))throw Error('Preuves du blocage invalides.');
        for(let i=0;i<blocker.photoRefs.length;i++){
          const ref=blocker.photoRefs[i];if(!isLocalMepPhoto(ref))continue;
          let target=resolved.get(ref);if(!target){target=await resolve(ref);if(!isManagedMepPhoto(target))throw Error('Photo MEP non téléversée.');resolved.set(ref,target);}
          blocker.photoRefs[i]=target;
        }
      }
    }
  }
  return result;
}
