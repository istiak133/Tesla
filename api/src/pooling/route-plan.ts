// En-route pooling rules from docs/assumptions.md §4. Pure functions, no database.
//
// A pool follows one route (a list of zones in driving order). A stop's position is its
// index in that list. The vehicle is at, or heading to, the pool's current stop.
// A passenger can join if (R1) the route passes their pickup and then their drop-off,
// (R2) the vehicle has not passed their pickup yet, (R3) there are enough free seats,
// and (R4) the pool is still active.

import { RideStatus } from '../generated/prisma/client.js';

/** One stop of a route. `position` 0 is the first stop. */
export type Stop = { position: number; zoneId: string; name: string };

export type PoolSnapshot = {
  status: RideStatus;
  currentStop: number;
  seatCapacity: number;
  seatsTaken: number;
};

export type Trip = {
  pickupZoneId: string;
  dropoffZoneId: string;
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
  const positions = tripStops(stops, trip);
  if (positions === null) {
    return {
      code: 'NOT_COMPATIBLE',
      message: 'Not on this route in this direction',
    };
  }
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
