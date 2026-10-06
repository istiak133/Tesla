import { kmFromStart } from '../geography/dhaka-routes.js';
import { RideStatus } from '../generated/prisma/client.js';
import {
  better,
  fits,
  fitsAnOpenTrip,
  planAssignment,
  tripCandidates,
  type MatchPlan,
  type OpenTrip,
  type Score,
  type WaitingRequest,
} from './assignment.js';
import { AGING_MINUTES, approachKm } from './matching.js';
import { tripStops, type Stop } from './route-plan.js';

// Jashim's route with zone codes as ids: Uttara 0 km, Banani 12, Mohakhali 15,
// Gulshan 1 18, Gulshan 2 20, Bashundhara 24.
const CODES = ['UTT', 'BAN', 'MOH', 'GL1', 'GL2', 'BSH'];
const KM = kmFromStart(CODES);
const UTT_BSH: Stop[] = CODES.map((code, position) => ({
  position,
  zoneId: code,
  name: code,
  kmFromStart: KM[position],
}));

// Direct km from the distance table, for the trips this route sells.
const DIRECT_KM: Record<string, number> = {
  'UTT-BAN': 12,
  'UTT-MOH': 13,
  'UTT-GL1': 14,
  'BAN-MOH': 3,
  'BAN-GL1': 4,
  'MOH-GL1': 3,
  'MOH-GL2': 4,
  'MOH-BSH': 7,
  'GL1-GL2': 2,
  'GL1-BSH': 5,
  'GL2-BSH': 4,
};

const NOW = new Date(Date.UTC(2026, 9, 5, 9, 0));
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

function car(
  vehicleId: string,
  at: string,
  options: { seatsTaken?: number; ageMinutes?: number } = {},
): OpenTrip {
  return {
    vehicleId,
    poolId: `pool-${vehicleId}`,
    routeId: 'route-utt-bsh',
    createdAt: minutesAgo(options.ageMinutes ?? 10),
    status: RideStatus.MATCHED,
    currentStop: CODES.indexOf(at),
    seatCapacity: 3,
    seatsTaken: options.seatsTaken ?? 0,
    stops: UTT_BSH,
  };
}

function rider(
  id: string,
  from: string,
  to: string,
  seats: number,
  ageMinutes = 0,
): WaitingRequest {
  return {
    id,
    pickupZoneId: from,
    dropoffZoneId: to,
    distanceKm: DIRECT_KM[`${from}-${to}`],
    seats,
    createdAt: minutesAgo(ageMinutes),
  };
}

const seatsOfPlan = (plan: MatchPlan) =>
  Object.fromEntries(plan.trips.map((t) => [t.vehicleId, t.requestIds]));

describe('the lecture example: two cars, four riders', () => {
  // V1 at Banani, V2 at Uttara, both with 3 free seats. R4 can only ride with V2:
  // V1 has already passed Uttara.
  const trips = [car('V1', 'BAN'), car('V2', 'UTT')];
  const requests = [
    rider('R1', 'BAN', 'MOH', 1),
    rider('R2', 'BAN', 'GL1', 2),
    rider('R3', 'MOH', 'BSH', 1),
    rider('R4', 'UTT', 'BAN', 3),
  ];

  it('keeps V2 for R4, who has no other car, and moves 6 people', () => {
    const plan = planAssignment(trips, requests, NOW);
    expect(seatsOfPlan(plan)).toEqual({ V1: ['R1', 'R2'], V2: ['R4'] });
    expect(plan.seatsServed).toBe(6);
    expect(plan.optimal).toBe(true);
  });

  it('beats placing riders one at a time, which moves only 4', () => {
    // The old rule: as each request arrives, the nearest car that fits takes it.
    const free = new Map(trips.map((t) => [t.vehicleId, t.seatCapacity]));
    let greedySeats = 0;
    for (const request of requests) {
      const nearest = trips
        .filter((t) =>
          fits({ ...t, seatsTaken: 3 - free.get(t.vehicleId)! }, request),
        )
        .map((t) => ({
          t,
          km: approachKm(
            t.stops,
            t.currentStop,
            tripStops(t.stops, request)!.pickupStop,
          )!,
        }))
        .sort((a, b) => a.km - b.km)[0];
      if (nearest) {
        free.set(
          nearest.t.vehicleId,
          free.get(nearest.t.vehicleId)! - request.seats,
        );
        greedySeats += request.seats;
      }
    }
    expect(greedySeats).toBe(4); // R1, R2 in V1; R3 in V2; R4 left waiting
    expect(planAssignment(trips, requests, NOW).seatsServed).toBe(6);
  });
});

describe('the earlier matching rules still hold (D-014)', () => {
  it('gives a lone request to the car nearest its pickup', () => {
    const plan = planAssignment(
      [
        car('far', 'UTT', { ageMinutes: 30 }),
        car('near', 'BAN', { ageMinutes: 1 }),
      ],
      [rider('R', 'MOH', 'GL1', 1)],
      NOW,
    );
    expect(seatsOfPlan(plan)).toEqual({ near: ['R'] });
  });

  it('breaks an exact tie by the older trip', () => {
    const plan = planAssignment(
      [
        car('newer', 'BAN', { ageMinutes: 1 }),
        car('older', 'BAN', { ageMinutes: 9 }),
      ],
      [rider('R', 'MOH', 'GL1', 1)],
      NOW,
    );
    expect(seatsOfPlan(plan)).toEqual({ older: ['R'] });
  });

  it('never gives a request to a car that has passed its pickup', () => {
    const plan = planAssignment(
      [car('passed', 'GL1')],
      [rider('R', 'MOH', 'BSH', 1)],
      NOW,
    );
    expect(plan.trips).toEqual([]);
  });

  it(`seats a rider waiting ${AGING_MINUTES}+ minutes before a bigger, newer one`, () => {
    // Two free seats: the new 2-seat request alone would move more people, but the
    // rider who has waited long enough goes first, so nobody waits for ever.
    const plan = planAssignment(
      [car('V', 'BAN', { seatsTaken: 1 })],
      [
        rider('new-pair', 'BAN', 'GL1', 2, 0),
        rider('old-single', 'BAN', 'MOH', 1, AGING_MINUTES),
      ],
      NOW,
    );
    expect(seatsOfPlan(plan)).toEqual({ V: ['old-single'] });
  });

  it('leaves a request no running trip can take for the idle drivers', () => {
    const trips = [car('V', 'GL1')];
    expect(fitsAnOpenTrip(trips, rider('behind', 'BAN', 'MOH', 1))).toBe(false);
    expect(fitsAnOpenTrip(trips, rider('ahead', 'GL1', 'BSH', 1))).toBe(true);
  });
});

describe('building the groups (RTV)', () => {
  it('builds each group once and never more seats than are free', () => {
    const trip = car('V', 'BAN', { seatsTaken: 1 }); // 2 free
    const groups = tripCandidates(
      trip,
      [
        rider('A', 'BAN', 'MOH', 1),
        rider('B', 'BAN', 'GL1', 1),
        rider('C', 'MOH', 'BSH', 1),
        rider('D', 'MOH', 'GL2', 2),
      ],
      NOW,
    );
    const keys = groups.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const group of groups) {
      expect(
        group.members.reduce((s, m) => s + m.seats, 0),
      ).toBeLessThanOrEqual(2);
    }
    // 4 on their own, plus the 1-seat pairs A+B, A+C, B+C. D (2 seats) rides alone.
    expect(keys.sort()).toEqual(['A', 'A,B', 'A,C', 'B', 'B,C', 'C', 'D']);
  });

  it('puts the boarding order in route order', () => {
    const plan = planAssignment(
      [car('V', 'UTT')],
      [
        rider('later-stop', 'MOH', 'GL1', 1),
        rider('first-stop', 'UTT', 'BAN', 1),
      ],
      NOW,
    );
    expect(plan.trips[0].requestIds).toEqual(['first-stop', 'later-stop']);
  });

  it('returns an empty plan when there is nothing to match', () => {
    expect(
      planAssignment([], [rider('R', 'BAN', 'MOH', 1)], NOW).trips,
    ).toEqual([]);
    expect(planAssignment([car('V', 'BAN')], [], NOW).trips).toEqual([]);
    expect(
      planAssignment(
        [car('V', 'BAN', { seatsTaken: 3 })],
        [rider('R', 'BAN', 'MOH', 1)],
        NOW,
      ).trips,
    ).toEqual([]);
  });
});

// ---------- an independent check that the search is exact ----------

/** The score of a finished plan, computed here without using the module's own scoring. */
function scorePlan(
  trips: OpenTrip[],
  requests: WaitingRequest[],
  assignment: Map<string, string>,
): Score {
  const agingMs = AGING_MINUTES * 60_000;
  const score: Score = [0, 0, 0, 0];
  for (const [requestId, vehicleId] of assignment) {
    const request = requests.find((r) => r.id === requestId)!;
    const trip = trips.find((t) => t.vehicleId === vehicleId)!;
    const waited = NOW.getTime() - request.createdAt.getTime();
    score[0] += waited >= agingMs ? request.seats : 0;
    score[1] += request.seats;
    score[2] -= approachKm(
      trip.stops,
      trip.currentStop,
      tripStops(trip.stops, request)!.pickupStop,
    )!;
    score[3] += Math.floor(waited / 1000);
  }
  return score;
}

/** Tries every way of giving each request to one car or none, and keeps the best. */
function bruteForceBest(trips: OpenTrip[], requests: WaitingRequest[]): Score {
  let best: Score = [0, 0, 0, 0];
  const assignment = new Map<string, string>();
  const used = new Map(trips.map((t) => [t.vehicleId, 0]));
  const visit = (i: number) => {
    if (i === requests.length) {
      const score = scorePlan(trips, requests, assignment);
      if (better(score, best)) best = score;
      return;
    }
    visit(i + 1); // this request waits
    for (const trip of trips) {
      const request = requests[i];
      const free =
        trip.seatCapacity - trip.seatsTaken - used.get(trip.vehicleId)!;
      if (request.seats <= free && fits(trip, request)) {
        assignment.set(request.id, trip.vehicleId);
        used.set(trip.vehicleId, used.get(trip.vehicleId)! + request.seats);
        visit(i + 1);
        used.set(trip.vehicleId, used.get(trip.vehicleId)! - request.seats);
        assignment.delete(request.id);
      }
    }
  };
  visit(0);
  return best;
}

/** A small seeded random number generator, so a failure can be replayed. */
function seeded(seed: number) {
  let state = seed;
  return (n: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % n;
  };
}

describe('the search finds the best plan, checked against brute force', () => {
  const PAIRS = Object.keys(DIRECT_KM);

  it('on 400 random cases, never breaks a rule and always matches the best score', () => {
    const random = seeded(2026);
    for (let round = 0; round < 400; round++) {
      const trips = Array.from({ length: 1 + random(3) }, (_, v) =>
        car(`V${v}`, CODES[random(4)], {
          seatsTaken: random(3),
          ageMinutes: random(20),
        }),
      );
      const requests = Array.from({ length: random(7) }, (_, r) => {
        const [from, to] = PAIRS[random(PAIRS.length)].split('-');
        return rider(`R${r}`, from, to, 1 + random(3), random(9));
      });

      const plan = planAssignment(trips, requests, NOW);

      // Rules: every request at most once, never more seats than are free, every seat valid.
      const assignment = new Map<string, string>();
      for (const planned of plan.trips) {
        const trip = trips.find((t) => t.vehicleId === planned.vehicleId)!;
        let seats = 0;
        for (const id of planned.requestIds) {
          expect(assignment.has(id)).toBe(false);
          assignment.set(id, planned.vehicleId);
          const request = requests.find((r) => r.id === id)!;
          expect(fits(trip, request)).toBe(true);
          seats += request.seats;
        }
        expect(seats).toBeLessThanOrEqual(trip.seatCapacity - trip.seatsTaken);
      }

      // Exact: the same score as trying every possibility.
      expect(plan.optimal).toBe(true);
      expect(scorePlan(trips, requests, assignment)).toEqual(
        bruteForceBest(trips, requests),
      );
    }
  });

  it('stops at its step budget with a valid plan, marked as not proven best', () => {
    const trips = [car('V1', 'UTT'), car('V2', 'UTT'), car('V3', 'UTT')];
    const requests = Array.from({ length: 12 }, (_, r) =>
      rider(`R${r}`, 'UTT', 'BAN', 1, r),
    );
    const plan = planAssignment(trips, requests, NOW, 50);
    expect(plan.optimal).toBe(false);
    const seen = plan.trips.flatMap((t) => t.requestIds);
    expect(new Set(seen).size).toBe(seen.length);
    for (const planned of plan.trips) {
      expect(planned.requestIds.length).toBeLessThanOrEqual(3);
    }
    // Not empty: the search goes deep first, so a full plan is found within a few steps.
    expect(plan.seatsServed).toBeGreaterThan(0);
  });
});
