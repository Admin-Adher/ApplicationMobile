\set ON_ERROR_STOP on
begin;
create function pg_temp.progress_assert(value boolean, label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Progress assertion failed: %', label; end if; end $$;
create function pg_temp.progress_error(statement text, expected text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute statement; exception when others then
    get stacked diagnostics actual = returned_sqlstate;
    if actual = expected then return; end if;
    raise exception 'Expected SQLSTATE %, got %: %', expected, actual, sqlerrm;
  end;
  raise exception 'Expected SQLSTATE %, statement succeeded: %', expected,statement;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,email,raw_user_meta_data) values
 ('70000000-0000-4000-8000-000000000001','progress-admin@example.test','{}'),
 ('70000000-0000-4000-8000-000000000004','progress-subcontractor@example.test','{}');
insert into public.organizations(id,name,slug) values
 ('cccccccc-0000-4000-8000-000000000001','Progress A','progress-test-a'),
 ('dddddddd-0000-4000-8000-000000000002','Progress B','progress-test-b');
insert into public.companies(id,organization_id,name) values
 ('progress-company-a','cccccccc-0000-4000-8000-000000000001','Progress Company A'),
 ('progress-company-b','dddddddd-0000-4000-8000-000000000002','Progress Company B');
insert into public.organization_memberships(organization_id,user_id,role,company_id) values
 ('cccccccc-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','admin','progress-company-a'),
 ('cccccccc-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000004','observateur','progress-company-a');
insert into public.chantiers(id,organization_id,name) values
 ('progress-chantier-a','cccccccc-0000-4000-8000-000000000001','Progress A'),
 ('progress-chantier-b','dddddddd-0000-4000-8000-000000000002','Progress B');
insert into public.site_plans(id,organization_id,chantier_id,uri) values
 ('progress-plan-a','cccccccc-0000-4000-8000-000000000001','progress-chantier-a','btmedia:pdf-a'),
 ('progress-plan-b','dddddddd-0000-4000-8000-000000000002','progress-chantier-b','btmedia:pdf-b');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select pg_temp.progress_assert(public.read_plan_progress('progress-plan-a','btmedia:pdf-a')->'elements' = '[]','empty real plan');
select pg_temp.progress_error($q$select public.read_plan_progress('progress-plan-b','btmedia:pdf-b')$q$,'42501');
select pg_temp.progress_error($q$select public.read_plan_progress('progress-plan-a','btmedia:changed-file')$q$,'22023');
select pg_temp.progress_error($q$select * from public.site_plan_progress$q$,'42501');
select pg_temp.progress_error($q$select * from public.site_plan_progress_operations$q$,'42501');
select pg_temp.progress_assert(public.apply_plan_progress('00000000-0000-4000-8000-000000000001','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":null,"after":{"id":"work-a","docId":"progress-plan-a","page":1,"kind":"line","name":"Gaine","lotId":"[\"progress-company-a\",null]","points":[{"x":10,"y":10},{"x":110,"y":10}],"price":12,"status":"todo","note":""}},
   {"target":"calibrations","key":"progress-plan-a:1","before":null,"after":0.05}]')->>'applied' = 'true','create and calibration');
select pg_temp.progress_assert(public.apply_plan_progress('00000000-0000-4000-8000-000000000002','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"status":"todo"},"after":{"status":"installed"}}]')->>'applied' = 'true','status');
select pg_temp.progress_assert(public.apply_plan_progress('00000000-0000-4000-8000-000000000002','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"status":"todo"},"after":{"status":"installed"}}]')->>'replayed' = 'true','retry after lost reply is idempotent');
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000002','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"status":"todo"},"after":{"status":"checked"}}]')$q$,'22023');
select pg_temp.progress_assert(public.apply_plan_progress('00000000-0000-4000-8000-000000000003','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"name":"Gaine"},"after":{"name":"Gaine modifiée"}}]')->>'applied' = 'true','independent field merges');
select pg_temp.progress_assert(public.read_plan_progress('progress-plan-a','btmedia:pdf-a')->'elements'->0->>'status' = 'installed','independent update keeps status');
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000004','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"status":"todo"},"after":{"status":"checked"}}]')$q$,'22023');
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000005','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"lotId":"[\"progress-company-a\",null]"},"after":{"lotId":"[\"progress-company-b\",null]"}}]')$q$,'42501');
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000006','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"points":[{"x":10,"y":10},{"x":110,"y":10}]},"after":{"points":[{"x":-1,"y":0}]}}]')$q$,'22023');
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000007','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":null,"after":null}]')$q$,'22023');
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000008','progress-plan-a','btmedia:pdf-a',
 '[{"target":"calibrations","key":"progress-plan-a:1","before":0.05,"after":0}]')$q$,'22023');
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000018','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"page":1},"after":{"page":"1"}}]')$q$,'22023');
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000019','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"name":"Gaine modifiée"},"after":{"name":{"invalid":true}}}]')$q$,'22023');
-- Exact percentages are optional and field-level CAS remains intact.
select public.apply_plan_progress('00000000-0000-4000-8000-000000000021','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"status":"installed","progressPercent":null},"after":{"status":"progress","progressPercent":25}}]');
select public.apply_plan_progress('00000000-0000-4000-8000-000000000022','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"progressPercent":25},"after":{"progressPercent":37.5}}]');
select public.apply_plan_progress('00000000-0000-4000-8000-000000000021','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"status":"installed","progressPercent":null},"after":{"status":"progress","progressPercent":25}}]');
select pg_temp.progress_assert(public.read_plan_progress('progress-plan-a','btmedia:pdf-a')->'elements'->0->>'progressPercent'='37.5','receipt cannot restore an older percentage');
select pg_temp.progress_error($q$select public.apply_plan_progress(gen_random_uuid(),'progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"progressPercent":25},"after":{"progressPercent":75}}]')$q$,'22023');
select pg_temp.progress_error($q$select public.apply_plan_progress(gen_random_uuid(),'progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"progressPercent":37.5},"after":{"progressPercent":101}}]')$q$,'22023');
select public.apply_plan_progress(gen_random_uuid(),'progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"status":"progress","progressPercent":37.5},"after":{"status":"installed","progressPercent":null}}]');
-- Role changes are read from active membership, not the stale profile projection.
reset role;
update public.organization_memberships set role = 'sous_traitant' where user_id = '70000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000004',true);
select pg_temp.progress_assert(not (public.read_plan_progress('progress-plan-a','btmedia:pdf-a')->'elements'->0 ? 'price'),'subcontractor prices redacted');
select pg_temp.progress_assert(public.apply_plan_progress('00000000-0000-4000-8000-000000000009','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"status":"installed"},"after":{"status":"progress"}}]')->>'applied' = 'true','own company status');
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000010','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"status":"progress"},"after":{"status":"checked"}}]')$q$,'42501');
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000011','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"name":"Gaine modifiée"},"after":{"name":"Renommage interdit"}}]')$q$,'42501');
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000012','progress-plan-a','btmedia:pdf-a',
 '[{"target":"billed","key":"progress-plan-a:1:[\"progress-company-a\",null]","before":null,"after":100}]')$q$,'42501');
reset role;
update public.organization_memberships set company_id = null where user_id = '70000000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000013','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"status":"progress"},"after":{"status":"installed"}}]')$q$,'42501');
reset role;
update public.site_plans set uri = 'btmedia:new-revision' where id = 'progress-plan-a';
set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select pg_temp.progress_error($q$select public.apply_plan_progress('00000000-0000-4000-8000-000000000014','progress-plan-a','btmedia:pdf-a',
 '[{"target":"elements","key":"work-a","before":{"status":"progress"},"after":{"status":"installed"}}]')$q$,'22023');
select pg_temp.progress_assert(public.read_plan_progress('progress-plan-a','btmedia:new-revision')->'elements' = '[]','new PDF never reuses old geometry');
rollback;
