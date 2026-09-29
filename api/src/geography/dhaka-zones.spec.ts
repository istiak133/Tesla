import { DISTANCE_KM, ZONES } from './dhaka-zones.js';

describe('Dhaka distance table', () => {
  const n = ZONES.length;

  it('has one row and one column per zone', () => {
    expect(DISTANCE_KM).toHaveLength(n);
    for (const row of DISTANCE_KM) {
      expect(row).toHaveLength(n);
    }
  });

  it('is zero only on the diagonal and positive everywhere else', () => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          expect(DISTANCE_KM[i][j]).toBe(0);
        } else {
          expect(DISTANCE_KM[i][j]).toBeGreaterThan(0);
        }
      }
    }
  });

  it('is symmetric, so direction never changes the price', () => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        expect(DISTANCE_KM[i][j]).toBe(DISTANCE_KM[j][i]);
      }
    }
  });

  it('satisfies the triangle inequality, so a route is never shorter than direct', () => {
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        for (let c = 0; c < n; c++) {
          expect(DISTANCE_KM[a][c]).toBeLessThanOrEqual(
            DISTANCE_KM[a][b] + DISTANCE_KM[b][c],
          );
        }
      }
    }
  });
});
