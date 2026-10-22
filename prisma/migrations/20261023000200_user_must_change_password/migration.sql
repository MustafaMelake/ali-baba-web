-- Forced password change after an ADMIN reset (temporary password sent on
-- WhatsApp). Defaults false, so every existing user is unaffected; only
-- resetUserPassword sets it and only changeTemporaryPassword clears it.
-- Purely additive (NOT NULL with a constant default: a metadata-only change on
-- Postgres 11+, no table rewrite).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
