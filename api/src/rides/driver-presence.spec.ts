import {
  DRIVER_GONE_MS,
  DRIVER_SILENT_MS,
  isSilent,
} from './driver-presence.js';

describe('isSilent', () => {
  const now = new Date('2026-10-06T10:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('a driver seen a moment ago is not silent', () => {
    expect(isSilent(ago(5_000), now)).toBe(false);
  });

  it('is silent from exactly the limit on', () => {
    expect(isSilent(ago(DRIVER_SILENT_MS - 1), now)).toBe(false);
    expect(isSilent(ago(DRIVER_SILENT_MS), now)).toBe(true);
  });

  it('never seen counts as silent', () => {
    expect(isSilent(null, now)).toBe(true);
  });

  it('takes a longer limit for "gone"', () => {
    expect(isSilent(ago(DRIVER_SILENT_MS), now, DRIVER_GONE_MS)).toBe(false);
    expect(isSilent(ago(DRIVER_GONE_MS), now, DRIVER_GONE_MS)).toBe(true);
  });
});
