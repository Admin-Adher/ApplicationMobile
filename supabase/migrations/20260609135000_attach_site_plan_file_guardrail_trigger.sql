DROP TRIGGER IF EXISTS trg_enforce_site_plan_file_delete_permission ON public.site_plans;
CREATE TRIGGER trg_enforce_site_plan_file_delete_permission
  BEFORE UPDATE ON public.site_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_site_plan_file_delete_permission();

NOTIFY pgrst, 'reload schema';
