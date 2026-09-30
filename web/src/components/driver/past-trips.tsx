"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRefreshInterval } from "@/lib/live";
import { dhakaTime, taka } from "@/lib/format";
import type { PastTrip } from "@/lib/types";
import { Card, EmptyState, ErrorNote, Loading, StatusBadge } from "../ui";

export function PastTrips() {
  const refetchInterval = useRefreshInterval(10000);
  const trips = useQuery({
    queryKey: ["driver-trips"],
    queryFn: () => api<PastTrip[]>("/driver/trips"),
    refetchInterval,
  });

  // Totals over the trips listed: what the driver keeps and what is owed to the platform.
  // Late-cancel fees (D-018) are the driver's, paid by the platform, so they lower what the
  // driver owes; earlier riders' fees collected in cash belong to the platform, so they raise it.
  let earned = 0;
  let fees = 0;
  for (const trip of trips.data ?? []) {
    earned += (trip.driverEarningsPaisa ?? 0) + trip.cancellationFeesPaisa;
    fees +=
      (trip.platformFeePaisa ?? 0) +
      trip.duesCollectedPaisa -
      trip.cancellationFeesPaisa;
  }

  return (
    <Card
      title="Past trips"
      action={
        earned > 0 ? (
          <p className="text-sm text-stone-600">
            Earned <span className="font-medium">{taka(earned)}</span> ·{" "}
            {fees >= 0
              ? `platform fee owed ${taka(fees)}`
              : `the platform owes you ${taka(-fees)}`}
          </p>
        ) : undefined
      }
    >
      {trips.isPending && <Loading />}
      {trips.isError && <ErrorNote message={trips.error.message} />}
      {trips.data && trips.data.length === 0 && (
        <EmptyState
          title="No trips yet"
          hint="Completed and cancelled trips appear here."
        />
      )}
      {trips.data && trips.data.length > 0 && (
        <ul className="divide-y divide-stone-100">
          {trips.data.map((trip) => (
            <li key={trip.id} className="py-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{trip.route}</p>
                  <p className="text-xs text-stone-500">
                    {trip.endedAt ? dhakaTime(trip.endedAt) : "—"} ·{" "}
                    {trip.passengers.length > 0
                      ? trip.passengers
                          .map((p) => `${p.name} ${p.pickup} → ${p.dropoff}`)
                          .join(", ")
                      : "No passengers"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {(trip.driverEarningsPaisa !== null ||
                    trip.cancellationFeesPaisa > 0) && (
                    <div className="text-right">
                      <p className="font-medium">
                        You earned{" "}
                        {taka(
                          (trip.driverEarningsPaisa ?? 0) +
                            trip.cancellationFeesPaisa,
                        )}
                      </p>
                      {trip.driverEarningsPaisa !== null && (
                        <p className="text-xs text-stone-500">
                          {taka(trip.collectedPaisa ?? 0)} cash · platform fee{" "}
                          {taka(trip.platformFeePaisa ?? 0)}
                        </p>
                      )}
                      {trip.cancellationFeesPaisa > 0 && (
                        <p className="text-xs text-emerald-700">
                          incl. {taka(trip.cancellationFeesPaisa)} late-cancel
                          fee ({trip.lateCancels.join(", ")})
                        </p>
                      )}
                      {trip.duesCollectedPaisa > 0 && (
                        <p className="text-xs text-amber-800">
                          + {taka(trip.duesCollectedPaisa)} cancel fees
                          collected for the platform
                        </p>
                      )}
                    </div>
                  )}
                  <StatusBadge status={trip.status} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
