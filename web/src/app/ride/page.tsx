"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { CurrentRide } from "@/components/ride/current-ride";
import { EndedRide } from "@/components/ride/ended-ride";
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

// The ended ride the rider has already closed, so it does not come back on the next poll.
// Per browser only: a convenience, the ride itself is in the history either way.
const DISMISSED_KEY = "tesla:dismissed-ended-ride";

function PassengerHome() {
  const refetchInterval = useRefreshInterval(3000);
  const current = useQuery({
    queryKey: ["current-ride"],
    queryFn: () =>
      api<{ ride: Ride | null; lastEnded: Ride | null }>("/rides/current"),
    refetchInterval,
  });
  // This screen renders only in the browser (after the session check), so storage is there.
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(DISMISSED_KEY);
    } catch {
      // Storage can be blocked (private window): the card then just shows until it expires.
      return null;
    }
  });
  const dismiss = (rideId: string) => {
    setDismissed(rideId);
    try {
      window.localStorage.setItem(DISMISSED_KEY, rideId);
    } catch {
      // See above.
    }
  };
  const ended = current.data?.lastEnded ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div>
        {current.isPending && <Loading label="Loading your ride…" />}
        {current.isError && <ErrorNote message={current.error.message} />}
        {current.data &&
          (current.data.ride ? (
            <CurrentRide ride={current.data.ride} />
          ) : (
            <div className="space-y-6">
              {ended !== null && ended.id !== dismissed && (
                <EndedRide ride={ended} onDone={() => dismiss(ended.id)} />
              )}
              <RequestForm />
            </div>
          ))}
      </div>
      <RideHistory />
    </div>
  );
}
