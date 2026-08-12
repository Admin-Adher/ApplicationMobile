-- One production DM was created twice before UUID membership existed:
-- `dm-Balbino__Medhi` (empty/incomplete) and `dm-Balbino__Mehdi` (complete).
-- Reconcile the empty alias only when all immutable evidence still matches.
-- If production data has drifted, the migration deliberately fails closed.

do $$
declare
  v_organization_id uuid;
  v_creator_id uuid;
  v_counterpart_id uuid;
  v_old_members integer;
  v_canonical_members integer;
  v_old_messages integer;
  v_candidate_count integer;
begin
  select c.organization_id, c.created_by_user_id
  into v_organization_id, v_creator_id
  from public.channels c
  where c.id = 'dm-Balbino__Medhi'
    and c.type = 'dm';

  if not found then
    return;
  end if;

  select count(*) into v_old_messages
  from public.messages m
  where m.organization_id = v_organization_id
    and m.channel_id = 'dm-Balbino__Medhi';

  select count(*) into v_old_members
  from public.channel_members cm
  where cm.organization_id = v_organization_id
    and cm.channel_id = 'dm-Balbino__Medhi'
    and cm.status = 'active';

  select count(*) into v_canonical_members
  from public.channel_members cm
  join public.channels canonical
    on canonical.organization_id = cm.organization_id
   and canonical.id = cm.channel_id
  where canonical.organization_id = v_organization_id
    and canonical.id = 'dm-Balbino__Mehdi'
    and canonical.type = 'dm'
    and canonical.created_by_user_id = v_creator_id
    and cm.status = 'active';

  select count(*), (array_agg(cm.user_id order by cm.user_id::text))[1]
  into v_candidate_count, v_counterpart_id
  from public.channel_members cm
  where cm.organization_id = v_organization_id
    and cm.channel_id = 'dm-Balbino__Mehdi'
    and cm.status = 'active'
    and cm.user_id <> v_creator_id;

  if v_creator_id is null
     or v_old_messages <> 0
     or v_old_members <> 1
     or v_canonical_members <> 2
     or v_candidate_count <> 1
     or not exists (
       select 1 from public.channel_members cm
       where cm.organization_id = v_organization_id
         and cm.channel_id = 'dm-Balbino__Medhi'
         and cm.user_id = v_creator_id
         and cm.status = 'active'
     ) then
    raise exception 'Legacy DM alias evidence changed; manual reconciliation required'
      using errcode = '23514';
  end if;

  insert into public.channel_members(
    organization_id, channel_id, user_id, status, joined_at, added_by
  ) values (
    v_organization_id, 'dm-Balbino__Medhi', v_counterpart_id,
    'active', now(), null
  )
  on conflict (organization_id, channel_id, user_id) do update
  set status = 'active';
end
$$;
