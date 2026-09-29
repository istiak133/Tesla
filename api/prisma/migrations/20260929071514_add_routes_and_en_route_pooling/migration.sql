-- En-route pooling (docs/assumptions.md §3.3, §4): fixed routes with ordered stops.
-- A pool now follows its vehicle's route; members record where they get on and off.
-- Required columns without defaults: apply on a database with no pools (true before the first deploy).
-- DropForeignKey
ALTER TABLE "pools" DROP CONSTRAINT "pools_pickup_zone_id_fkey";

-- DropIndex
DROP INDEX "pools_status_pickup_zone_id_idx";

-- AlterTable
ALTER TABLE "pool_members" ADD COLUMN     "dropoff_stop" INTEGER NOT NULL,
ADD COLUMN     "pickup_stop" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "pools" DROP COLUMN "pickup_zone_id",
ADD COLUMN     "current_stop" INTEGER NOT NULL,
ADD COLUMN     "route_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "route_id" UUID;

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "route_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "zone_id" UUID NOT NULL,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("route_id","position")
);

-- CreateIndex
CREATE UNIQUE INDEX "routes_code_key" ON "routes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "routes_name_key" ON "routes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_route_id_zone_id_key" ON "route_stops"("route_id", "zone_id");

-- CreateIndex
CREATE INDEX "pools_status_route_id_idx" ON "pools"("status", "route_id");

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written guards. Prisma schema cannot express these.
-- ---------------------------------------------------------------------------

-- Stop positions start at 0.
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_position_non_negative" CHECK ("position" >= 0);
ALTER TABLE "pools" ADD CONSTRAINT "pools_current_stop_non_negative" CHECK ("current_stop" >= 0);

-- A passenger always gets off after getting on, in the route's direction.
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_pickup_before_dropoff" CHECK ("pickup_stop" >= 0 AND "pickup_stop" < "dropoff_stop");
