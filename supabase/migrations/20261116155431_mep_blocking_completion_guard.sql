-- Prevent complete installation as well as control while a blocking obstacle is active.
-- Keep all existing validation, permissions, proof authorisation and notifications.
create or replace function private.validate_mep_work(p_next jsonb,p_old jsonb,p_org uuid,p_chantier text,p_plan text,p_operation uuid)
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
  if (p_next->>'status' in ('installed','checked') or (p_next->>'status'='progress' and coalesce((p_next->>'progressPercent')::numeric,50)>=100)) and exists(select 1 from jsonb_array_elements(coalesce(p_next->'blockers','[]')) marker where (marker->>'blocksProgress')::boolean and marker->>'status' not in ('resolved','closed')) then
    raise exception 'Le tronçon comporte un blocage actif. Résolvez-le avant le contrôle.' using errcode='22023'; end if;
end $$;

revoke all on function private.validate_mep_work(jsonb,jsonb,uuid,text,text,uuid) from public,anon,authenticated;
