// The fixed Tesla routes from docs/assumptions.md §3.3. Used by the seed.
// Each route is driven in both directions; the seed stores each direction as its own
// route, so a stop's position always grows in the direction of travel.
import { DISTANCE_KM, ZONES } from './dhaka-zones.js';

export type RouteLine = { stops: string[] }; // zone codes, in order

export const ROUTE_LINES: RouteLine[] = [
  // Airport Road and Gulshan
  { stops: ['UTT', 'BAN', 'MOH', 'GL1', 'GL2', 'BSH'] },
  // Mirpur to Dhanmondi
  { stops: ['UTT', 'M12', 'M11', 'M10', 'MR2', 'MR1', 'FRM', 'DHN'] },
  // Banani to Dhanmondi through Tejgaon
  { stops: ['BAN', 'MOH', 'TEJ', 'FRM', 'DHN'] },
];

/** Both directions of every line, e.g. "UTT-BSH" and "BSH-UTT". */
export function routeDirections(): { code: string; stops: string[] }[] {
  const routes: { code: string; stops: string[] }[] = [];
  for (const line of ROUTE_LINES) {
    const forward = line.stops;
    const backward = [...line.stops].reverse();
    for (const stops of [forward, backward]) {
      routes.push({ code: `${stops[0]}-${stops[stops.length - 1]}`, stops });
    }
  }
  return routes;
}

/** For each stop, the km driven from the route's first stop (hop distances added up). */
export function kmFromStart(stops: string[]): number[] {
  const indexOf = (code: string) =>
    ZONES.findIndex((zone) => zone.code === code);
  const km = [0];
  for (let i = 1; i < stops.length; i++) {
    km.push(km[i - 1] + DISTANCE_KM[indexOf(stops[i - 1])][indexOf(stops[i])]);
  }
  return km;
}
