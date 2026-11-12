\set ON_ERROR_STOP on
begin;
create function pg_temp.terrain_assert(value boolean, label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Terrain assertion failed: %', label; end if; end $$;
create function pg_temp.terrain_error(statement text, expected text) returns void language plpgsql as $$
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
insert into auth.users(id,email) values
 ('90000000-0000-4000-8000-000000000001','terrain-admin@example.test'),
 ('90000000-0000-4000-8000-000000000002','terrain-chef@example.test'),
 ('90000000-0000-4000-8000-000000000003','terrain-observer@example.test');
insert into public.organizations(id,name,slug) values
 ('eeeeeeee-0000-4000-8000-000000000091','Terrain A','terrain-test-a'),
 ('ffffffff-0000-4000-8000-000000000092','Terrain B','terrain-test-b');
insert into public.profiles(id,organization_id,name,email,role) values
 ('90000000-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000091','Terrain Admin','terrain-admin@example.test','admin'),
 ('90000000-0000-4000-8000-000000000002','eeeeeeee-0000-4000-8000-000000000091','Terrain Chef','terrain-chef@example.test','chef_equipe'),
 ('90000000-0000-4000-8000-000000000003','eeeeeeee-0000-4000-8000-000000000091','Terrain Observer','terrain-observer@example.test','observateur');
insert into public.organization_memberships(organization_id,user_id,role) select organization_id,id,role from public.profiles where email like 'terrain-%@example.test';
insert into public.chantiers(id,organization_id,name) values('terrain-project','eeeeeeee-0000-4000-8000-000000000091','Terrain');
insert into public.visites(id,organization_id,chantier_id,title,checklist_items,notes) values
 ('terrain-visit','eeeeeeee-0000-4000-8000-000000000091','terrain-project','Original','[{"id":"a","checked":false,"label":"A"},{"id":"b","checked":false,"label":"B"}]','Original'),
 ('terrain-foreign','ffffffff-0000-4000-8000-000000000092',null,'Foreign','[]',null);
insert into public.oprs(id,organization_id,chantier_id,title,items) values
 ('terrain-opr','eeeeeeee-0000-4000-8000-000000000091','terrain-project','Original','[{"id":"a","status":"reserve","label":"A","reserveId":"terrain-reserve"},{"id":"b","status":"reserve","label":"B"}]');
insert into public.reserves(id,organization_id,chantier_id,status) values('terrain-reserve','eeeeeeee-0000-4000-8000-000000000091','terrain-project','open');
insert into public.channels(id,organization_id,name,type) values('terrain-channel','eeeeeeee-0000-4000-8000-000000000091','Terrain','custom');
insert into public.messages(id,organization_id,channel_id,sender_id,sender,content) values('terrain-message','eeeeeeee-0000-4000-8000-000000000091','terrain-channel','90000000-0000-4000-8000-000000000001','Terrain Admin','Test');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
-- Web changes A and title; stale mobile changes only B and notes.
update public.visites set title='Web',checklist_items=jsonb_set(checklist_items,'{0,checked}','true') where id='terrain-visit';
select pg_temp.terrain_assert(public.apply_terrain_patch('a0000000-0000-4000-8000-000000000001','visites','terrain-visit',
 '[{"target":"checklist_items","key":"b","before":{"checked":false},"after":{"checked":true}},{"target":"notes","before":"Original","after":"Mobile"}]')->>'applied'='true','visit confirmed');
select pg_temp.terrain_assert((select title='Web' and notes='Mobile' and checklist_items @> '[{"id":"a","checked":true},{"id":"b","checked":true}]' from public.visites where id='terrain-visit'),'visit merge preserves web');
select public.apply_terrain_patch('a0000000-0000-4000-8000-000000000002','visites','terrain-visit','[{"target":"notes","before":"Mobile","after":"Undo"}]');
select public.apply_terrain_patch('a0000000-0000-4000-8000-000000000001','visites','terrain-visit','[{"target":"checklist_items","key":"b","before":{"checked":false},"after":{"checked":true}},{"target":"notes","before":"Original","after":"Mobile"}]');
select pg_temp.terrain_assert((select notes='Undo' from public.visites where id='terrain-visit'),'lost response replay cannot undo later write');
select pg_temp.terrain_error($q$select public.apply_terrain_patch('a0000000-0000-4000-8000-000000000003','visites','terrain-visit','[{"target":"title","before":"Original","after":"Stale"}]')$q$,'23514');
select pg_temp.terrain_error($q$select public.apply_terrain_patch('a0000000-0000-4000-8000-000000000001','visites','terrain-visit','[{"target":"notes","before":"Undo","after":"Changed fingerprint"}]')$q$,'22023');
select pg_temp.terrain_error($q$select public.apply_terrain_patch(gen_random_uuid(),'visites','terrain-foreign','[{"target":"notes","before":null,"after":"Forbidden"}]')$q$,'42501');
select pg_temp.terrain_error($q$select public.apply_terrain_patch(gen_random_uuid(),'visites','terrain-visit','[{"target":"organization_id","before":null,"after":"Forbidden"}]')$q$,'22023');
select pg_temp.terrain_error($q$select public.apply_terrain_patch(gen_random_uuid(),'visites','terrain-visit','[{"target":"checklist_items","key":"missing","before":{"checked":false},"after":{"checked":true}}]')$q$,'23514');
update public.oprs set title='Web title' where id='terrain-opr';
select public.apply_terrain_patch('a0000000-0000-4000-8000-000000000004','oprs','terrain-opr','[{"target":"items","key":"b","before":{"status":"reserve"},"after":{"status":"ok"}}]');
select pg_temp.terrain_assert((select title='Web title' and items->1->>'status'='ok' from public.oprs where id='terrain-opr'),'OPR merge preserves title');
select public.apply_terrain_patch('a0000000-0000-4000-8000-000000000005','oprs','terrain-opr','[{"target":"items","key":"a","before":{"status":"reserve"},"after":{"status":"ok"}}]');
select pg_temp.terrain_assert((select status='closed' and closed_by='Terrain Admin' from public.reserves where id='terrain-reserve'),'OPR linked reserve updated atomically');
select pg_temp.terrain_assert((select count(*)=1 from public.reserve_status_events where reserve_id='terrain-reserve'),'single reserve history event');
select public.apply_terrain_patch('a0000000-0000-4000-8000-000000000005','oprs','terrain-opr','[{"target":"items","key":"a","before":{"status":"reserve"},"after":{"status":"ok"}}]');
select pg_temp.terrain_assert((select count(*)=1 from public.reserve_status_events where reserve_id='terrain-reserve'),'replay does not duplicate history');
select public.set_message_reaction('b0000000-0000-4000-8000-000000000001','terrain-message','👍',true);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',true);
select public.set_message_reaction('b0000000-0000-4000-8000-000000000002','terrain-message','✅',true);
select pg_temp.terrain_assert((select reactions @> '{"👍":["Terrain Admin"],"✅":["Terrain Chef"]}' from public.messages where id='terrain-message'),'non-author reaction preserves other user');
select public.set_message_reaction('b0000000-0000-4000-8000-000000000003','terrain-message','✅',false);
select public.set_message_reaction('b0000000-0000-4000-8000-000000000002','terrain-message','✅',true);
select pg_temp.terrain_assert((select not(reactions ? '✅') and reactions ? '👍' from public.messages where id='terrain-message'),'reaction receipt protects later undo');
select pg_temp.terrain_error($q$select public.set_message_reaction('b0000000-0000-4000-8000-000000000001','terrain-message','👍',true)$q$,'22023');
select pg_temp.terrain_error($q$select * from private.terrain_operation_receipts$q$,'42501');
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000003',true);
select pg_temp.terrain_error($q$select public.apply_terrain_patch(gen_random_uuid(),'visites','terrain-visit','[{"target":"notes","before":"Undo","after":"Forbidden"}]')$q$,'42501');
reset role;
update public.oprs set status='signed' where id='terrain-opr';
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
select pg_temp.terrain_error($q$select public.apply_terrain_patch(gen_random_uuid(),'oprs','terrain-opr','[{"target":"title","before":"Web title","after":"Forbidden"}]')$q$,'23514');
reset role;
set local role anon;
select pg_temp.terrain_error($q$select public.apply_terrain_patch(gen_random_uuid(),'visites','terrain-visit','[]')$q$,'42501');
select pg_temp.terrain_error($q$select public.set_message_reaction(gen_random_uuid(),'terrain-message','👍',true)$q$,'42501');
rollback;
