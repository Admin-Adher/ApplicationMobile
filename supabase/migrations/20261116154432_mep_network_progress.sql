-- MEP metadata travels through the existing durable, idempotent progress queue.
-- Tables stay RPC-only; no new domain client grants or cross-tenant access.
create schema if not exists private;
create table public.site_mep_notifications (
  operation_id uuid not null,
  blocker_id uuid not null,
  recipient_id uuid not null references auth.users(id),
  organization_id uuid not null,
  plan_id text not null,
  status text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  primary key(operation_id,blocker_id,recipient_id),
  foreign key(organization_id,plan_id) references public.site_plans(organization_id,id)
);
create index site_mep_notifications_recipient_idx on public.site_mep_notifications(recipient_id,organization_id,created_at desc);
create index site_mep_notifications_plan_idx on public.site_mep_notifications(organization_id,plan_id);
alter table public.site_mep_notifications enable row level security;
revoke all on public.site_mep_notifications from public,anon,authenticated;

create function private.validate_mep_work(p_next jsonb,p_old jsonb,p_org uuid,p_chantier text,p_plan text,p_operation uuid)
returns void language plpgsql set search_path='' as $$
declare m jsonb; b jsonb; old_b jsonb; photo jsonb; asset uuid; recipient uuid; v_editor boolean; v_own_company text; r jsonb; previous_end numeric:=0; range_sum numeric:=0; expected numeric;
begin
  v_editor:=public.auth_user_has_permission('canCreate') and public.auth_user_has_permission('canEdit');
  select company_id into v_own_company from public.organization_memberships where user_id=auth.uid() and organization_id=p_org and status='active';
  m:=p_next->'mep';
  if m is not null and m<>'null'::jsonb then
    if jsonb_typeof(m)<>'object' or not(m ?& array['discipline','network','subnetwork','zone','quantityMode','plannedQuantity','unit','weight']) or
      exists(select 1 from jsonb_object_keys(m) k where k not in ('discipline','network','subnetwork','zone','quantityMode','plannedQuantity','unit','weight')) or
      coalesce(m->>'discipline','') not in ('plumbing','hvac','cfo','cfa','sprinkler','other') or
      coalesce(m->>'quantityMode','') not in ('drawing','manual','estimate') or coalesce(m->>'unit','') not in ('m','u','m²','m³') or
      jsonb_typeof(m->'weight') is distinct from 'number' or (m->>'weight')::numeric not between 0.000000001 and 1000000000 or
      exists(select 1 from unnest(array['network','subnetwork','zone']) f where jsonb_typeof(m->f) is distinct from 'string' or length(m->>f)>120) or
      length(btrim(m->>'network'))=0 then raise exception 'Réseau MEP invalide' using errcode='22023'; end if;
    if (m->'plannedQuantity'<>'null'::jsonb and (jsonb_typeof(m->'plannedQuantity') is distinct from 'number' or (m->>'plannedQuantity')::numeric not between 0.000000001 and 1000000000)) or
      (m->>'quantityMode'='manual' and m->'plannedQuantity'='null'::jsonb) then raise exception 'Quantité MEP prévue invalide' using errcode='22023'; end if;
    if m->>'quantityMode'='drawing' and m->>'unit' is distinct from (case p_next->>'kind' when 'point' then 'u' when 'line' then 'm' else 'm²' end) then
      raise exception 'Unité du métrage MEP incompatible avec le tracé' using errcode='22023'; end if;
  end if;
  if p_next ? 'room' and (jsonb_typeof(p_next->'room') is distinct from 'string' or length(p_next->>'room')>120) then raise exception 'Local invalide' using errcode='22023'; end if;
  if p_next ? 'executedRanges' and p_next->'executedRanges'<>'null'::jsonb then
    if p_next->>'kind'<>'line' or m is null or m='null'::jsonb or jsonb_typeof(p_next->'executedRanges') is distinct from 'array' or jsonb_array_length(p_next->'executedRanges')>100 then raise exception 'Portions exécutées invalides' using errcode='22023'; end if;
    for r in select value from jsonb_array_elements(p_next->'executedRanges') loop
      if jsonb_typeof(r)<>'array' or jsonb_array_length(r)<>2 or jsonb_typeof(r->0) is distinct from 'number' or jsonb_typeof(r->1) is distinct from 'number' or
        (r->>0)::numeric<previous_end or (r->>0)::numeric<0 or (r->>1)::numeric>1 or (r->>0)::numeric>=(r->>1)::numeric then raise exception 'Portions exécutées invalides' using errcode='22023'; end if;
      range_sum:=range_sum+(r->>1)::numeric-(r->>0)::numeric;previous_end:=(r->>1)::numeric;
    end loop;
    expected:=case p_next->>'status' when 'todo' then 0 when 'progress' then coalesce(nullif(p_next->>'progressPercent','')::numeric,50)/100 else 1 end;
    if abs(range_sum-expected)>0.00000001 or (p_next->'progressPercent'<>'null'::jsonb and p_next->>'status'<>'progress' and abs((p_next->>'progressPercent')::numeric/100-expected)>0.00000001) then raise exception 'Le pourcentage doit correspondre aux portions exécutées.' using errcode='22023'; end if;
  end if;
  if p_next ? 'blockers' then
    if jsonb_typeof(p_next->'blockers') is distinct from 'array' or jsonb_array_length(p_next->'blockers')>100 then raise exception 'Points bloquants invalides' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(p_next->'blockers') x group by x->>'id' having count(*)>1) then raise exception 'Points bloquants dupliqués' using errcode='22023'; end if;
  end if;
  -- Closed markers are retained. Undo/replacement cannot erase the audit trail.
  if exists(select 1 from jsonb_array_elements(coalesce(p_old->'blockers','[]')) old where not exists(select 1 from jsonb_array_elements(coalesce(p_next->'blockers','[]')) new where old->>'id'=new->>'id')) then
    raise exception 'Un point bloquant doit être clôturé, pas supprimé.' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(p_next->'blockers','[]'))>0 and (m is null or m='null'::jsonb) then raise exception 'Conservez le réseau MEP des points bloquants, y compris clos.' using errcode='22023'; end if;
  for b in select value from jsonb_array_elements(coalesce(p_next->'blockers','[]')) loop
    if jsonb_typeof(b) is distinct from 'object' or not(b ?& array['id','point','description','photoRefs','companyId','responsibleId','dueDate','openedAt','status','blocksProgress','priority']) or
      exists(select 1 from jsonb_object_keys(b) k where k not in ('id','point','description','photoRefs','companyId','responsibleId','dueDate','openedAt','status','blocksProgress','priority')) or
      coalesce(b->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or
      jsonb_typeof(b->'description') is distinct from 'string' or length(btrim(b->>'description')) not between 1 and 4000 or
      jsonb_typeof(b->'photoRefs') is distinct from 'array' or jsonb_array_length(b->'photoRefs') not between 1 and 10 or
      jsonb_typeof(b->'point') is distinct from 'object' or jsonb_typeof(b->'point'->'x') is distinct from 'number' or jsonb_typeof(b->'point'->'y') is distinct from 'number' or
      (b->'point'->>'x')::numeric not between 0 and 1000 or (b->'point'->>'y')::numeric not between 0 and 100000 or
      jsonb_typeof(b->'blocksProgress') is distinct from 'boolean' or coalesce(b->>'status','') not in ('open','assigned','in_progress','resolved','closed') or
      coalesce(b->>'priority','') not in ('normal','high','critical') or jsonb_typeof(b->'companyId') is distinct from 'string' or
      not exists(select 1 from public.companies c where c.id=b->>'companyId' and c.organization_id=p_org) or
      not exists(select 1 from public.site_plans p where p.id=p_plan and length(coalesce(to_jsonb(p)->>'building',''))>0) or
      length(btrim(coalesce(nullif(btrim(m->>'zone'),''),nullif(p_next->>'room',''),'')))=0 then raise exception 'Renseignez bâtiment, zone, description, photo et entreprise du point bloquant.' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(b->'photoRefs') ref group by ref having count(*)>1) then raise exception 'Photos dupliquées' using errcode='22023'; end if;
    if exists(select 1 from public.chantiers c where c.id=p_chantier and c.organization_id=p_org and jsonb_typeof(to_jsonb(c)->'company_ids')='array' and
      jsonb_array_length(to_jsonb(c)->'company_ids')>0 and not((to_jsonb(c)->'company_ids') @> jsonb_build_array(b->>'companyId'))) then raise exception 'Entreprise absente du chantier' using errcode='42501'; end if;
    if b->'dueDate'<>'null'::jsonb then
      if jsonb_typeof(b->'dueDate')<>'string' or b->>'dueDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Échéance invalide' using errcode='22023'; end if;
      perform (b->>'dueDate')::date;
    end if;
    if jsonb_typeof(b->'openedAt') is distinct from 'string' or b->>'openedAt' !~ '^\d{4}-\d{2}-\d{2}T' then raise exception 'Date d’ouverture invalide' using errcode='22023'; end if;
    perform (b->>'openedAt')::timestamptz;
    select value into old_b from jsonb_array_elements(coalesce(p_old->'blockers','[]')) where value->>'id'=b->>'id';
    if not v_editor and b is distinct from old_b then
      if old_b is null or not public.auth_user_has_permission('canEditOwn') or p_old->>'status'='checked' or
        (old_b->>'responsibleId' is distinct from auth.uid()::text and not(old_b->'responsibleId'='null'::jsonb and old_b->>'companyId'=v_own_company)) or
        b->>'status'='closed' or old_b->>'status'='closed' or
        (b-'status'-'photoRefs') is distinct from (old_b-'status'-'photoRefs') or
        not((b->'photoRefs') @> (old_b->'photoRefs')) then raise exception 'Traitement du point bloquant non autorisé' using errcode='42501'; end if;
    end if;
    if old_b is not null and b->'openedAt' is distinct from old_b->'openedAt' then raise exception 'La date d’ouverture est conservée.' using errcode='22023'; end if;
    if b->>'status'='closed' and coalesce(old_b->>'status','') not in ('resolved','closed') then raise exception 'Résolvez le point avant sa vérification et clôture.' using errcode='22023'; end if;
    recipient:=null;
    if b->'responsibleId'<>'null'::jsonb then
      if jsonb_typeof(b->'responsibleId')<>'string' or b->>'responsibleId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Responsable invalide' using errcode='22023'; end if;
      recipient:=(b->>'responsibleId')::uuid;
      if not exists(select 1 from public.organization_memberships om where om.user_id=recipient and om.organization_id=p_org and om.status='active' and om.company_id=b->>'companyId') then raise exception 'Responsable inaccessible ou entreprise différente' using errcode='42501'; end if;
    end if;
    for photo in select value from jsonb_array_elements(b->'photoRefs') loop
      if jsonb_typeof(photo)<>'string' or photo#>>'{}' !~ '^btmedia://[0-9a-fA-F-]{36}$' then raise exception 'Référence photo privée invalide' using errcode='22023'; end if;
      asset:=substring(photo#>>'{}' from 11)::uuid;
      if not exists(select 1 from public.tenant_media_objects a where a.id=asset and a.organization_id=p_org and a.bucket='photos' and a.status='ready' and a.deleted_at is null and
        (a.owner_user_id=auth.uid() or exists(select 1 from public.tenant_media_links l where l.asset_id=a.id and l.organization_id=p_org and l.resource_type='site_plans' and l.resource_id=p_plan))) then
        raise exception 'Photo inaccessible ou non synchronisée' using errcode='42501'; end if;
      insert into public.tenant_media_links(organization_id,asset_id,resource_type,resource_id,slot,created_by)
        values(p_org,asset,'site_plans',p_plan,'mep:'||(b->>'id'),auth.uid()) on conflict do nothing;
    end loop;
    if recipient is not null and (old_b is null or b->'status' is distinct from old_b->'status' or b->'responsibleId' is distinct from old_b->'responsibleId') then
      insert into public.site_mep_notifications(operation_id,blocker_id,recipient_id,organization_id,plan_id,status)
        values(p_operation,(b->>'id')::uuid,recipient,p_org,p_plan,b->>'status') on conflict do nothing;
    end if;
  end loop;
  if p_next->>'status'='checked' and exists(select 1 from jsonb_array_elements(coalesce(p_next->'blockers','[]')) marker where (marker->>'blocksProgress')::boolean and marker->>'status' not in ('resolved','closed')) then
    raise exception 'Le tronçon comporte un blocage actif. Résolvez-le avant le contrôle.' using errcode='22023'; end if;
end $$;
revoke all on function private.validate_mep_work(jsonb,jsonb,uuid,text,text,uuid) from public,anon,authenticated;

-- Optional percentages preserve legacy 50% in-progress works, permissions,
-- field-level concurrency checks, receipts and financial redaction.
create or replace function public.apply_plan_progress(p_operation_id uuid, p_plan_id text, p_source_ref text, p_changes jsonb)
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
        if coalesce(jsonb_array_length(v_old->'blockers'),0)>0 then raise exception 'Conservez les ouvrages portant des points bloquants et leur historique.' using errcode='22023'; end if;
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
          exists (select 1 from jsonb_object_keys(v_change->'after') f where f not in ('status','note','progressPercent','blockers','executedRanges')) or
          ((v_old->>'lotId')::jsonb->>0 is distinct from v_own_company and
            exists(select 1 from jsonb_object_keys(v_change->'after') f where f in ('status','note','progressPercent','executedRanges')))) then
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
      if exists (select 1 from jsonb_object_keys(v_next) f where f not in ('id','docId','page','lotId','kind','name','reference','room','points','price','status','note','dimensions','priceBasis','progressPercent','mep','blockers','executedRanges')) then raise exception 'Champ d’ouvrage inconnu' using errcode = '22023'; end if;
      if jsonb_array_length(v_next->'points') not between (case v_next->>'kind' when 'point' then 1 when 'line' then 2 else 3 end) and 1000 or
        (v_next->>'kind' = 'point' and jsonb_array_length(v_next->'points') <> 1) then raise exception 'Tracé invalide' using errcode = '22023'; end if;
      for v_point in select value from jsonb_array_elements(v_next->'points') loop
        if jsonb_typeof(v_point->'x') is distinct from 'number' or jsonb_typeof(v_point->'y') is distinct from 'number' or
          (v_point->>'x')::numeric not between 0 and 1000 or (v_point->>'y')::numeric not between 0 and 100000 then raise exception 'Point invalide' using errcode = '22023'; end if;
      end loop;
      if v_next ? 'progressPercent' and v_next->'progressPercent' <> 'null'::jsonb then
        if jsonb_typeof(v_next->'progressPercent') <> 'number' or (v_next->>'progressPercent')::numeric not between 0 and 100 then
          raise exception 'Pourcentage d’avancement invalide' using errcode = '22023';
        end if;
      end if;
      perform private.validate_mep_work(v_next,v_old,v_org,v_plan.chantier_id,p_plan_id,p_operation_id);
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
  insert into public.site_plan_progress_operations(id,user_id,plan_id,source_ref,changes,created_at) values(p_operation_id,auth.uid(),p_plan_id,p_source_ref,p_changes,clock_timestamp());
  return jsonb_build_object('applied',true,'replayed',false);
end $$;

revoke all on function public.apply_plan_progress(uuid,text,text,jsonb) from public,anon;
grant execute on function public.apply_plan_progress(uuid,text,text,jsonb) to authenticated;
notify pgrst, 'reload schema';

-- Projection used by both reads: never return financial fields without canExport.
create function private.mep_visible_document(p_document jsonb,p_financial boolean)
returns jsonb language sql immutable set search_path='' as $$
  select case when p_financial then p_document else jsonb_set(jsonb_set(p_document,'{elements}',coalesce((select jsonb_agg(e-'price') from jsonb_array_elements(p_document->'elements') e),'[]')),'{billed}','{}') end
$$;
create function private.mep_visible_changes(p_changes jsonb,p_financial boolean)
returns jsonb language sql immutable set search_path='' as $$
  select case when p_financial then p_changes else coalesce((select jsonb_agg(case when c->>'target'='elements' then
    c || jsonb_build_object('before',case when jsonb_typeof(c->'before')='object' then (c->'before')-'price' else c->'before' end,
                            'after',case when jsonb_typeof(c->'after')='object' then (c->'after')-'price' else c->'after' end) else c end)
    from jsonb_array_elements(p_changes) c where c->>'target'<>'billed'),'[]') end
$$;
revoke all on function private.mep_visible_document(jsonb,boolean),private.mep_visible_changes(jsonb,boolean) from public,anon,authenticated;

create or replace function public.read_plan_progress(p_plan_id text,p_source_ref text)
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare v_document jsonb; v_org uuid; v_history jsonb;
begin
  v_org:=public.plan_progress_authorize(p_plan_id,p_source_ref);
  select document into v_document from public.site_plan_progress where plan_id=p_plan_id and source_hash=md5(p_source_ref) and source_ref=p_source_ref and organization_id=v_org;
  v_document:=private.mep_visible_document(coalesce(v_document,'{"elements":[],"calibrations":{},"billed":{}}'),public.auth_user_has_permission('canExport'));
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'time',o.created_at,'userId',o.user_id,'author',coalesce(p.name,'Membre du chantier'),
      'title','Avancement du plan modifié','detail',jsonb_array_length(o.changes)::text||' modification(s) synchronisée(s)','icon','checkCircle') order by o.created_at),'[]')
    into v_history from (select id,user_id,created_at,changes from public.site_plan_progress_operations where plan_id=p_plan_id and md5(source_ref)=md5(p_source_ref) and source_ref=p_source_ref order by created_at desc,id desc limit 80) o
    left join public.profiles p on p.id=o.user_id;
  return v_document || jsonb_build_object('history',v_history);
end $$;
revoke all on function public.read_plan_progress(text,text) from public,anon;
grant execute on function public.read_plan_progress(text,text) to authenticated;

create function public.read_project_mep(p_plan_id text,p_source_ref text)
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare v_org uuid; v_chantier text; v_plans jsonb; v_history jsonb; v_notifications jsonb; v_total bigint; v_included bigint; v_history_total bigint; v_financial boolean; v_history_reliable boolean;
begin
  v_org:=public.plan_progress_authorize(p_plan_id,p_source_ref);
  select chantier_id into v_chantier from public.site_plans where id=p_plan_id and organization_id=v_org;
  v_financial:=public.auth_user_has_permission('canExport');
  -- Only current PDF revisions from the authorised chantier. Aggregate once, not
  -- one RPC per plan. A cumulative size budget bounds even exceptionally large plans.
  with eligible as (
    select p.id,p.uri,to_jsonb(p) meta,coalesce(s.document,'{"elements":[],"calibrations":{},"billed":{}}') document,s.updated_at
    from public.site_plans p left join public.site_plan_progress s on s.organization_id=p.organization_id and s.plan_id=p.id and s.source_hash=md5(p.uri) and s.source_ref=p.uri
    where p.organization_id=v_org and p.chantier_id=v_chantier and to_jsonb(p)->>'deleted_at' is null and to_jsonb(p)->>'file_deleted_at' is null
      and coalesce(to_jsonb(p)->>'is_latest_revision','true')='true' and p.replaced_by_plan_id is null and coalesce(to_jsonb(p)->>'file_type','pdf') in ('pdf','application/pdf') and nullif(p.uri,'') is not null
  ), budget as (
    select *,row_number()over(order by id) n,sum(octet_length(document::text))over(order by id) bytes from eligible
  ), included as (select * from budget where n<=500 and bytes<=20000000)
  select (select count(*) from eligible),count(*),coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(meta->>'name',id),'building',coalesce(meta->>'building',''),
    'level',coalesce(meta->>'level',''),'revision',coalesce(meta->>'revision_code',meta->>'revision_number',''),'sourceRef',uri,'updatedAt',updated_at,
    'document',private.mep_visible_document(document,v_financial)) order by id),'[]') into v_total,v_included,v_plans from included;
  -- Expose changes only for the exact included file revisions. This lets clients
  -- reconstruct comparisons without mixing superseded sheets or leaking prices.
  select count(*) into v_history_total from public.site_plan_progress_operations o join jsonb_array_elements(v_plans) p on p->>'id'=o.plan_id and p->>'sourceRef'=o.source_ref;
  select not exists(select 1 from public.site_plan_progress_operations o join jsonb_array_elements(v_plans) p on p->>'id'=o.plan_id and p->>'sourceRef'=o.source_ref group by o.plan_id,o.source_ref,o.created_at having count(*)>1) into v_history_reliable;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'planId',o.plan_id,'sourceRef',o.source_ref,'time',o.created_at,'userId',o.user_id,'author',coalesce(p.name,'Membre du chantier'),
    'changes',private.mep_visible_changes(o.changes,v_financial)) order by o.created_at,o.id),'[]') into v_history from (
      select * from (select o.*,row_number()over(order by o.created_at desc,o.id desc) history_n,sum(octet_length(o.changes::text))over(order by o.created_at desc,o.id desc) history_bytes from public.site_plan_progress_operations o join jsonb_array_elements(v_plans) p on p->>'id'=o.plan_id and p->>'sourceRef'=o.source_ref) budget where history_n<=5000 and history_bytes<=8000000 order by created_at desc,id desc
    ) o left join public.profiles p on p.id=o.user_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',n.operation_id::text||':'||n.blocker_id::text,'planId',n.plan_id,'blockerId',n.blocker_id,'status',n.status,'createdAt',n.created_at,'readAt',n.read_at) order by n.created_at desc),'[]')
    into v_notifications from (select n.* from public.site_mep_notifications n join public.site_plans p on p.id=n.plan_id and p.organization_id=n.organization_id
      where n.organization_id=v_org and p.chantier_id=v_chantier and n.recipient_id=auth.uid() order by n.created_at desc limit 100) n;
  return jsonb_build_object('plans',v_plans,'history',v_history,'notifications',v_notifications,'generatedAt',now(),'truncated',v_included<v_total,'historyTruncated',v_history_total>jsonb_array_length(v_history),'historyOrderingReliable',v_history_reliable,'totalPlans',v_total);
end $$;
revoke all on function public.read_project_mep(text,text) from public,anon;
grant execute on function public.read_project_mep(text,text) to authenticated;

create function public.mark_mep_notifications_read(p_plan_id text,p_source_ref text)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_chantier text;
begin
  v_org:=public.plan_progress_authorize(p_plan_id,p_source_ref);
  select chantier_id into v_chantier from public.site_plans where id=p_plan_id and organization_id=v_org;
  update public.site_mep_notifications n set read_at=now() where n.organization_id=v_org and n.recipient_id=auth.uid() and n.read_at is null
    and exists(select 1 from public.site_plans p where p.id=n.plan_id and p.organization_id=v_org and p.chantier_id=v_chantier);
end $$;
revoke all on function public.mark_mep_notifications_read(text,text) from public,anon;
grant execute on function public.mark_mep_notifications_read(text,text) to authenticated;
notify pgrst,'reload schema';
