-- Adds real authentication fields to the User table.
-- Postgres-compatible. If the column already exists on some environments
-- (because an earlier shadow migration added it), the IF NOT EXISTS guards
-- are defensive.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "passwordHash" TEXT,
  ADD COLUMN IF NOT EXISTS "driverId"     TEXT,
  ADD COLUMN IF NOT EXISTS "lastLoginAt"  TIMESTAMP(3);

-- Flip the default and normalise legacy values so the role domain matches
-- the app's runtime roles (admin | employee | driver).
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'employee';
UPDATE "User" SET "role" = 'employee' WHERE "role" = 'DISPATCHER';

-- New index on role speeds up the "list users by role" page.
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");

-- passwordHash must be NOT NULL for any new row. We can't retro-fill
-- unknown hashes, so existing rows (if any) get a placeholder that no
-- real password can ever match — forces them to go through a password
-- reset flow before they can log in.
UPDATE "User"
   SET "passwordHash" = 'pbkdf2$0$reset_required$reset_required'
 WHERE "passwordHash" IS NULL;

ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;
