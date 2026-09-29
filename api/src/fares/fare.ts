// Fare rules from docs/assumptions.md §7. All money is in integer paisa (1 taka = 100 paisa).
//
//   subtotal      = (baseFare + distanceKm × perKmRate) × seats
//   poolDiscount  = 20% of subtotal, only if the pool has 2+ passengers when the trip starts
//   passengerFare = subtotal − poolDiscount

export const BASE_FARE_PAISA = 3000; // ৳30
export const PER_KM_PAISA = 1500; // ৳15 per km
export const POOL_DISCOUNT_PERCENT = 20;

/** Fare without any pool discount. Also the estimate shown when a ride is requested. */
export function soloFarePaisa(distanceKm: number, seats: number): number {
  const perSeat = BASE_FARE_PAISA + distanceKm * PER_KM_PAISA;
  return perSeat * seats;
}

/**
 * The final fare, locked when the trip starts.
 * The discount counts passengers, not seats: one passenger booking two seats alone gets none.
 */
export function finalFarePaisa(
  distanceKm: number,
  seats: number,
  passengersInPool: number,
): number {
  const subtotal = soloFarePaisa(distanceKm, seats);
  if (passengersInPool < 2) {
    return subtotal;
  }
  // Integer maths only. Every subtotal is a multiple of 500 paisa,
  // so 20% of it is a whole number of taka.
  const discount = (subtotal * POOL_DISCOUNT_PERCENT) / 100;
  return subtotal - discount;
}
