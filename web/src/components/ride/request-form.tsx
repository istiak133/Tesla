"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Ride, Zone } from "@/lib/types";
import { Button, Card, ErrorNote, Field, inputClass, Loading } from "../ui";

export function RequestForm() {
  const queryClient = useQueryClient();
  const zones = useQuery({
    queryKey: ["zones"],
    queryFn: () => api<Zone[]>("/zones"),
    staleTime: Infinity, // zones never change
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

  const sameZone = pickupZoneId !== "" && pickupZoneId === dropoffZoneId;

  return (
    <Card title="Request a ride">
      {zones.isPending && <Loading label="Loading zones…" />}
      {zones.isError && <ErrorNote message={zones.error.message} />}
      {zones.data && (
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
                onChange={(event) => setPickupZoneId(event.target.value)}
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
                value={dropoffZoneId}
                onChange={(event) => setDropoffZoneId(event.target.value)}
              >
                <option value="">Choose a zone</option>
                {zones.data.map((zone) => (
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

          {sameZone && (
            <ErrorNote message="Pickup and destination must be different." />
          )}
          {request.isError && <ErrorNote message={request.error.message} />}

          <div className="flex items-center justify-between gap-4 pt-1">
            <p className="text-xs text-zinc-500">
              Fare: (৳30 + ৳15 per km) × seats. 20% off when you share the
              ride.
            </p>
            <Button type="submit" loading={request.isPending} disabled={sameZone}>
              Request ride
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
