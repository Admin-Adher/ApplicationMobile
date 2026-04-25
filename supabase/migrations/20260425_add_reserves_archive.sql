-- Migration : séparer les notions "Clôturée" et "Archivée"
--
-- Avant : le swipe "Archiver" sur une réserve fait juste passer le statut à
-- 'closed', et le mot "archivée" est utilisé comme synonyme de "clôturée".
--
-- Après : "Clôturer" reste un changement de statut métier (la réserve est
-- résolue/validée), et "Archiver" devient une action distincte qui masque la
-- réserve des vues actives sans changer son statut. On peut donc archiver
-- une réserve dans n'importe quel statut, et la désarchiver à tout moment.
--
-- Implémentation : 2 colonnes nullables sur la table `reserves`.
--   - archived_at : timestamp de la mise en archive (NULL = non archivée)
--   - archived_by : nom de l'utilisateur qui a archivé (informatif)

ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by TEXT;

-- Index partiel : la grande majorité des requêtes vont filtrer
-- "archived_at IS NULL" pour exclure les archives. Un index partiel est
-- beaucoup plus léger qu'un index complet et accélère ces filtres.
CREATE INDEX IF NOT EXISTS reserves_active_idx
  ON public.reserves (organization_id, chantier_id)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN public.reserves.archived_at IS
  'Timestamp d''archivage. NULL = réserve active. Indépendant du statut.';
COMMENT ON COLUMN public.reserves.archived_by IS
  'Nom de l''utilisateur ayant archivé la réserve.';
