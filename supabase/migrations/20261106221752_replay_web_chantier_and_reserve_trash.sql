-- One stable operation ID creates the project and its discussion channel together.
create function public.create_web_chantier(
  p_organization_id uuid, p_operation_id uuid, p_chantier jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id text := 'CH-' || p_operation_id::text;
  v_author text;
  v_project public.chantiers%rowtype;
  v_channel public.channels%rowtype;
begin
  if v_actor is null or p_organization_id is null or
     (public.auth_user_role() is distinct from 'super_admin' and
      (p_organization_id is distinct from public.auth_user_org() or not coalesce(public.auth_user_has_permission('canCreate'), false))) then
    raise exception 'Création du chantier non autorisée.' using errcode = '42501';
  end if;
  if p_operation_id is null or jsonb_typeof(p_chantier) is distinct from 'object' or
     nullif(btrim(p_chantier->>'name'), '') is null then
    raise exception 'Chantier invalide.' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(name), ''), nullif(btrim(email), '')) into v_author
  from public.profiles where id = v_actor;
  insert into public.chantiers (
    id, organization_id, name, address, description, start_date, end_date, status, company_ids, buildings, created_by
  ) values (
    v_id, p_organization_id, btrim(p_chantier->>'name'), p_chantier->>'address', p_chantier->>'description',
    p_chantier->>'start_date', p_chantier->>'end_date', coalesce(p_chantier->>'status', 'active'),
    p_chantier->'company_ids', p_chantier->>'buildings', coalesce(v_author, 'Équipe')
  ) on conflict (id) do nothing returning * into v_project;
  if not found then
    select c.* into v_project from public.chantiers c where c.id = v_id and c.organization_id = p_organization_id;
    if not found then raise exception 'Identifiant de chantier indisponible.' using errcode = '42501'; end if;
    select c.* into v_channel from public.channels c where c.id = 'building-' || v_id and c.organization_id = p_organization_id;
    return jsonb_build_object('project', to_jsonb(v_project), 'channel', to_jsonb(v_channel), 'replayed', true);
  end if;

  insert into public.channels (
    id, organization_id, name, description, icon, color, type, members, created_by, created_by_user_id
  ) values (
    'building-' || v_id, p_organization_id, v_project.name, coalesce(v_project.description, ''),
    'business', '#3B82F6', 'building', case when v_author is null then '[]'::jsonb else jsonb_build_array(v_author) end,
    v_author, v_actor
  );
  -- The channel SELECT policy looks up the channel by ID, so read it in a
  -- separate statement after INSERT to make it visible to that policy.
  select c.* into v_channel from public.channels c where c.id = 'building-' || v_id and c.organization_id = p_organization_id;
  if not found then raise exception 'Salon du chantier inaccessible.' using errcode = '42501'; end if;
  return jsonb_build_object('project', to_jsonb(v_project), 'channel', to_jsonb(v_channel));
end;
$$;

-- Append to the current history and recognize a replay even after a restore.
create function public.trash_web_reserve(
  p_organization_id uuid, p_reserve_id text, p_operation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_author text;
  v_reserve public.reserves%rowtype;
  v_history jsonb;
begin
  if v_actor is null or p_organization_id is null or
     (public.auth_user_role() is distinct from 'super_admin' and
      (p_organization_id is distinct from public.auth_user_org() or not coalesce(public.auth_user_has_permission('canDelete'), false))) then
    raise exception 'Mise en corbeille non autorisée.' using errcode = '42501';
  end if;
  if p_operation_id is null then raise exception 'Opération invalide.' using errcode = '22023'; end if;

  select r.* into v_reserve from public.reserves r
  where r.id = p_reserve_id and r.organization_id = p_organization_id for update;
  if not found then raise exception 'Réserve inaccessible.' using errcode = '42501'; end if;
  v_history := case when jsonb_typeof(v_reserve.history) = 'array' then v_reserve.history else '[]'::jsonb end;
  if v_reserve.deleted_at is not null or
     v_history @> jsonb_build_array(jsonb_build_object('id', p_operation_id, 'actorId', v_actor, 'webAction', 'trash')) then
    return jsonb_build_object('reserve', to_jsonb(v_reserve), 'replayed', true);
  end if;

  select coalesce(nullif(btrim(name), ''), nullif(btrim(email), '')) into v_author
  from public.profiles where id = v_actor;
  v_author := coalesce(v_author, 'Équipe');
  update public.reserves r
  set deleted_at = now(), deleted_by = v_author, history = v_history || jsonb_build_array(jsonb_build_object(
    'id', p_operation_id, 'actorId', v_actor, 'webAction', 'trash', 'action', 'Supprimée depuis le web (corbeille)',
    'author', v_author, 'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'oldValue', 'Active', 'newValue', 'Corbeille'))
  where r.id = p_reserve_id returning r.* into v_reserve;
  if not found then raise exception 'Mise en corbeille refusée.' using errcode = '42501'; end if;
  return jsonb_build_object('reserve', to_jsonb(v_reserve));
end;
$$;

revoke all on function public.create_web_chantier(uuid, uuid, jsonb) from public, anon;
grant execute on function public.create_web_chantier(uuid, uuid, jsonb) to authenticated;
revoke all on function public.trash_web_reserve(uuid, text, uuid) from public, anon;
grant execute on function public.trash_web_reserve(uuid, text, uuid) to authenticated;
notify pgrst, 'reload schema';
