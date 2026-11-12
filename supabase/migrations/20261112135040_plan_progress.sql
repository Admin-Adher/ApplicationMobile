-- Independent PDF progress records. Existing plans, annotations and reserves are never rewritten.
create table public.site_plan_progress (
  plan_id text not null,
  source_hash text not null,
  source_ref text not null,
  organization_id uuid not null references public.organizations(id),
  document jsonb not null default '{"elements":[],"calibrations":{},"billed":{}}',
  updated_at timestamptz not null default now(),
  primary key (plan_id, source_hash),
  foreign key (organization_id, plan_id) references public.site_plans(organization_id, id)
);
create table public.site_plan_progress_operations (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  plan_id text not null,
  source_ref text not null,
  changes jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.site_plan_progress enable row level security;
alter table public.site_plan_progress_operations enable row level security;
create index site_plan_progress_history_idx on public.site_plan_progress_operations(plan_id,md5(source_ref),created_at desc);
-- RPC-only access: prices are redacted for profiles without export rights.
revoke all on public.site_plan_progress, public.site_plan_progress_operations from public, anon, authenticated;

create function public.plan_progress_authorize(p_plan_id text, p_source_ref text)
returns uuid language plpgsql security definer stable set search_path = '' as $$
declare v_plan public.site_plans; v_project jsonb; v_company text;
begin
  if auth.uid() is null then raise exception 'Session requise' using errcode = '42501'; end if;
  select * into v_plan from public.site_plans where id = p_plan_id;
  if not found or v_plan.organization_id is distinct from public.auth_user_org() then
    raise exception 'Plan inaccessible' using errcode = '42501';
  end if;
  select to_jsonb(c) into v_project from public.chantiers c where c.id = v_plan.chantier_id and c.organization_id = v_plan.organization_id;
  select om.company_id into v_company from public.organization_memberships om
    where om.user_id = auth.uid() and om.organization_id = v_plan.organization_id and om.status = 'active';
  if v_project is null or v_project->>'deleted_at' is not null or
    (public.auth_user_role() not in ('super_admin','admin','conducteur') and
      jsonb_typeof(v_project->'company_ids') = 'array' and jsonb_array_length(v_project->'company_ids') > 0
      and not coalesce((v_project->'company_ids') @> jsonb_build_array(v_company), false)) then
    raise exception 'Chantier inaccessible' using errcode = '42501';
  end if;
  if nullif(p_source_ref, '') is null or length(p_source_ref) > 4096 or
    v_plan.uri is distinct from p_source_ref or to_jsonb(v_plan)->>'deleted_at' is not null or
    to_jsonb(v_plan)->>'file_deleted_at' is not null or
    lower(coalesce(to_jsonb(v_plan)->>'file_type','pdf')) not in ('pdf','application/pdf') then
    raise exception 'Le fichier du plan a changé. Rouvrez sa version actuelle.' using errcode = '22023';
  end if;
  return v_plan.organization_id;
end $$;
revoke all on function public.plan_progress_authorize(text,text) from public, anon, authenticated;

create function public.read_plan_progress(p_plan_id text, p_source_ref text)
returns jsonb language plpgsql security definer stable set search_path = '' as $$
declare v_document jsonb; v_org uuid;
begin
  v_org := public.plan_progress_authorize(p_plan_id,p_source_ref);
  select document into v_document from public.site_plan_progress
    where plan_id = p_plan_id and source_hash = md5(p_source_ref) and organization_id = v_org and source_ref = p_source_ref;
  v_document := coalesce(v_document, '{"elements":[],"calibrations":{},"billed":{}}'::jsonb);
  if not public.auth_user_has_permission('canExport') then
    v_document := jsonb_set(v_document, '{elements}', coalesce((select jsonb_agg(el - 'price') from jsonb_array_elements(v_document->'elements') el),'[]'));
    v_document := jsonb_set(v_document, '{billed}', '{}');
  end if;
  v_document := v_document || jsonb_build_object('history',coalesce((select jsonb_agg(jsonb_build_object(
    'id',o.id,'time',o.created_at,'title','Avancement du plan modifié','detail',jsonb_array_length(o.changes)::text || ' modification(s) synchronisée(s)','icon','checkCircle') order by o.created_at)
    from (select id,created_at,changes from public.site_plan_progress_operations where plan_id = p_plan_id and md5(source_ref) = md5(p_source_ref) and source_ref = p_source_ref order by created_at desc limit 80) o),'[]'));
  return v_document;
end $$;

create function public.apply_plan_progress(p_operation_id uuid, p_plan_id text, p_source_ref text, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_document jsonb; v_saved public.site_plan_progress_operations; v_change jsonb;
  v_target text; v_key text; v_old jsonb; v_next jsonb; v_field text; v_index int;
  v_group jsonb; v_company text; v_own_company text; v_plan public.site_plans; v_point jsonb;
  v_editor boolean; v_financial boolean; v_dimension text;
begin
  v_org := public.plan_progress_authorize(p_plan_id,p_source_ref);
  if p_operation_id is null or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 500 or octet_length(p_changes::text) > 1000000 then
    raise exception 'Modification invalide' using errcode = '22023';
  end if;
  -- One lock for both the receipt and workspace: concurrent retries cannot commit twice.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_saved from public.site_plan_progress_operations where id = p_operation_id;
  if found then
    if v_saved.user_id <> auth.uid() or v_saved.plan_id <> p_plan_id or v_saved.source_ref <> p_source_ref or v_saved.changes <> p_changes then
      raise exception 'Identifiant de modification déjà utilisé' using errcode = '22023';
    end if;
    return jsonb_build_object('applied',true,'replayed',true);
  end if;
  select * into v_plan from public.site_plans where id = p_plan_id;
  select company_id into v_own_company from public.organization_memberships
    where user_id = auth.uid() and organization_id = v_org and status = 'active';
  v_editor := public.auth_user_has_permission('canCreate') and public.auth_user_has_permission('canEdit');
  v_financial := v_editor and public.auth_user_has_permission('canExport');
  insert into public.site_plan_progress(plan_id,source_hash,source_ref,organization_id)
    values (p_plan_id,md5(p_source_ref),p_source_ref,v_org) on conflict do nothing;
  select document into v_document from public.site_plan_progress
    where plan_id = p_plan_id and source_hash = md5(p_source_ref) and source_ref = p_source_ref for update;
  if v_document is null then raise exception 'Version du plan invalide' using errcode = '22023'; end if;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_change) is distinct from 'object' or not (v_change ?& array['target','key','before','after']) then
      raise exception 'Modification incomplète' using errcode = '22023';
    end if;
    v_target := v_change->>'target'; v_key := v_change->>'key';
    if v_target not in ('elements','calibrations','billed') or v_key is null or length(v_key) > 600 then
      raise exception 'Champ invalide' using errcode = '22023';
    end if;
    if v_target = 'elements' then
      select (ordinality - 1)::int, value into v_index,v_old from jsonb_array_elements(v_document->'elements') with ordinality where value->>'id' = v_key;
      if v_old is null then
        if v_change->'before' is distinct from 'null'::jsonb or not v_editor then raise exception 'Création non autorisée' using errcode = '42501'; end if;
        v_next := v_change->'after';
      elsif v_change->'after' = 'null'::jsonb then
        if not public.auth_user_has_permission('canDelete') then raise exception 'Suppression non autorisée' using errcode = '42501'; end if;
        if v_change->'before' is distinct from (case when public.auth_user_has_permission('canExport') then v_old else jsonb_set(v_old,'{price}','0') end) then raise exception 'Ouvrage modifié entre-temps. Rechargez le plan.' using errcode = '22023'; end if;
        v_document := jsonb_set(v_document,'{elements}',(v_document->'elements') - v_index); continue;
      else
        if jsonb_typeof(v_change->'after') is distinct from 'object' or jsonb_typeof(v_change->'before') is distinct from 'object' then raise exception 'Modification invalide' using errcode = '22023'; end if;
        for v_field in select jsonb_object_keys(v_change->'after') loop
          if coalesce(v_old->v_field,'null') is distinct from coalesce(v_change->'before'->v_field,'null') then
            raise exception 'Ouvrage modifié entre-temps. Rechargez le plan.' using errcode = '22023';
          end if;
        end loop;
        if not v_editor and (not public.auth_user_has_permission('canEditOwn') or v_old->>'status' = 'checked' or
          (v_old->>'lotId')::jsonb->>0 is distinct from v_own_company or
          exists (select 1 from jsonb_object_keys(v_change->'after') f where f not in ('status','note'))) then
          raise exception 'Modification non autorisée' using errcode = '42501';
        end if;
        v_next := v_old || (v_change->'after');
      end if;
      if jsonb_typeof(v_next) is distinct from 'object' or v_next->>'id' is distinct from v_key or v_next->>'docId' is distinct from p_plan_id or
        exists(select 1 from unnest(array['id','docId','kind','name','lotId','status']) f where jsonb_typeof(v_next->f) is distinct from 'string') or
        coalesce(v_next->>'kind','') not in ('point','line','area') or coalesce(v_next->>'status','') not in ('todo','progress','installed','checked') or
        length(coalesce(v_next->>'name','')) not between 1 and 120 or length(coalesce(v_next->>'note','')) > 4000 or
        jsonb_typeof(v_next->'page') is distinct from 'number' or coalesce((v_next->>'page')::int,0) not between 1 and 2000 or jsonb_typeof(v_next->'points') is distinct from 'array' then
        raise exception 'Ouvrage invalide' using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_object_keys(v_next) f where f not in ('id','docId','page','lotId','kind','name','reference','room','points','price','status','note','dimensions','priceBasis')) then raise exception 'Champ d’ouvrage inconnu' using errcode = '22023'; end if;
      if jsonb_array_length(v_next->'points') not between (case v_next->>'kind' when 'point' then 1 when 'line' then 2 else 3 end) and 1000 or
        (v_next->>'kind' = 'point' and jsonb_array_length(v_next->'points') <> 1) then raise exception 'Tracé invalide' using errcode = '22023'; end if;
      for v_point in select value from jsonb_array_elements(v_next->'points') loop
        if jsonb_typeof(v_point->'x') is distinct from 'number' or jsonb_typeof(v_point->'y') is distinct from 'number' or
          (v_point->>'x')::numeric not between 0 and 1000 or (v_point->>'y')::numeric not between 0 and 100000 then raise exception 'Point invalide' using errcode = '22023'; end if;
      end loop;
      v_group := (v_next->>'lotId')::jsonb; v_company := v_group->>0;
      if jsonb_typeof(v_group) is distinct from 'array' or jsonb_array_length(v_group) <> 2 or not exists(select 1 from public.companies where id = v_company and organization_id = v_org) or
        (v_group->>1 is not null and not exists(select 1 from public.lots where id = v_group->>1 and organization_id = v_org and company_id = v_company and (chantier_id is null or chantier_id = v_plan.chantier_id))) then
        raise exception 'Entreprise ou lot inaccessible' using errcode = '42501';
      end if;
      if v_next->>'status' = 'checked' and not v_editor then raise exception 'Contrôle non autorisé' using errcode = '42501'; end if;
      if coalesce(v_next->'price','0') is distinct from coalesce(v_old->'price','0') and not v_financial then raise exception 'Prix non autorisé' using errcode = '42501'; end if;
      if coalesce(jsonb_typeof(v_next->'price'),'number') <> 'number' or coalesce((v_next->>'price')::numeric,0) not between 0 and 1000000 then raise exception 'Prix invalide' using errcode = '22023'; end if;
      if v_next ? 'dimensions' and v_next->'dimensions' <> 'null'::jsonb then
        if jsonb_typeof(v_next->'dimensions') <> 'object' then raise exception 'Dimensions invalides' using errcode = '22023'; end if;
        for v_dimension in select jsonb_object_keys(v_next->'dimensions') loop
          if v_dimension in ('widthM','heightM','thicknessM') then
            if v_next->'dimensions'->v_dimension <> 'null'::jsonb and (jsonb_typeof(v_next->'dimensions'->v_dimension) <> 'number' or (v_next->'dimensions'->>v_dimension)::numeric not between 0.000000001 and 10000) then raise exception 'Dimension invalide' using errcode = '22023'; end if;
          elsif v_dimension = 'profile' then
            if v_next->'dimensions'->>v_dimension not in ('rect','round') then raise exception 'Section invalide' using errcode = '22023'; end if;
          elsif v_dimension = 'displayUnit' then
            if v_next->'dimensions'->>v_dimension not in ('mm','cm','m') then raise exception 'Unité invalide' using errcode = '22023'; end if;
          else raise exception 'Dimension inconnue' using errcode = '22023'; end if;
        end loop;
      end if;
      if coalesce(v_next->>'priceBasis',case v_next->>'kind' when 'point' then 'unit' when 'line' then 'linear' else 'area' end) <> all(case v_next->>'kind' when 'point' then array['unit'] when 'line' then array['linear','footprint','wall','volume'] else array['area','volume'] end) then raise exception 'Calcul de prix invalide' using errcode = '22023'; end if;
      if v_index is null then v_document := jsonb_set(v_document,'{elements}',(v_document->'elements') || jsonb_build_array(v_next));
      else v_document := jsonb_set(v_document,array['elements',v_index::text],v_next); end if;
    else
      if not v_editor or (v_target = 'billed' and not v_financial) then raise exception 'Modification non autorisée' using errcode = '42501'; end if;
      if left(v_key,length(p_plan_id)+1) <> p_plan_id || ':' then raise exception 'Page invalide' using errcode = '22023'; end if;
      if coalesce(v_document->v_target->v_key,'null') is distinct from v_change->'before' then raise exception 'Valeur modifiée entre-temps. Rechargez le plan.' using errcode = '22023'; end if;
      if v_change->'after' = 'null'::jsonb then v_document := jsonb_set(v_document,array[v_target],(v_document->v_target) - v_key);
      else
        if jsonb_typeof(v_change->'after') <> 'number' or (v_change->>'after')::numeric not between 0 and 1000000000 or (v_target = 'calibrations' and (v_change->>'after')::numeric <= 0) then raise exception 'Valeur invalide' using errcode = '22023'; end if;
        v_document := jsonb_set(v_document,array[v_target,v_key],v_change->'after');
      end if;
    end if;
    v_index := null; v_old := null;
  end loop;
  if jsonb_array_length(v_document->'elements') > 10000 or octet_length(v_document::text) > 10000000 then raise exception 'Capacité du plan atteinte' using errcode = '22023'; end if;
  update public.site_plan_progress set document = v_document, updated_at = now() where plan_id = p_plan_id and source_hash = md5(p_source_ref);
  insert into public.site_plan_progress_operations(id,user_id,plan_id,source_ref,changes) values(p_operation_id,auth.uid(),p_plan_id,p_source_ref,p_changes);
  return jsonb_build_object('applied',true,'replayed',false);
end $$;
revoke all on function public.read_plan_progress(text,text), public.apply_plan_progress(uuid,text,text,jsonb) from public, anon;
grant execute on function public.read_plan_progress(text,text), public.apply_plan_progress(uuid,text,text,jsonb) to authenticated;
notify pgrst, 'reload schema';
