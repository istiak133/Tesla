// The fixed Tesla routes from docs/assumptions.md §3.3. Used by the seed.
// Each route is driven in both directions; the seed stores each direction as its own
// route, so a stop's position always grows in the direction of travel.

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
