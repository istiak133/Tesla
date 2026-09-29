"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Ride, Route, Zone } from "@/lib/types";
import { Button, Card, ErrorNote, Field, inputClass, Loading } from "../ui";

export function RequestForm() {
  const queryClient = useQueryClient();
  const zones = useQuery({
    queryKey: ["zones"],
    queryFn: () => api<Zone[]>("/zones"),
    staleTime: Infinity, // zones never change
  });
  const routes = useQuery({
    queryKey: ["routes"],
    queryFn: () => api<Route[]>("/routes"),
    staleTime: Infinity, // routes never change
  });

  const [pickupZoneId, setPickupZoneId] = useState("");
  const [dropoffZoneId, setDropoffZoneId] = useState("");
  const [seats, setSeats] = useState(1);

  const request = useMutation({
    mutationFn: () =>
      api<Ride>("/rides", {
        method: "POST",
        body: { pickupZoneId, dropoffZoneId, seats },
      }),
    onSuccess: (ride) => {
      queryClient.setQueryData(["current-ride"], { ride });
      queryClient.invalidateQueries({ queryKey: ["ride-history"] });
    },
  });

  // Tesla Pool drives fixed routes: only zones later on a route through the pickup can be reached.
  const servingRoutes = (routes.data ?? []).filter((route) => {
    const from = route.stops.findIndex((stop) => stop.zone.id === pickupZoneId);
    const to = route.stops.findIndex((stop) => stop.zone.id === dropoffZoneId);
    return from !== -1 && (dropoffZoneId === "" || to > from);
  });
  const reachable = new Set<string>();
  for (const route of routes.data ?? []) {
    const from = route.stops.findIndex((stop) => stop.zone.id === pickupZoneId);
    if (from === -1) continue;
    for (const stop of route.stops.slice(from + 1)) reachable.add(stop.zone.id);
  }

  return (
    <Card title="Request a ride">
      {(zones.isPending || routes.isPending) && (
        <Loading label="Loading zones…" />
      )}
      {zones.isError && <ErrorNote message={zones.error.message} />}
      {routes.isError && <ErrorNote message={routes.error.message} />}
      {zones.data && routes.data && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            request.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pickup">
              <select
                className={inputClass}
                required
                value={pickupZoneId}
                onChange={(event) => {
                  setPickupZoneId(event.target.value);
                  setDropoffZoneId("");
                }}
              >
                <option value="">Choose a zone</option>
                {zones.data.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Destination">
              <select
                className={inputClass}
                required
                disabled={pickupZoneId === ""}
                value={dropoffZoneId}
                onChange={(event) => setDropoffZoneId(event.target.value)}
              >
                <option value="">
                  {pickupZoneId === ""
                    ? "Choose a pickup first"
                    : "Choose a zone"}
                </option>
                {zones.data
                  .filter((zone) => reachable.has(zone.id))
                  .map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>

          <Field label="Seats">
            <div className="flex gap-2">
              {[1, 2, 3].map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setSeats(count)}
                  className={`h-10 w-12 rounded-lg border text-sm font-medium transition ${
                    seats === count
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-300 bg-white hover:border-zinc-500"
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </Field>

          {pickupZoneId !== "" && dropoffZoneId !== "" && (
            <p className="text-xs text-zinc-500">
              On {servingRoutes.map((route) => route.name).join(" or ")}. A
              Tesla already on the way can pick you up if it has not passed your
              stop.
            </p>
          )}
          {request.isError && <ErrorNote message={request.error.message} />}

          <div className="flex items-center justify-between gap-4 pt-1">
            <p className="text-xs text-zinc-500">
              Fare: (৳30 + ৳15 per km) × seats. 20% off if you share any hop
              with another passenger.
            </p>
            <Button type="submit" loading={request.isPending}>
              Request ride
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
