-- Run only in the disposable CI catalogue. No messages are sent.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  row_id uuid; claimed integer;
begin
  if has_table_privilege('anon', 'public.transactional_email_outbox', 'SELECT')
    or has_table_privilege('authenticated', 'public.transactional_email_outbox', 'INSERT')
    or has_function_privilege('authenticated', 'public.server_claim_transactional_emails(uuid,integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.server_enqueue_transactional_email(uuid,text,text,uuid,text,text,text,timestamptz)', 'EXECUTE') then
    raise exception 'outbox privileges exposed';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.transactional_email_outbox'::regclass) then raise exception 'RLS disabled'; end if;
  perform public.server_enqueue_transactional_email(a,'test-a','recovery',null,'recipient-a','ip-a','encrypted',now()+interval '30 minutes');
  select (public.server_enqueue_transactional_email(b,'test-b','recovery',null,'recipient-a','ip-b','encrypted',now()+interval '30 minutes')->>'id')::uuid into row_id;
  if row_id <> a then raise exception 'recipient cooldown not deduplicated'; end if;
  update public.transactional_email_outbox set created_at=now()-interval '2 minutes' where id=a;
  select (public.server_enqueue_transactional_email(b,'test-b','recovery',null,'recipient-a','ip-b','encrypted',now()+interval '30 minutes')->>'id')::uuid into row_id;
  if row_id <> a then raise exception 'active recovery replaced before submission'; end if;
  select count(*) into claimed from public.server_claim_transactional_emails(a,1);
  if claimed <> 1 then raise exception 'first claim failed'; end if;
  select count(*) into claimed from public.server_claim_transactional_emails(a,1);
  if claimed <> 0 then raise exception 'lease claimed twice'; end if;
  update public.transactional_email_outbox set lease_until=now()-interval '1 second' where id=a;
  select count(*) into claimed from public.server_claim_transactional_emails(a,1);
  if claimed <> 1 then raise exception 'preparation crash not recoverable'; end if;
  update public.transactional_email_outbox set status='sending',lease_until=now()-interval '1 second' where id=a;
  select count(*) into claimed from public.server_claim_transactional_emails(a,1);
  if claimed <> 0 or not exists(select 1 from public.transactional_email_outbox where id=a and status='uncertain' and encrypted_payload is null) then
    raise exception 'ambiguous SMTP delivery replayed or payload retained';
  end if;
  perform public.server_enqueue_transactional_email(c,'test-c','recovery',null,'recipient-c','ip-c','encrypted',now()+interval '30 minutes');
  update public.transactional_email_outbox set expires_at=now()-interval '1 second' where id=c;
  perform public.server_claim_transactional_emails(c,1);
  if not exists(select 1 from public.transactional_email_outbox where id=c and status='expired' and encrypted_payload is null) then raise exception 'expired token retained'; end if;
  for i in 1..5 loop
    perform public.server_enqueue_transactional_email(gen_random_uuid(),'rate-'||i,'invitation',null,'recipient-rate','ip-rate','encrypted',now()+interval '30 minutes');
  end loop;
  begin
    perform public.server_enqueue_transactional_email(gen_random_uuid(),'rate-6','invitation',null,'recipient-rate','ip-rate','encrypted',now()+interval '30 minutes');
    raise exception 'rate limit was not enforced';
  exception when sqlstate 'PT429' then null;
  end;
end;
$$;
rollback;
