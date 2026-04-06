-- Add per-user permission overrides to profiles
-- Stored as a JSONB object containing only the keys that differ from the role default.
-- Example: {"canDelete": true, "canMovePins": false}
-- An empty object {} means "use role defaults" (no overrides).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS permissions_override jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN profiles.permissions_override IS
  'Per-user permission overrides applied on top of role defaults. Only keys that differ from the role default are stored.';
