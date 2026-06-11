-- ============================================================================
-- Migration storage Supabase → R2 — DÉTECTION (lecture seule, ne modifie rien)
-- ============================================================================
-- À exécuter dans le SQL Editor Supabase :
--   • AVANT la réécriture : photographie des colonnes/lignes contenant des
--     URLs Supabase Storage (le périmètre exact qui sera migré).
--   • APRÈS la réécriture (script 07) : DOIT retourner 0 ligne. Tant que ce
--     n'est pas le cas, NE PAS vider les buckets Supabase.
--
-- Balaie TOUTES les colonnes text/varchar/jsonb de TOUTES les tables du schéma
-- public — aucun oubli possible, contrairement à une liste manuelle.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.detect_supabase_storage_urls(old_prefix text)
RETURNS TABLE(table_name text, column_name text, data_type text, hits bigint)
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT c.table_name AS t, c.column_name AS c, c.data_type AS dt
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.is_generated = 'NEVER'
      AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
      AND c.table_name NOT LIKE '\_migr%'        -- tables de backup éventuelles
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE %I::text LIKE %L',
      r.t, r.c, '%' || old_prefix || '%'
    ) INTO n;
    IF n > 0 THEN
      table_name := r.t; column_name := r.c; data_type := r.dt; hits := n;
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

-- Le préfixe Supabase Storage est connu (projet jzeojdpgglbxjdasjgta, public).
SELECT *
FROM pg_temp.detect_supabase_storage_urls(
  'https://jzeojdpgglbxjdasjgta.supabase.co/storage/v1/object/public/'
)
ORDER BY hits DESC, table_name, column_name;
