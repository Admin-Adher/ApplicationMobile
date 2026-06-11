-- ============================================================================
-- Migration storage Supabase → R2 — RÉÉCRITURE DES URLs EN BASE
-- ============================================================================
-- PRÉREQUIS ABSOLU : les fichiers doivent DÉJÀ avoir été copiés vers R2
-- (rclone, voir cloudflare/MIGRATION.md). On réécrit seulement les URLs ;
-- comme les fichiers existent alors aux DEUX endroits, rien ne casse pendant
-- la transition et le rollback reste possible jusqu'au vidage de Supabase.
--
-- AVANT D'EXÉCUTER : renseignez `new_prefix` ci-dessous avec l'URL de votre
-- Worker R2 (R2_PUBLIC_BASE_URL), SUIVIE D'UN « / ». Exemple :
--   new_prefix := 'https://buildtrack-files.mon-compte.workers.dev/';
--
-- Le remplacement ne touche que les lignes contenant réellement le préfixe
-- Supabase (WHERE ... LIKE), est idempotent (relançable sans effet une 2e
-- fois) et s'applique à toutes les colonnes text/jsonb du schéma public —
-- y compris les .uri imbriqués dans les colonnes jsonb (reserves.photos…).
-- Tout le bloc s'exécute dans une seule transaction implicite : en cas
-- d'erreur, aucune modification n'est conservée.
-- ============================================================================

DO $$
DECLARE
  old_prefix text := 'https://jzeojdpgglbxjdasjgta.supabase.co/storage/v1/object/public/';
  new_prefix text := '__REMPLACEZ_PAR_URL_WORKER_R2__/';   -- ⚠️ ex: https://buildtrack-files.xxx.workers.dev/
  r record;
  n bigint;
  total bigint := 0;
BEGIN
  IF new_prefix LIKE '%__REMPLACEZ%' THEN
    RAISE EXCEPTION 'Configurez new_prefix avec l''URL de votre Worker R2 (terminée par /) avant d''exécuter.';
  END IF;
  IF right(new_prefix, 1) <> '/' THEN
    RAISE EXCEPTION 'new_prefix doit se terminer par un / (sinon les chemins seront collés à l''hôte).';
  END IF;

  FOR r IN
    SELECT c.table_name AS t, c.column_name AS c, c.data_type AS dt
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.is_generated = 'NEVER'
      AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
      AND c.table_name NOT LIKE '\_migr%'
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = replace(%I::text, $1, $2)%s WHERE %I::text LIKE %L',
      r.t, r.c, r.c,
      CASE WHEN r.dt IN ('jsonb', 'json') THEN '::' || r.dt ELSE '' END,
      r.c, '%' || old_prefix || '%'
    ) USING old_prefix, new_prefix;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      total := total + n;
      RAISE NOTICE 'Réécrit %.% : % ligne(s)', r.t, r.c, n;
    END IF;
  END LOOP;

  RAISE NOTICE '── Total : % ligne(s) réécrite(s). Relancez 06_detect.sql : il doit renvoyer 0 ligne. ──', total;
END $$;
