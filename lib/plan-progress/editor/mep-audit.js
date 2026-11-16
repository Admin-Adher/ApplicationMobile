const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function eventAuthor(event={}){
  const value=event.authorName||event.author?.name||(typeof event.author==='string'?event.author:'')||event.actorName;
  return typeof value==='string'&&value.trim()?value.trim():'Auteur non renseigné';
}
/** An activity belongs to one element and exact PDF, never to the whole plan. */
export function workActivity(state={},plan={},el={},snapshotHistory=[]){
  let result={updatedAt:null,authorName:'Auteur non renseigné',authorId:null,pending:false};
  const accept=value=>{
    if(!value)return;
    const time=value.updatedAt||value.time;
    if(!validTime(time))return;
    const pending=Boolean(value.pending);
    if(result.updatedAt&&Date.parse(time)<Date.parse(result.updatedAt))return;
    if(result.updatedAt&&Date.parse(time)===Date.parse(result.updatedAt)&&result.pending&&!pending)return;
    result={updatedAt:time,authorName:eventAuthor(value),authorId:value.userId||value.authorId||null,pending};
  };
  accept(plan.elementActivity?.[el.id]);
  const isCurrent=(!state.currentDoc||state.currentDoc===el.docId)&&(!plan.id||plan.id===el.docId);
  if(isCurrent)accept(state.elementActivity?.[el.id]);
  for(const event of [...(snapshotHistory||[]),...(isCurrent?state.history||[]:[])]){
    if(event.planId&&event.planId!==(plan.id||el.docId))continue;
    if(event.sourceRef&&plan.sourceRef&&event.sourceRef!==plan.sourceRef)continue;
    if(!(event.changes||[]).some(change=>change.target==='elements'&&change.key===el.id))continue;
    accept(event);
  }
  // An old queue may have no trustworthy client timestamp. Keep it explicit.
  if(isCurrent&&state.elementActivity?.[el.id]?.pending)result.pending=true;
  return result;
}
export function responsibleLabel(el={},people=[],lotFallback={}){
  const id=el.mep?.responsibleId;
  if(id)return people.find(person=>person.id===id)?.name||'Responsable indisponible';
  return (typeof lotFallback==='string'?lotFallback:lotFallback.company)||'Entreprise à affecter';
}
