"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { taka } from "@/lib/format";
import type { DriverState } from "@/lib/types";
import { Button, Card, EmptyState, ErrorNote, StatusBadge } from "../ui";

type Action = "arrive" | "start" | "complete" | "cancel";

// The one next step for each trip status.
const NEXT_ACTION: Record<string, { action: Action; label: string } | null> = {
  MATCHED: { action: "arrive", label: "I have arrived" },
  DRIVER_ARRIVED: { action: "start", label: "Start trip" },
  STARTED: { action: "complete", label: "Complete trip" },
};

export function CurrentTrip({ state }: { state: DriverState }) {
  const queryClient = useQueryClient();
  const move = useMutation({
    mutationFn: (action: Action) =>
      api<DriverState>(`/driver/pool/${action}`, { method: "POST" }),
    onSuccess: (next) => {
      queryClient.setQueryData(["driver-state"], next);
      queryClient.invalidateQueries({ queryKey: ["driver-requests"] });
    },
  });

  const pool = state.pool;
  if (pool === null) {
    return (
      <Card title="Current trip">
        <EmptyState
          title="No trip yet"
          hint={
            state.vehicle.isOnline
              ? "Accept a waiting request to start a pool."
              : "Go online to see and accept requests."
          }
        />
      </Card>
    );
  }

  const next = NEXT_ACTION[pool.status];
  const canCancel = pool.status === "MATCHED" || pool.status === "DRIVER_ARRIVED";

  return (
    <Card title="Current trip" action={<StatusBadge status={pool.status} />}>
      <div className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-2xl font-semibold tracking-tight">
              Pickup at {pool.pickup}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {pool.passengers.length}{" "}
              {pool.passengers.length === 1 ? "passenger" : "passengers"}
            </p>
          </div>
          <SeatMeter taken={pool.seatsTaken} capacity={pool.seatCapacity} />
        </div>

        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {pool.passengers.map((passenger) => (
            <li
              key={passenger.rideId}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">{passenger.name}</p>
                <p className="text-xs text-zinc-500">
                  To {passenger.dropoff} · {passenger.seats}{" "}
                  {passenger.seats === 1 ? "seat" : "seats"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium">
                  {taka(passenger.finalFarePaisa ?? passenger.estimatedFarePaisa)}
                </p>
                <p className="text-xs text-zinc-500">
                  {passenger.finalFarePaisa === null ? "estimate" : "cash"}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {move.isError && <ErrorNote message={move.error.message} />}

        <div className="flex flex-wrap justify-end gap-2">
          {canCancel && (
            <Button
              variant="danger"
              loading={move.isPending && move.variables === "cancel"}
              disabled={move.isPending}
              onClick={() => move.mutate("cancel")}
            >
              Cancel trip
            </Button>
          )}
          {next && (
            <Button
              loading={move.isPending && move.variables === next.action}
              disabled={move.isPending}
              onClick={() => move.mutate(next.action)}
            >
              {next.label}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Three small boxes, filled for taken seats. */
function SeatMeter({ taken, capacity }: { taken: number; capacity: number }) {
  return (
    <div className="text-right">
      <div className="flex justify-end gap-1.5">
        {Array.from({ length: capacity }, (_, index) => (
          <span
            key={index}
            className={`h-6 w-6 rounded-md border ${
              index < taken
                ? "border-zinc-900 bg-zinc-900"
                : "border-zinc-300 bg-white"
            }`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {taken} of {capacity} seats taken
      </p>
    </div>
  );
}
