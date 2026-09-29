// The shapes the API returns. Built from database rows here, so controllers stay thin
// and nothing private (other passengers' fares, password hashes) leaks by accident.
import { RideStatus } from '../generated/prisma/client.js';
import { RidesRepository } from './rides.repository.js';

type Zone = { code: string; name: string };

export type RideView = {
  id: string;
  status: RideStatus;
  pickup: Zone;
  dropoff: Zone;
  seats: number;
  distanceKm: number;
  estimatedFarePaisa: number;
  finalFarePaisa: number | null;
  createdAt: Date;
  driver: { name: string; vehicleName: string } | null;
  // The Tesla's route and where the car is, once the ride has a seat.
  route: {
    name: string;
    stops: string[]; // zone names in driving order
    pickupStop: number;
    dropoffStop: number;
    carStop: number; // the stop the car is at or heading to
    carAtStop: boolean; // true while the car is standing at carStop
  } | null;
  // Co-riders' first names only, never their fares (docs/assumptions.md §8).
  coRiders: string[];
  history: { status: RideStatus; reason: string; at: Date }[];
};

type RideDetails = NonNullable<
  Awaited<ReturnType<RidesRepository['findRideDetails']>>
>;

export function toRideView(ride: RideDetails): RideView {
  // The latest seat: still held, or finished by being dropped off.
  const membership = ride.memberships[0];
  const hasSeat =
    membership !== undefined &&
    (membership.leftAt === null || ride.status === RideStatus.COMPLETED);
  const pool = hasSeat ? membership.pool : null;

  return {
    id: ride.id,
    status: ride.status,
    pickup: { code: ride.pickupZone.code, name: ride.pickupZone.name },
    dropoff: { code: ride.dropoffZone.code, name: ride.dropoffZone.name },
    seats: ride.seats,
    distanceKm: ride.distanceKm,
    estimatedFarePaisa: ride.estimatedFarePaisa,
    finalFarePaisa: ride.finalFarePaisa,
    createdAt: ride.createdAt,
    driver:
      pool === null
        ? null
        : { name: pool.vehicle.driver.name, vehicleName: pool.vehicle.name },
    route:
      pool === null
        ? null
        : {
            name: pool.route.name,
            stops: pool.route.stops.map((stop) => stop.zone.name),
            pickupStop: membership.pickupStop,
            dropoffStop: membership.dropoffStop,
            carStop: pool.currentStop,
            carAtStop: pool.status === RideStatus.DRIVER_ARRIVED,
          },
    coRiders:
      pool === null
        ? []
        : pool.members
            .filter(
              (member) =>
                member.leftAt === null && member.rideRequestId !== ride.id,
            )
            .map((member) => firstName(member.rideRequest.passenger.name)),
    history: ride.events.map((event) => ({
      status: event.toStatus,
      reason: event.reason,
      at: event.createdAt,
    })),
  };
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
