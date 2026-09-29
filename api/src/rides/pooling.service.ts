import { Injectable } from '@nestjs/common';
import { GeographyRepository } from '../geography/geography.repository.js';
import { Pool, RideRequest, RideStatus } from '../generated/prisma/client.js';
import {
  allDetoursWithinLimit,
  type DistanceLookup,
  type Rider,
} from '../pooling/detour.js';
import { RideError } from './ride.errors.js';
import { RidesRepository, Tx } from './rides.repository.js';

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
   * Automatic join (docs/assumptions.md §4.4): put a new request into the oldest
   * open pool that passes M1–M4. Returns true if it joined one.
   */
  async tryAutoJoin(ride: RideRequest): Promise<boolean> {
    // Loaded before any lock (see the class comment).
    const distance = await this.distance();
    // Found without a lock; every condition is checked again under the lock.
    const candidates = await this.ridesRepository.listOpenPoolsAt(
      ride.pickupZoneId,
    );

    for (const candidate of candidates) {
      try {
        await this.ridesRepository.withVehicleLock(
          candidate.vehicleId,
          async (tx) => {
            const pool = await tx.pool.findUniqueOrThrow({
              where: { id: candidate.id },
            });
            const current = await tx.rideRequest.findUniqueOrThrow({
              where: { id: ride.id },
            });
            await this.joinUnderLock(
              tx,
              pool,
              current,
              distance,
              null,
              'Joined an open pool automatically',
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
          // This pool did not fit (full, detour too long, already started). Try the next.
          continue;
        }
        throw error;
      }
    }
    return false;
  }

  /**
   * Checks M1–M4 against the locked pool and, if they pass, gives the ride its seats.
   * Throws a RideError (and the transaction rolls back) if anything does not fit.
   */
  async joinUnderLock(
    tx: Tx,
    pool: Pool,
    ride: RideRequest,
    distance: DistanceLookup,
    actorUserId: string | null,
    reason: string,
  ): Promise<void> {
    await this.assertCanJoin(tx, pool, ride, distance);

    // Compare-and-set: only a request that is still waiting can take a seat.
    const claimed = await tx.rideRequest.updateMany({
      where: { id: ride.id, status: RideStatus.REQUESTED },
      data: { status: RideStatus.MATCHED },
    });
    if (claimed.count === 0) {
      throw new RideError('ALREADY_TAKEN', 'This request is no longer waiting');
    }

    // Seat update with its conditions in the SQL itself (second line of defence):
    // the pool must still be open and have room. The CHECK constraint is the third.
    const seatsUpdated = await tx.pool.updateMany({
      where: {
        id: pool.id,
        status: RideStatus.MATCHED,
        seatsTaken: { lte: pool.seatCapacity - ride.seats },
      },
      data: { seatsTaken: { increment: ride.seats } },
    });
    if (seatsUpdated.count === 0) {
      throw new RideError('SEATS_UNAVAILABLE', 'No seats left in this pool');
    }

    await tx.poolMember.create({
      data: { poolId: pool.id, rideRequestId: ride.id, seats: ride.seats },
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
  }

  /**
   * Takes a ride out of its pool (passenger cancel) and frees its seats.
   * If nobody is left and the trip has not started, the pool is cancelled too.
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

    await tx.rideRequest.update({
      where: { id: ride.id },
      data: { status: RideStatus.CANCELLED },
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
        reason,
      },
    });

    const remaining = await tx.poolMember.count({
      where: { poolId, leftAt: null },
    });
    if (remaining === 0) {
      await tx.pool.update({
        where: { id: poolId },
        data: { status: RideStatus.CANCELLED, endedAt: new Date() },
      });
    }
  }

  /** M1–M4 from docs/assumptions.md §4.1, checked on the locked pool row. */
  private async assertCanJoin(
    tx: Tx,
    pool: Pool,
    ride: RideRequest,
    distance: DistanceLookup,
  ) {
    if (pool.status !== RideStatus.MATCHED) {
      throw new RideError('POOL_NOT_OPEN', 'This trip is already under way');
    }
    if (pool.pickupZoneId !== ride.pickupZoneId) {
      throw new RideError('NOT_COMPATIBLE', 'Different pickup zone');
    }

    const freeSeats = pool.seatCapacity - pool.seatsTaken;
    if (ride.seats > freeSeats) {
      const short = ride.seats - freeSeats;
      throw new RideError('SEATS_UNAVAILABLE', `${short} seat(s) short`);
    }

    const members = await tx.poolMember.findMany({
      where: { poolId: pool.id, leftAt: null },
      include: { rideRequest: true },
    });
    // Oldest request first, so ties in drop-off order go to the earlier request.
    members.sort(
      (a, b) =>
        a.rideRequest.createdAt.getTime() - b.rideRequest.createdAt.getTime(),
    );
    const riders: Rider[] = members.map((member) => ({
      id: member.rideRequestId,
      dropoffZoneId: member.rideRequest.dropoffZoneId,
    }));
    riders.push({ id: ride.id, dropoffZoneId: ride.dropoffZoneId });

    if (!allDetoursWithinLimit(pool.pickupZoneId, riders, distance)) {
      throw new RideError(
        'NOT_COMPATIBLE',
        'The detour would be longer than 2 km for someone',
      );
    }
  }
}
