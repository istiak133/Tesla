import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, RideStatus } from '../generated/prisma/client.js';
import type { OpenTrip, WaitingRequest } from '../pooling/assignment.js';
import {
  MAX_EXTRA_KM,
  MAX_STRETCH_PERCENT,
  type Stop,
} from '../pooling/route-plan.js';
import { DRIVER_SILENT_MS, SEEN_WRITE_INTERVAL_MS } from './driver-presence.js';
import { RideError } from './ride.errors.js';

// The client passed into a transaction callback.
export type Tx = Prisma.TransactionClient;

export const ACTIVE_STATUSES: RideStatus[] = [
  RideStatus.REQUESTED,
  RideStatus.MATCHED,
  RideStatus.DRIVER_ARRIVED,
  RideStatus.STARTED,
];

export const ACTIVE_POOL_STATUSES: RideStatus[] = [
  RideStatus.MATCHED,
  RideStatus.DRIVER_ARRIVED,
  RideStatus.STARTED,
];

/**
 * Where a waiting request could be served: a route, the first stop still ahead of the car,
 * and the free seats. A running trip gives its current stop and free seats; an idle car gives
 * its own stop and all its seats.
 */
export type ServableBy = {
  routeId: string;
  fromStop: number;
  freeSeats: number;
};

// A route with its stops in driving order, for includes.
const ROUTE_STOPS = {
  stops: { orderBy: { position: 'asc' }, include: { zone: true } },
} satisfies Prisma.RouteInclude;

/**
 * The only place that talks to the database for rides, pools and vehicles.
 *
 * Concurrency rule ("one vehicle = one line"): every change to a vehicle's seats
 * or pool happens inside withVehicleLock(). Two actions on the same vehicle then
 * run one after the other, never at the same time. The database CHECK and unique
 * indexes are the second line of defence.
 */
@Injectable()
export class RidesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- the lock ----------

  async withVehicleLock<T>(
    vehicleId: string,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Do not wait for the lock for more than 3 seconds.
          await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
          // Lock this vehicle's row until the transaction ends.
          await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId}::uuid FOR UPDATE`;
          return work(tx);
        },
        // Longer than lock_timeout, so the lock wait fails first with a clear error.
        { maxWait: 5_000, timeout: 10_000 },
      );
    } catch (error) {
      if (isLockTimeout(error)) {
        throw new RideError('BUSY', 'The vehicle is busy, please try again');
      }
      throw error;
    }
  }

  /**
   * Marks the driver's app as seen now. Written at most every SEEN_WRITE_INTERVAL_MS, so a
   * driver polling every few seconds costs one small write per half minute, not per request.
   */
  async touchDriver(driverId: string, now: Date): Promise<void> {
    await this.prisma.vehicle.updateMany({
      where: {
        driverId,
        OR: [
          { lastSeenAt: null },
          {
            lastSeenAt: {
              lt: new Date(now.getTime() - SEEN_WRITE_INTERVAL_MS),
            },
          },
        ],
      },
      data: { lastSeenAt: now },
    });
  }

  // ---------- reads (no lock needed) ----------

  async findVehicleByDriver(driverId: string) {
    return this.prisma.vehicle.findUnique({
      where: { driverId },
      include: { route: true, currentZone: true },
    });
  }

  async findRide(rideId: string) {
    return this.prisma.rideRequest.findUnique({ where: { id: rideId } });
  }

  async findActiveRideOfPassenger(passengerId: string) {
    return this.prisma.rideRequest.findFirst({
      where: { passengerId, status: { in: ACTIVE_STATUSES } },
    });
  }

  /** The passenger's latest ride that ended (completed or cancelled) since `since`, if any. */
  async findLatestEndedRideOfPassenger(passengerId: string, since: Date) {
    return this.prisma.rideRequest.findFirst({
      where: {
        passengerId,
        status: { in: [RideStatus.COMPLETED, RideStatus.CANCELLED] },
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listRidesOfPassenger(passengerId: string) {
    return this.prisma.rideRequest.findMany({
      where: { passengerId },
      orderBy: { createdAt: 'desc' },
      include: { pickupZone: true, dropoffZone: true },
      take: 50,
    });
  }

  /** A ride with everything a passenger screen shows. */
  async findRideDetails(rideId: string) {
    return this.prisma.rideRequest.findUnique({
      where: { id: rideId },
      include: {
        pickupZone: true,
        dropoffZone: true,
        events: { orderBy: { createdAt: 'asc' } },
        memberships: {
          orderBy: { joinedAt: 'desc' },
          take: 1,
          include: {
            pool: {
              include: {
                route: { include: ROUTE_STOPS },
                vehicle: { include: { driver: true } },
                members: {
                  include: { rideRequest: { include: { passenger: true } } },
                },
              },
            },
          },
        },
      },
    });
  }

  /** The oldest waiting requests, for route suggestions (demand per route). */
  async listWaitingRequests() {
    return this.prisma.rideRequest.findMany({
      where: { status: RideStatus.REQUESTED },
      orderBy: { createdAt: 'asc' },
      include: { passenger: true, pickupZone: true, dropoffZone: true },
      take: 50,
    });
  }

  /**
   * Running trips with at least one free seat, on cars that are online and whose driver's
   * app was seen in the last DRIVER_SILENT_MS: everything the matcher can seat riders in
   * (D-023). Read without a lock; every seat is taken later under the car's lock with R1–R4
   * checked again.
   */
  async listOpenTrips(): Promise<OpenTrip[]> {
    const pools = await this.prisma.pool.findMany({
      where: {
        status: { in: ACTIVE_POOL_STATUSES },
        // A driver whose app has gone silent gets no new riders: the requests go back to
        // idle drivers instead of waiting for a car that may never come.
        vehicle: {
          isOnline: true,
          lastSeenAt: { gte: new Date(Date.now() - DRIVER_SILENT_MS) },
        },
      },
      orderBy: { createdAt: 'asc' },
      include: { route: { include: ROUTE_STOPS } },
    });
    return pools
      .filter((pool) => pool.seatsTaken < pool.seatCapacity)
      .map((pool) => ({
        vehicleId: pool.vehicleId,
        poolId: pool.id,
        routeId: pool.routeId,
        createdAt: pool.createdAt,
        status: pool.status,
        currentStop: pool.currentStop,
        seatCapacity: pool.seatCapacity,
        seatsTaken: pool.seatsTaken,
        stops: pool.route.stops.map((stop) => ({
          position: stop.position,
          zoneId: stop.zoneId,
          name: stop.zone.name,
          kmFromStart: stop.kmFromStart,
        })),
      }));
  }

  /**
   * Waiting requests that at least one target can carry, oldest first, at most `limit`
   * (D-023). The route checks run in SQL before the limit: requests never expire, so if the
   * limit came first, `limit` old requests that no car can serve would fill the window for
   * ever and hide every newer request from the matcher and from drivers.
   * A target carries a request when its route passes the pickup and then the drop-off without
   * going too far round (R1), the pickup is at or ahead of `fromStop` (R2), and the seats fit
   * (R3). Each seat is still checked again under the car's lock.
   */
  async listWaitingServable(
    targets: ServableBy[],
    limit: number,
  ): Promise<WaitingRequest[]> {
    if (targets.length === 0) {
      return [];
    }
    const values = Prisma.join(
      targets.map(
        (target) =>
          Prisma.sql`(${target.routeId}::uuid, ${target.fromStop}::int, ${target.freeSeats}::int)`,
      ),
    );
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        pickup_zone_id: string;
        dropoff_zone_id: string;
        distance_km: number;
        seats: number;
        created_at: Date;
      }[]
    >`
      SELECT r.id, r.pickup_zone_id, r.dropoff_zone_id, r.distance_km, r.seats, r.created_at
      FROM ride_requests r
      JOIN route_stops p ON p.zone_id = r.pickup_zone_id
      JOIN route_stops d
        ON d.route_id = p.route_id AND d.zone_id = r.dropoff_zone_id AND d.position > p.position
      JOIN (VALUES ${values}) AS t(route_id, from_stop, free_seats)
        ON t.route_id = p.route_id AND p.position >= t.from_stop AND r.seats <= t.free_seats
      WHERE r.status = 'REQUESTED'
        AND (d.km_from_start - p.km_from_start <= r.distance_km + ${MAX_EXTRA_KM}
          OR (d.km_from_start - p.km_from_start) * 100 <= r.distance_km * ${MAX_STRETCH_PERCENT})
      GROUP BY r.id
      ORDER BY r.created_at ASC, r.id ASC
      LIMIT ${limit}`;
    return rows.map((row) => ({
      id: row.id,
      pickupZoneId: row.pickup_zone_id,
      dropoffZoneId: row.dropoff_zone_id,
      distanceKm: row.distance_km,
      seats: row.seats,
      createdAt: row.created_at,
    }));
  }

  /** The given waiting requests with what a driver's list shows, oldest first. */
  async findWaitingRequestsByIds(rideIds: string[]) {
    if (rideIds.length === 0) {
      return [];
    }
    return this.prisma.rideRequest.findMany({
      where: { id: { in: rideIds }, status: RideStatus.REQUESTED },
      orderBy: { createdAt: 'asc' },
      include: { passenger: true, pickupZone: true, dropoffZone: true },
    });
  }

  /** The vehicle's current pool with its route and every member (for the driver screen). */
  async findActivePoolDetails(vehicleId: string) {
    return this.prisma.pool.findFirst({
      where: { vehicleId, status: { in: ACTIVE_POOL_STATUSES } },
      include: {
        route: { include: ROUTE_STOPS },
        members: {
          orderBy: { joinedAt: 'asc' },
          include: {
            rideRequest: {
              include: { passenger: true, pickupZone: true, dropoffZone: true },
            },
          },
        },
      },
    });
  }

  /** Finished trips of a vehicle (completed or cancelled), newest first. */
  async listPastPools(vehicleId: string) {
    return this.prisma.pool.findMany({
      where: {
        vehicleId,
        status: { in: [RideStatus.COMPLETED, RideStatus.CANCELLED] },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        route: true,
        members: {
          orderBy: { joinedAt: 'asc' },
          include: {
            rideRequest: {
              include: { passenger: true, pickupZone: true, dropoffZone: true },
            },
          },
        },
        // Late-cancel fees this trip's driver earned (D-018).
        cancellationFees: { include: { passenger: true } },
      },
    });
  }

  /** A route's stops, read with the transaction's own connection (safe inside the lock). */
  async findRouteStops(tx: Tx, routeId: string): Promise<Stop[]> {
    const stops = await tx.routeStop.findMany({
      where: { routeId },
      orderBy: { position: 'asc' },
      include: { zone: true },
    });
    return stops.map((stop) => ({
      position: stop.position,
      zoneId: stop.zoneId,
      name: stop.zone.name,
      kmFromStart: stop.kmFromStart,
    }));
  }

  async findActiveMembership(rideRequestId: string) {
    return this.prisma.poolMember.findFirst({
      where: { rideRequestId, leftAt: null },
      include: { pool: true },
    });
  }

  // ---------- writes ----------

  /** Inserts a new REQUESTED ride and its first history event, in one transaction. */
  async createRide(data: {
    passengerId: string;
    pickupZoneId: string;
    dropoffZoneId: string;
    seats: number;
    distanceKm: number;
    estimatedFarePaisa: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.rideRequest.create({ data });
      await tx.rideEvent.create({
        data: {
          rideRequestId: ride.id,
          fromStatus: null,
          toStatus: RideStatus.REQUESTED,
          actorUserId: data.passengerId,
          reason: 'Passenger requested a ride',
        },
      });
      return ride;
    });
  }

  /** Late-cancel fees this passenger still owes (D-018), oldest first. */
  async findUnpaidFees(passengerId: string, tx: Tx = this.prisma) {
    return tx.rideRequest.findMany({
      where: {
        passengerId,
        cancellationFeePaisa: { gt: 0 },
        feePaidWithRideId: null,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Cancels a ride only if it is still REQUESTED (compare-and-set). True if it did. */
  async cancelWaitingRide(
    rideId: string,
    passengerId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction((tx) =>
      this.cancelIfWaiting(tx, rideId, passengerId),
    );
  }

  /** The same compare-and-set, inside a transaction the caller already holds. */
  async cancelIfWaiting(
    tx: Tx,
    rideId: string,
    passengerId: string,
  ): Promise<boolean> {
    const result = await tx.rideRequest.updateMany({
      where: { id: rideId, status: RideStatus.REQUESTED },
      data: { status: RideStatus.CANCELLED },
    });
    if (result.count === 0) {
      return false;
    }
    await tx.rideEvent.create({
      data: {
        rideRequestId: rideId,
        fromStatus: RideStatus.REQUESTED,
        toStatus: RideStatus.CANCELLED,
        actorUserId: passengerId,
        reason: 'Passenger cancelled while waiting for a driver',
      },
    });
    return true;
  }
}

// 55P03 = PostgreSQL "lock_not_available", raised when lock_timeout expires.
function isLockTimeout(error: unknown): boolean {
  return JSON.stringify(error ?? '').includes('55P03');
}
