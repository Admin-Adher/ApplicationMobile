const pending=new Map();
export const boot=window.BT_BOOT;
if(!boot?.nonce||!boot?.document||!boot?.plan)throw Error('Ouvrez l’avancement depuis un plan BuildTrack.');
export function request(type,payload){
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(Error('Résultat non confirmé. Rouvrez le plan pour contrôler les données et la file de synchronisation.'),{code:['save','reload'].includes(type)?'LOCAL_SAVE_UNCONFIRMED':undefined}));},45000);
    pending.set(id,{resolve,reject,timer});
    const message={channel:'bt-plan-progress',nonce:boot.nonce,id,type,payload};
    if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else window.parent.postMessage(message,'*');
  });
}
function receive(event){
  let message;try{message=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
  if(message?.channel!=='bt-plan-progress'||message.nonce!==boot.nonce)return;
  if(!window.ReactNativeWebView&&event.source!==window.parent)return;
  if(message.type==='closeEditor'){window.dispatchEvent(new Event('bt-progress-close'));return;}
  if(message.type==='refreshAvailable'){window.dispatchEvent(new Event('bt-progress-refresh'));return;}
  if(message.type==='status'){document.getElementById('savedState').textContent=message.text;return;}
  const job=pending.get(message.id);if(!job)return;
  clearTimeout(job.timer);pending.delete(message.id);
  message.error?job.reject(Object.assign(Error(message.error),{code:message.uncertain?'LOCAL_SAVE_UNCONFIRMED':undefined})):job.resolve(message.payload);
}
window.addEventListener('message',receive);
// Android WebView historically dispatches injected messages on document.
document.addEventListener('message',receive);
export function canChangeStatus(elements,status){
  if(boot.permissions.edit)return true;
  return status!=='checked'&&boot.permissions.editOwn&&elements.length>0&&elements.every(el=>el.status!=='checked'&&JSON.parse(el.lotId)[0]===boot.companyId);
}
export function applyPermissions(selectedElements=[]){
  const p=boot.permissions;
  document.querySelectorAll('[data-edit-element],[data-edit-dimensions],[data-redraw-element],[data-tool="calibrate"]').forEach(el=>el.hidden=!p.edit);
  document.querySelectorAll('[data-delete-element]').forEach(el=>el.hidden=!p.delete);
  document.querySelectorAll('[data-open-add],[data-add-kind],[data-undo]').forEach(el=>el.hidden=!p.edit||!boot.groups.length);
  document.querySelectorAll('[data-status]').forEach(el=>el.disabled=!canChangeStatus(selectedElements,el.dataset.status));
  document.querySelectorAll('[data-billed]').forEach(el=>el.disabled=!(p.edit&&p.export));
  document.querySelectorAll('[data-view="tracking"],[data-proxy="exportButton"],#exportButton').forEach(el=>el.hidden=!p.export);
  document.getElementById('priceBasisField').hidden=!p.export;
  for(const id of ['elementPrice','elementPriceLabel','priceBasisHint','simplePriceHint']){const el=document.getElementById(id);if(el)el.hidden=!p.export;}
  document.getElementById('addWorkButton').hidden=!p.edit||!boot.groups.length||document.body.dataset.view!=='plan';
  document.getElementById('returnPlanButton').hidden=document.body.dataset.view==='plan';
  document.getElementById('terrainUndo').hidden=!p.edit;
  const note=document.getElementById('elementNote');if(note)note.disabled=!canChangeStatus(selectedElements,'progress');
  document.querySelectorAll('.mini-fact').forEach(el=>el.hidden=!p.export);
  const cards=document.getElementById('metrics').children;for(let i=0;i<cards.length;i++)cards[i].hidden=!p.export&&i!==1;
}
