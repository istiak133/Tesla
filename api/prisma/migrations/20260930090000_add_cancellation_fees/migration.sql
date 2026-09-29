-- Late cancel and no-show fees (D-018): a fee of Tk 20 on the cancelled ride, owed by the passenger
-- and paid in cash with their next ride; that ride records what its driver collected.

-- AlterTable
ALTER TABLE "ride_requests" ADD COLUMN     "cancellation_fee_paisa" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dues_collected_paisa" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fee_paid_with_ride_id" UUID;

-- AddForeignKey
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_fee_paid_with_ride_id_fkey" FOREIGN KEY ("fee_paid_with_ride_id") REFERENCES "ride_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: the money columns stay sane even if the app has a bug.
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_fees_not_negative"
  CHECK ("cancellation_fee_paisa" >= 0 AND "dues_collected_paisa" >= 0);
-- Only a cancelled ride can carry a fee, and only a ride with a fee can be marked paid.
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_fee_only_when_cancelled"
  CHECK ("cancellation_fee_paisa" = 0 OR "status" = 'CANCELLED');
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_fee_paid_needs_fee"
  CHECK ("fee_paid_with_ride_id" IS NULL OR "cancellation_fee_paisa" > 0);

-- Finding what a passenger still owes.
CREATE INDEX "ride_requests_unpaid_fees_idx" ON "ride_requests" ("passenger_id")
  WHERE "cancellation_fee_paisa" > 0 AND "fee_paid_with_ride_id" IS NULL;
