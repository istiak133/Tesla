// Matching a car to a request by where the car is (docs/assumptions.md §4.4, decision D-014).
// Pure functions, no database.
//
// The car's place on its route is a stop position:
//   - on a trip: the pool's current stop (where it stands, or the next stop it drives to);
//   - between trips: the stop of the vehicle's current zone on its chosen route.
// "Approach km" is how far the car drives along the route to reach a pickup.
// It is only defined for pickups at or ahead of the car: a car never drives backwards.

import { routeKm, routeProblem, tripStops, type Stop } from './route-plan.js';

/** Requests waiting at least this long go to the top of a driver's list (no starvation). */
export const AGING_MINUTES = 5;

/** The position of a zone on a route, or null if the route does not pass it. */
export function stopOf(stops: Stop[], zoneId: string | null): number | null {
  if (zoneId === null) {
    return null;
  }
  const stop = stops.find((s) => s.zoneId === zoneId);
  return stop ? stop.position : null;
}

/** Km the car drives from its stop to the pickup stop, or null if the pickup is behind it. */
export function approachKm(
  stops: Stop[],
  carStop: number,
  pickupStop: number,
): number | null {
  if (pickupStop < carStop) {
    return null;
  }
  return routeKm(stops, carStop, pickupStop);
}

type TripRequest = {
  pickupZoneId: string;
  dropoffZoneId: string;
  distanceKm: number;
};

/**
 * Where a new trip starts when an idle driver accepts a request: at the car's own stop,
 * so the car drives stop by stop to the pickup (picking up others on the way).
 * Refused if the car is not on the route or the pickup is behind it.
 */
export function newTripStart(
  stops: Stop[],
  carZoneId: string | null,
  trip: TripRequest,
): { startStop: number } | { problem: string } {
  const fits = routeProblem(stops, trip);
  if (fits !== null) {
    return { problem: fits };
  }
  const carStop = stopOf(stops, carZoneId);
  if (carStop === null) {
    return {
      problem: 'Your car is not on this route: set your location first',
    };
  }
  const { pickupStop } = tripStops(stops, trip)!;
  if (pickupStop < carStop) {
    return { problem: `Behind your car (${stops[pickupStop].name})` };
  }
  return { startStop: carStop };
}

export type ListedRequest = {
  canAccept: boolean;
  pickupKmAhead: number | null;
  requestedAt: Date;
};

/**
 * A driver's waiting list, best first:
 *   1. requests they can take that have waited AGING_MINUTES or more, oldest first
 *      (so a far request is never pushed down for ever);
 *   2. other requests they can take, nearest pickup first, then oldest;
 *   3. requests they cannot take, oldest first (shown with the reason).
 */
export function orderWaitingList<T extends ListedRequest>(
  requests: T[],
  now: Date,
): T[] {
  const agingMs = AGING_MINUTES * 60_000;
  const group = (r: T) => {
    if (!r.canAccept) return 3;
    return now.getTime() - r.requestedAt.getTime() >= agingMs ? 1 : 2;
  };
  return [...requests].sort((a, b) => {
    const byGroup = group(a) - group(b);
    if (byGroup !== 0) return byGroup;
    if (group(a) === 2) {
      const byKm =
        (a.pickupKmAhead ?? Infinity) - (b.pickupKmAhead ?? Infinity);
      if (byKm !== 0) return byKm;
    }
    return a.requestedAt.getTime() - b.requestedAt.getTime();
  });
}
