// Business errors thrown by the ride and driver services.
// The services never mention HTTP. RideErrorFilter (ride-error.filter.ts)
// turns each code into a status code and a JSON body.

export type RideErrorCode =
  | 'NOT_FOUND' // no such ride
  | 'NOT_YOUR_RIDE' // the ride belongs to someone else
  | 'INVALID_ZONE' // unknown zone id
  | 'ACTIVE_RIDE_EXISTS' // passenger already has an active ride
  | 'INVALID_TRANSITION' // e.g. cancelling a started ride, starting before arriving
  | 'ALREADY_TAKEN' // request is no longer waiting (someone else took it, or it was cancelled)
  | 'NO_VEHICLE' // driver account without a vehicle
  | 'DRIVER_OFFLINE' // driver must be online to accept
  | 'HAS_ACTIVE_POOL' // e.g. going offline during a trip
  | 'NO_ACTIVE_POOL' // driver action without a current trip
  | 'POOL_NOT_OPEN' // the pool has already moved past MATCHED
  | 'NOT_COMPATIBLE' // different pickup zone or detour too long
  | 'SEATS_UNAVAILABLE' // not enough free seats
  | 'BUSY'; // the vehicle was locked by another action for too long; retry

export class RideError extends Error {
  constructor(
    readonly code: RideErrorCode,
    message: string,
  ) {
    super(message);
  }
}
