-- Sign a single company slot under the same lock as the reserve history.
create function public.sign_web_reserve_lift(
  p_organization_id uuid, p_reserve_id text, p_operation_id uuid, p_payload jsonb
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
  v_companies text[];
  v_history jsonb;
  v_signatures jsonb;
  v_company text := nullif(btrim(p_payload->>'company'), '');
  v_signature text := p_payload->>'signature';
  v_signed_on text := p_payload->>'signedAt';
  v_signer text := nullif(btrim(p_payload->>'signataire'), '');
  v_at text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_multi boolean;
begin
  if v_actor is null or p_organization_id is null or
     (v_role is distinct from 'super_admin' and
      (p_organization_id is distinct from public.auth_user_org() or
       (v_role is distinct from 'sous_traitant' and not coalesce(public.auth_user_has_permission('canEdit'), false)))) then
    raise exception 'Signature non autorisée.' using errcode = '42501';
  end if;
  if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_payload->'multiCompany') is distinct from 'boolean'
     or v_signer is null or length(v_signer) > 240 or v_signature is null or length(v_signature) > 1048576
     or v_signature !~ '^data:image/(png;base64,|svg[+]xml[;,])'
     or v_signed_on is null or v_signed_on !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Signature invalide.' using errcode = '22023';
  end if;

  select r.* into v_reserve from public.reserves r
  where r.id = p_reserve_id and r.organization_id = p_organization_id and r.deleted_at is null
  for update;
  if not found then raise exception 'Réserve inaccessible.' using errcode = '42501'; end if;
  if v_role = 'sous_traitant' and
     (v_company is null or not coalesce(public.reserve_matches_current_user_company(v_company, null), false)) then
    raise exception 'Signature réservée à l’entreprise concernée.' using errcode = '42501';
  end if;
  v_history := case when jsonb_typeof(v_reserve.history) = 'array' then v_reserve.history else '[]'::jsonb end;
  if v_history @> jsonb_build_array(jsonb_build_object('id', p_operation_id, 'actorId', v_actor, 'webAction', 'sign_lift')) then
    return jsonb_build_object('reserve', to_jsonb(v_reserve), 'replayed', true);
  end if;

  select array(select distinct btrim(name)
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_reserve.companies) = 'array' then v_reserve.companies else '[]'::jsonb end
    ) as assigned(name) where nullif(btrim(name), '') is not null
    union select btrim(v_reserve.company) where nullif(btrim(v_reserve.company), '') is not null)
  into v_companies;
  v_multi := cardinality(v_companies) > 1;
  if v_multi is distinct from (p_payload->>'multiCompany')::boolean
     or (cardinality(v_companies) > 0 and not coalesce(v_company = any(v_companies), false))
     or (cardinality(v_companies) = 0 and v_company is not null)
     or nullif(btrim(v_reserve.enterprise_acknowledged_at), '') is null
     or v_reserve.enterprise_acknowledged_at is distinct from p_payload->>'acknowledgedAt' then
    raise exception 'L’accusé de réception ou les entreprises ont changé. Vérifiez la réserve avant de signer.' using errcode = '22023';
  end if;
  v_signatures := case when jsonb_typeof(v_reserve.company_signatures) = 'object' then v_reserve.company_signatures else '{}'::jsonb end;
  if (v_multi and nullif(v_signatures->v_company->>'signature', '') is not null)
     or (not v_multi and nullif(v_reserve.enterprise_signature, '') is not null) then
    raise exception 'Cette levée a déjà été signée.' using errcode = '22023';
  end if;

  update public.reserves r
  set enterprise_signature = case when v_multi then r.enterprise_signature else v_signature end,
      enterprise_signataire = case when v_multi then r.enterprise_signataire else v_signer end,
      company_signatures = case when v_multi then v_signatures || jsonb_build_object(v_company,
        jsonb_build_object('signature', v_signature, 'signataire', v_signer, 'signedAt', to_char(v_signed_on::date, 'YYYY-MM-DD'))) else r.company_signatures end,
      history = v_history || jsonb_build_array(jsonb_build_object(
        'id', p_operation_id, 'actorId', v_actor, 'webAction', 'sign_lift', 'author', v_signer, 'createdAt', v_at,
        'action', case when v_multi then 'Levée signée depuis le web (' || v_company || ')' else 'Levée signée depuis le web' end))
  where r.id = p_reserve_id returning r.* into v_reserve;
  if not found then raise exception 'Signature refusée.' using errcode = '42501'; end if;
  return jsonb_build_object('reserve', to_jsonb(v_reserve));
end;
$$;

-- Remove only the file that was confirmed, through the existing controlled removal.
create function public.remove_web_plan_file(p_organization_id uuid, p_plan_id text, p_expected_uri text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan public.site_plans%rowtype;
begin
  if auth.uid() is null or p_organization_id is null or
     (public.auth_user_role() is distinct from 'super_admin' and
      (p_organization_id is distinct from public.auth_user_org() or not coalesce(public.auth_user_has_permission('canDelete'), false))) then
    raise exception 'Retrait du fichier non autorisé.' using errcode = '42501';
  end if;
  if nullif(btrim(p_expected_uri), '') is null then
    raise exception 'Fichier à retirer non identifié.' using errcode = '22023';
  end if;
  select p.* into v_plan from public.site_plans p
  where p.id = p_plan_id and p.deleted_at is null
    and coalesce(p.organization_id, (select c.organization_id from public.chantiers c where c.id = p.chantier_id)) = p_organization_id
  for update;
  if not found then raise exception 'Plan inaccessible.' using errcode = '42501'; end if;
  if v_plan.uri is null then return to_jsonb(v_plan); end if;
  if v_plan.uri is distinct from p_expected_uri then
    raise exception 'Le fichier du plan a changé. Actualisez le plan avant de confirmer son retrait.' using errcode = '22023';
  end if;
  select * into v_plan from public.replace_site_plan_file_safely(
    p_plan_id, '{"uri":null,"file_type":null,"dxf_name":null,"size":null,"pdf_page_count":null}'::jsonb, 'web_delete_site_plan_file'
  );
  if v_plan.id is null then raise exception 'Retrait du fichier refusé.' using errcode = '42501'; end if;
  return to_jsonb(v_plan);
end;
$$;

revoke all on function public.sign_web_reserve_lift(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.sign_web_reserve_lift(uuid, text, uuid, jsonb) to authenticated;
revoke all on function public.remove_web_plan_file(uuid, text, text) from public, anon;
grant execute on function public.remove_web_plan_file(uuid, text, text) to authenticated;
notify pgrst, 'reload schema';
