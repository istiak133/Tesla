import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // e2e files share one database and reset it, so they must not run at the same time.
    fileParallelism: false,
    // Each test resets a real database and logs users in, and some race several rounds:
    // vitest's 5 s default is too tight on a busy laptop or CI runner.
    testTimeout: 20_000,
  },
});
