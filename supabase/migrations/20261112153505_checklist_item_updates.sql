-- Lock the current row and replace one checkbox only. RLS and table triggers
-- continue to authorize the caller; no elevated privileges or snapshot writes.
create or replace function public.set_checklist_item_checked(
  p_checklist_id text, p_item_id text, p_checked boolean
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.checklists;
  v_index integer;
  v_matches integer;
  v_items jsonb;
begin
  if auth.uid() is null or coalesce(public.auth_user_role(), '') not in ('super_admin','admin','conducteur','chef_equipe') then
    raise exception 'Session requise' using errcode = '42501';
  end if;
  if nullif(p_checklist_id, '') is null or nullif(p_item_id, '') is null or p_checked is null then
    raise exception 'Point de checklist invalide' using errcode = '22023';
  end if;
  select * into v_row from public.checklists where id = p_checklist_id for update;
  if not found then
    raise exception 'Checklist inaccessible ou supprimée' using errcode = '42501';
  end if;
  if jsonb_typeof(v_row.items) is distinct from 'array' then
    raise exception 'Points de checklist invalides' using errcode = '22023';
  end if;
  select min(ordinality)::integer - 1, count(*) into v_index, v_matches
    from jsonb_array_elements(v_row.items) with ordinality as points(item, ordinality)
    where item->>'id' = p_item_id;
  if v_matches <> 1 then
    raise exception 'Point de checklist introuvable ou ambigu' using errcode = '22023';
  end if;
  v_items := jsonb_set(v_row.items, array[v_index::text, 'done'], to_jsonb(p_checked), true);
  -- Always perform the UPDATE: a read-only caller must not get a fake success
  -- even when the checkbox already has the requested value.
  update public.checklists set items = v_items, updated_at = clock_timestamp()
    where id = p_checklist_id returning * into v_row;
  if not found then
    raise exception 'Modification de checklist interdite' using errcode = '42501';
  end if;
  return jsonb_build_object('applied', true, 'id', v_row.id, 'items', v_row.items);
end $$;
revoke all on function public.set_checklist_item_checked(text, text, boolean) from public, anon;
grant execute on function public.set_checklist_item_checked(text, text, boolean) to authenticated;
