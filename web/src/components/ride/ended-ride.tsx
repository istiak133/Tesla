"use client";

import { taka } from "@/lib/format";
import type { Ride } from "@/lib/types";
import { Button, Card, StatusBadge } from "../ui";

/**
 * The ride that just ended: at a drop-off, what to pay in cash; after a no-show, a driver who
 * stopped responding or a cancel, what happened. Without it the card vanished at the drop-off
 * and the rider about to pay saw only "Request a ride".
 */
export function EndedRide({
  ride,
  onDone,
}: {
  ride: Ride;
  onDone: () => void;
}) {
  const completed = ride.status === "COMPLETED";
  const fare = ride.finalFarePaisa ?? ride.estimatedFarePaisa;
  const reason = ride.history.at(-1)?.reason ?? "";

  return (
    <Card
      title={completed ? "You have arrived" : "Your ride ended"}
      action={<StatusBadge status={ride.status} />}
    >
      <div className="space-y-4" role="status">
        <p className="text-2xl font-semibold tracking-tight">
          {ride.pickup.name} → {ride.dropoff.name}
        </p>
        {completed ? (
          <div>
            <p className="text-lg font-semibold">
              Pay {taka(fare + ride.duesPaisa)} in cash
            </p>
            <p className="mt-1 text-sm text-stone-500">
              Fare {taka(fare)}
              {fare < ride.estimatedFarePaisa
                ? " (shared, 20% off)"
                : " (rode alone)"}
              {ride.duesPaisa > 0 &&
                ` + ${taka(ride.duesPaisa)} from an earlier late cancel`}
            </p>
          </div>
        ) : (
          <div>
            <p className="text-sm">{reason}</p>
            {ride.cancellationFeePaisa > 0 && (
              <p className="mt-1 text-sm font-medium text-amber-800">
                A {taka(ride.cancellationFeePaisa)} fee is added to your next
                ride.
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={onDone}>
            {completed ? "Done" : "Book another ride"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
