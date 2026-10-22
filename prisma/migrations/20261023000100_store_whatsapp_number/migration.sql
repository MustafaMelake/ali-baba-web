-- The store's WhatsApp number (canonical E.164, normalizeEgyptMobile) for the
-- /forgot-password hand-off. Nullable — existing rows are untouched; null
-- means "not configured" and the page shows a neutral message.
-- Purely additive.

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "whatsappNumber" TEXT;
