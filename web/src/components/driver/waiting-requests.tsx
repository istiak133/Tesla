"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dhakaTime, taka } from "@/lib/format";
import type { DriverState, WaitingRequest } from "@/lib/types";
import { Button, Card, EmptyState, ErrorNote, Loading } from "../ui";

export function WaitingRequests() {
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: ["driver-requests"],
    queryFn: () => api<WaitingRequest[]>("/driver/requests"),
    refetchInterval: 3000,
  });

  const accept = useMutation({
    mutationFn: (rideId: string) =>
      api<DriverState>(`/driver/requests/${rideId}/accept`, { method: "POST" }),
    onSuccess: (next) => {
      queryClient.setQueryData(["driver-state"], next);
      queryClient.invalidateQueries({ queryKey: ["driver-requests"] });
    },
    // Another driver or an automatic join may have taken it: refresh either way.
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
          title="Nobody is waiting"
          hint="New requests appear here automatically."
        />
      )}
      {requests.data && requests.data.length > 0 && (
        <ul className="space-y-3">
          {requests.data.map((request) => (
            <li
              key={request.id}
              className="rounded-xl border border-zinc-200 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{request.passengerName}</p>
                  <p className="text-sm text-zinc-600">
                    {request.pickup} → {request.dropoff}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {request.distanceKm} km · {request.seats}{" "}
                    {request.seats === 1 ? "seat" : "seats"} ·{" "}
                    {taka(request.estimatedFarePaisa)} ·{" "}
                    {dhakaTime(request.requestedAt)}
                  </p>
                </div>
                <Button
                  loading={accept.isPending && accept.variables === request.id}
                  disabled={!request.canAccept || accept.isPending}
                  onClick={() => accept.mutate(request.id)}
                >
                  Accept
                </Button>
              </div>
              {request.reason && (
                <p className="mt-2 text-xs text-zinc-500">{request.reason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
