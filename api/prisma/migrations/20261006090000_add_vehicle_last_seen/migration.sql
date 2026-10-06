-- When the driver's app last reached the API (audit fix: a driver who goes silent mid-trip).
-- NULL means not seen since this column was added; the next driver request sets it.
ALTER TABLE "vehicles" ADD COLUMN "last_seen_at" TIMESTAMPTZ(6);
