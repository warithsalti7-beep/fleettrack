-- Add per-user permission grants to the User table.
-- Nullable: NULL means "use role defaults".
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "permissions" JSONB;
