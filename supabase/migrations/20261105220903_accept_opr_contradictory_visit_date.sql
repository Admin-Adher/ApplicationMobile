-- Preserve the original field name for existing clients and queued requests.
set local lock_timeout = '5s';

alter table public.oprs
  alter column visit_contradictoire type text
  using visit_contradictoire::text,
  add column opr_revision bigint not null default 0;

create or replace function public.preserve_opr_link_signatures()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  protected_signers jsonb;
  incoming jsonb;
begin
  new.opr_revision := old.opr_revision + 1;
  select jsonb_agg(s) into protected_signers
  from jsonb_array_elements(case when jsonb_typeof(old.signatories) = 'array' then old.signatories else '[]'::jsonb end) s
  where s ->> 'signatureSource' = 'web_link' and s ->> 'signed' = 'true';
  if protected_signers is null then return new; end if;

  if (new.title, new.date, new.building, new.level, new.zone, new.visit_contradictoire, new.items)
      is distinct from (old.title, old.date, old.building, old.level, old.zone, old.visit_contradictoire, old.items) then
    raise exception 'Ce procès-verbal contient déjà une signature par lien.' using errcode = '23514';
  end if;

  incoming := case when jsonb_typeof(new.signatories) = 'array' then new.signatories else '[]'::jsonb end;
  select coalesce(jsonb_agg(coalesce(preserved.signer, candidate.signer) order by candidate.position), '[]'::jsonb)
    into new.signatories
  from jsonb_array_elements(incoming) with ordinality candidate(signer, position)
  left join jsonb_array_elements(protected_signers) preserved(signer)
    on candidate.signer ->> 'id' = preserved.signer ->> 'id';
  select new.signatories || coalesce(jsonb_agg(signer), '[]'::jsonb) into new.signatories
  from jsonb_array_elements(protected_signers) p(signer)
  where not exists (
    select 1 from jsonb_array_elements(incoming) i(item) where item ->> 'id' = signer ->> 'id'
  );

  if old.status = 'signed' then
    new.status := old.status;
    new.signed_at := old.signed_at;
  elsif new.status = 'draft' then
    new.status := 'in_progress';
  end if;
  return new;
end;
$$;

revoke execute on function public.preserve_opr_link_signatures() from public, anon, authenticated;
create trigger opr_revision_and_link_signatures
before update on public.oprs
for each row execute function public.preserve_opr_link_signatures();

notify pgrst, 'reload schema';
