-- Apply small Terrain mutations against the current row under the existing RLS policies.
create function public.apply_web_terrain_action(
  p_organization_id uuid, p_id text, p_operation_id uuid, p_action text, p_payload jsonb
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
  v_visit public.visites%rowtype;
  v_task public.tasks%rowtype;
  v_items jsonb;
  v_item_id text;
  v_value boolean;
  v_content text;
  v_comment jsonb;
  v_mutation text;
  v_at text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_actor is null or p_organization_id is null or
     (public.auth_user_role() is distinct from 'super_admin' and
      (p_organization_id is distinct from public.auth_user_org() or not coalesce(public.auth_user_has_permission('canEdit'), false))) then
    raise exception 'Cette action est inaccessible.' using errcode = '42501';
  end if;
  if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Action invalide.' using errcode = '22023';
  end if;

  if p_action = 'reserve_archive' then
    if jsonb_typeof(p_payload->'archived') is distinct from 'boolean' then
      raise exception 'Archivage invalide.' using errcode = '22023';
    end if;
    v_value := (p_payload->>'archived')::boolean;
    select r.* into v_reserve from public.reserves r
    where r.id = p_id and coalesce(r.organization_id, (select c.organization_id from public.chantiers c where c.id = r.chantier_id)) = p_organization_id and r.deleted_at is null
    for update;
    if not found then raise exception 'Réserve inaccessible.' using errcode = '42501'; end if;
    v_items := case when jsonb_typeof(v_reserve.history) = 'array' then v_reserve.history else '[]'::jsonb end;
    if v_items @> jsonb_build_array(jsonb_build_object('id', p_operation_id, 'actorId', v_actor)) or
       (v_reserve.archived_at is not null) = v_value then
      return to_jsonb(v_reserve);
    end if;
    select coalesce(nullif(btrim(name), ''), nullif(btrim(email), '')) into v_author
    from public.profiles where id = v_actor;
    update public.reserves r
    set archived_at = case when v_value then now() else null end,
        archived_by = case when v_value then coalesce(v_author, 'Équipe') else null end,
        history = v_items || jsonb_build_array(jsonb_build_object(
          'id', p_operation_id, 'actorId', v_actor, 'action', case when v_value then 'Archivée' else 'Désarchivée' end,
          'author', coalesce(v_author, 'Équipe'), 'createdAt', v_at,
          'oldValue', case when v_value then 'Active' else 'Archivée' end,
          'newValue', case when v_value then 'Archivée' else 'Active' end
        ))
    where r.id = p_id returning r.* into v_reserve;
    if not found then raise exception 'Archivage refusé.' using errcode = '42501'; end if;
    return to_jsonb(v_reserve);
  end if;

  if p_action = 'visit_checklist_item' then
    v_item_id := nullif(btrim(p_payload->>'itemId'), '');
    if v_item_id is null or jsonb_typeof(p_payload->'checked') is distinct from 'boolean' then
      raise exception 'Point de contrôle invalide.' using errcode = '22023';
    end if;
    select v.* into v_visit from public.visites v
    where v.id = p_id and v.organization_id = p_organization_id
    for update;
    if not found then raise exception 'Visite inaccessible.' using errcode = '42501'; end if;
    if jsonb_typeof(v_visit.checklist_items) is distinct from 'array' or
       not v_visit.checklist_items @> jsonb_build_array(jsonb_build_object('id', v_item_id)) then
      raise exception 'Ce point de contrôle a été retiré.' using errcode = '22023';
    end if;
    select jsonb_agg(
      case when entry->>'id' = v_item_id then entry || jsonb_build_object('checked', p_payload->'checked') else entry end
      order by idx
    ) into v_items from jsonb_array_elements(v_visit.checklist_items) with ordinality j(entry, idx);
    if v_items = v_visit.checklist_items and v_visit.status is distinct from 'planned' then return to_jsonb(v_visit); end if;
    update public.visites v set checklist_items = v_items,
      status = case when v.status = 'planned' then 'in_progress' else v.status end
    where v.id = p_id returning v.* into v_visit;
    if not found then raise exception 'Point de contrôle inaccessible.' using errcode = '42501'; end if;
    return to_jsonb(v_visit);
  end if;

  if p_action = 'task_comment' then
    v_mutation := p_payload->>'mutation';
    v_item_id := case when v_mutation = 'add' then p_operation_id::text else nullif(btrim(p_payload->>'commentId'), '') end;
    v_content := nullif(btrim(p_payload->>'content'), '');
    if v_mutation is null or v_mutation not in ('add', 'edit', 'delete') or v_item_id is null or
       (v_mutation <> 'delete' and v_content is null) then
      raise exception 'Commentaire invalide.' using errcode = '22023';
    end if;
    select t.* into v_task from public.tasks t
    where t.id = p_id and coalesce(t.organization_id, (select c.organization_id from public.chantiers c where c.id = t.chantier_id)) = p_organization_id
    for update;
    if not found then raise exception 'Tâche inaccessible.' using errcode = '42501'; end if;
    v_items := case when jsonb_typeof(v_task.comments) = 'array' then v_task.comments else '[]'::jsonb end;
    select entry into v_comment from jsonb_array_elements(v_items) as j(entry) where entry->>'id' = v_item_id limit 1;
    select coalesce(nullif(btrim(name), ''), nullif(btrim(email), '')) into v_author
    from public.profiles where id = v_actor;

    if v_mutation = 'add' then
      if v_comment is not null then
        if v_comment->>'authorId' = v_actor::text then return to_jsonb(v_task); end if;
        raise exception 'Identifiant de commentaire déjà utilisé.' using errcode = '23505';
      end if;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'id', v_item_id, 'author', coalesce(v_author, 'Équipe'), 'authorId', v_actor, 'content', v_content, 'createdAt', v_at
      ));
    else
      if v_comment is null then
        if v_mutation = 'delete' then return to_jsonb(v_task); end if;
        raise exception 'Ce commentaire a été supprimé.' using errcode = '22023';
      end if;
      if not coalesce(v_comment->>'authorId' = v_actor::text or
        (nullif(v_comment->>'authorId','') is null and v_comment->>'author' = v_author), false) then
        raise exception 'Seul l’auteur peut modifier ce commentaire.' using errcode = '42501';
      end if;
      if v_mutation = 'edit' then
        if coalesce(v_comment->>'content', v_comment->>'text') = v_content then return to_jsonb(v_task); end if;
        if coalesce(v_comment->>'content', v_comment->>'text') is distinct from p_payload->>'previousContent' then
          raise exception 'Ce commentaire a changé sur un autre appareil.' using errcode = '22023';
        end if;
        v_comment := v_comment || jsonb_build_object('content', v_content, 'editedAt', v_at);
        if v_comment ? 'text' then v_comment := v_comment || jsonb_build_object('text', v_content); end if;
      end if;
      select coalesce(jsonb_agg(case when entry->>'id' = v_item_id then v_comment else entry end order by idx), '[]'::jsonb)
      into v_items from jsonb_array_elements(v_items) with ordinality as j(entry, idx)
      where v_mutation <> 'delete' or entry->>'id' is distinct from v_item_id;
    end if;
    update public.tasks t set comments = v_items where t.id = p_id returning t.* into v_task;
    if not found then raise exception 'Commentaire inaccessible.' using errcode = '42501'; end if;
    return to_jsonb(v_task);
  end if;

  raise exception 'Action inconnue.' using errcode = '22023';
end;
$$;

-- Reuse the existing atomic plan migration and recognize a retry after a lost response.
create function public.create_web_plan_revision(
  p_organization_id uuid, p_parent_plan_id text, p_new_plan jsonb, p_migrate_reserves boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_parent public.site_plans%rowtype;
  v_existing public.site_plans%rowtype;
  v_id text := nullif(btrim(p_new_plan->>'id'), '');
begin
  if auth.uid() is null or p_organization_id is null or
     (public.auth_user_role() is distinct from 'super_admin' and
      (p_organization_id is distinct from public.auth_user_org() or not coalesce(public.auth_user_has_permission('canCreate'), false))) then
    raise exception 'Plan inaccessible.' using errcode = '42501';
  end if;
  if v_id is null or p_migrate_reserves is null then raise exception 'Révision invalide.' using errcode = '22023'; end if;
  select p.* into v_parent from public.site_plans p
  where p.id = p_parent_plan_id and coalesce(p.organization_id, (select c.organization_id from public.chantiers c where c.id = p.chantier_id)) = p_organization_id and p.deleted_at is null
  for update;
  if not found then raise exception 'Plan parent inaccessible.' using errcode = '42501'; end if;
  select p.* into v_existing from public.site_plans p where p.id = v_id;
  if found then
    if v_existing.organization_id is distinct from p_organization_id or v_existing.parent_plan_id is distinct from p_parent_plan_id
       or v_existing.deleted_at is not null then
      raise exception 'Identifiant de révision déjà utilisé.' using errcode = '23505';
    end if;
    return jsonb_build_object('plan', to_jsonb(v_existing), 'replayed', true);
  end if;
  if v_parent.replaced_by_plan_id is not null then
    raise exception 'Une révision plus récente existe. Créez la révision depuis le dernier plan.' using errcode = '22023';
  end if;
  return public.create_site_plan_revision_with_reserve_migration(
    p_parent_plan_id,
    p_new_plan || jsonb_build_object('organization_id', p_organization_id, 'chantier_id', v_parent.chantier_id,
                                    'revision_number', coalesce(v_parent.revision_number, 1) + 1),
    p_migrate_reserves
  );
end;
$$;

revoke all on function public.apply_web_terrain_action(uuid, text, uuid, text, jsonb) from public, anon;
grant execute on function public.apply_web_terrain_action(uuid, text, uuid, text, jsonb) to authenticated;
revoke all on function public.create_web_plan_revision(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.create_web_plan_revision(uuid, text, jsonb, boolean) to authenticated;
notify pgrst, 'reload schema';
