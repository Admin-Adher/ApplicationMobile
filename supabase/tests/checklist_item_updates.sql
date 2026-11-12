\set ON_ERROR_STOP on
begin;
create function pg_temp.checklist_assert(value boolean, label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Checklist assertion failed: %', label; end if; end $$;
create function pg_temp.checklist_error(statement text, expected text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute statement; exception when others then
    get stacked diagnostics actual = returned_sqlstate;
    if actual = expected then return; end if;
    raise exception 'Expected %, got %: %', expected, actual, sqlerrm;
  end;
  raise exception 'Expected %, statement succeeded: %', expected, statement;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,email,raw_user_meta_data) values
 ('80000000-0000-4000-8000-000000000001','checklist-admin@example.test','{}'),
 ('80000000-0000-4000-8000-000000000002','checklist-observer@example.test','{}');
insert into public.organizations(id,name,slug) values
 ('eeeeeeee-0000-4000-8000-000000000001','Checklist A','checklist-test-a'),
 ('ffffffff-0000-4000-8000-000000000002','Checklist B','checklist-test-b');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('eeeeeeee-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','admin'),
 ('eeeeeeee-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','observateur');
insert into public.checklists(id,organization_id,title,items) values
 ('checklist-a','eeeeeeee-0000-4000-8000-000000000001','Checklist A',
  '[{"id":"a","label":"Premier point","done":false,"note":"Conserver"},{"id":"b","label":"Deuxième point","done":false}]'),
 ('checklist-b','ffffffff-0000-4000-8000-000000000002','Checklist B','[{"id":"a","done":false}]');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
-- Simulate web checking A, then a mobile client with stale A=false checking B.
update public.checklists set items=jsonb_set(items,'{0,done}','true') where id='checklist-a';
select pg_temp.checklist_assert(public.set_checklist_item_checked('checklist-a','b',true)->>'applied'='true','mobile success');
select pg_temp.checklist_assert((select items @> '[{"id":"a","done":true,"note":"Conserver"},{"id":"b","done":true}]' from public.checklists where id='checklist-a'),'keeps web check, labels, notes and order');
select pg_temp.checklist_assert(public.set_checklist_item_checked('checklist-a','b',true)->>'applied'='true','retry is a set, not a toggle');
select pg_temp.checklist_assert(public.set_checklist_item_checked('checklist-a','a',false)->'items'->1->>'done'='true','uncheck keeps other point');
select pg_temp.checklist_error($q$select public.set_checklist_item_checked('checklist-b','a',true)$q$,'42501');
select pg_temp.checklist_error($q$select public.set_checklist_item_checked('checklist-a','missing',true)$q$,'22023');
select pg_temp.checklist_error($q$select public.set_checklist_item_checked('checklist-a','a',null)$q$,'22023');
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000002',true);
select pg_temp.checklist_error($q$select public.set_checklist_item_checked('checklist-a','a',true)$q$,'42501');
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
delete from public.checklists where id='checklist-a';
select pg_temp.checklist_error($q$select public.set_checklist_item_checked('checklist-a','a',true)$q$,'42501');
reset role;
set local role anon;
select pg_temp.checklist_error($q$select public.set_checklist_item_checked('checklist-b','a',true)$q$,'42501');
rollback;
