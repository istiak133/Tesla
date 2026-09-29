"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dhakaTime, taka } from "@/lib/format";
import type { Ride } from "@/lib/types";
import { Button, Card, ErrorNote, StatusBadge } from "../ui";
import { ProgressSteps } from "./progress-steps";

const CANCELLABLE = ["REQUESTED", "MATCHED", "DRIVER_ARRIVED"];

export function CurrentRide({ ride }: { ride: Ride }) {
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api<Ride>(`/rides/${ride.id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["current-ride"] });
      queryClient.invalidateQueries({ queryKey: ["ride-history"] });
    },
  });

  const fareIsFinal = ride.finalFarePaisa !== null;

  return (
    <Card title="Your ride" action={<StatusBadge status={ride.status} />}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-2xl font-semibold tracking-tight">
              {ride.pickup.name} → {ride.dropoff.name}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {ride.distanceKm} km · {ride.seats}{" "}
              {ride.seats === 1 ? "seat" : "seats"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tracking-tight">
              {taka(ride.finalFarePaisa ?? ride.estimatedFarePaisa)}
            </p>
            <p className="text-xs text-zinc-500">
              {fareIsFinal
                ? "Final fare · pay in cash"
                : "Estimate · the most you will pay"}
            </p>
          </div>
        </div>

        <ProgressSteps status={ride.status} />

        <dl className="grid gap-4 border-t border-zinc-100 pt-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Driver</dt>
            <dd className="mt-0.5 font-medium">
              {ride.driver
                ? `${ride.driver.name} · ${ride.driver.vehicleName}`
                : "Looking for a driver…"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Sharing with</dt>
            <dd className="mt-0.5 font-medium">
              {ride.coRiders.length > 0
                ? ride.coRiders.join(", ")
                : "Nobody yet"}
            </dd>
          </div>
        </dl>

        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-800">
            Ride history
          </summary>
          <ul className="mt-3 space-y-2">
            {ride.history.map((event, index) => (
              <li key={index} className="flex justify-between gap-4">
                <span>{event.reason}</span>
                <span className="shrink-0 text-zinc-400">
                  {dhakaTime(event.at)}
                </span>
              </li>
            ))}
          </ul>
        </details>

        {cancel.isError && <ErrorNote message={cancel.error.message} />}
        {CANCELLABLE.includes(ride.status) && (
          <div className="flex justify-end">
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancel ride
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
