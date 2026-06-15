-- Allow permanent reserve deletion only for the roles explicitly allowed
-- from the trash UI: super_admin, admin, and conducteur.

CREATE OR REPLACE FUNCTION public.prevent_unsafe_reserve_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.auth_user_role() IN ('super_admin', 'admin', 'conducteur') THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Suppression definitive reserve non autorisee pour ce role'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_unsafe_reserve_hard_delete ON public.reserves;
CREATE TRIGGER trg_prevent_unsafe_reserve_hard_delete
  BEFORE DELETE ON public.reserves
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unsafe_reserve_hard_delete();

REVOKE ALL ON FUNCTION public.prevent_unsafe_reserve_hard_delete() FROM PUBLIC, anon, authenticated;
