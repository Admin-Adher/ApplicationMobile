-- Commit the subcontractor's request and its gallery entry in one transaction.
-- SECURITY INVOKER keeps the existing reserve and photo policies in force.
create function public.apply_web_reserve_lift(
  p_operation_id uuid,
  p_reserve_id text,
  p_organization_id uuid,
  p_comment text,
  p_photo_uri text,
  p_photo_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.auth_user_role();
  v_reserve public.reserves%rowtype;
  v_photo public.photos%rowtype;
  v_actor_name text;
  v_comment text := nullif(btrim(p_comment), '');
  v_entry_id text := 'web-lift:' || p_operation_id::text;
  v_date text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_history jsonb;
  v_comments jsonb;
  v_photos jsonb;
begin
  if v_actor is null or p_organization_id is null
     or (v_role is distinct from 'super_admin' and p_organization_id is distinct from public.auth_user_org()) then
    raise exception 'Cette réserve est inaccessible.' using errcode = '42501';
  end if;
  if p_operation_id is null or length(coalesce(v_comment, '')) > 10000
     or (p_photo_uri is not null and p_photo_uri !~ '^btmedia://[0-9a-fA-F-]{36}$') then
    raise exception 'Demande de levée invalide.' using errcode = '22023';
  end if;

  select r.* into v_reserve
  from public.reserves r
  left join public.chantiers c on c.id = r.chantier_id
  where r.id = p_reserve_id and coalesce(r.organization_id, c.organization_id) = p_organization_id
  for update of r;

  if not found or not coalesce(
    v_role = 'super_admin'
    or (v_role = 'sous_traitant' and public.reserve_matches_current_user_company(v_reserve.company, v_reserve.companies))
    or (v_role <> 'sous_traitant' and public.auth_user_has_permission('canEdit')), false
  ) then
    raise exception 'Cette réserve est inaccessible.' using errcode = '42501';
  end if;

  v_history := case when jsonb_typeof(v_reserve.history) = 'array' then v_reserve.history else '[]'::jsonb end;
  if v_history @> jsonb_build_array(jsonb_build_object('id', v_entry_id, 'actorId', v_actor::text)) then
    select p.* into v_photo from public.photos p
    where p.id = p_operation_id::text and p.reserve_id = p_reserve_id and p.organization_id = p_organization_id;
    return jsonb_build_object('reserve', to_jsonb(v_reserve), 'photo',
      case when v_photo.id is not null then to_jsonb(v_photo) end, 'replayed', true);
  end if;

  if v_reserve.deleted_at is not null or v_reserve.archived_at is not null
     or coalesce(v_reserve.status, 'open') not in ('open', 'in_progress', 'waiting') then
    raise exception 'Le statut de la réserve a changé. Rechargez sa fiche.' using errcode = '22023';
  end if;

  select nullif(btrim(name), '') into v_actor_name from public.profiles where id = v_actor;
  v_actor_name := coalesce(v_actor_name, 'Entreprise');
  v_comments := case when jsonb_typeof(v_reserve.comments) = 'array' then v_reserve.comments else '[]'::jsonb end;
  v_photos := case when jsonb_typeof(v_reserve.photos) = 'array' then v_reserve.photos else '[]'::jsonb end;

  if v_comment is not null then
    v_comments := v_comments || jsonb_build_array(jsonb_build_object(
      'id', v_entry_id, 'author', v_actor_name, 'authorId', v_actor, 'content', 'Demande de levée : ' || v_comment, 'createdAt', v_date
    ));
  end if;

  if p_photo_uri is not null then
    v_photos := v_photos || jsonb_build_array(jsonb_build_object(
      'id', p_operation_id::text, 'uri', p_photo_uri, 'kind', 'resolution', 'takenAt', v_date, 'takenBy', v_actor_name,
      'name', left(p_photo_name, 255), 'annotations', '[]'::jsonb
    ));
  end if;

  perform set_config('app.audit_reason', 'web_reserve_lift', true);
  update public.reserves r set
    status = 'verification',
    comments = case when v_comment is not null then v_comments else r.comments end,
    photos = case when p_photo_uri is not null then v_photos else r.photos end,
    photo_uri = coalesce(r.photo_uri, v_photos->0->>'uri', p_photo_uri),
    history = v_history || jsonb_build_array(jsonb_build_object(
      'id', v_entry_id, 'action', 'Demande de levée depuis le web', 'author', v_actor_name, 'actorId', v_actor,
      'createdAt', v_date, 'oldValue', v_reserve.status, 'newValue', 'En vérification'
    )),
    closed_at = null, closed_by = null
  where r.id = p_reserve_id
  returning r.* into v_reserve;
  if not found then
    raise exception 'La demande de levée a été refusée.' using errcode = '42501';
  end if;

  if p_photo_uri is not null then
    insert into public.photos (id, comment, location, taken_at, taken_by, color_code, uri, reserve_id, organization_id)
    values (
      p_operation_id::text, 'Photo de levée', concat_ws(' · ', v_reserve.building, v_reserve.level, v_reserve.zone),
      v_date, v_actor_name, '#10b981', p_photo_uri, p_reserve_id, p_organization_id
    ) returning * into v_photo;
  end if;

  return jsonb_build_object('reserve', to_jsonb(v_reserve), 'photo',
    case when p_photo_uri is not null then to_jsonb(v_photo) end, 'replayed', false);
end;
$$;

revoke all on function public.apply_web_reserve_lift(uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.apply_web_reserve_lift(uuid, text, uuid, text, text, text) to authenticated;
notify pgrst, 'reload schema';
