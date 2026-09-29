import { Injectable } from '@nestjs/common';
import { finalFarePaisa } from '../fares/fare.js';
import { Pool, RideStatus } from '../generated/prisma/client.js';
import { sharedAHop, type Stop } from '../pooling/route-plan.js';
import { PoolingService } from '../rides/pooling.service.js';
import { RideError } from '../rides/ride.errors.js';
import {
  ACTIVE_POOL_STATUSES,
  RidesRepository,
  Tx,
} from '../rides/rides.repository.js';
import { DriverService } from './driver.service.js';

/**
 * The trip, stop by stop (docs/assumptions.md §5). The driver arrives at a stop,
 * picks up and drops off the passengers of that stop, then leaves for the next one.
 * Every action runs inside the vehicle lock, so a passenger joining "at the stop ahead"
 * and the driver leaving that stop can never overlap.
 */
@Injectable()
export class TripService {
  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly driverService: DriverService,
    private readonly poolingService: PoolingService,
  ) {}

  /** MATCHED or STARTED → DRIVER_ARRIVED: the car is at its current stop. */
  async arrive(driverId: string) {
    await this.inTrip(driverId, async (tx, pool, stops) => {
      if (
        pool.status !== RideStatus.MATCHED &&
        pool.status !== RideStatus.STARTED
      ) {
        throw new RideError('INVALID_TRANSITION', 'You are already at a stop');
      }
      const stopName = stops[pool.currentStop].name;

      await tx.pool.update({
        where: { id: pool.id },
        data: { status: RideStatus.DRIVER_ARRIVED },
      });
      // The car is here now: this is also where route suggestions start from.
      await tx.vehicle.update({
        where: { id: pool.vehicleId },
        data: { currentZoneId: stops[pool.currentStop].zoneId },
      });

      // Everyone waiting at this stop now sees the car is here.
      const waitingHere = await tx.poolMember.findMany({
        where: {
          poolId: pool.id,
          leftAt: null,
          pickupStop: pool.currentStop,
          rideRequest: { status: RideStatus.MATCHED },
        },
      });
      for (const member of waitingHere) {
        await this.moveRide(tx, pool, member.rideRequestId, {
          from: RideStatus.MATCHED,
          to: RideStatus.DRIVER_ARRIVED,
          actorUserId: driverId,
          reason: `Driver arrived at ${stopName}`,
        });
      }
    });
    return this.driverService.getCurrentPool(driverId);
  }

  /** DRIVER_ARRIVED → STARTED: leave for the next stop, once this stop is done. */
  async depart(driverId: string) {
    await this.inTrip(driverId, async (tx, pool, stops) => {
      if (pool.status !== RideStatus.DRIVER_ARRIVED) {
        throw new RideError('INVALID_TRANSITION', 'Arrive at the stop first');
      }
      const members = await tx.poolMember.findMany({
        where: { poolId: pool.id, leftAt: null },
        include: { rideRequest: true },
      });
      const unfinished = members.find(
        (member) =>
          member.rideRequest.status === RideStatus.DRIVER_ARRIVED ||
          member.dropoffStop === pool.currentStop,
      );
      if (unfinished !== undefined) {
        throw new RideError(
          'INVALID_TRANSITION',
          'Pick up, drop off or mark no-show everyone at this stop first',
        );
      }
      if (pool.currentStop + 1 >= stops.length) {
        throw new RideError('INVALID_TRANSITION', 'This is the last stop');
      }

      await tx.pool.update({
        where: { id: pool.id },
        data: { status: RideStatus.STARTED, currentStop: pool.currentStop + 1 },
      });
    });
    return this.driverService.getCurrentPool(driverId);
  }

  /** DRIVER_ARRIVED → STARTED for one passenger: they are in the car. */
  async pickUp(driverId: string, rideId: string) {
    await this.inTrip(driverId, async (tx, pool, stops) => {
      const member = await this.findMember(tx, pool, rideId);
      if (member.rideRequest.status !== RideStatus.DRIVER_ARRIVED) {
        throw new RideError(
          'INVALID_TRANSITION',
          'This passenger is not waiting at this stop',
        );
      }
      await this.moveRide(tx, pool, rideId, {
        from: RideStatus.DRIVER_ARRIVED,
        to: RideStatus.STARTED,
        actorUserId: driverId,
        reason: `Picked up at ${stops[pool.currentStop].name}`,
      });
      if (pool.startedAt === null) {
        await tx.pool.update({
          where: { id: pool.id },
          data: { startedAt: new Date() },
        });
      }
    });
    return this.driverService.getCurrentPool(driverId);
  }

  /**
   * STARTED → COMPLETED for one passenger at their stop. The fare is locked now:
   * −20% if someone else rode with them on at least one hop.
   */
  async dropOff(driverId: string, rideId: string) {
    await this.inTrip(driverId, async (tx, pool, stops) => {
      const member = await this.findMember(tx, pool, rideId);
      if (
        member.rideRequest.status !== RideStatus.STARTED ||
        pool.status !== RideStatus.DRIVER_ARRIVED ||
        member.dropoffStop !== pool.currentStop
      ) {
        throw new RideError(
          'INVALID_TRANSITION',
          'This passenger does not get off at this stop',
        );
      }

      // Everyone who was actually in the car at some point (not cancelled, not no-show).
      const riders = await tx.poolMember.findMany({
        where: {
          poolId: pool.id,
          rideRequestId: { not: rideId },
          rideRequest: {
            status: { in: [RideStatus.STARTED, RideStatus.COMPLETED] },
          },
        },
      });
      const shared = sharedAHop(member, riders);
      const fare = finalFarePaisa(
        member.rideRequest.distanceKm,
        member.rideRequest.seats,
        shared,
      );

      // Late-cancel fees this passenger still owes are paid now, in the same cash (D-018).
      const unpaid = await this.ridesRepository.findUnpaidFees(
        member.rideRequest.passengerId,
        tx,
      );
      const dues = unpaid.reduce(
        (sum, ride) => sum + ride.cancellationFeePaisa,
        0,
      );
      if (unpaid.length > 0) {
        await tx.rideRequest.updateMany({
          where: { id: { in: unpaid.map((ride) => ride.id) } },
          data: { feePaidWithRideId: rideId },
        });
      }

      await tx.rideRequest.update({
        where: { id: rideId },
        data: {
          status: RideStatus.COMPLETED,
          finalFarePaisa: fare,
          duesCollectedPaisa: dues,
        },
      });
      await tx.poolMember.update({
        where: { id: member.id },
        data: { leftAt: new Date() },
      });
      await tx.pool.update({
        where: { id: pool.id },
        data: { seatsTaken: { decrement: member.seats } },
      });
      await tx.rideEvent.create({
        data: {
          rideRequestId: rideId,
          poolId: pool.id,
          fromStatus: RideStatus.STARTED,
          toStatus: RideStatus.COMPLETED,
          actorUserId: driverId,
          reason: `Dropped off at ${stops[pool.currentStop].name}; ${
            shared ? 'shared ride, 20% off' : 'rode alone'
          }; pay in cash${
            dues > 0 ? ` with Tk ${dues / 100} from an earlier cancel` : ''
          }`,
        },
      });

      // Seats freed here can go straight to riders waiting ahead (D-017).
      await this.poolingService.fillFreedSeats(tx, pool.id);
      await this.poolingService.closeIfEmpty(tx, pool.id);
    });
    return this.driverService.getCurrentPool(driverId);
  }

  /** The passenger did not come to the car: their seat is freed. */
  async noShow(driverId: string, rideId: string) {
    await this.inTrip(driverId, async (tx, pool, stops) => {
      const member = await this.findMember(tx, pool, rideId);
      if (member.rideRequest.status !== RideStatus.DRIVER_ARRIVED) {
        throw new RideError(
          'INVALID_TRANSITION',
          'Only a passenger waiting at this stop can be a no-show',
        );
      }
      await this.poolingService.leaveUnderLock(
        tx,
        pool.id,
        member.rideRequest,
        driverId,
        `Did not show up at ${stops[pool.currentStop].name}`,
      );
    });
    return this.driverService.getCurrentPool(driverId);
  }

  /** Before the first pickup only (e.g. a breakdown): passengers go back to waiting. */
  async cancelTrip(driverId: string) {
    await this.inTrip(driverId, async (tx, pool) => {
      if (pool.startedAt !== null) {
        throw new RideError(
          'INVALID_TRANSITION',
          'A trip cannot be cancelled once someone has been picked up',
        );
      }

      const members = await tx.poolMember.findMany({
        where: { poolId: pool.id, leftAt: null },
        include: { rideRequest: true },
      });
      for (const member of members) {
        await tx.poolMember.update({
          where: { id: member.id },
          data: { leftAt: new Date() },
        });
        await this.moveRide(tx, pool, member.rideRequestId, {
          from: member.rideRequest.status,
          to: RideStatus.REQUESTED,
          actorUserId: driverId,
          reason: 'Driver cancelled the trip; waiting for another driver',
        });
      }

      await tx.pool.update({
        where: { id: pool.id },
        data: {
          status: RideStatus.CANCELLED,
          seatsTaken: 0,
          endedAt: new Date(),
        },
      });
    });
    return this.driverService.getCurrentPool(driverId);
  }

  // ---------- helpers ----------

  /** Runs `work` on the driver's current trip, inside the vehicle lock. */
  private async inTrip(
    driverId: string,
    work: (tx: Tx, pool: Pool, stops: Stop[]) => Promise<void>,
  ): Promise<void> {
    const vehicle = await this.driverService.getVehicle(driverId);
    await this.ridesRepository.withVehicleLock(vehicle.id, async (tx) => {
      const pool = await tx.pool.findFirst({
        where: { vehicleId: vehicle.id, status: { in: ACTIVE_POOL_STATUSES } },
      });
      if (pool === null) {
        throw new RideError('NO_ACTIVE_POOL', 'You have no current trip');
      }
      const stops = await this.ridesRepository.findRouteStops(tx, pool.routeId);
      await work(tx, pool, stops);
    });
  }

  private async findMember(tx: Tx, pool: Pool, rideId: string) {
    const member = await tx.poolMember.findFirst({
      where: { poolId: pool.id, rideRequestId: rideId, leftAt: null },
      include: { rideRequest: true },
    });
    if (member === null) {
      throw new RideError('NOT_FOUND', 'This passenger is not in your trip');
    }
    return member;
  }

  /** Changes one ride's status and writes the history event for it. */
  private async moveRide(
    tx: Tx,
    pool: Pool,
    rideId: string,
    change: {
      from: RideStatus;
      to: RideStatus;
      actorUserId: string;
      reason: string;
    },
  ) {
    await tx.rideRequest.update({
      where: { id: rideId },
      data: { status: change.to },
    });
    await tx.rideEvent.create({
      data: {
        rideRequestId: rideId,
        poolId: pool.id,
        fromStatus: change.from,
        toStatus: change.to,
        actorUserId: change.actorUserId,
        reason: change.reason,
      },
    });
  }
}
