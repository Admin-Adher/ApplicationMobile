-- Form changes and their status event share a transaction. Both existing
-- mutations have replay receipts, so a lost response is safe to retry.
create function public.apply_web_reserve_form(
  p_operation_id uuid,
  p_reserve_id text,
  p_base_version bigint,
  p_patch jsonb,
  p_gallery jsonb,
  p_status_event jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_status text := p_status_event->>'to_status';
  v_event_id text := 'web-form-status:' || p_reserve_id || ':' || p_operation_id::text;
  v_event_hash text := encode(sha256(convert_to(p_status_event::text, 'UTF8')), 'hex');
begin
  if jsonb_typeof(p_status_event) is distinct from 'object'
     or jsonb_typeof(p_patch) is distinct from 'object'
     or v_status is null or v_status not in ('open', 'in_progress', 'waiting', 'verification', 'closed') then
    raise exception 'Statut de réserve invalide' using errcode = '22023';
  end if;

  v_result := public.apply_web_reserve_edit(
    p_operation_id, p_reserve_id, p_base_version,
    p_patch || jsonb_build_object('form_status_event', p_status_event), p_gallery
  );
  if v_result->>'status' is distinct from 'ok' then
    return v_result;
  end if;

  v_result := public.append_reserve_status_event(
    v_event_id, v_event_hash,
    jsonb_build_object(
      'id', v_event_id,
      'reserve_id', p_reserve_id,
      'from_status', p_status_event->>'from_status',
      'to_status', v_status,
      'actor_name', p_status_event->>'actor_name',
      'reason', 'Statut modifié depuis le web',
      'history_entry', p_status_event->'history_entry',
      'closed_at', case when v_status = 'closed' then p_status_event->>'closed_at' end,
      'closed_by', case when v_status = 'closed' then p_status_event->>'actor_name' end
    )
  );
  if v_result->>'status' is distinct from 'ok' then
    raise exception 'Le statut n’a pas pu être enregistré' using errcode = '22023';
  end if;
  return v_result;
end;
$$;

revoke all on function public.apply_web_reserve_form(uuid, text, bigint, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_web_reserve_form(uuid, text, bigint, jsonb, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
