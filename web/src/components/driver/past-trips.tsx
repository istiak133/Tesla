"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dhakaTime, taka } from "@/lib/format";
import type { PastTrip } from "@/lib/types";
import { Card, EmptyState, ErrorNote, Loading, StatusBadge } from "../ui";

export function PastTrips() {
  const trips = useQuery({
    queryKey: ["driver-trips"],
    queryFn: () => api<PastTrip[]>("/driver/trips"),
    refetchInterval: 10000,
  });

  return (
    <Card title="Past trips">
      {trips.isPending && <Loading />}
      {trips.isError && <ErrorNote message={trips.error.message} />}
      {trips.data && trips.data.length === 0 && (
        <EmptyState
          title="No trips yet"
          hint="Completed and cancelled trips appear here."
        />
      )}
      {trips.data && trips.data.length > 0 && (
        <ul className="divide-y divide-zinc-100">
          {trips.data.map((trip) => (
            <li key={trip.id} className="py-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">From {trip.pickup}</p>
                  <p className="text-xs text-zinc-500">
                    {trip.endedAt ? dhakaTime(trip.endedAt) : "—"} ·{" "}
                    {trip.passengers.length > 0
                      ? trip.passengers
                          .map((p) => `${p.name} → ${p.dropoff}`)
                          .join(", ")
                      : "No passengers"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {trip.status === "COMPLETED" && (
                    <span className="font-medium">
                      {taka(trip.totalFarePaisa)}
                    </span>
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
