// Whether a driver's app is still reaching the API (audit fix: a driver who goes silent
// mid-trip). Pure functions, no database.
//
// There is no GPS, so presence is the next best signal: any driver request, and the open
// live stream's heartbeat (every 25 s, also while the tab is in the background). A phone that
// dies, loses the network or closes the app stops both.

/** Silent this long: the trip gets no new riders, and its riders can cancel without a fee. */
export const DRIVER_SILENT_MS = 2 * 60_000;

/** Silent this long: a passenger already on board may end the ride themselves. */
export const DRIVER_GONE_MS = 15 * 60_000;

/** Presence is written at most this often per driver, so polling does not mean a write each time. */
export const SEEN_WRITE_INTERVAL_MS = 30_000;

/** True if the driver has not been seen for `afterMs` (never seen counts as silent). */
export function isSilent(
  lastSeenAt: Date | null,
  now: Date,
  afterMs: number = DRIVER_SILENT_MS,
): boolean {
  return lastSeenAt === null || now.getTime() - lastSeenAt.getTime() >= afterMs;
}
