import { supabaseRestRpc } from '../supabaseRest';

export async function readNativeProgress(planId: string, sourceRef: string) {
  const result = await supabaseRestRpc('read_plan_progress', { p_plan_id: planId, p_source_ref: sourceRef });
  if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code, status: result.error.status });
  // The native REST adapter normalises scalar JSON RPCs to one row.
  // Other callers, including durable mutations, rely on that array contract.
  if (result.data?.length !== 1) throw new Error('La réponse d’avancement est vide ou invalide. Réessayez.');
  return result.data[0];
}
