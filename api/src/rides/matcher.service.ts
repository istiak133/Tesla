import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables, NodeEnv } from '../config/env.validation.js';
import { Prisma, RideStatus } from '../generated/prisma/client.js';
import { planAssignment, type MatchPlan } from '../pooling/assignment.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PoolingService } from './pooling.service.js';
import { RideError } from './ride.errors.js';
import { ACTIVE_POOL_STATUSES, RidesRepository } from './rides.repository.js';

/** At most this many waiting requests (the oldest) are matched in one round. */
export const MAX_REQUESTS_PER_ROUND = 50;

export const MATCH_REASON = 'Joined a Tesla on the way automatically';

export type MatchRound = {
  /** True if a round was already running, so this call did nothing. */
  skipped: boolean;
  seated: number;
  /** Planned seats that could not be taken when applied: the ride or the trip changed. */
  missed: number;
  optimal: boolean;
};

/**
 * Batch matching (decision D-023). Every MATCH_INTERVAL_MS it seats every waiting request
 * it can in the running trips, all decided together (pooling/assignment.ts).
 *
 * This is the one place that seats riders automatically. It replaces the four separate
 * triggers there were before: a new request (auto-join), a freed seat (D-017), a driver's
 * accept (D-022) and a driver's cancel (D-021). Two of those, D-021 and D-022, were bugs
 * found later where one trigger had been missing. With one matcher that kind of bug cannot
 * happen: whatever changed, the next round sees every waiting request and every free seat.
 *
 * How a plan is applied keeps every concurrency guarantee unchanged:
 *   - each trip in the plan is applied in its own transaction under that car's lock, so a
 *     transaction still never holds two vehicle locks (no deadlocks);
 *   - each seat goes through PoolingService.joinUnderLock, which checks R1–R4 again on the
 *     locked rows and claims the ride with a compare-and-set;
 *   - each seat is tried inside a savepoint: if the ride was cancelled or taken by a driver
 *     since the plan was made, or the car moved on, only that seat is undone, the others in
 *     the trip still stand, and the ride waits for the next round.
 * So a stale plan can only miss a seat, never give a wrong one.
 *
 * Rounds never overlap in one instance. With several instances two rounds could run at
 * once; that is still correct (the lock and the compare-and-set decide every seat), it only
 * repeats work. Electing one instance per round is the step for that scale.
 */
@Injectable()
export class MatcherService
  implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown
{
  private readonly logger = new Logger(MatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  // The round in progress, so shutdown can wait for it to finish its writes.
  private current: Promise<MatchRound> | null = null;

  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly poolingService: PoolingService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    // Tests run each round themselves (runOnce), so what they check never depends on timing.
    if (this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test) {
      return;
    }
    const interval = this.config.get('MATCH_INTERVAL_MS', { infer: true });
    this.timer = setInterval(() => void this.runOnce(), interval);
    // A pending round must not keep the process alive at shutdown.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // No new round starts after onModuleDestroy; let the one in progress finish before the
  // database pool closes (PrismaService disconnects in the last shutdown step).
  async beforeApplicationShutdown(): Promise<void> {
    await this.current;
  }

  /** One round: plan from a snapshot, then apply it trip by trip. Never throws. */
  async runOnce(): Promise<MatchRound> {
    if (this.running) {
      return { skipped: true, seated: 0, missed: 0, optimal: true };
    }
    this.running = true;
    this.current = this.round();
    try {
      return await this.current;
    } finally {
      this.running = false;
      this.current = null;
    }
  }

  private async round(): Promise<MatchRound> {
    try {
      const plan = await this.plan();
      const applied = await this.apply(plan);
      if (applied.seated > 0) {
        // Seats changed outside any HTTP request, so tell open screens here.
        this.realtime.publish(['requests', 'rides']);
      }
      if (!plan.optimal) {
        this.logger.warn(
          { seated: applied.seated },
          'match round stopped at its step budget; the plan is valid but may not be the best',
        );
      }
      return { skipped: false, ...applied, optimal: plan.optimal };
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : error },
        'match round failed; waiting riders stay for the next round',
      );
      return { skipped: false, seated: 0, missed: 0, optimal: true };
    }
  }

  /** Steps 1–3 on a snapshot of the waiting requests and the open trips. */
  async plan(): Promise<MatchPlan> {
    const trips = await this.ridesRepository.listOpenTrips();
    // Only requests some running trip can carry, so old ones nobody can serve never fill the
    // round's window.
    const requests = await this.ridesRepository.listWaitingServable(
      trips.map((trip) => ({
        routeId: trip.routeId,
        fromStop: trip.currentStop,
        freeSeats: trip.seatCapacity - trip.seatsTaken,
      })),
      MAX_REQUESTS_PER_ROUND,
    );
    return planAssignment(trips, requests, new Date());
  }

  /**
   * Takes the planned seats, one trip per transaction. Public so a test can apply a plan
   * that has gone stale on purpose (a ride cancelled after the plan was made).
   */
  async apply(plan: MatchPlan): Promise<{ seated: number; missed: number }> {
    let seated = 0;
    let missed = 0;
    for (const planned of plan.trips) {
      try {
        // Counted inside, added only once the transaction has committed.
        const outcome = await this.ridesRepository.withVehicleLock(
          planned.vehicleId,
          async (tx) => {
            const done = { seated: 0, missed: 0 };
            let pool = await tx.pool.findFirst({
              where: {
                id: planned.poolId,
                status: { in: ACTIVE_POOL_STATUSES },
              },
            });
            for (const rideId of planned.requestIds) {
              if (pool === null) {
                done.missed++; // the trip ended since the plan was made
                continue;
              }
              await tx.$executeRawUnsafe('SAVEPOINT match_seat');
              try {
                const ride = await tx.rideRequest.findUnique({
                  where: { id: rideId },
                });
                if (ride === null || ride.status !== RideStatus.REQUESTED) {
                  throw new RideError('ALREADY_TAKEN', 'No longer waiting');
                }
                await this.poolingService.joinUnderLock(
                  tx,
                  pool,
                  ride,
                  null,
                  MATCH_REASON,
                );
                await tx.$executeRawUnsafe('RELEASE SAVEPOINT match_seat');
                done.seated++;
                // Seats changed: check the next rider against the trip as it is now.
                pool = await tx.pool.findUniqueOrThrow({
                  where: { id: planned.poolId },
                });
              } catch (error) {
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT match_seat');
                done.missed++;
                if (!(error instanceof RideError)) {
                  this.logger.error(
                    {
                      rideId,
                      error: error instanceof Error ? error.message : error,
                    },
                    'unexpected error while seating a planned rider',
                  );
                }
              }
            }
            return done;
          },
        );
        seated += outcome.seated;
        missed += outcome.missed;
      } catch (error) {
        // Whatever failed for this trip, its riders wait for the next round and the other
        // trips are still applied: one car's trouble must not cost the whole round.
        missed += planned.requestIds.length;
        const expected =
          (error instanceof RideError && error.code === 'BUSY') ||
          isTransactionTimeout(error);
        if (!expected) {
          // The car is busy, or no connection was free in time, is normal; anything else
          // (a dropped connection, a deadlock across instances) is worth a look.
          this.logger.error(
            {
              vehicleId: planned.vehicleId,
              error: error instanceof Error ? error.message : error,
            },
            'could not apply the plan for one trip; its riders wait for the next round',
          );
        }
      }
    }
    return { seated, missed };
  }
}

/**
 * Prisma's "could not start a transaction in time" (P2028) and "timed out fetching a
 * connection" (P2024): the pool was busy. For a background round that is a reason to try
 * again next time, not to stop the whole round.
 */
function isTransactionTimeout(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2024' || error.code === 'P2028')
  );
}
