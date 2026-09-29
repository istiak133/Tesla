// Detour rules from docs/assumptions.md §4.2. Pure functions, no database.
//
// Everyone in a pool starts from the same pickup zone.
// 1. Drop-offs are ordered nearest-first by each passenger's direct distance from pickup
//    (ties: the earlier request first).
// 2. A passenger's in-car distance = the sum of route legs from pickup to their drop-off.
// 3. Detour = in-car distance − direct distance.

export const MAX_DETOUR_KM = 2;

export type Rider = {
  id: string;
  dropoffZoneId: string;
};

// Returns km between two zones (0 for the same zone).
export type DistanceLookup = (fromZoneId: string, toZoneId: string) => number;

/**
 * Detour in km for each rider, in the given list.
 * `riders` must be in request order (oldest first), which breaks ties.
 */
export function detoursKm(
  pickupZoneId: string,
  riders: Rider[],
  distance: DistanceLookup,
): Map<string, number> {
  // Nearest drop-off first. Array.sort is stable, so equal distances keep request order.
  const dropOffOrder = [...riders].sort(
    (a, b) =>
      distance(pickupZoneId, a.dropoffZoneId) -
      distance(pickupZoneId, b.dropoffZoneId),
  );

  const detours = new Map<string, number>();
  let inCarKm = 0;
  let currentZoneId = pickupZoneId;

  for (const rider of dropOffOrder) {
    inCarKm += distance(currentZoneId, rider.dropoffZoneId);
    currentZoneId = rider.dropoffZoneId;

    const directKm = distance(pickupZoneId, rider.dropoffZoneId);
    detours.set(rider.id, inCarKm - directKm);
  }
  return detours;
}

/** True if every rider's detour is within the limit (rule M4). */
export function allDetoursWithinLimit(
  pickupZoneId: string,
  riders: Rider[],
  distance: DistanceLookup,
): boolean {
  const detours = detoursKm(pickupZoneId, riders, distance);
  for (const km of detours.values()) {
    if (km > MAX_DETOUR_KM) {
      return false;
    }
  }
  return true;
}
