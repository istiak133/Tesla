// Business errors thrown by the ride and driver services.
// The services never mention HTTP. RideErrorFilter (ride-error.filter.ts)
// turns each code into a status code and a JSON body.

export type RideErrorCode =
  | 'NOT_FOUND' // no such ride
  | 'NOT_YOUR_RIDE' // the ride belongs to someone else
  | 'INVALID_ZONE' // unknown zone id
  | 'NO_ROUTE' // no Tesla route goes from the pickup to the drop-off
  | 'ACTIVE_RIDE_EXISTS' // passenger already has an active ride
  | 'INVALID_TRANSITION' // e.g. cancelling after pickup, leaving a stop with someone still waiting
  | 'ALREADY_TAKEN' // request is no longer waiting (someone else took it, or it was cancelled)
  | 'NO_VEHICLE' // driver account without a vehicle
  | 'DRIVER_OFFLINE' // driver must be online to accept
  | 'ROUTE_REQUIRED' // driver must choose a route first
  | 'HAS_ACTIVE_POOL' // e.g. going offline during a trip
  | 'NO_ACTIVE_POOL' // driver action without a current trip
  | 'POOL_NOT_OPEN' // the trip has already ended
  | 'NOT_COMPATIBLE' // not on the route in this direction, or the car has passed the pickup
  | 'SEATS_UNAVAILABLE' // not enough free seats
  | 'TOO_EARLY' // e.g. a no-show before the car has waited at the stop
  | 'FEE_CHANGED' // the cancel fee is now higher than the one the passenger saw
  | 'BUSY'; // the vehicle was locked by another action for too long; retry

export class RideError extends Error {
  constructor(
    readonly code: RideErrorCode,
    message: string,
  ) {
    super(message);
  }
}
