-- Receipts are not a client-editable API. They make a lost-response replay a
-- no-op even when a later operation has changed the same field again.
create table private.terrain_operation_receipts (
  id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  entity_id text not null,
  fingerprint text not null,
  applied_at timestamptz not null default now()
);
alter table private.terrain_operation_receipts enable row level security;
revoke all on private.terrain_operation_receipts from public, anon, authenticated;
create index terrain_operation_receipts_actor_idx on private.terrain_operation_receipts(actor_id);
create index terrain_operation_receipts_org_idx on private.terrain_operation_receipts(organization_id);

create function private.apply_terrain_patch(p_operation_id uuid, p_table text, p_id text, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_org uuid; v_row jsonb; v_next jsonb; v_change jsonb;
  v_target text; v_key text; v_field text; v_index integer; v_count integer; v_items jsonb; v_item jsonb;
  v_hash text; v_receipt private.terrain_operation_receipts; v_visit public.visites; v_opr public.oprs;
  v_result jsonb; v_reserves jsonb := '[]'; v_collections text[]; v_allowed text[];
begin
  if v_actor is null or not public.auth_user_has_permission('canEdit') then
    raise exception 'Modification terrain non autorisée' using errcode='42501';
  end if;
  if p_operation_id is null or nullif(p_id,'') is null or p_table is null or p_table not in ('visites','oprs')
    or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 2000
    or octet_length(p_changes::text)>2097152 then
    raise exception 'Modification terrain invalide' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('terrain:'||p_operation_id::text,0));
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_table,p_id,p_changes)::text,'UTF8')),'hex');
  select * into v_receipt from private.terrain_operation_receipts where id=p_operation_id;
  if found and (v_receipt.actor_id<>v_actor or v_receipt.fingerprint<>v_hash or v_receipt.kind<>p_table or v_receipt.entity_id<>p_id) then
    raise exception 'Identifiant de modification déjà utilisé' using errcode='22023';
  end if;
  if p_table='visites' then
    select * into v_visit from public.visites where id=p_id for update;
    v_row:=to_jsonb(v_visit); v_org:=v_visit.organization_id;
    v_collections:=array['checklist_items','participants'];
    v_allowed:=array['title','date','start_time','end_time','conducteur','status','visit_type','concerned_company_ids',
      'visited_locations','building','level','zone','notes','tags','cover_photo_uri','default_plan_id',
      'checklist_items','reserve_deadline_date','conducteur_signature','entreprise_signature','signed_at','entreprise_signataire','participants'];
  else
    select * into v_opr from public.oprs where id=p_id for update;
    v_row:=to_jsonb(v_opr); v_org:=v_opr.organization_id;
    v_collections:=array['items','visit_participants','signatories'];
    v_allowed:=array['title','date','building','level','zone','conducteur','status','items','signed_by','signed_at',
      'maire_ouvrage','conducteur_signature','mo_signature','visit_contradictoire','visit_participants','signatories','invited_emails','session_token'];
  end if;
  if v_org is null then
    if v_receipt.id is not null and (v_receipt.organization_id=public.auth_user_org() or public.auth_is_platform_admin()) then
      return jsonb_build_object('applied',true,'replayed',true,'row',null,'reserves','[]'::jsonb);
    end if;
    raise exception 'Élément terrain inaccessible ou supprimé' using errcode='42501';
  end if;
  if v_org is distinct from public.auth_user_org() and not public.auth_is_platform_admin() then
    raise exception 'Élément terrain inaccessible' using errcode='42501';
  end if;
  if v_receipt.id is not null then
    return jsonb_build_object('applied',true,'replayed',true,'row',v_row,'reserves','[]'::jsonb);
  end if;
  if p_table='oprs' and v_opr.status='signed' then raise exception 'Ce procès-verbal est signé' using errcode='23514'; end if;
  v_next:=v_row;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_target:=v_change->>'target'; v_key:=v_change->>'key';
    if jsonb_typeof(v_change)<>'object' or not (v_change ? 'before' and v_change ? 'after') or v_target is null or not(v_target=any(v_allowed)) then
      raise exception 'Champ terrain invalide' using errcode='22023';
    end if;
    if v_target=any(v_collections) then
      if nullif(v_key,'') is null then raise exception 'Point de contrôle invalide' using errcode='22023'; end if;
      v_items:=case when jsonb_typeof(v_next->v_target)='array' then v_next->v_target else '[]'::jsonb end;
      select min(ordinality)::integer-1,count(*) into v_index,v_count
        from jsonb_array_elements(v_items) with ordinality x(item,ordinality) where item->>'id'=v_key;
      if v_count>1 then raise exception 'Identifiant de contrôle ambigu' using errcode='22023'; end if;
      v_item:=v_items->v_index;
      if v_change->'before'='null'::jsonb then
        if jsonb_typeof(v_change->'after')<>'object' or v_change->'after'->>'id' is distinct from v_key then raise exception 'Ajout invalide' using errcode='22023'; end if;
        if v_count=1 then
          if not(v_item @> (v_change->'after')) then raise exception 'Point déjà modifié' using errcode='23514'; end if;
        else v_items:=v_items||jsonb_build_array(v_change->'after'); end if;
      elsif v_change->'after'='null'::jsonb then
        if v_count=1 then
          if v_item is distinct from v_change->'before' then raise exception 'Point modifié avant suppression' using errcode='23514'; end if;
          v_items:=v_items-v_index;
        end if;
      else
        if v_count<>1 or jsonb_typeof(v_change->'before')<>'object' or jsonb_typeof(v_change->'after')<>'object' or (v_change->'after') ? 'id' then
          raise exception 'Point modifié ou supprimé. Actualisez la fiche.' using errcode='23514';
        end if;
        for v_field in select jsonb_object_keys(v_change->'after') loop
          if coalesce(v_item->v_field,'null') is distinct from coalesce(v_change->'before'->v_field,'null')
            and coalesce(v_item->v_field,'null') is distinct from coalesce(v_change->'after'->v_field,'null') then
            raise exception 'Ce point a changé. Actualisez la fiche.' using errcode='23514';
          end if;
        end loop;
        v_items:=jsonb_set(v_items,array[v_index::text],v_item||(v_change->'after'));
      end if;
      if v_target='signatories' and v_change->'after'<>'null'::jsonb and (v_change->'after') ? 'signatureSource' then
        raise exception 'Source de signature réservée au serveur' using errcode='42501';
      end if;
      v_next:=jsonb_set(v_next,array[v_target],v_items);
    else
      if v_key is not null then raise exception 'Champ terrain invalide' using errcode='22023'; end if;
      if coalesce(v_next->v_target,'null') is distinct from v_change->'before' and coalesce(v_next->v_target,'null') is distinct from v_change->'after' then
        raise exception 'Ce champ a changé. Actualisez la fiche.' using errcode='23514';
      end if;
      v_next:=jsonb_set(v_next,array[v_target],v_change->'after');
    end if;
  end loop;
  if p_table='visites' then
    v_visit:=jsonb_populate_record(v_visit,v_next);
    if v_visit.status not in ('planned','in_progress','completed') then raise exception 'Statut de visite invalide' using errcode='22023'; end if;
    update public.visites set title=v_visit.title,date=v_visit.date,start_time=v_visit.start_time,end_time=v_visit.end_time,
      conducteur=v_visit.conducteur,status=v_visit.status,visit_type=v_visit.visit_type,concerned_company_ids=v_visit.concerned_company_ids,
      visited_locations=v_visit.visited_locations,building=v_visit.building,level=v_visit.level,zone=v_visit.zone,notes=v_visit.notes,
      tags=v_visit.tags,cover_photo_uri=v_visit.cover_photo_uri,default_plan_id=v_visit.default_plan_id,checklist_items=v_visit.checklist_items,
      reserve_deadline_date=v_visit.reserve_deadline_date,conducteur_signature=v_visit.conducteur_signature,entreprise_signature=v_visit.entreprise_signature,
      signed_at=v_visit.signed_at,entreprise_signataire=v_visit.entreprise_signataire,participants=v_visit.participants
    where id=p_id returning to_jsonb(visites.*) into v_row;
  else
    -- Reuse the existing transaction for linked reserve status/history.
    if v_next->'items' is distinct from v_row->'items' then
      v_result:=public.update_web_opr_items(p_id,v_opr.opr_revision,jsonb_build_object('items',v_next->'items'));
      v_reserves:=v_result->'reserves'; v_row:=v_result->'opr';
    end if;
    if exists(select 1 from jsonb_array_elements(p_changes) c where c->>'target'<>'items') then
      v_opr:=jsonb_populate_record(v_opr,v_next);
      if v_opr.status not in ('draft','in_progress','signed') then raise exception 'Statut OPR invalide' using errcode='22023'; end if;
      update public.oprs set title=v_opr.title,date=v_opr.date,building=v_opr.building,level=v_opr.level,zone=v_opr.zone,conducteur=v_opr.conducteur,
        status=v_opr.status,items=v_opr.items,signed_by=v_opr.signed_by,signed_at=v_opr.signed_at,maire_ouvrage=v_opr.maire_ouvrage,
        conducteur_signature=v_opr.conducteur_signature,mo_signature=v_opr.mo_signature,visit_contradictoire=v_opr.visit_contradictoire,
        visit_participants=v_opr.visit_participants,signatories=v_opr.signatories,invited_emails=v_opr.invited_emails,session_token=v_opr.session_token
      where id=p_id returning to_jsonb(oprs.*) into v_row;
    end if;
  end if;
  insert into private.terrain_operation_receipts(id,actor_id,organization_id,kind,entity_id,fingerprint)
    values(p_operation_id,v_actor,v_org,p_table,p_id,v_hash);
  return jsonb_build_object('applied',true,'row',v_row,'reserves',v_reserves);
end $$;
revoke all on function private.apply_terrain_patch(uuid,text,text,jsonb) from public,anon;
grant execute on function private.apply_terrain_patch(uuid,text,text,jsonb) to authenticated;
create function public.apply_terrain_patch(p_operation_id uuid,p_table text,p_id text,p_changes jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.apply_terrain_patch(p_operation_id,p_table,p_id,p_changes) $$;
revoke all on function public.apply_terrain_patch(uuid,text,text,jsonb) from public,anon;
grant execute on function public.apply_terrain_patch(uuid,text,text,jsonb) to authenticated;

create function private.set_message_reaction(p_operation_id uuid,p_message_id text,p_emoji text,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_message public.messages; v_name text; v_hash text; v_receipt private.terrain_operation_receipts;
begin
  if auth.uid() is null or public.auth_user_org() is null then raise exception 'Session requise' using errcode='42501'; end if;
  if p_operation_id is null or p_active is null or nullif(btrim(p_emoji),'') is null or length(p_emoji)>32 then raise exception 'Réaction invalide' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('terrain:'||p_operation_id::text,0));
  v_hash:=encode(sha256(convert_to(jsonb_build_array(p_message_id,p_emoji,p_active)::text,'UTF8')),'hex');
  select * into v_receipt from private.terrain_operation_receipts where id=p_operation_id;
  if found and (v_receipt.actor_id<>auth.uid() or v_receipt.kind<>'message_reaction' or v_receipt.fingerprint<>v_hash or v_receipt.entity_id<>p_message_id) then
    raise exception 'Identifiant de réaction déjà utilisé' using errcode='22023';
  end if;
  select * into v_message from public.messages where id=p_message_id and organization_id=public.auth_user_org()
    and public.auth_can_access_channel(organization_id,channel_id) for update;
  if not found then raise exception 'Message inaccessible ou supprimé' using errcode='42501'; end if;
  if v_receipt.id is not null then return jsonb_build_object('applied',true,'replayed',true,'id',v_message.id,'reactions',v_message.reactions); end if;
  select name into v_name from public.profiles where id=auth.uid();
  if v_name is null then raise exception 'Profil inaccessible' using errcode='42501'; end if;
  if coalesce((v_message.reactions->p_emoji) @> jsonb_build_array(v_name),false) is distinct from p_active then
    perform public.toggle_message_reaction(p_message_id,p_emoji,v_name);
    select * into v_message from public.messages where id=p_message_id;
  end if;
  insert into private.terrain_operation_receipts(id,actor_id,organization_id,kind,entity_id,fingerprint)
    values(p_operation_id,auth.uid(),v_message.organization_id,'message_reaction',p_message_id,v_hash);
  return jsonb_build_object('applied',true,'id',v_message.id,'reactions',v_message.reactions);
end $$;
revoke all on function private.set_message_reaction(uuid,text,text,boolean) from public,anon;
grant execute on function private.set_message_reaction(uuid,text,text,boolean) to authenticated;
create function public.set_message_reaction(p_operation_id uuid,p_message_id text,p_emoji text,p_active boolean)
returns jsonb language sql security invoker set search_path='' as $$ select private.set_message_reaction(p_operation_id,p_message_id,p_emoji,p_active) $$;
revoke all on function public.set_message_reaction(uuid,text,text,boolean) from public,anon;
grant execute on function public.set_message_reaction(uuid,text,text,boolean) to authenticated;
