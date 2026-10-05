// Batch matching (decision D-023). Pure functions, no database.
//
// Every few seconds the matcher takes every waiting request and every running trip with a
// free seat, and decides all the seats at once instead of one request at a time. The method
// follows Alonso-Mora et al., "On-demand high-capacity ride-sharing via dynamic trip-vehicle
// assignment" (PNAS 2017), reduced to what a fixed one-way route needs:
//
//   1. RV  : which running trip could take which request on its own (R1–R4, `joinProblem`).
//   2. RTV : for each trip, every group of requests it could take together, built one size
//            at a time. A group is only tried if every smaller group inside it was possible.
//   3. Pick: at most one group per trip and each request in at most one group, with the best
//            score. Solved exactly by a branch-and-bound search.
//
// On a one-way route the order of pickups and drop-offs is fixed by the route, so the costly
// "best visiting order" step of the paper does not exist here: a group's cost is a sum.
//
// The result is a plan, not a write. Every seat in it is still taken under the car's lock
// with R1–R4 checked again (MatcherService), so the concurrency guarantees do not change.

import { RideStatus } from '../generated/prisma/client.js';
import { AGING_MINUTES, approachKm } from './matching.js';
import { joinProblem, tripStops, type Stop } from './route-plan.js';

/** A running trip with at least one free seat, as the matcher sees it. */
export type OpenTrip = {
  vehicleId: string;
  poolId: string;
  createdAt: Date;
  status: RideStatus;
  currentStop: number;
  seatCapacity: number;
  seatsTaken: number;
  stops: Stop[];
};

/** A request still waiting for a seat. */
export type WaitingRequest = {
  id: string;
  pickupZoneId: string;
  dropoffZoneId: string;
  distanceKm: number;
  seats: number;
  createdAt: Date;
};

/** One trip's share of the plan: the requests it should seat, in boarding order. */
export type PlannedTrip = {
  vehicleId: string;
  poolId: string;
  requestIds: string[];
};

export type MatchPlan = {
  trips: PlannedTrip[];
  seatsServed: number;
  /** False if the search stopped at its node budget: the plan is valid but may not be best. */
  optimal: boolean;
};

/**
 * How good a choice is, compared field by field, first field first (all are maximised):
 *   agedSeats  seats of requests waiting AGING_MINUTES or more: nobody waits for ever;
 *   seats      seats filled: the most people moved;
 *   minusKm    minus the km cars drive to reach the pickups: shorter waits;
 *   waitedSec  seconds the seated riders had waited: the older request wins a tie.
 */
export type Score = [
  agedSeats: number,
  seats: number,
  minusKm: number,
  waitedSec: number,
];

const ZERO: Score = [0, 0, 0, 0];

/** The search gives up looking for something better after this many steps. */
export const DEFAULT_MAX_NODES = 200_000;

/** True if `a` is strictly better than `b`. */
export function better(a: Score, b: Score): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return false;
}

function add(a: Score, b: Score): Score {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
}

/** The biggest value of each field, taken separately. Used as an optimistic bound. */
function fieldMax(a: Score, b: Score): Score {
  return [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

/** True if this running trip could take this request on its own right now (R1–R4). */
export function fits(trip: OpenTrip, request: WaitingRequest): boolean {
  return joinProblem(trip, trip.stops, request) === null;
}

/** True if any running trip could take this request: then it is the matcher's to place. */
export function fitsAnOpenTrip(
  trips: OpenTrip[],
  request: WaitingRequest,
): boolean {
  return trips.some((trip) => fits(trip, request));
}

/** A group of requests one trip could take together, with its score. */
type Candidate = {
  members: WaitingRequest[];
  key: string;
  score: Score;
};

function scoreOf(trip: OpenTrip, members: WaitingRequest[], now: Date): Score {
  const agingMs = AGING_MINUTES * 60_000;
  let score: Score = ZERO;
  for (const request of members) {
    const { pickupStop } = tripStops(trip.stops, request)!;
    const km = approachKm(trip.stops, trip.currentStop, pickupStop) ?? 0;
    const waitedMs = Math.max(0, now.getTime() - request.createdAt.getTime());
    score = add(score, [
      waitedMs >= agingMs ? request.seats : 0,
      request.seats,
      -km,
      Math.floor(waitedMs / 1000),
    ]);
  }
  return score;
}

function seatsOf(members: WaitingRequest[]): number {
  return members.reduce((sum, member) => sum + member.seats, 0);
}

/**
 * Whether a trip could take this whole group at once. Every member already fits on its own
 * (step 1), and the route and the car's position do not depend on who else rides, so on
 * today's model the group fits when its seats add up to no more than the free seats.
 * With seats counted per stretch of the route (a planned improvement), this is the one
 * place that would change.
 */
function groupFits(trip: OpenTrip, members: WaitingRequest[]): boolean {
  return seatsOf(members) <= trip.seatCapacity - trip.seatsTaken;
}

/**
 * Step 2 (RTV): every group of requests this trip could take together, best first.
 *
 * Built one size at a time. A group of k is only checked if every group of k − 1 inside it
 * was possible (the pruning rule): if two requests cannot ride together, no larger group
 * holding both can either, so `groupFits` is never even called for it.
 *
 * On today's model the rule never removes more than the seat check would, because a group's
 * seats are never fewer than any smaller group's inside it. It is kept because it is the
 * paper's rule and the reason the method scales: once fitting depends on who overlaps whom
 * (seats per stretch), most large groups are dropped here without being checked.
 */
export function tripCandidates(
  trip: OpenTrip,
  requests: WaitingRequest[],
  now: Date,
): Candidate[] {
  const free = trip.seatCapacity - trip.seatsTaken;
  // Step 1 (RV): who this trip could take on its own.
  const singles = requests.filter((request) => fits(trip, request));

  const index = new Map(singles.map((request, i) => [request.id, i]));
  const keyOf = (members: WaitingRequest[]) =>
    members.map((member) => member.id).join(',');

  const all: WaitingRequest[][] = [];
  let level: WaitingRequest[][] = singles.map((request) => [request]);
  // Every request takes at least one seat, so no group is larger than the free seats.
  for (let size = 1; level.length > 0 && size <= free; size++) {
    all.push(...level);
    const known = new Set(level.map(keyOf));
    const next: WaitingRequest[][] = [];
    for (const group of level) {
      const last = index.get(group[group.length - 1].id)!;
      // Only add requests after the group's last one, so each group is built once.
      for (let i = last + 1; i < singles.length; i++) {
        const grown = [...group, singles[i]];
        // The pruning rule first: it is a few set lookups.
        const everySmallerFits = grown.every((_, drop) =>
          known.has(keyOf(grown.filter((__, j) => j !== drop))),
        );
        if (everySmallerFits && groupFits(trip, grown)) {
          next.push(grown);
        }
      }
    }
    level = next;
  }

  return all
    .map((members) => ({
      members,
      key: keyOf(members),
      score: scoreOf(trip, members, now),
    }))
    .sort((a, b) =>
      better(a.score, b.score)
        ? -1
        : better(b.score, a.score)
          ? 1
          : a.key.localeCompare(b.key),
    );
}

/**
 * Steps 1–3: the best way to seat waiting requests in running trips.
 *
 * Step 3 chooses at most one candidate group per trip, with no request in two groups,
 * maximising the score. It is an exact branch-and-bound search: trips are visited in a fixed
 * order (oldest trip first, so it wins a tie), and a branch is dropped as soon as even the
 * best possible rest of it could not beat the plan already found. Requests no trip can take
 * are left out: they stay waiting and are offered to idle drivers (D-020).
 */
export function planAssignment(
  openTrips: OpenTrip[],
  requests: WaitingRequest[],
  now: Date,
  maxNodes: number = DEFAULT_MAX_NODES,
): MatchPlan {
  const trips = [...openTrips]
    .filter((trip) => trip.seatsTaken < trip.seatCapacity)
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.vehicleId.localeCompare(b.vehicleId),
    );
  const candidates = trips.map((trip) => tripCandidates(trip, requests, now));

  // The best a trip could add, field by field, ignoring the other trips. Summed from the
  // end, it bounds what the trips still to be decided could add: an optimistic estimate.
  const bestOf = candidates.map((list) =>
    list.reduce((best, candidate) => fieldMax(best, candidate.score), ZERO),
  );
  const restBound: Score[] = Array.from(
    { length: trips.length + 1 },
    () => ZERO,
  );
  for (let t = trips.length - 1; t >= 0; t--) {
    restBound[t] = add(restBound[t + 1], bestOf[t]);
  }

  let bestScore: Score = ZERO;
  let bestChoice: (Candidate | null)[] = trips.map(() => null);
  const choice: (Candidate | null)[] = trips.map(() => null);
  const used = new Set<string>();
  let nodes = 0;
  let complete = true;

  const search = (t: number, score: Score): void => {
    if (nodes++ >= maxNodes) {
      complete = false;
      return;
    }
    if (t === trips.length) {
      if (better(score, bestScore)) {
        bestScore = score;
        bestChoice = [...choice];
      }
      return;
    }
    // Even the best possible rest cannot win: drop this branch.
    if (!better(add(score, restBound[t]), bestScore)) {
      return;
    }
    for (const candidate of candidates[t]) {
      if (candidate.members.some((member) => used.has(member.id))) {
        continue;
      }
      for (const member of candidate.members) used.add(member.id);
      choice[t] = candidate;
      search(t + 1, add(score, candidate.score));
      choice[t] = null;
      for (const member of candidate.members) used.delete(member.id);
      if (!complete) {
        return;
      }
    }
    // This trip takes no one this time.
    search(t + 1, score);
  };
  search(0, ZERO);

  const planned: PlannedTrip[] = [];
  let seatsServed = 0;
  trips.forEach((trip, t) => {
    const picked = bestChoice[t];
    if (picked === null) {
      return;
    }
    const boarding = [...picked.members].sort(
      (a, b) =>
        tripStops(trip.stops, a)!.pickupStop -
          tripStops(trip.stops, b)!.pickupStop ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
    planned.push({
      vehicleId: trip.vehicleId,
      poolId: trip.poolId,
      requestIds: boarding.map((request) => request.id),
    });
    seatsServed += seatsOf(picked.members);
  });

  return { trips: planned, seatsServed, optimal: complete };
}
