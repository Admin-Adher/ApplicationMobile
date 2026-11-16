/** The notification ID locates the authorised snapshot; never trust a label as a target. */
export function notificationActions(notifications,plans){
  const seen=new Set(),result=[];
  for(const notification of [...notifications].filter(n=>!n.readAt&&!n.read_at).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))){
    const key=JSON.stringify([notification.planId,notification.blockerId]);if(seen.has(key))continue;seen.add(key);
    const plan=plans.find(plan=>plan.id===notification.planId);
    const element=plan?.document?.elements?.find(el=>(el.blockers||[]).some(b=>b.id===notification.blockerId));
    result.push({notification,plan,element,blocker:element?.blockers.find(b=>b.id===notification.blockerId)});
  }
  return result;
}
