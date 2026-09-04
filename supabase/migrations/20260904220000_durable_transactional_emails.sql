-- Server-only outbox. Addresses and recovery links are encrypted by the app.
-- SMTP acceptance is recorded separately from any claim of inbox delivery.
create table if not exists public.transactional_email_outbox (
  id uuid primary key,
  dedupe_key text not null unique,
  kind text not null check (kind in ('recovery', 'invitation')),
  organization_id uuid references public.organizations(id) on delete set null,
  recipient_hash text not null,
  throttle_hash text not null,
  encrypted_payload text,
  status text not null default 'pending' check (status in ('pending','preparing','sending','accepted','failed','uncertain','suppressed','expired')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  expires_at timestamptz not null,
  provider_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.transactional_email_outbox enable row level security;
revoke all on table public.transactional_email_outbox from public, anon, authenticated;
grant select, insert, update, delete on table public.transactional_email_outbox to service_role;
create index if not exists transactional_email_pending_idx on public.transactional_email_outbox(next_attempt_at) where status = 'pending';
create index if not exists transactional_email_recipient_idx on public.transactional_email_outbox(recipient_hash, created_at desc);
create index if not exists transactional_email_throttle_idx on public.transactional_email_outbox(throttle_hash, created_at desc);

create or replace function public.server_enqueue_transactional_email(
  p_id uuid, p_dedupe_key text, p_kind text, p_organization_id uuid,
  p_recipient_hash text, p_throttle_hash text, p_encrypted_payload text, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.transactional_email_outbox%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_throttle_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_recipient_hash, 1));
  select * into v_row from public.transactional_email_outbox where dedupe_key = p_dedupe_key;
  if found then return jsonb_build_object('id', v_row.id, 'duplicate', true); end if;
  if p_kind = 'recovery' then
    select * into v_row from public.transactional_email_outbox
      where kind = 'recovery' and recipient_hash = p_recipient_hash
        and (created_at > now() - interval '60 seconds'
          or (status in ('pending','preparing','sending') and expires_at > now()))
      order by created_at desc limit 1;
    if found then return jsonb_build_object('id', v_row.id, 'duplicate', true); end if;
  end if;
  if (select count(*) from public.transactional_email_outbox where throttle_hash = p_throttle_hash and created_at > now() - interval '15 minutes') >= 20
     or (select count(*) from public.transactional_email_outbox where recipient_hash = p_recipient_hash and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'email_rate_limited' using errcode = 'PT429';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '1 hour' then
    raise exception 'invalid_email_expiry' using errcode = '22023';
  end if;
  insert into public.transactional_email_outbox(id,dedupe_key,kind,organization_id,recipient_hash,throttle_hash,encrypted_payload,expires_at)
    values(p_id,p_dedupe_key,p_kind,p_organization_id,p_recipient_hash,p_throttle_hash,p_encrypted_payload,p_expires_at);
  return jsonb_build_object('id', p_id, 'duplicate', false);
end;
$$;

create or replace function public.server_claim_transactional_emails(p_id uuid default null, p_limit integer default 3)
returns setof public.transactional_email_outbox language plpgsql security definer set search_path = '' as $$
begin
  -- Retain only non-sensitive delivery metadata for thirty days.
  delete from public.transactional_email_outbox where created_at < now() - interval '30 days';
  -- A crashed worker may already have submitted DATA. Never blindly replay it.
  update public.transactional_email_outbox set status='uncertain', error_code='worker_interrupted_after_submission', encrypted_payload=null, lease_until=null, updated_at=now()
    where status='sending' and lease_until < now();
  update public.transactional_email_outbox set status='pending', lease_until=null, updated_at=now()
    where status='preparing' and lease_until < now() and attempts < 4;
  update public.transactional_email_outbox set status='failed', error_code='retry_exhausted', encrypted_payload=null, lease_until=null, updated_at=now()
    where status='preparing' and lease_until < now() and attempts >= 4;
  update public.transactional_email_outbox set status='expired', error_code='request_expired', encrypted_payload=null, lease_until=null, updated_at=now()
    where status='pending' and expires_at <= now();
  return query
    with candidate as (
      select id from public.transactional_email_outbox
      where status='pending' and next_attempt_at <= now() and expires_at > now()
        and (p_id is null or id=p_id)
      order by created_at for update skip locked limit greatest(1, least(p_limit, 5))
    )
    update public.transactional_email_outbox e
      set status='preparing', attempts=attempts+1, lease_until=now()+interval '90 seconds', updated_at=now()
      from candidate where e.id=candidate.id returning e.*;
end;
$$;
revoke all on function public.server_enqueue_transactional_email(uuid,text,text,uuid,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.server_claim_transactional_emails(uuid,integer) from public, anon, authenticated;
grant execute on function public.server_enqueue_transactional_email(uuid,text,text,uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.server_claim_transactional_emails(uuid,integer) to service_role;
notify pgrst, 'reload schema';
