"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dhakaTime, taka } from "@/lib/format";
import type { RideSummary } from "@/lib/types";
import { Card, EmptyState, ErrorNote, Loading, StatusBadge } from "../ui";

export function RideHistory() {
  const history = useQuery({
    queryKey: ["ride-history"],
    queryFn: () => api<RideSummary[]>("/rides"),
    refetchInterval: 10000,
  });

  return (
    <Card title="Past rides">
      {history.isPending && <Loading />}
      {history.isError && <ErrorNote message={history.error.message} />}
      {history.data && history.data.length === 0 && (
        <EmptyState title="No rides yet" hint="Your trips will appear here." />
      )}
      {history.data && history.data.length > 0 && (
        <ul className="divide-y divide-stone-100">
          {history.data.map((ride) => (
            <li
              key={ride.id}
              className="flex items-center justify-between gap-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {ride.pickup} → {ride.dropoff}
                </p>
                <p className="text-xs text-stone-500">
                  {dhakaTime(ride.createdAt)} · {ride.seats}{" "}
                  {ride.seats === 1 ? "seat" : "seats"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium">{taka(ride.farePaisa)}</span>
                <StatusBadge status={ride.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
