\set ON_ERROR_STOP on
begin;
create function pg_temp.mep_assert(v boolean,label text) returns void language plpgsql as $$ begin if v is distinct from true then raise exception 'MEP assertion failed: %',label; end if; end $$;
create function pg_temp.mep_error(statement text,expected text,expected_message text default null) returns void language plpgsql as $$
declare actual text; begin begin execute statement; exception when others then get stacked diagnostics actual=returned_sqlstate; if actual=expected and (expected_message is null or position(expected_message in sqlerrm)>0) then return; end if; raise exception 'Expected % / %, got %: %',expected,expected_message,actual,sqlerrm; end; raise exception 'Expected failure: %',statement; end $$;
reset role;
alter table public.site_plans add column if not exists building text;
alter table public.site_plans add column if not exists name text;
alter table public.site_plans add column if not exists is_latest_revision boolean default true;
insert into auth.users(id,email) values('71000000-0000-4000-8000-000000000001','mep-admin@example.test'),('71000000-0000-4000-8000-000000000002','mep-sub@example.test'),('71000000-0000-4000-8000-000000000003','mep-other@example.test');
insert into public.organizations(id,name,slug) values('c1111111-0000-4000-8000-000000000001','MEP A','mep-test-a'),('d1111111-0000-4000-8000-000000000001','MEP B','mep-test-b');
insert into public.companies(id,organization_id,name) values('mep-company-a','c1111111-0000-4000-8000-000000000001','MEP A'),('mep-company-b','d1111111-0000-4000-8000-000000000001','MEP B'),('mep-company-c','c1111111-0000-4000-8000-000000000001','MEP C');
insert into public.organization_memberships(organization_id,user_id,role,company_id) values('c1111111-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','admin','mep-company-a'),('c1111111-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','sous_traitant','mep-company-a');
insert into public.organization_memberships(organization_id,user_id,role,company_id) values('c1111111-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','sous_traitant','mep-company-c');
insert into public.chantiers(id,organization_id,name) values('mep-project-a','c1111111-0000-4000-8000-000000000001','MEP A'),('mep-project-b','d1111111-0000-4000-8000-000000000001','MEP B');
insert into public.site_plans(id,organization_id,chantier_id,uri,building,name,is_latest_revision) values
 ('mep-plan-a','c1111111-0000-4000-8000-000000000001','mep-project-a','btmedia:plan-a','Bâtiment A','Plomberie',true),
 ('mep-plan-a2','c1111111-0000-4000-8000-000000000001','mep-project-a','btmedia:plan-a2','Bâtiment B','Électricité',true),
 ('mep-plan-old','c1111111-0000-4000-8000-000000000001','mep-project-a','btmedia:plan-old','Bâtiment A','Ancien indice',false),
 ('mep-plan-b','d1111111-0000-4000-8000-000000000001','mep-project-b','btmedia:plan-b','Bâtiment B','Étranger',true);
insert into public.tenant_media_objects(id,organization_id,owner_user_id,provider,bucket,object_key,status,content_type) values
 ('81000000-0000-4000-8000-000000000001','c1111111-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','r2','photos','mep/photo-a.jpg','ready','image/jpeg'),
 ('81000000-0000-4000-8000-000000000002','d1111111-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','r2','photos','mep/photo-b.jpg','ready','image/jpeg'),
 ('81000000-0000-4000-8000-000000000003','c1111111-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','r2','photos','mep/private-reserve.jpg','ready','image/jpeg'),
 ('81000000-0000-4000-8000-000000000004','c1111111-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','r2','photos','mep/private-other-reserve.jpg','ready','image/jpeg');
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select public.apply_plan_progress('91000000-0000-4000-8000-000000000001','mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":null,"after":{"id":"mep-work-a","docId":"mep-plan-a","page":1,"lotId":"[\"mep-company-a\",null]","kind":"line","name":"Eau froide local 105R","status":"progress","progressPercent":30,"price":12,"points":[{"x":10,"y":20},{"x":100,"y":70}],"mep":{"discipline":"plumbing","network":"EF","subnetwork":"Alimentation","zone":"105R","quantityMode":"manual","plannedQuantity":100,"unit":"m","weight":1},"blockers":[{"id":"82000000-0000-4000-8000-000000000001","point":{"x":50,"y":40},"description":"Réservation à reprendre","photoRefs":["btmedia://81000000-0000-4000-8000-000000000001"],"companyId":"mep-company-a","responsibleId":"71000000-0000-4000-8000-000000000001","dueDate":"2026-12-01","openedAt":"2026-11-16T10:00:00Z","status":"assigned","blocksProgress":true,"priority":"high"}]}}]');
select pg_temp.mep_assert(public.read_project_mep('mep-plan-a','btmedia:plan-a')->>'totalPlans'='2','current revisions only');
select pg_temp.mep_assert(jsonb_array_length(public.read_project_mep('mep-plan-a','btmedia:plan-a')->'history')=1,'project history');
select pg_temp.mep_assert(jsonb_array_length(public.read_project_mep('mep-plan-a','btmedia:plan-a')->'notifications')=1,'assigned recipient notification');
select pg_temp.mep_assert(public.read_plan_progress('mep-plan-a','btmedia:plan-a')->'history'->0 ? 'author','author retained');
select public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"executedRanges":null},"after":{"executedRanges":[[0,0.2],[0.8,0.9]]}}]');
-- Every candidate below is internally coherent: it must fail for the active
-- blocking obstacle, never for stale CAS fields or inconsistent drawn portions.
do $$ declare candidate text; changes jsonb; before_fields jsonb; after_fields jsonb; work jsonb;
begin
  before_fields:='{"status":"progress","progressPercent":30,"executedRanges":[[0,0.2],[0.8,0.9]]}';
  foreach candidate in array array['installed','checked','progress'] loop
    after_fields:=jsonb_build_object('status',candidate,'progressPercent',case when candidate='progress' then '100'::jsonb else 'null'::jsonb end,'executedRanges','[[0,1]]'::jsonb);
    changes:=jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',before_fields,'after',after_fields));
    perform pg_temp.mep_error(format('select public.apply_plan_progress(gen_random_uuid(),%L,%L,%L)','mep-plan-a','btmedia:plan-a',changes),'22023','blocage actif');
  end loop;
  work:=public.read_plan_progress('mep-plan-a','btmedia:plan-a')->'elements'->0;
  work:=jsonb_set(jsonb_set(work,'{id}','"mep-work-nonblocking"'),'{blockers,0,id}','"82000000-0000-4000-8000-000000000099"');
  work:=jsonb_set(work,'{blockers,0,blocksProgress}','false');
  work:=work||'{"status":"installed","progressPercent":null,"executedRanges":[[0,1]]}'::jsonb;
  perform public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-nonblocking','before',null,'after',work)));
  perform pg_temp.mep_assert(exists(select 1 from jsonb_array_elements(public.read_plan_progress('mep-plan-a','btmedia:plan-a')->'elements') e where e->>'id'='mep-work-nonblocking' and e->>'status'='installed'),'an ordinary non-blocking reserve never prevents completion');
end $$;
select pg_temp.mep_error($q$select public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"executedRanges":[[0,0.2],[0.8,0.9]]},"after":{"executedRanges":[[0,0.4],[0.3,0.5]]}}]')$q$,'22023');
select pg_temp.mep_error($q$select public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"executedRanges":[[0,0.2],[0.8,0.9]]},"after":{"executedRanges":[[0,0.4]]}}]')$q$,'22023');
select pg_temp.mep_error($q$select public.read_project_mep('mep-plan-b','btmedia:plan-b')$q$,'42501');
select pg_temp.mep_error($q$select * from public.site_mep_notifications$q$,'42501');
select pg_temp.mep_error($q$select public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"status":"progress"},"after":{"status":"checked"}}]')$q$,'22023');
select pg_temp.mep_error($q$select public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"blockers":null},"after":{"blockers":[]}}]')$q$,'22023');
do $$ declare b jsonb; changed jsonb;
begin
  b:=public.read_plan_progress('mep-plan-a','btmedia:plan-a')->'elements'->0->'blockers';
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
  perform public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"progressPercent":30,"executedRanges":[[0,0.2],[0.8,0.9]]},"after":{"progressPercent":40,"executedRanges":[[0,0.4]]}}]');
  perform public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"progressPercent":40,"executedRanges":[[0,0.4]]},"after":{"progressPercent":30,"executedRanges":[[0,0.2],[0.8,0.9]]}}]');
  changed:=jsonb_set(b,'{0,status}','"in_progress"');
  perform pg_temp.mep_error(format('select public.apply_plan_progress(gen_random_uuid(),%L,%L,%L)','mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed)))),'42501');
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
  changed:=jsonb_set(b,'{0,responsibleId}','"71000000-0000-4000-8000-000000000002"');
  perform public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed))));
  b:=changed;
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
  perform pg_temp.mep_error($q$select public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"progressPercent":30,"executedRanges":[[0,0.2],[0.8,0.9]]},"after":{"progressPercent":40,"executedRanges":[[0,0.4]]}}]')$q$,'42501');
  changed:=jsonb_set(b,'{0,status}','"in_progress"');
  perform pg_temp.mep_error(format('select public.apply_plan_progress(gen_random_uuid(),%L,%L,%L)','mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed)))),'42501');
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
  changed:=jsonb_set(changed,'{0,photoRefs}',(b->0->'photoRefs')||'"btmedia://81000000-0000-4000-8000-000000000003"'::jsonb);
  perform public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed))));
  b:=changed;
  changed:=jsonb_set(b,'{0,photoRefs}','["btmedia://81000000-0000-4000-8000-000000000003"]');
  perform pg_temp.mep_error(format('select public.apply_plan_progress(gen_random_uuid(),%L,%L,%L)','mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed)))),'42501');
  changed:=jsonb_set(b,'{0,status}','"closed"');
  perform pg_temp.mep_error(format('select public.apply_plan_progress(gen_random_uuid(),%L,%L,%L)','mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed)))),'42501');
  changed:=jsonb_set(b,'{0,description}','"Preuve remplacée"');
  perform pg_temp.mep_error(format('select public.apply_plan_progress(gen_random_uuid(),%L,%L,%L)','mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed)))),'42501');
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
end $$;
do $$ declare b jsonb; changed jsonb; op uuid:=gen_random_uuid(); result jsonb;
begin
  b:=public.read_plan_progress('mep-plan-a','btmedia:plan-a')->'elements'->0->'blockers';
  changed:=jsonb_set(b,'{0,photoRefs,0}','"btmedia://81000000-0000-4000-8000-000000000002"');
  perform pg_temp.mep_error(format('select public.apply_plan_progress(gen_random_uuid(),%L,%L,%L)','mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed)))),'42501');
  changed:=jsonb_set(b,'{0,photoRefs,0}','"btmedia://81000000-0000-4000-8000-000000000004"');
  perform pg_temp.mep_error(format('select public.apply_plan_progress(gen_random_uuid(),%L,%L,%L)','mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed)))),'42501');
  changed:=jsonb_set(b,'{0,status}','"closed"');
  perform pg_temp.mep_error(format('select public.apply_plan_progress(gen_random_uuid(),%L,%L,%L)','mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed)))),'22023');
  changed:=jsonb_set(b,'{0,status}','"resolved"');
  result:=jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed)));
  perform public.apply_plan_progress(op,'mep-plan-a','btmedia:plan-a',result);
  perform pg_temp.mep_assert(public.apply_plan_progress(op,'mep-plan-a','btmedia:plan-a',result)->>'replayed'='true','retry idempotent');
  perform public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"status":"progress","progressPercent":30,"executedRanges":[[0,0.2],[0.8,0.9]]},"after":{"status":"installed","progressPercent":null,"executedRanges":[[0,1]]}}]');
  perform pg_temp.mep_assert(public.read_plan_progress('mep-plan-a','btmedia:plan-a')->'elements'->0->>'status'='installed','installation succeeds as soon as the blocking obstacle is resolved');
  perform public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"status":"installed","progressPercent":null,"executedRanges":[[0,1]]},"after":{"status":"progress","progressPercent":30,"executedRanges":[[0,0.2],[0.8,0.9]]}}]');
  b:=changed;changed:=jsonb_set(b,'{0,status}','"closed"');
  perform public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a',jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('blockers',b),'after',jsonb_build_object('blockers',changed))));
end $$;
select public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"status":"progress","progressPercent":30,"executedRanges":[[0,0.2],[0.8,0.9]]},"after":{"status":"checked","progressPercent":null,"executedRanges":[[0,1]]}}]');
select public.mark_mep_notifications_read('mep-plan-a','btmedia:plan-a');
do $$ declare e jsonb; c jsonb; begin
  e:=public.read_plan_progress('mep-plan-a','btmedia:plan-a')->'elements'->0;
  c:=jsonb_build_array(jsonb_build_object('target','elements','key','mep-work-a','before',jsonb_build_object('mep',e->'mep','executedRanges',e->'executedRanges'),'after',jsonb_build_object('mep',null,'executedRanges',null)));
  perform pg_temp.mep_error(format('select public.apply_plan_progress(gen_random_uuid(),%L,%L,%L)','mep-plan-a','btmedia:plan-a',c),'22023');
end $$;
select pg_temp.mep_assert(public.read_project_mep('mep-plan-a','btmedia:plan-a')->'notifications'->0->>'readAt' is not null,'notifications acknowledged only for current recipient');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select pg_temp.mep_assert(not(public.read_project_mep('mep-plan-a','btmedia:plan-a')->'plans'->0->'document'->'elements'->0 ? 'price'),'project prices redacted');
select pg_temp.mep_assert(not(public.read_project_mep('mep-plan-a','btmedia:plan-a')->'history'->0->'changes'->0->'after' ? 'price'),'project history prices redacted');
select pg_temp.mep_assert(jsonb_array_length(public.read_project_mep('mep-plan-a','btmedia:plan-a')->'notifications')>0,'responsible receives assignment and status notifications');
select pg_temp.mep_error($q$select public.apply_plan_progress(gen_random_uuid(),'mep-plan-a','btmedia:plan-a','[{"target":"elements","key":"mep-work-a","before":{"mep":null},"after":{"mep":null}}]')$q$,'22023');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
select pg_temp.mep_assert(jsonb_array_length(public.read_project_mep('mep-plan-a','btmedia:plan-a')->'notifications')=0,'other company never receives private notifications');
reset role;
update public.site_plan_progress_operations set created_at='2026-11-16T12:00:00.000100Z' where plan_id='mep-plan-a';
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select pg_temp.mep_assert(public.read_project_mep('mep-plan-a','btmedia:plan-a')->>'historyOrderingReliable'='false','legacy equal timestamps cannot claim reliable historical ordering');
rollback;
