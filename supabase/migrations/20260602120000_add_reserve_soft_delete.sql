-- Keep deleted reserves recoverable after accidental UI/offline-sync deletes.
-- Active application queries hide rows where deleted_at is not null.

alter table public.reserves
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

create index if not exists idx_reserves_not_deleted
  on public.reserves(chantier_id, plan_id)
  where deleted_at is null;

comment on column public.reserves.deleted_at is
  'Soft-delete timestamp. NULL means the reserve is active/recoverable in normal views.';

comment on column public.reserves.deleted_by is
  'Display name or email of the user/process that moved the reserve to the trash.';
