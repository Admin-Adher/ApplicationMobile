-- Replayable web reserve actions keep the row and its history consistent under concurrent edits.
create function public.apply_web_reserve_workflow(
  p_organization_id uuid, p_reserve_id text, p_operation_id uuid, p_action text, p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.auth_user_role();
  v_editor boolean := coalesce(public.auth_user_has_permission('canEdit'), false);
  v_author text;
  v_reserve public.reserves%rowtype;
  v_task public.tasks%rowtype;
  v_history jsonb;
  v_entry jsonb;
  v_reason text;
  v_title text;
  v_at text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_actor is null or p_organization_id is null or
     (v_role is distinct from 'super_admin' and p_organization_id is distinct from public.auth_user_org()) then
    raise exception 'Cette réserve est inaccessible.' using errcode = '42501';
  end if;
  if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' or
     p_action is null or p_action not in ('acknowledge', 'restore', 'reject_lift', 'corrective_task') then
    raise exception 'Action de réserve invalide.' using errcode = '22023';
  end if;
  if v_role is distinct from 'super_admin' and
     (not (v_editor or (p_action = 'acknowledge' and coalesce(v_role = 'sous_traitant', false))) or
      (p_action = 'corrective_task' and not coalesce(public.auth_user_has_permission('canCreate'), false))) then
    raise exception 'Cette action est inaccessible.' using errcode = '42501';
  end if;

  select r.* into v_reserve from public.reserves r
  where r.id = p_reserve_id and r.organization_id = p_organization_id
  for update;
  if not found then raise exception 'Cette réserve est inaccessible.' using errcode = '42501'; end if;
  if p_action = 'acknowledge' and v_role = 'sous_traitant' and
     not coalesce(public.reserve_matches_current_user_company(v_reserve.company, v_reserve.companies), false) then
    raise exception 'Cette réserve est inaccessible.' using errcode = '42501';
  end if;

  v_history := case when jsonb_typeof(v_reserve.history) = 'array' then v_reserve.history else '[]'::jsonb end;
  if v_history @> jsonb_build_array(jsonb_build_object('id', p_operation_id, 'actorId', v_actor, 'webAction', p_action)) then
    if p_action = 'corrective_task' then
      select t.* into v_task from public.tasks t
      where t.id = 'TSK-' || p_operation_id::text and t.organization_id = p_organization_id and t.reserve_id = p_reserve_id;
    end if;
    return jsonb_build_object('reserve', to_jsonb(v_reserve), 'task', case when v_task.id is not null then to_jsonb(v_task) end, 'replayed', true);
  end if;
  if p_action <> 'restore' and v_reserve.deleted_at is not null then
    raise exception 'Cette réserve est dans la corbeille.' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(name), ''), nullif(btrim(email), '')) into v_author from public.profiles where id = v_actor;
  v_author := coalesce(v_author, 'Équipe');
  v_entry := jsonb_build_object('id', p_operation_id, 'actorId', v_actor, 'webAction', p_action, 'author', v_author, 'createdAt', v_at);

  case p_action
    when 'acknowledge' then
      if nullif(btrim(v_reserve.enterprise_acknowledged_at), '') is not null then
        return jsonb_build_object('reserve', to_jsonb(v_reserve), 'replayed', true);
      end if;
      update public.reserves r
      set enterprise_acknowledged_at = left(v_at, 10),
          history = v_history || jsonb_build_array(v_entry || jsonb_build_object('action', 'Réception accusée depuis le web'))
      where r.id = p_reserve_id returning r.* into v_reserve;
    when 'restore' then
      if v_reserve.deleted_at is null then return jsonb_build_object('reserve', to_jsonb(v_reserve), 'replayed', true); end if;
      if v_reserve.deleted_at is distinct from (p_payload->>'deletedAt')::timestamptz then
        raise exception 'Cette réserve a été remise en corbeille entre-temps. Actualisez avant de la restaurer.' using errcode = '22023';
      end if;
      update public.reserves r
      set deleted_at = null, deleted_by = null,
          history = v_history || jsonb_build_array(v_entry || jsonb_build_object(
            'action', 'Restaurée depuis la corbeille web', 'oldValue', 'Corbeille', 'newValue', 'Active'))
      where r.id = p_reserve_id returning r.* into v_reserve;
    when 'reject_lift' then
      if v_reserve.status is distinct from 'verification' or v_reserve.version is distinct from (p_payload->>'version')::bigint then
        raise exception 'Cette réserve a changé entre-temps. Actualisez avant de refuser la levée.' using errcode = '22023';
      end if;
      v_reason := nullif(btrim(p_payload->>'reason'), '');
      if length(v_reason) > 2000 then raise exception 'Le motif est limité à 2 000 caractères.' using errcode = '22023'; end if;
      update public.reserves r
      set status = 'in_progress', closed_at = null, closed_by = null,
          comments = case when v_reason is null then r.comments else
            (case when jsonb_typeof(r.comments) = 'array' then r.comments else '[]'::jsonb end)
            || jsonb_build_array(jsonb_build_object('id', p_operation_id, 'author', v_author, 'authorId', v_actor,
              'content', 'Levée rejetée : ' || v_reason, 'createdAt', v_at)) end,
          history = v_history || jsonb_build_array(v_entry || jsonb_build_object(
            'action', 'Levée rejetée depuis le web', 'oldValue', 'À vérifier', 'newValue', 'En cours'))
      where r.id = p_reserve_id returning r.* into v_reserve;
    when 'corrective_task' then
      select t.* into v_task from public.tasks t
      where t.organization_id = p_organization_id and (t.id = v_reserve.linked_task_id or t.reserve_id = p_reserve_id)
      order by (t.id is not distinct from v_reserve.linked_task_id) desc, t.id limit 1;
      if found then return jsonb_build_object('reserve', to_jsonb(v_reserve), 'task', to_jsonb(v_task), 'replayed', true); end if;
      v_title := nullif(btrim(p_payload->>'title'), '');
      if v_title is null or v_reserve.chantier_id is null then
        raise exception 'La tâche exige un titre et une réserve rattachée à un chantier.' using errcode = '22023';
      end if;
      insert into public.tasks (
        id, title, description, status, priority, start_date, deadline, assignee, company, progress, chantier_id, reserve_id, organization_id, history
      ) values (
        'TSK-' || p_operation_id::text, v_title, coalesce(p_payload->>'description', ''), 'todo',
        coalesce(nullif(v_reserve.priority, ''), 'medium'), nullif(p_payload->>'start_date', ''),
        coalesce(nullif(p_payload->>'deadline', ''), to_char((now() at time zone 'UTC')::date + 7, 'YYYY-MM-DD')),
        coalesce(nullif(btrim(p_payload->>'assignee'), ''), v_author), coalesce(p_payload->>'company', ''), 0,
        v_reserve.chantier_id, p_reserve_id, p_organization_id,
        jsonb_build_array(v_entry || jsonb_build_object('action', 'Tâche créée depuis une réserve'))
      ) returning * into v_task;
      update public.reserves r set linked_task_id = v_task.id,
        history = v_history || jsonb_build_array(v_entry || jsonb_build_object('action', 'Tâche corrective créée'))
      where r.id = p_reserve_id returning r.* into v_reserve;
  end case;
  if not found then raise exception 'Cette action a été refusée.' using errcode = '42501'; end if;
  return jsonb_build_object('reserve', to_jsonb(v_reserve), 'task', case when v_task.id is not null then to_jsonb(v_task) end);
end;
$$;

revoke all on function public.apply_web_reserve_workflow(uuid, text, uuid, text, jsonb) from public, anon;
grant execute on function public.apply_web_reserve_workflow(uuid, text, uuid, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
