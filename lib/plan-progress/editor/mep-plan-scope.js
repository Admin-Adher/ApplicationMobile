/** One local/server scope for both dashboard and every export. */
export function effectiveMepPlans(state,snapshot,basePlan){
  const id=state.currentDoc||basePlan.id,remote=(snapshot?.plans||[]).find(plan=>plan.id===id);
  const doc=(state.documents||[]).find(plan=>plan.id===id)||{};
  const local={...remote,...basePlan,...doc,id,local:true,document:{...state,elements:(state.elements||[]).filter(el=>el.docId===id)}};
  const source=local.sourceRef;
  const dates=[remote?.updatedAt,basePlan.updatedAt,...(state.history||[]).filter(event=>(!event.planId||event.planId===id)&&(!source||!event.sourceRef||source===event.sourceRef)).map(event=>event.time)];
  local.updatedAt=dates.filter(value=>typeof value==='string'&&Number.isFinite(Date.parse(value))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;
  const plans=(snapshot?.plans||[]).map(plan=>plan.id===id?local:plan);
  if(!plans.some(plan=>plan.id===id))plans.push(local);
  return plans;
}
