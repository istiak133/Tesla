import { finalFarePaisa, soloFarePaisa } from './fare.js';

// Hand-checkable examples from docs/assumptions.md (the evaluator can redo them on paper).
describe('fares', () => {
  it('Nusrat, Banani → Mohakhali (3 km), 1 seat: estimate ৳75', () => {
    // (30 + 3 × 15) × 1 = 75 taka
    expect(soloFarePaisa(3, 1)).toBe(7500);
  });

  it("Nusrat's pooled fare with Rafiq is ৳60", () => {
    // 75 − 20% = 60 taka
    expect(finalFarePaisa(3, 1, true)).toBe(6000);
  });

  it('Rafiq, Banani → Gulshan 1 (4 km), pooled fare is ৳72', () => {
    // (30 + 4 × 15) = 90 → 90 − 20% = 72 taka
    expect(finalFarePaisa(4, 1, true)).toBe(7200);
  });

  it('a passenger riding alone pays the estimate, never more', () => {
    expect(finalFarePaisa(3, 1, false)).toBe(soloFarePaisa(3, 1));
  });

  it('two seats cost twice as much', () => {
    // (30 + 3 × 15) × 2 = 150 taka
    expect(soloFarePaisa(3, 2)).toBe(15000);
  });

  it('two seats booked by one passenger alone get no discount', () => {
    // One passenger with two seats is still riding alone.
    expect(finalFarePaisa(3, 2, false)).toBe(15000);
  });

  it('always produces whole taka', () => {
    for (let km = 1; km <= 20; km++) {
      for (let seats = 1; seats <= 3; seats++) {
        expect(finalFarePaisa(km, seats, true) % 100).toBe(0);
      }
    }
  });
});
