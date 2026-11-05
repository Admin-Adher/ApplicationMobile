create trigger sync_media_resource_links
  after insert or delete on public.journal_entries
  for each row execute function private.sync_media_resource_links();

create trigger sync_media_resource_links_on_change
  after update on public.journal_entries
  for each row when (old.photo_uri is distinct from new.photo_uri or old.organization_id is distinct from new.organization_id)
  execute function private.sync_media_resource_links();

insert into public.tenant_media_links (organization_id, asset_id, resource_type, resource_id, slot)
select j.organization_id, a.id, 'journal_entries', j.id::text, 'auto'
from public.journal_entries j
join public.tenant_media_objects a on a.organization_id = j.organization_id
  and (j.photo_uri = 'btmedia://' || a.id::text or j.photo_uri = a.legacy_url)
  and a.status in ('ready', 'legacy')
where j.photo_uri is not null
on conflict (asset_id, resource_type, resource_id, slot) do nothing;
