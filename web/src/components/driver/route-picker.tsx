"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import type { DriverState, Route, RouteSuggestions, Zone } from "@/lib/types";
import { RouteLine } from "../route-line";
import { Button, ErrorNote, inputClass } from "../ui";

/**
 * Where the car is and which route it drives. The system suggests a route from the
 * car's location and the riders waiting; the driver decides. Changeable only between trips.
 */
export function RoutePicker({ state }: { state: DriverState }) {
  const queryClient = useQueryClient();
  const locked = state.pool !== null;

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
  const suggestions = useQuery({
    queryKey: ["route-suggestions"],
    queryFn: () => api<RouteSuggestions>("/driver/routes"),
    refetchInterval: 5000,
    enabled: !locked, // during a trip the route is fixed
  });

  const current = state.vehicle.route?.id ?? "";
  const [picked, setPicked] = useState("");
  const shownId = picked || current;

  const afterChange = (next: DriverState) => {
    queryClient.setQueryData(["driver-state"], next);
    queryClient.invalidateQueries({ queryKey: ["route-suggestions"] });
    queryClient.invalidateQueries({ queryKey: ["driver-requests"] });
  };
  const choose = useMutation({
    mutationFn: (routeId: string) =>
      api<DriverState>("/driver/route", { method: "POST", body: { routeId } }),
    onSuccess: (next) => {
      setPicked("");
      afterChange(next);
    },
  });
  const move = useMutation({
    mutationFn: (zoneId: string) =>
      api<DriverState>("/driver/location", {
        method: "POST",
        body: { zoneId },
      }),
    onSuccess: afterChange,
  });

  const ranked = suggestions.data?.routes ?? [];
  const suggested = ranked.find(
    (route) => route.routeId === suggestions.data?.suggestedRouteId,
  );
  const waitingOn = (routeId: string) =>
    ranked.find((route) => route.routeId === routeId)?.waitingAhead;
  const shown = routes.data?.find((route) => route.id === shownId);

  return (
    <div className="space-y-4 rounded-2xl border border-stone-200 bg-paper px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-3">
          <span className="whitespace-nowrap text-sm font-medium text-stone-700">
            You are at
          </span>
          <select
            className={`${inputClass} w-44`}
            value={state.vehicle.currentZone?.id ?? ""}
            disabled={locked || zones.isPending || move.isPending}
            onChange={(event) => move.mutate(event.target.value)}
          >
            <option value="" disabled>
              Choose a zone
            </option>
            {zones.data?.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-3">
          <span className="whitespace-nowrap text-sm font-medium text-stone-700">
            Route
          </span>
          <select
            className={`${inputClass} w-72`}
            value={shownId}
            disabled={locked || routes.isPending}
            onChange={(event) => setPicked(event.target.value)}
          >
            <option value="" disabled>
              Choose a route
            </option>
            {routes.data?.map((route) => {
              const waiting = waitingOn(route.id);
              return (
                <option key={route.id} value={route.id}>
                  {route.name}
                  {waiting !== undefined ? ` · ${waiting} waiting` : ""}
                  {route.id === suggested?.routeId ? " · suggested" : ""}
                </option>
              );
            })}
          </select>
        </label>
        {!locked && picked !== "" && picked !== current && (
          <Button
            loading={choose.isPending}
            onClick={() => choose.mutate(picked)}
          >
            Drive this route
          </Button>
        )}
        {locked && (
          <span className="text-xs text-stone-500">
            Fixed until this trip ends
          </span>
        )}
      </div>

      {!locked && suggested && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
          <p className="text-sm text-emerald-900">
            <span className="mr-2 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
              Suggested
            </span>
            <span className="font-medium">{suggested.name}</span> ·{" "}
            {suggested.waitingAhead === 0
              ? `passes ${suggestions.data?.currentZone?.name}, nobody waiting yet`
              : `${suggested.waitingAhead} waiting from ${suggestions.data?.currentZone?.name} onwards`}
          </p>
          {suggested.routeId === current ? (
            <span className="text-xs font-medium text-emerald-800">
              You are on it
            </span>
          ) : (
            <Button
              loading={choose.isPending}
              onClick={() => choose.mutate(suggested.routeId)}
            >
              Use suggestion
            </Button>
          )}
        </div>
      )}
      {!locked && suggestions.data && !suggestions.data.currentZone && (
        <p className="text-xs text-stone-500">
          Tell us where you are to get a route suggestion.
        </p>
      )}

      {shown && !locked && (
        <RouteLine
          stops={shown.stops.map((stop) => stop.zone.name)}
          carStop={shown.stops.findIndex(
            (stop) => stop.zone.id === state.vehicle.currentZone?.id,
          )}
          carAtStop
        />
      )}
      {routes.isError && <ErrorNote message={routes.error.message} />}
      {suggestions.isError && <ErrorNote message={suggestions.error.message} />}
      {choose.isError && <ErrorNote message={choose.error.message} />}
      {move.isError && <ErrorNote message={move.error.message} />}
    </div>
  );
}
