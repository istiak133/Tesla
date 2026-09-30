"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRefreshInterval } from "@/lib/live";
import { dhakaTime, taka } from "@/lib/format";
import type { DriverState, WaitingRequest } from "@/lib/types";
import { Button, Card, EmptyState, ErrorNote, Loading } from "../ui";

export function WaitingRequests() {
  const refetchInterval = useRefreshInterval(3000);
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: ["driver-requests"],
    queryFn: () => api<WaitingRequest[]>("/driver/requests"),
    refetchInterval,
  });

  const accept = useMutation({
    mutationFn: (rideId: string) =>
      api<DriverState>(`/driver/requests/${rideId}/accept`, { method: "POST" }),
    onSuccess: (next) => {
      queryClient.setQueryData(["driver-state"], next);
      queryClient.invalidateQueries({ queryKey: ["driver-requests"] });
    },
    // First accept wins (D-020): another driver may have taken it a moment ago.
    onError: () =>
      queryClient.invalidateQueries({ queryKey: ["driver-requests"] }),
  });

  return (
    <Card title="Waiting requests">
      {requests.isPending && <Loading />}
      {requests.isError && <ErrorNote message={requests.error.message} />}
      {accept.isError && (
        <div className="mb-3">
          <ErrorNote message={accept.error.message} />
        </div>
      )}
      {requests.data && requests.data.length === 0 && (
        <EmptyState
          title="No requests for your car right now"
          hint="Requests your car can take appear here the moment they are made."
        />
      )}
      {requests.data && requests.data.length > 0 && (
        <ul className="space-y-3">
          {requests.data.map((request) => (
            <li
              key={request.id}
              className="rounded-xl border border-stone-200 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    {request.passengerName}
                    {request.pickupKmAhead !== null && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                        {request.pickupKmAhead === 0
                          ? "at your stop"
                          : `pickup ${request.pickupKmAhead} km ahead`}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-stone-600">
                    {request.pickup} → {request.dropoff}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {request.distanceKm} km · {request.seats}{" "}
                    {request.seats === 1 ? "seat" : "seats"} ·{" "}
                    {taka(request.estimatedFarePaisa)} ·{" "}
                    {dhakaTime(request.requestedAt)}
                  </p>
                </div>
                <Button
                  loading={accept.isPending && accept.variables === request.id}
                  disabled={accept.isPending}
                  onClick={() => accept.mutate(request.id)}
                >
                  Accept
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
