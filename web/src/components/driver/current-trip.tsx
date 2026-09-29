"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { taka } from "@/lib/format";
import type { DriverState, TripPassenger } from "@/lib/types";
import { RouteLine } from "../route-line";
import { Button, Card, EmptyState, ErrorNote, StatusBadge } from "../ui";

// Every trip action returns the new driver state.
// Passenger actions (pickup, dropoff, no-show) carry the ride id.
type Action = {
  kind: "arrive" | "depart" | "cancel" | "pickup" | "dropoff" | "no-show";
  rideId?: string;
};

function actionPath(action: Action): string {
  if (action.rideId === undefined) {
    return `/driver/pool/${action.kind}`;
  }
  return `/driver/pool/passengers/${action.rideId}/${action.kind}`;
}

function actionKey(action: Action): string {
  return `${action.kind}:${action.rideId ?? ""}`;
}

export function CurrentTrip({ state }: { state: DriverState }) {
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: (action: Action) =>
      api<DriverState>(actionPath(action), { method: "POST" }),
    onSuccess: (next) => {
      queryClient.setQueryData(["driver-state"], next);
      queryClient.invalidateQueries({ queryKey: ["driver-requests"] });
      queryClient.invalidateQueries({ queryKey: ["driver-trips"] });
    },
  });
  const busy = (action: Action) =>
    act.isPending &&
    act.variables !== undefined &&
    actionKey(act.variables) === actionKey(action);

  const pool = state.pool;
  if (pool === null) {
    return (
      <Card title="Current trip">
        <EmptyState
          title="No trip yet"
          hint={
            state.vehicle.isOnline
              ? "Accept a waiting request on your route to start a trip."
              : state.vehicle.route
                ? "Go online to see and accept requests."
                : "Choose a route and go online to see requests."
          }
        />
      </Card>
    );
  }

  const here = pool.stops[pool.currentStop];
  const next = pool.stops[pool.currentStop + 1];
  const atStop = pool.status === "DRIVER_ARRIVED";

  // What has to happen at this stop before the car can leave.
  const waitingHere = pool.passengers.filter(
    (p) => atStop && p.status === "DRIVER_ARRIVED",
  );
  const leavingHere = pool.passengers.filter(
    (p) =>
      atStop && p.status === "STARTED" && p.dropoffStop === pool.currentStop,
  );
  const stopIsDone = waitingHere.length === 0 && leavingHere.length === 0;

  const where =
    pool.status === "MATCHED"
      ? `Heading to ${here}`
      : atStop
        ? `At ${here}`
        : `On the way to ${here}`;

  return (
    <Card title="Current trip">
      <div className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {pool.route}
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              {where}
            </p>
          </div>
          <SeatMeter taken={pool.seatsTaken} capacity={pool.seatCapacity} />
        </div>

        <RouteLine
          stops={pool.stops}
          carStop={pool.currentStop}
          carAtStop={atStop}
          notes={stopNotes(pool.passengers)}
        />

        {atStop && !stopIsDone && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="text-sm font-medium text-emerald-900">At {here}</p>
            <ul className="mt-3 space-y-2">
              {leavingHere.map((p) => (
                <li
                  key={p.rideId}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span>
                    <span className="font-medium">{p.name}</span> gets off ·{" "}
                    {taka(p.estimatedFarePaisa)} or less
                  </span>
                  <Button
                    loading={busy({ kind: "dropoff", rideId: p.rideId })}
                    disabled={act.isPending}
                    onClick={() =>
                      act.mutate({ kind: "dropoff", rideId: p.rideId })
                    }
                  >
                    Drop off
                  </Button>
                </li>
              ))}
              {waitingHere.map((p) => (
                <li
                  key={p.rideId}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span>
                    <span className="font-medium">{p.name}</span> gets on · to{" "}
                    {p.dropoff} · {p.seats} {p.seats === 1 ? "seat" : "seats"}
                  </span>
                  <span className="flex gap-2">
                    <Button
                      variant="secondary"
                      loading={busy({ kind: "no-show", rideId: p.rideId })}
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({ kind: "no-show", rideId: p.rideId })
                      }
                    >
                      No-show
                    </Button>
                    <Button
                      loading={busy({ kind: "pickup", rideId: p.rideId })}
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({ kind: "pickup", rideId: p.rideId })
                      }
                    >
                      Picked up
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {pool.passengers.map((p) => (
            <li
              key={p.rideId}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
            >
              <div>
                <p className="flex items-center gap-2 font-medium">
                  {p.name} <StatusBadge status={p.status} />
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {p.pickup} → {p.dropoff} · {p.seats}{" "}
                  {p.seats === 1 ? "seat" : "seats"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium">
                  {taka(p.finalFarePaisa ?? p.estimatedFarePaisa)}
                </p>
                <p className="text-xs text-zinc-500">
                  {p.finalFarePaisa === null ? "estimate" : "cash, paid"}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {act.isError && <ErrorNote message={act.error.message} />}

        <div className="flex flex-wrap justify-end gap-2">
          {!pool.hasPickedUp && (
            <Button
              variant="danger"
              loading={busy({ kind: "cancel" })}
              disabled={act.isPending}
              onClick={() => act.mutate({ kind: "cancel" })}
            >
              Cancel trip
            </Button>
          )}
          {atStop ? (
            next !== undefined && (
              <Button
                loading={busy({ kind: "depart" })}
                disabled={act.isPending || !stopIsDone}
                onClick={() => act.mutate({ kind: "depart" })}
              >
                Leave for {next}
              </Button>
            )
          ) : (
            <Button
              loading={busy({ kind: "arrive" })}
              disabled={act.isPending}
              onClick={() => act.mutate({ kind: "arrive" })}
            >
              Arrive at {here}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/** "1 on · 1 off" under each stop that still has something to do. */
function stopNotes(passengers: TripPassenger[]): Record<number, string> {
  const on: Record<number, number> = {};
  const off: Record<number, number> = {};
  for (const p of passengers) {
    if (p.status === "MATCHED" || p.status === "DRIVER_ARRIVED") {
      on[p.pickupStop] = (on[p.pickupStop] ?? 0) + 1;
    }
    if (p.status !== "COMPLETED") {
      off[p.dropoffStop] = (off[p.dropoffStop] ?? 0) + 1;
    }
  }
  const notes: Record<number, string> = {};
  const stops = new Set([...Object.keys(on), ...Object.keys(off)].map(Number));
  for (const stop of stops) {
    const parts = [];
    if (on[stop]) parts.push(`${on[stop]} on`);
    if (off[stop]) parts.push(`${off[stop]} off`);
    notes[stop] = parts.join(" · ");
  }
  return notes;
}

/** One small box per seat, filled for taken seats. */
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
