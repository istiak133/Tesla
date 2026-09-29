// Route suggestion for drivers (docs/assumptions.md §4.6). Pure functions, no database.
//
// The system suggests, the driver decides. For each route we count the waiting requests
// the car could still serve from where it is now: the route passes the rider's pickup
// and then their destination, and the pickup is at or after the car's zone.
// The best route that passes the car's zone is the suggestion.

import { tripStops, type Stop } from './route-plan.js';

export type RouteForSuggestion = {
  id: string;
  code: string;
  name: string;
  stops: Stop[];
};

export type WaitingTrip = { pickupZoneId: string; dropoffZoneId: string };

export type RankedRoute = {
  routeId: string;
  name: string;
  passesYou: boolean; // the route goes through the car's current zone
  waitingAhead: number; // waiting requests this route could serve from here
};

/** Routes ordered best first: passing the car first, then most waiting riders, then by code. */
export function rankRoutes(
  routes: RouteForSuggestion[],
  currentZoneId: string | null,
  waiting: WaitingTrip[],
): RankedRoute[] {
  const ranked = routes.map((route) => {
    const here = route.stops.find((stop) => stop.zoneId === currentZoneId);
    // A route that does not pass the car would start from its first stop.
    const from = here ? here.position : 0;

    let waitingAhead = 0;
    for (const trip of waiting) {
      const positions = tripStops(route.stops, trip);
      if (positions !== null && positions.pickupStop >= from) {
        waitingAhead++;
      }
    }
    return {
      routeId: route.id,
      code: route.code,
      name: route.name,
      passesYou: here !== undefined,
      waitingAhead,
    };
  });

  ranked.sort((a, b) => {
    if (a.passesYou !== b.passesYou) {
      return a.passesYou ? -1 : 1;
    }
    if (a.waitingAhead !== b.waitingAhead) {
      return b.waitingAhead - a.waitingAhead;
    }
    return a.code.localeCompare(b.code);
  });

  return ranked.map(({ routeId, name, passesYou, waitingAhead }) => ({
    routeId,
    name,
    passesYou,
    waitingAhead,
  }));
}

/** The suggested route: the best one that passes the car, or null if the car's zone is unknown. */
export function suggestedRoute(ranked: RankedRoute[]): RankedRoute | null {
  const best = ranked[0];
  return best !== undefined && best.passesYou ? best : null;
}
