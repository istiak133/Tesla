import type { ConfigService } from '@nestjs/config';
import { NodeEnv } from '../config/env.validation.js';
import { MatcherService } from './matcher.service.js';

// The timer that runs a round every MATCH_INTERVAL_MS. The e2e tests turn it off (they run
// each round themselves), so its wiring is checked here with fake timers.
describe('MatcherService timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const matcherWith = (env: NodeEnv) => {
    const config = {
      get: (key: string) => (key === 'NODE_ENV' ? env : 2_000),
    } as unknown as ConfigService;
    const matcher = new MatcherService(
      {} as never,
      {} as never,
      {} as never,
      config as never,
    );
    const runOnce = vi.spyOn(matcher, 'runOnce').mockResolvedValue({
      skipped: false,
      seated: 0,
      missed: 0,
      optimal: true,
    });
    return { matcher, runOnce };
  };

  it('runs a round every interval, and stops at shutdown', () => {
    const { matcher, runOnce } = matcherWith(NodeEnv.Production);
    matcher.onModuleInit();
    vi.advanceTimersByTime(2_000 * 3);
    expect(runOnce).toHaveBeenCalledTimes(3);

    matcher.onModuleDestroy();
    vi.advanceTimersByTime(2_000 * 3);
    expect(runOnce).toHaveBeenCalledTimes(3);
  });

  it('does not start in tests', () => {
    const { matcher, runOnce } = matcherWith(NodeEnv.Test);
    matcher.onModuleInit();
    vi.advanceTimersByTime(60_000);
    expect(runOnce).not.toHaveBeenCalled();
  });

  it('shutdown waits for the round in progress', async () => {
    const { matcher, runOnce } = matcherWith(NodeEnv.Production);
    runOnce.mockRestore();
    let finish!: () => void;
    // A round whose work is still running.
    vi.spyOn(
      matcher as unknown as { round: () => Promise<unknown> },
      'round',
    ).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ skipped: false, seated: 0, missed: 0, optimal: true });
        }),
    );
    const round = matcher.runOnce();
    let shutDown = false;
    const shutdown = matcher.beforeApplicationShutdown().then(() => {
      shutDown = true;
    });
    await Promise.resolve();
    expect(shutDown).toBe(false);
    finish();
    await round;
    await shutdown;
    expect(shutDown).toBe(true);
  });
});
