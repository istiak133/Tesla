import { Injectable } from '@nestjs/common';
import { soloFarePaisa } from '../fares/fare.js';
import {
  GeographyRepository,
  toStops,
} from '../geography/geography.repository.js';
import { Prisma, RideStatus } from '../generated/prisma/client.js';
import { servesTrip } from '../pooling/route-plan.js';
import { PoolingService } from './pooling.service.js';
import { RideError } from './ride.errors.js';
import { RideView, toRideView } from './ride.views.js';
import { RidesRepository } from './rides.repository.js';

/** Everything a passenger can do with rides. */
@Injectable()
export class RidesService {
  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly geographyRepository: GeographyRepository,
    private readonly poolingService: PoolingService,
  ) {}

  async requestRide(
    passengerId: string,
    pickupZoneId: string,
    dropoffZoneId: string,
    seats: number,
  ): Promise<RideView> {
    if (pickupZoneId === dropoffZoneId) {
      throw new RideError(
        'INVALID_ZONE',
        'Pickup and drop-off must be different',
      );
    }
    const pickupExists =
      await this.geographyRepository.zoneExists(pickupZoneId);
    const dropoffExists =
      await this.geographyRepository.zoneExists(dropoffZoneId);
    if (!pickupExists || !dropoffExists) {
      throw new RideError('INVALID_ZONE', 'Unknown zone');
    }

    const distance = await this.poolingService.distance();
    const distanceKm = distance(pickupZoneId, dropoffZoneId);

    // Tesla Pool only drives its fixed routes, and only sells trips a route carries
    // without going too far round (docs/assumptions.md §3.3).
    const routes = await this.geographyRepository.listRoutes();
    const served = routes.some((route) =>
      servesTrip(toStops(route), { pickupZoneId, dropoffZoneId, distanceKm }),
    );
    if (!served) {
      throw new RideError(
        'NO_ROUTE',
        'No Tesla route goes from this pickup to this destination yet',
      );
    }

    let ride;
    try {
      ride = await this.ridesRepository.createRide({
        passengerId,
        pickupZoneId,
        dropoffZoneId,
        seats,
        distanceKm,
        // The estimate is the solo fare: the most this passenger can pay.
        estimatedFarePaisa: soloFarePaisa(distanceKm, seats),
      });
    } catch (error) {
      // The unique index allows one active ride per passenger, even if two requests race.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new RideError(
          'ACTIVE_RIDE_EXISTS',
          'You already have an active ride',
        );
      }
      throw error;
    }

    // Join a Tesla that will pass the pickup, if one fits; otherwise wait for a driver.
    await this.poolingService.tryAutoJoin(ride);
    return this.getRide(passengerId, ride.id);
  }

  async getRide(passengerId: string, rideId: string): Promise<RideView> {
    const ride = await this.ridesRepository.findRideDetails(rideId);
    if (ride === null) {
      throw new RideError('NOT_FOUND', 'Ride not found');
    }
    if (ride.passengerId !== passengerId) {
      throw new RideError('NOT_YOUR_RIDE', 'This ride belongs to someone else');
    }
    return toRideView(ride);
  }

  async getCurrentRide(passengerId: string): Promise<RideView | null> {
    const active =
      await this.ridesRepository.findActiveRideOfPassenger(passengerId);
    if (active === null) {
      return null;
    }
    return this.getRide(passengerId, active.id);
  }

  async listHistory(passengerId: string) {
    const rides = await this.ridesRepository.listRidesOfPassenger(passengerId);
    return rides.map((ride) => ({
      id: ride.id,
      status: ride.status,
      pickup: ride.pickupZone.name,
      dropoff: ride.dropoffZone.name,
      seats: ride.seats,
      farePaisa: ride.finalFarePaisa ?? ride.estimatedFarePaisa,
      createdAt: ride.createdAt,
    }));
  }

  /**
   * Passenger cancel: allowed until the passenger is picked up (docs/assumptions.md §6.1).
   * The ride can change while we reach the lock (the driver cancels the trip, or it joins
   * another car), so everything is checked again under the lock, with one retry.
   */
  async cancelRide(
    passengerId: string,
    rideId: string,
    attempt = 1,
  ): Promise<RideView> {
    const ride = await this.ridesRepository.findRide(rideId);
    if (ride === null) {
      throw new RideError('NOT_FOUND', 'Ride not found');
    }
    if (ride.passengerId !== passengerId) {
      throw new RideError('NOT_YOUR_RIDE', 'This ride belongs to someone else');
    }

    if (ride.status === RideStatus.REQUESTED) {
      const cancelled = await this.ridesRepository.cancelWaitingRide(
        rideId,
        passengerId,
      );
      if (cancelled) {
        return this.getRide(passengerId, rideId);
      }
      // It was matched a moment ago; fall through and cancel it out of its pool.
    }

    const membership = await this.ridesRepository.findActiveMembership(rideId);
    if (membership === null) {
      throw new RideError(
        'INVALID_TRANSITION',
        'This ride can no longer be cancelled',
      );
    }

    const vehicleId = membership.pool.vehicleId;
    const outcome = await this.ridesRepository.withVehicleLock(
      vehicleId,
      async (tx) => {
        const current = await tx.rideRequest.findUniqueOrThrow({
          where: { id: rideId },
        });

        // The driver cancelled the trip a moment ago: the ride is waiting again.
        if (current.status === RideStatus.REQUESTED) {
          await this.ridesRepository.cancelIfWaiting(tx, rideId, passengerId);
          return 'done';
        }
        if (current.status === RideStatus.STARTED) {
          throw new RideError(
            'INVALID_TRANSITION',
            'A ride cannot be cancelled after pickup',
          );
        }
        if (
          current.status !== RideStatus.MATCHED &&
          current.status !== RideStatus.DRIVER_ARRIVED
        ) {
          throw new RideError(
            'INVALID_TRANSITION',
            'This ride can no longer be cancelled',
          );
        }

        // The seat must still be in this vehicle's trip (the one we locked).
        const seat = await tx.poolMember.findFirst({
          where: { rideRequestId: rideId, leftAt: null },
          include: { pool: true },
        });
        if (seat === null || seat.pool.vehicleId !== vehicleId) {
          return 'moved';
        }
        await this.poolingService.leaveUnderLock(
          tx,
          seat.poolId,
          current,
          passengerId,
          'Passenger cancelled',
        );
        return 'done';
      },
    );

    if (outcome === 'moved') {
      // It joined another car in the meantime: try once more with that car's lock.
      if (attempt === 1) {
        return this.cancelRide(passengerId, rideId, 2);
      }
      throw new RideError('BUSY', 'The ride just changed, please try again');
    }
    return this.getRide(passengerId, rideId);
  }
}
