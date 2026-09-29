import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, RideStatus } from '../generated/prisma/client.js';
import type { Stop } from '../pooling/route-plan.js';
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

  // ---------- reads (no lock needed) ----------

  async findVehicleByDriver(driverId: string) {
    return this.prisma.vehicle.findUnique({
      where: { driverId },
      include: { route: true },
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

  async listWaitingRequests() {
    return this.prisma.rideRequest.findMany({
      where: { status: RideStatus.REQUESTED },
      orderBy: { createdAt: 'asc' },
      include: { passenger: true, pickupZone: true, dropoffZone: true },
      take: 50,
    });
  }

  /**
   * Pools a new request might join: active, driver online, and the route stops at the
   * pickup zone. Oldest first. The full rules (R1–R4) are checked again under the lock.
   */
  async listJoinablePools(pickupZoneId: string) {
    return this.prisma.pool.findMany({
      where: {
        status: { in: ACTIVE_POOL_STATUSES },
        vehicle: { isOnline: true },
        route: { stops: { some: { zoneId: pickupZoneId } } },
      },
      orderBy: { createdAt: 'asc' },
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

  /** Cancels a ride only if it is still REQUESTED (compare-and-set). True if it did. */
  async cancelWaitingRide(
    rideId: string,
    passengerId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
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
          reason: 'Passenger cancelled before being matched',
        },
      });
      return true;
    });
  }
}

// 55P03 = PostgreSQL "lock_not_available", raised when lock_timeout expires.
function isLockTimeout(error: unknown): boolean {
  return JSON.stringify(error ?? '').includes('55P03');
}
