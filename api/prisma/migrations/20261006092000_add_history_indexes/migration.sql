-- Indexes for a driver's past trips and a passenger's ride screen (audit fix): both queries
-- used to scan, because the existing indexes on these columns are partial (active rows only).

-- CreateIndex
CREATE INDEX "pool_members_ride_request_id_joined_at_idx" ON "pool_members"("ride_request_id", "joined_at" DESC);

-- CreateIndex
CREATE INDEX "pools_vehicle_id_created_at_idx" ON "pools"("vehicle_id", "created_at" DESC);

