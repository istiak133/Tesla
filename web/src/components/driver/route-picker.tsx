"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import type { DriverState, Route } from "@/lib/types";
import { RouteLine } from "../route-line";
import { Button, ErrorNote, inputClass } from "../ui";

/** The route the driver drives. Changeable only between trips. */
export function RoutePicker({ state }: { state: DriverState }) {
  const queryClient = useQueryClient();
  const routes = useQuery({
    queryKey: ["routes"],
    queryFn: () => api<Route[]>("/routes"),
    staleTime: Infinity, // routes never change
  });
  const current = state.vehicle.route?.id ?? "";
  const [picked, setPicked] = useState(current);

  const choose = useMutation({
    mutationFn: (routeId: string) =>
      api<DriverState>("/driver/route", { method: "POST", body: { routeId } }),
    onSuccess: (next) => {
      queryClient.setQueryData(["driver-state"], next);
      queryClient.invalidateQueries({ queryKey: ["driver-requests"] });
    },
  });

  const locked = state.pool !== null;
  const shown = routes.data?.find((route) => route.id === (picked || current));

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-zinc-700">Route</span>
        <select
          className={`${inputClass} max-w-xs`}
          value={picked || current}
          disabled={locked || routes.isPending}
          onChange={(event) => setPicked(event.target.value)}
        >
          <option value="">Choose a route</option>
          {routes.data?.map((route) => (
            <option key={route.id} value={route.id}>
              {route.name}
            </option>
          ))}
        </select>
        {!locked && picked !== "" && picked !== current && (
          <Button
            loading={choose.isPending}
            onClick={() => choose.mutate(picked)}
          >
            Drive this route
          </Button>
        )}
        {locked && (
          <span className="text-xs text-zinc-500">
            Fixed until this trip ends
          </span>
        )}
      </div>
      {shown && state.pool === null && (
        <RouteLine stops={shown.stops.map((stop) => stop.zone.name)} />
      )}
      {routes.isError && <ErrorNote message={routes.error.message} />}
      {choose.isError && <ErrorNote message={choose.error.message} />}
    </div>
  );
}
