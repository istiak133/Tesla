-- The trip a late-cancel fee was earned on (D-018), so the right driver is paid even if the ride
-- had been in an earlier trip that the driver cancelled.

-- AlterTable
ALTER TABLE "ride_requests" ADD COLUMN     "cancellation_fee_pool_id" UUID;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_cancellation_fee_pool_id_fkey" FOREIGN KEY ("cancellation_fee_pool_id") REFERENCES "pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: a fee always names its trip, and a trip is named only for a fee.
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_fee_has_pool"
  CHECK (("cancellation_fee_paisa" = 0) = ("cancellation_fee_pool_id" IS NULL));
CREATE INDEX "ride_requests_cancellation_fee_pool_idx" ON "ride_requests" ("cancellation_fee_pool_id")
  WHERE "cancellation_fee_pool_id" IS NOT NULL;
