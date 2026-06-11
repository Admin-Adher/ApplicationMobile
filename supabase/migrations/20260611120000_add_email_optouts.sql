-- Désinscription des emails de notification (RGPD / CAN-SPAM).
-- Alimentée par /api/email-optout (lien signé HMAC dans le pied de page des
-- emails), consultée avant chaque envoi non transactionnel (send-email,
-- cron de relance des réserves en retard, partage de rapport PDF).
-- Accès uniquement via le client service-role : aucune policy publique.

create table if not exists public.email_optouts (
  email text primary key,
  created_at timestamptz not null default now(),
  source text not null default 'link'
);

alter table public.email_optouts enable row level security;

revoke all on table public.email_optouts from anon, authenticated;

notify pgrst, 'reload schema';
