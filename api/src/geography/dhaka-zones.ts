// The 14 zones and the road-distance table from docs/assumptions.md §3.
// Used by the seed; at runtime distances are read from the database.

export const ZONES = [
  { code: 'UTT', name: 'Uttara' },
  { code: 'BSH', name: 'Bashundhara' },
  { code: 'BAN', name: 'Banani' },
  { code: 'GL1', name: 'Gulshan 1' },
  { code: 'GL2', name: 'Gulshan 2' },
  { code: 'MOH', name: 'Mohakhali' },
  { code: 'TEJ', name: 'Tejgaon' },
  { code: 'FRM', name: 'Farmgate' },
  { code: 'MR1', name: 'Mirpur 1' },
  { code: 'MR2', name: 'Mirpur 2' },
  { code: 'M10', name: 'Mirpur 10' },
  { code: 'M11', name: 'Mirpur 11' },
  { code: 'M12', name: 'Mirpur 12' },
  { code: 'DHN', name: 'Dhanmondi' },
] as const;

// DISTANCE_KM[i][j] = km from ZONES[i] to ZONES[j]. 0 on the diagonal (same zone).
// The table is symmetric and satisfies the triangle inequality (checked in the unit test).
// prettier-ignore
export const DISTANCE_KM: number[][] = [
  //UTT BSH BAN GL1 GL2 MOH TEJ FRM MR1 MR2 M10 M11 M12 DHN
  [  0,  9, 12, 14, 12, 13, 15, 16, 14, 13, 12, 10,  9, 19], // UTT
  [  9,  0,  6,  5,  4,  7,  9, 11, 14, 13, 12, 12, 12, 14], // BSH
  [ 12,  6,  0,  4,  3,  3,  6,  7, 10,  9,  8,  9, 10, 10], // BAN
  [ 14,  5,  4,  0,  2,  3,  5,  7, 11, 11, 10, 11, 12, 10], // GL1
  [ 12,  4,  3,  2,  0,  4,  6,  8, 12, 11, 10, 10, 11, 11], // GL2
  [ 13,  7,  3,  3,  4,  0,  3,  4,  8,  8,  7,  8,  9,  7], // MOH
  [ 15,  9,  6,  5,  6,  3,  0,  2,  8,  8,  7,  8,  9,  5], // TEJ
  [ 16, 11,  7,  7,  8,  4,  2,  0,  7,  7,  6,  7,  8,  3], // FRM
  [ 14, 14, 10, 11, 12,  8,  8,  7,  0,  2,  3,  4,  5,  7], // MR1
  [ 13, 13,  9, 11, 11,  8,  8,  7,  2,  0,  2,  3,  4,  8], // MR2
  [ 12, 12,  8, 10, 10,  7,  7,  6,  3,  2,  0,  2,  3,  8], // M10
  [ 10, 12,  9, 11, 10,  8,  8,  7,  4,  3,  2,  0,  2,  9], // M11
  [  9, 12, 10, 12, 11,  9,  9,  8,  5,  4,  3,  2,  0, 10], // M12
  [ 19, 14, 10, 10, 11,  7,  5,  3,  7,  8,  8,  9, 10,  0], // DHN
];
