-- Fare economics (docs/assumptions.md §3.3, §7.2): route km on every stop, and who got
-- what from each completed trip.

-- AlterTable
ALTER TABLE "pools" ADD COLUMN     "collected_paisa" INTEGER,
ADD COLUMN     "driver_earnings_paisa" INTEGER,
ADD COLUMN     "platform_fee_paisa" INTEGER;

-- AlterTable: added with a temporary default so existing stops can be filled in below.
ALTER TABLE "route_stops" ADD COLUMN     "km_from_start" INTEGER NOT NULL DEFAULT 0;

-- Existing routes: km from the first stop = the hops before this stop, added up.
UPDATE "route_stops" AS rs
SET "km_from_start" = sums."km"
FROM (
  SELECT s."route_id", s."position",
         COALESCE(SUM(zd."km") OVER (
           PARTITION BY s."route_id" ORDER BY s."position"
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS "km"
  FROM "route_stops" s
  LEFT JOIN "route_stops" nxt
         ON nxt."route_id" = s."route_id" AND nxt."position" = s."position" + 1
  LEFT JOIN "zone_distances" zd
         ON zd."from_zone_id" = s."zone_id" AND zd."to_zone_id" = nxt."zone_id"
) AS sums
WHERE rs."route_id" = sums."route_id" AND rs."position" = sums."position";

ALTER TABLE "route_stops" ALTER COLUMN "km_from_start" DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- Hand-written guards. Prisma schema cannot express these.
-- ---------------------------------------------------------------------------

ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_km_non_negative" CHECK ("km_from_start" >= 0);

-- Money never goes negative for the passengers or the driver, and the split always adds up.
ALTER TABLE "pools" ADD CONSTRAINT "pools_earnings_non_negative" CHECK (
  ("collected_paisa" IS NULL OR "collected_paisa" >= 0) AND
  ("driver_earnings_paisa" IS NULL OR "driver_earnings_paisa" >= 0)
);
ALTER TABLE "pools" ADD CONSTRAINT "pools_earnings_add_up" CHECK (
  "collected_paisa" IS NULL OR
  "collected_paisa" = "driver_earnings_paisa" + "platform_fee_paisa"
);
