// En-route pooling rules from docs/assumptions.md §4. Pure functions, no database.
//
// A pool follows one route (a list of zones in driving order). A stop's position is its
// index in that list. The vehicle is at, or heading to, the pool's current stop.
// A passenger can join if (R1) the route passes their pickup and then their drop-off
// without going too far round, (R2) the vehicle has not passed their pickup yet,
// (R3) there are enough free seats, and (R4) the pool is still active.

import { RideStatus } from '../generated/prisma/client.js';

/**
 * One stop of a route. `position` 0 is the first stop; `kmFromStart` is the route's
 * distance from the first stop to this one, so the km between two stops is a subtraction.
 */
export type Stop = {
  position: number;
  zoneId: string;
  name: string;
  kmFromStart: number;
};

// R1, "not too far round": riding the route may add at most 2 km to the direct
// distance, or 40% on longer trips, whichever allows more (docs/assumptions.md §3.3).
export const MAX_EXTRA_KM = 2;
export const MAX_STRETCH_PERCENT = 140;

export type PoolSnapshot = {
  status: RideStatus;
  currentStop: number;
  seatCapacity: number;
  seatsTaken: number;
};

export type Trip = {
  pickupZoneId: string;
  dropoffZoneId: string;
  distanceKm: number; // direct distance, from the distance table
  seats: number;
};

// The same codes the API returns with the 409.
export type JoinProblem = {
  code: 'POOL_NOT_OPEN' | 'NOT_COMPATIBLE' | 'SEATS_UNAVAILABLE';
  message: string;
};

const JOINABLE: RideStatus[] = [
  RideStatus.MATCHED,
  RideStatus.DRIVER_ARRIVED,
  RideStatus.STARTED,
];

/** The route positions of a trip's pickup and drop-off, or null if the route does not serve it (R1). */
export function tripStops(
  stops: Stop[],
  trip: { pickupZoneId: string; dropoffZoneId: string },
): { pickupStop: number; dropoffStop: number } | null {
  const pickup = stops.find((stop) => stop.zoneId === trip.pickupZoneId);
  const dropoff = stops.find((stop) => stop.zoneId === trip.dropoffZoneId);
  if (!pickup || !dropoff || pickup.position >= dropoff.position) {
    return null;
  }
  return { pickupStop: pickup.position, dropoffStop: dropoff.position };
}

/** Km the car drives between two stops of its route. */
export function routeKm(stops: Stop[], from: number, to: number): number {
  return stops[to].kmFromStart - stops[from].kmFromStart;
}

/**
 * Why this route cannot carry this trip at all (R1), or null if it can:
 * the route must pass the pickup, then the drop-off, and not go too far round.
 */
export function routeProblem(
  stops: Stop[],
  trip: { pickupZoneId: string; dropoffZoneId: string; distanceKm: number },
): string | null {
  const positions = tripStops(stops, trip);
  if (positions === null) {
    return 'Not on this route in this direction';
  }
  const riddenKm = routeKm(stops, positions.pickupStop, positions.dropoffStop);
  const withinExtraKm = riddenKm <= trip.distanceKm + MAX_EXTRA_KM;
  // Integer maths: riddenKm ≤ 1.4 × directKm  ⇔  100 × riddenKm ≤ 140 × directKm.
  const withinStretch = riddenKm * 100 <= trip.distanceKm * MAX_STRETCH_PERCENT;
  if (!withinExtraKm && !withinStretch) {
    return `This route goes too far round (${riddenKm} km for a ${trip.distanceKm} km trip)`;
  }
  return null;
}

/** True if the route can carry the trip (R1). */
export function servesTrip(
  stops: Stop[],
  trip: { pickupZoneId: string; dropoffZoneId: string; distanceKm: number },
): boolean {
  return routeProblem(stops, trip) === null;
}

/**
 * Why this trip cannot join the pool, or null if it can (R1–R4).
 * The message is shown to the driver and returned with the 409.
 */
export function joinProblem(
  pool: PoolSnapshot,
  stops: Stop[],
  trip: Trip,
): JoinProblem | null {
  if (!JOINABLE.includes(pool.status)) {
    return { code: 'POOL_NOT_OPEN', message: 'This trip has already ended' };
  }
  const onRoute = routeProblem(stops, trip);
  if (onRoute !== null) {
    return { code: 'NOT_COMPATIBLE', message: onRoute };
  }
  const positions = tripStops(stops, trip)!;
  if (positions.pickupStop < pool.currentStop) {
    const pickupName = stops[positions.pickupStop].name;
    return {
      code: 'NOT_COMPATIBLE',
      message: `The car has already passed ${pickupName}`,
    };
  }
  const freeSeats = pool.seatCapacity - pool.seatsTaken;
  if (trip.seats > freeSeats) {
    return {
      code: 'SEATS_UNAVAILABLE',
      message: `${trip.seats - freeSeats} seat(s) short`,
    };
  }
  return null;
}

/**
 * The pool discount rule: true if at least one other passenger rode with this one
 * on at least one hop. Two stretches [pickup, drop-off) overlap when each starts
 * before the other ends. Getting on at the stop where someone else gets off is not sharing.
 */
export function sharedAHop(
  me: { pickupStop: number; dropoffStop: number },
  others: { pickupStop: number; dropoffStop: number }[],
): boolean {
  return others.some(
    (other) =>
      other.pickupStop < me.dropoffStop && me.pickupStop < other.dropoffStop,
  );
}
