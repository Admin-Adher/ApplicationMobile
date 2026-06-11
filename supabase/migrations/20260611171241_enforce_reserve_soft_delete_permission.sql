-- Reserve trash mutations must follow the mobile permission model:
-- soft-delete requires canDelete, restore requires canEdit.

CREATE OR REPLACE FUNCTION public.enforce_reserve_soft_delete_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NOT public.auth_user_has_permission('canDelete') THEN
      RAISE EXCEPTION 'Mise en corbeille reserve non autorisee pour ces permissions'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    IF NOT public.auth_user_has_permission('canEdit') THEN
      RAISE EXCEPTION 'Restauration reserve non autorisee pour ces permissions'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_reserve_soft_delete_permission ON public.reserves;
CREATE TRIGGER trg_enforce_reserve_soft_delete_permission
  BEFORE UPDATE OF deleted_at ON public.reserves
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_reserve_soft_delete_permission();

REVOKE ALL ON FUNCTION public.enforce_reserve_soft_delete_permission() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_can_delete_for_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_user_has_permission('canDelete') THEN
    RAISE EXCEPTION 'Suppression definitive non autorisee sur % pour ces permissions', TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_visites_hard_delete_permission ON public.visites;
CREATE TRIGGER trg_enforce_visites_hard_delete_permission
  BEFORE DELETE ON public.visites
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_can_delete_for_hard_delete();

DROP TRIGGER IF EXISTS trg_enforce_documents_hard_delete_permission ON public.documents;
CREATE TRIGGER trg_enforce_documents_hard_delete_permission
  BEFORE DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_can_delete_for_hard_delete();

DROP TRIGGER IF EXISTS trg_enforce_time_entries_hard_delete_permission ON public.time_entries;
CREATE TRIGGER trg_enforce_time_entries_hard_delete_permission
  BEFORE DELETE ON public.time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_can_delete_for_hard_delete();

DROP TRIGGER IF EXISTS trg_enforce_journal_entries_hard_delete_permission ON public.journal_entries;
CREATE TRIGGER trg_enforce_journal_entries_hard_delete_permission
  BEFORE DELETE ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_can_delete_for_hard_delete();

DROP TRIGGER IF EXISTS trg_enforce_checklists_hard_delete_permission ON public.checklists;
CREATE TRIGGER trg_enforce_checklists_hard_delete_permission
  BEFORE DELETE ON public.checklists
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_can_delete_for_hard_delete();

DROP TRIGGER IF EXISTS trg_enforce_regulatory_docs_hard_delete_permission ON public.regulatory_docs;
CREATE TRIGGER trg_enforce_regulatory_docs_hard_delete_permission
  BEFORE DELETE ON public.regulatory_docs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_can_delete_for_hard_delete();

REVOKE ALL ON FUNCTION public.enforce_can_delete_for_hard_delete() FROM PUBLIC, anon, authenticated;
