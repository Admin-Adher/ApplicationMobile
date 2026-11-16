/** Shared by the editor and durable host. No network or UI state. */
export const hasMepBuilding=value=>typeof value==='string'&&Boolean(value.trim())&&!/^sans b[âa]timent$/i.test(value.trim());
export const canCloseMepBlocker=blocker=>['resolved','closed'].includes(blocker?.status);
export function mepTransitionProblem(previous,next,context={}){
  const after=new Map((next.elements||[]).map(el=>[el.id,el]));
  for(const old of previous.elements||[]){
    const el=after.get(old.id),blocks=old.blockers||[];
    if(blocks.length&&!el)return 'Cet ouvrage conserve des points bloquants et leur historique. Traitez les points depuis sa fiche ; l’ouvrage ne peut pas être supprimé.';
    for(const block of blocks)if(!(el?.blockers||[]).some(b=>b.id===block.id))return 'Ce point est conservé pour la traçabilité. Ouvrez sa fiche pour le résoudre, puis le clôturer.';
  }
  const before=new Map((previous.elements||[]).map(el=>[el.id,el]));
  for(const el of next.elements||[]){
    const old=before.get(el.id);
    for(const block of el.blockers||[]){
      const prior=(old?.blockers||[]).find(b=>b.id===block.id);
      if(block.status==='closed'&&!canCloseMepBlocker(prior))return 'Enregistrez d’abord ce point comme « Résolu ». Vous pourrez ensuite le vérifier et le clôturer.';
      if(context.requireBuilding&&!hasMepBuilding(context.building)&&JSON.stringify(el)!==JSON.stringify(old))return 'Renseignez le bâtiment dans la fiche du plan, puis rouvrez l’avancement avant d’enregistrer ce point.';
    }
  }
  return '';
}
