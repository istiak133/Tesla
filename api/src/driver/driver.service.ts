import { Injectable } from '@nestjs/common';
import { RideStatus, Vehicle } from '../generated/prisma/client.js';
import { allDetoursWithinLimit, type Rider } from '../pooling/detour.js';
import { PoolingService } from '../rides/pooling.service.js';
import { RideError } from '../rides/ride.errors.js';
import { firstName } from '../rides/ride.views.js';
import {
  ACTIVE_POOL_STATUSES,
  RidesRepository,
} from '../rides/rides.repository.js';

export type WaitingRequestView = {
  id: string;
  passengerName: string;
  pickup: string;
  dropoff: string;
  seats: number;
  distanceKm: number;
  estimatedFarePaisa: number;
  requestedAt: Date;
  // Whether the driver can accept it right now, and why not.
  canAccept: boolean;
  reason: string | null;
};

/** Everything a driver can do before the trip starts. */
@Injectable()
export class DriverService {
  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly poolingService: PoolingService,
  ) {}

  async getVehicle(driverId: string): Promise<Vehicle> {
    const vehicle = await this.ridesRepository.findVehicleByDriver(driverId);
    if (vehicle === null) {
      throw new RideError('NO_VEHICLE', 'This driver account has no vehicle');
    }
    return vehicle;
  }

  async setOnline(driverId: string, online: boolean): Promise<Vehicle> {
    const vehicle = await this.getVehicle(driverId);

    return this.ridesRepository.withVehicleLock(vehicle.id, async (tx) => {
      if (!online) {
        const activePool = await tx.pool.findFirst({
          where: {
            vehicleId: vehicle.id,
            status: { in: ACTIVE_POOL_STATUSES },
          },
        });
        if (activePool !== null) {
          throw new RideError(
            'HAS_ACTIVE_POOL',
            'Finish or cancel your current trip before going offline',
          );
        }
      }
      return tx.vehicle.update({
        where: { id: vehicle.id },
        data: { isOnline: online },
      });
    });
  }

  /** Waiting requests, oldest first, marked with whether this driver can take them now. */
  async listWaitingRequests(driverId: string): Promise<WaitingRequestView[]> {
    const vehicle = await this.getVehicle(driverId);
    const pool = await this.ridesRepository.findActivePoolDetails(vehicle.id);
    const waiting = await this.ridesRepository.listWaitingRequests();
    const distance = await this.poolingService.distance();

    return waiting.map((ride) => {
      // This check is only advice for the screen. The real check runs under the lock on accept.
      let reason: string | null = null;

      if (!vehicle.isOnline) {
        reason = 'Go online to accept rides';
      } else if (ride.seats > vehicle.seatCapacity) {
        reason = 'Needs more seats than your vehicle has';
      } else if (pool !== null && pool.status !== RideStatus.MATCHED) {
        reason = 'Your trip is already under way';
      } else if (pool !== null) {
        const freeSeats = pool.seatCapacity - pool.seatsTaken;
        if (pool.pickupZoneId !== ride.pickupZoneId) {
          reason = `Different pickup (your pool picks up at ${pool.pickupZone.name})`;
        } else if (ride.seats > freeSeats) {
          reason = `${ride.seats - freeSeats} seat(s) short`;
        } else {
          const riders: Rider[] = pool.members.map((member) => ({
            id: member.rideRequestId,
            dropoffZoneId: member.rideRequest.dropoffZoneId,
          }));
          riders.push({ id: ride.id, dropoffZoneId: ride.dropoffZoneId });
          if (!allDetoursWithinLimit(pool.pickupZoneId, riders, distance)) {
            reason = 'Detour would be longer than 2 km';
          }
        }
      }

      return {
        id: ride.id,
        passengerName: firstName(ride.passenger.name),
        pickup: ride.pickupZone.name,
        dropoff: ride.dropoffZone.name,
        seats: ride.seats,
        distanceKm: ride.distanceKm,
        estimatedFarePaisa: ride.estimatedFarePaisa,
        requestedAt: ride.createdAt,
        canAccept: reason === null,
        reason,
      };
    });
  }

  /**
   * Accepts a waiting request: creates the driver's pool if there is none,
   * otherwise adds the request to the open pool (it must pass M1–M4).
   */
  async acceptRequest(driverId: string, rideId: string) {
    const vehicle = await this.getVehicle(driverId);
    // Loaded before the lock: inside it only the transaction is used.
    const distance = await this.poolingService.distance();

    await this.ridesRepository.withVehicleLock(vehicle.id, async (tx) => {
      // Read again under the lock: these may have changed since the screen loaded.
      const lockedVehicle = await tx.vehicle.findUniqueOrThrow({
        where: { id: vehicle.id },
      });
      if (!lockedVehicle.isOnline) {
        throw new RideError('DRIVER_OFFLINE', 'Go online to accept rides');
      }

      const ride = await tx.rideRequest.findUnique({ where: { id: rideId } });
      if (ride === null) {
        throw new RideError('NOT_FOUND', 'Ride not found');
      }
      if (ride.status !== RideStatus.REQUESTED) {
        throw new RideError(
          'ALREADY_TAKEN',
          'This request is no longer waiting',
        );
      }

      let pool = await tx.pool.findFirst({
        where: { vehicleId: vehicle.id, status: { in: ACTIVE_POOL_STATUSES } },
      });
      if (pool === null) {
        // First passenger: a new pool starts at their pickup zone.
        // Because the vehicle row is locked, two accepts can never create two pools.
        pool = await tx.pool.create({
          data: {
            vehicleId: vehicle.id,
            pickupZoneId: ride.pickupZoneId,
            seatCapacity: lockedVehicle.seatCapacity,
          },
        });
      }

      await this.poolingService.joinUnderLock(
        tx,
        pool,
        ride,
        distance,
        driverId,
        'Driver accepted the request',
      );
    });

    return this.getCurrentPool(driverId);
  }

  /** Past trips: who rode, where to, and what each paid. */
  async listPastTrips(driverId: string) {
    const vehicle = await this.getVehicle(driverId);
    const pools = await this.ridesRepository.listPastPools(vehicle.id);

    return pools.map((pool) => {
      // Passengers who were still in the pool at the end (cancelled riders have left it).
      const riders = pool.members.filter(
        (member) => member.rideRequest.status === RideStatus.COMPLETED,
      );
      let totalFarePaisa = 0;
      for (const rider of riders) {
        totalFarePaisa += rider.rideRequest.finalFarePaisa ?? 0;
      }

      return {
        id: pool.id,
        status: pool.status,
        pickup: pool.pickupZone.name,
        startedAt: pool.startedAt,
        endedAt: pool.endedAt,
        totalFarePaisa,
        passengers: riders.map((rider) => ({
          name: firstName(rider.rideRequest.passenger.name),
          dropoff: rider.rideRequest.dropoffZone.name,
          seats: rider.seats,
          finalFarePaisa: rider.rideRequest.finalFarePaisa,
        })),
      };
    });
  }

  /** The driver's current trip with its passengers, or null. */
  async getCurrentPool(driverId: string) {
    const vehicle = await this.getVehicle(driverId);
    const pool = await this.ridesRepository.findActivePoolDetails(vehicle.id);

    return {
      vehicle: {
        name: vehicle.name,
        seatCapacity: vehicle.seatCapacity,
        isOnline: vehicle.isOnline,
      },
      pool:
        pool === null
          ? null
          : {
              id: pool.id,
              status: pool.status,
              pickup: pool.pickupZone.name,
              seatCapacity: pool.seatCapacity,
              seatsTaken: pool.seatsTaken,
              passengers: pool.members.map((member) => ({
                rideId: member.rideRequestId,
                name: firstName(member.rideRequest.passenger.name),
                seats: member.seats,
                dropoff: member.rideRequest.dropoffZone.name,
                estimatedFarePaisa: member.rideRequest.estimatedFarePaisa,
                finalFarePaisa: member.rideRequest.finalFarePaisa,
              })),
            },
    };
  }
}
