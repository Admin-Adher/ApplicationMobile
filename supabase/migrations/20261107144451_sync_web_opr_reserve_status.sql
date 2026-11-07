-- Keep a lot status and its linked reserve in one transaction, including replay
-- from the browser outbox. Existing reserve RPCs keep the status event history.
create or replace function public.update_web_opr_items(
  p_opr_id text, p_expected_revision bigint, p_fields jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_opr public.oprs%rowtype;
  v_next public.oprs%rowtype;
  v_reserve public.reserves%rowtype;
  v_item jsonb;
  v_old jsonb;
  v_id text;
  v_target text;
  v_operation text;
  v_event jsonb;
  v_result jsonb;
  v_author text;
  v_targets jsonb := '{}'::jsonb;
  v_rows jsonb;
begin
  if auth.uid() is null or not public.auth_user_has_permission('canEdit') then
    raise exception 'Modification OPR non autorisée' using errcode = '42501';
  end if;
  if jsonb_typeof(p_fields) is distinct from 'object'
    or jsonb_typeof(p_fields->'items') is distinct from 'array'
    or exists (select 1 from jsonb_object_keys(p_fields) k where k not in (
      'title','date','building','level','zone','maire_ouvrage',
      'visit_contradictoire','visit_participants','items','signatories'
    )) then
    raise exception 'Champs OPR invalides' using errcode = '22023';
  end if;
  select * into v_opr from public.oprs where id = p_opr_id for update;
  if not found or (v_opr.organization_id is distinct from public.auth_user_org()
    and public.auth_user_role() <> 'super_admin') then
    raise exception 'OPR inaccessible' using errcode = '42501';
  end if;
  if v_opr.opr_revision is distinct from p_expected_revision then
    -- A lost response may cause the exact same outbox write to be replayed.
    if not (to_jsonb(v_opr) @> p_fields) then
      raise exception 'Ce procès-verbal a changé. La saisie reste dans la file.' using errcode = '23514';
    end if;
  else
    if v_opr.status = 'signed' or exists (
      select 1 from jsonb_array_elements(coalesce(v_opr.signatories, '[]'::jsonb)) s
      where s->>'signatureSource' = 'web_link' and s->>'signed' = 'true'
    ) then
      raise exception 'Ce procès-verbal est verrouillé par une signature' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_array_elements(p_fields->'items') i
      where jsonb_typeof(i) <> 'object' or nullif(i->>'id','') is null
        or coalesce(i->>'status','') not in ('ok','reserve','non_applicable'))
      or (select count(*) from jsonb_array_elements(p_fields->'items')) <>
         (select count(distinct i->>'id') from jsonb_array_elements(p_fields->'items') i) then
      raise exception 'Lots OPR invalides' using errcode = '22023';
    end if;
    select coalesce(nullif(name,''),'OPR') into v_author from public.profiles where id = auth.uid();
    v_author := coalesce(v_author, 'OPR');
    for v_item in select value from jsonb_array_elements(p_fields->'items') loop
      v_id := coalesce(nullif(v_item->>'reserveId',''),nullif(v_item->>'reserve_id',''));
      select value into v_old from jsonb_array_elements(coalesce(v_opr.items,'[]'::jsonb))
        where value->>'id' = v_item->>'id' limit 1;
      if v_id is null or v_old is null or v_old->>'status' is not distinct from v_item->>'status'
        or coalesce(nullif(v_old->>'reserveId',''),nullif(v_old->>'reserve_id','')) is distinct from v_id then
        continue;
      end if;
      v_target := case when v_item->>'status' = 'ok' then 'closed'
        when v_old->>'status' = 'ok' and v_item->>'status' = 'reserve' then 'in_progress' else null end;
      if v_target is null then continue; end if;
      if v_targets ? v_id and v_targets->>v_id <> v_target then
        raise exception 'Deux lots demandent des statuts incompatibles pour la même réserve' using errcode = '23514';
      end if;
      v_targets := v_targets || jsonb_build_object(v_id,v_target);
    end loop;
    -- Sort locks so edits touching several reserves acquire them consistently.
    for v_id, v_target in select key,value from jsonb_each_text(v_targets) order by key loop
      select * into v_reserve from public.reserves where id = v_id
        and organization_id = v_opr.organization_id
        and chantier_id is not distinct from v_opr.chantier_id and deleted_at is null for update;
      if not found then
        raise exception 'La réserve liée est inaccessible dans ce chantier' using errcode = '42501';
      end if;
      if v_reserve.status = v_target then continue; end if;
      v_operation := 'web-opr:' || v_opr.id || ':' || (v_opr.opr_revision + 1)::text || ':' || v_id;
      v_event := jsonb_build_object(
        'id',gen_random_uuid()::text,'reserve_id',v_id,'from_status',v_reserve.status,'to_status',v_target,
        'actor_name',v_author,'occurred_at',now(),'reason','Statut modifié via OPR',
        'closed_at',case when v_target = 'closed' then to_char(now() at time zone 'UTC','YYYY-MM-DD') else null end,
        'closed_by',case when v_target = 'closed' then v_author else null end,
        'history_entry',jsonb_build_object('id',v_operation,'action','Statut modifié via OPR',
          'author',v_author,'createdAt',now(),'oldValue',v_reserve.status,'newValue',v_target)
      );
      v_result := public.append_reserve_status_event(v_operation,md5(v_event::text),v_event);
      if v_result->>'status' is distinct from 'ok' then
        raise exception 'Changement de statut de réserve refusé' using errcode = '42501';
      end if;
    end loop;
    v_next := jsonb_populate_record(v_opr,p_fields);
    update public.oprs set title=v_next.title, date=v_next.date, building=v_next.building,
      level=v_next.level, zone=v_next.zone, maire_ouvrage=v_next.maire_ouvrage,
      visit_contradictoire=v_next.visit_contradictoire, visit_participants=v_next.visit_participants,
      items=v_next.items, signatories=v_next.signatories
    where id = v_opr.id returning * into v_opr;
    if not found then
      raise exception 'Modification OPR refusée' using errcode = '42501';
    end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
    from public.reserves r where r.organization_id = v_opr.organization_id
      and r.chantier_id is not distinct from v_opr.chantier_id and r.deleted_at is null
      and exists (select 1 from jsonb_array_elements(coalesce(v_opr.items,'[]'::jsonb)) i
        where coalesce(nullif(i->>'reserveId',''),nullif(i->>'reserve_id','')) = r.id);
  return jsonb_build_object('opr',to_jsonb(v_opr),'reserves',v_rows);
end;
$$;
revoke all on function public.update_web_opr_items(text,bigint,jsonb) from public, anon;
grant execute on function public.update_web_opr_items(text,bigint,jsonb) to authenticated;
