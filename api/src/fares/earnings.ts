// Who gets what from a finished trip (docs/assumptions.md §7.2). Pure functions, no database.
//
//   collected  = every passenger's final fare (paid in cash to the driver)
//   driver     = ৳10 per km the car drove with at least one passenger on board
//              + ৳20 per passenger picked up
//   platform   = collected − driver (the fee the driver owes the platform)
//
// The driver is paid for the work, not from the fares, so a sharing discount never
// comes out of the driver's pocket. It is paid for by the extra passengers in the car.

import { routeKm, type Stop } from '../pooling/route-plan.js';

export const DRIVER_PER_KM_PAISA = 1000; // ৳10
export const DRIVER_PER_PICKUP_PAISA = 2000; // ৳20

export type CarriedRider = {
  pickupStop: number;
  dropoffStop: number;
  farePaisa: number;
};

export type TripEarnings = {
  collectedPaisa: number;
  driverPaisa: number;
  platformPaisa: number;
};

/** Km the car drove with at least one passenger on board (each hop counted once). */
export function carriedKm(stops: Stop[], riders: CarriedRider[]): number {
  let km = 0;
  for (let hop = 0; hop < stops.length - 1; hop++) {
    const someoneOnBoard = riders.some(
      (rider) => rider.pickupStop <= hop && hop < rider.dropoffStop,
    );
    if (someoneOnBoard) {
      km += routeKm(stops, hop, hop + 1);
    }
  }
  return km;
}

/** The split of a finished trip between the driver and the platform. */
export function tripEarnings(
  stops: Stop[],
  riders: CarriedRider[],
): TripEarnings {
  let collectedPaisa = 0;
  for (const rider of riders) {
    collectedPaisa += rider.farePaisa;
  }
  const driverPaisa =
    carriedKm(stops, riders) * DRIVER_PER_KM_PAISA +
    riders.length * DRIVER_PER_PICKUP_PAISA;
  return {
    collectedPaisa,
    driverPaisa,
    platformPaisa: collectedPaisa - driverPaisa,
  };
}
