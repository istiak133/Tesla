import { Injectable } from '@nestjs/common';
import {
  GeographyRepository,
  toStops,
} from '../geography/geography.repository.js';
import { RideStatus, Vehicle } from '../generated/prisma/client.js';
import {
  approachKm,
  newTripStart,
  orderWaitingList,
  stopOf,
} from '../pooling/matching.js';
import { joinProblem, tripStops } from '../pooling/route-plan.js';
import {
  rankRoutes,
  suggestedRoute,
  type RankedRoute,
} from '../pooling/route-suggestion.js';
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
  // How far this driver's car drives along its route to reach the pickup (null: not reachable).
  pickupKmAhead: number | null;
  // Whether the driver can accept it right now, and why not.
  canAccept: boolean;
  reason: string | null;
};

// Passengers the driver still sees in the trip: waiting, on board, or dropped off.
const SHOWN_IN_TRIP: RideStatus[] = [
  RideStatus.MATCHED,
  RideStatus.DRIVER_ARRIVED,
  RideStatus.STARTED,
  RideStatus.COMPLETED,
];

/** Everything a driver does outside the stop-by-stop trip actions. */
@Injectable()
export class DriverService {
  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly geographyRepository: GeographyRepository,
    private readonly poolingService: PoolingService,
  ) {}

  async getVehicle(driverId: string): Promise<Vehicle> {
    const vehicle = await this.ridesRepository.findVehicleByDriver(driverId);
    if (vehicle === null) {
      throw new RideError('NO_VEHICLE', 'This driver account has no vehicle');
    }
    return vehicle;
  }

  /** Picks the route the vehicle drives. Not allowed in the middle of a trip. */
  async chooseRoute(driverId: string, routeId: string): Promise<void> {
    const vehicle = await this.getVehicle(driverId);
    const routes = await this.geographyRepository.listRoutes();
    const route = routes.find((r) => r.id === routeId);
    if (route === undefined) {
      throw new RideError('NOT_FOUND', 'Route not found');
    }

    await this.ridesRepository.withVehicleLock(vehicle.id, async (tx) => {
      const activePool = await tx.pool.findFirst({
        where: { vehicleId: vehicle.id, status: { in: ACTIVE_POOL_STATUSES } },
      });
      if (activePool !== null) {
        throw new RideError(
          'HAS_ACTIVE_POOL',
          'Finish your current trip before changing route',
        );
      }
      // A car drives the route from where it is, so the route must pass the car (D-014).
      const locked = await tx.vehicle.findUniqueOrThrow({
        where: { id: vehicle.id },
      });
      if (
        locked.currentZoneId !== null &&
        stopOf(toStops(route), locked.currentZoneId) === null
      ) {
        throw new RideError(
          'NOT_COMPATIBLE',
          'This route does not pass where your car is: set your location first',
        );
      }
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: { routeId },
      });
    });
  }

  /**
   * Where the car is, told by the driver before the first trip. During a trip the
   * location follows the stops (TripService.arrive), so it cannot be set by hand then.
   */
  async setLocation(driverId: string, zoneId: string): Promise<void> {
    const vehicle = await this.getVehicle(driverId);
    if (!(await this.geographyRepository.zoneExists(zoneId))) {
      throw new RideError('INVALID_ZONE', 'Unknown zone');
    }

    await this.ridesRepository.withVehicleLock(vehicle.id, async (tx) => {
      const activePool = await tx.pool.findFirst({
        where: { vehicleId: vehicle.id, status: { in: ACTIVE_POOL_STATUSES } },
      });
      if (activePool !== null) {
        throw new RideError(
          'HAS_ACTIVE_POOL',
          'During a trip your location follows the stops',
        );
      }
      // A route that does not pass the new location can no longer be driven from here
      // (a trip starts where the car is, D-014): clear it, and go offline until the driver
      // picks one of the routes listed for this location (D-019).
      const locked = await tx.vehicle.findUniqueOrThrow({
        where: { id: vehicle.id },
      });
      const routeStillPasses =
        locked.routeId !== null &&
        (await tx.routeStop.count({
          where: { routeId: locked.routeId, zoneId },
        })) > 0;
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: routeStillPasses
          ? { currentZoneId: zoneId }
          : { currentZoneId: zoneId, routeId: null, isOnline: false },
      });
    });
  }

  /**
   * The routes this driver can take from where the car is (only routes that pass the car's
   * zone: a trip starts at the car, D-014), ranked by riders waiting ahead, with the
   * suggested one. No location yet → no routes. Only advice: the driver still chooses.
   */
  async suggestRoutes(driverId: string): Promise<{
    currentZone: { id: string; name: string } | null;
    suggestedRouteId: string | null;
    routes: RankedRoute[];
  }> {
    const vehicle = await this.ridesRepository.findVehicleByDriver(driverId);
    if (vehicle === null) {
      throw new RideError('NO_VEHICLE', 'This driver account has no vehicle');
    }
    const routes = await this.geographyRepository.listRoutes();
    const waiting = await this.ridesRepository.listWaitingRequests();

    const ranked = rankRoutes(
      routes.map((route) => ({ ...route, stops: toStops(route) })),
      vehicle.currentZoneId,
      waiting,
    );
    return {
      currentZone:
        vehicle.currentZone === null
          ? null
          : { id: vehicle.currentZone.id, name: vehicle.currentZone.name },
      suggestedRouteId: suggestedRoute(ranked)?.routeId ?? null,
      routes: ranked.filter((route) => route.passesYou),
    };
  }

  async setOnline(driverId: string, online: boolean): Promise<Vehicle> {
    const vehicle = await this.getVehicle(driverId);

    return this.ridesRepository.withVehicleLock(vehicle.id, async (tx) => {
      const locked = await tx.vehicle.findUniqueOrThrow({
        where: { id: vehicle.id },
      });
      if (online && locked.routeId === null) {
        throw new RideError('ROUTE_REQUIRED', 'Choose a route first');
      }
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
    const routes = await this.geographyRepository.listRoutes();
    const route = routes.find((r) => r.id === vehicle.routeId);
    const stops = route ? toStops(route) : [];

    // Where the car is on its route: the trip's current stop, or the car's zone between trips.
    const carStop =
      pool !== null ? pool.currentStop : stopOf(stops, vehicle.currentZoneId);

    const listed = waiting.map((ride) => {
      // This check is only advice for the screen. The real check runs under the lock on accept.
      let reason: string | null = null;

      if (route === undefined) {
        reason = 'Choose a route first';
      } else if (!vehicle.isOnline) {
        reason = 'Go online to accept rides';
      } else if (ride.seats > vehicle.seatCapacity) {
        reason = 'Needs more seats than your vehicle has';
      } else if (pool !== null) {
        reason = joinProblem(pool, stops, ride)?.message ?? null;
      } else {
        const start = newTripStart(stops, vehicle.currentZoneId, ride);
        if ('problem' in start) {
          reason = start.problem;
        }
      }

      const positions = route ? tripStops(stops, ride) : null;
      const pickupKmAhead =
        positions !== null && carStop !== null
          ? approachKm(stops, carStop, positions.pickupStop)
          : null;

      return {
        id: ride.id,
        passengerName: firstName(ride.passenger.name),
        pickup: ride.pickupZone.name,
        dropoff: ride.dropoffZone.name,
        seats: ride.seats,
        distanceKm: ride.distanceKm,
        estimatedFarePaisa: ride.estimatedFarePaisa,
        requestedAt: ride.createdAt,
        pickupKmAhead,
        canAccept: reason === null,
        reason,
      };
    });
    // Takeable and near first, with aged requests lifted to the top (D-014).
    return orderWaitingList(listed, new Date());
  }

  /**
   * Accepts a waiting request: starts a trip on the vehicle's route if there is none
   * (at the car's own stop; the pickup must be there or ahead), otherwise adds it to the
   * current trip (R1–R4).
   */
  async acceptRequest(driverId: string, rideId: string) {
    const vehicle = await this.getVehicle(driverId);

    await this.ridesRepository.withVehicleLock(vehicle.id, async (tx) => {
      // Read again under the lock: these may have changed since the screen loaded.
      const lockedVehicle = await tx.vehicle.findUniqueOrThrow({
        where: { id: vehicle.id },
      });
      if (!lockedVehicle.isOnline) {
        throw new RideError('DRIVER_OFFLINE', 'Go online to accept rides');
      }
      if (lockedVehicle.routeId === null) {
        throw new RideError('ROUTE_REQUIRED', 'Choose a route first');
      }

      const ride = await tx.rideRequest.findUnique({ where: { id: rideId } });
      if (ride === null) {
        throw new RideError('NOT_FOUND', 'Ride not found');
      }
      if (ride.status !== RideStatus.REQUESTED) {
        throw new RideError(
          'ALREADY_TAKEN',
          ride.status === RideStatus.CANCELLED
            ? 'The passenger cancelled this request'
            : 'This request is no longer waiting',
        );
      }

      let pool = await tx.pool.findFirst({
        where: { vehicleId: vehicle.id, status: { in: ACTIVE_POOL_STATUSES } },
      });
      if (pool === null) {
        // First passenger: a new trip on this route that starts where the car is, so the
        // car drives stop by stop to the pickup (and can take others on the way).
        // Because the vehicle row is locked, two accepts can never create two trips.
        const stops = await this.ridesRepository.findRouteStops(
          tx,
          lockedVehicle.routeId,
        );
        const start = newTripStart(stops, lockedVehicle.currentZoneId, ride);
        if ('problem' in start) {
          throw new RideError('NOT_COMPATIBLE', start.problem);
        }
        pool = await tx.pool.create({
          data: {
            vehicleId: vehicle.id,
            routeId: lockedVehicle.routeId,
            currentStop: start.startStop,
            seatCapacity: lockedVehicle.seatCapacity,
          },
        });
      }

      await this.poolingService.joinUnderLock(
        tx,
        pool,
        ride,
        driverId,
        'Driver accepted the request',
      );
    });

    return this.getCurrentPool(driverId);
  }

  /** Past trips: the route, who rode, where to, and what each paid. */
  async listPastTrips(driverId: string) {
    const vehicle = await this.getVehicle(driverId);
    const pools = await this.ridesRepository.listPastPools(vehicle.id);

    return pools.map((pool) => {
      // Passengers who were dropped off (cancelled riders and no-shows are left out).
      const riders = pool.members.filter(
        (member) => member.rideRequest.status === RideStatus.COMPLETED,
      );

      return {
        id: pool.id,
        status: pool.status,
        route: pool.route.name,
        startedAt: pool.startedAt,
        endedAt: pool.endedAt,
        // The money split, locked when the trip completed (null for a cancelled trip).
        collectedPaisa: pool.collectedPaisa,
        driverEarningsPaisa: pool.driverEarningsPaisa,
        platformFeePaisa: pool.platformFeePaisa,
        // D-018: late-cancel fees earned on this trip (the platform pays them to the driver),
        // and earlier riders' fees collected in cash here (handed to the platform).
        cancellationFeesPaisa: pool.cancellationFees.reduce(
          (sum, ride) => sum + ride.cancellationFeePaisa,
          0,
        ),
        lateCancels: pool.cancellationFees.map((ride) =>
          firstName(ride.passenger.name),
        ),
        duesCollectedPaisa: riders.reduce(
          (sum, rider) => sum + rider.rideRequest.duesCollectedPaisa,
          0,
        ),
        passengers: riders.map((rider) => ({
          name: firstName(rider.rideRequest.passenger.name),
          pickup: rider.rideRequest.pickupZone.name,
          dropoff: rider.rideRequest.dropoffZone.name,
          seats: rider.seats,
          finalFarePaisa: rider.rideRequest.finalFarePaisa,
          duesCollectedPaisa: rider.rideRequest.duesCollectedPaisa,
        })),
      };
    });
  }

  /** The driver's vehicle, route and current trip with its passengers. */
  async getCurrentPool(driverId: string) {
    const vehicle = await this.ridesRepository.findVehicleByDriver(driverId);
    if (vehicle === null) {
      throw new RideError('NO_VEHICLE', 'This driver account has no vehicle');
    }
    const pool = await this.ridesRepository.findActivePoolDetails(vehicle.id);
    // What each rider still owes from earlier late cancels: collected with this fare (D-018).
    const duesByRide = new Map<string, number>();
    for (const member of pool?.members ?? []) {
      const unpaid = await this.ridesRepository.findUnpaidFees(
        member.rideRequest.passengerId,
      );
      duesByRide.set(
        member.rideRequestId,
        unpaid.reduce((sum, ride) => sum + ride.cancellationFeePaisa, 0),
      );
    }

    return {
      vehicle: {
        name: vehicle.name,
        seatCapacity: vehicle.seatCapacity,
        isOnline: vehicle.isOnline,
        route:
          vehicle.route === null
            ? null
            : { id: vehicle.route.id, name: vehicle.route.name },
        currentZone:
          vehicle.currentZone === null
            ? null
            : { id: vehicle.currentZone.id, name: vehicle.currentZone.name },
      },
      pool:
        pool === null
          ? null
          : {
              id: pool.id,
              status: pool.status,
              route: pool.route.name,
              stops: pool.route.stops.map((stop) => stop.zone.name),
              currentStop: pool.currentStop,
              hasPickedUp: pool.startedAt !== null,
              seatCapacity: pool.seatCapacity,
              seatsTaken: pool.seatsTaken,
              passengers: pool.members
                .filter((member) =>
                  SHOWN_IN_TRIP.includes(member.rideRequest.status),
                )
                .map((member) => ({
                  rideId: member.rideRequestId,
                  name: firstName(member.rideRequest.passenger.name),
                  status: member.rideRequest.status,
                  seats: member.seats,
                  pickup: member.rideRequest.pickupZone.name,
                  dropoff: member.rideRequest.dropoffZone.name,
                  pickupStop: member.pickupStop,
                  dropoffStop: member.dropoffStop,
                  estimatedFarePaisa: member.rideRequest.estimatedFarePaisa,
                  finalFarePaisa: member.rideRequest.finalFarePaisa,
                  duesPaisa: duesByRide.get(member.rideRequestId) ?? 0,
                })),
            },
    };
  }
}
