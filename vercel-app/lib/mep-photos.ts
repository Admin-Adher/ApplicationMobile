import {resolvePrivateMediaRefs,uploadRegisteredWebFile} from './private-media-client';
import {isLocalMepPhoto,isManagedMepPhoto} from '../../lib/plan-progress/media-refs';

type Photo={key:string;blob:Blob;name:string;managedRef?:string};
async function transact<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('buildtrack-mep-photos-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('photos',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Stockage photo occupé. Fermez les anciens onglets.'));});
  try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction('photos',mode),r=run(tx.objectStore('photos'));tx.oncomplete=()=>resolve(r.result);tx.onabort=()=>reject(tx.error||Error('Photo non enregistrée.'));tx.onerror=()=>reject(tx.error||r.error);});}finally{db.close();}
}
const photoKey=(owner:string,ref:string)=>JSON.stringify([owner,ref]);
export async function storeMepWebPhoto(owner:string,file:File){
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)||!file.size||file.size>12*1024*1024)throw Error('Choisissez une photo JPG, PNG ou WebP de moins de 12 Mo.');
  const bitmap=await createImageBitmap(file);
  let blob:Blob;try{const factor=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*factor));canvas.height=Math.max(1,Math.round(bitmap.height*factor));const ctx=canvas.getContext('2d');if(!ctx)throw Error('Préparation photo impossible.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Préparation photo impossible.')),'image/jpeg',.82));}finally{bitmap.close();}
  const ref='btlocal://'+crypto.randomUUID();await transact('readwrite',s=>s.put({key:photoKey(owner,ref),blob,name:'mep-'+ref.slice(10)+'.jpg'}));return ref;
}
export async function uploadMepWebPhoto(owner:string,ref:string,owned:()=>Promise<void>){
  // Share the final mapping across tabs before any RPC can acquire a receipt.
  if(!navigator.locks)throw Error('L’envoi des photos hors ligne nécessite un navigateur à jour. La saisie reste conservée.');
  return navigator.locks.request('bt-mep-upload:'+photoKey(owner,ref),()=>uploadMepWebPhotoLocked(owner,ref,owned));
}
async function uploadMepWebPhotoLocked(owner:string,ref:string,owned:()=>Promise<void>){
  if(!isLocalMepPhoto(ref))throw Error('Référence photo locale invalide.');
  const photo=await transact<Photo|undefined>('readonly',s=>s.get(photoKey(owner,ref)));
  if(!photo)throw Error('Photo locale introuvable. La saisie reste dans la file.');
  if(photo.managedRef)return photo.managedRef;
  await owned();const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Envoi de la photo trop long. La saisie reste dans la file.'));},60000);});
  let managedRef:string;
  try{managedRef=await Promise.race([uploadRegisteredWebFile('photos',new File([photo.blob],photo.name,{type:photo.blob.type}),'mep',{signal:controller.signal,expectedUserId:owner.split(':')[0]}),timeout]);}finally{clearTimeout(timer);controller.abort();}
  await owned();
  if(!isManagedMepPhoto(managedRef))throw Error('Photo privée non confirmée.');
  await transact('readwrite',s=>s.put({...photo,managedRef}));return managedRef;
}
async function dataUrl(blob:Blob){return await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('Lecture photo impossible.'));r.readAsDataURL(blob);});}
export async function resolveMepWebPhotos(owner:string,refs:string[]){
  if(!Array.isArray(refs)||refs.length>100||refs.some(r=>!isLocalMepPhoto(r)&&!isManagedMepPhoto(r)))throw Error('Photos MEP invalides.');
  const remote=await resolvePrivateMediaRefs(refs.filter(isManagedMepPhoto));
  let total=0;const urls:string[]=[];
  for(const ref of refs){
    let blob:Blob;
    if(isLocalMepPhoto(ref)){const photo=await transact<Photo|undefined>('readonly',s=>s.get(photoKey(owner,ref)));if(!photo)throw Error('Photo locale introuvable.');blob=photo.blob;}
    else{const url=remote.get(ref);if(!url)throw Error('Accès à une photo MEP indisponible.');const response=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Photo MEP indisponible.');blob=await response.blob();}
    total+=blob.size;if(!/^image\/(jpeg|png|webp)$/.test(blob.type)||blob.size>12*1024*1024||total>14*1024*1024)throw Error('Photos trop volumineuses pour cet export. Réduisez le périmètre.');
    urls.push(await dataUrl(blob));
  }return {urls};
}
