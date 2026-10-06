// The late-cancel fee (docs/assumptions.md §6.1, decision D-018). Pure functions, no database.
//
// Cancelling is free while the car is still stops away. Once the car is coming straight to
// the passenger's stop (the driver has left for it) or is standing there, a cancel or a
// no-show costs Tk 20, the same as the driver's pickup pay, and the driver gets all of it.
// A short grace period after joining protects someone who was just seated automatically
// in a car that happened to be near.

/** Tk 20: what a late cancel or a no-show costs the passenger, paid to the driver. */
export const CANCELLATION_FEE_PAISA = 2000;

/** No fee within this long of getting the seat. */
export const CANCELLATION_GRACE_MS = 2 * 60_000;

export type CancelMoment = {
  carStop: number; // the stop the car is at or driving to (pool.current_stop)
  pickupStop: number; // the passenger's pickup stop on the route
  joinedAt: Date; // when the passenger got the seat
  now: Date;
};

/** The fee for leaving the trip at this moment: 0 or Tk 20. */
export function cancellationFeePaisa(moment: CancelMoment): number {
  const carIsComingOrHere = moment.carStop === moment.pickupStop;
  const pastGrace =
    moment.now.getTime() - moment.joinedAt.getTime() >= CANCELLATION_GRACE_MS;
  return carIsComingOrHere && pastGrace ? CANCELLATION_FEE_PAISA : 0;
}

/**
 * How long the car waits at the stop before the driver may mark a no-show: from when it
 * arrived, or from when the passenger got the seat if that was later. Without it a driver
 * could tap "arrive" stops away and then "no-show" at once, and earn the fee.
 */
export const NO_SHOW_WAIT_MS = 3 * 60_000;

/** The earliest moment this passenger may be marked a no-show. */
export function noShowAllowedFrom(arrivedAt: Date, joinedAt: Date): Date {
  const waitFrom = Math.max(arrivedAt.getTime(), joinedAt.getTime());
  return new Date(waitFrom + NO_SHOW_WAIT_MS);
}
