import { Injectable } from '@nestjs/common';
import { soloFarePaisa } from '../fares/fare.js';
import { GeographyRepository } from '../geography/geography.repository.js';
import { Prisma, RideStatus } from '../generated/prisma/client.js';
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

    // Join an open pool straight away if one fits; otherwise wait for a driver.
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

  /** Passenger cancel: allowed until the trip starts (docs/assumptions.md §6.1). */
  async cancelRide(passengerId: string, rideId: string): Promise<RideView> {
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

    await this.ridesRepository.withVehicleLock(
      membership.pool.vehicleId,
      async (tx) => {
        const current = await tx.rideRequest.findUniqueOrThrow({
          where: { id: rideId },
        });
        const cancellable: RideStatus[] = [
          RideStatus.MATCHED,
          RideStatus.DRIVER_ARRIVED,
        ];
        if (!cancellable.includes(current.status)) {
          throw new RideError(
            'INVALID_TRANSITION',
            'A ride cannot be cancelled once the trip has started',
          );
        }
        await this.poolingService.leaveUnderLock(
          tx,
          membership.poolId,
          current,
          passengerId,
          'Passenger cancelled',
        );
      },
    );
    return this.getRide(passengerId, rideId);
  }
}
