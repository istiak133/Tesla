import { Injectable, Logger } from '@nestjs/common';
import { cancellationFeePaisa } from '../fares/cancellation.js';
import { tripEarnings } from '../fares/earnings.js';
import {
  GeographyRepository,
  type DistanceLookup,
} from '../geography/geography.repository.js';
import { Pool, RideRequest, RideStatus } from '../generated/prisma/client.js';
import {
  approachKm,
  orderWaitingList,
  rankJoinCandidates,
} from '../pooling/matching.js';
import { joinProblem, tripStops } from '../pooling/route-plan.js';
import { RideError } from './ride.errors.js';
import {
  ACTIVE_POOL_STATUSES,
  RidesRepository,
  Tx,
} from './rides.repository.js';

/**
 * The seat rules. Every method that changes seats must be called
 * inside RidesRepository.withVehicleLock(), with the transaction it gives.
 *
 * Rule: inside the lock, use only `tx`. Anything else (like the distance table)
 * is loaded before the lock. A query on another connection while holding the lock
 * can wait for a free connection that the waiting transactions are holding.
 */
@Injectable()
export class PoolingService {
  private readonly logger = new Logger(PoolingService.name);

  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly geographyRepository: GeographyRepository,
  ) {}

  /**
   * The distance table (182 small rows). Read fresh each time instead of kept in memory:
   * it is cheap, and a cached copy could silently go stale if zones were ever re-seeded.
   */
  async distance(): Promise<DistanceLookup> {
    return this.geographyRepository.loadDistanceLookup();
  }

  /**
   * Automatic join (docs/assumptions.md §4.4, D-014): put a new request into the active
   * trip whose car reaches the pickup soonest (fewest km along its route; oldest trip on
   * a tie). Returns true if it joined one.
   */
  async tryAutoJoin(ride: RideRequest): Promise<boolean> {
    // Found and ranked without a lock; every condition is checked again under the lock.
    const candidates = rankJoinCandidates(
      await this.ridesRepository.listJoinablePools(ride.pickupZoneId),
      ride,
    );

    for (const candidate of candidates) {
      try {
        await this.ridesRepository.withVehicleLock(
          candidate.vehicleId,
          async (tx) => {
            const pool = await tx.pool.findUniqueOrThrow({
              where: { id: candidate.poolId },
            });
            const current = await tx.rideRequest.findUniqueOrThrow({
              where: { id: ride.id },
            });
            await this.joinUnderLock(
              tx,
              pool,
              current,
              null,
              'Joined a Tesla on the way automatically',
            );
          },
        );
        return true;
      } catch (error) {
        if (error instanceof RideError && error.code === 'BUSY') {
          // Joining is best effort: under heavy contention the ride simply keeps
          // waiting and appears in drivers' lists. It was already created.
          return false;
        }
        if (error instanceof RideError) {
          // This pool did not fit (full, wrong direction, already passed). Try the next.
          continue;
        }
        throw error;
      }
    }
    return false;
  }

  /**
   * Checks R1–R4 against the locked pool and, if they pass, gives the ride its seats.
   * Throws a RideError (and the transaction rolls back) if anything does not fit.
   */
  async joinUnderLock(
    tx: Tx,
    pool: Pool,
    ride: RideRequest,
    actorUserId: string | null,
    reason: string,
  ): Promise<void> {
    // R4 includes "the driver is online". A driver with an active trip cannot go
    // offline, but it is checked here too, on the locked row, so R1–R4 are all re-checked.
    const vehicle = await tx.vehicle.findUniqueOrThrow({
      where: { id: pool.vehicleId },
    });
    if (!vehicle.isOnline) {
      throw new RideError('DRIVER_OFFLINE', 'The driver is offline');
    }
    const stops = await this.ridesRepository.findRouteStops(tx, pool.routeId);
    const problem = joinProblem(pool, stops, ride);
    if (problem !== null) {
      throw new RideError(problem.code, problem.message);
    }
    const { pickupStop, dropoffStop } = tripStops(stops, ride)!;

    // Compare-and-set: only a request that is still waiting can take a seat.
    const claimed = await tx.rideRequest.updateMany({
      where: { id: ride.id, status: RideStatus.REQUESTED },
      data: { status: RideStatus.MATCHED },
    });
    if (claimed.count === 0) {
      // Say why, so the driver's screen is clear: the passenger cancelled, or another
      // car was faster.
      const now = await tx.rideRequest.findUniqueOrThrow({
        where: { id: ride.id },
      });
      throw new RideError(
        'ALREADY_TAKEN',
        now.status === RideStatus.CANCELLED
          ? 'The passenger cancelled this request'
          : 'This request is no longer waiting',
      );
    }

    // Seat update with its conditions in the SQL itself (second line of defence):
    // the pool must still be active, the car must not have passed the pickup, and
    // there must be room. The CHECK constraint is the third.
    const seatsUpdated = await tx.pool.updateMany({
      where: {
        id: pool.id,
        status: { in: ACTIVE_POOL_STATUSES },
        currentStop: { lte: pickupStop },
        seatsTaken: { lte: pool.seatCapacity - ride.seats },
      },
      data: { seatsTaken: { increment: ride.seats } },
    });
    if (seatsUpdated.count === 0) {
      throw new RideError('SEATS_UNAVAILABLE', 'No seats left in this pool');
    }

    await tx.poolMember.create({
      data: {
        poolId: pool.id,
        rideRequestId: ride.id,
        seats: ride.seats,
        pickupStop,
        dropoffStop,
      },
    });
    await tx.rideEvent.create({
      data: {
        rideRequestId: ride.id,
        poolId: pool.id,
        fromStatus: RideStatus.REQUESTED,
        toStatus: RideStatus.MATCHED,
        actorUserId,
        reason,
      },
    });

    // The car is already standing at this passenger's stop: they can get in now.
    if (
      pool.status === RideStatus.DRIVER_ARRIVED &&
      pool.currentStop === pickupStop
    ) {
      await tx.rideRequest.update({
        where: { id: ride.id },
        data: { status: RideStatus.DRIVER_ARRIVED },
      });
      await tx.rideEvent.create({
        data: {
          rideRequestId: ride.id,
          poolId: pool.id,
          fromStatus: RideStatus.MATCHED,
          toStatus: RideStatus.DRIVER_ARRIVED,
          actorUserId: null,
          reason: `The car is already at ${stops[pickupStop].name}`,
        },
      });
    }
  }

  /**
   * Takes a ride that has not been picked up out of its pool and frees its seats:
   * a passenger cancel, or the driver marking a no-show. Closes the pool if it is now empty.
   */
  async leaveUnderLock(
    tx: Tx,
    poolId: string,
    ride: RideRequest,
    actorUserId: string,
    reason: string,
  ): Promise<void> {
    const membership = await tx.poolMember.findFirst({
      where: { poolId, rideRequestId: ride.id, leftAt: null },
    });
    if (membership === null) {
      throw new RideError('INVALID_TRANSITION', 'This ride holds no seat');
    }

    // Late cancel or no-show: Tk 20 once the car is coming straight to this stop or is
    // there (D-018). Paid in cash with the passenger's next ride; this trip's driver earns it.
    const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
    const fee = cancellationFeePaisa({
      carStop: pool.currentStop,
      pickupStop: membership.pickupStop,
      joinedAt: membership.joinedAt,
      now: new Date(),
    });

    await tx.rideRequest.update({
      where: { id: ride.id },
      data: {
        status: RideStatus.CANCELLED,
        cancellationFeePaisa: fee,
        cancellationFeePoolId: fee > 0 ? poolId : null,
      },
    });
    await tx.poolMember.update({
      where: { id: membership.id },
      data: { leftAt: new Date() },
    });
    await tx.pool.update({
      where: { id: poolId },
      data: { seatsTaken: { decrement: membership.seats } },
    });
    await tx.rideEvent.create({
      data: {
        rideRequestId: ride.id,
        poolId,
        fromStatus: ride.status,
        toStatus: RideStatus.CANCELLED,
        actorUserId,
        reason:
          fee > 0
            ? `${reason}; Tk ${fee / 100} fee, paid with the next ride`
            : reason,
      },
    });

    await this.fillFreedSeats(tx, poolId);
    await this.closeIfEmpty(tx, poolId);
  }

  /**
   * A seat was just freed in this trip (a cancel, a no-show or a drop-off): give it at once
   * to riders who are waiting and fit (D-017), best first, in the same transaction and
   * under the same vehicle lock. The order is the driver's list order: riders waiting
   * 5+ minutes first, then the nearest pickups.
   *
   * Best effort, like auto-join: it runs inside a savepoint, so if anything goes wrong
   * the cancel or drop-off that freed the seat still succeeds and the riders keep waiting.
   */
  async fillFreedSeats(tx: Tx, poolId: string): Promise<void> {
    await tx.$executeRawUnsafe('SAVEPOINT fill_freed_seats');
    try {
      await this.seatWaitingRiders(tx, poolId);
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT fill_freed_seats');
    } catch (error) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fill_freed_seats');
      this.logger.warn(
        { poolId, error: error instanceof Error ? error.message : error },
        'could not fill a freed seat; the riders keep waiting',
      );
    }
  }

  private async seatWaitingRiders(tx: Tx, poolId: string): Promise<void> {
    let pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
    const vehicle = await tx.vehicle.findUniqueOrThrow({
      where: { id: pool.vehicleId },
    });
    if (
      !ACTIVE_POOL_STATUSES.includes(pool.status) ||
      !vehicle.isOnline ||
      pool.seatsTaken >= pool.seatCapacity
    ) {
      return;
    }

    // Riders waiting at this stop or further along the route: the car never goes back.
    const stops = await this.ridesRepository.findRouteStops(tx, pool.routeId);
    const ahead = stops.filter((stop) => stop.position >= pool.currentStop);
    const waiting = await this.ridesRepository.lockWaitingRides(
      tx,
      ahead.map((stop) => stop.zoneId),
    );

    const listed = waiting.map((ride) => {
      const positions = tripStops(stops, ride);
      return {
        ride,
        canAccept: joinProblem(pool, stops, ride) === null,
        pickupKmAhead:
          positions === null
            ? null
            : approachKm(stops, pool.currentStop, positions.pickupStop),
        requestedAt: ride.createdAt,
      };
    });

    for (const candidate of orderWaitingList(listed, new Date())) {
      if (!candidate.canAccept) {
        break; // the list puts every rider who fits first
      }
      // Seats change with every rider seated, so check this one against the pool as it is now.
      if (joinProblem(pool, stops, candidate.ride) !== null) {
        continue;
      }
      await this.joinUnderLock(
        tx,
        pool,
        candidate.ride,
        null,
        'A seat came free in a Tesla on the way: joined automatically',
      );
      pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
      if (pool.seatsTaken >= pool.seatCapacity) {
        return;
      }
    }
  }

  /**
   * Ends a pool that has nobody left in it: CANCELLED if the car never carried anyone,
   * otherwise COMPLETED with the money split locked (docs/assumptions.md §7.2).
   */
  async closeIfEmpty(tx: Tx, poolId: string): Promise<void> {
    const remaining = await tx.poolMember.count({
      where: { poolId, leftAt: null },
    });
    if (remaining > 0) {
      return;
    }
    const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
    if (pool.startedAt === null) {
      await tx.pool.update({
        where: { id: poolId },
        data: { status: RideStatus.CANCELLED, endedAt: new Date() },
      });
      return;
    }

    // Everyone who was carried, with the fare locked at their drop-off.
    const carried = await tx.poolMember.findMany({
      where: { poolId, rideRequest: { status: RideStatus.COMPLETED } },
      include: { rideRequest: true },
    });
    const stops = await this.ridesRepository.findRouteStops(tx, pool.routeId);
    const earnings = tripEarnings(
      stops,
      carried.map((member) => ({
        pickupStop: member.pickupStop,
        dropoffStop: member.dropoffStop,
        farePaisa: member.rideRequest.finalFarePaisa ?? 0,
      })),
    );
    await tx.pool.update({
      where: { id: poolId },
      data: {
        status: RideStatus.COMPLETED,
        endedAt: new Date(),
        collectedPaisa: earnings.collectedPaisa,
        driverEarningsPaisa: earnings.driverPaisa,
        platformFeePaisa: earnings.platformPaisa,
      },
    });
  }
}
