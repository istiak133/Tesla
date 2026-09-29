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
  // Co-riders' first names only, never their fares (docs/assumptions.md §8).
  coRiders: string[];
  history: { status: RideStatus; reason: string; at: Date }[];
};

type RideDetails = NonNullable<
  Awaited<ReturnType<RidesRepository['findRideDetails']>>
>;

export function toRideView(ride: RideDetails): RideView {
  const membership = ride.memberships[0];
  const pool =
    membership && membership.leftAt === null ? membership.pool : null;

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
    coRiders:
      pool === null
        ? []
        : pool.members
            .filter((member) => member.rideRequestId !== ride.id)
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
