import { Injectable } from '@nestjs/common';
import { finalFarePaisa } from '../fares/fare.js';
import { Pool, RideStatus } from '../generated/prisma/client.js';
import { RideError } from '../rides/ride.errors.js';
import {
  ACTIVE_POOL_STATUSES,
  RidesRepository,
  Tx,
} from '../rides/rides.repository.js';
import { DriverService } from './driver.service.js';

// Allowed pool transitions (docs/assumptions.md §5.2). Anything else is rejected.
const NEXT_STATUS = {
  arrive: { from: RideStatus.MATCHED, to: RideStatus.DRIVER_ARRIVED },
  start: { from: RideStatus.DRIVER_ARRIVED, to: RideStatus.STARTED },
  complete: { from: RideStatus.STARTED, to: RideStatus.COMPLETED },
} as const;

type TripStep = keyof typeof NEXT_STATUS;

/**
 * The trip lifecycle, driven by the driver. Each action changes the pool and
 * every passenger in it together, inside the vehicle lock.
 */
@Injectable()
export class TripService {
  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly driverService: DriverService,
  ) {}

  arrive(driverId: string) {
    return this.moveTrip(driverId, 'arrive');
  }

  start(driverId: string) {
    return this.moveTrip(driverId, 'start');
  }

  complete(driverId: string) {
    return this.moveTrip(driverId, 'complete');
  }

  /** Before the trip starts (e.g. a breakdown): passengers go back to waiting, not cancelled. */
  async cancelTrip(driverId: string) {
    const vehicle = await this.driverService.getVehicle(driverId);

    await this.ridesRepository.withVehicleLock(vehicle.id, async (tx) => {
      const pool = await this.findActivePool(tx, vehicle.id);
      const cancellable: RideStatus[] = [
        RideStatus.MATCHED,
        RideStatus.DRIVER_ARRIVED,
      ];
      if (!cancellable.includes(pool.status)) {
        throw new RideError(
          'INVALID_TRANSITION',
          'A trip cannot be cancelled once it has started',
        );
      }

      const members = await tx.poolMember.findMany({
        where: { poolId: pool.id, leftAt: null },
        include: { rideRequest: true },
      });
      for (const member of members) {
        await tx.rideRequest.update({
          where: { id: member.rideRequestId },
          data: { status: RideStatus.REQUESTED },
        });
        await tx.poolMember.update({
          where: { id: member.id },
          data: { leftAt: new Date() },
        });
        await tx.rideEvent.create({
          data: {
            rideRequestId: member.rideRequestId,
            poolId: pool.id,
            fromStatus: member.rideRequest.status,
            toStatus: RideStatus.REQUESTED,
            actorUserId: driverId,
            reason: 'Driver cancelled the trip; waiting for another driver',
          },
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

  private async moveTrip(driverId: string, step: TripStep) {
    const vehicle = await this.driverService.getVehicle(driverId);
    const { from, to } = NEXT_STATUS[step];

    await this.ridesRepository.withVehicleLock(vehicle.id, async (tx) => {
      const pool = await this.findActivePool(tx, vehicle.id);
      if (pool.status !== from) {
        throw new RideError(
          'INVALID_TRANSITION',
          `Cannot ${step} a trip that is ${pool.status}`,
        );
      }

      const members = await tx.poolMember.findMany({
        where: { poolId: pool.id, leftAt: null },
        include: { rideRequest: true },
      });
      if (step === 'start' && members.length === 0) {
        throw new RideError('INVALID_TRANSITION', 'There is nobody to take');
      }

      for (const member of members) {
        const ride = member.rideRequest;
        const data: { status: RideStatus; finalFarePaisa?: number } = {
          status: to,
        };
        if (step === 'start') {
          // Fares are locked now: the pool discount depends on who is actually riding.
          data.finalFarePaisa = finalFarePaisa(
            ride.distanceKm,
            ride.seats,
            members.length,
          );
        }
        await tx.rideRequest.update({ where: { id: ride.id }, data });
        await tx.rideEvent.create({
          data: {
            rideRequestId: ride.id,
            poolId: pool.id,
            fromStatus: from,
            toStatus: to,
            actorUserId: driverId,
            reason: REASON[step],
          },
        });
      }

      await tx.pool.update({
        where: { id: pool.id },
        data: {
          status: to,
          startedAt: step === 'start' ? new Date() : undefined,
          endedAt: step === 'complete' ? new Date() : undefined,
        },
      });
    });

    return this.driverService.getCurrentPool(driverId);
  }

  private async findActivePool(tx: Tx, vehicleId: string): Promise<Pool> {
    const pool = await tx.pool.findFirst({
      where: { vehicleId, status: { in: ACTIVE_POOL_STATUSES } },
    });
    if (pool === null) {
      throw new RideError('NO_ACTIVE_POOL', 'You have no current trip');
    }
    return pool;
  }
}

const REASON: Record<TripStep, string> = {
  arrive: 'Driver arrived at the pickup zone',
  start: 'Trip started; fares locked',
  complete: 'Trip completed; pay the driver in cash',
};
