import {
  CANCELLATION_FEE_PAISA,
  CANCELLATION_GRACE_MS,
  cancellationFeePaisa,
} from './cancellation.js';

describe('late-cancel fee (D-018)', () => {
  const now = new Date(Date.UTC(2026, 8, 30, 8, 0));
  const joined = (msAgo: number) => new Date(now.getTime() - msAgo);
  const tenMinutes = 10 * 60_000;

  it('is free while the car is still stops away', () => {
    // Nusrat waits at Mohakhali (stop 2); the car is at or driving to Banani (stop 1).
    expect(
      cancellationFeePaisa({
        carStop: 1,
        pickupStop: 2,
        joinedAt: joined(tenMinutes),
        now,
      }),
    ).toBe(0);
  });

  it('costs Tk 20 once the car is driving to her stop or standing at it', () => {
    expect(
      cancellationFeePaisa({
        carStop: 2,
        pickupStop: 2,
        joinedAt: joined(tenMinutes),
        now,
      }),
    ).toBe(CANCELLATION_FEE_PAISA);
    expect(CANCELLATION_FEE_PAISA).toBe(2000);
  });

  it('is free during the grace period after getting the seat', () => {
    expect(
      cancellationFeePaisa({
        carStop: 2,
        pickupStop: 2,
        joinedAt: joined(CANCELLATION_GRACE_MS - 1),
        now,
      }),
    ).toBe(0);
    expect(
      cancellationFeePaisa({
        carStop: 2,
        pickupStop: 2,
        joinedAt: joined(CANCELLATION_GRACE_MS),
        now,
      }),
    ).toBe(CANCELLATION_FEE_PAISA);
  });
});
