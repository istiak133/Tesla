"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { CurrentTrip } from "@/components/driver/current-trip";
import { PastTrips } from "@/components/driver/past-trips";
import { RoutePicker } from "@/components/driver/route-picker";
import { WaitingRequests } from "@/components/driver/waiting-requests";
import { Button, ErrorNote, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import type { DriverState } from "@/lib/types";

// Driver home: route, availability, the current trip and the waiting requests (refreshed every 3 seconds).
export default function DriverPage() {
  return <AppShell role="DRIVER">{() => <DriverHome />}</AppShell>;
}

function DriverHome() {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: ["driver-state"],
    queryFn: () => api<DriverState>("/driver/pool"),
    refetchInterval: 3000,
  });

  const toggle = useMutation({
    mutationFn: (online: boolean) =>
      api<DriverState>(online ? "/driver/online" : "/driver/offline", {
        method: "POST",
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(["driver-state"], next);
      queryClient.invalidateQueries({ queryKey: ["driver-requests"] });
    },
  });

  if (state.isPending) return <Loading label="Loading your vehicle…" />;
  if (state.isError) return <ErrorNote message={state.error.message} />;

  const { vehicle } = state.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${vehicle.isOnline ? "bg-emerald-500" : "bg-zinc-300"}`}
          />
          <div>
            <p className="font-medium">
              {vehicle.name} · {vehicle.seatCapacity} seats
            </p>
            <p className="text-sm text-zinc-500">
              {vehicle.isOnline
                ? `Online on ${vehicle.route?.name ?? "no route"}`
                : vehicle.route
                  ? "Offline"
                  : "Offline · choose a route to go online"}
            </p>
          </div>
        </div>
        <Button
          variant={vehicle.isOnline ? "secondary" : "primary"}
          loading={toggle.isPending}
          disabled={!vehicle.isOnline && vehicle.route === null}
          onClick={() => toggle.mutate(!vehicle.isOnline)}
        >
          {vehicle.isOnline ? "Go offline" : "Go online"}
        </Button>
      </div>
      {toggle.isError && <ErrorNote message={toggle.error.message} />}

      <RoutePicker state={state.data} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CurrentTrip state={state.data} />
        <WaitingRequests />
      </div>
      <PastTrips />
    </div>
  );
}
