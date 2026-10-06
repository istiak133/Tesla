-- When the car last arrived at a stop (audit fix: the no-show wait counts from here, and a
-- rider seated after the car arrived does not stop it from leaving).
ALTER TABLE "pools" ADD COLUMN "arrived_at" TIMESTAMPTZ(6);
