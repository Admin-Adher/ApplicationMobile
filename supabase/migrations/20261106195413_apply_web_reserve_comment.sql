-- Keep JSONB collection changes scoped to the row and to the caller's existing RLS rights.
create function public.apply_web_reserve_comment(
  p_reserve_id text, p_organization_id uuid, p_action text, p_comment_id text,
  p_content text, p_previous_content text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reserve public.reserves%rowtype;
  v_author text;
  v_comments jsonb;
  v_comment jsonb;
  v_content text := nullif(btrim(p_content), '');
  v_at text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_actor is null or p_organization_id is null or
     (public.auth_user_role() is distinct from 'super_admin' and p_organization_id is distinct from public.auth_user_org()) then
    raise exception 'Cette réserve est inaccessible.' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('add', 'edit', 'delete') or nullif(btrim(p_comment_id), '') is null or length(p_comment_id) > 128
     or (p_action <> 'delete' and (v_content is null or length(v_content) > 500)) then
    raise exception 'Commentaire invalide.' using errcode = '22023';
  end if;

  select r.* into v_reserve
  from public.reserves r left join public.chantiers c on c.id = r.chantier_id
  where r.id = p_reserve_id and coalesce(r.organization_id, c.organization_id) = p_organization_id
    and r.deleted_at is null
  for update of r;
  if not found then
    raise exception 'Cette réserve est inaccessible.' using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(name), ''), nullif(btrim(email), '')) into v_author
  from public.profiles where id = v_actor;
  v_comments := case when jsonb_typeof(v_reserve.comments) = 'array' then v_reserve.comments else '[]'::jsonb end;
  select entry into v_comment from jsonb_array_elements(v_comments) as j(entry)
  where entry->>'id' = p_comment_id limit 1;

  if p_action = 'add' then
    if v_comment is not null then
      if v_comment->>'authorId' = v_actor::text then return to_jsonb(v_reserve); end if;
      raise exception 'Cet identifiant de commentaire est déjà utilisé.' using errcode = '23505';
    end if;
    if coalesce(v_reserve.history @> jsonb_build_array(jsonb_build_object('id', p_comment_id, 'actorId', v_actor)), false) then
      return to_jsonb(v_reserve);
    end if;
    v_comments := v_comments || jsonb_build_array(jsonb_build_object(
      'id', p_comment_id, 'content', v_content, 'author', coalesce(v_author, 'Équipe'), 'authorId', v_actor, 'createdAt', v_at
    ));
  else
    if v_comment is null then
      if p_action = 'delete' then return to_jsonb(v_reserve); end if;
      raise exception 'Ce commentaire a été supprimé.' using errcode = '22023';
    end if;
    if not coalesce(v_comment->>'authorId' = v_actor::text or
      (nullif(v_comment->>'authorId','') is null and v_comment->>'author' = v_author), false) then
      raise exception 'Seul l’auteur peut modifier ce commentaire.' using errcode = '42501';
    end if;
    if p_action = 'edit' and v_comment->>'content' = v_content then return to_jsonb(v_reserve); end if;
    if p_action = 'edit' and v_comment->>'content' is distinct from p_previous_content then
      raise exception 'Ce commentaire a changé sur un autre appareil.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(
      case when entry->>'id' = p_comment_id then entry || jsonb_build_object('content', v_content, 'editedAt', v_at)
        else entry end order by idx
    ), '[]'::jsonb) into v_comments
    from jsonb_array_elements(v_comments) with ordinality as j(entry, idx)
    where p_action <> 'delete' or entry->>'id' is distinct from p_comment_id;
  end if;

  update public.reserves r set comments = v_comments,
    history = case when p_action <> 'add' then r.history else
      (case when jsonb_typeof(r.history) = 'array' then r.history else '[]'::jsonb end)
      || jsonb_build_array(jsonb_build_object(
        'id', p_comment_id, 'action', 'Commentaire ajouté depuis le web', 'actorId', v_actor, 'author', coalesce(v_author, 'Équipe'), 'createdAt', v_at
      )) end
  where r.id = p_reserve_id returning r.* into v_reserve;
  if not found then raise exception 'Ce commentaire ne peut pas être enregistré.' using errcode = '42501'; end if;
  return to_jsonb(v_reserve);
end;
$$;

create function public.apply_web_plan_annotations(
  p_plan_id text, p_organization_id uuid, p_added jsonb, p_removed text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan public.site_plans%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null or p_organization_id is null or
     (public.auth_user_role() is distinct from 'super_admin' and
       (p_organization_id is distinct from public.auth_user_org() or not coalesce(public.auth_user_has_permission('canCreate'), false))) then
    raise exception 'Ce plan est inaccessible.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_added) is distinct from 'array' or p_removed is null then
    raise exception 'Annotations invalides.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_added) > 2000 or cardinality(p_removed) > 20000
     or octet_length(p_added::text) > 4000000 or exists (
       select 1 from jsonb_array_elements(p_added) as j(entry)
       where jsonb_typeof(entry) <> 'object' or nullif(entry->>'id','') is null or length(entry->>'id') > 128
     ) then
    raise exception 'Annotations invalides.' using errcode = '22023';
  end if;

  select p.* into v_plan
  from public.site_plans p left join public.chantiers c on c.id = p.chantier_id
  where p.id = p_plan_id and coalesce(p.organization_id, c.organization_id) = p_organization_id
    and p.deleted_at is null
  for update of p;
  if not found then raise exception 'Ce plan est inaccessible.' using errcode = '42501'; end if;

  v_before := case when jsonb_typeof(v_plan.annotations) = 'array' then v_plan.annotations else '[]'::jsonb end;
  select coalesce(jsonb_agg(entry order by idx), '[]'::jsonb) into v_after
  from jsonb_array_elements(v_before) with ordinality as j(entry, idx)
  where not coalesce(entry->>'id' = any(p_removed), false);

  v_after := v_after || coalesce((
    select jsonb_agg(entry order by idx) from (
      select distinct on (entry->>'id') entry, idx
      from jsonb_array_elements(p_added) with ordinality as a(entry, idx)
      where not v_after @> jsonb_build_array(jsonb_build_object('id', entry->>'id'))
      order by entry->>'id', idx
    ) additions
  ), '[]'::jsonb);

  if v_after = v_before then return to_jsonb(v_plan); end if;
  update public.site_plans p set annotations = v_after where p.id = p_plan_id returning p.* into v_plan;
  if not found then raise exception 'Ces annotations ne peuvent pas être enregistrées.' using errcode = '42501'; end if;
  return to_jsonb(v_plan);
end;
$$;

revoke all on function public.apply_web_reserve_comment(text, uuid, text, text, text, text) from public, anon;
grant execute on function public.apply_web_reserve_comment(text, uuid, text, text, text, text) to authenticated;
revoke all on function public.apply_web_plan_annotations(text, uuid, jsonb, text[]) from public, anon;
grant execute on function public.apply_web_plan_annotations(text, uuid, jsonb, text[]) to authenticated;
notify pgrst, 'reload schema';
