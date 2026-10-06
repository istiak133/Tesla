import { Injectable } from '@nestjs/common';
import { soloFarePaisa } from '../fares/fare.js';
import {
  GeographyRepository,
  toStops,
} from '../geography/geography.repository.js';
import { Prisma, RideStatus } from '../generated/prisma/client.js';
import { servesTrip } from '../pooling/route-plan.js';
import { DRIVER_GONE_MS, isSilent } from './driver-presence.js';
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

    // The ride waits as REQUESTED. The next match round (every few seconds, D-023) seats it
    // in a running trip if one fits; otherwise idle drivers see it (D-020).
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
    return toRideView(ride, await this.unpaidDuesPaisa(passengerId));
  }

  /** Fees from late cancels this passenger still owes, paid with their next ride (D-018). */
  async unpaidDuesPaisa(passengerId: string): Promise<number> {
    const unpaid = await this.ridesRepository.findUnpaidFees(passengerId);
    return unpaid.reduce((sum, ride) => sum + ride.cancellationFeePaisa, 0);
  }

  async getCurrentRide(passengerId: string): Promise<RideView | null> {
    const active =
      await this.ridesRepository.findActiveRideOfPassenger(passengerId);
    if (active === null) {
      return null;
    }
    return this.getRide(passengerId, active.id);
  }

  /**
   * The ride that ended a moment ago, while there is no active one: at a drop-off the
   * passenger needs the final fare to pay in cash, and after a no-show or a driver who went
   * silent, what happened. Shown for ENDED_RIDE_SHOWN_MS.
   */
  async getRecentlyEndedRide(passengerId: string): Promise<RideView | null> {
    const ended = await this.ridesRepository.findLatestEndedRideOfPassenger(
      passengerId,
      new Date(Date.now() - ENDED_RIDE_SHOWN_MS),
    );
    return ended === null ? null : this.getRide(passengerId, ended.id);
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
      cancellationFeePaisa: ride.cancellationFeePaisa,
      duesCollectedPaisa: ride.duesCollectedPaisa,
      createdAt: ride.createdAt,
    }));
  }

  /**
   * Passenger cancel (docs/assumptions.md §6.1, decision D-016): allowed while the ride is
   * waiting, matched or the car is at the stop; refused once picked up or finished.
   *
   * The ride can change between our read and the lock (a driver accepts it, the driver
   * cancels the trip, a no-show, another car takes it), so each attempt looks again and
   * decides only on what it saw under the right lock. A ride that is already cancelled
   * returns as it is, so a double tap or a retry gets the same answer, not an error.
   * `expectedFeePaisa`: the fee the passenger saw; a higher fee now refuses the cancel.
   */
  async cancelRide(
    passengerId: string,
    rideId: string,
    expectedFeePaisa?: number,
  ): Promise<RideView> {
    for (let attempt = 1; attempt <= CANCEL_ATTEMPTS; attempt++) {
      const ride = await this.ridesRepository.findRide(rideId);
      if (ride === null) {
        throw new RideError('NOT_FOUND', 'Ride not found');
      }
      if (ride.passengerId !== passengerId) {
        throw new RideError(
          'NOT_YOUR_RIDE',
          'This ride belongs to someone else',
        );
      }
      // On board: decided under the car's lock, where the driver's presence is read.
      refuseCancel(ride.status, ride.status === RideStatus.STARTED);
      if (ride.status === RideStatus.CANCELLED) {
        return this.getRide(passengerId, rideId);
      }

      if (ride.status === RideStatus.REQUESTED) {
        // Not in any car: a compare-and-set on the ride is enough. If a driver took it
        // a moment ago, look again: it is now in that car.
        if (await this.ridesRepository.cancelWaitingRide(rideId, passengerId)) {
          return this.getRide(passengerId, rideId);
        }
        continue;
      }

      // MATCHED, DRIVER_ARRIVED or STARTED: the seat is in a car, so change it under that
      // car's lock.
      const membership =
        await this.ridesRepository.findActiveMembership(rideId);
      if (membership === null) {
        continue; // it just left the car (trip cancelled, no-show): look again
      }
      const vehicleId = membership.pool.vehicleId;
      const settled = await this.ridesRepository.withVehicleLock(
        vehicleId,
        async (tx) => {
          const current = await tx.rideRequest.findUniqueOrThrow({
            where: { id: rideId },
          });
          const vehicle = await tx.vehicle.findUniqueOrThrow({
            where: { id: vehicleId },
          });
          const driverGone = isSilent(
            vehicle.lastSeenAt,
            new Date(),
            DRIVER_GONE_MS,
          );
          refuseCancel(current.status, driverGone);
          if (current.status === RideStatus.CANCELLED) {
            return true; // a no-show or the other tap got here first
          }
          if (current.status === RideStatus.REQUESTED) {
            // The driver cancelled the trip a moment ago: the ride is waiting again.
            return this.ridesRepository.cancelIfWaiting(
              tx,
              rideId,
              passengerId,
            );
          }
          // The seat must still be in this vehicle's trip (the one we locked).
          const seat = await tx.poolMember.findFirst({
            where: { rideRequestId: rideId, leftAt: null },
            include: { pool: true },
          });
          if (seat === null || seat.pool.vehicleId !== vehicleId) {
            return false; // it moved to another car: look again with that car's lock
          }
          await this.poolingService.leaveUnderLock(
            tx,
            seat.poolId,
            current,
            passengerId,
            current.status === RideStatus.STARTED
              ? 'Passenger ended the ride: the driver stopped responding'
              : 'Passenger cancelled',
            expectedFeePaisa,
          );
          return true;
        },
      );
      if (settled) {
        return this.getRide(passengerId, rideId);
      }
    }
    throw new RideError('BUSY', 'The ride just changed, please try again');
  }
}

// How long a finished ride stays on the passenger's screen (with the fare to pay).
const ENDED_RIDE_SHOWN_MS = 30 * 60_000;

// A ride changes hands at most a few times in a second; after this many looks, ask to retry.
const CANCEL_ATTEMPTS = 3;

/**
 * Throws if the passenger may not cancel a ride in this status any more. On board, only when
 * the driver's app has been silent for DRIVER_GONE_MS: then the passenger may end the ride,
 * so a driver who vanished cannot hold them (and their one active ride) for ever.
 */
function refuseCancel(status: RideStatus, driverGone = false): void {
  if (status === RideStatus.STARTED && !driverGone) {
    throw new RideError(
      'INVALID_TRANSITION',
      'A ride cannot be cancelled after pickup',
    );
  }
  if (status === RideStatus.COMPLETED) {
    throw new RideError('INVALID_TRANSITION', 'This ride is already finished');
  }
}
