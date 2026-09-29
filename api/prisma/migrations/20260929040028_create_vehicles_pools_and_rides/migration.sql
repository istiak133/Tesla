-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "seat_capacity" INTEGER NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pools" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "pickup_zone_id" UUID NOT NULL,
    "status" "RideStatus" NOT NULL DEFAULT 'MATCHED',
    "seat_capacity" INTEGER NOT NULL,
    "seats_taken" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_requests" (
    "id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "pickup_zone_id" UUID NOT NULL,
    "dropoff_zone_id" UUID NOT NULL,
    "seats" INTEGER NOT NULL,
    "status" "RideStatus" NOT NULL DEFAULT 'REQUESTED',
    "distance_km" INTEGER NOT NULL,
    "estimated_fare_paisa" INTEGER NOT NULL,
    "final_fare_paisa" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ride_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_members" (
    "id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "ride_request_id" UUID NOT NULL,
    "seats" INTEGER NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),

    CONSTRAINT "pool_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_events" (
    "id" UUID NOT NULL,
    "ride_request_id" UUID NOT NULL,
    "pool_id" UUID,
    "from_status" "RideStatus",
    "to_status" "RideStatus" NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_driver_id_key" ON "vehicles"("driver_id");

-- CreateIndex
CREATE INDEX "pools_status_pickup_zone_id_idx" ON "pools"("status", "pickup_zone_id");

-- CreateIndex
CREATE INDEX "ride_requests_status_created_at_idx" ON "ride_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "ride_requests_passenger_id_created_at_idx" ON "ride_requests"("passenger_id", "created_at");

-- CreateIndex
CREATE INDEX "pool_members_pool_id_idx" ON "pool_members"("pool_id");

-- CreateIndex
CREATE INDEX "ride_events_ride_request_id_created_at_idx" ON "ride_events"("ride_request_id", "created_at");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_pickup_zone_id_fkey" FOREIGN KEY ("pickup_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_pickup_zone_id_fkey" FOREIGN KEY ("pickup_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_dropoff_zone_id_fkey" FOREIGN KEY ("dropoff_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_ride_request_id_fkey" FOREIGN KEY ("ride_request_id") REFERENCES "ride_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_ride_request_id_fkey" FOREIGN KEY ("ride_request_id") REFERENCES "ride_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written guards. Prisma schema cannot express these (see docs/erd.md).
-- They hold even if application code has a bug.
-- ---------------------------------------------------------------------------

-- A vehicle has at least one seat.
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_seat_capacity_positive" CHECK ("seat_capacity" > 0);

-- I1: seats taken can never exceed the pool's capacity (or go negative).
ALTER TABLE "pools" ADD CONSTRAINT "pools_seats_within_capacity" CHECK ("seats_taken" BETWEEN 0 AND "seat_capacity");

-- A pool is never in REQUESTED status.
ALTER TABLE "pools" ADD CONSTRAINT "pools_status_not_requested" CHECK ("status" <> 'REQUESTED');

-- Valid ride requests: 1 to 3 seats, different pickup and drop-off, non-negative money.
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_seats_range" CHECK ("seats" BETWEEN 1 AND 3);
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_different_zones" CHECK ("pickup_zone_id" <> "dropoff_zone_id");
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_fares_non_negative" CHECK ("estimated_fare_paisa" >= 0 AND ("final_fare_paisa" IS NULL OR "final_fare_paisa" >= 0));

-- I4: one active pool per vehicle.
CREATE UNIQUE INDEX "pools_one_active_per_vehicle" ON "pools" ("vehicle_id")
  WHERE "status" IN ('MATCHED', 'DRIVER_ARRIVED', 'STARTED');

-- I5: one active ride request per passenger.
CREATE UNIQUE INDEX "ride_requests_one_active_per_passenger" ON "ride_requests" ("passenger_id")
  WHERE "status" IN ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED');

-- I2: a request holds seats in at most one pool at a time.
CREATE UNIQUE INDEX "pool_members_one_active_per_request" ON "pool_members" ("ride_request_id")
  WHERE "left_at" IS NULL;
