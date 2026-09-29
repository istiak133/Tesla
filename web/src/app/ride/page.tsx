"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { CurrentRide } from "@/components/ride/current-ride";
import { RequestForm } from "@/components/ride/request-form";
import { RideHistory } from "@/components/ride/ride-history";
import { ErrorNote, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useRefreshInterval } from "@/lib/live";
import type { Ride } from "@/lib/types";

// Passenger home: the active ride (live updates; polling every 3 s if the stream is down) or the request form.
export default function RidePage() {
  return <AppShell role="PASSENGER">{() => <PassengerHome />}</AppShell>;
}

function PassengerHome() {
  const refetchInterval = useRefreshInterval(3000);
  const current = useQuery({
    queryKey: ["current-ride"],
    queryFn: () => api<{ ride: Ride | null }>("/rides/current"),
    refetchInterval,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div>
        {current.isPending && <Loading label="Loading your ride…" />}
        {current.isError && <ErrorNote message={current.error.message} />}
        {current.data &&
          (current.data.ride ? (
            <CurrentRide ride={current.data.ride} />
          ) : (
            <RequestForm />
          ))}
      </div>
      <RideHistory />
    </div>
  );
}
